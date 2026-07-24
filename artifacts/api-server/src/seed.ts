/**
 * NeedsOps AI+ — Sprint 3 Seed Script
 *
 * Idempotent: safe to run multiple times. Uses upsert / conflict-ignore.
 *
 * Seeds:
 * - 4 plans (Foundation, Professional, Business, Enterprise)
 * - 1 plan version per plan (v1, active)
 * - All features (execution, connectors, workforce packs, platform)
 * - All usage dimensions
 * - Plan features mappings
 * - Plan workforce pack mappings
 * - Plan usage allowances
 * - 2 sample tenant subscriptions (one Foundation active, one Professional trial)
 * - Sample tenant workforce packs
 * - Sample usage events
 * - 1 sample seat override
 * - 1 sample browser execution override
 */

import { db } from "@workspace/db";
import {
  plansTable,
  planVersionsTable,
  featuresTable,
  planFeaturesTable,
  planWorkforcePacksTable,
  usageDimensionsTable,
  planUsageAllowancesTable,
  tenantSubscriptionsTable,
  tenantWorkforcePacksTable,
  usageEventsTable,
  usagePeriodSummariesTable,
  tenantOverridesTable,
  organizationsTable,
  workforcePackSpecialistsTable,
} from "@workspace/db";
import {
  PLAN_CODES,
  PLAN_CODE_LABELS,
  EXECUTION_CAPABILITY_CODES,
  CONNECTOR_CODES,
  PLATFORM_FEATURE_CODES,
  WORKFORCE_PACK_FEATURE_CODES,
  USAGE_DIMENSION_CODES,
  USAGE_DIMENSION_LABELS,
  USAGE_DIMENSION_UNITS,
  type PlanCode,
  type FeatureCode,
} from "@workspace/shared";
import { PLAN_INCLUDED_FEATURES, PLAN_INCLUDED_SEATS, PLAN_USAGE_LIMITS } from "@workspace/entitlements";
import { SPECIALISTS, WORKFORCE_PACKS } from "./lib/workforceRegistry.js";
import { sql, eq } from "drizzle-orm";

const log = (msg: string) => console.log(`[seed] ${msg}`);

// ─── Helper: upsert ignore ────────────────────────────────────────────────────

async function upsertIgnore<T extends Record<string, unknown>>(
  table: Parameters<typeof db.insert>[0],
  values: T[],
  conflictTarget: string[],
) {
  if (values.length === 0) return;
  await (db.insert(table) as ReturnType<typeof db.insert>)
    .values(values as Parameters<ReturnType<typeof db.insert>["values"]>[0])
    .onConflictDoNothing()
    .catch(() => {
      // swallow — idempotent
    });
}

// ─── Plans ────────────────────────────────────────────────────────────────────

const PLAN_DESCRIPTIONS: Record<PlanCode, string> = {
  foundation: "Essential AI workforce for small NDIS providers. Core and Compliance packs included.",
  professional: "Expanded workforce and operations capabilities for growing providers.",
  business: "Full workforce suite with all packs, browser execution eligibility, and connector access.",
  enterprise: "Configurable, dedicated infrastructure for large providers with advanced compliance needs.",
};

const PLAN_DISPLAY_ORDER: Record<PlanCode, string> = {
  foundation: "1",
  professional: "2",
  business: "3",
  enterprise: "4",
};

async function seedPlans() {
  log("Seeding plans and plan versions…");

  for (const code of PLAN_CODES) {
    const planId = `plan_${code}`;
    await db.insert(plansTable).values({
      id: planId,
      code,
      name: PLAN_CODE_LABELS[code],
      description: PLAN_DESCRIPTIONS[code],
      isPublic: true,
      isActive: true,
      displayOrder: PLAN_DISPLAY_ORDER[code],
    }).onConflictDoNothing();

    const versionId = `planv_${code}_v1`;
    const seats = PLAN_INCLUDED_SEATS[code];
    await db.insert(planVersionsTable).values({
      id: versionId,
      planId,
      versionNumber: 1,
      label: "v1 — Sprint 3 initial",
      isActive: true,
      isLegacy: false,
      includedSeats: seats ?? 0,
      maxSeats: seats === null ? null : seats * 10,
      activatedAt: new Date("2026-07-01T00:00:00Z"),
      createdBy: null,
      notes: "Auto-seeded by Sprint 3 seed script.",
    }).onConflictDoNothing();
  }
  log("  ✓ 4 plans + 4 plan versions");
}

// ─── Features ─────────────────────────────────────────────────────────────────

const FEATURE_NAMES: Record<string, string> = {
  // Execution capabilities
  "execution.openclaw_runtime": "OpenClaw Dedicated Runtime",
  "execution.browser_session": "Browser Session Execution",
  "execution.browser_extension": "Browser Extension Execution",
  "execution.local_device": "Local Device Execution",
  "execution.local_files": "Local File Access",
  "execution.local_applications": "Local Application Automation",
  "execution.api_connectors": "API Connector Execution",
  "execution.scheduled_tasks": "Scheduled Task Execution",
  "execution.multi_agent_workflows": "Multi-Agent Workflows",
  // Connectors
  "connector.google_workspace": "Google Workspace Connector",
  "connector.microsoft_365": "Microsoft 365 Connector",
  "connector.xero": "Xero Accounting Connector",
  "connector.myob": "MYOB Connector",
  "connector.zoho": "Zoho CRM Connector",
  "connector.needscare": "NeedsCare Connector",
  "connector.need2comply": "Need2Comply Connector",
  "connector.needs2learn": "Needs2Learn Connector",
  "connector.custom_crm": "Custom CRM Connector",
  "connector.browser_based_system": "Browser-Based System Access",
  // Platform
  "platform.mobile_access": "Mobile App Access",
  "platform.audit_history_basic": "Basic Audit History",
  "platform.audit_history_advanced": "Advanced Audit History (90 days+)",
  "platform.approval_workflows": "Approval Workflows",
  "platform.api_access": "API Access",
  "platform.sso": "Single Sign-On (SSO)",
  "platform.scim": "SCIM User Provisioning",
  "platform.custom_branding": "Custom Branding",
  "platform.advanced_reporting": "Advanced Reporting",
  "platform.dedicated_runtime": "Dedicated OpenClaw Runtime",
  "platform.custom_connectors": "Custom Connector Development",
  "platform.custom_retention": "Custom Data Retention",
  "platform.regional_hosting": "Regional Hosting",
  "platform.sla": "Service Level Agreement",
  "platform.dedicated_infrastructure": "Dedicated Infrastructure",
  // Workforce packs
  "workforce_pack.core": "Core Workforce Pack",
  "workforce_pack.compliance": "Compliance Workforce Pack",
  "workforce_pack.operations": "Operations Workforce Pack",
  "workforce_pack.finance": "Finance Workforce Pack",
  "workforce_pack.hr": "HR Workforce Pack",
  "workforce_pack.marketing": "Marketing Workforce Pack",
};

const COMING_SOON_FEATURES = new Set([
  "execution.openclaw_runtime",
  "execution.browser_extension",
  "execution.local_device",
  "execution.local_files",
  "execution.local_applications",
  "connector.needscare",
  "connector.need2comply",
  "connector.needs2learn",
  "connector.custom_crm",
  "connector.browser_based_system",
  "connector.zoho",
  "connector.myob",
  "platform.dedicated_runtime",
  "platform.scim",
  "platform.custom_connectors",
  "platform.custom_retention",
  "platform.regional_hosting",
  "platform.sla",
  "platform.dedicated_infrastructure",
]);

async function seedFeatures() {
  log("Seeding features…");
  const allCodes: Array<[FeatureCode, string]> = [
    ...EXECUTION_CAPABILITY_CODES.map(c => [c, "execution_capability"] as [FeatureCode, string]),
    ...CONNECTOR_CODES.map(c => [c, "connector"] as [FeatureCode, string]),
    ...PLATFORM_FEATURE_CODES.map(c => [c, "platform"] as [FeatureCode, string]),
    ...WORKFORCE_PACK_FEATURE_CODES.map(c => [c, "workforce_pack"] as [FeatureCode, string]),
  ];

  for (const [code, category] of allCodes) {
    await db.insert(featuresTable).values({
      id: `feat_${code.replace(/\./g, "_")}`,
      code,
      name: FEATURE_NAMES[code] ?? code,
      category: category as "execution_capability" | "connector" | "workforce_pack" | "platform",
      isActive: true,
      isComingSoon: COMING_SOON_FEATURES.has(code),
    }).onConflictDoNothing();
  }
  log(`  ✓ ${allCodes.length} features`);
}

// ─── Plan features ────────────────────────────────────────────────────────────

async function seedPlanFeatures() {
  log("Seeding plan features…");
  let count = 0;
  for (const code of PLAN_CODES) {
    const versionId = `planv_${code}_v1`;
    const features = PLAN_INCLUDED_FEATURES[code];
    for (const featureCode of features) {
      await db.insert(planFeaturesTable).values({
        planVersionId: versionId,
        featureCode,
        enabledByDefault: true,
      }).onConflictDoNothing();
      count++;
    }
  }
  log(`  ✓ ${count} plan feature mappings`);
}

// ─── Plan workforce packs ─────────────────────────────────────────────────────

const PLAN_PACKS: Record<PlanCode, string[]> = {
  foundation: ["core", "compliance"],
  professional: ["core", "compliance", "operations"],
  business: ["core", "compliance", "operations", "finance", "hr", "marketing"],
  enterprise: ["core", "compliance", "operations", "finance", "hr", "marketing"],
};

async function seedPlanWorkforcePacks() {
  log("Seeding plan workforce packs…");
  let count = 0;
  for (const code of PLAN_CODES) {
    const versionId = `planv_${code}_v1`;
    for (const packCode of PLAN_PACKS[code]) {
      await db.insert(planWorkforcePacksTable).values({
        planVersionId: versionId,
        packCode,
        isIncluded: true,
      }).onConflictDoNothing();
      count++;
    }
  }
  log(`  ✓ ${count} plan workforce pack mappings`);
}

// ─── Usage dimensions ─────────────────────────────────────────────────────────

const PERIODIC_COUNTERS = new Set([
  "ai_tasks", "task_plans", "specialist_runs", "browser_actions",
  "local_device_actions", "api_connector_actions", "scheduled_runs",
  "document_pages", "generated_files", "input_tokens", "output_tokens",
]);

async function seedUsageDimensions() {
  log("Seeding usage dimensions…");
  for (const code of USAGE_DIMENSION_CODES) {
    await db.insert(usageDimensionsTable).values({
      id: `dim_${code}`,
      code,
      name: USAGE_DIMENSION_LABELS[code],
      unit: USAGE_DIMENSION_UNITS[code],
      isPeriodicCounter: PERIODIC_COUNTERS.has(code),
      isActive: true,
    }).onConflictDoNothing();
  }
  log(`  ✓ ${USAGE_DIMENSION_CODES.length} usage dimensions`);
}

// ─── Plan usage allowances ────────────────────────────────────────────────────

async function seedPlanUsageAllowances() {
  log("Seeding plan usage allowances…");
  let count = 0;
  for (const code of PLAN_CODES) {
    const versionId = `planv_${code}_v1`;
    const limits = PLAN_USAGE_LIMITS[code];
    for (const [dimCode, hardLimit] of Object.entries(limits)) {
      await db.insert(planUsageAllowancesTable).values({
        planVersionId: versionId,
        dimensionCode: dimCode,
        hardLimit: hardLimit === null ? null : hardLimit,
        softLimitPct: 80.0,
      }).onConflictDoNothing();
      count++;
    }
  }
  log(`  ✓ ${count} plan usage allowances`);
}

// ─── Workforce pack specialists ───────────────────────────────────────────────

async function seedWorkforcePackSpecialists() {
  log("Seeding workforce pack specialists…");
  for (const specialist of SPECIALISTS) {
    await db.insert(workforcePackSpecialistsTable).values({
      packCode: specialist.packCode,
      specialistCode: specialist.code,
    }).onConflictDoNothing();
  }
  log(`  ✓ ${SPECIALISTS.length} workforce pack specialist mappings`);
}

// ─── Sample tenant subscriptions ──────────────────────────────────────────────

async function seedSampleSubscriptions() {
  log("Seeding sample tenant subscriptions…");

  // Find orgs to seed — use the first two active orgs if they exist
  const orgs = await db.select().from(organizationsTable).limit(5);
  if (orgs.length === 0) {
    log("  ⚠ No organisations found — skipping tenant subscriptions");
    return;
  }

  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const trialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // 14 days

  const [foundationOrg, professionalOrg] = orgs;

  // Foundation org — active subscription
  if (foundationOrg) {
    await db.insert(tenantSubscriptionsTable).values({
      id: `sub_${foundationOrg.id}`,
      organizationId: foundationOrg.id,
      planId: "plan_foundation",
      planVersionId: "planv_foundation_v1",
      status: "active",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      trialStartAt: null,
      trialEndAt: null,
      internalNote: "Seeded by Sprint 3 seed script — Foundation active",
    }).onConflictDoNothing();

    // Seed workforce packs for Foundation org
    for (const packCode of PLAN_PACKS.foundation) {
      await db.insert(tenantWorkforcePacksTable).values({
        id: `twp_${foundationOrg.id}_${packCode}`,
        organizationId: foundationOrg.id,
        packCode,
        source: "subscription",
        grantedAt: now,
      }).onConflictDoNothing();
    }

    // Seed sample usage events for Foundation org
    const dims = ["ai_tasks", "task_plans", "specialist_runs"] as const;
    const counts = [42, 38, 95];
    for (let i = 0; i < dims.length; i++) {
      const dim = dims[i]!;
      const count = counts[i]!;
      for (let j = 0; j < Math.min(count, 5); j++) {
        const idempKey = `seed:${foundationOrg.id}:${dim}:${j}`;
        try {
          await db.insert(usageEventsTable).values({
            id: `ue_${foundationOrg.id}_${dim}_${j}`,
            organizationId: foundationOrg.id,
            dimensionCode: dim,
            quantity: Math.ceil(count / 5),
            idempotencyKey: idempKey,
            periodStart,
            periodEnd,
            recordedAt: new Date(now.getTime() - j * 60_000),
          });
        } catch { /* idempotent */ }
      }

      const summaryId = `${foundationOrg.id}_${dim}_${periodStart.toISOString()}`;
      await db.insert(usagePeriodSummariesTable).values({
        id: summaryId,
        organizationId: foundationOrg.id,
        dimensionCode: dim,
        periodStart,
        periodEnd,
        totalQuantity: count,
        eventCount: 5,
      }).onConflictDoNothing();
    }
    log(`  ✓ Foundation subscription for org: ${foundationOrg.name}`);
  }

  // Professional org — trial subscription
  if (professionalOrg && professionalOrg.id !== foundationOrg?.id) {
    await db.insert(tenantSubscriptionsTable).values({
      id: `sub_${professionalOrg.id}`,
      organizationId: professionalOrg.id,
      planId: "plan_professional",
      planVersionId: "planv_professional_v1",
      status: "trial",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      trialStartAt: now,
      trialEndAt: trialEnd,
      internalNote: "Seeded by Sprint 3 seed script — Professional trial",
    }).onConflictDoNothing();

    for (const packCode of PLAN_PACKS.professional) {
      await db.insert(tenantWorkforcePacksTable).values({
        id: `twp_${professionalOrg.id}_${packCode}`,
        organizationId: professionalOrg.id,
        packCode,
        source: "trial",
        grantedAt: now,
        expiresAt: trialEnd,
      }).onConflictDoNothing();
    }

    // Temporary browser execution override for the professional trial org
    await db.insert(tenantOverridesTable).values({
      id: `tov_browser_${professionalOrg.id}`,
      organizationId: professionalOrg.id,
      overrideType: "execution_capability",
      value: { featureCode: "execution.browser_session", reason: "Trial demo capability" },
      reason: "Temporary browser execution for trial period demo",
      internalNote: "Seeded by Sprint 3 seed — remove after trial ends",
      createdBy: "seed_script",
      effectiveFrom: now,
      effectiveTo: trialEnd,
      isActive: true,
    }).onConflictDoNothing();

    // Temporary seat override (+5 seats)
    await db.insert(tenantOverridesTable).values({
      id: `tov_seats_${professionalOrg.id}`,
      organizationId: professionalOrg.id,
      overrideType: "extra_seats",
      value: { seats: 5 },
      reason: "Extra seats during trial period",
      internalNote: "Seeded by Sprint 3 seed",
      createdBy: "seed_script",
      effectiveFrom: now,
      effectiveTo: trialEnd,
      isActive: true,
    }).onConflictDoNothing();

    log(`  ✓ Professional trial subscription for org: ${professionalOrg.name}`);
  }
}

// ─── Run all ──────────────────────────────────────────────────────────────────

export async function runSeed() {
  log("Starting NeedsOps AI+ Sprint 3 seed…");
  await seedPlans();
  await seedFeatures();
  await seedPlanFeatures();
  await seedPlanWorkforcePacks();
  await seedUsageDimensions();
  await seedPlanUsageAllowances();
  await seedWorkforcePackSpecialists();
  await seedSampleSubscriptions();
  log("Sprint 3 seed complete. ✓");
}

// Allow direct execution: npx tsx src/seed.ts
if (process.argv[1]?.endsWith("seed.ts") || process.argv[1]?.endsWith("seed.js")) {
  runSeed()
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}
