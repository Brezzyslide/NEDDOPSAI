import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { getRuntimeIdentity } from "../lib/runtimeIdentity.js";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/readyz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "ready",
      identity: getRuntimeIdentity(),
      checks: {
        database: "reachable",
      },
    });
  } catch {
    res.status(503).json({
      status: "not_ready",
      identity: getRuntimeIdentity(),
      checks: {
        database: "unreachable",
      },
    });
  }
});

export default router;
