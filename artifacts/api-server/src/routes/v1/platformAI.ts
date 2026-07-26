/**
 * Platform AI Operations routes — /v1/platform/ai/*
 *
 * Sprint 9.1: AI Privacy Gateway monitoring for platform staff.
 *
 * Routes:
 *   GET /status   — current provider, model, connection status, usage
 *   GET /stats    — token usage, latency, failures, fallback count, active streams
 *
 * Restricted to platform roles. Never exposes API keys or provider credentials.
 */

import { Router } from "express";
import { requireAuth } from "../../middlewares/tenantContext.js";
import { requirePlatformAuth } from "../../middlewares/requirePlatformRole.js";
import {
  getProviderRegistry,
  getActiveProviderStatus,
  getGlobalStats,
} from "@workspace/ai-gateway";

const router = Router();
const auth = [requireAuth, requirePlatformAuth];

// GET /v1/platform/ai/status
router.get("/status", ...auth, (_req, res, next) => {
  try {
    const active = getActiveProviderStatus();
    const registry = getProviderRegistry();

    const openaiProvider = registry.find(p => p.provider === "openai");
    const internalProvider = registry.find(p => p.provider === "internal");

    res.json({
      activeProvider: {
        name:      active.provider,
        connected: active.connected,
        model:     active.model ?? null,
        status:    active.connected ? "healthy" : "not_connected",
      },
      providers: registry.map(p => ({
        name:            p.provider,
        connected:       p.connected,
        configured:      p.configured,
        requiresApproval: p.requiresApproval,
        model:           p.model ?? null,
      })),
      openai: {
        configured:  openaiProvider?.configured ?? false,
        connected:   openaiProvider?.connected ?? false,
        model:       openaiProvider?.model ?? null,
      },
      internal: {
        configured: internalProvider?.configured ?? true,
        connected:  internalProvider?.connected ?? true,
      },
      configuration: {
        aiProvider:      process.env.AI_PROVIDER ?? "internal",
        openaiModel:     process.env.OPENAI_MODEL ?? null,
        routingModel:    process.env.OPENAI_ROUTING_MODEL ?? null,
        planningModel:   process.env.OPENAI_PLANNING_MODEL ?? null,
        reasoningModel:  process.env.OPENAI_REASONING_MODEL ?? null,
        timeoutMs:       parseInt(process.env.AI_TIMEOUT_MS ?? "30000", 10),
        maxRetries:      parseInt(process.env.AI_MAX_RETRIES ?? "2", 10),
        // Never expose the API key — only show whether it's set
        apiKeyConfigured: !!(process.env.OPENAI_API_KEY),
      },
      retrievedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /v1/platform/ai/stats
router.get("/stats", ...auth, (_req, res, next) => {
  try {
    const active = getActiveProviderStatus();
    const stats = active.usageStats;

    res.json({
      period: {
        start: stats.periodStart,
        description: "Today (resets at midnight UTC)",
      },
      provider: stats.provider,
      model:    stats.model,
      requests: {
        total:    stats.requests,
        failures: stats.failures,
        fallbacks: stats.fallbacks,
        successRate: stats.requests > 0
          ? Math.round(((stats.requests - stats.failures) / stats.requests) * 100)
          : 100,
      },
      tokens: {
        input:  stats.inputTokens,
        output: stats.outputTokens,
        total:  stats.totalTokens,
      },
      latency: {
        avgMs: stats.avgLatencyMs,
      },
      streams: {
        active: stats.activeStreams,
      },
      retrievedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
