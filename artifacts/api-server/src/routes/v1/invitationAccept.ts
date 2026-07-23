/**
 * POST /v1/invitations/accept — accept an invitation by raw token
 *
 * Body: { token: string }
 * Requires: authenticated user (requireAuth)
 */

import { Router } from "express";
import { requireAuth } from "../../middlewares/tenantContext.js";
import * as invitationService from "../../services/invitationService.js";
import * as auditService from "../../services/auditService.js";

const router = Router();

router.post("/accept", requireAuth, async (req, res, next) => {
  try {
    const user = req.appUser!;
    const { token } = req.body as { token?: string };

    if (!token || typeof token !== "string" || token.length < 10) {
      res.status(400).json({
        error: { code: "INVITATION_INVALID", message: "Invalid invitation token." },
      });
      return;
    }

    const { membership, invitation } = await invitationService.acceptInvitation(
      token,
      user.id,
      user.email,
    );

    const meta = auditService.getRequestMeta(req);
    await auditService.writeAuditEvent({
      organizationId: invitation.organizationId,
      actorUserId: user.id,
      eventType: "invitation.accepted",
      resourceType: "invitation",
      resourceId: invitation.id,
      metadata: { membershipId: membership.id, role: membership.role },
      ...meta,
    }).catch(() => {});

    res.json({ membership, invitation });
  } catch (err) {
    next(err);
  }
});

export default router;
