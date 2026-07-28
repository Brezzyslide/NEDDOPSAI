/**
 * POST /v1/organisations              — create new organisation (triggers onboarding)
 * GET  /v1/organisations/:slug        — get org details
 * PATCH /v1/organisations/:slug       — update org details
 * GET  /v1/organisations/:slug/settings — get tenant settings
 * PATCH /v1/organisations/:slug/settings — update tenant settings
 */

import { Router } from "express";
import {
  requireAuth,
  resolveTenantFromSlug,
} from "../../middlewares/tenantContext.js";
import { requirePermission } from "../../middlewares/requirePermission.js";
import * as orgService from "../../services/orgService.js";
import * as auditService from "../../services/auditService.js";
import { provisionPacksForNewOrg } from "../../services/packProvisioningService.js";

const router = Router();

// POST /v1/organisations — create new org
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const user = req.appUser!;
    const {
      name,
      type,
      industry,
      country,
      state,
      timezone,
      abn,
      ndisRegistrationNumber,
      primaryContactName,
      primaryContactEmail,
    } = req.body as Record<string, string | undefined>;

    if (!name || name.trim().length < 2) {
      res.status(422).json({
        error: { code: "VALIDATION_ERROR", message: "Organisation name must be at least 2 characters." },
      });
      return;
    }

    const initialWorkforcePacks: string[] = Array.isArray(req.body.initialWorkforcePacks)
      ? req.body.initialWorkforcePacks.filter((c: unknown) => typeof c === "string")
      : [];

    const { org, membership } = await orgService.createOrg(
      { name: name.trim(), type, industry, country, state, timezone, abn, ndisRegistrationNumber, primaryContactName, primaryContactEmail },
      user.id,
    );

    const meta = auditService.getRequestMeta(req);
    await auditService.writeAuditEvent({
      organizationId: org.id,
      actorUserId: user.id,
      eventType: "organisation.created",
      resourceType: "organization",
      resourceId: org.id,
      metadata: { name: org.name, slug: org.slug },
      ...meta,
    }).catch(() => {});

    // Provision workforce packs (Core auto-granted + selected packs)
    const packProvisioningResult = await provisionPacksForNewOrg(
      org.id,
      user.id,
      initialWorkforcePacks,
      meta,
    ).catch(err => {
      // Non-fatal: org was created; log and continue
      console.error("[packProvisioning] Failed during org creation:", err);
      return null;
    });

    res.status(201).json({ organisation: org, membership, packProvisioning: packProvisioningResult });
  } catch (err) {
    next(err);
  }
});

// GET /v1/organisations/:slug
router.get(
  "/:slug",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("organization:read"),
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const org = await orgService.getOrgById(ctx.tenantId);
      const settings = await orgService.getTenantSettings(ctx.tenantId);
      res.json({ organisation: org, settings });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /v1/organisations/:slug
router.patch(
  "/:slug",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("organization:update"),
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      const updates = req.body as Record<string, unknown>;

      const updated = await orgService.updateOrg(ctx.tenantId, {
        name: updates.name as string | undefined,
        displayName: updates.displayName as string | undefined,
        type: updates.type as string | undefined,
        industry: updates.industry as string | undefined,
        country: updates.country as string | undefined,
        state: updates.state as string | undefined,
        timezone: updates.timezone as string | undefined,
        employeeCount: updates.employeeCount as number | undefined,
        participantCount: updates.participantCount as number | undefined,
        businessPhone: updates.businessPhone as string | undefined,
        website: updates.website as string | undefined,
        abn: updates.abn as string | undefined,
        ndisRegistrationNumber: updates.ndisRegistrationNumber as string | undefined,
        primaryContactName: updates.primaryContactName as string | undefined,
        primaryContactEmail: updates.primaryContactEmail as string | undefined,
      });

      const meta = auditService.getRequestMeta(req);
      await auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId: user.id,
        eventType: "organisation.updated",
        resourceType: "organization",
        resourceId: ctx.tenantId,
        ...meta,
      }).catch(() => {});

      res.json({ organisation: updated });
    } catch (err) {
      next(err);
    }
  },
);

// GET /v1/organisations/:slug/settings
router.get(
  "/:slug/settings",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("settings:read"),
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const settings = await orgService.getTenantSettings(ctx.tenantId);
      res.json({ settings });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /v1/organisations/:slug/settings
router.patch(
  "/:slug/settings",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("settings:update"),
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const updates = req.body as Record<string, string | undefined>;
      const settings = await orgService.updateTenantSettings(ctx.tenantId, {
        timezone: updates.timezone,
        locale: updates.locale,
        dateFormat: updates.dateFormat,
        timeFormat: updates.timeFormat,
        defaultCurrency: updates.defaultCurrency,
        industry: updates.industry,
        dataRegion: updates.dataRegion,
        securityNotificationEmail: updates.securityNotificationEmail,
      });
      res.json({ settings });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
