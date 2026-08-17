import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns } from "drizzle-orm";

interface StoredProfile {
  [key: string]: unknown;
  id: string;
  specialistId: string;
  version: string;
  status?: string;
  retiredAt?: Date | null;
  versionHash?: string;
}

interface StoredCompetency {
  [key: string]: unknown;
  dnaProfileId: string;
  competencyCode: string;
}

const state = vi.hoisted(() => ({
  profiles: [] as StoredProfile[],
  competencies: [] as StoredCompetency[],
  profileInsertPayloads: [] as Array<Record<string, unknown>>,
  failCompetencyInsert: false,
  reset() {
    this.profiles.length = 0;
    this.competencies.length = 0;
    this.profileInsertPayloads.length = 0;
    this.failCompetencyInsert = false;
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();

  function selectedRows(table: unknown, selection?: Record<string, unknown>) {
    if (table === actual.specialistDnaProfilesTable) {
      if (!selection) return state.profiles;
      return state.profiles.map(profile => {
        const selected: Record<string, unknown> = {};
        for (const key of Object.keys(selection)) selected[key] = profile[key];
        return selected;
      });
    }
    if (table === actual.specialistDnaCompetenciesTable) {
      return state.competencies;
    }
    return [];
  }

  const db = {
    select: vi.fn((selection?: Record<string, unknown>) => ({
      from(table: unknown) {
        const chain = {
          where: vi.fn(() => chain),
          orderBy: vi.fn(() => chain),
          limit: vi.fn((count: number) => {
            const rows = selectedRows(table, selection);
            if (table === actual.specialistDnaProfilesTable) {
              return Promise.resolve(
                rows
                  .filter(row => (row as StoredProfile).status === undefined || (row as StoredProfile).status === "published")
                  .slice()
                  .reverse()
                  .slice(0, count),
              );
            }
            return Promise.resolve(rows.slice(0, count));
          }),
          then: (
            resolve: (value: unknown[]) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.resolve(selectedRows(table, selection)).then(resolve, reject),
        };
        return chain;
      },
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((payload: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const values = Array.isArray(payload) ? payload : [payload];
        if (table === actual.specialistDnaProfilesTable) {
          for (const value of values) {
            state.profileInsertPayloads.push(value);
            state.profiles.push(value as StoredProfile);
          }
        }
        if (table === actual.specialistDnaCompetenciesTable) {
          if (state.failCompetencyInsert) {
            throw new Error("simulated competency insert failure");
          }
          state.competencies.push(...(values as StoredCompetency[]));
        }
        return Promise.resolve();
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((payload: Record<string, unknown>) => ({
        where: vi.fn(() => {
          if (table === actual.specialistDnaProfilesTable) {
            for (const profile of state.profiles) {
              if (profile.status === "published") {
                Object.assign(profile, payload);
              }
            }
          }
          return Promise.resolve();
        }),
      })),
    })),
    transaction: vi.fn(async (callback: (tx: typeof db) => Promise<unknown>) => {
      const profileSnapshot = state.profiles.map(profile => ({ ...profile }));
      const competencySnapshot = state.competencies.map(competency => ({ ...competency }));
      const payloadSnapshot = state.profileInsertPayloads.map(payload => ({ ...payload }));
      try {
        return await callback(db);
      } catch (error) {
        state.profiles.splice(0, state.profiles.length, ...profileSnapshot);
        state.competencies.splice(0, state.competencies.length, ...competencySnapshot);
        state.profileInsertPayloads.splice(0, state.profileInsertPayloads.length, ...payloadSnapshot);
        throw error;
      }
    }),
  };

  return {
    ...actual,
    db,
  };
});

import {
  specialistDnaProfilesTable,
} from "@workspace/db";
import {
  CANONICAL_DNA_PROJECTION_VERSION,
  AUTHORISED_PROGRAM_OFFICER_DNA,
  BEHAVIOUR_SUPPORT_IMPLEMENTATION_SPECIALIST_DNA,
  CHIEF_OF_STAFF_DNA,
  OPERATIONS_MANAGER_DNA,
  POLICY_GOVERNANCE_SPECIALIST_DNA,
  SERVICE_DELIVERY_COORDINATOR_DNA,
  WORKFORCE_ROSTERING_COORDINATOR_DNA,
} from "@workspace/workforce-dna";
import {
  loadDNAFromDatabase,
  buildWorkforceDnaPublicationInventory,
  reconcileWorkforceDnaPublication,
  seedDNAFromStaticRegistry,
} from "../services/dnaStorageService.js";
import { getCurrentSpecialists } from "../lib/workforceRegistry.js";

describe("DNA static seed canonical schema compatibility", () => {
  beforeEach(() => {
    state.reset();
  });

  it("seeds published DNA without targeting optional legacy columns", async () => {
    const result = await seedDNAFromStaticRegistry("chief_of_staff", "live_replit_seed");

    expect(result).toBe("created");
    expect(state.profileInsertPayloads).toHaveLength(1);
    expect(state.profileInsertPayloads[0]).not.toHaveProperty("changeDescription");
    expect(state.profileInsertPayloads[0]).not.toHaveProperty("publishedBy");
    expect(Object.keys(getTableColumns(specialistDnaProfilesTable))).not.toContain("changeDescription");
    expect(Object.keys(getTableColumns(specialistDnaProfilesTable))).not.toContain("publishedBy");
  });

  it("persists canonical metadata, canonical profile and runtime projection", async () => {
    await seedDNAFromStaticRegistry("chief_of_staff", "live_replit_seed");

    const row = state.profiles[0]!;
    expect(row.specialistId).toBe("chief_of_staff");
    expect(row.dnaId).toBe("chief_of_staff");
    expect(row.version).toBe(CHIEF_OF_STAFF_DNA.currentVersion.version);
    expect(row.versionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.ownerType).toBe("platform");
    expect(row.visibilityTier).toBe("platform_private");
    expect(row.professionalReviewRequired).toBe(false);
    expect(row.approvedBy).toBe(CHIEF_OF_STAFF_DNA.currentVersion.publishedBy);
    expect(row.changeReason).toBe(CHIEF_OF_STAFF_DNA.currentVersion.changeDescription);
    expect(row.status).toBe("published");
    expect(row.immutablePublishedSnapshot).toBe(true);
    expect(row.canonicalProfile).toMatchObject({
      identity: { specialistId: "chief_of_staff" },
      versioning: { dnaId: "chief_of_staff" },
    });
    expect(row.runtimeProjection).toMatchObject({
      projectionVersion: CANONICAL_DNA_PROJECTION_VERSION,
    });
  });

  it("returns already_exists on the second seed and does not duplicate competencies", async () => {
    const first = await seedDNAFromStaticRegistry("chief_of_staff", "live_replit_seed");
    const second = await seedDNAFromStaticRegistry("chief_of_staff", "live_replit_seed");

    expect(first).toBe("created");
    expect(second).toBe("already_exists");
    expect(state.profiles).toHaveLength(1);
    expect(state.competencies).toHaveLength(CHIEF_OF_STAFF_DNA.competencies.length);
  });

  it("preserves older published rows as retired when a new source version is published", async () => {
    state.profiles.push({
      id: "old-chief-dna",
      specialistId: "chief_of_staff",
      version: "0.9.0",
      versionHash: "oldhash",
      status: "published",
    });

    const result = await seedDNAFromStaticRegistry("chief_of_staff", "live_replit_seed");

    expect(result).toBe("created");
    expect(state.profiles).toHaveLength(2);
    expect(state.profiles[0]?.status).toBe("retired");
    expect(state.profiles[0]?.retiredAt).toBeInstanceOf(Date);
    expect(state.profiles[1]?.status).toBe("published");
    expect(state.profiles[1]?.version).toBe(CHIEF_OF_STAFF_DNA.currentVersion.version);
  });

  it("generates competency IDs required by the live table schema", async () => {
    await seedDNAFromStaticRegistry("chief_of_staff", "live_replit_seed");

    expect(state.competencies).toHaveLength(CHIEF_OF_STAFF_DNA.competencies.length);
    for (const competency of state.competencies) {
      expect(competency.id).toEqual(expect.any(String));
      expect(competency.dnaProfileId).toBe(state.profiles[0]?.id);
    }
  });

  it("rolls back the parent profile if competency insertion fails", async () => {
    state.failCompetencyInsert = true;

    await expect(seedDNAFromStaticRegistry("chief_of_staff", "live_replit_seed"))
      .rejects.toThrow("simulated competency insert failure");

    expect(state.profiles).toHaveLength(0);
    expect(state.competencies).toHaveLength(0);
    expect(state.profileInsertPayloads).toHaveLength(0);
  });

  it("detects an existing published profile with missing competencies instead of returning already_exists", async () => {
    state.profiles.push({
      id: "3322bf05-c6f4-472b-89e5-22afbc7e0def",
      specialistId: "chief_of_staff",
      version: CHIEF_OF_STAFF_DNA.currentVersion.version,
    });

    await expect(seedDNAFromStaticRegistry("chief_of_staff", "live_replit_seed"))
      .rejects.toMatchObject({
        code: "INCOMPLETE_DNA_PUBLICATION",
        profileId: "3322bf05-c6f4-472b-89e5-22afbc7e0def",
      });

    expect(state.profiles).toHaveLength(1);
    expect(state.competencies).toHaveLength(0);
  });

  it("loads the seeded published profile through database resolution", async () => {
    await seedDNAFromStaticRegistry("chief_of_staff", "live_replit_seed");

    const resolved = await loadDNAFromDatabase("chief_of_staff");

    expect(resolved).not.toBeNull();
    expect(resolved?.source).toBe("database");
    expect(resolved?.dnaId).toBe("chief_of_staff");
    expect(resolved?.versionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(resolved?.canonicalProfile?.identity.specialistId).toBe("chief_of_staff");
    expect(resolved?.runtimeProjection?.projectionVersion).toBe(CANONICAL_DNA_PROJECTION_VERSION);
    expect(resolved?.competencies).toHaveLength(CHIEF_OF_STAFF_DNA.competencies.length);
  });

  it("recognises Authorised Program Officer on the static DB publication path", async () => {
    const result = await seedDNAFromStaticRegistry("authorised_program_officer", "live_replit_seed");

    expect(result).toBe("created");
    const row = state.profiles[0]!;
    expect(row.specialistId).toBe("authorised_program_officer");
    expect(row.dnaId).toBe("authorised_program_officer");
    expect(row.version).toBe(AUTHORISED_PROGRAM_OFFICER_DNA.currentVersion.version);
    expect(row.versionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.canonicalProfile).toMatchObject({
      identity: { specialistId: "authorised_program_officer" },
      requiredWorkerProfile: { profileCode: "authorised_program_officer_profile" },
    });
    expect(row.runtimeProjection).toMatchObject({
      projectionVersion: CANONICAL_DNA_PROJECTION_VERSION,
    });
    expect(state.competencies).toHaveLength(AUTHORISED_PROGRAM_OFFICER_DNA.competencies.length);
  });

  it("recognises Behaviour Support Implementation Specialist on the static DB publication path", async () => {
    const result = await seedDNAFromStaticRegistry("behaviour_support_implementation_specialist", "live_replit_seed");

    expect(result).toBe("created");
    const row = state.profiles[0]!;
    expect(row.specialistId).toBe("behaviour_support_implementation_specialist");
    expect(row.dnaId).toBe("behaviour_support_implementation_specialist");
    expect(row.version).toBe(BEHAVIOUR_SUPPORT_IMPLEMENTATION_SPECIALIST_DNA.currentVersion.version);
    expect(row.versionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.canonicalProfile).toMatchObject({
      identity: { specialistId: "behaviour_support_implementation_specialist" },
      requiredWorkerProfile: { profileCode: "behaviour_support_implementation_specialist_profile" },
    });
    expect(row.runtimeProjection).toMatchObject({
      projectionVersion: CANONICAL_DNA_PROJECTION_VERSION,
    });
    expect(state.competencies).toHaveLength(BEHAVIOUR_SUPPORT_IMPLEMENTATION_SPECIALIST_DNA.competencies.length);
  });

  it("recognises Policy & Governance Specialist on the static DB publication path", async () => {
    const result = await seedDNAFromStaticRegistry("policy_governance_specialist", "live_replit_seed");

    expect(result).toBe("created");
    const row = state.profiles[0]!;
    expect(row.specialistId).toBe("policy_governance_specialist");
    expect(row.dnaId).toBe("policy_governance_specialist");
    expect(row.version).toBe(POLICY_GOVERNANCE_SPECIALIST_DNA.currentVersion.version);
    expect(row.versionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.canonicalProfile).toMatchObject({
      identity: { specialistId: "policy_governance_specialist" },
      requiredWorkerProfile: { profileCode: "policy_governance_specialist_profile" },
    });
    expect(row.runtimeProjection).toMatchObject({
      projectionVersion: CANONICAL_DNA_PROJECTION_VERSION,
    });
    expect(state.competencies).toHaveLength(POLICY_GOVERNANCE_SPECIALIST_DNA.competencies.length);
  });

  it("recognises Service Delivery Coordinator on the static DB publication path", async () => {
    const result = await seedDNAFromStaticRegistry("service_delivery_coordinator", "live_replit_seed");

    expect(result).toBe("created");
    const row = state.profiles[0]!;
    expect(row.specialistId).toBe("service_delivery_coordinator");
    expect(row.dnaId).toBe("service_delivery_coordinator");
    expect(row.version).toBe(SERVICE_DELIVERY_COORDINATOR_DNA.currentVersion.version);
    expect(row.versionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.canonicalProfile).toMatchObject({
      identity: { specialistId: "service_delivery_coordinator" },
      requiredWorkerProfile: { profileCode: "service_delivery_coordinator_profile" },
    });
    expect(row.runtimeProjection).toMatchObject({
      projectionVersion: CANONICAL_DNA_PROJECTION_VERSION,
    });
    expect(state.competencies).toHaveLength(SERVICE_DELIVERY_COORDINATOR_DNA.competencies.length);
  });

  it("recognises Workforce Rostering Coordinator on the static DB publication path", async () => {
    const result = await seedDNAFromStaticRegistry("workforce_rostering_coordinator", "live_replit_seed");

    expect(result).toBe("created");
    const row = state.profiles[0]!;
    expect(row.specialistId).toBe("workforce_rostering_coordinator");
    expect(row.dnaId).toBe("workforce_rostering_coordinator");
    expect(row.version).toBe(WORKFORCE_ROSTERING_COORDINATOR_DNA.currentVersion.version);
    expect(row.versionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.canonicalProfile).toMatchObject({
      identity: { specialistId: "workforce_rostering_coordinator" },
      requiredWorkerProfile: { profileCode: "workforce_rostering_coordinator_profile" },
    });
    expect(row.runtimeProjection).toMatchObject({
      projectionVersion: CANONICAL_DNA_PROJECTION_VERSION,
    });
    expect(state.competencies).toHaveLength(WORKFORCE_ROSTERING_COORDINATOR_DNA.competencies.length);
  });

  it("discovers every current-v2 approved runtime-ready specialist through the generic publication mechanism", async () => {
    const inventory = await buildWorkforceDnaPublicationInventory();
    const eligible = inventory.filter(entry => entry.staticDbPublicationEligible);
    const expected = getCurrentSpecialists().filter(s =>
      s.catalogueVersion === "2" &&
      s.executionStatus === "available" &&
      s.dnaStatus === "approved"
    );

    expect(eligible.map(entry => entry.roleCode).sort()).toEqual(expected.map(s => s.code).sort());
    expect(eligible).toHaveLength(15);
    expect(eligible.every(entry => entry.status === "NEW")).toBe(true);
  });

  it("excludes dna_pending specialists from DB publication eligibility", async () => {
    const inventory = await buildWorkforceDnaPublicationInventory();
    const pending = inventory.filter(entry => entry.executionStatus === "dna_pending");

    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every(entry => entry.staticDbPublicationEligible === false)).toBe(true);
    expect(pending.every(entry => entry.status === "NOT_PUBLICATION_ELIGIBLE")).toBe(true);
  });

  it("does not make a dna_pending role executable merely because a DB row exists", async () => {
    state.profiles.push({
      id: "pending-role-dna",
      specialistId: "finance_officer",
      version: "2.0.0",
      status: "published",
      versionHash: "not-source-truth",
    });

    const inventory = await buildWorkforceDnaPublicationInventory(["finance_officer"]);

    expect(inventory).toHaveLength(1);
    expect(inventory[0]?.dbPublished).toBe(true);
    expect(inventory[0]?.staticDbPublicationEligible).toBe(false);
    expect(inventory[0]?.status).toBe("NOT_PUBLICATION_ELIGIBLE");
  });

  it("reports unchanged DNA as idempotent without creating duplicate versions", async () => {
    await seedDNAFromStaticRegistry("chief_of_staff", "live_replit_seed");

    const first = await reconcileWorkforceDnaPublication({ roleCodes: ["chief_of_staff"] });
    const second = await reconcileWorkforceDnaPublication({ roleCodes: ["chief_of_staff"], apply: true });

    expect(first.entries[0]?.status).toBe("UNCHANGED");
    expect(second.entries[0]?.status).toBe("UNCHANGED");
    expect(state.profiles).toHaveLength(1);
  });

  it("flags changed source DNA as version-required and preserves historical rows", async () => {
    state.profiles.push({
      id: "chief-current",
      specialistId: "chief_of_staff",
      version: CHIEF_OF_STAFF_DNA.currentVersion.version,
      status: "published",
      versionHash: "different-hash",
    });

    const result = await reconcileWorkforceDnaPublication({ roleCodes: ["chief_of_staff"], apply: true });

    expect(result.entries[0]?.status).toBe("UPDATED_NEW_VERSION_REQUIRED");
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0]?.versionHash).toBe("different-hash");
  });

  it("treats a newer source DNA version as a valid publication progression", async () => {
    state.profiles.push({
      id: "operations-manager-1-0-0",
      specialistId: "operations_manager",
      version: "1.0.0",
      status: "published",
      versionHash: "ac57d397a07f2da4f8b8dca21a3d003c6be59a18a343524c0e661be8d1e6ad33",
    });

    const dryRun = await reconcileWorkforceDnaPublication({ roleCodes: ["operations_manager"] });

    expect(dryRun.entries[0]?.status).toBe("NEW");
    expect(dryRun.entries[0]?.publishedVersion).toBe("1.0.0");
    expect(dryRun.entries[0]?.sourceVersion).toBe(OPERATIONS_MANAGER_DNA.currentVersion.version);
    expect(dryRun.entries[0]?.reasons.join(" ")).toContain("newer immutable version");
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0]?.status).toBe("published");
  });

  it("publishes a newer source DNA version by retiring the old active row", async () => {
    state.profiles.push({
      id: "operations-manager-1-0-0",
      specialistId: "operations_manager",
      version: "1.0.0",
      status: "published",
      versionHash: "ac57d397a07f2da4f8b8dca21a3d003c6be59a18a343524c0e661be8d1e6ad33",
    });

    const result = await reconcileWorkforceDnaPublication({
      roleCodes: ["operations_manager"],
      apply: true,
      publishedBy: "version_integrity_test",
    });

    expect(result.entries[0]?.status).toBe("UNCHANGED");
    expect(result.entries[0]?.publishedVersion).toBe(OPERATIONS_MANAGER_DNA.currentVersion.version);
    expect(result.entries[0]?.publishedVersionHash).toBe(result.entries[0]?.sourceVersionHash);
    expect(state.profiles).toHaveLength(2);
    expect(state.profiles[0]).toMatchObject({
      specialistId: "operations_manager",
      version: "1.0.0",
      status: "retired",
    });
    expect(state.profiles[0]?.retiredAt).toBeInstanceOf(Date);
    expect(state.profiles[1]).toMatchObject({
      specialistId: "operations_manager",
      version: OPERATIONS_MANAGER_DNA.currentVersion.version,
      status: "published",
    });

    const resolved = await loadDNAFromDatabase("operations_manager");

    expect(resolved?.version).toBe(OPERATIONS_MANAGER_DNA.currentVersion.version);
    expect(resolved?.canonicalProfile?.versioning.previousVersion).toBe("1.0.0");
    expect(resolved?.canonicalProfile?.versioning.supersedes).toBe("1.0.0");
  });

  it("second apply after a newer source version publication is idempotent", async () => {
    state.profiles.push({
      id: "operations-manager-1-0-0",
      specialistId: "operations_manager",
      version: "1.0.0",
      status: "published",
      versionHash: "ac57d397a07f2da4f8b8dca21a3d003c6be59a18a343524c0e661be8d1e6ad33",
    });

    const firstApply = await reconcileWorkforceDnaPublication({
      roleCodes: ["operations_manager"],
      apply: true,
      publishedBy: "version_integrity_test",
    });
    const secondApply = await reconcileWorkforceDnaPublication({
      roleCodes: ["operations_manager"],
      apply: true,
      publishedBy: "version_integrity_test",
    });

    expect(firstApply.entries[0]?.status).toBe("UNCHANGED");
    expect(secondApply.entries[0]?.status).toBe("UNCHANGED");
    expect(state.profiles).toHaveLength(2);
    expect(state.profiles.filter(profile => profile.status === "published")).toHaveLength(1);
    expect(state.profiles.filter(profile => profile.version === OPERATIONS_MANAGER_DNA.currentVersion.version)).toHaveLength(1);
  });

  it("rolls back newer-version publication without retiring the active historical row when child insert fails", async () => {
    state.profiles.push({
      id: "operations-manager-1-0-0",
      specialistId: "operations_manager",
      version: "1.0.0",
      status: "published",
      versionHash: "ac57d397a07f2da4f8b8dca21a3d003c6be59a18a343524c0e661be8d1e6ad33",
    });
    state.failCompetencyInsert = true;

    await expect(seedDNAFromStaticRegistry("operations_manager", "version_integrity_test"))
      .rejects.toThrow("simulated competency insert failure");

    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0]).toMatchObject({
      specialistId: "operations_manager",
      version: "1.0.0",
      status: "published",
      versionHash: "ac57d397a07f2da4f8b8dca21a3d003c6be59a18a343524c0e661be8d1e6ad33",
    });
    expect(state.profileInsertPayloads).toHaveLength(0);
  });
});
