import { Router } from "express";
import { sql } from "drizzle-orm";
import { db, organizationsTable, usersTable, workforcePacksTable } from "@workspace/db";
import { PLATFORM_VERSION } from "@workspace/shared";
import {
  isDiagnosticsAuthorized,
  readRuntimeDiagnostics,
} from "../services/runtimeDiagnosticsService.js";

const router = Router();

// GET /system/status
router.get("/status", async (_req, res) => {
  const services = [];
  let overall: "operational" | "degraded" | "outage" = "operational";

  // Check DB
  const dbStart = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    services.push({ name: "Database", status: "operational" as const, latencyMs: Date.now() - dbStart });
  } catch {
    services.push({ name: "Database", status: "outage" as const, latencyMs: null });
    overall = "outage";
  }

  // API server itself is responding
  services.push({ name: "API Server", status: "operational" as const, latencyMs: 0 });

  // Placeholder for future services (OpenAI, OpenClaw, etc.)
  services.push({ name: "AI Orchestration", status: "operational" as const, latencyMs: null });
  services.push({ name: "Worker Service", status: "operational" as const, latencyMs: null });

  res.json({ overall, services, updatedAt: new Date().toISOString() });
});

// GET /system/dashboard-summary
router.get("/dashboard-summary", async (_req, res) => {
  const [orgStats, userStats, packStats] = await Promise.all([
    db.execute<{ total: string; active: string }>(
      sql`SELECT count(*) as total, count(*) FILTER (WHERE status = 'active') as active FROM organizations`
    ),
    db.execute<{ total: string }>(
      sql`SELECT count(*) as total FROM users`
    ),
    db.execute<{ total: string }>(
      sql`SELECT count(*) as total FROM workforce_packs WHERE status = 'available'`
    ),
  ]);

  const orgRow = orgStats.rows[0];
  const userRow = userStats.rows[0];
  const packRow = packStats.rows[0];

  res.json({
    totalOrganizations: Number(orgRow?.total ?? 0),
    activeOrganizations: Number(orgRow?.active ?? 0),
    totalUsers: Number(userRow?.total ?? 0),
    workforcePacksAvailable: Number(packRow?.total ?? 0),
    platformVersion: PLATFORM_VERSION,
    lastUpdated: new Date().toISOString(),
  });
});

// GET /system/diagnostics
router.get("/diagnostics", async (req, res) => {
  const token = req.header("x-needsops-diagnostics-token");
  if (!isDiagnosticsAuthorized(token)) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
    return;
  }

  const includeStorageRoundTrip = req.query["storageRoundTrip"] === "true";
  const diagnostics = await readRuntimeDiagnostics({ runStorageRoundTrip: includeStorageRoundTrip });
  res.json(diagnostics);
});

export default router;
