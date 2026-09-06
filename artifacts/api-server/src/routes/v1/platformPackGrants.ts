/**
 * Platform Pack Grant/Revoke routes — Sprint 9.7 Owner Control Plane
 * Mounted at /v1/platform/packs
 *
 * GET  /:code/organisations   — List orgs that have this pack
 * POST /:code/grant           — Grant pack to an org
 * POST /:code/revoke          — Revoke pack from an org
 * POST /:code/start-trial     — Start a pack trial for an org
 * POST /:code/extend-trial    — Extend a pack trial
 */

import {
  Router } from "express";
import { platformDb } from "@workspace/db/platform";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middlewares/tenantContext.js";
import { requirePlatformAuth,
  requirePlatformRole } from "../../middlewares/requirePlatformRole.js";
import {
  organizationsTable,
  tenantWorkforcePacksTable,
  workforcePacksTable,
} from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { auditService } from "../../services/auditService.js";

const router = Router();
const auth = [requireAuth, requirePlatformAuth];

// ─── GET /:code/organisations — List orgs that have this pack ─────────────────

router.get("/:code/organisations", ...auth, async (req, res, next) => {
  try {
    const { code } = req.params;

    const grants = await platformDb.select({
        grant: tenantWorkforcePacksTable,
        org: {
          id: organizationsTable.id,
          name: organizationsTable.name,
          slug: organizationsTable.slug,
          status: organizationsTable.status,
        },
      })
      .from(tenantWorkforcePacksTable)
      .innerJoin(organizationsTable, eq(organizationsTable.id, tenantWorkforcePacksTable.organizationId))
      .where(
        and(
          eq(tenantWorkforcePacksTable.packCode, code!),
          isNull(tenantWorkforcePacksTable.revokedAt),
        ),
      );

    res.json({
      grants: grants.map(({ grant, org }) => ({
        orgId: org.id,
        orgName: org.name,
        orgSlug: org.slug,
        orgStatus: org.status,
        status: grant.status,
        source: grant.source,
        grantedAt: grant.grantedAt,
        trialEndsAt: grant.trialEndsAt,
        priceVersionId: grant.priceVersionId,
      })),
    });
  } catch (err) { next(err); }
});

// ─── POST /:code/grant — Grant pack to an org ─────────────────────────────────

router.post("/:code/grant", ...auth, requirePlatformRole("platform_commercial"), async (req, res, next) => {
  try {
    const { code } = req.params;
    const {
      organisationId,
      reason,
      source = "manual_grant",
      priceVersionId,
      expiresAt,
    } = req.body as {
      organisationId: string;
      reason: string;
      source?: string;
      priceVersionId?: string;
      expiresAt?: string;
    };

    if (!organisationId || !reason) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "organisationId and reason are required." } }); return;
    }

    // Validate org exists and is not closed
    const [org] = await platformDb.select().from(organizationsTable)
      .where(eq(organizationsTable.id, organisationId)).limit(1);
    if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }
    if (org.status === "closed") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Cannot grant a pack to a closed organisation." } }); return;
    }

    // Validate pack exists and is not archived
    const [pack] = await platformDb.select().from(workforcePacksTable)
      .where(eq(workforcePacksTable.code, code!)).limit(1);
    if (!pack) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: `Pack '${code}' not found.` } }); return; }
    if (pack.status === "archived") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: `Pack '${code}' is archived and cannot be granted.` } }); return;
    }

    // Check for duplicate active grant
    const [existing] = await platformDb.select().from(tenantWorkforcePacksTable)
      .where(
        and(
          eq(tenantWorkforcePacksTable.organizationId, organisationId),
          eq(tenantWorkforcePacksTable.packCode, code!),
          isNull(tenantWorkforcePacksTable.revokedAt),
        ),
      ).limit(1);
    if (existing && existing.status !== "revoked") {
      res.status(409).json({ error: { code: "CONFLICT", message: "Organisation already has an active grant for this pack." } }); return;
    }

    const now = new Date();
    const [inserted] = await platformDb.insert(tenantWorkforcePacksTable).values({
      id: randomUUID(),
      organizationId: organisationId,
      packCode: code!,
      source: source as any,
      grantedBy: req.platformUserId!,
      reason,
      grantedAt: now,
      status: "active",
      priceVersionId: priceVersionId ?? null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    }).returning();

    await auditService.log({
      eventType: "platform.pack_granted",
      actorId: req.platformUserId,
      organizationId: organisationId,
      metadata: { packCode: code, source, reason, priceVersionId: priceVersionId ?? null },
    });

    res.status(201).json({ success: true, grant: inserted });
  } catch (err) { next(err); }
});

// ─── POST /:code/revoke — Revoke pack from an org ────────────────────────────

router.post("/:code/revoke", ...auth, requirePlatformRole("platform_commercial"), async (req, res, next) => {
  try {
    const { code } = req.params;
    const { organisationId, reason } = req.body as { organisationId: string; reason: string };

    if (!organisationId || !reason) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "organisationId and reason are required." } }); return;
    }

    // Find active grant
    const [grant] = await platformDb.select().from(tenantWorkforcePacksTable)
      .where(
        and(
          eq(tenantWorkforcePacksTable.organizationId, organisationId),
          eq(tenantWorkforcePacksTable.packCode, code!),
          isNull(tenantWorkforcePacksTable.revokedAt),
        ),
      ).limit(1);
    if (!grant) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "No active grant found for this pack and organisation." } }); return;
    }

    await platformDb.update(tenantWorkforcePacksTable).set({
      revokedAt: new Date(),
      status: "revoked",
    }).where(eq(tenantWorkforcePacksTable.id, grant.id));

    await auditService.log({
      eventType: "platform.pack_revoked",
      actorId: req.platformUserId,
      organizationId: organisationId,
      metadata: { packCode: code, grantId: grant.id, reason, revokedBy: req.platformUserId },
    });

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── POST /:code/start-trial — Start a pack trial for an org ─────────────────

router.post("/:code/start-trial", ...auth, requirePlatformRole("platform_commercial"), async (req, res, next) => {
  try {
    const { code } = req.params;
    const {
      organisationId,
      reason,
      trialLengthDays = 14,
    } = req.body as {
      organisationId: string;
      reason: string;
      trialLengthDays?: number;
    };

    if (!organisationId || !reason) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "organisationId and reason are required." } }); return;
    }

    // Validate org is not closed
    const [org] = await platformDb.select().from(organizationsTable)
      .where(eq(organizationsTable.id, organisationId)).limit(1);
    if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }
    if (org.status === "closed") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Cannot start a trial for a closed organisation." } }); return;
    }

    // Check no active grant exists
    const [existing] = await platformDb.select().from(tenantWorkforcePacksTable)
      .where(
        and(
          eq(tenantWorkforcePacksTable.organizationId, organisationId),
          eq(tenantWorkforcePacksTable.packCode, code!),
          isNull(tenantWorkforcePacksTable.revokedAt),
        ),
      ).limit(1);
    if (existing) {
      res.status(409).json({ error: { code: "CONFLICT", message: "Organisation already has an active grant or trial for this pack." } }); return;
    }

    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + trialLengthDays * 86_400_000);

    const [inserted] = await platformDb.insert(tenantWorkforcePacksTable).values({
      id: randomUUID(),
      organizationId: organisationId,
      packCode: code!,
      source: "manual_grant",
      grantedBy: req.platformUserId!,
      reason,
      grantedAt: now,
      status: "trial",
      trialStartedAt: now,
      trialEndsAt,
    }).returning();

    await auditService.log({
      eventType: "platform.pack_trial_started",
      actorId: req.platformUserId,
      organizationId: organisationId,
      metadata: { packCode: code, trialLengthDays, trialEndsAt: trialEndsAt.toISOString(), reason },
    });

    res.status(201).json({ success: true, trialEndsAt });
  } catch (err) { next(err); }
});

// ─── POST /:code/extend-trial — Extend pack trial ────────────────────────────

router.post("/:code/extend-trial", ...auth, requirePlatformRole("platform_commercial"), async (req, res, next) => {
  try {
    const { code } = req.params;
    const {
      organisationId,
      additionalDays,
      reason,
    } = req.body as {
      organisationId: string;
      additionalDays: number;
      reason: string;
    };

    if (!organisationId || !additionalDays || !reason) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "organisationId, additionalDays, and reason are required." } }); return;
    }

    // Find active trial grant
    const [grant] = await platformDb.select().from(tenantWorkforcePacksTable)
      .where(
        and(
          eq(tenantWorkforcePacksTable.organizationId, organisationId),
          eq(tenantWorkforcePacksTable.packCode, code!),
          eq(tenantWorkforcePacksTable.status, "trial"),
          isNull(tenantWorkforcePacksTable.revokedAt),
        ),
      ).limit(1);
    if (!grant) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "No active trial found for this pack and organisation." } }); return;
    }

    const currentTrialEnd = grant.trialEndsAt ?? new Date();
    const newTrialEndsAt = new Date(currentTrialEnd.getTime() + additionalDays * 86_400_000);

    await platformDb.update(tenantWorkforcePacksTable).set({
      trialEndsAt: newTrialEndsAt,
    }).where(eq(tenantWorkforcePacksTable.id, grant.id));

    await auditService.log({
      eventType: "platform.pack_trial_extended",
      actorId: req.platformUserId,
      organizationId: organisationId,
      metadata: { packCode: code, additionalDays, newTrialEndsAt: newTrialEndsAt.toISOString(), reason },
    });

    res.json({ success: true, newTrialEndsAt });
  } catch (err) { next(err); }
});

export default router;
