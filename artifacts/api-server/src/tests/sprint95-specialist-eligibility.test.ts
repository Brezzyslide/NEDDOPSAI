/**
 * Sprint 9.5 — Specialist Eligibility Tests
 *
 * Covers all 12 eligibility checks including sync fast path.
 * Uses actual capability codes from the registry.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  checkSpecialistEligibility,
  validateSpecialistEligibilitySync,
  getEligibleSpecialists,
  hasActiveIntelligence,
} from "../services/specialistEligibilityService.js";

// Mock async dependencies for unit tests
vi.mock("../services/entitlementService.js", () => ({
  tenantHasWorkforcePack: vi.fn().mockResolvedValue({
    allowed: true,
    source: "plan_entitlement",
  }),
  checkUsage: vi.fn().mockResolvedValue({ allowed: true }),
  tenantCanUseFeature: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: vi.fn().mockResolvedValue(undefined),
}));

const BASE_CONTEXT = {
  organizationId: "org-test-uuid",
  requestingUserId: "user-test-uuid",
  skipAsyncChecks: true,
};

// ─── Verify registry codes ────────────────────────────────────────────────────
// Actual codes from lib/capabilityRegistry.ts:
// compliance_officer: compliance.audit_readiness, compliance.gap_analysis, compliance.evidence_review, compliance.corrective_actions
// document_specialist: documents.draft
// operations_manager: operations.workflow_review, operations.capacity_analysis

describe("Sprint 9.5 — Specialist Eligibility", () => {
  describe("validateSpecialistEligibilitySync", () => {
    // compliance_officer was deprecated in Sprint 11 (merged into compliance_quality_manager).
    // This check uses chief_of_staff + administration.general as a stable approved specialist path.
    it("returns true for chief_of_staff + administration.general", () => {
      const result = validateSpecialistEligibilitySync(
        "chief_of_staff",
        "administration.general",
      );
      expect(result).toBe(true);
    });

    it("returns false for unknown capability code", () => {
      const result = validateSpecialistEligibilitySync(
        "compliance_officer",
        "fantasy.capability",
      );
      expect(result).toBe(false);
    });

    it("returns false for unknown specialist code", () => {
      const result = validateSpecialistEligibilitySync(
        "nonexistent_specialist",
        "compliance.audit_readiness",
      );
      expect(result).toBe(false);
    });

    it("returns false when specialist is not in cap eligibleRoles", () => {
      // research_specialist is not eligible for compliance capabilities
      const result = validateSpecialistEligibilitySync(
        "research_specialist",
        "compliance.audit_readiness",
      );
      expect(result).toBe(false);
    });

    // document_specialist was renamed to knowledge_documentation_specialist in Sprint 11.
    // knowledge_documentation_specialist is dna_pending, so the sync check returns false.
    // Updated to use operations_manager + operations.capacity_analysis — a currently approved specialist.
    it("returns true for operations_manager + operations.capacity_analysis", () => {
      const result = validateSpecialistEligibilitySync(
        "operations_manager",
        "operations.capacity_analysis",
      );
      expect(result).toBe(true);
    });

    it("returns true for operations_manager + operations.workflow_review", () => {
      const result = validateSpecialistEligibilitySync(
        "operations_manager",
        "operations.workflow_review",
      );
      expect(result).toBe(true);
    });
  });

  describe("checkSpecialistEligibility — allowed paths", () => {
    // This check uses operations_manager as a stable approved specialist path.
    it("returns eligible=true for operations_manager + operations.capacity_analysis", async () => {
      const decision = await checkSpecialistEligibility(
        "operations_manager",
        "operations.capacity_analysis",
        "professional_analysis",
        BASE_CONTEXT,
      );
      expect(decision.eligible).toBe(true);
      expect(decision.reasonCode).toBe("eligible");
      expect(decision.decisionId).toBeTruthy();
      expect(decision.evaluatedAt).toBeTruthy();
    });

    // document_specialist renamed to knowledge_documentation_specialist (dna_pending).
    // Use chief_of_staff — a currently approved specialist — to preserve test coverage.
    it("returns eligible=true for chief_of_staff + administration.general", async () => {
      const decision = await checkSpecialistEligibility(
        "chief_of_staff",
        "administration.general",
        "professional_analysis",
        BASE_CONTEXT,
      );
      expect(decision.eligible).toBe(true);
    });

    it("returns eligible=true for operations_manager + operations.workflow_review", async () => {
      const decision = await checkSpecialistEligibility(
        "operations_manager",
        "operations.workflow_review",
        "professional_analysis",
        BASE_CONTEXT,
      );
      expect(decision.eligible).toBe(true);
    });

    it("sets approvalRequired field as a boolean", async () => {
      const decision = await checkSpecialistEligibility(
        "compliance_officer",
        "compliance.audit_readiness",
        "professional_analysis",
        BASE_CONTEXT,
      );
      expect(typeof decision.approvalRequired).toBe("boolean");
    });

    it("populates workerProfileCode for eligible specialists", async () => {
      const decision = await checkSpecialistEligibility(
        "compliance_officer",
        "compliance.audit_readiness",
        "professional_analysis",
        BASE_CONTEXT,
      );
      if (decision.eligible) {
        expect(decision.workerProfileCode).toBeTruthy();
      }
    });
  });

  describe("checkSpecialistEligibility — blocked paths", () => {
    it("blocks unknown capability code", async () => {
      const decision = await checkSpecialistEligibility(
        "compliance_officer",
        "does.not.exist",
        "professional_analysis",
        BASE_CONTEXT,
      );
      expect(decision.eligible).toBe(false);
      expect(decision.reasonCode).toBe("unknown_capability");
    });

    it("blocks unknown specialist (after capability check passes)", async () => {
      const decision = await checkSpecialistEligibility(
        "imaginary_specialist",
        "compliance.audit_readiness", // valid capability
        "professional_analysis",
        BASE_CONTEXT,
      );
      expect(decision.eligible).toBe(false);
      // Should get specialist_not_eligible_for_capability (not in eligibleRoles) OR unknown_specialist
      expect(["specialist_not_eligible_for_capability", "unknown_specialist"]).toContain(decision.reasonCode);
    });

    it("blocks when specialist is not in capability eligibleRoles", async () => {
      // research_specialist is not eligible for compliance capabilities
      const decision = await checkSpecialistEligibility(
        "research_specialist",
        "compliance.audit_readiness",
        "professional_analysis",
        BASE_CONTEXT,
      );
      expect(decision.eligible).toBe(false);
    });

    it("blocks when entitlement explicitly denied", async () => {
      const { tenantHasWorkforcePack } = await import("../services/entitlementService.js");
      vi.mocked(tenantHasWorkforcePack).mockResolvedValueOnce({
        allowed: false,
        source: "explicit_denial",
      } as any);

      const decision = await checkSpecialistEligibility(
        "compliance_officer",
        "compliance.audit_readiness",
        "professional_analysis",
        { ...BASE_CONTEXT, skipAsyncChecks: false },
      );
      expect(decision.eligible).toBe(false);
      expect(decision.reasonCode).toBe("explicitly_denied");
    });

    it("blocks when workforce pack not included", async () => {
      const { tenantHasWorkforcePack } = await import("../services/entitlementService.js");
      vi.mocked(tenantHasWorkforcePack).mockResolvedValueOnce({
        allowed: false,
        source: "plan_not_included",
      } as any);

      const decision = await checkSpecialistEligibility(
        "compliance_officer",
        "compliance.audit_readiness",
        "professional_analysis",
        { ...BASE_CONTEXT, skipAsyncChecks: false },
      );
      expect(decision.eligible).toBe(false);
      expect(decision.reasonCode).toBe("workforce_pack_not_included");
    });

    // compliance_officer was blocked before reaching the usage check (check 5: not in eligibleRoles).
    // Use operations_manager — a valid specialist — so all earlier checks pass before the usage gate.
    it("blocks when usage limit reached", async () => {
      const { checkUsage } = await import("../services/entitlementService.js");
      vi.mocked(checkUsage).mockResolvedValueOnce({ allowed: false } as any);

      const decision = await checkSpecialistEligibility(
        "operations_manager",
        "operations.workflow_review",
        "professional_analysis",
        { ...BASE_CONTEXT, skipAsyncChecks: false },
      );
      expect(decision.eligible).toBe(false);
      expect(decision.reasonCode).toBe("usage_limit_reached");
    });
  });

  describe("getEligibleSpecialists", () => {
    it("returns eligible specialist codes for a compliance capability", () => {
      const specialists = getEligibleSpecialists("compliance.audit_readiness");
      expect(Array.isArray(specialists)).toBe(true);
      expect(specialists.length).toBeGreaterThan(0);
    });

    it("returns empty array for unknown capability", () => {
      const specialists = getEligibleSpecialists("does.not.exist");
      expect(specialists).toHaveLength(0);
    });

    // Sprint 11: compliance_officer was deprecated and merged into compliance_quality_manager.
    // The capability registry now lists compliance_quality_manager as the eligible role.
    it("includes compliance_quality_manager for compliance capabilities", () => {
      const specialists = getEligibleSpecialists("compliance.audit_readiness");
      expect(specialists).toContain("compliance_quality_manager");
    });
  });

  describe("hasActiveIntelligence", () => {
    // Sprint 11: document_specialist renamed → knowledge_documentation_specialist (dna_pending, not active).
    it("returns true for compliance_quality_manager (current v2 intelligence activated)", () => {
      expect(hasActiveIntelligence("compliance_quality_manager")).toBe(true);
    });

    it("returns true for incident_safeguarding_specialist (current v2 intelligence activated)", () => {
      expect(hasActiveIntelligence("incident_safeguarding_specialist")).toBe(true);
    });

    it("returns false for knowledge_documentation_specialist (dna_pending — intelligence not yet activated)", () => {
      expect(hasActiveIntelligence("knowledge_documentation_specialist")).toBe(false);
    });

    it("returns true for operations_manager", () => {
      expect(hasActiveIntelligence("operations_manager")).toBe(true);
    });

    it("returns false for marketing_director", () => {
      expect(hasActiveIntelligence("marketing_director")).toBe(false);
    });

    it("returns false for research_specialist", () => {
      expect(hasActiveIntelligence("research_specialist")).toBe(false);
    });
  });

  describe("SpecialistEligibilityDecision interface", () => {
    it("always includes required fields", async () => {
      const decision = await checkSpecialistEligibility(
        "compliance_officer",
        "compliance.audit_readiness",
        "professional_analysis",
        BASE_CONTEXT,
      );
      expect(decision.decisionId).toBeTruthy();
      expect(decision.workforceRoleCode).toBe("compliance_officer");
      expect(decision.capabilityCode).toBe("compliance.audit_readiness");
      expect(decision.requestedLevel).toBe("professional_analysis");
      expect(typeof decision.eligible).toBe("boolean");
      expect(typeof decision.reasonCode).toBe("string");
      expect(Array.isArray(decision.reasons)).toBe(true);
      expect(typeof decision.approvalRequired).toBe("boolean");
      expect(decision.evaluatedAt).toBeTruthy();
    });

    it("includes at least one reason in the reasons array", async () => {
      const decision = await checkSpecialistEligibility(
        "compliance_officer",
        "compliance.audit_readiness",
        "professional_analysis",
        BASE_CONTEXT,
      );
      expect(decision.reasons.length).toBeGreaterThanOrEqual(1);
    });
  });
});
