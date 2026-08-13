import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns } from "drizzle-orm";

interface StoredProfile {
  [key: string]: unknown;
  id: string;
  specialistId: string;
  version: string;
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
      return selection && "id" in selection
        ? state.profiles.map(profile => ({ id: profile.id }))
        : state.profiles;
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
          limit: vi.fn((count: number) =>
            Promise.resolve(selectedRows(table, selection).slice(0, count)),
          ),
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
    transaction: vi.fn(async (callback: (tx: typeof db) => Promise<unknown>) => {
      const profileSnapshot = [...state.profiles];
      const competencySnapshot = [...state.competencies];
      const payloadSnapshot = [...state.profileInsertPayloads];
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
  CHIEF_OF_STAFF_DNA,
} from "@workspace/workforce-dna";
import {
  loadDNAFromDatabase,
  seedDNAFromStaticRegistry,
} from "../services/dnaStorageService.js";

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
});
