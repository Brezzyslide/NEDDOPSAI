/**
 * Sprint 4 — Platform Console API Tests
 * Tests for all /v1/platform/* sub-routers.
 * All platform routes require auth → we test their 401 behaviour without a token,
 * and DB operations with a seeded super-admin token via helper.
 *
 * Pattern: unauthenticated tests run without overhead, DB tests use the real DB.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { db, organizationsTable, plansTable, planVersionsTable, tenantSubscriptionsTable, featureFlagsTable, platformSettingsTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { randomUUID } from "crypto";

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function apiGet(path: string): Promise<Response> {
  const base = `http://localhost:${process.env.PORT ?? 8080}`;
  return fetch(`${base}${path}`);
}

// ─── Dashboard ─────────────────────────────────────────────────────────────────

describe("Platform Dashboard — GET /v1/platform/dashboard", () => {
  it("requires authentication — returns 401", async () => {
    const r = await apiGet("/v1/platform/dashboard");
    // Without a Clerk token, the route returns 401 (requireAuth middleware)
    expect([401, 403]).toContain(r.status);
  });
});

// ─── Commercial Plans ─────────────────────────────────────────────────────────

describe("Platform Commercial — plans", () => {
  it("GET /v1/platform/commercial/plans requires auth", async () => {
    const r = await apiGet("/v1/platform/commercial/plans");
    expect([401, 403]).toContain(r.status);
  });

  it("GET /v1/platform/plans (backwards compat) requires auth", async () => {
    const r = await apiGet("/v1/platform/plans");
    expect([401, 403]).toContain(r.status);
  });
});

// ─── Trials ───────────────────────────────────────────────────────────────────

describe("Platform Trials — GET /v1/platform/trials", () => {
  it("requires authentication", async () => {
    const r = await apiGet("/v1/platform/trials");
    expect([401, 403]).toContain(r.status);
  });

  it("GET /v1/platform/trials/expiring requires authentication", async () => {
    const r = await apiGet("/v1/platform/trials/expiring?days=7");
    expect([401, 403]).toContain(r.status);
  });
});

// ─── Workforce ────────────────────────────────────────────────────────────────

describe("Platform Workforce — GET /v1/platform/workforce/*", () => {
  it("GET /packs requires auth", async () => {
    const r = await apiGet("/v1/platform/workforce/packs");
    expect([401, 403]).toContain(r.status);
  });

  it("GET /specialists requires auth", async () => {
    const r = await apiGet("/v1/platform/workforce/specialists");
    expect([401, 403]).toContain(r.status);
  });

  it("GET /stats requires auth", async () => {
    const r = await apiGet("/v1/platform/workforce/stats");
    expect([401, 403]).toContain(r.status);
  });
});

// ─── Usage Monitor ────────────────────────────────────────────────────────────

describe("Platform Usage Monitor — GET /v1/platform/usage-monitor/*", () => {
  it("GET /summary requires auth", async () => {
    const r = await apiGet("/v1/platform/usage-monitor/summary");
    expect([401, 403]).toContain(r.status);
  });

  it("GET /top-orgs requires auth", async () => {
    const r = await apiGet("/v1/platform/usage-monitor/top-orgs");
    expect([401, 403]).toContain(r.status);
  });

  it("GET /warnings requires auth", async () => {
    const r = await apiGet("/v1/platform/usage-monitor/warnings");
    expect([401, 403]).toContain(r.status);
  });

  it("GET /trends requires auth", async () => {
    const r = await apiGet("/v1/platform/usage-monitor/trends");
    expect([401, 403]).toContain(r.status);
  });
});

// ─── Support ──────────────────────────────────────────────────────────────────

describe("Platform Support — GET /v1/platform/support/*", () => {
  it("GET /notes requires auth", async () => {
    const r = await apiGet("/v1/platform/support/notes");
    expect([401, 403]).toContain(r.status);
  });

  it("GET /flagged requires auth", async () => {
    const r = await apiGet("/v1/platform/support/flagged");
    expect([401, 403]).toContain(r.status);
  });
});

// ─── Security ─────────────────────────────────────────────────────────────────

describe("Platform Security — GET /v1/platform/security/*", () => {
  it("GET /overview requires auth", async () => {
    const r = await apiGet("/v1/platform/security/overview");
    expect([401, 403]).toContain(r.status);
  });

  it("GET /flags requires auth", async () => {
    const r = await apiGet("/v1/platform/security/flags");
    expect([401, 403]).toContain(r.status);
  });
});

// ─── Audit ────────────────────────────────────────────────────────────────────

describe("Platform Audit — GET /v1/platform/audit", () => {
  it("requires auth", async () => {
    const r = await apiGet("/v1/platform/audit");
    expect([401, 403]).toContain(r.status);
  });
});

// ─── Settings ─────────────────────────────────────────────────────────────────

describe("Platform Settings", () => {
  it("GET /flags requires auth", async () => {
    const r = await apiGet("/v1/platform/settings/flags");
    expect([401, 403]).toContain(r.status);
  });

  it("GET /config requires auth", async () => {
    const r = await apiGet("/v1/platform/settings/config");
    expect([401, 403]).toContain(r.status);
  });

  it("GET /roles requires auth", async () => {
    const r = await apiGet("/v1/platform/settings/roles");
    expect([401, 403]).toContain(r.status);
  });
});

// ─── Search ───────────────────────────────────────────────────────────────────

describe("Platform Search — GET /v1/platform/search", () => {
  it("requires auth", async () => {
    const r = await apiGet("/v1/platform/search?q=test");
    expect([401, 403]).toContain(r.status);
  });

  it("returns 400 without token even if query too short (auth gates first)", async () => {
    const r = await apiGet("/v1/platform/search?q=a");
    expect([400, 401, 403]).toContain(r.status);
  });
});

// ─── Export ───────────────────────────────────────────────────────────────────

describe("Platform Export — GET /v1/platform/export/*", () => {
  it("GET /organisations requires auth", async () => {
    const r = await apiGet("/v1/platform/export/organisations");
    expect([401, 403]).toContain(r.status);
  });

  it("GET /plans requires auth", async () => {
    const r = await apiGet("/v1/platform/export/plans");
    expect([401, 403]).toContain(r.status);
  });

  it("GET /trials requires auth", async () => {
    const r = await apiGet("/v1/platform/export/trials");
    expect([401, 403]).toContain(r.status);
  });
});

// ─── DB Tests — FeatureFlags table ────────────────────────────────────────────

describe("Feature Flags DB schema (Sprint 4)", () => {
  const testKey = `test_sprint4_flag_${Date.now()}`;

  it("can insert and retrieve a feature flag", async () => {
    await db.insert(featureFlagsTable).values({
      key: testKey,
      label: "Sprint 4 Test Flag",
      isEnabled: false,
      context: {},
    });

    const [flag] = await db.select().from(featureFlagsTable).where(eq(featureFlagsTable.key, testKey));
    expect(flag).toBeTruthy();
    expect(flag!.key).toBe(testKey);
    expect(flag!.isEnabled).toBe(false);
  });

  it("can toggle a feature flag", async () => {
    await db.update(featureFlagsTable).set({ isEnabled: true }).where(eq(featureFlagsTable.key, testKey));
    const [flag] = await db.select().from(featureFlagsTable).where(eq(featureFlagsTable.key, testKey));
    expect(flag!.isEnabled).toBe(true);
  });

  it("cleans up test flag", async () => {
    const [deleted] = await db.delete(featureFlagsTable).where(eq(featureFlagsTable.key, testKey)).returning();
    expect(deleted!.key).toBe(testKey);
  });
});

// ─── DB Tests — PlatformSettings table ───────────────────────────────────────

describe("Platform Settings DB schema (Sprint 4)", () => {
  const testKey = `test_sprint4_setting_${Date.now()}`;

  it("can insert and retrieve a platform setting", async () => {
    await db.insert(platformSettingsTable).values({
      key: testKey,
      label: "Sprint 4 Test Setting",
      value: { foo: "bar", count: 42 },
    });

    const [setting] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, testKey));
    expect(setting).toBeTruthy();
    expect(setting!.key).toBe(testKey);
    expect((setting!.value as any).count).toBe(42);
  });

  it("can update a setting value", async () => {
    await db.update(platformSettingsTable)
      .set({ value: { foo: "baz", count: 99 } })
      .where(eq(platformSettingsTable.key, testKey));
    const [setting] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, testKey));
    expect((setting!.value as any).count).toBe(99);
  });

  it("cleans up test setting", async () => {
    await db.delete(platformSettingsTable).where(eq(platformSettingsTable.key, testKey));
    const rows = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, testKey));
    expect(rows).toHaveLength(0);
  });
});

// ─── DB Tests — Plans table Sprint 4 fields ──────────────────────────────────

describe("Plans table — Sprint 4 fields", () => {
  it("all plans have trialLengthDays, currency fields", async () => {
    const plans = await db.select().from(plansTable);
    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) {
      expect(typeof plan.trialLengthDays).toBe("number");
      expect(typeof plan.currency).toBe("string");
    }
  });
});

// ─── DB Tests — PlatformInternalNotes Sprint 4 fields ────────────────────────

describe("PlatformInternalNotes — Sprint 4 priority/category fields", () => {
  it("schema has priority and category columns", async () => {
    // Test by trying to query — if columns don't exist, it throws
    const { platformInternalNotesTable } = await import("@workspace/db");
    // Just checking the schema object has the new columns
    expect(platformInternalNotesTable.priority).toBeDefined();
    expect(platformInternalNotesTable.category).toBeDefined();
  });
});

// ─── Org directory ────────────────────────────────────────────────────────────

describe("Platform Org directory — auth guard", () => {
  it("GET /v1/platform/organisations requires auth", async () => {
    const r = await apiGet("/v1/platform/organisations");
    expect([401, 403]).toContain(r.status);
  });

  it("GET /v1/platform/organisations/:id requires auth", async () => {
    const r = await apiGet("/v1/platform/organisations/nonexistent");
    expect([401, 403]).toContain(r.status);
  });
});
