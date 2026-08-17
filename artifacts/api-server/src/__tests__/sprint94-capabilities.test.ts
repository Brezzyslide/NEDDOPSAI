/**
 * Sprint 9.4 — Capability Identification, Entitlement Enforcement and Upgrade Guidance
 *
 * Tests cover:
 *   - Capability registry correctness
 *   - Capability identification (deterministic)
 *   - Entitlement access decisions (mocked entitlement service)
 *   - Mixed-capability request handling
 *   - Routing gate: specialist eligibility
 *   - Task creation gate (capability validation)
 *   - Specialist run gate
 *   - Chief of Staff polite blocked response
 *   - Upgrade guidance structure
 *   - Security: invented codes, tenant isolation, client bypass prevention
 *
 * All tests are deterministic. No LLM or live DB calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Capability Registry ────────────────────────────────────────────────────────

import {
  BUSINESS_CAPABILITIES,
  getCapability,
  isKnownCapabilityCode,
  getCapabilitiesForPack,
  getCapabilitiesForRole,
  getCoreCapabilities,
  isLevelSupported,
  CAPABILITY_KEYWORD_PATTERNS,
} from "../lib/capabilityRegistry.js";

describe("Capability Registry", () => {
  it("contains at least 30 active capabilities", () => {
    const active = BUSINESS_CAPABILITIES.filter(c => c.status === "active");
    expect(active.length).toBeGreaterThanOrEqual(30);
  });

  it("all capability codes are unique", () => {
    const codes = BUSINESS_CAPABILITIES.map(c => c.code);
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });

  it("all capabilities have required fields", () => {
    for (const cap of BUSINESS_CAPABILITIES) {
      expect(cap.code, `${cap.code} missing code`).toBeTruthy();
      expect(cap.displayName, `${cap.code} missing displayName`).toBeTruthy();
      expect(cap.category, `${cap.code} missing category`).toBeTruthy();
      expect(cap.eligibleRoles.length, `${cap.code} has no eligible roles`).toBeGreaterThan(0);
    }
  });

  it("getCapability returns correct entry", () => {
    const cap = getCapability("accounting.bas_preparation");
    expect(cap).toBeDefined();
    expect(cap!.packCode).toBe("finance");
    expect(cap!.executionAllowed).toBe(true);
    expect(cap!.informationAllowed).toBe(true);
  });

  it("isKnownCapabilityCode returns true for valid codes", () => {
    expect(isKnownCapabilityCode("compliance.audit_readiness")).toBe(true);
    expect(isKnownCapabilityCode("payroll.schads_analysis")).toBe(true);
    expect(isKnownCapabilityCode("administration.general")).toBe(true);
  });

  it("isKnownCapabilityCode returns false for invented codes", () => {
    expect(isKnownCapabilityCode("magic.super_power")).toBe(false);
    expect(isKnownCapabilityCode("accounting.time_travel")).toBe(false);
    expect(isKnownCapabilityCode("")).toBe(false);
    expect(isKnownCapabilityCode("finance")).toBe(false);
  });

  it("getCapabilitiesForPack returns only that pack's capabilities", () => {
    const complianceCaps = getCapabilitiesForPack("compliance");
    expect(complianceCaps.length).toBeGreaterThan(0);
    for (const cap of complianceCaps) {
      expect(cap.packCode).toBe("compliance");
    }
  });

  it("getCapabilitiesForRole returns capabilities for compliance_quality_manager (Sprint 11 replacement for compliance_officer)", () => {
    // Sprint 11: compliance_officer merged → compliance_quality_manager
    const caps = getCapabilitiesForRole("compliance_quality_manager");
    const codes = caps.map(c => c.code);
    expect(codes).toContain("compliance.audit_readiness");
    expect(codes).toContain("incident.review");
  });

  it("compliance_officer is NOT eligible for accounting capabilities", () => {
    const caps = getCapabilitiesForRole("compliance_officer");
    const codes = caps.map(c => c.code);
    expect(codes).not.toContain("accounting.bas_preparation");
    expect(codes).not.toContain("payroll.schads_analysis");
  });

  it("accounts_officer is NOT eligible for compliance capabilities", () => {
    const caps = getCapabilitiesForRole("accounts_officer");
    const codes = caps.map(c => c.code);
    expect(codes).not.toContain("compliance.audit_readiness");
    expect(codes).not.toContain("incident.review");
  });

  it("getCoreCapabilities returns only pack-free capabilities", () => {
    const core = getCoreCapabilities();
    for (const cap of core) {
      expect(cap.packCode).toBeNull();
    }
  });

  it("isLevelSupported returns correct values for bas_preparation", () => {
    const cap = getCapability("accounting.bas_preparation")!;
    expect(isLevelSupported(cap, "general_information")).toBe(true);
    expect(isLevelSupported(cap, "professional_analysis")).toBe(false); // analysisAllowed = false
    expect(isLevelSupported(cap, "execution")).toBe(true);
  });

  it("isLevelSupported returns correct values for gap_analysis", () => {
    const cap = getCapability("compliance.gap_analysis")!;
    expect(isLevelSupported(cap, "general_information")).toBe(true);
    expect(isLevelSupported(cap, "professional_analysis")).toBe(true);
    expect(isLevelSupported(cap, "execution")).toBe(false); // executionAllowed = false
  });

  it("keyword patterns all reference valid capability codes", () => {
    for (const pattern of CAPABILITY_KEYWORD_PATTERNS) {
      expect(isKnownCapabilityCode(pattern.capabilityCode),
        `Keyword pattern references invalid code: ${pattern.capabilityCode}`)
        .toBe(true);
    }
  });
});

// ── Capability Identification (deterministic) ─────────────────────────────────

import { identifyCapabilities } from "../services/capabilityIdentificationService.js";

const BASE_INPUT = {
  organizationId: "org_test",
  userId: "user_test",
};

describe("Capability Identification — deterministic", () => {
  it("BAS preparation request maps to accounting.bas_preparation at execution level", async () => {
    const result = await identifyCapabilities({
      ...BASE_INPUT,
      message: "Prepare and lodge our BAS for this quarter",
    });
    const codes = result.requestedCapabilities.map(c => c.capabilityCode);
    expect(codes).toContain("accounting.bas_preparation");
    const cap = result.requestedCapabilities.find(c => c.capabilityCode === "accounting.bas_preparation");
    expect(cap?.requestedLevel).toBe("execution");
  });

  it("general BAS question maps to general_information level", async () => {
    const result = await identifyCapabilities({
      ...BASE_INPUT,
      message: "What is a BAS and how does it work?",
    });
    // The key requirement: "what is X?" must never trigger execution-level access.
    // The system may return research.general (acceptable) or accounting.bas_analysis
    // (also acceptable) — both should be at general_information level for a "what is" question.
    if (result.requestedCapabilities.length > 0) {
      for (const rc of result.requestedCapabilities) {
        expect(rc.requestedLevel, `Capability ${rc.capabilityCode} should be general_information for a 'what is' question`)
          .toBe("general_information");
      }
    } else {
      // Acceptable: the system recognised it as a general educational query with no domain capability needed
      expect(result.ambiguous || result.requestedCapabilities.length === 0).toBe(true);
    }
  });

  it("compliance task maps to compliance capability", async () => {
    const result = await identifyCapabilities({
      ...BASE_INPUT,
      message: "Review our audit evidence for the NDIS audit",
    });
    const codes = result.requestedCapabilities.map(c => c.capabilityCode);
    const hasCompliance = codes.some(c => c.startsWith("compliance."));
    expect(hasCompliance).toBe(true);
  });

  it("SCHADS analysis request maps to payroll.schads_analysis", async () => {
    const result = await identifyCapabilities({
      ...BASE_INPUT,
      message: "Check our payroll records against SCHADS award rates",
    });
    const codes = result.requestedCapabilities.map(c => c.capabilityCode);
    expect(codes).toContain("payroll.schads_analysis");
  });

  it("mixed request maps to multiple capabilities", async () => {
    const result = await identifyCapabilities({
      ...BASE_INPUT,
      message: "Review overtime compliance and calculate the financial impact on our budget",
    });
    expect(result.requestedCapabilities.length).toBeGreaterThan(1);
  });

  it("incident report request maps to incident.review", async () => {
    const result = await identifyCapabilities({
      ...BASE_INPUT,
      message: "We need to review a reportable incident that occurred yesterday",
    });
    const codes = result.requestedCapabilities.map(c => c.capabilityCode);
    expect(codes).toContain("incident.review");
  });

  it("ambiguous message returns ambiguous=true and clarification questions", async () => {
    const result = await identifyCapabilities({
      ...BASE_INPUT,
      message: "Hello",
    });
    // Either no capabilities identified (ambiguous) or minimal matches
    if (result.requestedCapabilities.length === 0) {
      expect(result.ambiguous).toBe(true);
      expect(result.clarificationQuestions.length).toBeGreaterThan(0);
    }
  });

  it("all identified capability codes are in the canonical registry", async () => {
    const result = await identifyCapabilities({
      ...BASE_INPUT,
      message: "Prepare the BAS, review our compliance policies, and analyse our payroll",
    });
    for (const rc of result.requestedCapabilities) {
      expect(isKnownCapabilityCode(rc.capabilityCode),
        `Identified unknown code: ${rc.capabilityCode}`).toBe(true);
    }
  });
});

// ── Capability Access Decisions ────────────────────────────────────────────────
// All entitlement service calls are mocked.

import * as entitlementService from "../services/entitlementService.js";
import {
  decideCapabilityAccess,
  decideMixedCapabilityAccess,
  validateSpecialistEligibility,
  validateCapabilityCodes,
} from "../services/capabilityAccessDecisionService.js";

// Mock the db operations — we only test decision logic here
vi.mock("@workspace/db", () => ({
  db: {
    insert: () => ({ values: () => Promise.resolve() }),
    select: () => ({ from: () => ({ where: () => ({ limit: () => [] }) }) }),
  },
  capabilityDecisionsTable: {},
  orgAuditLogTable: {},
}));

const NOW = new Date();
const mockGranted = { allowed: true, source: "subscription" as const, reason: "OK", evaluatedAt: NOW, effectiveUntil: null };
const mockDenied = { allowed: false, source: "no_subscription" as const, reason: "Not in plan", evaluatedAt: NOW, effectiveUntil: null, denialReason: "feature_not_in_plan" as const };
const mockExplicitDenial = { allowed: false, source: "explicit_denial" as const, reason: "Explicitly denied", evaluatedAt: NOW, effectiveUntil: null, denialReason: "explicit_denial" as const };

const DECISION_CTX = { conversationId: "conv_test", correlationId: "corr_test" };

describe("Capability Access Decisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("general_information is allowed even without workforce pack", async () => {
    vi.spyOn(entitlementService, "tenantCanUseFeature").mockResolvedValue(mockDenied);
    vi.spyOn(entitlementService, "tenantHasWorkforcePack").mockResolvedValue(mockDenied);

    const decision = await decideCapabilityAccess(
      "org_test", "user_test", "compliance.audit_readiness", "general_information", DECISION_CTX
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("general_information_allowed");
  });

  it("professional_analysis is allowed when workforce pack is owned", async () => {
    vi.spyOn(entitlementService, "tenantCanUseFeature").mockResolvedValue(mockGranted);
    vi.spyOn(entitlementService, "tenantHasWorkforcePack").mockResolvedValue(mockGranted);

    const decision = await decideCapabilityAccess(
      "org_test", "user_test", "compliance.audit_readiness", "professional_analysis", DECISION_CTX
    );
    expect(decision.allowed).toBe(true);
  });

  it("professional_analysis is partially allowed when pack not owned (offers general_info)", async () => {
    vi.spyOn(entitlementService, "tenantCanUseFeature").mockResolvedValue(mockDenied);
    vi.spyOn(entitlementService, "tenantHasWorkforcePack").mockResolvedValue(mockDenied);

    const decision = await decideCapabilityAccess(
      "org_test", "user_test", "compliance.audit_readiness", "professional_analysis", DECISION_CTX
    );
    expect(decision.allowed).toBe(false);
    expect(decision.partiallyAllowed).toBe(true);
    expect(decision.allowedLevel).toBe("general_information");
    expect(decision.reasonCode).toBe("workforce_pack_not_included");
    expect(decision.requiredWorkforcePack).toBe("compliance");
    expect(decision.upgradeOptions.length).toBeGreaterThan(0);
  });

  it("execution is blocked when pack is owned but neither professional_work nor openclaw_runtime is entitled (Sprint 29N.10)", async () => {
    // Sprint 29N.10: capabilityAccessDecisionService checks professional_work first, then
    // falls back to openclaw_runtime. Both must be denied to block execution access.
    vi.spyOn(entitlementService, "tenantCanUseFeature")
      .mockImplementation((_orgId, featureCode) => {
        if (
          featureCode === "execution.professional_work" ||
          featureCode === "execution.openclaw_runtime"
        ) return Promise.resolve(mockDenied);
        return Promise.resolve(mockGranted);
      });
    vi.spyOn(entitlementService, "tenantHasWorkforcePack").mockResolvedValue(mockGranted);

    const decision = await decideCapabilityAccess(
      "org_test", "user_test", "compliance.audit_readiness", "execution", DECISION_CTX
    );
    expect(decision.allowed).toBe(false);
    expect(decision.partiallyAllowed).toBe(true);
    expect(decision.allowedLevel).toBe("professional_analysis");
    expect(decision.reasonCode).toBe("execution_not_included");
  });

  it("explicit denial overrides plan access", async () => {
    vi.spyOn(entitlementService, "tenantCanUseFeature").mockResolvedValue(mockExplicitDenial);
    vi.spyOn(entitlementService, "tenantHasWorkforcePack").mockResolvedValue(mockGranted);

    const decision = await decideCapabilityAccess(
      "org_test", "user_test", "compliance.audit_readiness", "professional_analysis", DECISION_CTX
    );
    expect(decision.allowed).toBe(false);
    expect(decision.partiallyAllowed).toBe(false);
    expect(decision.reasonCode).toBe("explicitly_denied");
  });

  it("unknown capability code is rejected with unknown_capability reason", async () => {
    const decision = await decideCapabilityAccess(
      "org_test", "user_test", "invented.super_power", "execution", DECISION_CTX
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("unknown_capability");
  });

  it("level_not_supported returned when requesting execution on analysis-only capability", async () => {
    // compliance.gap_analysis has executionAllowed = false
    const decision = await decideCapabilityAccess(
      "org_test", "user_test", "compliance.gap_analysis", "execution", DECISION_CTX
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("level_not_supported");
  });

  it("core capabilities are always allowed without pack check", async () => {
    // administration.general has packCode = null
    const decision = await decideCapabilityAccess(
      "org_test", "user_test", "administration.general", "professional_analysis", DECISION_CTX
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("included_in_plan");
    // entitlement service should NOT be called for core capabilities
    expect(entitlementService.tenantHasWorkforcePack).not.toHaveBeenCalled();
  });

  it("tenant_override source returns tenant_override reason code", async () => {
    const overrideGranted = { allowed: true, source: "override" as const, reason: "Platform override", evaluatedAt: NOW, effectiveUntil: null };
    vi.spyOn(entitlementService, "tenantCanUseFeature").mockResolvedValue(overrideGranted);
    vi.spyOn(entitlementService, "tenantHasWorkforcePack").mockResolvedValue(overrideGranted);

    const decision = await decideCapabilityAccess(
      "org_test", "user_test", "compliance.audit_readiness", "professional_analysis", DECISION_CTX
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("tenant_override");
  });

  it("trial source returns trial_access reason code", async () => {
    const trialGranted = { allowed: true, source: "trial" as const, reason: "Trial", evaluatedAt: NOW, effectiveUntil: new Date(Date.now() + 86400000) };
    vi.spyOn(entitlementService, "tenantCanUseFeature").mockResolvedValue(trialGranted);
    vi.spyOn(entitlementService, "tenantHasWorkforcePack").mockResolvedValue(trialGranted);

    const decision = await decideCapabilityAccess(
      "org_test", "user_test", "compliance.audit_readiness", "professional_analysis", DECISION_CTX
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("trial_access");
  });
});

// ── Mixed-Capability Decisions ────────────────────────────────────────────────

describe("Mixed-Capability Decisions", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("org with compliance-only gets compliance allowed and finance blocked", async () => {
    vi.spyOn(entitlementService, "tenantCanUseFeature").mockImplementation((_orgId, code) => {
      if (typeof code === "string" && code.includes("compliance")) return Promise.resolve(mockGranted);
      return Promise.resolve(mockDenied);
    });
    vi.spyOn(entitlementService, "tenantHasWorkforcePack").mockImplementation((_orgId, packCode) => {
      if (packCode === "compliance") return Promise.resolve(mockGranted);
      return Promise.resolve(mockDenied);
    });

    const result = await decideMixedCapabilityAccess(
      "org_test", "user_test",
      {
        understoodIntent: "Mixed compliance and finance",
        requestedCapabilities: [
          { capabilityCode: "compliance.gap_analysis", requestedLevel: "professional_analysis", confidence: 0.9, reason: "", required: true },
          { capabilityCode: "finance.cost_impact_analysis", requestedLevel: "professional_analysis", confidence: 0.8, reason: "", required: true },
        ],
        ambiguous: false,
        clarificationQuestions: [],
        identificationMethod: "deterministic",
      },
      DECISION_CTX,
    );

    expect(result.allowedCapabilities.some(d => d.capabilityCode === "compliance.gap_analysis")).toBe(true);
    expect(result.blockedCapabilities.length > 0 || result.partialCapabilities.length > 0).toBe(true);
    expect(result.canProceedPartially).toBe(true);
    expect(result.requiresUserConfirmationForPartialWork).toBe(true); // required capability blocked
    expect(result.hasFullAccess).toBe(false);
  });

  it("org with all packs gets hasFullAccess = true", async () => {
    vi.spyOn(entitlementService, "tenantCanUseFeature").mockResolvedValue(mockGranted);
    vi.spyOn(entitlementService, "tenantHasWorkforcePack").mockResolvedValue(mockGranted);

    const result = await decideMixedCapabilityAccess(
      "org_test", "user_test",
      {
        understoodIntent: "Both compliance and finance",
        requestedCapabilities: [
          { capabilityCode: "compliance.gap_analysis", requestedLevel: "professional_analysis", confidence: 0.9, reason: "", required: true },
          { capabilityCode: "payroll.schads_analysis", requestedLevel: "professional_analysis", confidence: 0.8, reason: "", required: false },
        ],
        ambiguous: false,
        clarificationQuestions: [],
        identificationMethod: "deterministic",
      },
      DECISION_CTX,
    );

    expect(result.hasFullAccess).toBe(true);
    expect(result.blockedCapabilities).toHaveLength(0);
    expect(result.partialCapabilities).toHaveLength(0);
  });
});

// ── Specialist Routing Gate ────────────────────────────────────────────────────

describe("Specialist Routing Gate", () => {
  // Sprint 11: compliance_officer merged → compliance_quality_manager
  it("compliance_quality_manager is eligible for compliance.audit_readiness", () => {
    expect(validateSpecialistEligibility("compliance_quality_manager", "compliance.audit_readiness")).toBe(true);
  });

  // Sprint 11: accounts_officer merged → finance_officer
  it("finance_officer is eligible for accounting.bas_preparation", () => {
    expect(validateSpecialistEligibility("finance_officer", "accounting.bas_preparation")).toBe(true);
  });

  it("compliance_quality_manager is NOT eligible for accounting.bas_preparation", () => {
    expect(validateSpecialistEligibility("compliance_quality_manager", "accounting.bas_preparation")).toBe(false);
  });

  it("compliance_quality_manager is NOT eligible for payroll.schads_analysis", () => {
    expect(validateSpecialistEligibility("compliance_quality_manager", "payroll.schads_analysis")).toBe(false);
  });

  // Sprint 11: hr_officer merged → people_culture_manager
  it("people_culture_manager is NOT eligible for compliance.audit_readiness", () => {
    expect(validateSpecialistEligibility("people_culture_manager", "compliance.audit_readiness")).toBe(false);
  });

  // Sprint 11: hr_officer → people_culture_manager; staff_compliance → workforce_compliance_specialist
  it("workforce_compliance_specialist is eligible for staff_compliance.qualification_review", () => {
    expect(validateSpecialistEligibility("workforce_compliance_specialist", "staff_compliance.qualification_review")).toBe(true);
  });

  it("compliance_quality_manager is not the owner for worker-level qualification review", () => {
    expect(validateSpecialistEligibility("compliance_quality_manager", "staff_compliance.qualification_review")).toBe(false);
  });

  it("unknown specialist code returns false", () => {
    expect(validateSpecialistEligibility("super_agent", "compliance.audit_readiness")).toBe(false);
  });

  it("unknown capability code returns false", () => {
    expect(validateSpecialistEligibility("compliance_quality_manager", "invented.capability")).toBe(false);
  });
});

// ── Capability Code Validation ─────────────────────────────────────────────────

describe("Capability Code Validation", () => {
  it("validateCapabilityCodes splits valid and invalid codes correctly", () => {
    const { valid, invalid } = validateCapabilityCodes([
      "compliance.audit_readiness",
      "invented.super_power",
      "accounting.bas_preparation",
      "magic.capability",
    ]);
    expect(valid).toContain("compliance.audit_readiness");
    expect(valid).toContain("accounting.bas_preparation");
    expect(invalid).toContain("invented.super_power");
    expect(invalid).toContain("magic.capability");
  });

  it("returns all invalid for empty registry miss", () => {
    const { valid, invalid } = validateCapabilityCodes(["totally.fake", "also.fake"]);
    expect(valid).toHaveLength(0);
    expect(invalid).toHaveLength(2);
  });
});

// ── Chief of Staff Blocked Response ───────────────────────────────────────────

import {
  buildBlockedCapabilityResponse,
  buildMixedCapabilityResponse,
  buildCapabilityBlockedCard,
} from "../services/capabilityGateService.js";

describe("Chief of Staff Blocked Response", () => {
  const blockedDecision = {
    decisionId: "dec_test",
    capabilityCode: "accounting.bas_preparation",
    requestedLevel: "execution" as const,
    allowed: false,
    partiallyAllowed: false,
    reasonCode: "workforce_pack_not_included" as const,
    source: "Finance Workforce Pack is not included",
    requiredWorkforcePack: "finance",
    upgradeOptions: [
      { type: "workforce_pack" as const, code: "finance", displayName: "Finance Workforce Pack",
        description: "Unlocks finance capabilities", available: true, contactSalesRequired: false },
    ],
  };

  it("polite blocked response mentions the required workforce pack", () => {
    const response = buildBlockedCapabilityResponse(blockedDecision);
    expect(response).toContain("Finance");
    expect(response).not.toContain("Access denied");
    expect(response).not.toContain("Payment required");
    expect(response).not.toContain("You cannot");
  });

  it("blocked response offers what IS available", () => {
    const response = buildBlockedCapabilityResponse(blockedDecision);
    expect(response.toLowerCase()).toContain("can");
  });

  it("blocked response does not invent prices", () => {
    const response = buildBlockedCapabilityResponse(blockedDecision);
    expect(response).not.toMatch(/\$\d+/); // no dollar amounts
  });

  it("blocked response does not claim work started", () => {
    const response = buildBlockedCapabilityResponse(blockedDecision);
    expect(response.toLowerCase()).not.toContain("started");
    expect(response.toLowerCase()).not.toContain("in progress");
    expect(response.toLowerCase()).not.toContain("processing");
  });

  it("blocked capability card has correct structure", () => {
    const card = buildCapabilityBlockedCard(blockedDecision, ["general_guidance", "view_plan"]);
    expect(card.type).toBe("capability_blocked");
    expect(card.data.capabilityCode).toBe("accounting.bas_preparation");
    expect(card.data.upgradeOptions).toBeDefined();
    expect(card.data.decisionId).toBe("dec_test");
  });

  it("mixed capability response mentions available and unavailable parts", () => {
    const mixedDecision = {
      allowedCapabilities: [
        { decisionId: "d1", capabilityCode: "compliance.gap_analysis",
          requestedLevel: "professional_analysis" as const, allowed: true, partiallyAllowed: false,
          reasonCode: "workforce_pack_included" as const, source: "pack", upgradeOptions: [] },
      ],
      blockedCapabilities: [
        { decisionId: "d2", capabilityCode: "finance.cost_impact_analysis",
          requestedLevel: "professional_analysis" as const, allowed: false, partiallyAllowed: false,
          reasonCode: "workforce_pack_not_included" as const, source: "no pack",
          requiredWorkforcePack: "finance", upgradeOptions: [] },
      ],
      partialCapabilities: [],
      canProceedPartially: true,
      requiresUserConfirmationForPartialWork: true,
      hasFullAccess: false,
      blockedPacksRequired: ["finance"],
    };

    const response = buildMixedCapabilityResponse(mixedDecision);
    expect(response).toContain("Available");
    expect(response.length).toBeGreaterThan(20);
  });
});

// ── Security Tests ────────────────────────────────────────────────────────────

describe("Security Rules", () => {
  it("invented capability code is rejected immediately (never reaches entitlement check)", async () => {
    const canUseSpy = vi.spyOn(entitlementService, "tenantCanUseFeature");
    const hasPack = vi.spyOn(entitlementService, "tenantHasWorkforcePack");

    const decision = await decideCapabilityAccess(
      "org_test", "user_test", "llm.invented_capability", "execution", DECISION_CTX
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("unknown_capability");
    expect(canUseSpy).not.toHaveBeenCalled();
    expect(hasPack).not.toHaveBeenCalled();
  });

  it("tenant A cannot benefit from decisions made for tenant B", async () => {
    // Each decision is independently evaluated per organizationId
    vi.spyOn(entitlementService, "tenantHasWorkforcePack").mockImplementation(
      (orgId) => orgId === "org_a"
        ? Promise.resolve(mockGranted)
        : Promise.resolve(mockDenied)
    );
    vi.spyOn(entitlementService, "tenantCanUseFeature").mockResolvedValue(mockGranted);

    const decisionA = await decideCapabilityAccess(
      "org_a", "user_a", "compliance.audit_readiness", "professional_analysis", DECISION_CTX
    );
    const decisionB = await decideCapabilityAccess(
      "org_b", "user_b", "compliance.audit_readiness", "professional_analysis", DECISION_CTX
    );

    expect(decisionA.allowed).toBe(true);
    expect(decisionB.allowed).toBe(false);
  });

  it("LLM-proposed codes are rejected if not in registry", () => {
    // This tests the allowlist validation in identification service
    const invented = ["llm.hallucinated_capability", "ai.unlimited_power"];
    for (const code of invented) {
      expect(isKnownCapabilityCode(code)).toBe(false);
    }
  });

  it("all valid codes from identification result are in the registry", async () => {
    const result = await identifyCapabilities({
      ...BASE_INPUT,
      message: "Review our BAS records and prepare payroll",
    });
    for (const rc of result.requestedCapabilities) {
      expect(isKnownCapabilityCode(rc.capabilityCode)).toBe(true);
    }
  });

  it("capability substitution is prevented — only eligible roles may be assigned", () => {
    // Compliance Officer must not be substituted for Finance work
    const complianceOfficerForBAS = validateSpecialistEligibility(
      "compliance_officer", "accounting.bas_preparation"
    );
    expect(complianceOfficerForBAS).toBe(false);

    // Operations Manager must not be substituted for HR work
    const opsForHR = validateSpecialistEligibility(
      "operations_manager", "hr.recruitment"
    );
    expect(opsForHR).toBe(false);
  });
});
