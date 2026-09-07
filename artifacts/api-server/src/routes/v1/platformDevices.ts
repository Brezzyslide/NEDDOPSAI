/**
 * Platform Device Fleet routes — mounted at /v1/platform/devices
 * Task #34: Connector & Device Fleet Management
 *
 * GET  /                        — list all devices across all orgs
 * GET  /:id                     — device detail
 * GET  /:id/history             — audit history for device
 * GET  /:id/errors              — error history for device
 * POST /:id/revoke              — permanently revoke device
 * POST /:id/disable             — temporarily disable device
 * POST /:id/enable              — re-enable a disabled device
 * POST /:id/rotate-credentials  — revoke active credentials (forces re-activation)
 *
 * Also mounts org-scoped device list:
 * GET  /by-org/:orgId           — devices for a specific org (used by org detail tab)
 *
 * Security:
 *   - Read routes require any active platform role.
 *   - Revoke/disable/enable/rotate require platform operations admin and are rate-limited (20/hr).
 *   - No plaintext tokens or credential hashes ever returned
 */

import { Router } from "express";
import { requireAuth } from "../../middlewares/tenantContext.js";
import { requirePlatformAuth, requirePlatformRole } from "../../middlewares/requirePlatformRole.js";
import * as platformDeviceService from "../../services/platformDeviceService.js";

const router = Router();
const auth = [requireAuth, requirePlatformAuth];
const operationsAdminAuth = [requireAuth, requirePlatformAuth, requirePlatformRole("platform_operations_admin")];

// ─── GET / — Fleet list ────────────────────────────────────────────────────────

router.get("/", ...auth, async (req, res, next) => {
  try {
    const result = await platformDeviceService.listDevicesForPlatform({
      organizationId: req.query.orgId as string | undefined,
      status:         req.query.status as string | undefined,
      search:         req.query.search as string | undefined,
      page:           req.query.page ? Number(req.query.page) : 1,
      limit:          req.query.limit ? Number(req.query.limit) : 50,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// ─── GET /by-org/:orgId — Devices for a single org ────────────────────────────

router.get("/by-org/:orgId", ...auth, async (req, res, next) => {
  try {
    const devices = await platformDeviceService.listDevicesForOrg(req.params.orgId!);
    res.json({ devices });
  } catch (err) { next(err); }
});

// ─── GET /:id — Device detail ─────────────────────────────────────────────────

router.get("/:id", ...auth, async (req, res, next) => {
  try {
    const device = await platformDeviceService.getDeviceDetailForPlatform(req.params.id!);
    if (!device) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Device not found." } });
      return;
    }
    res.json({ device });
  } catch (err) { next(err); }
});

// ─── GET /:id/history — Device audit history ──────────────────────────────────

router.get("/:id/history", ...auth, async (req, res, next) => {
  try {
    const events = await platformDeviceService.getDeviceAuditHistory(req.params.id!);
    res.json({ events });
  } catch (err) { next(err); }
});

// ─── GET /:id/errors — Device error history ───────────────────────────────────

router.get("/:id/errors", ...auth, async (req, res, next) => {
  try {
    const errors = await platformDeviceService.getDeviceErrorHistory(req.params.id!);
    res.json({ errors });
  } catch (err) { next(err); }
});

// ─── Rate-limited action helper ───────────────────────────────────────────────

function withRateLimit(handler: (req: any, res: any, next: any) => Promise<void>) {
  return async (req: any, res: any, next: any) => {
    try {
      platformDeviceService.checkActionRateLimit(req.platformUserId!);
    } catch (e: any) {
      res.status(e.status ?? 429).json({ error: { code: "RATE_LIMITED", message: e.message } });
      return;
    }
    return handler(req, res, next);
  };
}

// ─── POST /:id/revoke — Permanently revoke ────────────────────────────────────

router.post("/:id/revoke", ...operationsAdminAuth, withRateLimit(async (req, res, next) => {
  try {
    const { reason } = req.body as { reason?: string };
    await platformDeviceService.platformRevokeDevice(req.params.id!, req.platformUserId!, reason);
    res.json({ ok: true });
  } catch (err: any) {
    if (err.status) { res.status(err.status).json({ error: { code: "REQUEST_ERROR", message: err.message } }); return; }
    next(err);
  }
}));

// ─── POST /:id/disable — Temporarily disable ──────────────────────────────────

router.post("/:id/disable", ...operationsAdminAuth, withRateLimit(async (req, res, next) => {
  try {
    const { reason } = req.body as { reason?: string };
    await platformDeviceService.platformDisableDevice(req.params.id!, req.platformUserId!, reason);
    res.json({ ok: true });
  } catch (err: any) {
    if (err.status) { res.status(err.status).json({ error: { code: "REQUEST_ERROR", message: err.message } }); return; }
    next(err);
  }
}));

// ─── POST /:id/enable — Re-enable a disabled device ───────────────────────────

router.post("/:id/enable", ...operationsAdminAuth, withRateLimit(async (req, res, next) => {
  try {
    await platformDeviceService.platformEnableDevice(req.params.id!, req.platformUserId!);
    res.json({ ok: true });
  } catch (err: any) {
    if (err.status) { res.status(err.status).json({ error: { code: "REQUEST_ERROR", message: err.message } }); return; }
    next(err);
  }
}));

// ─── POST /:id/rotate-credentials — Rotate device credentials ────────────────

router.post("/:id/rotate-credentials", ...operationsAdminAuth, withRateLimit(async (req, res, next) => {
  try {
    const { reason } = req.body as { reason?: string };
    const result = await platformDeviceService.platformRotateDeviceCredentials(
      req.params.id!, req.platformUserId!, reason,
    );
    // Return only metadata — no tokens
    res.json({ ok: true, credentialsRevoked: result.credentialsRevoked });
  } catch (err: any) {
    if (err.status) { res.status(err.status).json({ error: { code: "REQUEST_ERROR", message: err.message } }); return; }
    next(err);
  }
}));

export default router;
