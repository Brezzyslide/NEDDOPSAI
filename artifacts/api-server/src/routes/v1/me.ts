/**
 * GET  /v1/me          — current user profile
 * PATCH /v1/me         — update profile
 * GET  /v1/me/organisations — list orgs the user belongs to
 */

import { Router } from "express";
import { requireAuth } from "../../middlewares/tenantContext.js";
import * as userService from "../../services/userService.js";
import * as auditService from "../../services/auditService.js";

const router = Router();

// GET /v1/me
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const user = req.appUser!;
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

// PATCH /v1/me
router.patch("/", requireAuth, async (req, res, next) => {
  try {
    const user = req.appUser!;
    const {
      firstName,
      lastName,
      displayName,
      preferredTimezone,
      locale,
    } = req.body as Record<string, string | undefined>;

    const updated = await userService.updateUser(user.id, {
      firstName,
      lastName,
      displayName,
      preferredTimezone,
      locale,
    });

    const meta = auditService.getRequestMeta(req);
    await auditService.writeAuditEvent({
      actorUserId: user.id,
      eventType: "user.profile_updated",
      resourceType: "user",
      resourceId: user.id,
      ...meta,
    }).catch(() => {});

    res.json({ user: updated });
  } catch (err) {
    next(err);
  }
});

// GET /v1/me/organisations
router.get("/organisations", requireAuth, async (req, res, next) => {
  try {
    const user = req.appUser!;
    const memberships = await userService.getUserMemberships(user.externalId);

    const organisations = memberships.map(({ membership, org }) => ({
      id: org.id,
      slug: org.slug,
      name: org.name,
      displayName: org.displayName,
      status: org.status,
      subscriptionTier: org.subscriptionTier,
      role: membership.role,
      membershipStatus: membership.status,
      joinedAt: membership.joinedAt,
    }));

    res.json({ organisations });
  } catch (err) {
    next(err);
  }
});

export default router;
