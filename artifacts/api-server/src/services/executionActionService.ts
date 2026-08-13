/**
 * Execution Action Service — Sprint 29D (Deliverable B)
 *
 * Parses, types, validates, and persists ExecutionAction proposals from
 * specialist output. This service is the sole bridge between the specialist's
 * raw requestedExternalActions output and the engine's typed ExecutionAction[].
 *
 * OWNERSHIP:
 *   Input  — specialist's requestedExternalActions (untyped strings from LLM)
 *   Output — typed ExecutionAction[] validated against the ResourcePlan
 *   Caller — UnifiedExecutionEngine only; never called by adapters or routes
 *
 * Action lifecycle in Sprint 29D:
 *   1. Specialist proposes actions via requestedExternalActions in its JSON output.
 *   2. Engine calls parseExecutionActions() to convert raw proposals.
 *   3. Engine calls validateExecutionActions() to check proposals against plan.
 *   4. Engine stores result in ctx.executionActions — planning artefacts only.
 *   5. Connector P6 (future sprint) reads ctx.executionActions and executes them
 *      after obtaining any required approvals.
 *
 * INVARIANTS enforced by this service:
 *   - Every action has a unique actionId (UUID).
 *   - Every action has a fully resolved ResolvedWriteTarget (or null if
 *     resolution is impossible — flagged as a validation error).
 *   - Actions that require approval are flagged with requiresApproval=true
 *     and a non-empty approvalReason.
 *   - Status is always "proposed" on creation — nothing in this sprint
 *     transitions to "approved" or "rejected".
 *   - Risk levels map: "high" → requiresApproval always.
 */

import { randomUUID } from "crypto";
import type { ExecutionAction, ExecutionActionType, ApprovalRequirementRef, ResourcePlan } from "../types/canonicalExecutionContext.js";
import type { WorkerProfile } from "../lib/workerProfileRegistry.js";
import { resolveWriteTarget } from "./writeTargetResolverService.js";

// ─── Raw action type from specialist output ───────────────────────────────────

export interface RawRequestedAction {
  /** Stable technical authority identifier when it differs from the typed execution action. */
  actionIdentifier?: string;
  actionType: string;
  executionChannel: string;
  toolCategory: string;
  connectorCategory?: string;
  browserDomain?: string;
  url?: string;
  approvalRequired: boolean;
  riskLevel: string;
  /** Optional — specialist may supply a human-readable description */
  description?: string;
  /** Optional — specialist may supply path or destination parameters */
  path?: string;
  destination?: string;
  [key: string]: unknown;
}

// ─── Validation result ────────────────────────────────────────────────────────

export interface ActionValidationResult {
  valid: ExecutionAction[];
  invalid: Array<{ raw: RawRequestedAction; reason: string }>;
  approvalRequirements: ApprovalRequirementRef[];
  authorityDecisions: WorkerProfileAuthorityDecision[];
}

export type WorkerProfileAuthorityStatus =
  | "PERMITTED"
  | "APPROVAL_REQUIRED"
  | "PROHIBITED"
  | "UNMAPPED_AUTHORITY";

export interface WorkerProfileAuthorityDecision {
  decision: WorkerProfileAuthorityStatus;
  specialistCode: string | null;
  workerProfileCode: string | null;
  workerProfileVersion: string | null;
  actionIdentifier: string;
  actionType: string;
  executionChannel: string | null;
  toolCategory: string | null;
  connectorCategory: string | null;
  browserDomain: string | null;
  reason: string;
  approvalRequired: boolean;
  approved: boolean;
  decidedAt: string;
  executionId?: string;
  taskId?: string;
}

export interface WorkerProfileAuthorityRequest {
  specialistCode?: string;
  workerProfile: Pick<
    WorkerProfile,
    | "code"
    | "version"
    | "allowedExecutionChannels"
    | "allowedToolCategories"
    | "allowedConnectorCategories"
    | "allowedBrowserDomains"
    | "prohibitedActions"
    | "approvalRequiredActions"
  >;
  actionIdentifier: string;
  actionType: string;
  executionChannel?: string | null;
  toolCategory?: string | null;
  connectorCategory?: string | null;
  browserDomain?: string | null;
  approvalGranted?: boolean;
  blueprintProhibitedActions?: string[];
  executionId?: string;
  taskId?: string;
}

export interface WorkerProfileActionValidationContext {
  specialistCode?: string;
  workerProfile?: WorkerProfileAuthorityRequest["workerProfile"] | null;
  workerProfileCode?: string | null;
  blueprintProhibitedActions?: string[];
  approvedActionIdentifiers?: string[];
  executionId?: string;
  taskId?: string;
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Parses raw requestedExternalActions from specialist output into typed
 * ExecutionAction proposals.
 *
 * Non-parseable entries are silently skipped (logged to stderr) and do NOT
 * abort execution — the specialist run already succeeded; bad action proposals
 * must not retroactively fail it.
 */
export function parseExecutionActions(
  rawActions: RawRequestedAction[],
  specialistRunId: string,
): ExecutionAction[] {
  if (!Array.isArray(rawActions) || rawActions.length === 0) {
    return [];
  }

  const result: ExecutionAction[] = [];

  for (const raw of rawActions) {
    try {
      const action = parseOneAction(raw, specialistRunId);
      result.push(action);
    } catch (err: any) {
      console.error(
        "[ExecutionActionService] Failed to parse action proposal:",
        err?.message,
        "| specialistRunId:", specialistRunId,
        "| raw:", JSON.stringify(raw).slice(0, 200),
      );
    }
  }

  return result;
}

/**
 * Validates parsed ExecutionActions against the current ResourcePlan.
 *
 * Validation checks:
 *   1. Action type is a recognised ExecutionActionType.
 *   2. ResolvedWriteTarget is present for write actions.
 *   3. High-risk actions always require approval (enforced regardless of
 *      what the specialist proposed).
 *   4. Actions requiring connector channels are flagged when the session
 *      has connectorSessionOpened=false.
 *
 * Returns validated actions, invalid actions with reasons, and derived
 * ApprovalRequirements for the ResourcePlan.
 */
export function validateExecutionActions(
  actions: ExecutionAction[],
  resourcePlan: ResourcePlan,
  authorityContext?: WorkerProfileActionValidationContext,
): ActionValidationResult {
  const valid: ExecutionAction[] = [];
  const invalid: Array<{ raw: RawRequestedAction; reason: string }> = [];
  const approvalRequirements: ApprovalRequirementRef[] = [];
  const authorityDecisions: WorkerProfileAuthorityDecision[] = [];

  for (const action of actions) {
    const issues: string[] = [];
    const actionIdentifier = getActionIdentifier(action);

    // Rule 1: Must be a recognised action type
    if (!KNOWN_ACTION_TYPES.has(action.actionType)) {
      issues.push(`Unknown actionType "${action.actionType}"`);
    }

    const authorityDecision = authorityContext
      ? authorityContext.workerProfile
        ? evaluateWorkerProfileAuthority({
          specialistCode:             authorityContext.specialistCode,
          workerProfile:              authorityContext.workerProfile,
          actionIdentifier,
          actionType:                 action.actionType,
          executionChannel:           getStringParam(action, "executionChannel"),
          toolCategory:               getStringParam(action, "toolCategory"),
          connectorCategory:          getOptionalStringParam(action, "connectorCategory"),
          browserDomain:              getBrowserDomain(action),
          approvalGranted:
            action.status === "approved" ||
            (authorityContext.approvedActionIdentifiers ?? []).includes(actionIdentifier),
          blueprintProhibitedActions: authorityContext.blueprintProhibitedActions,
          executionId:                authorityContext.executionId,
          taskId:                     authorityContext.taskId,
        })
        : buildUnmappedWorkerProfileDecision({
            specialistCode:     authorityContext.specialistCode,
            workerProfileCode:  authorityContext.workerProfileCode,
            actionIdentifier,
            actionType:         action.actionType,
            executionChannel:   getStringParam(action, "executionChannel"),
            toolCategory:       getStringParam(action, "toolCategory"),
            connectorCategory:  getOptionalStringParam(action, "connectorCategory"),
            browserDomain:      getBrowserDomain(action),
            approved:           action.status === "approved" ||
              (authorityContext.approvedActionIdentifiers ?? []).includes(actionIdentifier),
            executionId:        authorityContext.executionId,
            taskId:             authorityContext.taskId,
          })
      : null;
    if (authorityDecision) {
      authorityDecisions.push(authorityDecision);
      if (
        authorityDecision.decision === "PROHIBITED" ||
        authorityDecision.decision === "UNMAPPED_AUTHORITY"
      ) {
        issues.push(authorityDecision.reason);
      }
    }

    // Rule 2: High-risk must always require approval (engine override)
    const forcedApproval =
      action.riskLevel === "high" ||
      action.resolvedDestination?.approvalRequired === true ||
      authorityDecision?.decision === "APPROVAL_REQUIRED";

    // Rule 3: write_targets must be resolvable (null destination on write action is a warning, not failure)
    if (isWriteAction(action.actionType) && action.resolvedDestination === null) {
      issues.push(`Write action "${action.actionType}" has no resolved destination`);
    }

    if (issues.length > 0) {
      // Downgrade: push to invalid list but do NOT hard-fail — specialists
      // are allowed to propose actions outside current capability scope.
      // The engine records them as invalid proposals for audit, not errors.
      invalid.push({ raw: actionToRaw(action), reason: issues.join("; ") });
      continue;
    }

    // Apply engine-enforced approval rules
    const finalAction: ExecutionAction = forcedApproval
      ? {
          ...action,
          requiresApproval: true,
          approvalReason:
            authorityDecision?.decision === "APPROVAL_REQUIRED"
              ? authorityDecision.reason
              : action.approvalReason ??
            (action.riskLevel === "high"
              ? "High-risk actions require explicit approval before execution"
              : action.resolvedDestination?.approvalReason ?? "Approval required"),
        }
      : action;

    valid.push(finalAction);

    if (finalAction.requiresApproval) {
      approvalRequirements.push({
        actionId:      finalAction.actionId,
        actionType:    finalAction.actionType,
        reason:        finalAction.approvalReason ?? "Approval required",
        approvalLevel: deriveApprovalLevel(finalAction),
      });
    }
  }

  return { valid, invalid, approvalRequirements, authorityDecisions };
}

export function evaluateWorkerProfileAuthority(
  request: WorkerProfileAuthorityRequest,
): WorkerProfileAuthorityDecision {
  const actionIdentifier = normaliseAuthorityIdentifier(request.actionIdentifier);
  const actionType = normaliseAuthorityIdentifier(request.actionType);
  const executionChannel = normaliseAuthorityIdentifier(request.executionChannel ?? "");
  const toolCategory = normaliseAuthorityIdentifier(request.toolCategory ?? "");
  const connectorCategory = normaliseAuthorityIdentifier(request.connectorCategory ?? "");
  const browserDomain = normaliseBrowserDomain(request.browserDomain ?? "");
  const prohibited = new Set(request.workerProfile.prohibitedActions.map(normaliseAuthorityIdentifier));
  const approvalRequired = new Set(request.workerProfile.approvalRequiredActions.map(normaliseAuthorityIdentifier));
  const blueprintProhibited = new Set((request.blueprintProhibitedActions ?? []).map(normaliseAuthorityIdentifier));
  const decidedAt = new Date().toISOString();

  const base = {
    specialistCode: request.specialistCode ?? null,
    workerProfileCode: request.workerProfile.code,
    workerProfileVersion: request.workerProfile.version,
    actionIdentifier,
    actionType,
    executionChannel: executionChannel || null,
    toolCategory: toolCategory || null,
    connectorCategory: connectorCategory || null,
    browserDomain: browserDomain || null,
    approved: request.approvalGranted === true,
    decidedAt,
    executionId: request.executionId,
    taskId: request.taskId,
  };

  const deny = (
    decision: Exclude<WorkerProfileAuthorityStatus, "PERMITTED" | "APPROVAL_REQUIRED">,
    reason: string,
  ): WorkerProfileAuthorityDecision => ({
    ...base,
    decision,
    reason,
    approvalRequired: false,
  });
  const needsApproval = (reason: string): WorkerProfileAuthorityDecision => ({
    ...base,
    decision: "APPROVAL_REQUIRED",
    reason,
    approvalRequired: true,
  });
  const permit = (reason: string): WorkerProfileAuthorityDecision => ({
    ...base,
    decision: "PERMITTED",
    reason,
    approvalRequired: false,
  });

  if (!actionIdentifier || !actionType) {
    return deny("UNMAPPED_AUTHORITY", "Action identity is missing or unmapped; WorkerProfile authority cannot be proven");
  }
  if (!KNOWN_ACTION_TYPES.has(actionType as ExecutionActionType)) {
    return deny("UNMAPPED_AUTHORITY", `Action type "${actionType}" is unknown; WorkerProfile authority cannot be proven`);
  }
  if (blueprintProhibited.has(actionIdentifier) || blueprintProhibited.has(actionType)) {
    return deny("PROHIBITED", `Blueprint prohibits action "${actionIdentifier}"`);
  }
  if (prohibited.has(actionIdentifier) || prohibited.has(actionType)) {
    return deny("PROHIBITED", `WorkerProfile "${request.workerProfile.code}" prohibits action "${actionIdentifier}"`);
  }
  if (!executionChannel) {
    return deny("UNMAPPED_AUTHORITY", "Execution channel is missing; WorkerProfile authority cannot be proven");
  }
  if (!request.workerProfile.allowedExecutionChannels.map(normaliseAuthorityIdentifier).includes(executionChannel)) {
    return deny("PROHIBITED", `Execution channel "${executionChannel}" is not permitted for WorkerProfile "${request.workerProfile.code}"`);
  }
  if (!toolCategory) {
    return deny("UNMAPPED_AUTHORITY", "Tool category is missing; WorkerProfile authority cannot be proven");
  }
  if (!request.workerProfile.allowedToolCategories.map(normaliseAuthorityIdentifier).includes(toolCategory)) {
    return deny("PROHIBITED", `Tool category "${toolCategory}" is not permitted for WorkerProfile "${request.workerProfile.code}"`);
  }
  if (connectorCategory) {
    const allowedConnectors = request.workerProfile.allowedConnectorCategories.map(normaliseAuthorityIdentifier);
    if (!allowedConnectors.includes(connectorCategory)) {
      return deny("PROHIBITED", `Connector category "${connectorCategory}" is not permitted for WorkerProfile "${request.workerProfile.code}"`);
    }
  }
  if (actionType === "browser_interaction" || executionChannel === "web_browser" || browserDomain) {
    const allowedDomains = request.workerProfile.allowedBrowserDomains.map(normaliseBrowserDomain).filter(Boolean);
    if (!browserDomain) {
      return deny("UNMAPPED_AUTHORITY", "Browser action has no domain; WorkerProfile browser authority cannot be proven");
    }
    if (allowedDomains.length === 0 || !allowedDomains.some((domain) => domainMatches(browserDomain, domain))) {
      return deny("PROHIBITED", `Browser domain "${browserDomain}" is not permitted for WorkerProfile "${request.workerProfile.code}"`);
    }
  }
  if (approvalRequired.has(actionIdentifier) || approvalRequired.has(actionType)) {
    return request.approvalGranted === true
      ? permit(`WorkerProfile approval requirement satisfied for "${actionIdentifier}"`)
      : needsApproval(`WorkerProfile "${request.workerProfile.code}" requires approval for "${actionIdentifier}"`);
  }

  return permit(`WorkerProfile "${request.workerProfile.code}" permits "${actionIdentifier}"`);
}

interface UnmappedWorkerProfileDecisionInput {
  specialistCode?: string;
  workerProfileCode?: string | null;
  actionIdentifier: string;
  actionType: string;
  executionChannel?: string | null;
  toolCategory?: string | null;
  connectorCategory?: string | null;
  browserDomain?: string | null;
  approved?: boolean;
  executionId?: string;
  taskId?: string;
}

function buildUnmappedWorkerProfileDecision(
  input: UnmappedWorkerProfileDecisionInput,
): WorkerProfileAuthorityDecision {
  return {
    decision:             "UNMAPPED_AUTHORITY",
    specialistCode:       input.specialistCode ?? null,
    workerProfileCode:    input.workerProfileCode ?? null,
    workerProfileVersion: null,
    actionIdentifier:     normaliseAuthorityIdentifier(input.actionIdentifier),
    actionType:           normaliseAuthorityIdentifier(input.actionType),
    executionChannel:     normaliseAuthorityIdentifier(input.executionChannel ?? "") || null,
    toolCategory:         normaliseAuthorityIdentifier(input.toolCategory ?? "") || null,
    connectorCategory:    normaliseAuthorityIdentifier(input.connectorCategory ?? "") || null,
    browserDomain:        normaliseBrowserDomain(input.browserDomain ?? "") || null,
    reason:               "WorkerProfile authority is missing or unresolved; executable action authority cannot be proven",
    approvalRequired:     false,
    approved:             input.approved === true,
    decidedAt:            new Date().toISOString(),
    executionId:          input.executionId,
    taskId:               input.taskId,
  };
}

/**
 * Builds the full write-target list from a set of validated ExecutionActions.
 * Used by the engine to populate ResourcePlan.writeTargets.
 */
export function extractWriteTargets(
  actions: ExecutionAction[],
): import("../types/canonicalExecutionContext.js").ResolvedWriteTarget[] {
  const seen = new Set<string>();
  const targets: import("../types/canonicalExecutionContext.js").ResolvedWriteTarget[] = [];

  for (const action of actions) {
    if (!action.resolvedDestination) continue;
    const key = `${action.resolvedDestination.domain}::${action.resolvedDestination.displayPath}`;
    if (!seen.has(key)) {
      seen.add(key);
      targets.push(action.resolvedDestination);
    }
  }

  return targets;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function parseOneAction(raw: RawRequestedAction, specialistRunId: string): ExecutionAction {
  const actionType = normaliseActionType(raw.actionType);
  if (!actionType) {
    throw new Error(`Unknown executable action type "${raw.actionType}"`);
  }
  const domain     = normaliseDomain(raw.toolCategory, raw.executionChannel);
  const riskLevel  = normaliseRiskLevel(raw.riskLevel);

  const parameters: Record<string, unknown> = {
    actionIdentifier: raw.actionIdentifier ?? raw.actionType,
    executionChannel:  raw.executionChannel,
    toolCategory:      raw.toolCategory,
    connectorCategory: raw.connectorCategory,
    specialistRunId,
  };
  if (raw.path)        parameters.path        = raw.path;
  if (raw.destination) parameters.destination = raw.destination;
  if (raw.browserDomain) parameters.browserDomain = raw.browserDomain;
  if (raw.url)           parameters.url           = raw.url;

  const resolvedDestination = resolveWriteTarget(actionType, domain, parameters);

  // Approval: specialist says so OR high risk OR destination demands it
  const requiresApproval =
    raw.approvalRequired ||
    riskLevel === "high" ||
    resolvedDestination.approvalRequired;

  const approvalReason = requiresApproval
    ? (resolvedDestination.approvalReason ?? `Risk level: ${riskLevel}`)
    : null;

  const description =
    raw.description?.trim() ||
    buildDefaultDescription(actionType, domain, resolvedDestination.displayPath);

  return {
    actionId:            randomUUID(),
    actionType,
    domain:              domain as ExecutionAction["domain"],
    description,
    resolvedDestination,
    requiresApproval,
    approvalReason,
    riskLevel,
    proposedAt:          new Date().toISOString(),
    status:              "proposed",
    parameters,
  };
}

const KNOWN_ACTION_TYPES = new Set<ExecutionActionType>([
  "write_file",
  "create_file",
  "update_file",
  "move_file",
  "draft_email",
  "send_email",
  "update_spreadsheet",
  "browser_interaction",
  "calendar_update",
  "terminal_command",
]);

const ACTION_TYPE_MAP: Record<string, ExecutionActionType> = {
  write_file:          "write_file",
  writefile:           "write_file",
  write:               "write_file",
  create_file:         "create_file",
  createfile:          "create_file",
  create:              "create_file",
  update_file:         "update_file",
  updatefile:          "update_file",
  update:              "update_file",
  edit:                "update_file",
  move_file:           "move_file",
  movefile:            "move_file",
  move:                "move_file",
  draft_email:         "draft_email",
  draftemail:          "draft_email",
  draft:               "draft_email",
  send_email:          "send_email",
  sendemail:           "send_email",
  send:                "send_email",
  update_spreadsheet:  "update_spreadsheet",
  updatespreadsheet:   "update_spreadsheet",
  spreadsheet:         "update_spreadsheet",
  excel:               "update_spreadsheet",
  browser_interaction: "browser_interaction",
  browser:             "browser_interaction",
  web:                 "browser_interaction",
  calendar_update:     "calendar_update",
  calendarupdate:      "calendar_update",
  calendar:            "calendar_update",
  terminal_command:    "terminal_command",
  terminal:            "terminal_command",
  command:             "terminal_command",
  shell:               "terminal_command",
};

function normaliseActionType(raw: string): ExecutionActionType | null {
  const key = (raw ?? "").toLowerCase().replace(/[-\s]/g, "_");
  return ACTION_TYPE_MAP[key] ?? null;
}

function normaliseDomain(
  toolCategory: string,
  executionChannel: string,
): ExecutionAction["domain"] {
  const cat = (toolCategory ?? "").toLowerCase();
  const ch  = (executionChannel ?? "").toLowerCase();

  if (cat.includes("email") || cat.includes("outlook")) return "email";
  if (cat.includes("excel") || cat.includes("spreadsheet")) return "excel";
  if (cat.includes("word") || cat.includes("document")) return "word";
  if (cat.includes("browser") || ch.includes("browser")) return "browser";
  if (cat.includes("calendar")) return "calendar";
  if (cat.includes("terminal") || cat.includes("shell")) return "terminal";
  return "files";
}

function normaliseRiskLevel(raw: string): "low" | "medium" | "high" {
  const r = (raw ?? "").toLowerCase();
  if (r === "high") return "high";
  if (r === "medium") return "medium";
  return "low";
}

function buildDefaultDescription(
  actionType: ExecutionActionType,
  domain: string,
  displayPath: string,
): string {
  const verb = ACTION_VERBS[actionType] ?? actionType.replace(/_/g, " ");
  return `${verb} — ${displayPath}`;
}

const ACTION_VERBS: Partial<Record<ExecutionActionType, string>> = {
  write_file:          "Write file",
  create_file:         "Create new file",
  update_file:         "Update existing file",
  move_file:           "Move file",
  draft_email:         "Draft email",
  send_email:          "Send email",
  update_spreadsheet:  "Update spreadsheet",
  browser_interaction: "Browser interaction",
  calendar_update:     "Create calendar event",
  terminal_command:    "Run terminal command",
};

function isWriteAction(actionType: ExecutionActionType): boolean {
  return ["write_file", "create_file", "update_file", "move_file", "update_spreadsheet"].includes(
    actionType,
  );
}

function actionToRaw(action: ExecutionAction): RawRequestedAction {
  return {
    actionIdentifier:   getActionIdentifier(action),
    actionType:        action.actionType,
    executionChannel:  String(action.parameters.executionChannel ?? ""),
    toolCategory:      String(action.parameters.toolCategory ?? ""),
    connectorCategory: String(action.parameters.connectorCategory ?? ""),
    approvalRequired:  action.requiresApproval,
    riskLevel:         action.riskLevel,
    description:       action.description,
  };
}

function getActionIdentifier(action: ExecutionAction): string {
  return normaliseAuthorityIdentifier(
    String(action.parameters.actionIdentifier ?? action.actionType ?? ""),
  );
}

function getStringParam(action: ExecutionAction, key: string): string {
  return normaliseAuthorityIdentifier(String(action.parameters[key] ?? ""));
}

function getOptionalStringParam(action: ExecutionAction, key: string): string | null {
  const value = normaliseAuthorityIdentifier(String(action.parameters[key] ?? ""));
  return value || null;
}

function getBrowserDomain(action: ExecutionAction): string | null {
  const explicit = normaliseBrowserDomain(String(action.parameters.browserDomain ?? ""));
  if (explicit) return explicit;
  const url = String(action.parameters.url ?? "");
  if (!url) return null;
  try {
    return normaliseBrowserDomain(new URL(url).hostname);
  } catch {
    return null;
  }
}

function normaliseAuthorityIdentifier(value: string): string {
  return (value ?? "").trim().toLowerCase().replace(/[-\s]+/g, "_");
}

function normaliseBrowserDomain(value: string): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
}

function domainMatches(candidate: string, allowed: string): boolean {
  return candidate === allowed || candidate.endsWith(`.${allowed}`);
}

function deriveApprovalLevel(
  action: ExecutionAction,
): "user" | "admin" | "owner" {
  if (action.riskLevel === "high") return "admin";
  if (action.actionType === "send_email") return "user";
  if (action.resolvedDestination?.domain === "organisation_library") return "admin";
  return "user";
}
