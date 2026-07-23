/**
 * GET    /v1/organisations/:slug/members               — list members
 * PATCH  /v1/organisations/:slug/members/:id           — change role
 * POST   /v1/organisations/:slug/members/:id/suspend   — suspend
 * POST   /v1/organisations/:slug/members/:id/reactivate — reactivate
 * DELETE /v1/organisations/:slug/members/:id           — revoke
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import { requirePermission } from "../../middlewares/requirePermission.js";
import * as membershipService from "../../services/membershipService.js";
import * as auditService from "../../services/auditService.js";
import type { MembershipRole } from "@workspace/shared";
import { MEMBERSHIP_ROLES } from "@workspace/shared";

const router = Router({ mergeParams: true });

// GET /v1/organisations/:slug/members
router.get(
  "/",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("member:read"),
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const rows = await membershipService.getMemberships(ctx.tenantId);
      const members = rows.map(({ membership, user }) => ({
        id: membership.id,
        role: membership.role,
        status: membership.status,
        joinedAt: membership.joinedAt,
        suspendedAt: membership.suspendedAt,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          displayName: user.displayName,
          status: user.status,
        },
      }));
      res.json({ members });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /v1/organisations/:slug/members/:id — change role
router.patch(
  "/:membershipId",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("member:update_role"),
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { role } = req.body as { role?: string };

      if (!role || !MEMBERSHIP_ROLES.includes(role as MembershipRole)) {
        res.status(422).json({
          error: { code: "VALIDATION_ERROR", message: "Valid role is required." },
        });
        return;
      }

      const updated = await membershipService.updateMembershipRole(
        ctx.tenantId,
        String(req.params.membershipId),
        role as MembershipRole,
        ctx.role,
      );

      const meta = auditService.getRequestMeta(req);
      await auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId: ctx.userId,
        eventType: "membership.role_changed",
        resourceType: "membership",
        resourceId: updated.id,
        metadata: { newRole: role },
        ...meta,
      }).catch(() => {});

      res.json({ membership: updated });
    } catch (err) {
      next(err);
    }
  },
);

// POST /v1/organisations/:slug/members/:membershipId/suspend
router.post(
  "/:membershipId/suspend",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("member:suspend"),
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const updated = await membershipService.suspendMembership(
        ctx.tenantId,
        String(req.params.membershipId),
        ctx.role,
      );

      const meta = auditService.getRequestMeta(req);
      await auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId: ctx.userId,
        eventType: "membership.suspended",
        resourceType: "membership",
        resourceId: updated.id,
        ...meta,
      }).catch(() => {});

      res.json({ membership: updated });
    } catch (err) {
      next(err);
    }
  },
);

// POST /v1/organisations/:slug/members/:membershipId/reactivate
router.post(
  "/:membershipId/reactivate",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("member:reactivate"),
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const updated = await membershipService.reactivateMembership(
        ctx.tenantId,
        String(req.params.membershipId),
      );

      const meta = auditService.getRequestMeta(req);
      await auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId: ctx.userId,
        eventType: "membership.reactivated",
        resourceType: "membership",
        resourceId: updated.id,
        ...meta,
      }).catch(() => {});

      res.json({ membership: updated });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /v1/organisations/:slug/members/:membershipId
router.delete(
  "/:membershipId",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("member:remove"),
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const revoked = await membershipService.revokeMembership(
        ctx.tenantId,
        String(req.params.membershipId),
        ctx.role,
      );

      const meta = auditService.getRequestMeta(req);
      await auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId: ctx.userId,
        eventType: "membership.revoked",
        resourceType: "membership",
        resourceId: revoked.id,
        ...meta,
      }).catch(() => {});

      res.status(200).json({ message: "Membership revoked." });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
