/**
 * Specialist Work Package Service — Sprint 9.5
 *
 * Builds and validates work packages for specialist runs.
 * The Chief of Staff orchestrator creates work packages.
 * Deterministic validation must approve before the specialist receives it.
 *
 * Security:
 * - Work packages do NOT contain full tenant memory
 * - Work packages do NOT contain full conversation history
 * - Context is filtered to what is relevant and authorised for this specialist
 */

import { randomUUID } from "crypto";
import { getCapability, isLevelSupported, type CapabilityLevel } from "../lib/capabilityRegistry.js";
import { getSpecialistByCode } from "../lib/workforceRegistry.js";
import { getWorkerProfileByCode } from "../lib/workerProfileRegistry.js";
import { logOrgEvent } from "./auditService.js";
import type { SpecialistWorkPackage } from "./specialistIntelligenceService.js";

export type { SpecialistWorkPackage };

// ─── SpecialistPlanStep ────────────────────────────────────────────────────────

export interface SpecialistPlanStep {
  id: string;
  capabilityCode: string;
  workforceRoleCode: string;
  workerProfileCode: string;
  dependsOn: string[]; // step IDs that must complete first
  parallelGroup?: string; // steps with same parallelGroup can run concurrently
  failurePolicy: "fail_task" | "skip" | "require_clarification";
  status: "pending" | "ready" | "running" | "completed" | "failed" | "skipped";
}

export interface SpecialistPlan {
  planId: string;
  taskId: string;
  organizationId: string;
  steps: SpecialistPlanStep[];
  createdAt: string;
}

// ─── Work package builder ──────────────────────────────────────────────────────

export interface BuildWorkPackageInput {
  specialistRunId: string;
  organizationId: string;
  conversationId?: string;
  taskId: string;
  taskTitle: string;
  taskDescription?: string;
  capabilityCode: string;
  capabilityLevel: CapabilityLevel;
  workforceRoleCode: string;
  workerProfileCode: string;
  /** Approved org memory items relevant to this run */
  approvedMemory?: Array<{ id: string; content: string; category: string }>;
  /** Recent conversation messages relevant to this task */
  conversationContext?: Array<{ id: string; role: string; content: string }>;
  /** Task-related context items */
  taskContext?: Array<{ id: string; type: string; content: string }>;
  /** Outputs from dependency runs */
  previousOutputs?: Array<{ specialistRunId: string; role: string; summary: string }>;
  /** Dependency run IDs and what outputs are needed */
  dependencies?: Array<{ specialistRunId: string; requiredOutput: string }>;
  /** Current unresolved questions */
  unresolvedQuestions?: string[];
  /** Existing assumptions */
  assumptions?: string[];
  /** How long the work package remains valid */
  expiryMinutes?: number;
}

/**
 * Builds a validated work package for a specialist run.
 * Throws if the package cannot be built (unknown capability, specialist, or profile).
 */
export async function buildWorkPackage(
  input: BuildWorkPackageInput,
): Promise<SpecialistWorkPackage> {
  // Validate inputs
  const cap = getCapability(input.capabilityCode);
  if (!cap) throw new Error(`Unknown capability: ${input.capabilityCode}`);
  if (!isLevelSupported(cap, input.capabilityLevel)) {
    throw new Error(`Capability ${input.capabilityCode} does not support level ${input.capabilityLevel}`);
  }

  const specialist = getSpecialistByCode(input.workforceRoleCode);
  if (!specialist) throw new Error(`Unknown specialist: ${input.workforceRoleCode}`);

  const profile = getWorkerProfileByCode(input.workerProfileCode);
  if (!profile) throw new Error(`Unknown worker profile: ${input.workerProfileCode}`);

  // Build objective from task title and capability
  const objective = `${cap.displayName}: ${input.taskTitle}${input.taskDescription ? `\n\nContext: ${input.taskDescription}` : ""}`;

  // Role-specific responsibilities based on capability
  const responsibilities = buildResponsibilities(input.capabilityCode, input.workforceRoleCode, input.capabilityLevel);

  // Expected outputs based on capability level
  const expectedOutputs = buildExpectedOutputs(input.capabilityCode, input.capabilityLevel);

  // Allowed capabilities = the sprint 9.4 registry capability code
  const allowedCapabilities = [input.capabilityCode];

  // Allowed tools from the worker profile
  const allowedTools = profile.allowedToolCategories as string[];
  const allowedConnectorCategories = profile.allowedConnectorCategories as string[];
  const allowedExecutionChannels = profile.allowedExecutionChannels as string[];

  // Execution-level restrictions from the profile
  const prohibitedActions = [...profile.prohibitedActions];
  const approvalRequiredActions = [...profile.approvalRequiredActions];

  // For non-execution levels, further restrict
  if (input.capabilityLevel === "general_information") {
    prohibitedActions.push("Access organisation records or databases");
    prohibitedActions.push("Use any execution channels");
    prohibitedActions.push("Retrieve or store customer data");
  } else if (input.capabilityLevel === "professional_analysis") {
    prohibitedActions.push("Submit or execute actions in external systems");
    prohibitedActions.push("Send communications to third parties");
  }

  const expiresAt = new Date(
    Date.now() + (input.expiryMinutes ?? 60) * 60 * 1000,
  ).toISOString();

  const pkg: SpecialistWorkPackage = {
    specialistRunId: input.specialistRunId,
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    taskId: input.taskId,
    capabilityCode: input.capabilityCode,
    capabilityLevel: input.capabilityLevel,
    workforceRoleCode: input.workforceRoleCode,
    workerProfileCode: input.workerProfileCode,
    objective,
    responsibilities,
    expectedOutputs,
    approvedOrganisationMemory: input.approvedMemory ?? [],
    relevantConversationContext: input.conversationContext ?? [],
    taskContext: input.taskContext ?? [],
    previousSpecialistOutputs: input.previousOutputs ?? [],
    allowedCapabilities,
    allowedTools,
    allowedConnectorCategories,
    allowedExecutionChannels,
    prohibitedActions,
    approvalRequiredActions,
    dependencies: input.dependencies ?? [],
    assumptions: input.assumptions ?? [],
    unresolvedQuestions: input.unresolvedQuestions ?? [],
    riskLevel: cap.defaultRiskLevel ?? "medium",
    expiresAt,
  };

  await validateWorkPackage(pkg);

  await logOrgEvent({
    eventType: "specialist.work_package_created",
    organizationId: input.organizationId,
    actorType: "system",
    resourceType: "specialist_run",
    resourceId: input.specialistRunId,
    metadata: {
      capabilityCode: input.capabilityCode,
      level: input.capabilityLevel,
      workforceRoleCode: input.workforceRoleCode,
      workerProfileCode: input.workerProfileCode,
      dependencyCount: (input.dependencies ?? []).length,
    },
  });

  return pkg;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface WorkPackageValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Deterministic validation of a work package before it is sent to a specialist.
 * Throws on critical errors; returns validation result for warnings.
 */
export async function validateWorkPackage(
  pkg: SpecialistWorkPackage,
): Promise<WorkPackageValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!pkg.specialistRunId) errors.push("specialistRunId is required");
  if (!pkg.organizationId) errors.push("organizationId is required");
  if (!pkg.taskId) errors.push("taskId is required");
  if (!pkg.capabilityCode) errors.push("capabilityCode is required");
  if (!pkg.workforceRoleCode) errors.push("workforceRoleCode is required");
  if (!pkg.workerProfileCode) errors.push("workerProfileCode is required");
  if (!pkg.objective) errors.push("objective is required");

  // Security checks
  if (pkg.approvedOrganisationMemory.length > 50) {
    warnings.push("Work package contains more than 50 memory items — consider reducing for performance");
  }
  if (pkg.relevantConversationContext.length > 100) {
    warnings.push("Work package contains more than 100 conversation messages — truncating to last 100 is recommended");
  }

  // Expiry check
  const expiresAt = new Date(pkg.expiresAt);
  if (expiresAt <= new Date()) {
    errors.push("Work package has already expired");
  }

  // Dependency sanity
  for (const dep of pkg.dependencies) {
    if (!dep.specialistRunId) errors.push("Dependency is missing specialistRunId");
    if (!dep.requiredOutput) errors.push("Dependency is missing requiredOutput description");
  }

  if (errors.length > 0) {
    throw new Error(`Work package validation failed: ${errors.join("; ")}`);
  }

  return { valid: true, errors: [], warnings };
}

// ─── Specialists plan builder ──────────────────────────────────────────────────

/**
 * Build a specialist execution plan from capability assignments.
 * Determines which steps can run in parallel and which must wait.
 */
export function buildSpecialistPlan(
  taskId: string,
  organizationId: string,
  assignments: Array<{
    capabilityCode: string;
    workforceRoleCode: string;
    workerProfileCode: string;
    dependsOnCapabilities?: string[];
    parallelGroup?: string;
    failurePolicy?: SpecialistPlanStep["failurePolicy"];
  }>,
): SpecialistPlan {
  const stepIds = assignments.map(() => randomUUID());

  const steps: SpecialistPlanStep[] = assignments.map((a, i) => ({
    id: stepIds[i]!,
    capabilityCode: a.capabilityCode,
    workforceRoleCode: a.workforceRoleCode,
    workerProfileCode: a.workerProfileCode,
    dependsOn: (a.dependsOnCapabilities ?? []).flatMap(depCap => {
      // Find step IDs that match the required capability
      return stepIds.filter((_, j) => assignments[j]?.capabilityCode === depCap);
    }),
    parallelGroup: a.parallelGroup,
    failurePolicy: a.failurePolicy ?? "fail_task",
    status: "pending",
  }));

  return { planId: randomUUID(), taskId, organizationId, steps, createdAt: new Date().toISOString() };
}

/**
 * Returns steps that are ready to run (all dependencies completed).
 */
export function getReadySteps(plan: SpecialistPlan): SpecialistPlanStep[] {
  const completedIds = new Set(
    plan.steps.filter(s => s.status === "completed").map(s => s.id),
  );
  return plan.steps.filter(s => {
    if (s.status !== "pending") return false;
    return s.dependsOn.every(depId => completedIds.has(depId));
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildResponsibilities(
  capabilityCode: string,
  roleCode: string,
  level: CapabilityLevel,
): string[] {
  const cap = getCapability(capabilityCode);
  const base = cap?.description ?? "Perform the assigned task";

  const levelResponsibilities: Record<CapabilityLevel, string[]> = {
    general_information: [
      `Provide general information about: ${base}`,
      "Answer educational questions without accessing organisation records",
      "Reference relevant regulations or standards where applicable",
    ],
    professional_analysis: [
      `Analyse organisational records for: ${base}`,
      "Identify gaps, risks, and improvement opportunities",
      "Produce structured findings with evidence references",
      "Provide specific, actionable recommendations",
    ],
    execution: [
      `Prepare an execution package for: ${base}`,
      "Identify all required external actions",
      "Specify approval requirements for each action",
      "Validate that all prerequisites are met before requesting execution",
    ],
  };

  return levelResponsibilities[level] ?? [`Execute: ${base}`];
}

function buildExpectedOutputs(capabilityCode: string, level: CapabilityLevel): string[] {
  const base: Record<CapabilityLevel, string[]> = {
    general_information: [
      "Summary answer to the question",
      "Relevant regulatory references",
      "Recommended next steps for further investigation",
    ],
    professional_analysis: [
      "Structured findings with severity and confidence",
      "Evidence-referenced recommendations",
      "Risk register",
      "Unresolved questions requiring human input",
    ],
    execution: [
      "Validated execution package ready for OpenClaw submission",
      "Approved action list with risk levels",
      "Approval requirements documented",
      "Rollback considerations",
    ],
  };
  return base[level] ?? ["Structured analysis output"];
}
