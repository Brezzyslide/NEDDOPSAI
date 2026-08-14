import { describe, expect, it } from "vitest";
import {
  resolveAuthoritiesForRequirement,
  lookupAuthorityById,
  scoreAuthorityForContext,
  validateGovernedWebUrl,
} from "../lib/authorityRegistry/index.js";
import { searchFederalRegisterTitles } from "../lib/authorityRegistry/federalRegisterClient.js";
import { buildAcceptedEvidenceChunk } from "../lib/authorityRegistry/evidenceProvenance.js";
import type { AcceptedEvidence, CandidateEvidence } from "../types/candidateEvidence.js";
import { assembleRuntimeInstructions } from "../../../../lib/agent-runtime/src/runtimeInstructionAssembler.js";

function candidate(overrides: Partial<CandidateEvidence> = {}): CandidateEvidence {
  return {
    organisationId: "org-1",
    executionId: "exec-1",
    discoveryId: "disc-1",
    sourceType: "external_regulation",
    isExternal: true,
    sourceUrl: "https://www.ndiscommission.gov.au/rules-and-standards",
    publisherDomain: "ndiscommission.gov.au",
    claimedPublisher: "NDIS Quality and Safeguards Commission",
    jurisdiction: "AU_NATIONAL",
    sourceTitle: "NDIS Commission guidance",
    supportingPassage: "Registered NDIS providers must meet their conditions of registration.",
    passageHash: "hash-not-checked-in-this-test",
    retrievalTimestamp: "2026-08-14T04:00:00.000Z",
    retrievalMethod: "governed_web",
    discoveryReason: "authority routing regression",
    authorityType: "regulation",
    publicationDate: "2026-08-01",
    effectiveDate: undefined,
    openClawConfidence: 0.99,
    relevanceScore: 0.87,
    contentType: "guidance",
    accessLocation: "https://www.ndiscommission.gov.au/rules-and-standards",
    ...overrides,
  };
}

function accepted(overrides: Partial<AcceptedEvidence> = {}): AcceptedEvidence {
  const cand = candidate(overrides.candidate);
  return {
    candidate: cand,
    acceptedAt: "2026-08-14T04:01:00.000Z",
    authorityClass: "primary",
    authorityRegistryId: "ar-au-002",
    governanceNote: "accepted by registry",
    ...overrides,
  };
}

describe("Sprint 33I authority routing and provenance", () => {
  it("resolves Federal Register as approved Commonwealth primary legislation authority", () => {
    const [resolution] = resolveAuthoritiesForRequirement({
      domain: "LEGISLATION",
      subject: "commonwealth_legislation",
      jurisdiction: "AU_COMMONWEALTH",
      requiredAuthorityClass: "primary_law",
      currentnessRequirement: "CURRENT_REQUIRED",
      externalEvidenceRequired: true,
    });

    expect(resolution.source.id).toBe("ar-au-001");
    expect(resolution.selectedTransport).toBe("API_PUBLIC");
    expect(resolution.source.apiBaseUrl).toBe("https://api.prod.legislation.gov.au/v1");
  });

  it("models NDIS Commission as governed web/document authority without an invented API", () => {
    const source = lookupAuthorityById("ar-au-002")!;

    expect(source.apiStatus).toBe("NOT_AVAILABLE");
    expect(source.preferredTransport).toBe("GOVERNED_WEB");
    expect(source.approvedDomains).toEqual(["ndiscommission.gov.au"]);
  });

  it("models FWC as API available, credentials not configured, with governed-web fallback", () => {
    const [resolution] = resolveAuthoritiesForRequirement({
      domain: "INDUSTRIAL_RELATIONS",
      subject: "modern_awards",
      jurisdiction: "AU_NATIONAL",
      externalEvidenceRequired: true,
    });

    expect(resolution.source.id).toBe("ar-au-005");
    expect(resolution.source.apiStatus).toBe("AVAILABLE");
    expect(resolution.source.credentialStatus).toBe("NOT_CONFIGURED");
    expect(resolution.selectedTransport).toBe("GOVERNED_WEB");
  });

  it("keeps api.gov.au out of substantive regulatory authority ranking", () => {
    const apiGov = lookupAuthorityById("ar-au-012")!;
    const ndis = lookupAuthorityById("ar-au-002")!;

    expect(apiGov.sourceClass).toBe("government_api_discovery");
    expect(scoreAuthorityForContext(ndis, { professionalDomain: "NDIS_REGULATION", subjectArea: "restrictive_practice", jurisdiction: "AU_NATIONAL" }))
      .toBeGreaterThan(scoreAuthorityForContext(apiGov, { professionalDomain: "NDIS_REGULATION", subjectArea: "restrictive_practice", jurisdiction: "AU_NATIONAL" }));
  });

  it("prefers Victorian WorkSafe authority for Victorian WHS requirements", () => {
    const [resolution] = resolveAuthoritiesForRequirement({
      domain: "WORK_HEALTH_SAFETY",
      subject: "workplace_safety",
      jurisdiction: "VIC",
      externalEvidenceRequired: true,
    });

    expect(resolution.source.id).toBe("ar-vic-003");
  });

  it("rejects unapproved domains masquerading as authority", () => {
    expect(validateGovernedWebUrl("https://ndiscommission.example/rules").ok).toBe(false);
  });

  it("rejects arbitrary web results even when the topic is relevant", () => {
    expect(validateGovernedWebUrl("https://random-blog.example/restrictive-practice").reason).toBe("AUTHORITY_UNKNOWN");
  });

  it("preserves provenance from accepted evidence into EvidencePack chunks", () => {
    const chunk = buildAcceptedEvidenceChunk(accepted(), "test");

    expect(chunk.provenance).toMatchObject({
      sourceOrigin: "external_authority",
      authorityRegistryId: "ar-au-002",
      authorityName: "NDIS Quality and Safeguards Commission",
      originalUrl: "https://www.ndiscommission.gov.au/rules-and-standards",
    });
  });

  it("keeps historical or superseded evidence distinguishable", () => {
    const chunk = buildAcceptedEvidenceChunk(
      accepted({ candidate: candidate({ publicationDate: "2020-01-01" }) }),
      "test",
    );

    expect(chunk.currentness?.status).toBe("UNKNOWN");
    expect(chunk.currentness?.status).not.toBe("CURRENT");
  });

  it("does not promote unknown currentness to current", () => {
    const chunk = buildAcceptedEvidenceChunk(accepted(), "test");

    expect(chunk.currentness?.status).toBe("UNKNOWN");
  });

  it("fails safe when a required primary authority cannot be resolved", () => {
    const resolutions = resolveAuthoritiesForRequirement({
      domain: "NDIS_REGULATION",
      subject: "not_a_real_subject",
      jurisdiction: "VIC",
      requiredAuthorityClass: "primary_law",
      currentnessRequirement: "CURRENT_REQUIRED",
      externalEvidenceRequired: true,
    });

    expect(resolutions).toEqual([]);
  });

  it("does not fabricate API evidence when credentials are absent", () => {
    const source = lookupAuthorityById("ar-au-005")!;

    expect(source.credentialStatus).toBe("NOT_CONFIGURED");
    expect(source.currentTransport).toBe("GOVERNED_WEB");
  });

  it("source access does not imply WorkerProfile execution authority", () => {
    const source = lookupAuthorityById("ar-au-002")!;

    expect(source).not.toHaveProperty("allowedTools");
    expect(source).not.toHaveProperty("allowedConnectors");
    expect(source).not.toHaveProperty("allowedChannels");
  });

  it("Blueprints cannot grant execution authority through source access", () => {
    const resolution = resolveAuthoritiesForRequirement({ domain: "NDIS_REGULATION", subject: "provider_registration", jurisdiction: "AU_NATIONAL" })[0];

    expect(resolution).not.toHaveProperty("executionConstraints");
    expect(resolution.source).not.toHaveProperty("blueprintPermissions");
  });

  it("OpenClaw-bound evidence remains evidence metadata, not action permission", () => {
    const chunk = buildAcceptedEvidenceChunk(accepted(), "test");

    expect(chunk.provenance?.transport).toBe("GOVERNED_WEB");
    expect(chunk.provenance).not.toHaveProperty("tools");
  });

  it("keeps internal and external evidence distinguishable", () => {
    const external = buildAcceptedEvidenceChunk(accepted(), "test");
    const internal = buildAcceptedEvidenceChunk(
      accepted({
        candidate: candidate({ isExternal: false, sourceType: "organisational", sourceUrl: undefined, publisherDomain: undefined }),
        canonicalSourceId: "ks-1",
        canonicalVersionId: "ksv-1",
        authorityRegistryId: undefined,
      }),
      "test",
    );

    expect(external.provenance?.sourceOrigin).toBe("external_authority");
    expect(internal.provenance?.sourceOrigin).toBe("internal_krs");
  });

  it("routes specialists by professional domain rather than hardcoded URL", () => {
    const restrictivePractice = resolveAuthoritiesForRequirement({ domain: "RESTRICTIVE_PRACTICE", subject: "restrictive_practice", jurisdiction: "VIC" });

    expect(restrictivePractice.map(r => r.source.id)).toEqual(expect.arrayContaining(["ar-vic-002", "ar-au-002"]));
  });

  it("keeps tenant isolation as execution metadata outside source resolution", () => {
    const resolutions = resolveAuthoritiesForRequirement({ domain: "PRIVACY", subject: "privacy", jurisdiction: "AU_NATIONAL" });

    expect(resolutions[0]).not.toHaveProperty("organisationId");
    expect(resolutions[0].source).not.toHaveProperty("organisationId");
  });

  it("maps Federal Register API search metadata without live network in unit tests", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      value: [{
        id: "C2004A03712",
        name: "Privacy Act 1988",
        collection: "Act",
        status: "InForce",
        isInForce: true,
        makingDate: "1988-12-14T00:00:00",
        asMadeRegisteredAt: "2004-04-21T00:00:00",
      }],
    }), { status: 200 });

    const [title] = await searchFederalRegisterTitles({ search: "Privacy Act", pageSize: 1, fetchImpl });

    expect(title).toMatchObject({
      id: "C2004A03712",
      name: "Privacy Act 1988",
      currentness: "CURRENT",
      sourceUrl: "https://www.legislation.gov.au/C2004A03712",
    });
  });

  it("preserves provenance through SpecialistContext-style sections into runtime instructions", () => {
    const sections = ["## RETRIEVED KNOWLEDGE\nRestrictive-practice evidence text."];

    const runtime = assembleRuntimeInstructions({
      specialistId: "authorised_program_officer",
      workforceRole: "authorised_program_officer",
      displayName: "Authorised Program Officer",
      domain: "Restrictive Practice Governance",
      dnaProfileId: "authorised_program_officer",
      dnaVersion: "1.0.0",
      manifestVersion: 1,
      mission: "Review restrictive-practice governance evidence.",
      objectives: ["Use current verified evidence."],
      responsibilities: ["Analyse evidence."],
      operatingPrinciples: ["Evidence access is not execution authority."],
      communicationStyle: { tone: "professional", detailLevel: "concise", language: "plain" },
      competencies: [],
      escalationRules: [],
      prohibitedBehaviours: [],
      memoryPolicy: { allowedScopes: [], prohibitedScopes: [] },
      manifestHash: "hash",
      generatedAt: "2026-08-14T04:00:00.000Z",
    } as any, [{
      sequence: 1,
      specialist: "authorised_program_officer",
      action: "review_evidence",
      description: "Review evidence only.",
      requiresApproval: false,
    }], {
      maxDurationSeconds: 300,
      requireHumanApprovalBeforeSubmit: false,
      allowedDataCategories: ["public"],
    }, {
      retrievedKnowledge: {
        sections,
        totalChunks: 1,
        tokenBudgetUsed: 12,
        citationIds: ["cit-1"],
        citations: [{
          citationId: "cit-1",
          chunkId: "chunk-1",
          sourceId: "ar-au-002",
          versionId: null,
          sourceTitle: "NDIS Commission restrictive-practice guidance",
          authorityLevel: "primary",
          priorityLayer: "entity",
          provider: "authority_resolver",
          finalScore: 0.9,
          reasonSelected: "authority_requirement",
          provenance: {
            sourceOrigin: "external_authority",
            authorityRegistryId: "ar-au-002",
            authorityName: "NDIS Quality and Safeguards Commission",
            authorityClass: "regulator",
            jurisdiction: "AU_NATIONAL",
            professionalDomains: ["NDIS_REGULATION", "RESTRICTIVE_PRACTICE"],
            transport: "GOVERNED_WEB",
          },
          currentness: { status: "UNKNOWN", checkedAt: "2026-08-14T04:00:00.000Z" },
        }],
        conflictCount: 0,
        auditEventId: "audit-1",
      },
    });

    expect(runtime.instruction).toContain("EVIDENCE PROVENANCE");
    expect(runtime.instruction).toContain("authority=NDIS Quality and Safeguards Commission");
    expect(runtime.instruction).toContain("currentness=UNKNOWN");
    expect(runtime.instruction).toContain("does not grant execution authority");
  });
});
