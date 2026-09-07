/**
 * Platform Staff Management routes — /v1/platform/staff
 * Sprint 9.7 — Owner Control Plane
 *
 * GET    /                       — list platform staff
 * POST   /invite                 — invite / add a staff member
 * DELETE /:userId/roles/:role    — revoke a specific role from a staff member
 * POST   /:userId/suspend        — suspend all active roles for a staff member
 * GET    /:userId/activity       — recent privileged actions by this staff member
 */

import {
  Router } from "express";
import { platformDb } from "@workspace/db/platform";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middlewares/tenantContext.js";
import { requirePlatformAuth,
  requirePlatformRole } from "../../middlewares/requirePlatformRole.js";
import {
  platformRolesTable,
  platformAuditLogTable,
  usersTable,
  platformRoleEnum,
} from "@workspace/db";
import { eq, and, isNull, count } from "drizzle-orm";
import { auditService } from "../../services/auditService.js";

const router = Router();
const auth = [requireAuth, requirePlatformAuth];
const adminAuth = [requireAuth, requirePlatformAuth, requirePlatformRole("platform_admin")];

// Valid role values derived from the enum
const VALID_ROLES: string[] = platformRoleEnum.enumValues as unknown as string[];

// ─── GET / — List platform staff ─────────────────────────────────────────────

router.get("/", ...adminAuth, async (_req, res, next) => {
  try {
    const staff = await platformDb.select({
        id: platformRolesTable.id,
        userId: platformRolesTable.userId,
        role: platformRolesTable.role,
        grantedAt: platformRolesTable.grantedAt,
        user: {
          name: usersTable.firstName,
          email: usersTable.email,
        },
      })
      .from(platformRolesTable)
      .leftJoin(usersTable, eq(usersTable.id, platformRolesTable.userId))
      .where(isNull(platformRolesTable.revokedAt))
      .orderBy(platformRolesTable.grantedAt);

    const result = staff.map((row) => ({
      id: row.id,
      userId: row.userId,
      role: row.role,
      grantedAt: row.grantedAt,
      user: {
        name: row.user?.name ?? null,
        email: row.user?.email ?? null,
      },
    }));

    res.json({ staff: result });
  } catch (err) { next(err); }
});

// ─── POST /invite — Invite/add a staff member ─────────────────────────────────

router.post("/invite", ...adminAuth, async (req, res, next) => {
  try {
    const { userId, role, reason } = req.body as { userId?: string; role?: string; reason?: string };

    if (!userId || !role || !reason) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "userId, role, and reason are required." } });
      return;
    }

    // Validate role value
    if (!VALID_ROLES.includes(role)) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` } });
      return;
    }

    // Only platform_super_admin can grant platform_super_admin
    if (role === "platform_super_admin" && req.platformRole !== "platform_super_admin") {
      res.status(403).json({ error: { code: "PERMISSION_DENIED", message: "Only a platform_super_admin can grant the platform_super_admin role." } });
      return;
    }

    // Check for existing active role record for this userId+role
    const [existing] = await platformDb.select()
      .from(platformRolesTable)
      .where(and(
        eq(platformRolesTable.userId, userId),
        eq(platformRolesTable.role, role as any),
        isNull(platformRolesTable.revokedAt),
      ))
      .limit(1);

    if (existing) {
      res.status(409).json({ error: { code: "CONFLICT", message: "This user already has an active record for this role." } });
      return;
    }

    const [record] = await platformDb.insert(platformRolesTable).values({
      id: randomUUID(),
      userId,
      role: role as any,
      grantedBy: req.platformUserId!,
      grantReason: reason,
      grantedAt: new Date(),
    }).returning();

    await auditService.log({
      eventType: "platform.platform_role_granted",
      actorId: req.platformUserId,
      metadata: { userId, role, recordId: record!.id, reason },
    });

    res.status(201).json({ success: true, record });
  } catch (err) { next(err); }
});

// ─── DELETE /:userId/roles/:role — Revoke a staff role ───────────────────────

router.delete("/:userId/roles/:role", ...adminAuth, async (req, res, next) => {
  try {
    const { userId, role } = req.params as { userId: string; role: string };

    // Only platform_super_admin can revoke platform_super_admin
    if (role === "platform_super_admin" && req.platformRole !== "platform_super_admin") {
      res.status(403).json({ error: { code: "PERMISSION_DENIED", message: "Only a platform_super_admin can revoke the platform_super_admin role." } });
      return;
    }

    // Verify the role record exists
    const [existing] = await platformDb.select()
      .from(platformRolesTable)
      .where(and(
        eq(platformRolesTable.userId, userId),
        eq(platformRolesTable.role, role as any),
        isNull(platformRolesTable.revokedAt),
      ))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "No active role record found for this user and role." } });
      return;
    }

    // CRITICAL: If revoking platform_super_admin, ensure at least 1 remains after revocation
    if (role === "platform_super_admin") {
      const [{ n }] = await platformDb.select({ n: count() })
        .from(platformRolesTable)
        .where(and(
          eq(platformRolesTable.role, "platform_super_admin"),
          isNull(platformRolesTable.revokedAt),
        ));

      if (Number(n) <= 1) {
        res.status(409).json({
          error: {
            code: "LAST_SUPER_ADMIN",
            message: "Cannot revoke the last platform_super_admin. Assign another super admin first.",
          },
        });
        return;
      }
    }

    await platformDb.update(platformRolesTable)
      .set({ revokedAt: new Date(), revokedBy: req.platformUserId! })
      .where(and(
        eq(platformRolesTable.userId, userId),
        eq(platformRolesTable.role, role as any),
        isNull(platformRolesTable.revokedAt),
      ));

    await auditService.log({
      eventType: "platform.platform_role_revoked",
      actorId: req.platformUserId,
      metadata: { userId, role },
    });

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── POST /:userId/suspend — Suspend a staff member ──────────────────────────

router.post("/:userId/suspend", ...adminAuth, async (req, res, next) => {
  try {
    const { userId } = req.params as { userId: string };
    const { reason } = req.body as { reason?: string };

    if (!reason) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "reason is required." } });
      return;
    }

    // Fetch all active roles for this user
    const activeRoles = await platformDb.select()
      .from(platformRolesTable)
      .where(and(
        eq(platformRolesTable.userId, userId),
        isNull(platformRolesTable.revokedAt),
      ));

    if (activeRoles.length === 0) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "No active platform roles found for this user." } });
      return;
    }

    const now = new Date();

    // Revoke all active roles
    await platformDb.update(platformRolesTable)
      .set({ revokedAt: now, revokedBy: req.platformUserId! })
      .where(and(
        eq(platformRolesTable.userId, userId),
        isNull(platformRolesTable.revokedAt),
      ));

    // Fire audit events for each revoked role
    await Promise.all(
      activeRoles.map((r) =>
        auditService.log({
          eventType: "platform.platform_role_revoked",
          actorId: req.platformUserId,
          metadata: { userId, role: r.role, suspendReason: reason, action: "suspended" },
        }),
      ),
    );

    // Fire the suspension audit event
    await auditService.log({
      eventType: "platform.platform_staff_suspended",
      actorId: req.platformUserId,
      metadata: { userId, reason, rolesRevoked: activeRoles.map((r) => r.role) },
    });

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── GET /:userId/activity — Recent privileged actions by a staff member ──────

router.get("/:userId/activity", ...adminAuth, async (req, res, next) => {
  try {
    const { userId } = req.params as { userId: string };

    const events = await platformDb.select()
      .from(platformAuditLogTable)
      .where(eq(platformAuditLogTable.actorUserId, userId))
      .orderBy(platformAuditLogTable.occurredAt)
      .limit(20);

    // Sort descending in JS (Drizzle desc import is available but keep it simple)
    events.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

    res.json({ events });
  } catch (err) { next(err); }
});

export default router;
