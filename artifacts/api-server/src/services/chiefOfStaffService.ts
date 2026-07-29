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
  resolveAlias,
  type RegistrySpecialist,
} from "../lib/workforceRegistry.js";
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

const ROUTING_RULES: RouteRule[] = [
  // Compliance
  { keywords: ["compliance", "audit", "ndis", "regulatory", "regulation"], capabilities: ["audit_preparation", "review_policy"], weight: 10 },
  { keywords: ["policy", "policies"], capabilities: ["review_policy", "draft_policy"], weight: 9 },
  { keywords: ["incident", "accident", "injury", "near miss", "safeguard"], capabilities: ["review_incident", "corrective_action"], weight: 10 },
  { keywords: ["restrictive practice", "restrictive", "behaviour support", "bsp"], capabilities: ["restrictive_practice_review"], weight: 10 },
  { keywords: ["quality", "standard", "benchmark"], capabilities: ["quality_review"], weight: 8 },
  { keywords: ["corrective action", "improvement", "non-conformance"], capabilities: ["corrective_action"], weight: 9 },
  // Operations
  { keywords: ["roster", "shift", "schedule", "scheduling", "staff allocation"], capabilities: ["review_roster"], weight: 9 },
  { keywords: ["workflow", "process", "procedure", "sop"], capabilities: ["create_workflow"], weight: 8 },
  { keywords: ["capacity", "resource", "staffing level", "headcount"], capabilities: ["capacity_analysis"], weight: 8 },
  { keywords: ["service delivery", "participant", "support coordination"], capabilities: ["service_delivery_review"], weight: 8 },
  { keywords: ["asset", "equipment", "vehicle", "property", "maintenance"], capabilities: ["asset_management"], weight: 7 },
  // Finance
  { keywords: ["invoice", "invoicing", "claim", "billing"], capabilities: ["review_invoice"], weight: 9 },
  { keywords: ["payroll", "pay run", "wages", "salary", "award"], capabilities: ["payroll_review"], weight: 9 },
  { keywords: ["budget", "spending", "expenditure", "variance"], capabilities: ["budget_summary"], weight: 8 },
  { keywords: ["financial report", "financial statement", "p&l", "profit", "loss"], capabilities: ["financial_reporting"], weight: 8 },
  { keywords: ["accounts", "reconciliation", "bank", "reconcile"], capabilities: ["accounts_reconciliation"], weight: 7 },
  // HR
  { keywords: ["recruit", "hiring", "job ad", "candidate", "interview"], capabilities: ["recruitment_support"], weight: 9 },
  { keywords: ["performance review", "performance", "kpi", "goal setting"], capabilities: ["performance_review"], weight: 8 },
  { keywords: ["training", "learning", "development", "certification", "cpd"], capabilities: ["learning_coordination"], weight: 8 },
  { keywords: ["worker screening", "wwcc", "police check", "credential", "clearance"], capabilities: ["staff_compliance_check"], weight: 9 },
  { keywords: ["hr policy", "leave", "workplace", "employee relations"], capabilities: ["hr_policy_review"], weight: 7 },
  // Marketing
  { keywords: ["campaign", "marketing campaign", "promotion"], capabilities: ["campaign_planning"], weight: 8 },
  { keywords: ["content", "blog", "article", "copy"], capabilities: ["content_strategy"], weight: 7 },
  { keywords: ["brand", "branding", "logo", "identity"], capabilities: ["brand_management"], weight: 7 },
  { keywords: ["social media", "facebook", "instagram", "linkedin", "twitter"], capabilities: ["social_media"], weight: 8 },
  { keywords: ["marketing report", "roi", "analytics"], capabilities: ["marketing_reporting"], weight: 6 },
  // Generic
  { keywords: ["document", "report", "draft", "write", "template"], capabilities: ["draft_document"], weight: 5 },
  { keywords: ["research", "analyse", "analysis", "investigate", "find out"], capabilities: ["research"], weight: 5 },
  { keywords: ["email", "letter", "message", "communicate", "notify"], capabilities: ["draft_communication"], weight: 5 },
  { keywords: ["meeting", "appointment", "calendar", "book"], capabilities: ["manage_calendar", "schedule_meeting"], weight: 5 },
  { keywords: ["summarise", "summary", "overview", "brief"], capabilities: ["summarise"], weight: 4 },
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

// ─── Specialist selection ─────────────────────────────────────────────────────

function selectSpecialists(intentScores: IntentScore[]): RegistrySpecialist[] {
  const seen = new Set<string>();
  const selected: RegistrySpecialist[] = [];

  for (const { capabilityCode } of intentScores.slice(0, 5)) {
    const specialists = getSpecialistsByCapability(capabilityCode)
      .filter(s => s.executionStatus === "available" || s.executionStatus === "beta");
      // Sprint 11: Full async eligibility enforcement happens in chiefOfStaffOrchestrator.
      // planTask() uses the workforce registry for intent routing only.
      // Deprecated role codes are resolved via resolveSpecialistAlias before dispatch.

    for (const s of specialists) {
      // Resolve alias: if this role has been deprecated, route to its replacement
      const resolvedCode = resolveSpecialistAlias(s.code);
      if (!seen.has(resolvedCode) && selected.length < 4) {
        seen.add(resolvedCode);
        // Use the resolved specialist if different, otherwise use original
        const resolvedSpecialist = resolvedCode !== s.code
          ? (SPECIALISTS.find(sp => sp.code === resolvedCode) ?? s)
          : s;
        selected.push(resolvedSpecialist);
      }
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

  const allAssigned = hasSpecialists
    ? [cos, ...selectedSpecialists]
    : [cos];

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
