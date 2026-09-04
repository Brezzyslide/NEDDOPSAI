/**
 * Activation Code routes — Sprint 14
 *
 * POST /v1/organisations/:slug/activation-codes
 *   Generate a new activation code for the org (owner/admin only).
 *
 * POST /v1/activation-codes/redeem
 *   Redeem an activation code and register a device (public, rate-limited).
 *
 * DELETE /v1/organisations/:slug/activation-codes/current
 *   Revoke the current unused activation code.
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import { requirePermission } from "../../middlewares/requirePermission.js";
import * as activationCodeService from "../../services/activationCodeService.js";
import * as deviceService from "../../services/deviceService.js";
import * as auditService from "../../services/auditService.js";
import { deviceActivationTokensTable, withTenantContext } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

const router = Router({ mergeParams: true });

// ── Generate activation code ───────────────────────────────────────────────────

router.post(
  "/organisations/:slug/activation-codes",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("organization:update"),
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;

      const result = await activationCodeService.createActivationCode(
        ctx.tenantId,
        user.id,
      );

      await auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId: user.id,
        eventType: "activation_code.created",
        resourceType: "activation_token",
        resourceId: result.id,
        metadata: { expiresAt: result.expiresAt },
        ...auditService.getRequestMeta(req),
      }).catch(() => {});

      res.status(201).json({
        activationCode: {
          id: result.id,
          code: result.code,        // plaintext — shown once
          expiresAt: result.expiresAt,
          expiresInMinutes: 15,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── Revoke current activation code ────────────────────────────────────────────

router.delete(
  "/organisations/:slug/activation-codes/current",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("organization:update"),
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;

      await withTenantContext(
        { tenantId: ctx.tenantId, userId: user.id, purpose: "activation_code.revoke_current" },
        (tx) => tx
          .update(deviceActivationTokensTable)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(deviceActivationTokensTable.organizationId, ctx.tenantId),
              isNull(deviceActivationTokensTable.usedAt),
              isNull(deviceActivationTokensTable.revokedAt),
            ),
          ),
      );

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ── Redeem activation code (public, rate-limited) ─────────────────────────────

/**
 * POST /v1/activation-codes/redeem
 *
 * Called by the desktop app during first-run activation.
 * No Clerk auth — the activation code IS the auth for this step.
 * Rate limit enforced at the route level.
 */
router.post("/activation-codes/redeem", async (req, res, next) => {
  try {
    const {
      code,
      organizationId,
      platform,
      arch,
      hostname,
      osVersion,
      appVersion,
      publicKey,
      displayName,
    } = req.body as {
      code?: string;
      organizationId?: string;
      platform?: string;
      arch?: string;
      hostname?: string;
      osVersion?: string;
      appVersion?: string;
      publicKey?: string;
      displayName?: string;
    };

    if (!code || !organizationId || !platform) {
      res.status(422).json({
        error: { code: "VALIDATION_ERROR", message: "code, organizationId, and platform are required." },
      });
      return;
    }

    // Validate the activation code
    const redeemResult = await activationCodeService.redeemActivationCode(code, organizationId);

    if (!redeemResult.ok) {
      const statusMap = {
        expired: 410,
        used: 409,
        invalid: 404,
        locked: 429,
        revoked: 410,
      } as const;

      const messageMap = {
        expired: "This activation code has expired. Request a new one from your NeedsOps portal.",
        used: "This activation code has already been used.",
        invalid: "Activation code not found. Check the code and try again.",
        locked: "Too many failed attempts. Request a new activation code from your portal.",
        revoked: "This activation code has been cancelled. Request a new one from your portal.",
      };

      res.status(statusMap[redeemResult.reason]).json({
        error: {
          code: `ACTIVATION_CODE_${redeemResult.reason.toUpperCase()}`,
          message: messageMap[redeemResult.reason],
        },
      });

      // Record the failed attempt
      await activationCodeService.recordFailedAttempt(code).catch(() => {});
      return;
    }

    // Find the user who created the token (to associate with the device)
    const { db, deviceActivationTokensTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const [token] = await db
      .select()
      .from(deviceActivationTokensTable)
      .where(eq(deviceActivationTokensTable.id, redeemResult.tokenId))
      .limit(1);

    const registrationUserId = token?.createdByUserId ?? "system";

    // Register the device
    const credentials = await deviceService.registerDevice(
      {
        organizationId: redeemResult.organizationId,
        userId: registrationUserId,
        displayName: displayName?.trim() || `${hostname ?? platform} Device`,
        platform,
        arch,
        hostname,
        osVersion,
        appVersion,
        publicKey,
      },
      auditService.getRequestMeta(req),
    );

    // Mark the activation code as used
    await activationCodeService.markTokenUsed(redeemResult.tokenId, credentials.deviceId);

    res.status(201).json({
      deviceId: credentials.deviceId,
      brokerAuthToken: credentials.brokerAuthToken,  // plaintext — store in keychain
      webhookSecret: credentials.webhookSecret,       // plaintext — store in keychain
      organizationId: credentials.organizationId,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
