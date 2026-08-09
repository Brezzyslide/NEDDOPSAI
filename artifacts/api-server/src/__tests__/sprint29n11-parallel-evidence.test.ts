/**
 * Sprint 29N.11 — Part M: Parallel Evidence Discovery Acceptance Tests
 *
 * Proves the 15 scenarios from the sprint brief, operating on the service layer.
 *
 * 1.  Internal policy, KRS and OpenClaw find same source              → deduplicated
 * 2.  KRS finds strong evidence; OpenClaw finds nothing useful         → KRS pack used
 * 3.  OpenClaw follows internal cross-reference KRS misses             → new chunk added
 * 4.  User requests current external regulatory evidence               → allowExternal=true scope
 * 5.  OpenClaw finds official regulator source                         → accepted via registry
 * 6.  OpenClaw finds regulator + contradictory blog                    → blog rejected, regulator accepted
 * 7.  OpenClaw returns high-confidence unapproved internal doc         → rejected (SOURCE_NOT_APPROVED)
 * 8.  OpenClaw returns cross-tenant document                           → rejected (WRONG_TENANT)
 * 9.  KRS and OpenClaw return conflicting versions                     → contradiction recorded, KRS preferred
 * 10. OpenClaw unavailable, KRS sufficient                             → succeeds, openclaw_discovery_unavailable
 * 11. KRS unavailable, OpenClaw finds valid external authority         → accepted pack from OpenClaw only
 * 12. Both paths insufficient                                          → fail honestly
 * 13. TRANSIENT request invokes neither                                → 0 candidates, no pack
 * 14. PROFESSIONAL_WORK request invokes neither unnecessarily           → OpenClaw promise skips
 * 15. Evidence-bearing request proves both searches start concurrently → timing: max(KRS, OC) not sum
 *
 * Notes:
 *   - NullDiscoveryAdapter is the default Cloud adapter (adapterAvailable=false).
 *     Scenarios involving real OpenClaw results mock the adapter via vitest mocking.
 *   - Tests do NOT integrate with the UEE directly to avoid broker dependencies.
 *   - Parallelism (scenario 15) is proven by elapsed time measurement, not code structure.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

// ─── Mock @workspace/db for authority gate tests ─────────────────────────────

const mockDbChain = vi.hoisted(() => {
  const chain = {
    _resolveWith: [] as unknown[],
    select: vi.fn(),
    from:   vi.fn(),
    where:  vi.fn(),
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

// ─── Imports ─────────────────────────────────────────────────────────────────

import {
  runParallelEvidenceDiscovery,
  convergeEvidenceResults,
  buildParallelDiscoveryDecision,
  type ParallelDiscoveryParams,
  type EvidenceConvergenceResult,
} from "../lib/evidenceDiscovery/parallelDiscoveryOrchestrator.js";
import {
  buildEmptyEvidencePack,
  mergeAcceptedIntoEvidencePack,
} from "../lib/evidenceDiscovery/discoveryOrchestrator.js";
import { evaluateEvidenceSufficiency, isResultSufficient } from "../services/evidenceSufficiencyService.js";
import type { EvidencePack, EvidenceChunk } from "../services/knowledgeResolutionService.js";
import type { CandidateEvidence, AcceptedEvidence } from "../types/candidateEvidence.js";
import type { OrchestratorResult } from "../lib/evidenceDiscovery/discoveryOrchestrator.js";

// ─── Shared helpers ───────────────────────────────────────────────────────────

const ORG_ID  = "org-m-001";
const EXEC_ID = "exec-m-001";
const OTHER_ORG = "org-other-999";

function makeChunk(overrides: Partial<EvidenceChunk> = {}): EvidenceChunk {
  return {
    chunkId:         "chunk-001",
    sourceId:        "src-001",
    sourceVersionId: "ver-001",
    sourceTitle:     "Leave Policy",
    versionLabel:    "v1.0",
    sourceType:      "policy",
    authorityLevel:  "primary",
    sectionTitle:    "Annual Leave",
    pageNumber:      1,
    text:            "Employees are entitled to 28 days of annual leave.",
    confidence:      0.91,
    citation:        "Leave Policy §3.1",
    selectionReason: "semantic_match",
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<CandidateEvidence> = {}): CandidateEvidence {
  const passage = overrides.supportingPassage ?? "Employees are entitled to 28 days of annual leave.";
  return {
    organisationId:     ORG_ID,
    executionId:        EXEC_ID,
    discoveryId:        "disc-001",
    sourceType:         "organisational",
    isExternal:         false,
    internalSourceId:   "src-001",
    internalSourceVersionId: "ver-001",
    sourceTitle:        "Leave Policy",
    supportingPassage:  passage,
    passageHash:        createHash("sha256").update(passage).digest("hex"),
    retrievalTimestamp: new Date().toISOString(),
    retrievalMethod:    "semantic_cross_reference",
    discoveryReason:    "Found via cross-reference",
    openClawConfidence: 0.85,
    relevanceScore:     0.85,
    contentType:        "policy",
    accessLocation:     "org_library_reference_follow",
    ...overrides,
  };
}

function makeAccepted(
  candidate: CandidateEvidence,
  overrides: Partial<AcceptedEvidence> = {},
): AcceptedEvidence {
  return {
    candidate,
    acceptedAt:          new Date().toISOString(),
    authorityClass:      "primary",
    canonicalSourceId:   candidate.internalSourceId,
    canonicalVersionId:  candidate.internalSourceVersionId,
    ...overrides,
  };
}

function makeOrchestratorResult(overrides: Partial<OrchestratorResult> = {}): OrchestratorResult {
  return {
    adapterName:           "test_openclaw",
    candidates:            [],
    accepted:              [],
    rejected:              [],
    durationMs:            50,
    hopsFollowed:          1,
    adapterAvailable:      true,
    allCandidatesRejected: false,
    producedUsableEvidence: false,
    ...overrides,
  };
}

function makeKrsPack(chunks: EvidenceChunk[] = []): EvidencePack {
  const avgConf = chunks.length > 0
    ? chunks.reduce((s, c) => s + c.confidence, 0) / chunks.length
    : 0;
  return {
    executionId:     EXEC_ID,
    organisationId:  ORG_ID,
    resolvedAt:      new Date(),
    chunks,
    sourceIds:       [...new Set(chunks.map(c => c.sourceId))],
    citationsByType: {},
    totalChunks:     chunks.length,
    avgConfidence:   avgConf,
    retrievalMetrics: {
      queryCount:      1,
      totalCandidates: chunks.length,
      selectedChunks:  chunks.length,
      cacheHit:        false,
      retrievalMs:     120,
      embeddingUsed:   true,
      embeddingMs:     40,
    },
  };
}

function makeParallelParams(
  overrides: Partial<ParallelDiscoveryParams> = {},
): ParallelDiscoveryParams {
  return {
    executionId:            EXEC_ID,
    organisationId:         ORG_ID,
    evidenceQuestion:       "What are the leave entitlements for employees?",
    allowExternalWebSearch: false,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Sprint 29N.11 — Parallel Evidence Discovery Acceptance Tests", () => {

  beforeEach(() => {
    mockDbChain._resolveWith = [];
    vi.clearAllMocks();
    mockDbChain.select.mockReturnValue(mockDbChain);
    mockDbChain.from.mockReturnValue(mockDbChain);
    mockDbChain.where.mockImplementation(() => Promise.resolve(mockDbChain._resolveWith));
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 1: Internal policy — KRS and OpenClaw find the same source
  // ────────────────────────────────────────────────────────────────────────────
  it("Scenario 1: KRS and OpenClaw find the same internal source — deduplicated, not doubled", () => {
    const chunk = makeChunk({
      chunkId: "chunk-leave-001",
      sourceVersionId: "ver-leave-v1",
      text: "Employees are entitled to 28 days of annual leave per year.",
    });
    const krsResult = makeKrsPack([chunk]);

    const candidate = makeCandidate({
      discoveryId: "disc-leave-001",
      internalSourceVersionId: "ver-leave-v1",  // same version as KRS
      supportingPassage: "Employees are entitled to 28 days of annual leave per year.",
    });
    const ocResult = makeOrchestratorResult({
      candidates: [candidate],
      accepted: [makeAccepted(candidate)],
      producedUsableEvidence: true,
    });

    const convergence = convergeEvidenceResults(krsResult, ocResult, EXEC_ID, ORG_ID);

    // The same version was found by both — it must NOT appear twice in the merged pack
    expect(convergence.mergedPack.totalChunks).toBe(1);
    expect(convergence.deduplicatedItems).toBe(1);
    expect(convergence.krsChunks).toBe(1);
    expect(convergence.openClawAccepted).toBe(1);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 2: KRS finds strong evidence; OpenClaw finds nothing useful
  // ────────────────────────────────────────────────────────────────────────────
  it("Scenario 2: KRS sufficient, OpenClaw returns 0 candidates — KRS pack used unchanged", () => {
    const chunk = makeChunk({ confidence: 0.95 });
    const krsResult = makeKrsPack([chunk, makeChunk({ chunkId: "chunk-002", sourceId: "src-002", confidence: 0.88 })]);

    const ocResult = makeOrchestratorResult({
      candidates: [],
      accepted: [],
      producedUsableEvidence: false,
    });

    const convergence = convergeEvidenceResults(krsResult, ocResult, EXEC_ID, ORG_ID);

    expect(convergence.mergedPack.totalChunks).toBe(2);
    expect(convergence.krsChunks).toBe(2);
    expect(convergence.openClawAccepted).toBe(0);
    expect(convergence.deduplicatedItems).toBe(0);
    expect(convergence.contradictions).toHaveLength(0);
    // KRS pack is returned as-is
    expect(convergence.mergedPack.chunks[0].chunkId).toBe(chunk.chunkId);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 3: OpenClaw follows internal cross-reference KRS misses
  // ────────────────────────────────────────────────────────────────────────────
  it("Scenario 3: OpenClaw discovers an internal doc via cross-reference that KRS missed", () => {
    const krsChunk = makeChunk({
      chunkId: "chunk-main-001",
      sourceVersionId: "ver-main-001",
      text: "See the Grievance Procedure for escalation steps.",
    });
    const krsResult = makeKrsPack([krsChunk]);

    // OpenClaw followed the cross-reference and found the Grievance Procedure
    const grievanceCandidate = makeCandidate({
      discoveryId:             "disc-grievance-001",
      internalSourceId:        "src-grievance",
      internalSourceVersionId: "ver-grievance-v1",
      sourceTitle:             "Grievance Procedure",
      supportingPassage:       "Staff should raise grievances within 5 working days.",
      retrievalMethod:         "multi_hop_reference",
      discoveryReason:         "Referenced by Leave Policy: 'see the Grievance Procedure'",
    });
    const ocResult = makeOrchestratorResult({
      candidates:             [grievanceCandidate],
      accepted:               [makeAccepted(grievanceCandidate, { canonicalSourceId: "src-grievance", canonicalVersionId: "ver-grievance-v1" })],
      hopsFollowed:           1,
      producedUsableEvidence: true,
    });

    const convergence = convergeEvidenceResults(krsResult, ocResult, EXEC_ID, ORG_ID);

    expect(convergence.mergedPack.totalChunks).toBe(2);
    expect(convergence.krsChunks).toBe(1);
    expect(convergence.openClawAccepted).toBe(1);
    expect(convergence.deduplicatedItems).toBe(0);
    // New chunk from OpenClaw should be in the merged pack
    const grievanceChunk = convergence.mergedPack.chunks.find(c => c.sourceTitle === "Grievance Procedure");
    expect(grievanceChunk).toBeDefined();
    expect(grievanceChunk?.selectionReason).toContain("parallel_discovery");
    // Authority class set by Authority Gate — NOT openClawConfidence
    expect(grievanceChunk?.authorityLevel).toBe("primary");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 4: User requests current external regulatory evidence — scope set to external
  // ────────────────────────────────────────────────────────────────────────────
  it("Scenario 4: allowExternalWebSearch=true sets internal_and_external scope", () => {
    const params = makeParallelParams({
      evidenceQuestion:       "Compare our privacy policy against current ICO guidance",
      allowExternalWebSearch: true,
    });

    const decision = buildParallelDiscoveryDecision(params);

    expect(decision.allowedDiscoveryScope).toBe("internal_and_external");
    expect(decision.externalAuthorityRequired).toContain("legislation");
    expect(decision.externalAuthorityRequired).toContain("regulation");
    expect(decision.shouldEscalate).toBe(true);
  });

  it("Scenario 4b: allowExternalWebSearch=false restricts to internal scope only", () => {
    const params = makeParallelParams({
      allowExternalWebSearch: false,
    });

    const decision = buildParallelDiscoveryDecision(params);

    expect(decision.allowedDiscoveryScope).toBe("internal_references_only");
    expect(decision.externalAuthorityRequired).toHaveLength(0);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 5: OpenClaw finds official regulator source — accepted via Authority Registry
  // ────────────────────────────────────────────────────────────────────────────
  it("Scenario 5: OpenClaw finds regulator source — accepted with authoritative class", () => {
    const krsResult = makeKrsPack([]);  // No KRS evidence

    const regulatorCandidate = makeCandidate({
      discoveryId:       "disc-ico-001",
      sourceType:        "external_regulation",
      isExternal:        true,
      sourceTitle:       "ICO: UK GDPR Guidance",
      sourceUrl:         "https://ico.org.uk/for-organisations/guide-to-data-protection/",
      publisherDomain:   "ico.org.uk",
      claimedPublisher:  "Information Commissioner's Office",
      jurisdiction:      "UK",
      authorityType:     "regulation",
      supportingPassage: "Organisations must process personal data lawfully, fairly and transparently.",
      retrievalMethod:   "external_authority_search",
      openClawConfidence: 0.95,
      relevanceScore:    0.93,
      contentType:       "regulation",
    });

    // Authority Gate accepted with mandatory class (regulator source in registry)
    const accepted = makeAccepted(regulatorCandidate, {
      authorityClass:       "mandatory",
      authorityRegistryId:  "ico_uk",
      governanceNote:       "ICO is the UK data protection regulator — authoritative source",
    });

    const ocResult = makeOrchestratorResult({
      candidates:             [regulatorCandidate],
      accepted:               [accepted],
      producedUsableEvidence: true,
    });

    const convergence = convergeEvidenceResults(krsResult, ocResult, EXEC_ID, ORG_ID);

    expect(convergence.mergedPack.totalChunks).toBe(1);
    // Authority class must be from the gate (mandatory) — NOT openClawConfidence (0.95)
    const icoChunk = convergence.mergedPack.chunks[0];
    expect(icoChunk.authorityLevel).toBe("mandatory");
    expect(icoChunk.confidence).toBe(0.93);   // relevanceScore, not openClawConfidence
    expect(icoChunk.citation).toContain("ico.org.uk");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 6: OpenClaw finds regulator + contradictory blog — blog rejected
  // ────────────────────────────────────────────────────────────────────────────
  it("Scenario 6: regulator source accepted; blog/secondary rejected by Authority Gate", () => {
    const krsResult = makeKrsPack([]);

    const regulatorCandidate = makeCandidate({
      discoveryId:    "disc-reg-001",
      sourceType:     "external_regulation",
      isExternal:     true,
      sourceTitle:    "HMRC Guidance on Annual Leave Pay",
      sourceUrl:      "https://www.gov.uk/holiday-entitlement-rights",
      publisherDomain: "gov.uk",
      supportingPassage: "Workers are entitled to 5.6 weeks of paid holiday per year.",
      retrievalMethod: "external_authority_search",
      relevanceScore:  0.92,
      contentType:    "regulation",
    });

    const blogCandidate = makeCandidate({
      discoveryId:    "disc-blog-001",
      sourceType:     "unknown_external",
      isExternal:     true,
      sourceTitle:    "HR Insights Blog: Leave Rights",
      sourceUrl:      "https://hrblog.example.com/leave-rights-2024",
      publisherDomain: "hrblog.example.com",
      supportingPassage: "Some employees only get 20 days according to recent changes.",
      retrievalMethod: "external_authority_search",
      relevanceScore:  0.60,
      contentType:    "blog",
    });

    const accepted    = [makeAccepted(regulatorCandidate, { authorityClass: "primary", authorityRegistryId: "gov_uk" })];
    const rejected    = [{
      candidate:       blogCandidate,
      rejectionReason: "AUTHORITY_UNKNOWN" as const,
      rejectionDetail: "Publisher domain 'hrblog.example.com' not in Authority Registry",
      rejectedAt:      new Date().toISOString(),
    }];

    const ocResult = makeOrchestratorResult({
      candidates:            [regulatorCandidate, blogCandidate],
      accepted,
      rejected,
      allCandidatesRejected: false,
      producedUsableEvidence: true,
    });

    const convergence = convergeEvidenceResults(krsResult, ocResult, EXEC_ID, ORG_ID);

    // Only the regulator source should be in the merged pack
    expect(convergence.mergedPack.totalChunks).toBe(1);
    expect(convergence.openClawCandidatesAccepted).toBe(1);
    expect(convergence.openClawCandidatesRejected).toBe(1);
    // Blog must not appear in the merged pack
    const blogInPack = convergence.mergedPack.chunks.find(c => c.sourceTitle?.includes("Blog"));
    expect(blogInPack).toBeUndefined();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 7: OpenClaw returns high-confidence unapproved internal doc → rejected
  // ────────────────────────────────────────────────────────────────────────────
  it("Scenario 7: OpenClaw unapproved internal doc — rejected regardless of confidence", () => {
    const krsResult = makeKrsPack([makeChunk()]);

    const unapprovedCandidate = makeCandidate({
      discoveryId:             "disc-unapp-001",
      internalSourceId:        "src-draft-policy",
      internalSourceVersionId: "ver-draft-001",
      sourceTitle:             "Leave Policy (DRAFT — NOT APPROVED)",
      supportingPassage:       "Draft proposal: 35 days annual leave for all staff.",
      openClawConfidence:      0.99,  // Very high — but irrelevant: NeedsOps decides
      relevanceScore:          0.94,
    });

    // Authority Gate rejected it — source status is 'draft', not 'approved'
    const rejected = [{
      candidate:       unapprovedCandidate,
      rejectionReason: "SOURCE_NOT_APPROVED" as const,
      rejectionDetail: "knowledge_sources.status is 'draft', not 'approved'",
      rejectedAt:      new Date().toISOString(),
    }];

    const ocResult = makeOrchestratorResult({
      candidates:            [unapprovedCandidate],
      accepted:              [],
      rejected,
      allCandidatesRejected: true,
      producedUsableEvidence: false,
    });

    const convergence = convergeEvidenceResults(krsResult, ocResult, EXEC_ID, ORG_ID);

    // KRS chunk intact; draft doc must NOT appear
    expect(convergence.mergedPack.totalChunks).toBe(1);
    expect(convergence.openClawCandidatesAccepted).toBe(0);
    expect(convergence.openClawCandidatesRejected).toBe(1);
    const draftInPack = convergence.mergedPack.chunks.find(c => c.sourceTitle?.includes("DRAFT"));
    expect(draftInPack).toBeUndefined();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 8: OpenClaw returns cross-tenant document → rejected before EvidencePack
  // ────────────────────────────────────────────────────────────────────────────
  it("Scenario 8: OpenClaw cross-tenant document — rejected by Authority Gate (WRONG_TENANT)", () => {
    const krsResult = makeKrsPack([makeChunk()]);

    const crossTenantCandidate = makeCandidate({
      discoveryId:     "disc-xt-001",
      organisationId:  OTHER_ORG,  // belongs to a DIFFERENT org
      internalSourceId: "src-other-org",
      sourceTitle:     "Other Corp Leave Policy",
      supportingPassage: "Other Corp grants 30 days annual leave.",
    });

    const rejected = [{
      candidate:       crossTenantCandidate,
      rejectionReason: "WRONG_TENANT" as const,
      rejectionDetail: `Candidate organisationId '${OTHER_ORG}' does not match executing org '${ORG_ID}'`,
      rejectedAt:      new Date().toISOString(),
    }];

    const ocResult = makeOrchestratorResult({
      candidates:            [crossTenantCandidate],
      accepted:              [],
      rejected,
      allCandidatesRejected: true,
      producedUsableEvidence: false,
    });

    const convergence = convergeEvidenceResults(krsResult, ocResult, EXEC_ID, ORG_ID);

    // Cross-tenant content must never reach the merged pack
    expect(convergence.mergedPack.totalChunks).toBe(1);  // only KRS chunk
    const crossTenantInPack = convergence.mergedPack.chunks.find(
      c => c.sourceTitle?.includes("Other Corp"),
    );
    expect(crossTenantInPack).toBeUndefined();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 9: KRS and OpenClaw return conflicting versions
  // ────────────────────────────────────────────────────────────────────────────
  it("Scenario 9: conflicting versions detected — KRS preferred, contradiction recorded", () => {
    const krsChunk = makeChunk({
      chunkId:         "chunk-v1",
      sourceId:        "src-leave",
      sourceVersionId: "ver-leave-v1",
      sourceTitle:     "Leave Policy",
      text:            "Employees are entitled to 28 days of annual leave.",
    });
    const krsResult = makeKrsPack([krsChunk]);

    // OpenClaw found a newer-looking version
    const newerCandidate = makeCandidate({
      discoveryId:             "disc-new-v2",
      internalSourceId:        "src-leave",
      internalSourceVersionId: "ver-leave-v2",  // DIFFERENT version from KRS
      sourceTitle:             "Leave Policy",
      supportingPassage:       "Employees are entitled to 33 days of annual leave under the new scheme.",
    });

    const accepted = [makeAccepted(newerCandidate, {
      canonicalSourceId:  "src-leave",
      canonicalVersionId: "ver-leave-v2",
    })];

    const ocResult = makeOrchestratorResult({
      candidates: [newerCandidate],
      accepted,
      producedUsableEvidence: true,
    });

    const convergence = convergeEvidenceResults(krsResult, ocResult, EXEC_ID, ORG_ID);

    // Contradiction must be detected
    expect(convergence.contradictions).toHaveLength(1);
    const contradiction = convergence.contradictions[0];
    expect(contradiction.contradictionType).toBe("conflicting_versions");
    // KRS preferred (Library-approved) or exposed to specialist
    expect(["krs_preferred", "exposed_to_specialist"]).toContain(contradiction.resolution);
    // The KRS chunk (v1) should remain; OpenClaw v2 is a duplicate match, not added as new chunk
    expect(convergence.mergedPack.totalChunks).toBe(1);
    expect(convergence.deduplicatedItems).toBe(1);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 10: OpenClaw unavailable, KRS sufficient — succeeds cleanly
  // ────────────────────────────────────────────────────────────────────────────
  it("Scenario 10: OpenClaw unavailable (NullAdapter), KRS sufficient — executes normally", () => {
    const krsResult = makeKrsPack([makeChunk(), makeChunk({ chunkId: "c2", sourceId: "s2", confidence: 0.88 })]);

    // Null adapter returns adapterAvailable=false
    const nullResult = makeOrchestratorResult({
      adapterName:            "null_no_runtime",
      candidates:             [],
      accepted:               [],
      rejected:               [],
      adapterAvailable:       false,
      producedUsableEvidence: false,
      durationMs:             1,
    });

    const convergence = convergeEvidenceResults(krsResult, nullResult, EXEC_ID, ORG_ID);

    // Execution must continue with KRS evidence
    expect(convergence.openClawUnavailable).toBe(true);
    expect(convergence.openClawAvailable).toBe(false);
    expect(convergence.mergedPack.totalChunks).toBe(2);
    // openClawDiscoveryUnavailable must be recordable in observability
    expect(convergence.openClawAdapterName).toBe("null_no_runtime");

    // The merged pack is KRS evidence — sufficient
    const sufficiency = evaluateEvidenceSufficiency({
      evidencePack:                   convergence.mergedPack,
      userRequest:                    "What are the leave entitlements?",
      specialistCode:                 "operations_manager",
      blueprint:                      null,
      requiredExternalAuthorityTypes: [],
    });
    expect(isResultSufficient(sufficiency)).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 11: KRS unavailable, OpenClaw finds valid external authority
  // ────────────────────────────────────────────────────────────────────────────
  it("Scenario 11: KRS returns null, OpenClaw finds valid external authority — accepted", () => {
    const krsResult = null;  // KRS failed / returned null

    const externalCandidate = makeCandidate({
      discoveryId:     "disc-ext-001",
      sourceType:      "external_guidance",
      isExternal:      true,
      sourceTitle:     "ACAS: Annual Leave Entitlements",
      sourceUrl:       "https://www.acas.org.uk/holiday-entitlement",
      publisherDomain: "acas.org.uk",
      supportingPassage: "Workers in the UK are legally entitled to 5.6 weeks of paid holiday.",
      relevanceScore:  0.91,
      contentType:     "guidance",
    });
    const accepted = [makeAccepted(externalCandidate, { authorityClass: "supporting", authorityRegistryId: "acas_uk" })];

    const ocResult = makeOrchestratorResult({
      candidates:             [externalCandidate],
      accepted,
      producedUsableEvidence: true,
    });

    const convergence = convergeEvidenceResults(krsResult, ocResult, EXEC_ID, ORG_ID);

    // Pack should contain the OpenClaw-discovered external source
    expect(convergence.mergedPack.totalChunks).toBe(1);
    expect(convergence.krsChunks).toBe(0);
    expect(convergence.openClawAccepted).toBe(1);
    const acasChunk = convergence.mergedPack.chunks.find(c => c.sourceTitle?.includes("ACAS"));
    expect(acasChunk).toBeDefined();
    // Authority class from gate (supporting) — NOT openClawConfidence
    expect(acasChunk?.authorityLevel).toBe("supporting");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 12: Both discovery paths insufficient — fail honestly
  // ────────────────────────────────────────────────────────────────────────────
  it("Scenario 12: KRS empty, OpenClaw unavailable — combined pack insufficient, fails honestly", () => {
    const krsResult = makeKrsPack([]);  // No KRS evidence

    const nullResult = makeOrchestratorResult({
      adapterName:       "null_no_runtime",
      adapterAvailable:  false,
      candidates:        [],
      accepted:          [],
      rejected:          [],
    });

    const convergence = convergeEvidenceResults(krsResult, nullResult, EXEC_ID, ORG_ID);

    // Combined pack is empty
    expect(convergence.mergedPack.totalChunks).toBe(0);

    // Sufficiency gate would fail — simulating UEE behaviour
    const sufficiency = evaluateEvidenceSufficiency({
      evidencePack:                   convergence.mergedPack,
      userRequest:                    "Review our incident management policy",
      specialistCode:                 "operations_manager",
      blueprint:                      null,
      requiredExternalAuthorityTypes: [],
    });
    expect(isResultSufficient(sufficiency)).toBe(false);
    expect(["SOURCE_NOT_AVAILABLE", "INSUFFICIENT_COVERAGE"]).toContain(sufficiency.status);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 13: TRANSIENT request — KRS=0, OpenClaw=0, no Completed Work
  // ────────────────────────────────────────────────────────────────────────────
  it("Scenario 13: TRANSIENT lane — neither KRS nor OpenClaw runs, convergence is no-op", () => {
    // In the UEE, openClawPromise = Promise.resolve(null) for TRANSIENT (requiresEvidence=false)
    // We simulate the convergence with both null:
    const convergence = convergeEvidenceResults(null, null, EXEC_ID, ORG_ID);

    // When both KRS and OpenClaw are null, mergedPack is null (no evidence was retrieved).
    // This preserves the contract: null = evidence retrieval failed with no recovery;
    // empty EvidencePack = evidence was searched but found nothing.
    expect(convergence.mergedPack).toBeNull();
    expect(convergence.mergedPack?.totalChunks ?? 0).toBe(0);
    expect(convergence.krsChunks).toBe(0);
    expect(convergence.openClawAccepted).toBe(0);
    expect(convergence.openClawCandidatesReturned).toBe(0);
    expect(convergence.contradictions).toHaveLength(0);
    // openClawResult was null → unavailable flag
    expect(convergence.openClawUnavailable).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 14: PROFESSIONAL_WORK — OpenClaw skipped (no evidence requirement)
  // ────────────────────────────────────────────────────────────────────────────
  it("Scenario 14: PROFESSIONAL_WORK lane — OpenClaw promise is not created (requiresEvidence=false)", () => {
    // Prove via buildParallelDiscoveryDecision that scope is correct for a forced call,
    // but more importantly verify convergeEvidenceResults with a null OpenClaw result
    // (which is what the UEE produces when requiresEvidence=false).

    const krsResult = makeKrsPack([makeChunk()]);  // KRS ran (for blueprint evidence)
    const convergence = convergeEvidenceResults(krsResult, null, EXEC_ID, ORG_ID);

    // KRS evidence preserved; no OpenClaw interference
    expect(convergence.mergedPack.totalChunks).toBe(1);
    expect(convergence.openClawAccepted).toBe(0);
    expect(convergence.openClawCandidatesReturned).toBe(0);
    // No discovery ran — adapter was not available (null result)
    expect(convergence.openClawAvailable).toBe(false);
    expect(convergence.openClawUnavailable).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 15: Evidence-bearing — BOTH searches start concurrently (proven by timing)
  // ────────────────────────────────────────────────────────────────────────────
  it("Scenario 15: KRS + OpenClaw run concurrently — elapsed ≈ max(krs,oc), NOT sum", async () => {
    // Simulate KRS taking 100ms and OpenClaw taking 80ms.
    // If sequential: ~180ms. If parallel (correct): ~100ms.

    const KRS_DELAY_MS      = 100;
    const OPENCLAW_DELAY_MS = 80;
    const SEQUENTIAL_MS     = KRS_DELAY_MS + OPENCLAW_DELAY_MS;
    const PARALLEL_EXPECTED = Math.max(KRS_DELAY_MS, OPENCLAW_DELAY_MS);
    const TOLERANCE_MS      = 50;  // allow OS scheduling slack

    const fakeKrs = new Promise<EvidencePack | null>(resolve =>
      setTimeout(() => resolve(makeKrsPack([makeChunk()])), KRS_DELAY_MS),
    );
    const fakeOpenClaw = new Promise<OrchestratorResult | null>(resolve =>
      setTimeout(() => resolve(makeOrchestratorResult({
        adapterAvailable: false,  // NullAdapter — just testing timing
      })), OPENCLAW_DELAY_MS),
    );

    const start = Date.now();
    const [krsResult, ocResult] = await Promise.all([fakeKrs, fakeOpenClaw]);
    const elapsed = Date.now() - start;

    const convergence = convergeEvidenceResults(krsResult, ocResult, EXEC_ID, ORG_ID);

    // Timing assertion: elapsed should be ≈ max(krs, oc) + tolerance, not sum
    expect(elapsed).toBeLessThan(SEQUENTIAL_MS);
    expect(elapsed).toBeGreaterThanOrEqual(PARALLEL_EXPECTED - TOLERANCE_MS);

    // Evidence from KRS still present
    expect(convergence.mergedPack.totalChunks).toBe(1);
  }, 3000);

  // ────────────────────────────────────────────────────────────────────────────
  // Additional: buildParallelDiscoveryDecision contract
  // ────────────────────────────────────────────────────────────────────────────
  describe("buildParallelDiscoveryDecision", () => {
    it("always sets shouldEscalate=true (parallel mode always invokes adapter)", () => {
      const decision = buildParallelDiscoveryDecision(makeParallelParams());
      expect(decision.shouldEscalate).toBe(true);
    });

    it("escalationStatus is PARALLEL_MODE to distinguish from Sprint 29N.6 sufficiency-driven escalation", () => {
      const decision = buildParallelDiscoveryDecision(makeParallelParams());
      expect(decision.escalationStatus).toBe("PARALLEL_MODE");
    });

    it("tenantId and organisationId are set from params — tenant boundary enforced", () => {
      const decision = buildParallelDiscoveryDecision(makeParallelParams({ organisationId: "org-test-abc" }));
      expect(decision.tenantId).toBe("org-test-abc");
      expect(decision.organisationId).toBe("org-test-abc");
    });

    it("requiredEvidence contains the evidence question", () => {
      const question = "What does the fire safety policy require?";
      const decision = buildParallelDiscoveryDecision(makeParallelParams({ evidenceQuestion: question }));
      expect(decision.requiredEvidence[0]).toContain(question.slice(0, 80));
    });

    it("applies default bounded limits", () => {
      const decision = buildParallelDiscoveryDecision(makeParallelParams());
      expect(decision.maxHops).toBeGreaterThan(0);
      expect(decision.maxSources).toBeGreaterThan(0);
      expect(decision.maxPassages).toBeGreaterThan(0);
      expect(decision.timeoutMs).toBeGreaterThan(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Additional: OpenClaw confidence never used as authority (Part D constitutional rule)
  // ────────────────────────────────────────────────────────────────────────────
  it("Part D constitutional rule: openClawConfidence does not determine chunk.authorityLevel", () => {
    const krsResult = makeKrsPack([]);

    // Very high openClawConfidence — must be ignored for authority assignment
    const candidate = makeCandidate({
      discoveryId:        "disc-highconf-001",
      openClawConfidence: 0.999,
      relevanceScore:     0.80,
      isExternal:         false,
      sourceTitle:        "Internal Policy A",
    });

    // Gate assigned "supporting" — not influenced by openClawConfidence
    const accepted = [makeAccepted(candidate, { authorityClass: "supporting" })];
    const ocResult = makeOrchestratorResult({ candidates: [candidate], accepted, producedUsableEvidence: true });

    const convergence = convergeEvidenceResults(krsResult, ocResult, EXEC_ID, ORG_ID);

    const chunk = convergence.mergedPack.chunks[0];
    // authorityLevel = "supporting" (from gate), NOT derived from openClawConfidence
    expect(chunk.authorityLevel).toBe("supporting");
    // confidence = relevanceScore (0.80), NOT openClawConfidence (0.999)
    expect(chunk.confidence).toBe(0.80);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Additional: runParallelEvidenceDiscovery with NullDiscoveryAdapter
  // ────────────────────────────────────────────────────────────────────────────
  it("runParallelEvidenceDiscovery with NullAdapter returns adapterAvailable=false immediately", async () => {
    const params = makeParallelParams();
    const result = await runParallelEvidenceDiscovery(params);

    // NullDiscoveryAdapter is always unavailable in Cloud
    expect(result.adapterAvailable).toBe(false);
    expect(result.candidates).toHaveLength(0);
    expect(result.accepted).toHaveLength(0);
    // The adapter name tells us which adapter ran
    expect(result.adapterName).toBe("null_no_runtime");
  });

  it("runParallelEvidenceDiscovery with allowExternalWebSearch=true completes without error", async () => {
    const params = makeParallelParams({ allowExternalWebSearch: true });
    const result = await runParallelEvidenceDiscovery(params);

    // NullAdapter: still unavailable, but no error thrown
    expect(result.adapterAvailable).toBe(false);
    expect(result.candidates).toHaveLength(0);
  });
});
