import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  resolveRegistryCodeForNewWork,
} from "../services/blueprintRegistry.js";
import {
  TARGET_BLUEPRINT_DOMAINS,
  TRUE_REGISTRY_OPERATIONS,
  auditPurposeClausePreservation,
  getClassifierRegistryEntries,
  getRestructuredRegistryEntries,
  registryDomainCounts,
  registryOperationScopeReport,
} from "../services/blueprintRegistryRestructureService.js";

describe("Sprint 41 Blueprint registry restructure", () => {
  it("projects every registry entry into the target classifier structure", () => {
    const targetEntries = getRestructuredRegistryEntries();

    expect(BLUEPRINT_REGISTRY).toHaveLength(75);
    expect(targetEntries).toHaveLength(75);

    for (const entry of targetEntries) {
      expect(entry.code).toBeTruthy();
      expect(entry.name).toBeTruthy();
      expect(TARGET_BLUEPRINT_DOMAINS).toContain(entry.domain);
      expect(entry.purpose).toBeTruthy();
      expect(entry.choose_when.length).toBeGreaterThanOrEqual(2);
      expect(entry.do_not_choose_when.length).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(entry.commonly_confused_with)).toBe(true);
      expect(entry.operations.length).toBeGreaterThanOrEqual(1);
      expect(["template", "participant_specific", "both"]).toContain(entry.specificity);
      expect(entry.authority_boundary).toBeTruthy();
    }
  });

  it("splits source supportedModes into closed-set operations and free-form scopes", () => {
    const trueOperations = new Set<string>(TRUE_REGISTRY_OPERATIONS);
    const report = registryOperationScopeReport();

    expect(report).toHaveLength(75);
    for (const row of report) {
      expect(row.operations.length).toBeGreaterThan(0);
      expect(row.operations.every((operation) => trueOperations.has(operation))).toBe(true);
      expect(row.scopes.every((scope) => !trueOperations.has(scope))).toBe(true);
    }

    const communityRisk = report.find((row) => row.code === "community_access_risk_assessment");
    expect(communityRisk?.operations).toContain("assess");
    expect(communityRisk?.scopes).toContain("community_access");

    const schads = report.find((row) => row.code === "schads_award_analysis");
    expect(schads?.operations).toContain("assess");
    expect(schads?.scopes).toContain("schads_analysis");
  });

  it("collapses the registry to the 11 target domains", () => {
    const counts = registryDomainCounts();

    expect(Object.keys(counts).sort()).toEqual([...TARGET_BLUEPRINT_DOMAINS].sort());
    expect(Object.values(counts).reduce((sum, value) => sum + value, 0)).toBe(75);
    expect(counts.participant_support).toBeGreaterThan(1);
    expect(counts.risk_emergency).toBeGreaterThan(1);
    expect(counts.workforce).toBeGreaterThan(1);
  });

  it("removes the legacy regulatory_change_impact alias from classifier options only", () => {
    const options = getClassifierRegistryEntries();
    const codes = options.map((option) => option.code);

    expect(codes).toHaveLength(74);
    expect(codes).toContain("regulatory_change_impact_assessment");
    expect(codes).not.toContain("regulatory_change_impact");
    expect(resolveRegistryCodeForNewWork("regulatory_change_impact")).toBe("regulatory_change_impact_assessment");
    expect(BLUEPRINT_REGISTRY.some((entry) => entry.code === "regulatory_change_impact")).toBe(true);
  });

  it("preserves all source authority and exclusion clauses verbatim", () => {
    const preservation = auditPurposeClausePreservation();

    expect(preservation.length).toBeGreaterThan(0);
    expect(preservation.filter((item) => item.status === "MISSING")).toEqual([]);
    expect(preservation.every((item) => item.status === "PRESERVED VERBATIM")).toBe(true);
  });

  it("marks authored boundary content for founder review", () => {
    const stubs = getRestructuredRegistryEntries().filter((entry) =>
      entry.authority_boundary_source === "authored_review_required",
    );

    expect(stubs.length).toBeGreaterThan(0);
    expect(stubs.every((entry) => entry.authority_boundary.includes("[AUTHORED — REVIEW REQUIRED]"))).toBe(true);
    expect(stubs.some((entry) => entry.code === "fire_risk_assessment")).toBe(true);
  });
});
