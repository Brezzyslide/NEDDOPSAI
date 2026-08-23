import { randomUUID } from "crypto";
import {
  db,
  plansTable,
  planVersionsTable,
  tenantSubscriptionsTable,
} from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import type { PlanCode } from "@workspace/shared";

export interface TrialSubscriptionResult {
  created: boolean;
  organizationId: string;
  planCode: PlanCode;
  subscriptionId?: string;
}

export interface TrialSubscriptionReconciliationResult {
  checked: number;
  created: number;
  organizations: string[];
}

async function resolveLatestPlanVersion(planCode: PlanCode) {
  const [plan] = await db
    .select()
    .from(plansTable)
    .where(eq(plansTable.code, planCode))
    .limit(1);

  if (!plan) {
    throw new Error(`Plan not found: ${planCode}`);
  }

  const [planVersion] = await db
    .select()
    .from(planVersionsTable)
    .where(eq(planVersionsTable.planId, plan.id))
    .orderBy(desc(planVersionsTable.createdAt))
    .limit(1);

  if (!planVersion) {
    throw new Error(`No active plan version found for plan: ${planCode}`);
  }

  return { plan, planVersion };
}

export async function ensureTrialSubscriptionForOrg(params: {
  organizationId: string;
  changedBy: string | null;
  planCode?: PlanCode;
  note?: string;
  trialDays?: number;
}): Promise<TrialSubscriptionResult> {
  const planCode = params.planCode ?? "professional";
  const [existing] = await db
    .select({ id: tenantSubscriptionsTable.id })
    .from(tenantSubscriptionsTable)
    .where(eq(tenantSubscriptionsTable.organizationId, params.organizationId))
    .limit(1);

  if (existing) {
    return { created: false, organizationId: params.organizationId, planCode, subscriptionId: existing.id };
  }

  const { plan, planVersion } = await resolveLatestPlanVersion(planCode);
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + (params.trialDays ?? 14) * 86_400_000);
  const subscriptionId = `sub_trial_${randomUUID()}`;

  await db.insert(tenantSubscriptionsTable).values({
    id: subscriptionId,
    organizationId: params.organizationId,
    planId: plan.id,
    planVersionId: planVersion.id,
    status: "trial",
    currentPeriodStart: now,
    currentPeriodEnd: trialEndsAt,
    trialStartAt: now,
    trialEndAt: trialEndsAt,
    internalNote: params.note ?? "Created by onboarding trial subscription provisioning.",
    changedBy: params.changedBy,
  }).onConflictDoNothing();

  return { created: true, organizationId: params.organizationId, planCode, subscriptionId };
}

export async function reconcileMissingOnboardingTrialSubscriptions(): Promise<TrialSubscriptionReconciliationResult> {
  const rows = await db.execute<{
    organization_id: string;
    has_non_core_pack: boolean;
  }>(sql`
    SELECT
      twp.organization_id,
      bool_or(twp.pack_code <> 'core') AS has_non_core_pack
    FROM tenant_workforce_packs twp
    LEFT JOIN tenant_subscriptions ts
      ON ts.organization_id = twp.organization_id
    WHERE ts.id IS NULL
      AND twp.revoked_at IS NULL
      AND twp.source IN ('core_auto', 'onboarding_trial')
    GROUP BY twp.organization_id
  `);

  const organizations = rows.rows.map((row) => row.organization_id);
  let created = 0;

  for (const row of rows.rows) {
    const result = await ensureTrialSubscriptionForOrg({
      organizationId: row.organization_id,
      changedBy: "db_bootstrap",
      planCode: row.has_non_core_pack ? "professional" : "foundation",
      note: "Created by Dev bootstrap to align onboarding trial packs with subscription entitlement gates.",
    });
    if (result.created) created++;
  }

  return { checked: organizations.length, created, organizations };
}
