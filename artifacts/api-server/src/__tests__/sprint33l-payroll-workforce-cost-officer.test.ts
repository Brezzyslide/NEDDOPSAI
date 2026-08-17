/**
 * Sprint 33L — Payroll & Workforce Cost Officer v2
 *
 * Proves Payroll & Workforce Cost Officer owns payroll treatment and
 * workforce-cost truth without becoming Rostering, Workforce Compliance,
 * People & Culture, Finance/FP&R, Operations, legal/industrial, tax-agent,
 * clinical, BSP/RP or OpenClaw authority.
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
  PAYROLL_WORKFORCE_COST_OFFICER_DNA,
  WORKFORCE_COMPLIANCE_SPECIALIST_DNA,
  WORKFORCE_ROSTERING_COORDINATOR_DNA,
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
import {
  findAuthoritiesForContext,
  getAuthorityRegistryEntries,
  scoreAuthorityForContext,
} from "../lib/authorityRegistry/index.js";

const ORG_ID = "org-sprint33l";
const profile = getWorkerProfileByCode("payroll_workforce_cost_officer_profile")!;

type CurrentnessStatus = "CURRENT" | "HISTORICAL" | "SUPERSEDED" | "EXPIRED" | "UNKNOWN";
type PayrollFindingStatus =
  | "DEFINITIVE"
  | "PROVISIONAL"
  | "BLOCKED_MISSING_CLASSIFICATION"
  | "INSUFFICIENT_EVIDENCE"
  | "CONFLICT_SURFACED";
type DiscrepancyStatus =
  | "UNDERPAYMENT_RISK"
  | "OVERPAYMENT_RISK"
  | "CLASSIFICATION_MISMATCH"
  | "RATE_MISMATCH"
  | "HOURS_MISMATCH"
  | "PENALTY_MISMATCH"
  | "ALLOWANCE_MISSING"
  | "ALLOWANCE_UNVERIFIED"
  | "DUPLICATE_PAYMENT_RISK"
  | "UNSUPPORTED_PAYMENT"
  | "INSUFFICIENT_EVIDENCE"
  | "NO_DISCREPANCY_IDENTIFIED";

interface RateVersion {
  source: "fwc_mapd" | "organisation_memory" | "user_assertion" | "payroll_config";
  effectiveFrom: string;
  hourlyRate: number;
  currentness: CurrentnessStatus;
}

function selectRateForWorkDate(rates: RateVersion[], workDate: string): RateVersion | null {
  const work = new Date(workDate).getTime();
  return rates
    .filter(rate =>
      rate.source === "fwc_mapd" &&
      rate.currentness !== "SUPERSEDED" &&
      rate.currentness !== "EXPIRED" &&
      new Date(rate.effectiveFrom).getTime() <= work
    )
    .sort((a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime())[0] ?? null;
}

function assessPayrollEvidence(input: {
  classification?: string;
  rosterHours?: number;
  timesheetHours?: number;
  payrollHours?: number;
  userAssertionOnly?: boolean;
  conflictingEvidence?: boolean;
}): { status: PayrollFindingStatus; discrepancy: DiscrepancyStatus } {
  if (!input.classification) return { status: "BLOCKED_MISSING_CLASSIFICATION", discrepancy: "INSUFFICIENT_EVIDENCE" };
  if (input.userAssertionOnly) return { status: "INSUFFICIENT_EVIDENCE", discrepancy: "INSUFFICIENT_EVIDENCE" };
  if (input.conflictingEvidence || input.rosterHours !== input.timesheetHours || input.timesheetHours !== input.payrollHours) {
    return { status: "CONFLICT_SURFACED", discrepancy: "HOURS_MISMATCH" };
  }
  return { status: "DEFINITIVE", discrepancy: "NO_DISCREPANCY_IDENTIFIED" };
}

function makePackage(overrides: Partial<ExecutionPackage> = {}): ExecutionPackage {
  const workerProfile = buildWorkerProfileExecutionConstraints(profile);
  return {
    executionId: "exec-33l",
    taskId: "task-33l",
    tenantId: ORG_ID,
    workforceRole: "payroll_workforce_cost_officer",
    specialistManifest: {
      manifestVersion: 1,
      workforceRole: "payroll_workforce_cost_officer",
      displayName: "Payroll & Workforce Cost Officer",
      domain: "payroll and workforce cost",
      dnaProfileId: "payroll_workforce_cost_officer",
      dnaVersion: "1.0.0",
      manifestHash: "sha256:pwco-manifest",
      generatedAt: new Date().toISOString(),
      specialistId: "payroll_workforce_cost_officer",
    } as ExecutionPackage["specialistManifest"],
    runtimeInstructions: {
      instruction: "Execute payroll and workforce cost assessment only.",
      instructionHash: "sha256:pwco-instruction",
      manifestHash: "sha256:pwco-manifest",
      dnaVersion: "1.0.0",
      specialistId: "payroll_workforce_cost_officer",
      compiledAt: new Date().toISOString(),
    },
    workerProfile,
    steps: [{
      sequence: 1,
      specialist: "payroll_workforce_cost_officer",
      action: "execute",
      description: "Assess payroll treatment and workforce cost",
      requiresApproval: false,
    }],
    requestedTools: [...profile.allowedToolCategories],
    requestedChannels: [...workerProfile.allowedChannels],
    requestedConnectorCategories: [...profile.allowedConnectorCategories],
    approvalState: "not_required",
    constraints: {
      maxDurationSeconds: 300,
      requireHumanApprovalBeforeSubmit: false,
      allowedDataCategories: ["task_context", "payroll_evidence", "timesheet_evidence", "roster_evidence"],
    },
    callbackUrl: "",
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    issuedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("Sprint 33L current-v2 activation", () => {
  it("activates Payroll & Workforce Cost Officer as complete current-v2 role", () => {
    const specialist = getSpecialistByCode("payroll_workforce_cost_officer");

    expect(specialist).toBeDefined();
    expect(specialist!.executionStatus).toBe("available");
    expect(specialist!.dnaStatus).toBe("approved");
    expect(specialist!.workerProfileCodes).toEqual(["payroll_workforce_cost_officer_profile"]);
    expect(hasActiveIntelligence("payroll_workforce_cost_officer")).toBe(true);
  });

  it("resolves active DNA and canonical WorkforceDNA", () => {
    const legacy = getDNAProfile("payroll_workforce_cost_officer");
    const canonical = getCanonicalDNAProfile("payroll_workforce_cost_officer");

    expect(legacy).toBe(PAYROLL_WORKFORCE_COST_OFFICER_DNA);
    expect(canonical).not.toBeNull();
    expect(canonical!.identity.specialistId).toBe("payroll_workforce_cost_officer");
    expect(canonical!.professionalMission.missionStatement).toContain("payroll");
    expect(canonical!.domainExpertise.competencies.length).toBeGreaterThanOrEqual(20);
    expect(canonical!.requiredWorkerProfile.profileCode).toBe("payroll_workforce_cost_officer_profile");
  });

  it("resolves WorkerProfile and runtime dispatchability", async () => {
    _clearWorkforceCache();
    const profiles = getWorkerProfilesForRole("payroll_workforce_cost_officer");
    const ctx = await getConversationWorkforceContext(ORG_ID);
    const payroll = ctx.specialists.find(s => s.code === "payroll_workforce_cost_officer");

    expect(profiles.map(p => p.code)).toEqual(["payroll_workforce_cost_officer_profile"]);
    expect(profile.riskLevel).toBe("high");
    expect(payroll).toBeDefined();
    expect(payroll!.availableForConversation).toBe(true);
    expect(payroll!.availableForDispatch).toBe(true);
    expect(payroll!.runtimeReady).toBe(true);
  });
});

describe("Sprint 33L capability and blueprint ownership", () => {
  it("owns payroll, award and workforce-cost capabilities", () => {
    const capabilityCodes = [
      "payroll.review",
      "payroll.reconciliation",
      "payroll.exception_review",
      "workforce_cost.review",
      "workforce_cost.calculate",
      "award_pay.review",
      "classification_pay_review",
      "allowance.review",
      "overtime.review",
      "penalty_rate.review",
      "payroll.schads_analysis",
    ];

    for (const code of capabilityCodes) {
      const cap = getCapability(code);
      expect(cap, `${code} should exist`).toBeDefined();
      expect(cap!.eligibleRoles[0]).toBe("payroll_workforce_cost_officer");
      expect(cap!.requiredWorkerProfiles).toContain("payroll_workforce_cost_officer_profile");
      expect(validateSpecialistEligibilitySync("payroll_workforce_cost_officer", code)).toBe(true);
    }
  });

  it("routes payroll blueprint intents to Payroll & Workforce Cost Officer", () => {
    const entry = getRegistryEntry("payroll_workforce_cost_review");
    const intent = resolveIntent("workforce_cost.calculate");

    expect(entry).toBeDefined();
    expect(entry!.futureOwnerRoleCode).toBe("payroll_workforce_cost_officer");
    expect(entry!.purpose).toContain("timesheet");
    expect(intent?.isAction).toBe(false);
    if (intent && !intent.isAction) {
      expect(intent.family).toBe("payroll_workforce_cost");
      expect(intent.mode).toBe("cost_calculation");
      expect(intent.code).toBe("payroll_workforce_cost_review");
    }
  });

  it("keeps WRC as roster owner and WCS as eligibility owner", () => {
    expect(getCapability("roster.plan")!.eligibleRoles[0]).toBe("workforce_rostering_coordinator");
    expect(getCapability("staff_compliance.deployment_eligibility")!.eligibleRoles[0]).toBe("workforce_compliance_specialist");
    expect(validateSpecialistEligibilitySync("payroll_workforce_cost_officer", "roster.plan")).toBe(false);
    expect(validateSpecialistEligibilitySync("payroll_workforce_cost_officer", "staff_compliance.deployment_eligibility")).toBe(false);
    expect(WORKFORCE_ROSTERING_COORDINATOR_DNA.conflictPolicy.defersTo).toContain("payroll_workforce_cost_officer");
    expect(WORKFORCE_COMPLIANCE_SPECIALIST_DNA.conflictPolicy.defersTo).toContain("payroll_workforce_cost_officer");
  });
});

describe("Sprint 33L professional payroll scenarios", () => {
  it("selects the rate effective on the date worked", () => {
    const selected = selectRateForWorkDate([
      { source: "fwc_mapd", effectiveFrom: "2025-07-01", hourlyRate: 42, currentness: "HISTORICAL" },
      { source: "fwc_mapd", effectiveFrom: "2026-07-01", hourlyRate: 44, currentness: "CURRENT" },
    ], "2026-06-15");

    expect(selected?.hourlyRate).toBe(42);
  });

  it("does not apply future rates early", () => {
    const selected = selectRateForWorkDate([
      { source: "fwc_mapd", effectiveFrom: "2026-07-01", hourlyRate: 44, currentness: "CURRENT" },
    ], "2026-06-15");

    expect(selected).toBeNull();
    expect(JSON.stringify(PAYROLL_WORKFORCE_COST_OFFICER_DNA)).toContain("Future rates must not apply early");
  });

  it("does not treat stale memory or historical treatment as current rate proof", () => {
    const selected = selectRateForWorkDate([
      { source: "organisation_memory", effectiveFrom: "2024-07-01", hourlyRate: 38, currentness: "HISTORICAL" },
      { source: "user_assertion", effectiveFrom: "2026-07-01", hourlyRate: 99, currentness: "UNKNOWN" },
    ], "2026-08-01");

    expect(selected).toBeNull();
    expect(PAYROLL_WORKFORCE_COST_OFFICER_DNA.learningPolicy.conflictLearning).toContain("Memory must not become proof");
  });

  it("distinguishes roster, timesheet and payroll records", () => {
    expect(assessPayrollEvidence({
      classification: "SCHADS 3.1",
      rosterHours: 8,
      timesheetHours: 10,
      payrollHours: 8,
    })).toEqual({ status: "CONFLICT_SURFACED", discrepancy: "HOURS_MISMATCH" });
  });

  it("does not accept user assertion as verified timesheet or pay evidence", () => {
    expect(assessPayrollEvidence({
      classification: "SCHADS 3.1",
      userAssertionOnly: true,
    })).toEqual({ status: "INSUFFICIENT_EVIDENCE", discrepancy: "INSUFFICIENT_EVIDENCE" });
  });

  it("blocks definitive calculation when classification is missing", () => {
    expect(assessPayrollEvidence({
      rosterHours: 8,
      timesheetHours: 8,
      payrollHours: 8,
    })).toEqual({ status: "BLOCKED_MISSING_CLASSIFICATION", discrepancy: "INSUFFICIENT_EVIDENCE" });
  });

  it("surfaces conflicting payroll evidence rather than guessing", () => {
    expect(assessPayrollEvidence({
      classification: "Level 4",
      rosterHours: 8,
      timesheetHours: 8,
      payrollHours: 8,
      conflictingEvidence: true,
    }).discrepancy).toBe("HOURS_MISMATCH");

    expect(PAYROLL_WORKFORCE_COST_OFFICER_DNA.evidenceStandards.contradictionPolicy).toContain("surface the discrepancy");
  });

  it("does not let staffing budget pressure waive pay obligations", () => {
    const dna = JSON.stringify(PAYROLL_WORKFORCE_COST_OFFICER_DNA);

    expect(dna).toContain("Budget pressure does not waive pay obligations");
    expect(dna).toContain("Payroll obligations are not weakened by budget pressure");
  });

  it("does not become roster, credential, HR, finance planning, legal, tax, clinical, BSP or RP authority", () => {
    const cannotDo = PAYROLL_WORKFORCE_COST_OFFICER_DNA.professionalBoundaries.cannotDo.join(" ");
    const outOfScope = PAYROLL_WORKFORCE_COST_OFFICER_DNA.professionalBoundaries.outOfScope.join(" ");
    const defers = PAYROLL_WORKFORCE_COST_OFFICER_DNA.conflictPolicy.defersTo.join(" ");

    expect(cannotDo).toContain("construct, publish or rewrite rosters");
    expect(cannotDo).toContain("certify worker eligibility");
    expect(cannotDo).toContain("disciplinary");
    expect(cannotDo).toContain("approve payroll");
    expect(cannotDo).toContain("legal advice");
    expect(cannotDo).toContain("tax-agent advice");
    expect(cannotDo).toContain("authorise restrictive practices");
    expect(outOfScope).toContain("budgeting, forecasting");
    expect(defers).toContain("financial_planning_reporting_manager");
    expect(defers).toContain("legal_or_industrial_authority");
  });
});

describe("Sprint 33L authority-source and OpenClaw discipline", () => {
  it("recognises FWC MAPD as authoritative but not credential-configured", () => {
    const fwc = getAuthorityRegistryEntries().find(entry => entry.id === "ar-au-005")!;
    const fwo = getAuthorityRegistryEntries().find(entry => entry.id === "ar-au-004")!;
    const authorities = findAuthoritiesForContext({
      jurisdiction: "AU",
      subjectArea: "award_rates",
      workforceDomain: "payroll_workforce_cost",
      professionalDomain: "PAYROLL",
      requireCurrent: true,
    });

    expect(fwc.name).toContain("Fair Work Commission");
    expect(fwc.apiStatus).toBe("AVAILABLE");
    expect(fwc.credentialStatus).toBe("NOT_CONFIGURED");
    expect(fwc.fallbackTransport).toBe("GOVERNED_WEB");
    expect(authorities[0]?.id).toBe("ar-au-005");
    expect(scoreAuthorityForContext(fwc, { jurisdiction: "AU", subjectArea: "award_rates", workforceDomain: "payroll_workforce_cost", professionalDomain: "PAYROLL" }))
      .toBeGreaterThan(scoreAuthorityForContext(fwo, { jurisdiction: "AU", subjectArea: "award_rates", workforceDomain: "payroll_workforce_cost", professionalDomain: "PAYROLL" }));
  });

  it("uses ATO only inside payroll tax/super boundaries", () => {
    const ato = getAuthorityRegistryEntries().find(entry => entry.id === "ar-au-006")!;

    expect(ato.subjectAreas).toContain("superannuation");
    expect(ato.applicableWorkforceDomains).toContain("payroll_workforce_cost");
    expect(PAYROLL_WORKFORCE_COST_OFFICER_DNA.professionalBoundaries.cannotDo)
      .toContain("provide tax-agent advice beyond supported payroll calculation inputs");
  });

  it("current authoritative instrument outranks stale internal memory", () => {
    const fwc = getAuthorityRegistryEntries().find(entry => entry.id === "ar-au-005")!;
    const staleMemory: typeof fwc = {
      ...fwc,
      id: "memory-old-payroll-treatment",
      name: "Old payroll memory",
      sourceClass: "organisation_policy",
      evidenceAuthorityClass: "supporting",
      currentness: { status: "historical", verifiedAt: "2025-01-01" },
      applicableWorkforceDomains: ["payroll_workforce_cost"],
    };

    expect(scoreAuthorityForContext(fwc, { jurisdiction: "AU", subjectArea: "modern_awards", workforceDomain: "payroll_workforce_cost", professionalDomain: "PAYROLL", requireCurrent: true }))
      .toBeGreaterThan(scoreAuthorityForContext(staleMemory, { jurisdiction: "AU", subjectArea: "modern_awards", workforceDomain: "payroll_workforce_cost", professionalDomain: "PAYROLL", requireCurrent: true }));
  });

  it("WorkerProfile permits analysis but prohibits unauthorised payroll mutation", () => {
    const analysis = evaluateWorkerProfileAuthority({
      specialistCode: "payroll_workforce_cost_officer",
      workerProfile: profile,
      actionIdentifier: "draft_payroll_reconciliation_report",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
      connectorCategory: "document_management",
    });
    const mutate = evaluateWorkerProfileAuthority({
      specialistCode: "payroll_workforce_cost_officer",
      workerProfile: profile,
      actionIdentifier: "fabricate_payroll_record",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "data_tools",
      approvalGranted: true,
    });
    const correction = evaluateWorkerProfileAuthority({
      specialistCode: "payroll_workforce_cost_officer",
      workerProfile: profile,
      actionIdentifier: "submit_payroll_correction_recommendation",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "data_tools",
      connectorCategory: "payroll_system",
    });

    expect(analysis.decision).toBe("PERMITTED");
    expect(mutate.decision).toBe("PROHIBITED");
    expect(correction.decision).toBe("APPROVAL_REQUIRED");
  });

  it("approval cannot override prohibited actions", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "payroll_workforce_cost_officer",
      workerProfile: profile,
      actionIdentifier: "approve_payrun",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "data_tools",
      connectorCategory: "payroll_system",
      approvalGranted: true,
    });

    expect(decision.decision).toBe("PROHIBITED");
  });

  it("OpenClaw execution package remains constrained by WorkerProfile", () => {
    const pkg = makePackage();
    const decision = validateOpenClawExecutionPackageAuthority({ pkg, workerProfile: profile });

    expect(decision.decision).toBe("PERMITTED");
    expect(pkg.workforceRole).toBe("payroll_workforce_cost_officer");
    expect(pkg.workerProfile.prohibitedActions).toContain("approve_payrun");
    expect(pkg.workerProfile.prohibitedActions).toContain("fabricate_payroll_record");
    expect(pkg.workerProfile.requiresApprovalFor).toContain("submit_payroll_correction_recommendation");
  });

  it("OpenClaw package fails if WorkerProfile prohibitions are removed", () => {
    const pkg = makePackage({
      workerProfile: {
        ...buildWorkerProfileExecutionConstraints(profile),
        prohibitedActions: [],
      },
    });
    const decision = validateOpenClawExecutionPackageAuthority({ pkg, workerProfile: profile });

    expect(decision.decision).toBe("PROHIBITED");
    expect(decision.reason).toContain("removed WorkerProfile prohibitions");
  });
});
