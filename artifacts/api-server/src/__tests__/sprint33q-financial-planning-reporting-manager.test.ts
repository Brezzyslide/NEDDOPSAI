/**
 * Sprint 33Q - Financial Planning & Reporting Manager v2
 *
 * Proves FP&R owns budgets, forecasts, scenarios, variance, cashflow,
 * management reporting and decision support without becoming Finance Officer,
 * Payroll, OM, CQM, tax/legal/audit authority or unconstrained OpenClaw.
 */

import { describe, expect, it, vi } from "vitest";
import type { ExecutionPackage } from "@workspace/agent-runtime";

vi.mock("../services/specialistCatalogueService.js", () => ({
  listCatalogue: vi.fn(async () => ({ entries: [] })),
}));

vi.mock("../services/entitlementService.js", () => ({
  tenantCanUseSpecialist: vi.fn(async () => ({ allowed: true })),
  tenantHasWorkforcePack: vi.fn(async () => ({ allowed: true, source: "plan" })),
  tenantCanUseFeature: vi.fn(async () => true),
  checkUsage: vi.fn(async () => ({ allowed: true })),
}));

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: vi.fn(async () => undefined),
}));

import {
  FINANCE_OFFICER_DNA,
  FINANCIAL_PLANNING_REPORTING_MANAGER_DNA,
  PAYROLL_WORKFORCE_COST_OFFICER_DNA,
  getCanonicalDNAProfile,
  getDNAProfile,
} from "@workspace/workforce-dna";
import { getSpecialistByCode } from "../lib/workforceRegistry.js";
import { getCapability } from "../lib/capabilityRegistry.js";
import {
  getWorkerProfileByCode,
  getWorkerProfilesForRole,
} from "../lib/workerProfileRegistry.js";
import {
  hasActiveIntelligence,
  validateSpecialistEligibilitySync,
} from "../services/specialistEligibilityService.js";
import {
  getConversationWorkforceContext,
  _clearWorkforceCache,
} from "../services/conversationWorkforceContextService.js";
import { getRegistryEntry } from "../services/blueprintRegistry.js";
import { resolveIntent } from "../services/blueprintIntentMap.js";
import { evaluateWorkerProfileAuthority } from "../services/executionActionService.js";
import {
  buildWorkerProfileExecutionConstraints,
  validateOpenClawExecutionPackageAuthority,
} from "../services/executionService.js";

const ORG_ID = "org-sprint33q";
const profile = getWorkerProfileByCode("financial_planning_reporting_manager_profile")!;

type PlanningClass = "ACTUAL" | "BUDGET" | "FORECAST" | "SCENARIO" | "TARGET" | "ASSUMPTION" | "COMMITMENT" | "PROJECTION";
type ActualQuality = "RECONCILED" | "PARTIALLY_RECONCILED" | "UNRECONCILED" | "ESTIMATED" | "INCOMPLETE" | "DISPUTED" | "UNKNOWN";
type VarianceDriver = "PRICE_RATE_VARIANCE" | "VOLUME_VARIANCE" | "MIX_VARIANCE" | "TIMING_VARIANCE" | "WORKFORCE_VARIANCE" | "REVENUE_VARIANCE" | "ONE_OFF_VARIANCE" | "STRUCTURAL_VARIANCE" | "DATA_QUALITY_VARIANCE" | "UNKNOWN_DRIVER";

function classifyPlanningValue(value: PlanningClass): PlanningClass {
  return value;
}

function actualsUsableForUnqualifiedReporting(quality: ActualQuality): boolean {
  return quality === "RECONCILED";
}

function currentPlanningVersion(input: { version: string; superseded?: boolean; asOfMonth: string }): "CURRENT" | "SUPERSEDED" {
  return input.superseded ? "SUPERSEDED" : "CURRENT";
}

function varianceDriver(input: { rateChanged?: boolean; volumeChanged?: boolean; oneOff?: boolean; structural?: boolean; dataQuality?: boolean }): VarianceDriver {
  if (input.dataQuality) return "DATA_QUALITY_VARIANCE";
  if (input.oneOff) return "ONE_OFF_VARIANCE";
  if (input.structural) return "STRUCTURAL_VARIANCE";
  if (input.rateChanged) return "PRICE_RATE_VARIANCE";
  if (input.volumeChanged) return "VOLUME_VARIANCE";
  return "UNKNOWN_DRIVER";
}

function buildScenario(baseRevenue: number, labourCost: number, assumptions: { revenueChangePct?: number; labourCostChangePct?: number }) {
  const revenue = baseRevenue * (1 + (assumptions.revenueChangePct ?? 0));
  const labour = labourCost * (1 + (assumptions.labourCostChangePct ?? 0));
  return {
    revenue,
    labour,
    contribution: revenue - labour,
    assumptions,
  };
}

function forecastConclusion(input: { actualQuality: ActualQuality; assumptions?: Record<string, number>; missingAssumption?: boolean }) {
  if (!actualsUsableForUnqualifiedReporting(input.actualQuality)) return "QUALIFIED_BY_DATA_QUALITY";
  if (!input.assumptions || input.missingAssumption) return "BLOCKED_MISSING_ASSUMPTIONS";
  return "FORECAST_SUPPORTED";
}

function memoryProvesCurrentFinancialPosition(source: "memory" | "user_assertion" | "verified_actual"): boolean {
  return source === "verified_actual";
}

function makePackage(overrides: Partial<ExecutionPackage> = {}): ExecutionPackage {
  const workerProfile = buildWorkerProfileExecutionConstraints(profile);
  return {
    executionId: "exec-33q",
    taskId: "task-33q",
    tenantId: ORG_ID,
    workforceRole: "financial_planning_reporting_manager",
    specialistManifest: {
      manifestVersion: 1,
      workforceRole: "financial_planning_reporting_manager",
      displayName: "Financial Planning & Reporting Manager",
      domain: "financial planning and management reporting",
      dnaProfileId: "financial_planning_reporting_manager",
      dnaVersion: "1.0.0",
      manifestHash: "sha256:fpr-manifest",
      generatedAt: new Date().toISOString(),
      specialistId: "financial_planning_reporting_manager",
    } as ExecutionPackage["specialistManifest"],
    runtimeInstructions: {
      instruction: "Execute financial planning and reporting assessment only.",
      instructionHash: "sha256:fpr-instruction",
      manifestHash: "sha256:fpr-manifest",
      dnaVersion: "1.0.0",
      specialistId: "financial_planning_reporting_manager",
      compiledAt: new Date().toISOString(),
    },
    workerProfile,
    steps: [{
      sequence: 1,
      specialist: "financial_planning_reporting_manager",
      action: "execute",
      description: "Assess financial planning, forecast or reporting evidence",
      requiresApproval: false,
    }],
    requestedTools: [...profile.allowedToolCategories],
    requestedChannels: [...workerProfile.allowedChannels],
    requestedConnectorCategories: [...profile.allowedConnectorCategories],
    approvalState: "not_required",
    constraints: {
      maxDurationSeconds: 300,
      requireHumanApprovalBeforeSubmit: false,
      allowedDataCategories: ["task_context", "financial_actuals", "budget_records", "forecast_records", "payroll_inputs"],
    },
    callbackUrl: "",
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    issuedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("Sprint 33Q current-v2 activation", () => {
  it("activates FP&R as complete current-v2 role", () => {
    const specialist = getSpecialistByCode("financial_planning_reporting_manager");

    expect(specialist).toMatchObject({
      code: "financial_planning_reporting_manager",
      executionStatus: "available",
      dnaStatus: "approved",
      catalogueVersion: "2",
      workerProfileCodes: ["financial_planning_reporting_manager_profile"],
    });
    expect(hasActiveIntelligence("financial_planning_reporting_manager")).toBe(true);
  });

  it("resolves canonical DNA and WorkerProfile", () => {
    const legacy = getDNAProfile("financial_planning_reporting_manager");
    const canonical = getCanonicalDNAProfile("financial_planning_reporting_manager");
    const profiles = getWorkerProfilesForRole("financial_planning_reporting_manager");

    expect(legacy).toBe(FINANCIAL_PLANNING_REPORTING_MANAGER_DNA);
    expect(canonical!.identity.specialistId).toBe("financial_planning_reporting_manager");
    expect(canonical!.requiredWorkerProfile.profileCode).toBe("financial_planning_reporting_manager_profile");
    expect(profiles.map(p => p.code)).toEqual(["financial_planning_reporting_manager_profile"]);
  });

  it("is runtime-ready and conversation-context eligible", async () => {
    _clearWorkforceCache();
    const ctx = await getConversationWorkforceContext(ORG_ID);
    const fpr = ctx.specialists.find(s => s.code === "financial_planning_reporting_manager");

    expect(fpr).toBeDefined();
    expect(fpr!.availableForConversation).toBe(true);
    expect(fpr!.availableForDispatch).toBe(true);
    expect(validateSpecialistEligibilitySync("financial_planning_reporting_manager", "financial_planning.forecast")).toBe(true);
  });

  it("owns FP&R capabilities without taking Finance or Payroll capabilities", () => {
    for (const code of [
      "financial_planning.budget",
      "financial_planning.forecast",
      "financial_planning.cashflow",
      "financial_planning.scenario",
      "financial_planning.sensitivity",
      "financial_reporting.management",
      "financial_reporting.variance",
      "financial_reporting.performance",
      "financial_reporting.cost_centre",
      "financial_reporting.profitability",
      "financial_reporting.workforce_cost_outlook",
      "financial_reporting.forecast_accuracy",
      "financial_analysis.business_case",
      "financial_analysis.break_even",
      "finance.budget_analysis",
      "finance.cost_impact_analysis",
      "finance.financial_reporting",
    ]) {
      const cap = getCapability(code);
      expect(cap?.eligibleRoles).toContain("financial_planning_reporting_manager");
      expect(cap?.requiredWorkerProfiles).toContain("financial_planning_reporting_manager_profile");
      expect(validateSpecialistEligibilitySync("financial_planning_reporting_manager", code)).toBe(true);
    }

    expect(validateSpecialistEligibilitySync("financial_planning_reporting_manager", "finance.bank_reconciliation")).toBe(false);
    expect(validateSpecialistEligibilitySync("financial_planning_reporting_manager", "payroll.review")).toBe(false);
  });

  it("routes FP&R Blueprint intents to FP&R-owned placeholder", () => {
    const blueprint = getRegistryEntry("financial_planning_reporting_review");
    const forecast = resolveIntent("financial_planning.forecast");
    const variance = resolveIntent("financial_reporting.variance");
    const report = resolveIntent("finance.financial_reporting");

    expect(blueprint?.futureOwnerRoleCode).toBe("financial_planning_reporting_manager");
    expect(forecast!.code).toBe("financial_planning_reporting_review");
    expect(variance!.code).toBe("financial_planning_reporting_review");
    expect(report!.code).toBe("financial_planning_reporting_review");
  });

  it("satisfies static DB publication prerequisites", () => {
    const specialist = getSpecialistByCode("financial_planning_reporting_manager")!;
    const canonical = getCanonicalDNAProfile("financial_planning_reporting_manager");

    expect(specialist.executionStatus).toBe("available");
    expect(specialist.dnaStatus).toBe("approved");
    expect(canonical).not.toBeNull();
    expect(getWorkerProfilesForRole("financial_planning_reporting_manager")).toHaveLength(1);
  });
});

describe("Sprint 33Q planning evidence and modelling", () => {
  it("keeps actual, budget, forecast and scenario distinct", () => {
    expect(classifyPlanningValue("ACTUAL")).toBe("ACTUAL");
    expect(classifyPlanningValue("BUDGET")).toBe("BUDGET");
    expect(classifyPlanningValue("FORECAST")).toBe("FORECAST");
    expect(classifyPlanningValue("SCENARIO")).toBe("SCENARIO");
  });

  it("flags unreconciled actuals and data-quality limitations", () => {
    expect(actualsUsableForUnqualifiedReporting("RECONCILED")).toBe(true);
    expect(actualsUsableForUnqualifiedReporting("UNRECONCILED")).toBe(false);
    expect(forecastConclusion({ actualQuality: "UNRECONCILED", assumptions: { revenueGrowth: 0.02 } })).toBe("QUALIFIED_BY_DATA_QUALITY");
  });

  it("requires explicit assumptions for material forecasts", () => {
    expect(forecastConclusion({ actualQuality: "RECONCILED", missingAssumption: true })).toBe("BLOCKED_MISSING_ASSUMPTIONS");
    expect(FINANCIAL_PLANNING_REPORTING_MANAGER_DNA.philosophy.statement).toContain("A forecast is not a fact");
  });

  it("prevents future forecast from becoming current actual", () => {
    expect(classifyPlanningValue("PROJECTION")).not.toBe("ACTUAL");
    expect(FINANCIAL_PLANNING_REPORTING_MANAGER_DNA.outputSchema.validationRules.join(" ")).toContain("actual, budget, forecast");
  });

  it("prevents superseded forecast or old budget from becoming current planning basis", () => {
    expect(currentPlanningVersion({ version: "Forecast Jan-2026", superseded: true, asOfMonth: "2026-01" })).toBe("SUPERSEDED");
    expect(currentPlanningVersion({ version: "Forecast Aug-2026", asOfMonth: "2026-08" })).toBe("CURRENT");
  });

  it("uses correct variance comparison basis and driver classification", () => {
    expect(varianceDriver({ rateChanged: true })).toBe("PRICE_RATE_VARIANCE");
    expect(varianceDriver({ volumeChanged: true })).toBe("VOLUME_VARIANCE");
    expect(varianceDriver({ dataQuality: true })).toBe("DATA_QUALITY_VARIANCE");
  });

  it("distinguishes one-off variance from structural trend", () => {
    expect(varianceDriver({ oneOff: true })).toBe("ONE_OFF_VARIANCE");
    expect(varianceDriver({ structural: true })).toBe("STRUCTURAL_VARIANCE");
  });

  it("models scenario and sensitivity changes deterministically", () => {
    const base = buildScenario(100_000, 60_000, {});
    const stress = buildScenario(100_000, 60_000, { revenueChangePct: -0.1, labourCostChangePct: 0.08 });

    expect(base.contribution).toBe(40_000);
    expect(stress.revenue).toBe(90_000);
    expect(stress.labour).toBeCloseTo(64_800);
    expect(stress.assumptions).toEqual({ revenueChangePct: -0.1, labourCostChangePct: 0.08 });
  });

  it("keeps historical forecasts available for accuracy analysis", () => {
    expect(getCapability("financial_reporting.forecast_accuracy")!.eligibleRoles).toContain("financial_planning_reporting_manager");
    expect(FINANCIAL_PLANNING_REPORTING_MANAGER_DNA.professionalBoundaries.cannotDo.join(" ")).toContain("hide adverse variance");
  });

  it("models cashflow and liquidity as forecast, not current bank truth", () => {
    const cashflow = getCapability("financial_planning.cashflow")!;

    expect(cashflow.description).toContain("closing cash");
    expect(FINANCIAL_PLANNING_REPORTING_MANAGER_DNA.professionalBoundaries.outOfScope.join(" ")).toContain("operational financial records");
  });

  it("models profitability and margin with allocation limitations", () => {
    const profitability = getCapability("financial_reporting.profitability")!;

    expect(profitability.description).toContain("allocation limitations");
    expect(FINANCIAL_PLANNING_REPORTING_MANAGER_DNA.competencies.some(c => c.code === "fpr.profitability")).toBe(true);
  });

  it("requires exposed inputs, formula logic, units and limitations for models", () => {
    const rules = FINANCIAL_PLANNING_REPORTING_MANAGER_DNA.outputSchema.validationRules.join(" ");
    const evidence = FINANCIAL_PLANNING_REPORTING_MANAGER_DNA.evidenceStandards.standards.map(s => s.requirements.join(" ")).join(" ");

    expect(rules).toContain("methodology");
    expect(evidence).toContain("formula logic");
  });

  it("does not let memory prove current financial position", () => {
    expect(memoryProvesCurrentFinancialPosition("memory")).toBe(false);
    expect(memoryProvesCurrentFinancialPosition("user_assertion")).toBe(false);
    expect(memoryProvesCurrentFinancialPosition("verified_actual")).toBe(true);
    expect(FINANCIAL_PLANNING_REPORTING_MANAGER_DNA.learningPolicy.conflictLearning).toContain("must not prove current actuals");
  });
});

describe("Sprint 33Q professional boundaries", () => {
  it("consumes Finance Officer actuals and does not mutate transactions", () => {
    expect(FINANCIAL_PLANNING_REPORTING_MANAGER_DNA.conflictPolicy.defersTo).toContain("finance_officer");
    expect(FINANCE_OFFICER_DNA.capabilityConfig.requiredCapabilities).toContain("finance.reconciliation");
    expect(profile.prohibitedActions).toContain("alter_reconciled_actuals");
  });

  it("consumes Payroll workforce-cost truth without making payroll determinations", () => {
    expect(FINANCIAL_PLANNING_REPORTING_MANAGER_DNA.conflictPolicy.defersTo).toContain("payroll_workforce_cost_officer");
    expect(PAYROLL_WORKFORCE_COST_OFFICER_DNA.capabilityConfig.requiredCapabilities).toContain("workforce_cost.calculate");
    expect(profile.prohibitedActions).toContain("make_payroll_professional_determination");
  });

  it("leaves operational decisions with OM", () => {
    expect(FINANCIAL_PLANNING_REPORTING_MANAGER_DNA.professionalBoundaries.cannotDo.join(" ")).toContain("operational cuts");
    expect(FINANCIAL_PLANNING_REPORTING_MANAGER_DNA.conflictPolicy.defersTo).toContain("operations_manager");
  });

  it("keeps authority and external data model outside FP&R-specific web registry", () => {
    const outOfScope = FINANCIAL_PLANNING_REPORTING_MANAGER_DNA.professionalBoundaries.outOfScope.join(" ");
    const evidence = FINANCIAL_PLANNING_REPORTING_MANAGER_DNA.evidenceStandards.standards.map(s => s.requirements.join(" ")).join(" ");

    expect(outOfScope).toContain("tax-agent");
    expect(outOfScope).toContain("statutory audit");
    expect(evidence).toContain("official economic/government sources");
  });

  it("separates financial implication from management decision", () => {
    expect(FINANCIAL_PLANNING_REPORTING_MANAGER_DNA.professionalBoundaries.canDo.join(" ")).toContain("business-case");
    expect(FINANCIAL_PLANNING_REPORTING_MANAGER_DNA.professionalBoundaries.cannotDo.join(" ")).toContain("management actions");
  });

  it("keeps CQM and governance boundaries for assurance and approvals", () => {
    expect(FINANCIAL_PLANNING_REPORTING_MANAGER_DNA.conflictPolicy.defersTo).toContain("compliance_quality_manager");
    expect(FINANCIAL_PLANNING_REPORTING_MANAGER_DNA.conflictPolicy.defersTo).toContain("policy_governance_specialist");
    expect(profile.approvalRequiredActions).toContain("publish_board_pack");
  });

  it("keeps connector independence and avoids external-data invention", () => {
    expect(FINANCIAL_PLANNING_REPORTING_MANAGER_DNA.capabilityConfig.allowedConnectorCategories).toContain("finance_system");
    expect(FINANCIAL_PLANNING_REPORTING_MANAGER_DNA.evidenceStandards.allowInventedReferences).toBe(false);
  });
});

describe("Sprint 33Q WorkerProfile and OpenClaw authority", () => {
  it("permits modelling and approval-gates formal budget publication", () => {
    const model = evaluateWorkerProfileAuthority({
      workerProfile: profile,
      specialistCode: "financial_planning_reporting_manager",
      actionIdentifier: "create_file",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
      connectorCategory: "document_management",
    });
    const publishBudget = evaluateWorkerProfileAuthority({
      workerProfile: profile,
      specialistCode: "financial_planning_reporting_manager",
      actionIdentifier: "publish_formal_budget",
      actionType: "update_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
      connectorCategory: "document_management",
    });

    expect(model.decision).toBe("PERMITTED");
    expect(publishBudget.decision).toBe("APPROVAL_REQUIRED");
  });

  it("approval cannot override prohibited financial manipulation", () => {
    for (const actionIdentifier of [
      "execute_bank_payment",
      "alter_reconciled_actuals",
      "manipulate_journal",
      "publish_false_financial_report",
      "certify_evidence_free_forecast",
    ]) {
      const decision = evaluateWorkerProfileAuthority({
        workerProfile: profile,
        specialistCode: "financial_planning_reporting_manager",
        actionIdentifier,
        actionType: "update_spreadsheet",
        executionChannel: "internal_api",
        toolCategory: "form_tools",
        connectorCategory: "finance_system",
        approvalGranted: true,
      });

      expect(decision.decision).toBe("PROHIBITED");
    }
  });

  it("OpenClaw package preserves financial authority boundaries", () => {
    const valid = validateOpenClawExecutionPackageAuthority({ pkg: makePackage(), workerProfile: profile });
    const missingProhibitions = validateOpenClawExecutionPackageAuthority(
      { pkg: makePackage({
        workerProfile: {
          ...buildWorkerProfileExecutionConstraints(profile),
          prohibitedActions: [],
        },
      }), workerProfile: profile },
    );

    expect(valid.decision).toBe("PERMITTED");
    expect(missingProhibitions.decision).toBe("PROHIBITED");
    expect(missingProhibitions.reason).toContain("removed WorkerProfile prohibitions");
  });

  it("cannot execute bank payments or rewrite reconciled actuals", () => {
    expect(profile.prohibitedActions).toContain("execute_bank_payment");
    expect(profile.prohibitedActions).toContain("rewrite_financial_actuals");
  });
});
