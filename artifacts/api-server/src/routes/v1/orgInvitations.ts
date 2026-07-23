/**
 * GET    /v1/organisations/:slug/invitations                — list invitations
 * POST   /v1/organisations/:slug/invitations                — invite
 * POST   /v1/organisations/:slug/invitations/:id/resend    — resend
 * DELETE /v1/organisations/:slug/invitations/:id           — revoke
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import { requirePermission } from "../../middlewares/requirePermission.js";
import * as invitationService from "../../services/invitationService.js";
import * as auditService from "../../services/auditService.js";
import { MEMBERSHIP_ROLES } from "@workspace/shared";
import type { MembershipRole } from "@workspace/shared";

const router = Router({ mergeParams: true });

// GET /v1/organisations/:slug/invitations
router.get(
  "/",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("invitation:read"),
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const invitations = await invitationService.listInvitations(ctx.tenantId);
      res.json({ invitations });
    } catch (err) {
      next(err);
    }
  },
);

// POST /v1/organisations/:slug/invitations
router.post(
  "/",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("invitation:create"),
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { email, role } = req.body as { email?: string; role?: string };

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(422).json({
          error: { code: "VALIDATION_ERROR", message: "Valid email is required." },
        });
        return;
      }
      if (!role || !MEMBERSHIP_ROLES.includes(role as MembershipRole)) {
        res.status(422).json({
          error: { code: "VALIDATION_ERROR", message: "Valid role is required." },
        });
        return;
      }

      // Prevent inviting to owner role via invitation
      if (role === "owner") {
        res.status(422).json({
          error: { code: "VALIDATION_ERROR", message: "Cannot invite a user as owner. Promote them after they join." },
        });
        return;
      }

      const { invitation, invitationUrl } = await invitationService.createInvitation({
        organizationId: ctx.tenantId,
        email,
        role: role as MembershipRole,
        invitedByUserId: ctx.userId,
      });

      const meta = auditService.getRequestMeta(req);
      await auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId: ctx.userId,
        eventType: "invitation.created",
        resourceType: "invitation",
        resourceId: invitation.id,
        metadata: { email, role },
        ...meta,
      }).catch(() => {});

      const isDev = process.env.NODE_ENV !== "production";
      res.status(201).json({
        invitation,
        ...(isDev ? { invitationUrl } : {}),
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /v1/organisations/:slug/invitations/:invitationId/resend
router.post(
  "/:invitationId/resend",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("invitation:resend"),
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { invitation, invitationUrl } = await invitationService.resendInvitation(
        ctx.tenantId,
        String(req.params.invitationId),
      );

      const meta = auditService.getRequestMeta(req);
      await auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId: ctx.userId,
        eventType: "invitation.resent",
        resourceType: "invitation",
        resourceId: invitation.id,
        ...meta,
      }).catch(() => {});

      const isDev = process.env.NODE_ENV !== "production";
      res.json({ invitation, ...(isDev ? { invitationUrl } : {}) });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /v1/organisations/:slug/invitations/:invitationId
router.delete(
  "/:invitationId",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("invitation:revoke"),
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      await invitationService.revokeInvitation(ctx.tenantId, String(req.params.invitationId));

      const meta = auditService.getRequestMeta(req);
      await auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId: ctx.userId,
        eventType: "invitation.revoked",
        resourceType: "invitation",
        resourceId: String(req.params.invitationId),
        ...meta,
      }).catch(() => {});

      res.json({ message: "Invitation revoked." });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
