/**
 * AI Gateway — Usage Tracker — Sprint 9.1
 *
 * In-memory singleton that accumulates per-org token consumption, latency,
 * failure counts, fallback counts, and active stream counts.
 *
 * Resets daily at midnight UTC.
 * This is a best-effort observability layer — it does NOT replace the audit log.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrgUsageStats {
  organizationId: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  failures: number;
  fallbacks: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
}

export interface GlobalUsageStats {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  failures: number;
  fallbacks: number;
  avgLatencyMs: number;
  activeStreams: number;
  periodStart: string;   // ISO date string for the current stats window
  provider: string;
  model: string;
}

// ─── Singleton state ──────────────────────────────────────────────────────────

interface InternalState {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  failures: number;
  fallbacks: number;
  totalLatencyMs: number;
  activeStreams: number;
  periodStart: Date;
  byOrg: Map<string, {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    failures: number;
    fallbacks: number;
    totalLatencyMs: number;
  }>;
}

const state: InternalState = {
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  failures: 0,
  fallbacks: 0,
  totalLatencyMs: 0,
  activeStreams: 0,
  periodStart: new Date(),
  byOrg: new Map(),
};

// Reset daily at midnight UTC
function maybeResetDaily(): void {
  const now = new Date();
  if (
    now.getUTCDate() !== state.periodStart.getUTCDate() ||
    now.getUTCMonth() !== state.periodStart.getUTCMonth() ||
    now.getUTCFullYear() !== state.periodStart.getUTCFullYear()
  ) {
    state.requests = 0;
    state.inputTokens = 0;
    state.outputTokens = 0;
    state.totalTokens = 0;
    state.failures = 0;
    state.fallbacks = 0;
    state.totalLatencyMs = 0;
    state.byOrg.clear();
    state.periodStart = now;
  }
}

function getOrg(orgId: string) {
  if (!state.byOrg.has(orgId)) {
    state.byOrg.set(orgId, {
      requests: 0, inputTokens: 0, outputTokens: 0,
      totalTokens: 0, failures: 0, fallbacks: 0, totalLatencyMs: 0,
    });
  }
  return state.byOrg.get(orgId)!;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Record a successful AI completion */
export function recordSuccess(opts: {
  organizationId: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}): void {
  maybeResetDaily();
  state.requests++;
  state.inputTokens += opts.inputTokens;
  state.outputTokens += opts.outputTokens;
  state.totalTokens += opts.inputTokens + opts.outputTokens;
  state.totalLatencyMs += opts.latencyMs;

  const org = getOrg(opts.organizationId);
  org.requests++;
  org.inputTokens += opts.inputTokens;
  org.outputTokens += opts.outputTokens;
  org.totalTokens += opts.inputTokens + opts.outputTokens;
  org.totalLatencyMs += opts.latencyMs;
}

/** Record a provider failure (before fallback) */
export function recordFailure(organizationId: string): void {
  maybeResetDaily();
  state.failures++;
  getOrg(organizationId).failures++;
}

/** Record a deterministic fallback being used */
export function recordFallback(organizationId: string): void {
  maybeResetDaily();
  state.fallbacks++;
  getOrg(organizationId).fallbacks++;
}

/** Increment active stream counter */
export function incrementActiveStreams(): void {
  state.activeStreams++;
}

/** Decrement active stream counter */
export function decrementActiveStreams(): void {
  if (state.activeStreams > 0) state.activeStreams--;
}

/** Global usage snapshot */
export function getGlobalStats(provider: string, model: string): GlobalUsageStats {
  maybeResetDaily();
  const avgLatency = state.requests > 0 ? Math.round(state.totalLatencyMs / state.requests) : 0;
  return {
    requests: state.requests,
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
    totalTokens: state.totalTokens,
    failures: state.failures,
    fallbacks: state.fallbacks,
    avgLatencyMs: avgLatency,
    activeStreams: state.activeStreams,
    periodStart: state.periodStart.toISOString(),
    provider,
    model,
  };
}

/** Per-org usage snapshot */
export function getOrgStats(organizationId: string): OrgUsageStats {
  maybeResetDaily();
  const org = state.byOrg.get(organizationId) ?? {
    requests: 0, inputTokens: 0, outputTokens: 0,
    totalTokens: 0, failures: 0, fallbacks: 0, totalLatencyMs: 0,
  };
  const avgLatency = org.requests > 0 ? Math.round(org.totalLatencyMs / org.requests) : 0;
  return {
    organizationId,
    requests: org.requests,
    inputTokens: org.inputTokens,
    outputTokens: org.outputTokens,
    totalTokens: org.totalTokens,
    failures: org.failures,
    fallbacks: org.fallbacks,
    totalLatencyMs: org.totalLatencyMs,
    avgLatencyMs: avgLatency,
  };
}
