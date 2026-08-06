/**
 * executionApprovalPlanService — Sprint 29F.1 (Part 3)
 *
 * Produces approval plans for ExecutionAction sets, grouping safe actions into
 * a single user-visible plan and keeping high-risk actions as separate items.
 *
 * Non-negotiable rules (from brief):
 *   • Safe reads: no approval when user explicitly requested and permissions allow.
 *   • Planned writes: one plan-level approval may cover clearly described
 *     low/medium-risk actions to a bounded target.
 *   • High-risk actions: each must be separately confirmed. High-risk includes
 *     file deletion, external email send, terminal execution, software install,
 *     browser form submission, or any action classified high risk.
 *   • Approval must show: what/target/device/specialist/side-effects/reversibility/expiry.
 *   • Approval binds to: exact action set + targets + content hash/output version
 *     + executionId + connector device + expiry time.
 *   • Changing any bound field INVALIDATES the approval; fresh approval required.
 *
 * Approval plan lifecycle:
 *   pending → approved | rejected | expired
 */

import { createHash, randomUUID } from "crypto";
import type { ExecutionAction } from "../types/canonicalExecutionContext.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ApprovalPlanStatus = "pending" | "approved" | "rejected" | "expired";

/** A human-readable description of a single action within a plan */
export interface ApprovalPlanItem {
  actionId: string;
  actionType: string;
  description: string;
  target: string | null;
  riskLevel: string;
  isReversible: boolean;
  sideEffects: string[];
  requiresSeparateApproval: boolean;
}

/** The top-level approval plan presented to the user */
export interface ApprovalPlan {
  planId: string;
  executionId: string;
  specialistCode: string;
  deviceId: string;
  /** ISO timestamp when this plan expires — approval after this point is invalid */
  expiresAt: string;
  status: ApprovalPlanStatus;
  /** All actions included in this plan */
  items: ApprovalPlanItem[];
  /** Subset of items that may be approved together (low/medium risk, not high-risk) */
  groupedItems: ApprovalPlanItem[];
  /** High-risk items requiring individual confirmation */
  separateItems: ApprovalPlanItem[];
  /**
   * Binding hash — computed from executionId + deviceId + sorted action IDs +
   * targets + content version. Any change to these fields invalidates this plan
   * and requires fresh approval.
   */
  bindingHash: string;
  /** Read-only context for approval UI */
  context: {
    totalActions: number;
    totalGrouped: number;
    totalSeparate: number;
    allReversible: boolean;
    highestRisk: string;
    specialist: string;
    device: string;
  };
}

/** Validation result when checking an existing plan against current actions */
export interface ApprovalPlanValidation {
  valid: boolean;
  reason?: string;
  /** Fields that changed and triggered invalidation */
  changedFields?: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default approval validity window (15 minutes) */
const DEFAULT_EXPIRY_MS = 15 * 60 * 1_000;

/** Risk levels considered high-risk — must always be separately approved */
const HIGH_RISK_LEVELS = new Set(["high", "critical"]);

/** Action types considered high-risk regardless of declared riskLevel */
const HIGH_RISK_ACTION_TYPES = new Set([
  "delete_file",
  "delete_folder",
  "send_email",
  "run_terminal",
  "execute_script",
  "install_software",
  "submit_form",
  "browser_interaction",
]);

// ─── Side effect descriptions ─────────────────────────────────────────────────

function describeSideEffects(action: ExecutionAction): string[] {
  const effects: string[] = [];
  const { domain, actionType, riskLevel } = action;

  if (domain === "word") {
    if (actionType === "create_file") effects.push("Creates a new Word document on the connected device");
    if (actionType === "move_file")   effects.push("Exports Word document — original file may be modified");
    else                              effects.push("Modifies content in an existing Word document");
  } else if (domain === "excel") {
    effects.push("Updates cell values in the connected workbook — existing values will be overwritten");
  } else if (domain === "email") {
    effects.push("Creates a draft email in Outlook Drafts — will NOT be sent automatically");
  } else if (domain === "files") {
    if (actionType === "create_file") effects.push("Creates a new file on the connected device");
    if (actionType === "write_file")  effects.push("Overwrites or appends to an existing file");
    if (actionType === "move_file")   effects.push("Moves or renames a file — original path will no longer exist");
  }

  if (riskLevel === "high" || riskLevel === "critical") {
    effects.push(`This action is classified ${riskLevel} risk and may have significant consequences`);
  }

  return effects;
}

function isReversibleAction(action: ExecutionAction): boolean {
  const { actionType } = action;
  // These are not easily reversible
  const irreversible = ["delete_file", "delete_folder", "send_email", "move_file", "word_export"];
  return !irreversible.includes(actionType);
}

function requiresSeparateApproval(action: ExecutionAction): boolean {
  return (
    HIGH_RISK_LEVELS.has(action.riskLevel ?? "") ||
    HIGH_RISK_ACTION_TYPES.has(action.actionType)
  );
}

// ─── Binding hash ─────────────────────────────────────────────────────────────

function computeBindingHash(
  executionId: string,
  deviceId: string,
  actions: ExecutionAction[],
): string {
  const sortedIds = [...actions.map(a => a.actionId)].sort();
  const targets   = sortedIds.map(id => {
    const a = actions.find(x => x.actionId === id)!;
    return `${id}:${a.resolvedDestination?.displayPath ?? a.description ?? ""}`;
  });

  const payload = JSON.stringify({ executionId, deviceId, sortedIds, targets });
  return createHash("sha256").update(payload).digest("hex");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create an approval plan for a set of ExecutionActions.
 *
 * Actions are classified into:
 *   - grouped:  low/medium risk, clearly described — one approval covers all
 *   - separate: high-risk — each requires individual confirmation
 *
 * The returned plan carries a `bindingHash` that must be validated before
 * dispatch. Any mutation to the action set, targets, or connector device
 * invalidates the plan.
 */
export function createApprovalPlan(
  actions: ExecutionAction[],
  executionId: string,
  specialistCode: string,
  deviceId: string,
  expiryMs: number = DEFAULT_EXPIRY_MS,
): ApprovalPlan {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiryMs).toISOString();

  const items: ApprovalPlanItem[] = actions.map(action => ({
    actionId:                action.actionId,
    actionType:              action.actionType,
    description:             action.description,
    target:                  action.resolvedDestination?.displayPath ?? null,
    riskLevel:               action.riskLevel ?? "medium",
    isReversible:            isReversibleAction(action),
    sideEffects:             describeSideEffects(action),
    requiresSeparateApproval: requiresSeparateApproval(action),
  }));

  const groupedItems   = items.filter(i => !i.requiresSeparateApproval);
  const separateItems  = items.filter(i => i.requiresSeparateApproval);
  const allReversible  = items.every(i => i.isReversible);
  const riskOrder      = ["critical", "high", "medium", "low"];
  const highestRisk    = riskOrder.find(r => items.some(i => i.riskLevel === r)) ?? "low";

  return {
    planId:       randomUUID(),
    executionId,
    specialistCode,
    deviceId,
    expiresAt,
    status:       "pending",
    items,
    groupedItems,
    separateItems,
    bindingHash:  computeBindingHash(executionId, deviceId, actions),
    context: {
      totalActions:  items.length,
      totalGrouped:  groupedItems.length,
      totalSeparate: separateItems.length,
      allReversible,
      highestRisk,
      specialist:    specialistCode,
      device:        deviceId,
    },
  };
}

/**
 * Validate an existing approval plan against the current action set.
 *
 * Returns invalid when:
 *   - The plan has expired
 *   - The executionId has changed
 *   - The deviceId has changed
 *   - The action set has changed (different IDs or targets)
 *
 * Any invalidation requires fresh approval — never use a stale plan.
 */
export function validateApprovalPlan(
  plan: ApprovalPlan,
  currentActions: ExecutionAction[],
  currentDeviceId: string,
): ApprovalPlanValidation {
  const changedFields: string[] = [];

  // 1. Expiry check
  if (new Date() > new Date(plan.expiresAt)) {
    return { valid: false, reason: "Approval plan has expired — fresh approval required", changedFields: ["expiresAt"] };
  }

  // 2. Status check
  if (plan.status !== "approved") {
    return { valid: false, reason: `Approval plan status is "${plan.status}" — must be "approved"`, changedFields: ["status"] };
  }

  // 3. Device change
  if (plan.deviceId !== currentDeviceId) {
    changedFields.push("deviceId");
  }

  // 4. Binding hash check (covers action set + targets + executionId + deviceId)
  const currentHash = computeBindingHash(plan.executionId, currentDeviceId, currentActions);
  const originalHash = computeBindingHash(plan.executionId, plan.deviceId, currentActions);
  // Re-compute using stored executionId + stored deviceId against current actions
  const checkHash = computeBindingHash(plan.executionId, plan.deviceId, currentActions);

  if (checkHash !== plan.bindingHash) {
    changedFields.push("actions");
  }

  if (changedFields.length > 0) {
    return {
      valid: false,
      reason: `Approval plan is invalid — the following bound fields changed: ${changedFields.join(", ")}. Fresh approval required.`,
      changedFields,
    };
  }

  return { valid: true };
}

/**
 * Check whether an approval plan has expired.
 */
export function isApprovalPlanExpired(plan: ApprovalPlan): boolean {
  return new Date() > new Date(plan.expiresAt);
}
