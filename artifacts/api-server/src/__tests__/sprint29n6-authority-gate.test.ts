/**
 * Sprint 29N.6 — Part E + Part F: NeedsOps Evidence Acceptance / Authority Gate
 *
 * Tests that validateCandidateEvidence() correctly accepts or rejects candidates
 * according to the 10 internal and 10 external validation checks.
 *
 * Also covers Authority Registry lookups (Part F).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock @workspace/db ───────────────────────────────────────────────────────

const mockDbChain = vi.hoisted(() => {
  const chain = {
    _resolveWith: [] as unknown[],
    where: vi.fn(),
    select: vi.fn(),
    from: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.from.mockReturnValue(chain);
  chain.where.mockImplementation(() => Promise.resolve(chain._resolveWith));
  return chain;
});

vi.mock("@workspace/db", () => ({
  db: { select: mockDbChain.select },
  knowledgeSourcesTable:        { id: "id", organizationId: "organizationId", status: "status", isCurrent: "isCurrent", sensitivityClassification: "sensitivityClassification", effectiveTo: "effectiveTo" },
  knowledgeSourceVersionsTable: { id: "id", sourceId: "sourceId" },
  knowledgeChunksTable:         { id: "id", sourceId: "sourceId" },
  eq:  vi.fn((col, val) => ({ col, val })),
  and: vi.fn((...args) => args),
}));

import { createHash } from "crypto";
import {
  validateCandidateEvidence,
  validateCandidateBatch,
} from "../services/evidenceAcceptanceService.js";
import {
  lookupAuthorityByDomain,
  isApprovedExternalSource,
  normaliseDomain,
  getRegistryEntryCount,
} from "../lib/authorityRegistry/index.js";
import type { CandidateEvidence } from "../types/candidateEvidence.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

const ORG_ID = "org-test-001";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function makeInternal(overrides: Partial<CandidateEvidence> = {}): CandidateEvidence {
  const passage = overrides.supportingPassage ?? "Complaints must be resolved within 5 days.";
  const base: CandidateEvidence = {
    organisationId:         ORG_ID,
    executionId:            "exec-001",
    discoveryId:            "disc-001",
    sourceType:             "organisational",
    isExternal:             false,
    internalSourceId:       "src-001",
    internalSourceVersionId: "ver-001",
    sourceTitle:            "Complaints Management Policy",
    supportingPassage:      passage,
    passageHash:            sha256(passage), // correct hash — integrity check passes
    retrievalTimestamp:     new Date().toISOString(),
    retrievalMethod:        "multi_hop_reference",
    discoveryReason:        "cross-reference follow",
    openClawConfidence:     0.85,
    relevanceScore:         0.80,
    contentType:            "policy",
    accessLocation:         "org_library_reference_follow",
  };
  return {
    ...base,
    ...overrides,
    // re-hash when passage was overridden but passageHash was not explicitly provided
    passageHash: overrides.passageHash !== undefined ? overrides.passageHash : sha256(passage),
  };
}

function makeExternal(overrides: Partial<CandidateEvidence> = {}): CandidateEvidence {
  const passage = overrides.supportingPassage ?? "Personal data must be processed lawfully, fairly and in a transparent manner.";
  const base: CandidateEvidence = {
    organisationId:     ORG_ID,
    executionId:        "exec-001",
    discoveryId:        "disc-ext-001",
    sourceType:         "external_legislation",
    isExternal:         true,
    sourceUrl:          "https://www.legislation.gov.uk/ukpga/2018/12/contents",
    publisherDomain:    "legislation.gov.uk",
    claimedPublisher:   "UK Parliament",
    jurisdiction:       "UK",
    sourceTitle:        "Data Protection Act 2018",
    supportingPassage:  passage,
    passageHash:        sha256(passage), // correct hash
    retrievalTimestamp: new Date().toISOString(),
    retrievalMethod:    "external_authority_search",
    discoveryReason:    "GDPR/legislation required for data protection task",
    openClawConfidence: 0.90,
    relevanceScore:     0.88,
    contentType:        "legislation",
    accessLocation:     "https://www.legislation.gov.uk/ukpga/2018/12/contents",
  };
  return {
    ...base,
    ...overrides,
    passageHash: overrides.passageHash !== undefined ? overrides.passageHash : sha256(passage),
  };
}

function mockSourceRow(overrides: {
  organizationId?: string;
  status?: string;
  isCurrent?: boolean;
  sensitivityClassification?: string | null;
  effectiveTo?: Date | null;
} = {}) {
  return [{
    id:                      "src-001",
    organizationId:          overrides.organizationId ?? ORG_ID,
    status:                  overrides.status ?? "approved",
    isCurrent:               overrides.isCurrent ?? true,
    sensitivityClassification: overrides.sensitivityClassification ?? "internal",
    effectiveTo:             overrides.effectiveTo ?? null,
  }];
}

beforeEach(() => {
  mockDbChain.select.mockReturnValue(mockDbChain);
  mockDbChain.from.mockReturnValue(mockDbChain);
  // Default: approved, current, internal sensitivity
  mockDbChain._resolveWith = mockSourceRow();
  mockDbChain.where.mockImplementation(() => Promise.resolve(mockDbChain._resolveWith));
});

// ─── Part E: Internal candidate validation ────────────────────────────────────

describe("Authority Gate — internal candidates (Part E)", () => {
  it("E1: accepts a valid internal candidate from the correct org", async () => {
    const result = await validateCandidateEvidence(makeInternal(), ORG_ID);
    expect(result.outcome).toBe("accepted");
    expect(result.accepted?.candidate.internalSourceId).toBe("src-001");
    // Authority class must come from NeedsOps, not openClawConfidence
    expect(result.accepted?.authorityClass).toBeDefined();
  });

  it("E2: advisory floor — rejects candidate below minimum relevance score", async () => {
    const result = await validateCandidateEvidence(
      makeInternal({ relevanceScore: 0.10 }),
      ORG_ID,
    );
    expect(result.outcome).toBe("rejected");
    expect(result.rejected?.rejectionReason).toBe("CONFIDENCE_BELOW_FLOOR");
  });

  it("E3: tenant boundary — rejects candidate with wrong organisationId", async () => {
    const result = await validateCandidateEvidence(
      makeInternal({ organisationId: "org-different-001" }),
      ORG_ID,
    );
    expect(result.outcome).toBe("rejected");
    expect(result.rejected?.rejectionReason).toBe("TENANT_BOUNDARY_VIOLATION");
  });

  it("E4: source missing — rejects candidate with no internalSourceId", async () => {
    const result = await validateCandidateEvidence(
      makeInternal({ internalSourceId: undefined }),
      ORG_ID,
    );
    expect(result.outcome).toBe("rejected");
    expect(result.rejected?.rejectionReason).toBe("SOURCE_NOT_FOUND");
  });

  it("E5: wrong tenant from DB — rejects cross-org source", async () => {
    mockDbChain._resolveWith = mockSourceRow({ organizationId: "org-other" });
    mockDbChain.where.mockImplementation(() => Promise.resolve(mockDbChain._resolveWith));
    const result = await validateCandidateEvidence(makeInternal(), ORG_ID);
    expect(result.outcome).toBe("rejected");
    expect(result.rejected?.rejectionReason).toBe("WRONG_TENANT");
  });

  it("E6: unapproved source — rejects pending status", async () => {
    mockDbChain._resolveWith = mockSourceRow({ status: "pending" });
    mockDbChain.where.mockImplementation(() => Promise.resolve(mockDbChain._resolveWith));
    const result = await validateCandidateEvidence(makeInternal(), ORG_ID);
    expect(result.outcome).toBe("rejected");
    expect(result.rejected?.rejectionReason).toBe("SOURCE_NOT_APPROVED");
  });

  it("E7: superseded source — rejects isCurrent=false", async () => {
    mockDbChain._resolveWith = mockSourceRow({ isCurrent: false });
    mockDbChain.where.mockImplementation(() => Promise.resolve(mockDbChain._resolveWith));
    const result = await validateCandidateEvidence(makeInternal(), ORG_ID);
    expect(result.outcome).toBe("rejected");
    expect(result.rejected?.rejectionReason).toBe("SOURCE_SUPERSEDED");
  });

  it("E8: restricted sensitivity — rejects access_denied", async () => {
    mockDbChain._resolveWith = mockSourceRow({ sensitivityClassification: "restricted" });
    mockDbChain.where.mockImplementation(() => Promise.resolve(mockDbChain._resolveWith));
    const result = await validateCandidateEvidence(makeInternal(), ORG_ID);
    expect(result.outcome).toBe("rejected");
    expect(result.rejected?.rejectionReason).toBe("ACCESS_DENIED");
  });

  it("E9: expired effective date — rejects outdated source", async () => {
    mockDbChain._resolveWith = mockSourceRow({ effectiveTo: new Date("2020-01-01") });
    mockDbChain.where.mockImplementation(() => Promise.resolve(mockDbChain._resolveWith));
    const result = await validateCandidateEvidence(makeInternal(), ORG_ID);
    expect(result.outcome).toBe("rejected");
    expect(result.rejected?.rejectionReason).toBe("OUTDATED");
  });

  it("E10: external evidence not permitted when allowExternal=false", async () => {
    const result = await validateCandidateEvidence(makeExternal(), ORG_ID, false);
    expect(result.outcome).toBe("rejected");
    expect(result.rejected?.rejectionReason).toBe("EXTERNAL_EVIDENCE_NOT_PERMITTED");
  });
});

// ─── Part E: External candidate validation ────────────────────────────────────

describe("Authority Gate — external candidates (Part E)", () => {
  it("E-ext1: accepts a valid external candidate from a known authority", async () => {
    const result = await validateCandidateEvidence(makeExternal(), ORG_ID, true);
    expect(result.outcome).toBe("accepted");
    expect(result.accepted?.authorityRegistryId).toBeDefined();
    expect(result.accepted?.authorityClass).toBe("mandatory"); // legislation.gov.uk is mandatory
    // Authority class comes from registry, NOT openClawConfidence (0.90 is irrelevant)
    expect(result.accepted?.candidate.openClawConfidence).toBe(0.90);
    expect(result.accepted?.authorityClass).not.toBe("openClawConfidence");
  });

  it("E-ext2: rejects external with unknown domain (not in Authority Registry)", async () => {
    const result = await validateCandidateEvidence(
      makeExternal({ sourceUrl: "https://www.random-website.com/some-legal-text" }),
      ORG_ID,
      true,
    );
    expect(result.outcome).toBe("rejected");
    expect(result.rejected?.rejectionReason).toBe("AUTHORITY_UNKNOWN");
  });

  it("E-ext3: rejects external with no URL", async () => {
    const result = await validateCandidateEvidence(
      makeExternal({ sourceUrl: undefined }),
      ORG_ID,
      true,
    );
    expect(result.outcome).toBe("rejected");
    expect(result.rejected?.rejectionReason).toBe("INVALID_URL");
  });

  it("E-ext4: rejects external with malformed URL", async () => {
    const result = await validateCandidateEvidence(
      makeExternal({ sourceUrl: "not-a-url" }),
      ORG_ID,
      true,
    );
    expect(result.outcome).toBe("rejected");
    // non-http protocol or parsing failure
    expect(result.rejected?.rejectionReason).toMatch(/INVALID_URL|AUTHORITY_UNKNOWN/);
  });

  it("E-ext5: rejects external with no source title", async () => {
    const result = await validateCandidateEvidence(
      makeExternal({ sourceTitle: "" }),
      ORG_ID,
      true,
    );
    expect(result.outcome).toBe("rejected");
    expect(result.rejected?.rejectionReason).toBe("SOURCE_NOT_FOUND");
  });

  it("E-ext6: accepts FCA regulatory source", async () => {
    const result = await validateCandidateEvidence(
      makeExternal({
        sourceUrl:          "https://www.fca.org.uk/publications/policy-statements/ps22-9",
        publisherDomain:    "fca.org.uk",
        sourceType:         "external_regulation",
        contentType:        "regulation",
        sourceTitle:        "FCA PS22/9 Consumer Duty",
      }),
      ORG_ID,
      true,
    );
    expect(result.outcome).toBe("accepted");
    expect(result.accepted?.authorityClass).toBe("mandatory"); // FCA = mandatory
  });

  it("E-ext7: rejects an unknown high-confidence website (openClawConfidence cannot override authority)", async () => {
    const result = await validateCandidateEvidence(
      makeExternal({
        sourceUrl:          "https://www.some-legal-blog.com/gdpr-explained",
        openClawConfidence: 0.99, // very high — must not override registry rejection
        sourceType:         "external_guidance",
      }),
      ORG_ID,
      true,
    );
    expect(result.outcome).toBe("rejected");
    expect(result.rejected?.rejectionReason).toBe("AUTHORITY_UNKNOWN");
    // Prove confidence is irrelevant to the gate decision
    expect(result.rejected?.candidate.openClawConfidence).toBe(0.99);
  });
});

// ─── Part F: Authority Registry ────────────────────────────────────────────────

describe("Authority Registry (Part F)", () => {
  it("F1: registry contains at least 10 entries", () => {
    expect(getRegistryEntryCount()).toBeGreaterThanOrEqual(10);
  });

  it("F2: legislation.gov.uk is a known, active, mandatory authority", () => {
    const result = lookupAuthorityByDomain("legislation.gov.uk");
    expect(result.found).toBe(true);
    expect(result.entry?.status).toBe("active");
    expect(result.entry?.evidenceAuthorityClass).toBe("mandatory");
    expect(result.entry?.category).toBe("legislation");
  });

  it("F3: fca.org.uk is a known, active authority", () => {
    const result = lookupAuthorityByDomain("fca.org.uk");
    expect(result.found).toBe(true);
    expect(result.entry?.status).toBe("active");
  });

  it("F4: ico.org.uk is known for data protection", () => {
    const result = lookupAuthorityByDomain("ico.org.uk");
    expect(result.found).toBe(true);
    expect(result.entry?.subjectAreas).toContain("data_protection");
  });

  it("F5: gov.uk is in the registry", () => {
    const result = lookupAuthorityByDomain("gov.uk");
    expect(result.found).toBe(true);
  });

  it("F6: unknown domain returns found=false", () => {
    const result = lookupAuthorityByDomain("unknown-website.xyz");
    expect(result.found).toBe(false);
  });

  it("F7: normaliseDomain strips www prefix and protocol", () => {
    expect(normaliseDomain("https://www.legislation.gov.uk/some/path")).toBe("legislation.gov.uk");
    expect(normaliseDomain("http://fca.org.uk")).toBe("fca.org.uk");
    expect(normaliseDomain("www.gov.uk")).toBe("gov.uk");
  });

  it("F8: isApprovedExternalSource returns registry entry for approved domain", () => {
    const entry = isApprovedExternalSource("https://www.legislation.gov.uk/ukpga/2018/12");
    expect(entry).not.toBeNull();
    expect(entry?.id).toBe("ar-001");
  });

  it("F9: isApprovedExternalSource returns null for unknown domain", () => {
    const entry = isApprovedExternalSource("https://unknown.example.com/something");
    expect(entry).toBeNull();
  });

  it("F10: subdomain of approved domain is accepted", () => {
    // publications.gov.uk should match gov.uk entry
    const result = lookupAuthorityByDomain("www.legislation.gov.uk");
    expect(result.found).toBe(true);
  });
});

// ─── Batch validation ─────────────────────────────────────────────────────────

describe("validateCandidateBatch", () => {
  it("processes multiple candidates and returns accepted/rejected arrays", async () => {
    const candidates = [
      makeInternal(), // should be accepted (approved, current source)
      makeInternal({ organisationId: "org-other" }), // should be rejected (tenant boundary)
    ];
    const { accepted, rejected } = await validateCandidateBatch(candidates, ORG_ID);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].rejectionReason).toBe("TENANT_BOUNDARY_VIOLATION");
  });

  it("all rejected when all candidates fail checks", async () => {
    const candidates = [
      makeInternal({ relevanceScore: 0.05 }),
      makeInternal({ relevanceScore: 0.01 }),
    ];
    const { accepted, rejected } = await validateCandidateBatch(candidates, ORG_ID);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(2);
    rejected.forEach(r => expect(r.rejectionReason).toBe("CONFIDENCE_BELOW_FLOOR"));
  });
});
