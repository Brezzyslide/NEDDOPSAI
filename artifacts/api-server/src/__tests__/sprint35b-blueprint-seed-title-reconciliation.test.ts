import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  LEGACY_CODE_MAP,
  getRegistryEntry,
  resolveRegistryCodeForNewWork,
} from "../services/blueprintRegistry.js";

const ROOT = resolve(__dirname, "../../../..");

function readSource(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

function seedRegistrySource(): string {
  const source = readSource("artifacts/api-server/src/services/workBlueprintService.ts");
  const seedStart = source.indexOf("export async function seedRegistryBlueprints");
  const seedEnd = source.indexOf("function registryContractSeedValues", seedStart);
  expect(seedStart).toBeGreaterThanOrEqual(0);
  expect(seedEnd).toBeGreaterThan(seedStart);
  return source.slice(seedStart, seedEnd);
}

function existingGlobalUpdateSource(): string {
  const seedSource = seedRegistrySource();
  const updateStart = seedSource.indexOf("if (existing.length > 0)");
  const insertStart = seedSource.indexOf("const blueprintId = randomUUID()", updateStart);
  expect(updateStart).toBeGreaterThanOrEqual(0);
  expect(insertStart).toBeGreaterThan(updateStart);
  return seedSource.slice(updateStart, insertStart);
}

describe("Sprint 35B — Blueprint seed title reconciliation", () => {
  it("1. existing global registry rows reconcile stale titles from the registry source", () => {
    const updateSource = existingGlobalUpdateSource();

    expect(updateSource).toContain("title: entry.title");
    expect(updateSource.indexOf("title: entry.title")).toBeLessThan(updateSource.indexOf("blueprintFamily: entry.blueprintFamily"));
  });

  it("2. existing global lookup remains constrained to platform rows only", () => {
    const seedSource = seedRegistrySource();
    const lookupStart = seedSource.indexOf(".select({");
    const updateStart = seedSource.indexOf("if (existing.length > 0)", lookupStart);
    const lookupSource = seedSource.slice(lookupStart, updateStart);

    expect(lookupSource).toContain("eq(workBlueprintsTable.code, entry.code)");
    expect(lookupSource).toContain("isNull(workBlueprintsTable.organizationId)");
  });

  it("3. existing global update keeps the same Blueprint row identity", () => {
    const updateSource = existingGlobalUpdateSource();

    expect(updateSource).toContain(".where(eq(workBlueprintsTable.id, existingRow.id))");
    expect(updateSource).not.toContain("id: randomUUID()");
    expect(updateSource).not.toContain("id: entry.");
  });

  it("4. existing global update does not rewrite code, version or organization identity", () => {
    const updateSource = existingGlobalUpdateSource();

    expect(updateSource).not.toContain("code:");
    expect(updateSource).not.toContain("version:");
    expect(updateSource).not.toContain("organizationId:");
  });

  it("5. organisation-owned rows with the same code are protected from title reconciliation", () => {
    const seedSource = seedRegistrySource();

    expect(seedSource).toContain("isNull(workBlueprintsTable.organizationId)");
    expect(seedSource).not.toContain("eq(workBlueprintsTable.organizationId,");
  });

  it("6. insert path still uses registry titles for missing global rows", () => {
    const seedSource = seedRegistrySource();
    const insertStart = seedSource.indexOf("await db.insert(workBlueprintsTable).values({");
    const insertSource = seedSource.slice(insertStart);

    expect(insertSource).toContain("title: entry.title");
    expect(insertSource).toContain("code: entry.code");
    expect(insertSource).toContain("version: \"1.0.0\"");
    expect(insertSource).toContain("organizationId: null");
  });

  it("7. objective is not reconciled by the existing-row registry update in this narrow patch", () => {
    const updateSource = existingGlobalUpdateSource();
    const insertSource = seedRegistrySource().slice(seedRegistrySource().indexOf("await db.insert(workBlueprintsTable).values({"));

    expect(updateSource).not.toContain("objective:");
    expect(insertSource).toContain("objective: `[PLACEHOLDER] ${entry.purpose}`");
  });

  it("8. DB-only rows are not deleted by registry seed reconciliation", () => {
    const seedSource = seedRegistrySource();

    expect(seedSource).not.toContain(".delete(");
    expect(seedSource).not.toContain("db.delete(workBlueprintsTable)");
  });

  it("9. registry seed does not introduce historical table writes", () => {
    const seedSource = seedRegistrySource();

    expect(seedSource).not.toContain("completedWork");
    expect(seedSource).not.toContain("workPackage");
    expect(seedSource).not.toContain("blueprintVersionsTable");
    expect(seedSource).not.toContain("tasksTable");
  });

  it("10. compatibility identities remain canonicalised without becoming duplicate professional methods", () => {
    expect(LEGACY_CODE_MAP.regulatory_change_impact).toBe("regulatory_change_impact_assessment");
    expect(resolveRegistryCodeForNewWork("regulatory_change_impact")).toBe("regulatory_change_impact_assessment");
    expect(getRegistryEntry("regulatory_change_impact")?.title).toContain("Compatibility Route");

    expect(LEGACY_CODE_MAP.customer_response).toBe("formal_stakeholder_correspondence");
    expect(resolveRegistryCodeForNewWork("customer_response")).toBe("formal_stakeholder_correspondence");
    expect(getRegistryEntry("formal_stakeholder_correspondence")?.legacyCode).toBe("customer_response");
  });
});
