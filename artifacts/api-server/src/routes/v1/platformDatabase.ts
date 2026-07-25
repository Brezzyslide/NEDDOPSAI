/**
 * Platform Database Management Routes — Sprint 7
 *
 * Authenticated platform-staff endpoints for managing organisation operational
 * databases. Requires platform_staff role on all routes.
 *
 * Sprint 7 additions:
 *   • Data migration endpoint
 *   • Backup and restore endpoints
 *   • RLS verification endpoint
 *   • Pool metrics endpoint (sanitised — no customer content)
 *   • Updated status endpoint with dedicated DB fields
 *
 * Platform Console display rules (Sprint 7):
 *   ✓ DB provisioning status
 *   ✓ DB health (latency, table count, version)
 *   ✓ Backup status (last backup time, status)
 *   ✓ Pool status (count, capacity)
 *   ✓ Storage usage (bytes)
 *   ✓ Migration state
 *   ✓ Security alerts (from RLS verifier)
 *   ✗ Operational content (tasks, approvals, case notes, etc.)
 *   ✗ Credentials or credential references
 *   ✗ Customer personal information
 *
 * Routes:
 *   POST   /v1/platform/organisations/:id/database/provision
 *   DELETE /v1/platform/organisations/:id/database/deprovision
 *   GET    /v1/platform/organisations/:id/database/health
 *   GET    /v1/platform/organisations/:id/database/status
 *   POST   /v1/platform/organisations/:id/database/pool/drain
 *   POST   /v1/platform/organisations/:id/database/migrate
 *   POST   /v1/platform/organisations/:id/database/backup
 *   POST   /v1/platform/organisations/:id/database/restore
 *   GET    /v1/platform/organisations/:id/database/backup/status
 *   GET    /v1/platform/database/pools
 *   GET    /v1/platform/database/rls-status
 */

import { Router, type Request, type Response } from "express";
import {
  provisionOrgDb,
  deprovisionOrgDb,
  checkOrgDbHealth,
  drainOrgPool,
  getPoolStatus,
  migrateOrgData,
  createOrgBackup,
  restoreOrgBackup,
  getOrgBackupStatus,
  verifyRLS,
  verifyNeedsOpsAppRoleIsSecure,
} from "@workspace/org-db";
import { db } from "@workspace/db";
import { orgDatabaseRegistryTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const platformDatabaseRouter = Router();

// ─── POST /organisations/:id/database/provision ───────────────────────────────

platformDatabaseRouter.post(
  "/organisations/:id/database/provision",
  async (req: Request, res: Response) => {
    const organizationId = req.params.id;
    if (!organizationId) return res.status(400).json({ error: "Organization ID required" });

    const provisionedBy = (req as any).auth?.userId ?? "platform_api";
    const useDedicatedDb = req.body?.useDedicatedDb === true;
    const firstAdminUserId = req.body?.firstAdminUserId ?? undefined;

    const result = await provisionOrgDb({ organizationId, provisionedBy, useDedicatedDb, firstAdminUserId });

    if (result.success) {
      return res.status(200).json({
        success: true,
        organizationId,
        schemaName: result.schemaName,
        dbName: result.dbName,
        isDedicatedDb: result.isDedicatedDb,
        status: result.status,
        steps: result.steps,
        // credentialsRef intentionally NOT included — use secrets console to inspect
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

// ─── DELETE /organisations/:id/database/deprovision ──────────────────────────

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

// ─── GET /organisations/:id/database/health ──────────────────────────────────

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

// ─── GET /organisations/:id/database/status ──────────────────────────────────

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

    // Return operational metadata — never credentials
    return res.status(200).json({
      organizationId,
      schemaName: entry.schemaName,
      isDedicatedDb: (entry as any).isDedicatedDb ?? false,
      dbName: (entry as any).dbName ?? null,
      clusterRef: (entry as any).clusterRef ?? null,
      status: entry.status,
      isVerified: entry.isVerified,
      isMigrated: entry.isMigrated,
      migrationVersion: entry.migrationVersion,
      migrationState: (entry as any).migrationState ?? "not_started",
      lastHealthCheckAt: entry.lastHealthCheckAt,
      lastBackupAt: entry.lastBackupAt,
      backupStatus: (entry as any).backupStatus ?? "not_configured",
      storageBytes: entry.storageBytes,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      // credentialsRef intentionally omitted from response
    });
  },
);

// ─── POST /organisations/:id/database/pool/drain ─────────────────────────────

platformDatabaseRouter.post(
  "/organisations/:id/database/pool/drain",
  async (req: Request, res: Response) => {
    const organizationId = req.params.id;
    if (!organizationId) return res.status(400).json({ error: "Organization ID required" });

    await drainOrgPool(organizationId);
    return res.status(200).json({ success: true, message: "Connection pool drained." });
  },
);

// ─── POST /organisations/:id/database/migrate ─────────────────────────────────

platformDatabaseRouter.post(
  "/organisations/:id/database/migrate",
  async (req: Request, res: Response) => {
    const organizationId = req.params.id;
    if (!organizationId) return res.status(400).json({ error: "Organization ID required" });

    const dryRun = req.body?.dryRun === true;
    const triggeredBy = (req as any).auth?.userId ?? "platform_api";

    try {
      const report = await migrateOrgData({ organizationId, triggeredBy, dryRun });

      return res.status(report.success ? 200 : 500).json({
        success: report.success,
        dryRun: report.dryRun,
        organizationId,
        inventory: report.inventory,
        stages: report.stages,
        error: report.error,
        startedAt: report.startedAt,
        completedAt: report.completedAt,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─── POST /organisations/:id/database/backup ──────────────────────────────────

platformDatabaseRouter.post(
  "/organisations/:id/database/backup",
  async (req: Request, res: Response) => {
    const organizationId = req.params.id;
    if (!organizationId) return res.status(400).json({ error: "Organization ID required" });

    try {
      const result = await createOrgBackup(organizationId);

      if (result.status === "failed") {
        return res.status(500).json({
          success: false,
          organizationId,
          error: result.error,
        });
      }

      return res.status(200).json({
        success: true,
        backupId: result.backupId,
        organizationId,
        schemaName: result.schemaName,
        sizeBytes: result.sizeBytes,
        checksum: result.checksum,
        tablesCaptured: result.tablesCaptured,
        recordCounts: result.recordCounts,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        // encryptedPayload is NOT returned here — caller must retrieve from storage
        // For dev mode, the payload is returned inline; remove this in production
        encryptedPayload: process.env["NODE_ENV"] !== "production" ? result.encryptedPayload : undefined,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─── POST /organisations/:id/database/restore ─────────────────────────────────

platformDatabaseRouter.post(
  "/organisations/:id/database/restore",
  async (req: Request, res: Response) => {
    const organizationId = req.params.id;
    if (!organizationId) return res.status(400).json({ error: "Organization ID required" });

    const { encryptedPayload } = req.body ?? {};
    if (!encryptedPayload) {
      return res.status(400).json({ error: "encryptedPayload is required" });
    }

    try {
      const result = await restoreOrgBackup(organizationId, encryptedPayload);
      return res.status(result.success ? 200 : 500).json({
        success: result.success,
        organizationId,
        tablesRestored: result.tablesRestored,
        recordCounts: result.recordCounts,
        error: result.error,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─── GET /organisations/:id/database/backup/status ───────────────────────────

platformDatabaseRouter.get(
  "/organisations/:id/database/backup/status",
  async (req: Request, res: Response) => {
    const organizationId = req.params.id;
    if (!organizationId) return res.status(400).json({ error: "Organization ID required" });

    const status = await getOrgBackupStatus(organizationId);
    return res.status(200).json(status);
  },
);

// ─── GET /database/pools ──────────────────────────────────────────────────────

platformDatabaseRouter.get(
  "/database/pools",
  async (_req: Request, res: Response) => {
    return res.status(200).json(getPoolStatus());
  },
);

// ─── GET /database/rls-status ─────────────────────────────────────────────────

platformDatabaseRouter.get(
  "/database/rls-status",
  async (_req: Request, res: Response) => {
    const [rlsResult, roleCheck] = await Promise.all([
      verifyRLS({ failFast: false }),
      verifyNeedsOpsAppRoleIsSecure(),
    ]);

    return res.status(rlsResult.allPoliciesPresent ? 200 : 503).json({
      allPoliciesPresent: rlsResult.allPoliciesPresent,
      checkedAt: rlsResult.checkedAt,
      missingRLS: rlsResult.missingRLS,
      missingPolicies: rlsResult.missingPolicies,
      appRoleSecure: roleCheck.secure,
      appRoleReason: roleCheck.reason,
      tableStatuses: rlsResult.tableStatuses,
    });
  },
);
