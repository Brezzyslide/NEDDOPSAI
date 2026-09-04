/**
 * Device management routes — Sprint 14
 *
 * GET  /v1/organisations/:slug/devices              — list org devices
 * POST /v1/organisations/:slug/devices/:id/revoke   — revoke a device
 * PATCH /v1/organisations/:slug/devices/:id/name    — rename a device
 *
 * POST /v1/devices/:id/heartbeat              — broker heartbeat (device auth)
 * PATCH /v1/devices/:id/tunnel-url            — update tunnel URL (device auth)
 * POST /v1/devices/:id/first-run-complete     — mark first-run complete (device auth)
 * POST /v1/devices/:id/runtime-status         — report crash/update (device auth)
 * GET  /v1/devices/:id/config                 — get agent configuration (device auth)
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import { requirePermission } from "../../middlewares/requirePermission.js";
import * as deviceService from "../../services/deviceService.js";
import * as auditService from "../../services/auditService.js";
import { devicesTable, withTenantContext } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router({ mergeParams: true });

// ── Clerk-authenticated org-scoped routes ─────────────────────────────────────

// GET /v1/organisations/:slug/devices
router.get(
  "/organisations/:slug/devices",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("organization:read"),
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const devices = await deviceService.listOrgDevices(ctx.tenantId);
      res.json({ devices });
    } catch (err) {
      next(err);
    }
  },
);

// POST /v1/organisations/:slug/devices/:id/revoke
router.post(
  "/organisations/:slug/devices/:id/revoke",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      const deviceId = req.params.id!;
      const { reason } = req.body as { reason?: string };

      // Check: members can only revoke their own device; admins/owners can revoke any
      const [device] = await withTenantContext(
        { tenantId: ctx.tenantId, userId: user.id, purpose: "device.revoke.lookup" },
        (tx) => tx
          .select()
          .from(devicesTable)
          .where(
            and(
              eq(devicesTable.id, deviceId),
              eq(devicesTable.organizationId, ctx.tenantId),
            ),
          )
          .limit(1),
      );

      if (!device) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Device not found." } });
        return;
      }

      const isOwnerOrAdmin = ctx.permissions.includes("organization:update");
      const isOwnDevice = device.userId === user.id;

      if (!isOwnerOrAdmin && !isOwnDevice) {
        res.status(403).json({ error: { code: "FORBIDDEN", message: "You can only revoke your own devices." } });
        return;
      }

      await deviceService.revokeDevice(deviceId, user.id, ctx.tenantId, reason);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /v1/organisations/:slug/devices/:id/name
router.patch(
  "/organisations/:slug/devices/:id/name",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      const deviceId = req.params.id!;
      const { displayName } = req.body as { displayName?: string };

      if (!displayName?.trim()) {
        res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "displayName is required." } });
        return;
      }

      const [device] = await withTenantContext(
        { tenantId: ctx.tenantId, userId: user.id, purpose: "device.rename.lookup" },
        (tx) => tx
          .select()
          .from(devicesTable)
          .where(
            and(
              eq(devicesTable.id, deviceId),
              eq(devicesTable.organizationId, ctx.tenantId),
            ),
          )
          .limit(1),
      );

      if (!device) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Device not found." } });
        return;
      }

      const isOwnerOrAdmin = ctx.permissions.includes("organization:update");
      if (!isOwnerOrAdmin && device.userId !== user.id) {
        res.status(403).json({ error: { code: "FORBIDDEN", message: "You can only rename your own devices." } });
        return;
      }

      await withTenantContext(
        { tenantId: ctx.tenantId, userId: user.id, purpose: "device.rename" },
        (tx) => tx
          .update(devicesTable)
          .set({ displayName: displayName.trim(), updatedAt: new Date() })
          .where(
            and(
              eq(devicesTable.id, deviceId),
              eq(devicesTable.organizationId, ctx.tenantId),
            ),
          ),
      );

      res.json({ ok: true, displayName: displayName.trim() });
    } catch (err) {
      next(err);
    }
  },
);

// ── Device-authenticated routes (broker auth) ─────────────────────────────────

/**
 * Middleware: authenticate via device Bearer token.
 * Attaches `req.authenticatedDevice` on success.
 */
async function requireDeviceAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization as string | undefined;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: { code: "DEVICE_AUTH_REQUIRED", message: "Device authentication required." } });
    return;
  }

  const token = authHeader.slice(7);
  const result = await deviceService.authenticateDevice(token);

  if (!result) {
    res.status(401).json({ error: { code: "INVALID_DEVICE_CREDENTIALS", message: "Device credentials are invalid or revoked." } });
    return;
  }

  req.authenticatedDevice = result.device;
  next();
}

// POST /v1/devices/:id/heartbeat
router.post("/devices/:id/heartbeat", requireDeviceAuth, async (req, res, next) => {
  try {
    const device = (req as any).authenticatedDevice;

    // Ensure the device ID in the URL matches the authenticated device
    if (device.id !== req.params.id) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Device ID mismatch." } });
      return;
    }

    const {
      brokerVersion,
      openclawVersion,
      appVersion,
      brokerStatus,
      openclawStatus,
      tunnelStatus,
      browserExtensionInstalled,
      browserName,
      tunnelUrl,
    } = req.body as Record<string, any>;

    await deviceService.recordHeartbeat({
      deviceId: device.id,
      organizationId: device.organizationId,
      brokerVersion,
      openclawVersion,
      appVersion,
      brokerStatus,
      openclawStatus,
      tunnelStatus,
      browserExtensionInstalled,
      browserName,
      tunnelUrl,
    });

    res.json({
      ok: true,
      minimumSupportedVersion: process.env.MIN_DESKTOP_VERSION ?? "1.0.0",
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /v1/devices/:id/tunnel-url
router.patch("/devices/:id/tunnel-url", requireDeviceAuth, async (req, res, next) => {
  try {
    const device = (req as any).authenticatedDevice;
    if (device.id !== req.params.id) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Device ID mismatch." } });
      return;
    }

    const { tunnelUrl } = req.body as { tunnelUrl?: string };
    if (!tunnelUrl) {
      res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "tunnelUrl is required." } });
      return;
    }

    await withTenantContext(
      { tenantId: device.organizationId, userId: device.userId, purpose: "device.tunnel_url" },
      (tx) => tx.update(devicesTable)
        .set({ tunnelUrl, updatedAt: new Date() })
        .where(and(
          eq(devicesTable.organizationId, device.organizationId),
          eq(devicesTable.id, device.id),
        )),
    );

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /v1/devices/:id/first-run-complete
router.post("/devices/:id/first-run-complete", requireDeviceAuth, async (req, res, next) => {
  try {
    const device = (req as any).authenticatedDevice;
    if (device.id !== req.params.id) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Device ID mismatch." } });
      return;
    }

    await deviceService.completeFirstRun(device.id, device.organizationId);

    await auditService.writeAuditEvent({
      organizationId: device.organizationId,
      actorUserId: device.userId,
      eventType: "device.first_run_completed",
      resourceType: "device",
      resourceId: device.id,
      metadata: req.body,
    }).catch(() => {});

    res.json({ ok: true, readyState: "ready" });
  } catch (err) {
    next(err);
  }
});

// POST /v1/devices/:id/runtime-status
router.post("/devices/:id/runtime-status", requireDeviceAuth, async (req, res, next) => {
  try {
    const device = (req as any).authenticatedDevice;
    if (device.id !== req.params.id) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Device ID mismatch." } });
      return;
    }

    const { event, details } = req.body as { event?: string; details?: Record<string, unknown> };

    await auditService.writeAuditEvent({
      organizationId: device.organizationId,
      actorUserId: device.userId,
      eventType: `device.runtime.${event ?? "status_report"}`,
      resourceType: "device",
      resourceId: device.id,
      metadata: details,
    }).catch(() => {});

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /v1/devices/:id/config
router.get("/devices/:id/config", requireDeviceAuth, async (req, res, next) => {
  try {
    const device = (req as any).authenticatedDevice;
    if (device.id !== req.params.id) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Device ID mismatch." } });
      return;
    }

    // Load org details + agent configurations
    const { orgCompanyProfileTable, agentConfigurationsTable, orgApprovalRulesDiscoveryTable } =
      await import("@workspace/db");

    const { profile, agents, approvalRules } = await withTenantContext(
      { tenantId: device.organizationId, userId: device.userId, purpose: "device.config" },
      async (tx) => {
        const [profileRow] = await tx
          .select()
          .from(orgCompanyProfileTable)
          .where(eq(orgCompanyProfileTable.organizationId, device.organizationId))
          .limit(1);

        const agentRows = await tx
          .select()
          .from(agentConfigurationsTable)
          .where(eq(agentConfigurationsTable.organizationId, device.organizationId));

        const approvalRuleRows = await tx
          .select()
          .from(orgApprovalRulesDiscoveryTable)
          .where(eq(orgApprovalRulesDiscoveryTable.organizationId, device.organizationId));

        return { profile: profileRow, agents: agentRows, approvalRules: approvalRuleRows };
      },
    );

    res.json({
      organizationId: device.organizationId,
      companyProfile: profile ?? null,
      agentConfigurations: agents,
      approvalRules,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
