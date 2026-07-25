/**
 * Platform Database Management Routes — Sprint 6
 *
 * Authenticated platform-staff endpoints for managing organisation
 * operational databases. All routes require the "platform_staff" role.
 *
 * Routes:
 *   POST   /v1/platform/organisations/:id/database/provision
 *   DELETE /v1/platform/organisations/:id/database/deprovision
 *   GET    /v1/platform/organisations/:id/database/health
 *   GET    /v1/platform/organisations/:id/database/status
 *   POST   /v1/platform/organisations/:id/database/pool/drain
 *   GET    /v1/platform/database/pools
 */

import { Router, type Request, type Response } from "express";
import {
  provisionOrgDb,
  deprovisionOrgDb,
  checkOrgDbHealth,
  drainOrgPool,
  getPoolStatus,
} from "@workspace/org-db";
import { db } from "@workspace/db";
import { orgDatabaseRegistryTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const platformDatabaseRouter = Router();

// ─── POST /v1/platform/organisations/:id/database/provision ──────────────────

platformDatabaseRouter.post(
  "/organisations/:id/database/provision",
  async (req: Request, res: Response) => {
    const organizationId = req.params.id;
    if (!organizationId) return res.status(400).json({ error: "Organization ID required" });

    const provisionedBy = (req as any).auth?.userId ?? "platform_api";

    const result = await provisionOrgDb({ organizationId, provisionedBy });

    if (result.success) {
      return res.status(200).json({
        success: true,
        organizationId,
        schemaName: result.schemaName,
        status: result.status,
        steps: result.steps,
      });
    } else {
      return res.status(500).json({
        success: false,
        organizationId,
        schemaName: result.schemaName,
        error: result.error,
        steps: result.steps,
      });
    }
  },
);

// ─── DELETE /v1/platform/organisations/:id/database/deprovision ──────────────

platformDatabaseRouter.delete(
  "/organisations/:id/database/deprovision",
  async (req: Request, res: Response) => {
    const organizationId = req.params.id;
    if (!organizationId) return res.status(400).json({ error: "Organization ID required" });

    const provisionedBy = (req as any).auth?.userId ?? "platform_api";
    const result = await deprovisionOrgDb(organizationId, provisionedBy);

    if (result.success) {
      return res.status(200).json({ success: true, message: result.message });
    } else {
      return res.status(409).json({ success: false, message: result.message });
    }
  },
);

// ─── GET /v1/platform/organisations/:id/database/health ──────────────────────

platformDatabaseRouter.get(
  "/organisations/:id/database/health",
  async (req: Request, res: Response) => {
    const organizationId = req.params.id;
    if (!organizationId) return res.status(400).json({ error: "Organization ID required" });

    const health = await checkOrgDbHealth(organizationId);

    const httpStatus = health.status === "healthy" ? 200
      : health.status === "degraded" ? 200
      : 503;

    return res.status(httpStatus).json(health);
  },
);

// ─── GET /v1/platform/organisations/:id/database/status ──────────────────────

platformDatabaseRouter.get(
  "/organisations/:id/database/status",
  async (req: Request, res: Response) => {
    const organizationId = req.params.id;
    if (!organizationId) return res.status(400).json({ error: "Organization ID required" });

    const [entry] = await db
      .select()
      .from(orgDatabaseRegistryTable)
      .where(eq(orgDatabaseRegistryTable.organizationId, organizationId))
      .limit(1);

    if (!entry) {
      return res.status(404).json({
        organizationId,
        status: "not_provisioned",
        message: "No operational database registered for this organisation.",
      });
    }

    return res.status(200).json({
      organizationId,
      schemaName: entry.schemaName,
      status: entry.status,
      isVerified: entry.isVerified,
      isMigrated: entry.isMigrated,
      migrationVersion: entry.migrationVersion,
      lastHealthCheckAt: entry.lastHealthCheckAt,
      lastBackupAt: entry.lastBackupAt,
      storageBytes: entry.storageBytes,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    });
  },
);

// ─── POST /v1/platform/organisations/:id/database/pool/drain ─────────────────

platformDatabaseRouter.post(
  "/organisations/:id/database/pool/drain",
  async (req: Request, res: Response) => {
    const organizationId = req.params.id;
    if (!organizationId) return res.status(400).json({ error: "Organization ID required" });

    await drainOrgPool(organizationId);
    return res.status(200).json({ success: true, message: "Connection pool drained." });
  },
);

// ─── GET /v1/platform/database/pools ─────────────────────────────────────────

platformDatabaseRouter.get(
  "/database/pools",
  async (_req: Request, res: Response) => {
    return res.status(200).json(getPoolStatus());
  },
);
