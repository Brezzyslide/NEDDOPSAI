import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

import { mapKnowledgeCurrentness } from "../lib/knowledge/currentness.js";
import { projectKnowledgeCitationsToEvidenceReferences } from "../lib/knowledge/evidenceReferenceProjection.js";

const CHECKED_AT = "2026-08-14T05:00:00.000Z";

describe("Sprint 33I.1 currentness model", () => {
  it("maps an approved current source version to CURRENT", () => {
    expect(mapKnowledgeCurrentness({
      isCurrent: true,
      sourceVersionIsCurrent: true,
      sourceVersionStatus: "approved",
      checkedAt: CHECKED_AT,
      version: "v3",
    })).toMatchObject({ status: "CURRENT", version: "v3", supersededStatus: null });
  });

  it("maps historical source versions to HISTORICAL", () => {
    expect(mapKnowledgeCurrentness({
      isCurrent: false,
      sourceVersionIsCurrent: false,
      sourceVersionStatus: "historical",
      checkedAt: CHECKED_AT,
    }).status).toBe("HISTORICAL");
  });

  it("does not promote superseded source versions to CURRENT", () => {
    expect(mapKnowledgeCurrentness({
      isCurrent: false,
      sourceVersionIsCurrent: false,
      sourceVersionStatus: "superseded",
      checkedAt: CHECKED_AT,
    })).toMatchObject({ status: "SUPERSEDED", supersededStatus: "superseded" });
  });

  it("keeps unknown status as UNKNOWN", () => {
    expect(mapKnowledgeCurrentness({ checkedAt: CHECKED_AT }).status).toBe("UNKNOWN");
  });

  it("does not infer CURRENT from retrieval time for expired material", () => {
    expect(mapKnowledgeCurrentness({
      isCurrent: true,
      sourceVersionIsCurrent: true,
      sourceVersionStatus: "approved",
      effectiveTo: "2026-08-13T23:59:59.000Z",
      checkedAt: CHECKED_AT,
    })).toMatchObject({ status: "EXPIRED", supersededStatus: "approved" });
  });

  it("allows historical retrieval without relabelling the evidence as current", () => {
    expect(mapKnowledgeCurrentness({
      isCurrent: false,
      sourceVersionIsCurrent: false,
      sourceVersionStatus: "superseded",
      historicalEvidenceAllowed: true,
      checkedAt: CHECKED_AT,
    })).toMatchObject({ status: "HISTORICAL", supersededStatus: "superseded" });
  });

  it("keeps memory history from becoming CURRENT", () => {
    expect(mapKnowledgeCurrentness({
      isCurrent: false,
      sourceVersionStatus: "historical",
      checkedAt: CHECKED_AT,
    }).status).toBe("HISTORICAL");
  });
});

describe("Sprint 33I.1 SpecialistContext provenance projection", () => {
  it("projects canonical citations into legacy EvidenceReference with provenance intact", () => {
    const refs = projectKnowledgeCitationsToEvidenceReferences([
      {
        citationId: "cite-1",
        chunkId: "chunk-1",
        sourceId: "source-1",
        versionId: "version-1",
        sourceTitle: "Federal Register of Legislation",
        sectionTitle: "Part 1",
        pageNumber: null,
        headingPath: null,
        authorityLevel: "mandatory",
        sensitivityClassification: "public",
        priorityLayer: "library",
        provider: "authority_registry",
        finalScore: 1,
        semanticScore: 0.9,
        lexicalScore: 0.8,
        reasonSelected: "legislative_authority",
        provenance: {
          sourceOrigin: "external_authority",
          authorityRegistryId: "ar-au-001",
          authorityName: "Federal Register of Legislation",
          authorityClass: "PRIMARY_LEGISLATION",
          jurisdiction: "AU_COMMONWEALTH",
          transport: "API_PUBLIC",
          originalUrl: "https://www.legislation.gov.au/",
          retrievedAt: CHECKED_AT,
        },
        currentness: {
          status: "CURRENT",
          checkedAt: CHECKED_AT,
          version: "current",
          supersededStatus: null,
        },
      },
    ]);

    expect(refs).toEqual([
      expect.objectContaining({
        referenceType: "document",
        referenceId: "chunk-1",
        sourceId: "source-1",
        sourceVersionId: "version-1",
        sourceTitle: "Federal Register of Legislation",
        authorityName: "Federal Register of Legislation",
        authorityClass: "PRIMARY_LEGISLATION",
        jurisdiction: "AU_COMMONWEALTH",
        transport: "API_PUBLIC",
        currentness: "CURRENT",
        sourceOrigin: "external_authority",
      }),
    ]);
  });

  it("retains one legacy function as a thin canonical wrapper instead of a second evidence path", () => {
    const servicePath = fileURLToPath(new URL("../services/specialistContextService.ts", import.meta.url));
    const source = readFileSync(servicePath, "utf8");
    const legacyBody = source.slice(source.indexOf("export async function buildSpecialistContext"));

    expect(legacyBody).toContain("const canonicalContext = await loadSpecialistContext");
    expect(legacyBody).toContain("projectKnowledgeCitationsToEvidenceReferences");
    expect(legacyBody).not.toContain("evidenceReferences: []");
  });

  it("keeps current-only retrieval guarded against historical/superseded source versions", () => {
    const retrievalPath = fileURLToPath(new URL("../services/hybridRetrievalService.ts", import.meta.url));
    const source = readFileSync(retrievalPath, "utf8");

    expect(source).toContain("ksv.is_current");
    expect(source).toMatch(/NOT IN \('superseded',\s*'archived',\s*'revoked',\s*'failed'\)/);
  });
});
