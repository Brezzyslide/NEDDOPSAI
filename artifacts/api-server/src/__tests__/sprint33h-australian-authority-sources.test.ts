import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  findAuthoritiesForContext,
  getAuthorityRegistryEntries,
  isApprovedExternalSource,
  lookupAuthorityByDomain,
  lookupAuthorityById,
  scoreAuthorityForContext,
} from "../lib/authorityRegistry/index.js";

describe("Sprint 33H Australian authority source foundation", () => {
  it("registers official Australian authorities through the common registry", () => {
    const entries = getAuthorityRegistryEntries();
    const ids = entries.map(entry => entry.id);

    expect(ids).toEqual(expect.arrayContaining([
      "ar-au-001",
      "ar-au-002",
      "ar-au-003",
      "ar-au-004",
      "ar-au-005",
      "ar-au-006",
      "ar-au-007",
      "ar-au-008",
      "ar-au-009",
      "ar-au-010",
    ]));

    for (const id of ids.filter(value => value.startsWith("ar-au-0"))) {
      const entry = lookupAuthorityById(id);
      expect(entry?.status).toBe("active");
      expect(entry?.jurisdictions.length).toBeGreaterThan(0);
      expect(entry?.subjectAreas.length).toBeGreaterThan(0);
      expect(entry?.sourceClass).toBeDefined();
      expect(entry?.retrievalPolicy).toBeDefined();
      expect(entry?.currentness?.status).toBe("current");
      expect(entry?.provenance?.officialSourceUrl).toMatch(/^https:\/\//);
    }
  });

  it("classifies jurisdiction and domain relevance instead of treating .gov.au as universal", () => {
    const oaic = lookupAuthorityByDomain("www.oaic.gov.au");
    const fwo = lookupAuthorityByDomain("fairwork.gov.au");

    expect(oaic.entry?.jurisdictions).toContain("AU");
    expect(oaic.entry?.subjectAreas).toContain("privacy");
    expect(fwo.entry?.subjectAreas).toContain("employment");
    expect(fwo.entry?.subjectAreas).not.toContain("privacy");
  });

  it("ranks official authority above generic web evidence where domain-relevant", () => {
    const authorities = findAuthoritiesForContext({
      jurisdiction: "AU",
      subjectArea: "restrictive_practice",
      workforceDomain: "restrictive_practice_governance",
    });

    expect(authorities[0]?.id).toBe("ar-au-002");
    expect(isApprovedExternalSource("https://www.ndiscommission.gov.au/rules-and-standards/behaviour-support-and-restrictive-practices")?.id)
      .toBe("ar-au-002");
    expect(isApprovedExternalSource("https://random-blog.example/restrictive-practice")).toBeNull();
  });

  it("does not let a domain-mismatched authority win by being governmental", () => {
    const fwo = lookupAuthorityById("ar-au-004")!;
    const oaic = lookupAuthorityById("ar-au-007")!;

    const privacyContext = {
      jurisdiction: "AU",
      subjectArea: "privacy",
      workforceDomain: "policy_governance",
    };

    expect(scoreAuthorityForContext(oaic, privacyContext))
      .toBeGreaterThan(scoreAuthorityForContext(fwo, privacyContext));
  });

  it("keeps general web, memory and sample/example sources out of external authority", () => {
    expect(lookupAuthorityByDomain("example.com").found).toBe(false);
    expect(getAuthorityRegistryEntries().filter(entry =>
      entry.status === "active" &&
      (entry.sourceClass === "memory" || entry.sourceClass === "sample_example" || entry.sourceClass === "general_web_source")
    )).toHaveLength(0);
  });

  it("does not treat superseded authority entries as current", () => {
    const superseded = {
      ...lookupAuthorityById("ar-au-005")!,
      status: "superseded" as const,
      currentness: { status: "superseded" as const },
    };

    expect(scoreAuthorityForContext(superseded, { jurisdiction: "AU", subjectArea: "modern_awards" })).toBe(0);
    expect(isApprovedExternalSource("https://unknown-authority.example/modern-awards")).toBeNull();
  });

  it("remains extensible beyond Australia", () => {
    const entries = getAuthorityRegistryEntries();

    expect(entries.some(entry => entry.jurisdictions.includes("UK"))).toBe(true);
    expect(entries.some(entry => entry.jurisdictions.includes("GLOBAL"))).toBe(true);
    expect(entries.some(entry => entry.jurisdictions.includes("AU"))).toBe(true);
  });

  it("does not hardcode regulator URLs into professional DNA files", () => {
    const profileDir = join(process.cwd(), "../../lib/workforce-dna/src/profiles");
    const profileText = [
      "authorisedProgramOfficer.ts",
      "behaviourSupportImplementationSpecialist.ts",
      "policyGovernanceSpecialist.ts",
      "serviceDeliveryCoordinator.ts",
      "workforceRosteringCoordinator.ts",
    ].map(file => readFileSync(join(profileDir, file), "utf8")).join("\n");

    expect(profileText).not.toContain("ndiscommission.gov.au");
    expect(profileText).not.toContain("fairwork.gov.au");
    expect(profileText).not.toContain("legislation.gov.au");
  });

  it("preserves source metadata for downstream provenance work", () => {
    const entry = lookupAuthorityById("ar-au-005")!;

    expect(entry.provenance).toMatchObject({
      officialSourceUrl: "https://developer.fwc.gov.au/",
      verifiedBy: "source_registry_bootstrap",
      verifiedAt: "2026-08-14",
    });
    expect(entry.retrievalPolicy?.freshnessCheck).toBe("effective_date_required");
    expect(entry.currentness?.status).toBe("current");
  });
});
