import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
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
  res.status(410).json({
    error: {
      code: "ENDPOINT_RETIRED",
      message: "Legacy public dashboard summary has been retired. Use authenticated platform APIs.",
    },
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
