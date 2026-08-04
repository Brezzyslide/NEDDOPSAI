/**
 * Workforce Operations Centre routes — Sprint 26
 *
 * All routes require organisation membership (requireAuth + resolveTenantFromSlug).
 * Management actions require owner or administrator role.
 *
 * Routes:
 *   GET  /v1/organisations/:slug/workforce-ops/summary
 *   GET  /v1/organisations/:slug/workforce-ops/alerts
 *   GET  /v1/organisations/:slug/workforce-ops/health
 *   GET  /v1/organisations/:slug/workforce-ops/:code/profile
 *   GET  /v1/organisations/:slug/workforce-ops/:code/readiness
 *   GET  /v1/organisations/:slug/workforce-ops/:code/workload
 *   GET  /v1/organisations/:slug/workforce-ops/:code/performance
 *   GET  /v1/organisations/:slug/workforce-ops/:code/knowledge
 *   POST /v1/organisations/:slug/workforce-ops/:code/actions
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import {
  getWorkforceSummary,
  getSpecialistOpsProfile,
  getSpecialistReadiness,
  getSpecialistWorkload,
  getSpecialistPerformance,
  getSpecialistKnowledge,
  getWorkforceAlerts,
  performSpecialistAction,
  getOrgWorkforceHealth,
  WorkforceOpsError,
} from "../../services/workforceOpsService.js";

const router = Router({ mergeParams: true });

/** Inline role gate — management actions are owner/administrator only. */
function requireOwnerOrAdmin(req: Request, res: Response, next: NextFunction): void {
  const role = req.tenantContext?.role;
  if (role !== "owner" && role !== "administrator") {
    res.status(403).json({ error: { code: "FORBIDDEN", message: "Owner or administrator role required." } });
    return;
  }
  next();
}

function handleOpsError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof WorkforceOpsError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
    return;
  }
  next(err);
}

// ─── GET /summary ─────────────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/workforce-ops/summary",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const orgId = req.tenantContext!.tenantId;
      const summary = await getWorkforceSummary(orgId);
      res.json(summary);
    } catch (err) { handleOpsError(err, res, next); }
  },
);

// ─── GET /alerts ──────────────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/workforce-ops/alerts",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const orgId = req.tenantContext!.tenantId;
      const alerts = await getWorkforceAlerts(orgId);
      const { severity } = req.query as { severity?: string };
      const filtered = severity ? alerts.filter(a => a.severity === severity) : alerts;
      res.json({ alerts: filtered, total: filtered.length });
    } catch (err) { handleOpsError(err, res, next); }
  },
);

// ─── GET /health ──────────────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/workforce-ops/health",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const orgId = req.tenantContext!.tenantId;
      const slug  = req.params.slug as string;
      const health = await getOrgWorkforceHealth(orgId, slug);
      res.json(health);
    } catch (err) { handleOpsError(err, res, next); }
  },
);

// ─── GET /:code/profile ───────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/workforce-ops/:code/profile",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const orgId = req.tenantContext!.tenantId;
      const code  = req.params.code as string;
      const profile = await getSpecialistOpsProfile(orgId, code);
      res.json(profile);
    } catch (err) { handleOpsError(err, res, next); }
  },
);

// ─── GET /:code/readiness ─────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/workforce-ops/:code/readiness",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const orgId = req.tenantContext!.tenantId;
      const code  = req.params.code as string;
      const slug  = req.params.slug as string;
      const readiness = await getSpecialistReadiness(orgId, code, slug);
      res.json(readiness);
    } catch (err) { handleOpsError(err, res, next); }
  },
);

// ─── GET /:code/workload ──────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/workforce-ops/:code/workload",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const orgId = req.tenantContext!.tenantId;
      const code  = req.params.code as string;
      const workload = await getSpecialistWorkload(orgId, code);
      res.json(workload);
    } catch (err) { handleOpsError(err, res, next); }
  },
);

// ─── GET /:code/performance ───────────────────────────────────────────────────

router.get(
  "/organisations/:slug/workforce-ops/:code/performance",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const orgId = req.tenantContext!.tenantId;
      const code  = req.params.code as string;
      const raw   = req.query.period;
      const period = raw === "7" ? 7 : raw === "90" ? 90 : 30;
      const perf  = await getSpecialistPerformance(orgId, code, period as 7 | 30 | 90);
      res.json(perf);
    } catch (err) { handleOpsError(err, res, next); }
  },
);

// ─── GET /:code/knowledge ─────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/workforce-ops/:code/knowledge",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const orgId = req.tenantContext!.tenantId;
      const code  = req.params.code as string;
      const knowledge = await getSpecialistKnowledge(orgId, code);
      res.json(knowledge);
    } catch (err) { handleOpsError(err, res, next); }
  },
);

// ─── POST /:code/actions ──────────────────────────────────────────────────────

router.post(
  "/organisations/:slug/workforce-ops/:code/actions",
  requireAuth,
  resolveTenantFromSlug,
  requireOwnerOrAdmin,
  async (req, res, next) => {
    try {
      const orgId  = req.tenantContext!.tenantId;
      const userId = req.tenantContext!.userId;
      const code   = req.params.code as string;
      const slug   = req.params.slug as string;
      const { action } = req.body as { action?: string };

      if (!action) {
        res.status(400).json({ error: { code: "MISSING_ACTION", message: "Request body must include 'action'." } });
        return;
      }

      const result = await performSpecialistAction(orgId, code, action, userId, slug);
      res.json(result);
    } catch (err) { handleOpsError(err, res, next); }
  },
);

export default router;
