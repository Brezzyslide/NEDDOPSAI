/**
 * Sprint 29N.6 — Part C: Evidence Escalation Policy
 *
 * Tests that buildEscalationDecision() correctly translates every
 * EvidenceSufficiencyResult status into the right EvidenceEscalationDecision.
 */

import { describe, it, expect } from "vitest";
import {
  buildEscalationDecision,
  shouldRunDiscovery,
  type EvidenceEscalationDecision,
} from "../services/evidenceEscalationService.js";
import type { EvidenceSufficiencyResult } from "../services/evidenceSufficiencyService.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const IDENTITY = {
  executionId:    "exec-test-001",
  organisationId: "org-test-001",
  evidencePackId: "pack-v1",
};

function makeResult(
  status: EvidenceSufficiencyResult["status"],
  overrides: Partial<EvidenceSufficiencyResult> = {},
): EvidenceSufficiencyResult {
  return {
    status,
    isEscalationRecommended: status !== "SUFFICIENT" && status !== "AUTHORITY_GAP",
    coverageScore: 0.5,
    unresolvedReferences: [],
    requiredExternalAuthorityTypes: [],
    missingAuthorityTypes: [],
    ...overrides,
  };
}

// ─── No-escalation cases ───────────────────────────────────────────────────────

describe("buildEscalationDecision — no escalation", () => {
  it("SUFFICIENT: shouldEscalate=false, scope=none", () => {
    const decision = buildEscalationDecision(makeResult("SUFFICIENT"), IDENTITY);
    expect(decision.shouldEscalate).toBe(false);
    expect(decision.allowedDiscoveryScope).toBe("none");
    expect(shouldRunDiscovery(decision)).toBe(false);
  });

  it("AUTHORITY_GAP: shouldEscalate=false — this is a Library governance issue", () => {
    const decision = buildEscalationDecision(makeResult("AUTHORITY_GAP"), IDENTITY);
    expect(decision.shouldEscalate).toBe(false);
    expect(decision.allowedDiscoveryScope).toBe("none");
    expect(shouldRunDiscovery(decision)).toBe(false);
    expect(decision.reason).toContain("governance");
  });

  it("INSUFFICIENT_COVERAGE with no cross-refs: shouldEscalate=false", () => {
    const decision = buildEscalationDecision(
      makeResult("INSUFFICIENT_COVERAGE", { unresolvedReferences: [] }),
      IDENTITY,
    );
    expect(decision.shouldEscalate).toBe(false);
    expect(decision.allowedDiscoveryScope).toBe("none");
    // Should tell the user to upload documents
    expect(decision.reason).toContain("Knowledge Library");
  });

  it("LOW_CONFIDENCE with no cross-refs: shouldEscalate=false", () => {
    const decision = buildEscalationDecision(
      makeResult("LOW_CONFIDENCE", { unresolvedReferences: [] }),
      IDENTITY,
    );
    expect(decision.shouldEscalate).toBe(false);
    expect(decision.allowedDiscoveryScope).toBe("none");
  });
});

// ─── Escalation cases ─────────────────────────────────────────────────────────

describe("buildEscalationDecision — escalation triggered", () => {
  it("UNRESOLVED_REFERENCE: shouldEscalate=true, scope=internal_references_only", () => {
    const decision = buildEscalationDecision(
      makeResult("UNRESOLVED_REFERENCE", {
        unresolvedReferences: [
          { referencedTitle: "Escalation Procedure", chunkText: "", position: 0 },
        ],
      }),
      IDENTITY,
    );
    expect(decision.shouldEscalate).toBe(true);
    expect(decision.allowedDiscoveryScope).toBe("internal_references_only");
    expect(shouldRunDiscovery(decision)).toBe(true);
    expect(decision.unresolvedReferences).toContain("Escalation Procedure");
    expect(decision.requiredEvidence).toHaveLength(1);
  });

  it("UNRESOLVED_REFERENCE: lists all unresolved references", () => {
    const decision = buildEscalationDecision(
      makeResult("UNRESOLVED_REFERENCE", {
        unresolvedReferences: [
          { referencedTitle: "Escalation Procedure", chunkText: "", position: 0 },
          { referencedTitle: "Incident Management Policy", chunkText: "", position: 1 },
        ],
      }),
      IDENTITY,
    );
    expect(decision.unresolvedReferences).toHaveLength(2);
    expect(decision.unresolvedReferences).toContain("Escalation Procedure");
    expect(decision.unresolvedReferences).toContain("Incident Management Policy");
  });

  it("EXTERNAL_AUTHORITY_REQUIRED: shouldEscalate=true, scope=external_authority_only", () => {
    const decision = buildEscalationDecision(
      makeResult("EXTERNAL_AUTHORITY_REQUIRED", {
        requiredExternalAuthorityTypes: ["legislation", "regulation"],
      }),
      IDENTITY,
    );
    expect(decision.shouldEscalate).toBe(true);
    expect(decision.allowedDiscoveryScope).toBe("external_authority_only");
    expect(shouldRunDiscovery(decision)).toBe(true);
    expect(decision.externalAuthorityRequired).toContain("legislation");
    expect(decision.externalAuthorityRequired).toContain("regulation");
  });

  it("SOURCE_NOT_AVAILABLE: shouldEscalate=true, scope=internal_references_only", () => {
    const decision = buildEscalationDecision(makeResult("SOURCE_NOT_AVAILABLE"), IDENTITY);
    expect(decision.shouldEscalate).toBe(true);
    expect(decision.allowedDiscoveryScope).toBe("internal_references_only");
  });

  it("INSUFFICIENT_COVERAGE with cross-refs: shouldEscalate=true", () => {
    const decision = buildEscalationDecision(
      makeResult("INSUFFICIENT_COVERAGE", {
        unresolvedReferences: [
          { referencedTitle: "HR Disciplinary Procedure", chunkText: "", position: 0 },
        ],
      }),
      IDENTITY,
    );
    expect(decision.shouldEscalate).toBe(true);
    expect(decision.allowedDiscoveryScope).toBe("internal_references_only");
    expect(decision.unresolvedReferences).toContain("HR Disciplinary Procedure");
  });

  it("LOW_CONFIDENCE with cross-refs: shouldEscalate=true", () => {
    const decision = buildEscalationDecision(
      makeResult("LOW_CONFIDENCE", {
        unresolvedReferences: [
          { referencedTitle: "Complaints Escalation Procedure", chunkText: "", position: 0 },
        ],
      }),
      IDENTITY,
    );
    expect(decision.shouldEscalate).toBe(true);
    expect(decision.allowedDiscoveryScope).toBe("internal_references_only");
  });
});

// ─── Hard limits ──────────────────────────────────────────────────────────────

describe("buildEscalationDecision — default limits", () => {
  it("sets conservative default hop and source limits", () => {
    const decision = buildEscalationDecision(
      makeResult("UNRESOLVED_REFERENCE", {
        unresolvedReferences: [{ referencedTitle: "X", chunkText: "", position: 0 }],
      }),
      IDENTITY,
    );
    expect(decision.maxHops).toBe(2);
    expect(decision.maxSources).toBe(5);
    expect(decision.maxPassages).toBe(3);
    expect(decision.timeoutMs).toBe(15_000);
  });
});

// ─── Identity fields ──────────────────────────────────────────────────────────

describe("buildEscalationDecision — identity propagation", () => {
  it("carries executionId and organisationId through to the decision", () => {
    const decision = buildEscalationDecision(makeResult("SOURCE_NOT_AVAILABLE"), IDENTITY);
    expect(decision.executionId).toBe("exec-test-001");
    expect(decision.organisationId).toBe("org-test-001");
    expect(decision.tenantId).toBe("org-test-001");
    expect(decision.originalEvidencePackId).toBe("pack-v1");
  });

  it("falls back to executionId when evidencePackId is not provided", () => {
    const decision = buildEscalationDecision(makeResult("SOURCE_NOT_AVAILABLE"), {
      executionId:    "exec-002",
      organisationId: "org-002",
    });
    expect(decision.originalEvidencePackId).toBe("exec-002");
  });

  it("preserves the triggering sufficiency status", () => {
    const decision = buildEscalationDecision(makeResult("EXTERNAL_AUTHORITY_REQUIRED", {
      requiredExternalAuthorityTypes: ["legislation"],
    }), IDENTITY);
    expect(decision.escalationStatus).toBe("EXTERNAL_AUTHORITY_REQUIRED");
  });
});
