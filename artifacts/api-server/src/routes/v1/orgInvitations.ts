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
      if (role === "owner") {
        res.status(422).json({
          error: { code: "VALIDATION_ERROR", message: "Cannot invite a user as owner. Promote them after they join." },
        });
        return;
      }

      const { invitation, previewUrl, emailDelivery } = await invitationService.createInvitation({
        organizationId: ctx.tenantId,
        email,
        role: role as MembershipRole,
        invitedByUserId: ctx.userId,
      });

      const meta = auditService.getRequestMeta(req);

      // Audit: invitation created
      await auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId: ctx.userId,
        eventType: "invitation.created",
        resourceType: "invitation",
        resourceId: invitation.id,
        metadata: { email, role },
        ...meta,
      }).catch(() => {});

      // Audit: email delivery outcome
      const emailAuditType =
        emailDelivery.state === "sent" ? "invitation.email_sent"
        : emailDelivery.state === "development_preview" ? "invitation.email_preview_created"
        : "invitation.email_failed";

      await auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId: ctx.userId,
        eventType: emailAuditType,
        resourceType: "invitation",
        resourceId: invitation.id,
        metadata: {
          email,
          provider: emailDelivery.provider,
          deliveryState: emailDelivery.state,
          ...(emailDelivery.providerMessageId ? { providerMessageId: emailDelivery.providerMessageId } : {}),
          ...(emailDelivery.failureCategory ? { failureCategory: emailDelivery.failureCategory } : {}),
        },
        ...meta,
      }).catch(() => {});

      const emailFailed = emailDelivery.state === "failed";
      res.status(201).json({
        success: true,
        data: {
          invitationCreated: true,
          invitation,
          emailDelivery: emailDelivery.state,
          ...(emailFailed ? { message: "The invitation was created, but the email could not be delivered." } : {}),
          ...(previewUrl ? { previewUrl } : {}),
        },
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
      const { invitation, previewUrl, emailDelivery } = await invitationService.resendInvitation(
        ctx.tenantId,
        String(req.params.invitationId),
        ctx.userId,
      );

      const meta = auditService.getRequestMeta(req);

      await auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId: ctx.userId,
        eventType: "invitation.resent",
        resourceType: "invitation",
        resourceId: invitation.id,
        metadata: { email: invitation.email, provider: emailDelivery.provider, deliveryState: emailDelivery.state },
        ...meta,
      }).catch(() => {});

      const emailAuditType =
        emailDelivery.state === "sent" ? "invitation.email_sent"
        : emailDelivery.state === "development_preview" ? "invitation.email_preview_created"
        : "invitation.email_failed";

      await auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId: ctx.userId,
        eventType: emailAuditType,
        resourceType: "invitation",
        resourceId: invitation.id,
        metadata: {
          email: invitation.email,
          provider: emailDelivery.provider,
          deliveryState: emailDelivery.state,
          ...(emailDelivery.providerMessageId ? { providerMessageId: emailDelivery.providerMessageId } : {}),
        },
        ...meta,
      }).catch(() => {});

      const emailFailed = emailDelivery.state === "failed";
      res.json({
        success: true,
        data: {
          invitation,
          emailDelivery: emailDelivery.state,
          ...(emailFailed ? { message: "The invitation was updated, but the email could not be delivered." } : {}),
          ...(previewUrl ? { previewUrl } : {}),
        },
      });
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
