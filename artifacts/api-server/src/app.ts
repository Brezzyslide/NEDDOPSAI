import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware.js";
import { requestIdMiddleware } from "./middlewares/requestId.js";
import router from "./routes/index.js";
import v1Router from "./routes/v1/index.js";
import { logger } from "./lib/logger.js";

const app: Express = express();

// ── 1. Request ID (before everything else for correlation) ────────────────────
app.use(requestIdMiddleware);

// ── 2. Structured logging ─────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.headers["x-request-id"] as string,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── 3. Clerk proxy — MUST come before body parsers (streams raw bytes) ─────────
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// ── 4. CORS ───────────────────────────────────────────────────────────────────
app.use(cors({ credentials: true, origin: true }));

// ── 5. Body parsers ───────────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ── 6. Clerk session middleware ───────────────────────────────────────────────
// Reads CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY automatically from process.env
app.use(clerkMiddleware());

// ── 7. Routes ─────────────────────────────────────────────────────────────────
// Sprint 0 public routes (kept for backwards compat during Sprint 1)
app.use("/api", router);

// Sprint 1 authenticated routes
app.use("/v1", v1Router);

export default app;
