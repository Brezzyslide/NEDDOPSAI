/**
 * paymentBypassService — Sprint 14
 *
 * DEVELOPMENT-ONLY payment bypass. Simulates a successful Stripe checkout
 * by directly activating a plan subscription and provisioning entitlements.
 *
 * ⚠️  SECURITY WARNING:
 *   This service MUST NOT be callable unless ENABLE_PAYMENT_BYPASS=true.
 *   The route handler enforces this; this service re-checks as defence-in-depth.
 *   This service creates real subscription records — in production it must be
 *   removed or gated behind a platform admin role.
 *
 * The bypass button is clearly labelled in the UI.
 * It calls a server-side API (not a client-only state change).
 * It creates a proper audit record.
 */

import { randomUUID } from "crypto";
import {
  db,
  tenantSubscriptionsTable,
  plansTable,
  planVersionsTable,
  organizationsTable,
  onboardingSessionsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { provisionPacksForNewOrg } from "./packProvisioningService.js";
import * as auditService from "./auditService.js";

type AuditEventMeta = Pick<auditService.WriteAuditEventParams, "requestId" | "ipAddress" | "userAgent">;

// ── Structured error ───────────────────────────────────────────────────────────

/** Error subclass that carries a machine-readable code for client-side handling. */
export class BypassServiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "BypassServiceError";
    this.code = code;
  }
}

// ── Feature flag check ─────────────────────────────────────────────────────────

export function isPaymentBypassEnabled(): boolean {
  return process.env.ENABLE_PAYMENT_BYPASS === "true";
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PaymentBypassParams {
  organizationId: string;
  userId: string;
  planCode: string;
  billingCycle?: "monthly" | "annual";
  selectedPackCodes?: string[];
}

export interface PaymentBypassResult {
  subscriptionId: string;
  planCode: string;
  status: "trial" | "active";
  trialEndsAt?: Date;
}

// ── Service ────────────────────────────────────────────────────────────────────

export async function activatePaymentBypass(
  params: PaymentBypassParams,
  auditMeta: AuditEventMeta = {},
): Promise<PaymentBypassResult> {
  if (!isPaymentBypassEnabled()) {
    throw new BypassServiceError(
      "PAYMENT_BYPASS_DISABLED",
      "Payment bypass is not enabled on this server.",
    );
  }

  const { organizationId, userId, planCode, billingCycle = "monthly", selectedPackCodes = [] } = params;

  // ── 0. Verify organisation exists ─────────────────────────────────────────────
  const [orgRow] = await db
    .select({ id: organizationsTable.id })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, organizationId))
    .limit(1);

  if (!orgRow) {
    throw new BypassServiceError(
      "ORG_NOT_FOUND",
      `Organisation not found: ${organizationId}`,
    );
  }

  // ── 1. Load the plan ──────────────────────────────────────────────────────────
  const [plan] = await db
    .select()
    .from(plansTable)
    .where(eq(plansTable.code, planCode))
    .limit(1);

  if (!plan) {
    throw new BypassServiceError("PLAN_NOT_FOUND", `Plan not found: ${planCode}`);
  }

  // ── 2. Load the latest active plan version ────────────────────────────────────
  const [planVersion] = await db
    .select()
    .from(planVersionsTable)
    .where(eq(planVersionsTable.planId, plan.id))
    .orderBy(desc(planVersionsTable.createdAt))
    .limit(1);

  if (!planVersion) {
    throw new Error(`No active plan version found for plan: ${planCode}`);
  }

  // ── 3. Upsert subscription ───────────────────────────────────────────────────
  const subId = `sub_bypass_${randomUUID()}`;
  const isFoundation = planCode === "foundation";
  const trialEndsAt = isFoundation
    ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    : undefined;

  await db
    .insert(tenantSubscriptionsTable)
    .values({
      id: subId,
      organizationId,
      planId: plan.id,
      planVersionId: planVersion.id,
      status: isFoundation ? "trial" : "active",
      trialStartAt: isFoundation ? new Date() : undefined,
      trialEndAt: trialEndsAt,
      currentPeriodStart: new Date(),
      currentPeriodEnd: trialEndsAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      internalNote: "⚠️ DEV: Created by payment bypass — not a real payment",
      changedBy: userId,
      billingCycle,
    })
    .onConflictDoUpdate({
      target: tenantSubscriptionsTable.organizationId,
      set: {
        planId: plan.id,
        planVersionId: planVersion.id,
        status: isFoundation ? "trial" : "active",
        trialStartAt: isFoundation ? new Date() : undefined,
        trialEndAt: trialEndsAt,
        currentPeriodStart: new Date(),
        currentPeriodEnd: trialEndsAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        internalNote: "⚠️ DEV: Updated by payment bypass — not a real payment",
        changedBy: userId,
        billingCycle,
        updatedAt: new Date(),
      },
    });

  // ── 4. Update org status ─────────────────────────────────────────────────────
  await db
    .update(organizationsTable)
    .set({
      status: isFoundation ? "trial" : "active",
      onboardingStep: 6,
      updatedAt: new Date(),
    })
    .where(eq(organizationsTable.id, organizationId));

  // ── 5. Provision selected packs ───────────────────────────────────────────────
  if (selectedPackCodes.length > 0) {
    await provisionPacksForNewOrg(
      organizationId,
      userId,
      selectedPackCodes,
      auditMeta,
    ).catch(err => console.error("[paymentBypass] Pack provisioning error:", err));
  }

  // ── 6. Update onboarding session ─────────────────────────────────────────────
  await db
    .update(onboardingSessionsTable)
    .set({ currentStep: 6, completedAt: new Date(), updatedAt: new Date() })
    .where(eq(onboardingSessionsTable.organizationId, organizationId))
    .catch(() => {});

  // ── 7. Audit record ───────────────────────────────────────────────────────────
  await auditService.writeAuditEvent({
    organizationId,
    actorUserId: userId,
    eventType: "subscription.payment_bypass_activated",
    resourceType: "subscription",
    resourceId: subId,
    metadata: {
      planCode,
      billingCycle,
      isBypass: true,
      warning: "DEV_ONLY_NOT_A_REAL_PAYMENT",
    },
    ...auditMeta,
  }).catch(() => {});

  return {
    subscriptionId: subId,
    planCode,
    status: isFoundation ? "trial" : "active",
    trialEndsAt,
  };
}
