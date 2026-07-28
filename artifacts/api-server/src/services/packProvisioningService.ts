/**
 * packProvisioningService — Sprint 9.6
 *
 * Handles the full workforce pack provisioning flow during organisation creation:
 *
 *   1. Always grants Core Pack as active (source=core_auto)
 *   2. For each selected pack code, evaluates the owner-configured selection
 *      mode (trial | requested | included) and creates the correct records
 *   3. Fires audit events for every grant/trial/request
 *   4. Returns a summary of granted, trialled, requested and rejected packs
 *
 * Rules (server-enforced, never trust client):
 *   - Unknown pack codes are rejected
 *   - Archived or non-publicly-selectable packs (except 'core') are rejected
 *   - Client-supplied prices are ignored; server loads pack config from DB
 *   - Duplicate submission within the same org is idempotent (skip existing)
 */

import { randomUUID } from "crypto";
import { db, workforcePacksTable, tenantWorkforcePacksTable, workforcePackAccessRequestsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import * as auditService from "./auditService.js";

export interface PackProvisioningResult {
  granted:   { code: string; status: "active" | "trial"; trialEndsAt?: Date }[];
  requested: { code: string }[];
  rejected:  { code: string; reason: string }[];
}

export interface PackProvisioningAuditMeta {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export async function provisionPacksForNewOrg(
  orgId: string,
  userId: string,
  selectedPackCodes: string[],
  auditMeta: PackProvisioningAuditMeta = {},
): Promise<PackProvisioningResult> {
  const result: PackProvisioningResult = { granted: [], requested: [], rejected: [] };

  // ── 1. Load all requested + core packs from DB ──────────────────────────────
  const allCodes = [...new Set(["core", ...selectedPackCodes.map(c => c.toLowerCase())])];

  const packs = await db
    .select()
    .from(workforcePacksTable)
    .where(inArray(workforcePacksTable.code, allCodes));

  const packMap = new Map(packs.map(p => [p.code, p]));

  // ── 2. Check for existing grants (idempotency) ───────────────────────────────
  const existing = await db
    .select({ packCode: tenantWorkforcePacksTable.packCode })
    .from(tenantWorkforcePacksTable)
    .where(eq(tenantWorkforcePacksTable.organizationId, orgId));
  const alreadyGranted = new Set(existing.map(r => r.packCode));

  // ── 3. Always grant Core Pack ────────────────────────────────────────────────
  if (!alreadyGranted.has("core")) {
    const corePack = packMap.get("core");
    const corePackId = corePack?.id ?? "pack_core";

    await db.insert(tenantWorkforcePacksTable).values({
      id:            `twp_${randomUUID()}`,
      organizationId: orgId,
      packCode:      "core",
      source:        "core_auto",
      grantedBy:     "system",
      reason:        "Core Pack granted automatically on org creation",
      status:        "active",
      activatedAt:   new Date(),
      requestedBy:   userId,
    }).onConflictDoNothing();

    result.granted.push({ code: "core", status: "active" });

    await auditService.writeAuditEvent({
      organizationId: orgId,
      actorUserId:    userId,
      actorType:      "system",
      eventType:      "organisation.core_pack_granted" as any,
      resourceType:   "workforce_pack",
      resourceId:     corePackId,
      metadata:       { packCode: "core" },
      ...auditMeta,
    }).catch(() => {});
  }

  // ── 4. Process each selected pack ────────────────────────────────────────────
  const nonCoreCodes = selectedPackCodes.map(c => c.toLowerCase()).filter(c => c !== "core");

  for (const code of nonCoreCodes) {
    // Skip already-granted packs (idempotency)
    if (alreadyGranted.has(code)) continue;

    const pack = packMap.get(code);

    // Validate: pack must exist
    if (!pack) {
      result.rejected.push({ code, reason: "Pack not found." });
      continue;
    }

    // Validate: pack must not be archived
    if (pack.status === "archived") {
      result.rejected.push({ code, reason: "Pack is archived and unavailable." });
      continue;
    }

    // Validate: pack must be publicly selectable
    if (!pack.publiclySelectable) {
      result.rejected.push({ code, reason: "Pack is not available for selection." });
      continue;
    }

    const selectionMode = pack.selectionMode ?? "trial";

    if (selectionMode === "included" || pack.autoGrantOnSignup) {
      // ── Grant immediately as active ──────────────────────────────────────────
      await db.insert(tenantWorkforcePacksTable).values({
        id:             `twp_${randomUUID()}`,
        organizationId: orgId,
        packCode:       code,
        source:         "onboarding_trial",
        grantedBy:      "system",
        reason:         "Auto-granted on signup",
        status:         "active",
        activatedAt:    new Date(),
        requestedBy:    userId,
      }).onConflictDoNothing();

      result.granted.push({ code, status: "active" });

    } else if (selectionMode === "trial" && pack.trialEligible) {
      // ── Grant as trial ───────────────────────────────────────────────────────
      const trialDays    = pack.trialLengthDays ?? 14;
      const trialEndsAt  = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);

      await db.insert(tenantWorkforcePacksTable).values({
        id:             `twp_${randomUUID()}`,
        organizationId: orgId,
        packCode:       code,
        source:         "onboarding_trial",
        grantedBy:      "system",
        reason:         `${trialDays}-day trial started during onboarding`,
        status:         "trial",
        trialStartedAt: new Date(),
        trialEndsAt,
        requestedBy:    userId,
      }).onConflictDoNothing();

      result.granted.push({ code, status: "trial", trialEndsAt });

      await auditService.writeAuditEvent({
        organizationId: orgId,
        actorUserId:    userId,
        actorType:      "system",
        eventType:      "workforce_pack.trial_started" as any,
        resourceType:   "workforce_pack",
        resourceId:     pack.id,
        metadata:       { packCode: code, trialDays, trialEndsAt },
        ...auditMeta,
      }).catch(() => {});

    } else if (selectionMode === "requested" || pack.requiresManualApproval) {
      // ── Create access request ────────────────────────────────────────────────
      await db.insert(workforcePackAccessRequestsTable).values({
        id:              `par_${randomUUID()}`,
        organizationId:  orgId,
        workforcePackId: pack.id,
        packCode:        code,
        requestedBy:     userId,
        status:          "pending",
        source:          "onboarding",
      }).onConflictDoNothing();

      // Also create a pending tenant_workforce_packs row for visibility
      await db.insert(tenantWorkforcePacksTable).values({
        id:             `twp_${randomUUID()}`,
        organizationId: orgId,
        packCode:       code,
        source:         "override",
        grantedBy:      null,
        reason:         "Access requested during onboarding — pending approval",
        status:         "pending_approval",
        requestedBy:    userId,
      }).onConflictDoNothing();

      result.requested.push({ code });

      await auditService.writeAuditEvent({
        organizationId: orgId,
        actorUserId:    userId,
        actorType:      "user",
        eventType:      "workforce_pack.access_requested" as any,
        resourceType:   "workforce_pack",
        resourceId:     pack.id,
        metadata:       { packCode: code, source: "onboarding" },
        ...auditMeta,
      }).catch(() => {});

    } else {
      // selectionMode = pending_payment or unrecognised — create pending grant
      await db.insert(tenantWorkforcePacksTable).values({
        id:             `twp_${randomUUID()}`,
        organizationId: orgId,
        packCode:       code,
        source:         "override",
        grantedBy:      null,
        reason:         "Selected during onboarding — pending payment/activation",
        status:         "pending_payment",
        requestedBy:    userId,
      }).onConflictDoNothing();

      result.requested.push({ code });
    }

    // Audit: pack selected during onboarding
    await auditService.writeAuditEvent({
      organizationId: orgId,
      actorUserId:    userId,
      actorType:      "user",
      eventType:      "workforce_pack.selected_during_onboarding" as any,
      resourceType:   "workforce_pack",
      resourceId:     pack.id,
      metadata:       { packCode: code, selectionMode },
      ...auditMeta,
    }).catch(() => {});
  }

  // ── 5. Final audit: initial pack assignment completed ────────────────────────
  await auditService.writeAuditEvent({
    organizationId: orgId,
    actorUserId:    userId,
    actorType:      "system",
    eventType:      "organisation.initial_pack_assignment_completed" as any,
    resourceType:   "organization",
    resourceId:     orgId,
    metadata:       {
      granted:   result.granted.map(g => g.code),
      requested: result.requested.map(r => r.code),
      rejected:  result.rejected.map(r => r.code),
    },
    ...auditMeta,
  }).catch(() => {});

  return result;
}
