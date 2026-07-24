/**
 * Platform Settings routes — /v1/platform/settings
 * Sprint 4: Feature flags and global platform configuration.
 *
 * GET    /flags           — all feature flags
 * POST   /flags           — create flag
 * PATCH  /flags/:key      — update flag (enable/disable/context)
 * GET    /config          — all platform settings
 * PUT    /config/:key     — upsert a setting
 * GET    /roles           — list platform roles
 * POST   /roles           — grant platform role
 * DELETE /roles/:userId   — revoke platform role
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middlewares/tenantContext.js";
import { requirePlatformAuth, requirePlatformRole } from "../../middlewares/requirePlatformRole.js";
import {
  db, featureFlagsTable, platformSettingsTable, platformRolesTable, usersTable,
} from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { auditService } from "../../services/auditService.js";

const router = Router();
const superAuth = [requireAuth, requirePlatformAuth, requirePlatformRole("platform_super_admin")];
const auth      = [requireAuth, requirePlatformAuth];

// ─── Feature Flags ────────────────────────────────────────────────────────────

router.get("/flags", ...auth, async (_req, res, next) => {
  try {
    const flags = await db.select().from(featureFlagsTable).orderBy(featureFlagsTable.key);
    res.json({ flags });
  } catch (err) { next(err); }
});

router.post("/flags", ...superAuth, async (req, res, next) => {
  try {
    const { key, label, description, isEnabled, context } = req.body as Record<string, any>;
    if (!key || !label) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "key and label are required." } }); return; }

    const [flag] = await db.insert(featureFlagsTable).values({
      key, label,
      description: description ?? null,
      isEnabled: isEnabled ?? false,
      context: context ?? {},
      updatedBy: req.platformUserId!,
    }).returning();

    await auditService.log({ eventType: "platform.feature_flag_updated", actorId: req.platformUserId, metadata: { key, isEnabled, action: "created" } });
    res.status(201).json({ flag });
  } catch (err) { next(err); }
});

router.patch("/flags/:key", ...superAuth, async (req, res, next) => {
  try {
    const { isEnabled, context, label, description } = req.body as Record<string, any>;
    const [flag] = await db.update(featureFlagsTable)
      .set({
        ...(isEnabled !== undefined && { isEnabled }),
        ...(context !== undefined && { context }),
        ...(label !== undefined && { label }),
        ...(description !== undefined && { description }),
        updatedBy: req.platformUserId!,
        updatedAt: new Date(),
      })
      .where(eq(featureFlagsTable.key, req.params.key!))
      .returning();

    await auditService.log({ eventType: "platform.feature_flag_updated", actorId: req.platformUserId, metadata: { key: req.params.key, isEnabled } });
    res.json({ flag });
  } catch (err) { next(err); }
});

// ─── Platform Settings ────────────────────────────────────────────────────────

router.get("/config", ...auth, async (_req, res, next) => {
  try {
    const settings = await db.select().from(platformSettingsTable).orderBy(platformSettingsTable.key);
    res.json({ settings });
  } catch (err) { next(err); }
});

router.put("/config/:key", ...superAuth, async (req, res, next) => {
  try {
    const { value, label, description } = req.body as { value: unknown; label?: string; description?: string };
    if (value === undefined) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "value is required." } }); return; }

    const existing = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, req.params.key!)).limit(1);
    let setting;
    if (existing.length) {
      [setting] = await db.update(platformSettingsTable)
        .set({ value, updatedBy: req.platformUserId!, updatedAt: new Date(),
               ...(label !== undefined && { label }), ...(description !== undefined && { description }) })
        .where(eq(platformSettingsTable.key, req.params.key!)).returning();
    } else {
      [setting] = await db.insert(platformSettingsTable).values({
        key: req.params.key!, value, updatedBy: req.platformUserId!,
        label: label ?? req.params.key!,
        description: description ?? null,
      }).returning();
    }

    await auditService.log({ eventType: "platform.platform_setting_updated", actorId: req.platformUserId, metadata: { key: req.params.key, value } });
    res.json({ setting });
  } catch (err) { next(err); }
});

// ─── Platform Roles ───────────────────────────────────────────────────────────

router.get("/roles", ...superAuth, async (_req, res, next) => {
  try {
    const roles = await db
      .select({ role: platformRolesTable, user: { id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName } })
      .from(platformRolesTable)
      .leftJoin(usersTable, eq(usersTable.id, platformRolesTable.userId))
      .where(isNull(platformRolesTable.revokedAt))
      .orderBy(platformRolesTable.grantedAt);
    res.json({ roles });
  } catch (err) { next(err); }
});

router.post("/roles", ...superAuth, async (req, res, next) => {
  try {
    const { userId, role, grantReason } = req.body as { userId: string; role: string; grantReason?: string };
    if (!userId || !role) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "userId and role are required." } }); return; }

    const [granted] = await db.insert(platformRolesTable).values({
      id: randomUUID(), userId, role: role as any,
      grantedBy: req.platformUserId!,
      grantReason: grantReason ?? null,
      grantedAt: new Date(),
    }).returning();

    await auditService.log({ eventType: "platform.platform_role_granted", actorId: req.platformUserId, metadata: { userId, role, grantedId: granted.id } });
    res.status(201).json({ role: granted });
  } catch (err) { next(err); }
});

router.delete("/roles/:userId", ...superAuth, async (req, res, next) => {
  try {
    await db.update(platformRolesTable)
      .set({ revokedAt: new Date(), revokedBy: req.platformUserId! })
      .where(and(eq(platformRolesTable.userId, req.params.userId!), isNull(platformRolesTable.revokedAt)));

    await auditService.log({ eventType: "platform.platform_role_revoked", actorId: req.platformUserId, metadata: { userId: req.params.userId } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
