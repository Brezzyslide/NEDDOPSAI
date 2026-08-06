/**
 * AI Provider Health Routes — Sprint 28.6
 *
 * Safe provider health check that validates the OpenAI key using a minimal
 * models list request. Never prints or exposes the key value.
 *
 * Routes:
 *   GET /v1/ai/health          — checks OpenAI connectivity; org members only
 *   GET /v1/platform/ai/health — same check; platform staff only
 */

import { Router } from "express";
import { requireAuth } from "../../middlewares/tenantContext.js";
import { requirePlatformAuth } from "../../middlewares/requirePlatformRole.js";

const router = Router();

// ─── Health check implementation ──────────────────────────────────────────────

async function runOpenAIHealthCheck(): Promise<{
  status: "healthy" | "misconfigured" | "auth_failure" | "network_error" | "unknown";
  errorCategory: string | null;
  model: string | null;
  provider: string;
  checkedAt: string;
}> {
  const provider = process.env.AI_PROVIDER ?? "none";
  const model    = process.env.OPENAI_MODEL ?? null;
  const checkedAt = new Date().toISOString();

  if (provider !== "openai") {
    return { status: "misconfigured", errorCategory: "AI_PROVIDER_NOT_OPENAI", model, provider, checkedAt };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { status: "misconfigured", errorCategory: "OPENAI_API_KEY_MISSING", model, provider, checkedAt };
  }

  try {
    // Minimal request — list models. No tokens generated. Fast, cheap.
    const response = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (response.ok) {
      return { status: "healthy", errorCategory: null, model, provider, checkedAt };
    }

    if (response.status === 401 || response.status === 403) {
      return { status: "auth_failure", errorCategory: `HTTP_${response.status}`, model, provider, checkedAt };
    }

    if (response.status === 429) {
      // Rate-limited but auth is fine — treat as healthy for key validation purposes
      return { status: "healthy", errorCategory: "RATE_LIMITED", model, provider, checkedAt };
    }

    return { status: "unknown", errorCategory: `HTTP_${response.status}`, model, provider, checkedAt };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("timeout") || msg.includes("abort") || msg.includes("TimeoutError")) {
      return { status: "network_error", errorCategory: "REQUEST_TIMEOUT", model, provider, checkedAt };
    }
    if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || msg.includes("network")) {
      return { status: "network_error", errorCategory: "CONNECTION_REFUSED", model, provider, checkedAt };
    }
    return { status: "unknown", errorCategory: "UNEXPECTED_ERROR", model, provider, checkedAt };
  }
}

// ─── Org-scoped route (any authenticated org member) ─────────────────────────

router.get(
  "/ai/health",
  requireAuth,
  async (_req, res, next) => {
    try {
      const result = await runOpenAIHealthCheck();
      const httpStatus = result.status === "healthy" ? 200 : 503;
      res.status(httpStatus).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Platform route (staff only) ─────────────────────────────────────────────

router.get(
  "/platform/ai/health",
  requirePlatformAuth,
  async (_req, res, next) => {
    try {
      const result = await runOpenAIHealthCheck();
      const httpStatus = result.status === "healthy" ? 200 : 503;
      res.status(httpStatus).json(result);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
