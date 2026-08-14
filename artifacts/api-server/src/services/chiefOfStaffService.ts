/**
 * Chief of Staff Service — Sprint 2
 *
 * Deterministic (no AI, no LLM) task orchestration.
 * Accepts task intent, determines required specialists, and creates an
 * execution plan. Everything is keyword-based routing.
 */

import { randomUUID } from "crypto";
import {
  SPECIALISTS,
  CAPABILITIES,
  getSpecialistsByCapability,
  getSpecialistByCode,
  resolveAlias,
  type RegistrySpecialist,
} from "../lib/workforceRegistry.js";
// Sprint 29H Part A: canonical capability registry for eligibility-aware routing
import { getCapability } from "../lib/capabilityRegistry.js";
import type { ApprovalType } from "@workspace/shared";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExecutionStep {
  stepNumber: number;
  specialistCode: string;
  specialistName: string;
  action: string;
  estimatedDuration: string;
  requiresApproval: boolean;
}

export interface TaskPlan {
  planId: string;
  taskTitle: string;
  intent: string;
  primarySpecialist: string;
  assignedSpecialists: string[];
  steps: ExecutionStep[];
  estimatedTotalDuration: string;
  requiresApproval: boolean;
  approvalType: ApprovalType;
  confidence: number;
  reasoning: string;
}

// ─── Keyword routing map ───────────────────────────────────────────────────────

interface RouteRule {
  keywords: string[];
  capabilities: string[];
  weight: number;
}

// Sprint 29H Part A: ROUTING_RULES now use canonical capability codes (dot-format)
// from capabilityRegistry.ts. Legacy snake_case codes (review_incident, review_policy, …)
// are replaced with their canonical equivalents so selectSpecialists() can use
// capabilityRegistry.eligibleRoles for eligibility-aware selection.
const ROUTING_RULES: RouteRule[] = [
  // Compliance
  { keywords: ["compliance", "audit", "ndis", "regulatory", "regulation"], capabilities: ["compliance.audit_readiness", "policy.review"], weight: 10 },
  { keywords: ["policy", "policies"], capabilities: ["policy.review", "documents.draft"], weight: 9 },
  { keywords: ["incident", "accident", "injury", "near miss", "safeguard", "safety incident"], capabilities: ["incident.review", "compliance.corrective_actions"], weight: 10 },
  { keywords: ["restrictive practice incident", "unauthorised restrictive practice", "safeguarding restrictive practice"], capabilities: ["restrictive_practice.review"], weight: 10 },
  { keywords: ["restrictive practice governance", "rp register", "monthly restrictive practice", "monthly rp", "restrictive practice reporting"], capabilities: ["restrictive_practice.governance", "restrictive_practice.monthly_reporting"], weight: 10 },
  { keywords: ["behaviour support implementation", "bsp implementation", "bsp fidelity", "approved bsp"], capabilities: ["behaviour_support.implementation"], weight: 10 },
  { keywords: ["quality", "standard", "benchmark", "practice standard"], capabilities: ["quality.practice_standard_review"], weight: 8 },
  { keywords: ["corrective action", "improvement", "non-conformance", "non-compliance"], capabilities: ["compliance.corrective_actions"], weight: 9 },
  { keywords: ["gap analysis", "compliance gap", "compliance gaps", "audit gap", "audit gaps"], capabilities: ["compliance.gap_analysis", "incident.review"], weight: 9 },
  // Operations
  { keywords: ["roster", "shift", "schedule", "scheduling", "staff allocation"], capabilities: ["roster.review", "roster.plan"], weight: 12 },
  { keywords: ["coverage gap", "coverage gaps", "uncovered shift", "vacancy", "replacement staff", "roster exception"], capabilities: ["roster.coverage", "roster.vacancy_management", "roster.exception_review"], weight: 12 },
  { keywords: ["workflow", "process", "procedure", "sop"], capabilities: ["operations.workflow_review"], weight: 8 },
  { keywords: ["capacity", "resource", "staffing level", "headcount"], capabilities: ["operations.capacity_analysis"], weight: 8 },
  { keywords: ["service delivery", "planned vs actual support", "support delivery", "service gap", "service gaps"], capabilities: ["service_delivery.review"], weight: 12 },
  { keywords: ["asset", "equipment", "vehicle", "property", "maintenance"], capabilities: ["asset.review"], weight: 7 },
  // Finance
  { keywords: ["invoice", "invoicing", "claim", "billing"], capabilities: ["finance.invoice_review"], weight: 9 },
  { keywords: ["payroll", "pay run", "wages", "salary", "award"], capabilities: ["payroll.review"], weight: 9 },
  { keywords: ["budget", "spending", "expenditure", "variance"], capabilities: ["finance.budget_analysis"], weight: 8 },
  { keywords: ["financial report", "financial statement", "p&l", "profit", "loss"], capabilities: ["finance.financial_reporting"], weight: 8 },
  { keywords: ["accounts", "reconciliation", "bank", "reconcile"], capabilities: ["accounting.reconciliation"], weight: 7 },
  // HR
  { keywords: ["recruit", "hiring", "job ad", "candidate", "interview"], capabilities: ["hr.recruitment"], weight: 9 },
  { keywords: ["performance review", "performance", "kpi", "goal setting"], capabilities: ["hr.performance"], weight: 8 },
  { keywords: ["training", "learning", "development", "certification", "cpd"], capabilities: ["learning.training_gap_analysis"], weight: 8 },
  { keywords: ["worker screening", "wwcc", "police check", "credential", "clearance"], capabilities: ["staff_compliance.qualification_review"], weight: 9 },
  { keywords: ["hr policy", "leave", "workplace", "employee relations"], capabilities: ["policy.review"], weight: 7 },
  // Marketing
  { keywords: ["campaign", "marketing campaign", "promotion"], capabilities: ["marketing.campaign_planning"], weight: 8 },
  { keywords: ["content", "blog", "article", "copy"], capabilities: ["marketing.content_strategy"], weight: 7 },
  { keywords: ["brand", "branding", "logo", "identity"], capabilities: ["marketing.brand_management"], weight: 7 },
  { keywords: ["social media", "facebook", "instagram", "linkedin", "twitter"], capabilities: ["marketing.content_strategy"], weight: 8 },
  { keywords: ["marketing report", "roi", "analytics"], capabilities: ["reporting.marketing"], weight: 6 },
  // Generic
  { keywords: ["document", "report", "draft", "write", "template"], capabilities: ["documents.draft"], weight: 5 },
  { keywords: ["research", "analyse", "analysis", "investigate", "find out"], capabilities: ["research.general"], weight: 5 },
  { keywords: ["email", "letter", "message", "communicate", "notify"], capabilities: ["communications.draft"], weight: 5 },
  { keywords: ["meeting", "appointment", "calendar", "book"], capabilities: ["calendar.management", "calendar.propose_times"], weight: 5 },
  { keywords: ["summarise", "summary", "overview", "brief"], capabilities: ["communications.summarise"], weight: 4 },
];

// ─── Alias resolution ─────────────────────────────────────────────────────────

/**
 * Sprint 11: Resolves a role code to its current replacement if it has been deprecated.
 * Returns the input unchanged if it is already a current role code or has no direct alias.
 * Uses the resolveAlias() helper from workforceRegistry.
 *
 * @example
 *   resolveSpecialistAlias("compliance_officer") // → "compliance_quality_manager"
 *   resolveSpecialistAlias("operations_manager") // → "operations_manager"
 */
export function resolveSpecialistAlias(code: string): string {
  // resolveAlias returns null if not deprecated or has no direct replacement
  return resolveAlias(code) ?? code;
}

// ─── Intent classification ────────────────────────────────────────────────────

interface IntentScore {
  capabilityCode: string;
  score: number;
}

function classifyIntent(text: string): IntentScore[] {
  const lower = text.toLowerCase();
  const scores = new Map<string, number>();

  for (const rule of ROUTING_RULES) {
    const matched = rule.keywords.some(kw => lower.includes(kw));
    if (matched) {
      for (const cap of rule.capabilities) {
        scores.set(cap, (scores.get(cap) ?? 0) + rule.weight);
      }
    }
  }

  return Array.from(scores.entries())
    .map(([capabilityCode, score]) => ({ capabilityCode, score }))
    .sort((a, b) => b.score - a.score);
}

// Sprint 29H Part A: statuses that are permanently blocked from dispatch.
// A specialist with any of these statuses must never enter UnifiedExecutionEngine.
const BLOCKED_EXECUTION_STATUSES = new Set([
  "deprecated",
  "dna_pending",
  "archived",
  "coming_soon",
]);

// ─── Specialist selection ─────────────────────────────────────────────────────

/**
 * Sprint 29H Part A: Eligibility-aware specialist selection.
 *
 * Uses the canonical capabilityRegistry.eligibleRoles list (not the legacy
 * workforce registry capability codes) to resolve which specialists can handle
 * each capability. Applies status filtering at selection time — dna_pending,
 * coming_soon, archived, and deprecated specialists are never selected.
 *
 * Full async eligibility enforcement (pack entitlements, org access, worker
 * profiles) remains in chiefOfStaffOrchestrator.checkSpecialistEligibility().
 */
function selectSpecialists(intentScores: IntentScore[]): RegistrySpecialist[] {
  const seen = new Set<string>();
  const selected: RegistrySpecialist[] = [];

  for (const { capabilityCode } of intentScores.slice(0, 5)) {
    // Use canonical registry to get the eligibleRoles for this capability.
    const cap = getCapability(capabilityCode);
    if (!cap) {
      // Capability not in canonical registry — skip (legacy code no longer accepted)
      continue;
    }

    const eligibleRoles = cap.eligibleRoles ?? [];
    for (const roleCode of eligibleRoles) {
      // Resolve any deprecated alias first
      const resolvedCode = resolveSpecialistAlias(roleCode);
      if (seen.has(resolvedCode) || selected.length >= 4) continue;

      const specialist = getSpecialistByCode(resolvedCode)
        ?? SPECIALISTS.find(sp => sp.code === resolvedCode);
      if (!specialist) continue;

      // Sprint 29H Part A: Hard status gate — blocked statuses must never be dispatched.
      // This enforces the same boundary as UnifiedExecutionEngine's architectural guard
      // at the planning stage so dna_pending specialists are excluded from task plans.
      if (BLOCKED_EXECUTION_STATUSES.has(specialist.executionStatus)) continue;

      seen.add(resolvedCode);
      selected.push(specialist);
    }
  }

  return selected;
}

// ─── Approval determination ───────────────────────────────────────────────────

function determineApprovalType(specialists: RegistrySpecialist[]): ApprovalType {
  const priority: ApprovalType[] = [
    "platform_approval",
    "compliance_approval",
    "dual_approval",
    "owner_approval",
    "administrator_approval",
    "manager_approval",
    "no_approval",
  ];

  let highest: ApprovalType = "no_approval";
  for (const s of specialists) {
    const req = s.approvalRequirements as ApprovalType;
    if (priority.indexOf(req) < priority.indexOf(highest)) {
      highest = req;
    }
  }
  return highest;
}

// ─── Plan builder ─────────────────────────────────────────────────────────────

export function planTask(taskTitle: string, taskDescription?: string): TaskPlan {
  const inputText = `${taskTitle} ${taskDescription ?? ""}`;
  const intentScores = classifyIntent(inputText);
  const selectedSpecialists = selectSpecialists(intentScores);

  // Always include Chief of Staff as orchestrator if specialists were found
  const hasSpecialists = selectedSpecialists.length > 0;
  const cos = SPECIALISTS.find(s => s.code === "chief_of_staff")!;

  // Deduplicate: cos is always added first; selectSpecialists may also return it
  // if it is eligible for a matched capability (e.g. resource.locate).
  const _seenAssigned = new Set<string>();
  const allAssigned = [cos, ...selectedSpecialists].filter(s => {
    if (_seenAssigned.has(s.code)) return false;
    _seenAssigned.add(s.code);
    return true;
  });

  const approvalType = determineApprovalType(selectedSpecialists);
  const requiresApproval = approvalType !== "no_approval";

  const steps: ExecutionStep[] = [
    {
      stepNumber: 1,
      specialistCode: cos.code,
      specialistName: cos.displayName,
      action: "Analyse task intent and validate routing decision",
      estimatedDuration: "< 1 minute",
      requiresApproval: false,
    },
  ];

  selectedSpecialists.forEach((s, i) => {
    const topCapability = s.capabilities.find(cap =>
      intentScores.some(is => is.capabilityCode === cap)
    ) ?? s.capabilities[0] ?? "execute";

    const capObj = CAPABILITIES.find(c => c.code === topCapability);

    steps.push({
      stepNumber: i + 2,
      specialistCode: s.code,
      specialistName: s.displayName,
      action: capObj?.name ?? "Execute assigned task",
      estimatedDuration: "2–5 minutes",
      requiresApproval: s.approvalRequirements !== "no_approval",
    });
  });

  if (requiresApproval) {
    steps.push({
      stepNumber: steps.length + 1,
      specialistCode: "chief_of_staff",
      specialistName: "Chief of Staff",
      action: "Consolidate results and present for approval",
      estimatedDuration: "< 1 minute",
      requiresApproval: true,
    });
  }

  const totalMinutes = steps.length * 3;
  const estimatedDuration = totalMinutes <= 5
    ? "Under 5 minutes"
    : `${totalMinutes}–${totalMinutes + 5} minutes`;

  const topIntent = intentScores[0]?.capabilityCode ?? "general";
  const confidence = intentScores.length > 0
    ? Math.min(0.95, 0.5 + intentScores[0]!.score * 0.05)
    : 0.3;

  const reasoning = hasSpecialists
    ? `Matched intent '${topIntent}' to ${selectedSpecialists.length} specialist(s): ${selectedSpecialists.map(s => s.displayName).join(", ")}.`
    : "No specific capability match found. Routed to Chief of Staff for manual handling.";

  return {
    planId: randomUUID(),
    taskTitle,
    intent: topIntent,
    primarySpecialist: selectedSpecialists[0]?.code ?? "chief_of_staff",
    assignedSpecialists: allAssigned.map(s => s.code),
    steps,
    estimatedTotalDuration: estimatedDuration,
    requiresApproval,
    approvalType,
    confidence,
    reasoning,
  };
}
