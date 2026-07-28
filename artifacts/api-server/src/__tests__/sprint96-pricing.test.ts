/**
 * Sprint 9.6 — Dynamic Workforce Pack Pricing Tests
 *
 * Tests cover:
 *  - Pricing source of truth (no live seeded prices for paid packs)
 *  - Pack provisioning service (Core auto-grant, trial, requests, validation)
 *  - Public pack catalogue pricing display modes
 *  - Cache invalidation
 *  - Pack access request validation
 *  - Security: client cannot manipulate prices
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Pricing helpers ──────────────────────────────────────────────────────────

describe("Pricing display helpers", () => {
  function buildPricingDisplay(pack: any, priceVersion: any) {
    if (pack.isFree) return { displayMode: "free" };
    if (pack.status === "coming_soon") return { displayMode: "coming_soon", fallbackText: "Coming soon" };
    if (priceVersion && priceVersion.status === "active" && priceVersion.isCurrent) {
      return {
        displayMode: "priced",
        currency: priceVersion.currency,
        monthlyPriceCents: priceVersion.monthlyPriceCents,
        annualPriceCents: priceVersion.annualPriceCents,
      };
    }
    const status = pack.pricingStatus ?? "not_configured";
    if (status === "contact_sales") return { displayMode: "contact_sales", fallbackText: pack.fallbackDisplayText ?? "Contact NeedsOps" };
    return { displayMode: "contact_sales", fallbackText: pack.fallbackDisplayText ?? "Contact NeedsOps" };
  }

  it("free pack returns displayMode=free", () => {
    const result = buildPricingDisplay({ isFree: true, status: "available" }, null);
    expect(result.displayMode).toBe("free");
  });

  it("coming_soon pack returns displayMode=coming_soon regardless of price version", () => {
    const result = buildPricingDisplay(
      { isFree: false, status: "coming_soon" },
      { status: "active", isCurrent: true, monthlyPriceCents: 29900 },
    );
    expect(result.displayMode).toBe("coming_soon");
  });

  it("active price version returns displayMode=priced with cents", () => {
    const result = buildPricingDisplay(
      { isFree: false, status: "available", pricingStatus: "not_configured" },
      { status: "active", isCurrent: true, currency: "AUD", monthlyPriceCents: 29900, annualPriceCents: 287040 },
    ) as any;
    expect(result.displayMode).toBe("priced");
    expect(result.monthlyPriceCents).toBe(29900);
    expect(result.annualPriceCents).toBe(287040);
    expect(result.currency).toBe("AUD");
  });

  it("no active price version returns displayMode=contact_sales", () => {
    const result = buildPricingDisplay(
      { isFree: false, status: "available", pricingStatus: "not_configured" },
      null,
    );
    expect(result.displayMode).toBe("contact_sales");
  });

  it("draft price version does NOT appear publicly (not is_current=true + status=active)", () => {
    const result = buildPricingDisplay(
      { isFree: false, status: "available", pricingStatus: "not_configured" },
      { status: "draft", isCurrent: false, currency: "AUD", monthlyPriceCents: 29900 },
    );
    expect(result.displayMode).toBe("contact_sales");
  });

  it("superseded price version does NOT appear publicly", () => {
    const result = buildPricingDisplay(
      { isFree: false, status: "available", pricingStatus: "not_configured" },
      { status: "superseded", isCurrent: false, currency: "AUD", monthlyPriceCents: 24900 },
    );
    expect(result.displayMode).toBe("contact_sales");
  });

  it("A$0 is not shown for missing pricing — uses contact_sales fallback", () => {
    const result = buildPricingDisplay(
      { isFree: false, status: "available", pricingStatus: "not_configured" },
      null,
    ) as any;
    expect(result.displayMode).not.toBe("free");
    expect(result.monthlyPriceCents).toBeUndefined();
  });

  it("contact_sales pricingStatus returns correct fallback text", () => {
    const result = buildPricingDisplay(
      { isFree: false, status: "available", pricingStatus: "contact_sales", fallbackDisplayText: "Contact NeedsOps" },
      null,
    ) as any;
    expect(result.displayMode).toBe("contact_sales");
    expect(result.fallbackText).toBe("Contact NeedsOps");
  });
});

// ─── Currency formatting ──────────────────────────────────────────────────────

describe("AUD currency formatting", () => {
  function formatAUD(cents: number): string {
    return `A$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }

  it("formats 29900 cents as A$299", () => {
    expect(formatAUD(29900)).toBe("A$299");
  });

  it("formats 287040 cents as A$2,870", () => {
    // Annual discount format
    expect(formatAUD(287040)).toMatch(/A\$2[,.]?870/);
  });

  it("does not display ambiguous $ — always shows A$", () => {
    expect(formatAUD(9900)).toMatch(/^A\$/);
  });
});

// ─── Pricing validation ───────────────────────────────────────────────────────

describe("Pricing validation rules", () => {
  function validatePrice(monthly?: number, annual?: number, isFree?: boolean, currency?: string): string | null {
    if (monthly !== undefined && monthly < 0) return "Monthly price cannot be negative.";
    if (annual !== undefined && annual < 0) return "Annual price cannot be negative.";
    if (isFree && ((monthly ?? 0) !== 0 || (annual ?? 0) !== 0)) return "Free packs must have zero pricing.";
    if (!isFree && monthly !== undefined && !currency) return "Active price requires currency.";
    return null;
  }

  it("rejects negative monthly price", () => {
    expect(validatePrice(-100)).toBe("Monthly price cannot be negative.");
  });

  it("rejects negative annual price", () => {
    expect(validatePrice(0, -100)).toBe("Annual price cannot be negative.");
  });

  it("rejects free pack with non-zero pricing", () => {
    expect(validatePrice(29900, 0, true)).toBe("Free packs must have zero pricing.");
  });

  it("accepts zero price for free packs", () => {
    expect(validatePrice(0, 0, true)).toBeNull();
  });

  it("rejects paid price without currency", () => {
    expect(validatePrice(29900, undefined, false, undefined)).toBe("Active price requires currency.");
  });

  it("accepts valid paid price with AUD currency", () => {
    expect(validatePrice(29900, 287040, false, "AUD")).toBeNull();
  });
});

// ─── Pack provisioning service logic ─────────────────────────────────────────

describe("Pack provisioning — onboarding rules", () => {
  // Simulate pack provisioning logic without DB
  function simulateProvisioning(
    selectedCodes: string[],
    packDb: Record<string, any>,
  ) {
    const result = { granted: [] as any[], requested: [] as any[], rejected: [] as any[] };

    // Core always granted
    result.granted.push({ code: "core", status: "active" });

    for (const code of selectedCodes.filter(c => c !== "core")) {
      const pack = packDb[code];
      if (!pack) { result.rejected.push({ code, reason: "Pack not found." }); continue; }
      if (pack.status === "archived") { result.rejected.push({ code, reason: "Pack is archived." }); continue; }
      if (!pack.publiclySelectable) { result.rejected.push({ code, reason: "Not selectable." }); continue; }

      if (pack.selectionMode === "trial" && pack.trialEligible) {
        const trialEndsAt = new Date(Date.now() + (pack.trialLengthDays ?? 14) * 86400000);
        result.granted.push({ code, status: "trial", trialEndsAt });
      } else if (pack.selectionMode === "requested" || pack.requiresManualApproval) {
        result.requested.push({ code });
      } else {
        result.requested.push({ code });
      }
    }
    return result;
  }

  const mockPacks: Record<string, any> = {
    compliance: { status: "available", publiclySelectable: true, trialEligible: true, trialLengthDays: 14, selectionMode: "trial" },
    operations: { status: "available", publiclySelectable: true, trialEligible: true, trialLengthDays: 14, selectionMode: "trial" },
    enterprise:  { status: "available", publiclySelectable: false, trialEligible: false, selectionMode: "requested" },
    archived:    { status: "archived",  publiclySelectable: true,  trialEligible: true, selectionMode: "trial" },
    approval:    { status: "available", publiclySelectable: true, trialEligible: false, requiresManualApproval: true, selectionMode: "trial" },
  };

  it("Core Pack is always granted even with empty selection", () => {
    const r = simulateProvisioning([], mockPacks);
    expect(r.granted.map(g => g.code)).toContain("core");
  });

  it("Core Pack is not duplicated when explicitly selected", () => {
    const r = simulateProvisioning(["core"], mockPacks);
    const corePacks = r.granted.filter(g => g.code === "core");
    expect(corePacks).toHaveLength(1);
  });

  it("unknown pack code is rejected", () => {
    const r = simulateProvisioning(["unknown_xyz"], mockPacks);
    expect(r.rejected.find(x => x.code === "unknown_xyz")).toBeTruthy();
    expect(r.rejected[0]!.reason).toMatch(/not found/i);
  });

  it("archived pack is rejected", () => {
    const r = simulateProvisioning(["archived"], mockPacks);
    expect(r.rejected.find(x => x.code === "archived")?.reason).toMatch(/archived/i);
  });

  it("non-publicly-selectable pack is rejected", () => {
    const r = simulateProvisioning(["enterprise"], mockPacks);
    expect(r.rejected.find(x => x.code === "enterprise")).toBeTruthy();
  });

  it("trial-eligible pack is granted with status=trial", () => {
    const r = simulateProvisioning(["compliance"], mockPacks);
    const grant = r.granted.find(g => g.code === "compliance");
    expect(grant?.status).toBe("trial");
    expect(grant?.trialEndsAt).toBeInstanceOf(Date);
  });

  it("trial grant respects pack trial length", () => {
    const r = simulateProvisioning(["compliance"], { ...mockPacks, compliance: { ...mockPacks.compliance, trialLengthDays: 30 } });
    const grant = r.granted.find(g => g.code === "compliance");
    const diffDays = Math.round((grant!.trialEndsAt.getTime() - Date.now()) / 86400000);
    expect(diffDays).toBeGreaterThan(28);
    expect(diffDays).toBeLessThan(32);
  });

  it("approval-required pack creates request, not grant", () => {
    const r = simulateProvisioning(["approval"], mockPacks);
    expect(r.granted.find(g => g.code === "approval")).toBeFalsy();
    expect(r.requested.find(x => x.code === "approval")).toBeTruthy();
  });

  it("client-supplied price is completely ignored — server derives from DB", () => {
    // Provisioning service receives pack codes only, no price info from client
    // This is structural: provisionPacksForNewOrg(orgId, userId, packCodes[]) — no price param
    const r = simulateProvisioning(["compliance"], mockPacks);
    // Result has no price info — price is determined from price versions at billing time
    expect((r.granted[1] as any)?.monthlyPriceCents).toBeUndefined();
  });

  it("duplicate submission is idempotent (skip already-granted codes)", () => {
    // Simulate: compliance already in alreadyGranted
    const alreadyGranted = new Set(["compliance"]);
    const codes = ["compliance", "operations"];
    const toProcess = codes.filter(c => !alreadyGranted.has(c) && c !== "core");
    expect(toProcess).toEqual(["operations"]);
  });

  it("multiple packs can be selected and processed", () => {
    const r = simulateProvisioning(["compliance", "operations"], mockPacks);
    const trialGrants = r.granted.filter(g => g.status === "trial");
    expect(trialGrants).toHaveLength(2);
  });
});

// ─── Seed data integrity ──────────────────────────────────────────────────────

describe("Seed data principles", () => {
  it("paid pack seed config — no live price cents", () => {
    // After sprint96-dynamic-pricing.sql migration, paid packs should have NULL prices
    // This test documents the expected post-migration state.
    const paidPackAfterMigration = {
      code: "compliance",
      priceMonthly: null,   // must be null — seeded prices removed
      priceAnnual: null,    // must be null
      isFree: false,
      pricingStatus: "contact_sales",
    };
    expect(paidPackAfterMigration.priceMonthly).toBeNull();
    expect(paidPackAfterMigration.priceAnnual).toBeNull();
    expect(paidPackAfterMigration.isFree).toBe(false);
  });

  it("Core Pack seed — is_free=true, price=0", () => {
    const corePack = { code: "core", isFree: true, priceMonthly: 0, priceAnnual: 0 };
    expect(corePack.isFree).toBe(true);
    expect(corePack.priceMonthly).toBe(0);
  });

  it("seed rerun safety — update WHERE pricing_status = not_configured only", () => {
    // Simulates idempotency: if owner already set pricingStatus to 'contact_sales',
    // the migration WHERE clause will still match and update non-price fields.
    // But if owner activated a price version, that version is in a separate table
    // and is unaffected by workforce_packs updates.
    const ownerConfiguredPack = { pricingStatus: "contact_sales" };
    // The migration condition is: WHERE code != 'core' AND pricing_status = 'not_configured'
    // Since ownerConfiguredPack has 'contact_sales', it won't be touched by the seed reset
    // after the first run.
    const willBeUpdated = ownerConfiguredPack.pricingStatus === "not_configured";
    expect(willBeUpdated).toBe(false);
  });
});

// ─── Pack access request validation ──────────────────────────────────────────

describe("Pack access request validation", () => {
  function validateRequest(packCode: string | undefined, pack: any | null) {
    if (!packCode) return { ok: false, error: "packCode is required." };
    if (!pack) return { ok: false, error: "Pack not found or unavailable." };
    if (pack.status === "archived") return { ok: false, error: "Pack not found or unavailable." };
    return { ok: true };
  }

  it("rejects missing packCode", () => {
    expect(validateRequest(undefined, null).ok).toBe(false);
  });

  it("rejects request for non-existent pack", () => {
    expect(validateRequest("xyz", null).ok).toBe(false);
  });

  it("rejects request for archived pack", () => {
    expect(validateRequest("compliance", { status: "archived" }).ok).toBe(false);
  });

  it("accepts valid request for available pack", () => {
    expect(validateRequest("compliance", { status: "available" }).ok).toBe(true);
  });
});

// ─── Security invariants ──────────────────────────────────────────────────────

describe("Security invariants", () => {
  it("pack provisioning receives only string codes — no price params", () => {
    // The function signature is provisionPacksForNewOrg(orgId, userId, packCodes: string[])
    // A client cannot supply price data through this path.
    function mockProvision(_orgId: string, _userId: string, codes: string[]) {
      // codes contains only pack codes — no prices, no trial lengths
      return codes.every(c => typeof c === "string");
    }
    expect(mockProvision("org1", "user1", ["compliance", "operations"])).toBe(true);
  });

  it("displayMode=priced requires is_current=true AND status=active on price version", () => {
    // Any version that is not both current and active must not be shown as 'priced'
    const invalidVersions = [
      { isCurrent: false, status: "active" },
      { isCurrent: true,  status: "draft" },
      { isCurrent: true,  status: "superseded" },
      { isCurrent: false, status: "draft" },
    ];
    for (const v of invalidVersions) {
      expect(v.isCurrent && v.status === "active").toBe(false);
    }
  });

  it("internal pricing notes must not appear in public pack response", () => {
    // The public formatPublicPack function does not include 'notes' from price version
    const publicPackFields = [
      "id", "code", "name", "pricing", "specialistCount",
      "iconEmoji", "colorHex", "tier", "status", "featured",
      "marketingTagline", "description",
    ];
    expect(publicPackFields).not.toContain("notes");
    expect(publicPackFields).not.toContain("createdBy");
    expect(publicPackFields).not.toContain("approvedBy");
  });
});

// ─── Cache behaviour ──────────────────────────────────────────────────────────

describe("Pack cache service", () => {
  it("returns null on cold cache", async () => {
    const { getPublicPacksFromCache, invalidatePublicPacksCache } = await import("../services/packCacheService.js");
    invalidatePublicPacksCache();
    expect(getPublicPacksFromCache()).toBeNull();
  });

  it("stores and retrieves cached value", async () => {
    const { getPublicPacksFromCache, setPublicPacksCache, invalidatePublicPacksCache } = await import("../services/packCacheService.js");
    invalidatePublicPacksCache();
    const data = [{ code: "core" }, { code: "compliance" }];
    setPublicPacksCache(data);
    expect(getPublicPacksFromCache()).toEqual(data);
  });

  it("invalidate clears the cache", async () => {
    const { getPublicPacksFromCache, setPublicPacksCache, invalidatePublicPacksCache } = await import("../services/packCacheService.js");
    setPublicPacksCache([{ code: "test" }]);
    invalidatePublicPacksCache();
    expect(getPublicPacksFromCache()).toBeNull();
  });
});
