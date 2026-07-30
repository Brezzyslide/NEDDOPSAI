/**
 * Payment Bypass routes — Sprint 14
 *
 * ⚠️  DEVELOPMENT ONLY — gated behind ENABLE_PAYMENT_BYPASS=true
 *
 * POST /v1/organisations/:slug/payment/bypass
 *   Simulate a successful checkout. Activates subscription and provisions packs.
 *
 * GET  /v1/payment/bypass/status
 *   Returns whether payment bypass is enabled (safe to expose publicly).
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import { requirePermission } from "../../middlewares/requirePermission.js";
import * as paymentBypassService from "../../services/paymentBypassService.js";
import * as auditService from "../../services/auditService.js";

const router = Router({ mergeParams: true });

// GET /v1/payment/bypass/status — safe to expose; tells the UI whether to show the button
router.get("/payment/bypass/status", (_req, res) => {
  res.json({
    enabled: paymentBypassService.isPaymentBypassEnabled(),
    warning: paymentBypassService.isPaymentBypassEnabled()
      ? "DEV MODE: Payment bypass is active. Do not use in production."
      : null,
  });
});

// POST /v1/organisations/:slug/payment/bypass
router.post(
  "/organisations/:slug/payment/bypass",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("organization:update"),
  async (req, res, next) => {
    try {
      if (!paymentBypassService.isPaymentBypassEnabled()) {
        res.status(403).json({
          error: {
            code: "PAYMENT_BYPASS_DISABLED",
            message: "Payment bypass is not available. Use a real payment method.",
          },
        });
        return;
      }

      const ctx = req.tenantContext!;
      const user = req.appUser!;
      const {
        planCode,
        billingCycle = "monthly",
        selectedPackCodes = [],
      } = req.body as {
        planCode?: string;
        billingCycle?: "monthly" | "annual";
        selectedPackCodes?: string[];
      };

      if (!planCode) {
        res.status(422).json({
          error: { code: "VALIDATION_ERROR", message: "planCode is required." },
        });
        return;
      }

      const result = await paymentBypassService.activatePaymentBypass(
        {
          organizationId: ctx.tenantId,
          userId: user.id,
          planCode,
          billingCycle,
          selectedPackCodes,
        },
        auditService.getRequestMeta(req),
      );

      res.json({
        ok: true,
        subscription: result,
        warning: "DEV MODE: This is a simulated payment. No real charge was made.",
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
