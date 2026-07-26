/**
 * Platform Runtime Monitor — /platform/runtime
 *
 * Sprint 8: OpenClaw Runtime Integration
 * Sprint 9.1: AI Operations section added
 *
 * Displays the current state of the OpenClaw Runtime Broker connection
 * and the AI Privacy Gateway provider health + usage metrics.
 */

import { useEffect, useState, useCallback } from "react";
import { usePlatformFetch } from "@/lib/platformApi";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RuntimeStatus {
  runtime: {
    name: string;
    configured: boolean;
    runtimeUrl: string | null;
    status: "healthy" | "degraded" | "unavailable" | "not_connected";
    version: string;
    lastHeartbeatAt: string | null;
    connectedAt: string | null;
    message: string | null;
  };
  executions: {
    active: number;
    queued: number;
    failed: number;
  };
  capabilities: {
    name: string;
    version: string;
    supportedChannels: string[];
    supportedToolCategories: string[];
    maxConcurrentExecutions: number;
  } | null;
  retrievedAt: string;
}

interface AIStatus {
  activeProvider: {
    name: string;
    connected: boolean;
    model: string | null;
    status: string;
  };
  configuration: {
    aiProvider: string;
    openaiModel: string | null;
    timeoutMs: number;
    maxRetries: number;
    apiKeyConfigured: boolean;
  };
  providers: Array<{
    name: string;
    connected: boolean;
    configured: boolean;
    requiresApproval: boolean;
    model: string | null;
  }>;
}

interface AIStats {
  provider: string;
  model: string;
  requests: {
    total: number;
    failures: number;
    fallbacks: number;
    successRate: number;
  };
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  latency: { avgMs: number };
  streams: { active: number };
  period: { start: string; description: string };
}

// ─── AI Operations section ────────────────────────────────────────────────────

function AIOperationsSection({ platformFetch }: { platformFetch: ReturnType<typeof usePlatformFetch> }) {
  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null);
  const [aiStats, setAiStats] = useState<AIStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAI = useCallback(async () => {
    try {
      const [statusRes, statsRes] = await Promise.all([
        platformFetch("/ai/status"),
        platformFetch("/ai/stats"),
      ]);
      if (statusRes.ok) setAiStatus(await statusRes.json() as AIStatus);
      if (statsRes.ok)  setAiStats(await statsRes.json() as AIStats);
    } catch { /* show stale data */ }
    finally { setLoading(false); }
  }, [platformFetch]);

  useEffect(() => { void fetchAI(); }, [fetchAI]);

  const providerColour = (connected: boolean) =>
    connected ? "text-emerald-400" : "text-slate-500";

  if (loading) return <div className="text-slate-500 text-sm animate-pulse">Loading AI operations…</div>;

  const provider = aiStatus?.activeProvider;
  const cfg = aiStatus?.configuration;

  return (
    <div className="space-y-5">
      <h2 className="text-base font-semibold text-slate-200 uppercase tracking-wide">
        AI Operations
      </h2>

      {/* Active provider card */}
      <div className="bg-[#0B1829] rounded-xl border border-[#1E3A5F] p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h3 className="text-base font-semibold text-white capitalize">
                {provider?.name ?? "internal"} provider
              </h3>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                provider?.connected
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-slate-500/20 text-slate-400 border border-slate-500/30"
              }`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current mr-1.5" />
                {provider?.status ?? "unknown"}
              </span>
            </div>
            <p className="text-sm text-slate-400">
              {cfg?.aiProvider === "openai"
                ? cfg.apiKeyConfigured
                  ? `OpenAI connected · Model: ${provider?.model ?? "not set"}`
                  : "OpenAI selected but OPENAI_API_KEY is not configured"
                : "Deterministic (rule-based) · No external AI calls"}
            </p>
          </div>
          <span className="text-xs text-slate-500 font-mono">
            {cfg?.aiProvider ?? "internal"}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          <div>
            <p className="text-slate-500 uppercase tracking-wide mb-1">Model</p>
            <p className="text-slate-300 font-mono">{provider?.model ?? "—"}</p>
          </div>
          <div>
            <p className="text-slate-500 uppercase tracking-wide mb-1">Timeout</p>
            <p className="text-slate-300">{cfg?.timeoutMs ? `${cfg.timeoutMs / 1000}s` : "—"}</p>
          </div>
          <div>
            <p className="text-slate-500 uppercase tracking-wide mb-1">Max retries</p>
            <p className="text-slate-300">{cfg?.maxRetries ?? "—"}</p>
          </div>
          <div>
            <p className="text-slate-500 uppercase tracking-wide mb-1">API key</p>
            <p className={cfg?.apiKeyConfigured ? "text-emerald-400" : "text-slate-500"}>
              {cfg?.apiKeyConfigured ? "Configured" : "Not set"}
            </p>
          </div>
        </div>

        {/* All providers */}
        {aiStatus?.providers && (
          <div className="mt-5 pt-5 border-t border-[#1E3A5F]">
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Approved providers</p>
            <div className="flex flex-wrap gap-2">
              {aiStatus.providers.map(p => (
                <span
                  key={p.name}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${
                    p.connected
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                      : "border-[#1E3A5F] bg-[#112033] text-slate-500"
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${p.connected ? "bg-emerald-400" : "bg-slate-600"}`} />
                  {p.name}
                  {p.model && <span className="text-slate-500 font-mono text-[10px] ml-0.5">({p.model})</span>}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Today's usage metrics */}
      {aiStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-[#0B1829] rounded-xl border border-[#1E3A5F] p-5">
            <p className="text-xs text-slate-400 uppercase tracking-wide">Requests today</p>
            <p className="text-2xl font-semibold text-white mt-1">{aiStats.requests.total.toLocaleString()}</p>
            <p className="text-xs text-slate-500 mt-1">{aiStats.requests.successRate}% success</p>
          </div>
          <div className="bg-[#0B1829] rounded-xl border border-[#1E3A5F] p-5">
            <p className="text-xs text-slate-400 uppercase tracking-wide">Tokens today</p>
            <p className="text-2xl font-semibold text-white mt-1">{aiStats.tokens.total.toLocaleString()}</p>
            <p className="text-xs text-slate-500 mt-1">{aiStats.tokens.input.toLocaleString()} in · {aiStats.tokens.output.toLocaleString()} out</p>
          </div>
          <div className="bg-[#0B1829] rounded-xl border border-[#1E3A5F] p-5">
            <p className="text-xs text-slate-400 uppercase tracking-wide">Avg latency</p>
            <p className="text-2xl font-semibold text-white mt-1">
              {aiStats.latency.avgMs > 0 ? `${aiStats.latency.avgMs}ms` : "—"}
            </p>
            <p className="text-xs text-slate-500 mt-1">Per request</p>
          </div>
          <div className="bg-[#0B1829] rounded-xl border border-[#1E3A5F] p-5">
            <p className="text-xs text-slate-400 uppercase tracking-wide">Fallbacks</p>
            <p className={`text-2xl font-semibold mt-1 ${aiStats.requests.fallbacks > 0 ? "text-yellow-400" : "text-white"}`}>
              {aiStats.requests.fallbacks}
            </p>
            <p className="text-xs text-slate-500 mt-1">{aiStats.requests.failures} failures · {aiStats.streams.active} active streams</p>
          </div>
        </div>
      )}

      {cfg?.aiProvider !== "openai" && (
        <div className="rounded-lg bg-[#112033] border border-[#1E3A5F] p-4">
          <p className="text-xs text-slate-400 leading-relaxed">
            <span className="text-[#00D4FF] font-medium">OpenAI not active.</span>{" "}
            Set{" "}
            <code className="font-mono text-slate-300 bg-[#0B1829] px-1 rounded">AI_PROVIDER=openai</code>
            {" "}and{" "}
            <code className="font-mono text-slate-300 bg-[#0B1829] px-1 rounded">OPENAI_API_KEY</code>
            {" "}in the platform environment to enable the AI Chief of Staff.
            The deterministic classifier is currently active as fallback.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    healthy:       "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
    degraded:      "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
    unavailable:   "bg-red-500/20 text-red-400 border border-red-500/30",
    not_connected: "bg-slate-500/20 text-slate-400 border border-slate-500/30",
  };

  const labels: Record<string, string> = {
    healthy:       "Healthy",
    degraded:      "Degraded",
    unavailable:   "Unavailable",
    not_connected: "Not Connected",
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${variants[status] ?? variants.not_connected}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current mr-1.5" />
      {labels[status] ?? status}
    </span>
  );
}

// ─── Metric card ──────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-[#0B1829] rounded-xl border border-[#1E3A5F] p-5">
      <p className="text-xs text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-semibold text-white mt-1">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PlatformRuntime() {
  const platformFetch = usePlatformFetch();
  const [, forceRefresh] = useState(0);
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await platformFetch("/runtime/status");
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = (await res.json()) as RuntimeStatus;
      setStatus(data);
      setError(null);
      setLastRefreshed(new Date());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [platformFetch]);

  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(() => void fetchStatus(), 30_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Runtime Monitor</h1>
          <p className="text-sm text-slate-400 mt-1">
            OpenClaw Runtime Broker connection status and execution activity
          </p>
        </div>
        <button
          onClick={() => void fetchStatus()}
          className="text-xs text-[#00D4FF] hover:text-[#00D4FF]/80 transition-colors px-3 py-1.5 rounded-lg border border-[#1E3A5F] hover:border-[#00D4FF]/30"
        >
          Refresh
        </button>
      </div>

      {loading && (
        <div className="text-slate-400 text-sm animate-pulse">Loading runtime status…</div>
      )}

      {error && !loading && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-400 text-sm">
          Failed to load runtime status: {error}
        </div>
      )}

      {status && !loading && (
        <>
          {/* Runtime connection card */}
          <div className="bg-[#0B1829] rounded-xl border border-[#1E3A5F] p-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-lg font-semibold text-white capitalize">
                    {status.runtime.name}
                  </h2>
                  <StatusBadge status={status.runtime.status} />
                </div>
                <p className="text-sm text-slate-400">
                  {status.runtime.message ?? "Runtime status loaded."}
                </p>
              </div>
              <span className="text-xs text-slate-500 tabular-nums">
                v{status.runtime.version}
              </span>
            </div>

            {/* Connection details */}
            <div className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">Runtime URL</p>
                <p className="text-slate-300 font-mono text-xs">
                  {status.runtime.runtimeUrl ?? "Not configured"}
                </p>
              </div>
              <div>
                <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">Last Heartbeat</p>
                <p className="text-slate-300 text-xs">
                  {status.runtime.lastHeartbeatAt
                    ? new Date(status.runtime.lastHeartbeatAt).toLocaleString()
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">Connected Since</p>
                <p className="text-slate-300 text-xs">
                  {status.runtime.connectedAt
                    ? new Date(status.runtime.connectedAt).toLocaleString()
                    : "—"}
                </p>
              </div>
            </div>

            {!status.runtime.configured && (
              <div className="mt-4 rounded-lg bg-[#112033] border border-[#1E3A5F] p-4">
                <p className="text-xs text-slate-400 leading-relaxed">
                  <span className="text-[#00D4FF] font-medium">OpenClaw Runtime not connected.</span>{" "}
                  Set{" "}
                  <code className="font-mono text-slate-300 bg-[#0B1829] px-1 rounded">
                    OPENCLAW_RUNTIME_URL
                  </code>{" "}
                  and{" "}
                  <code className="font-mono text-slate-300 bg-[#0B1829] px-1 rounded">
                    OPENCLAW_WEBHOOK_SECRET
                  </code>{" "}
                  in the platform environment to enable runtime execution.
                </p>
              </div>
            )}
          </div>

          {/* Execution counts */}
          <div>
            <h3 className="text-sm font-medium text-slate-300 mb-3 uppercase tracking-wide">
              Execution Activity
            </h3>
            <div className="grid grid-cols-3 gap-4">
              <MetricCard
                label="Active"
                value={status.executions.active}
                sub="Currently executing"
              />
              <MetricCard
                label="Queued"
                value={status.executions.queued}
                sub="Awaiting runtime acceptance"
              />
              <MetricCard
                label="Failed"
                value={status.executions.failed}
                sub="Total failed sessions"
              />
            </div>
          </div>

          {/* Capabilities */}
          {status.capabilities && (
            <div className="bg-[#0B1829] rounded-xl border border-[#1E3A5F] p-6">
              <h3 className="text-sm font-medium text-slate-300 mb-4 uppercase tracking-wide">
                Runtime Capabilities
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
                <div>
                  <p className="text-slate-500 text-xs uppercase tracking-wide mb-2">
                    Supported Channels
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {status.capabilities.supportedChannels.map(ch => (
                      <span
                        key={ch}
                        className="px-2 py-0.5 rounded bg-[#112033] text-slate-300 text-xs border border-[#1E3A5F]"
                      >
                        {ch}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-slate-500 text-xs uppercase tracking-wide mb-2">
                    Tool Categories
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {status.capabilities.supportedToolCategories.map(t => (
                      <span
                        key={t}
                        className="px-2 py-0.5 rounded bg-[#112033] text-slate-300 text-xs border border-[#1E3A5F]"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-slate-500 text-xs uppercase tracking-wide mb-2">
                    Max Concurrent
                  </p>
                  <p className="text-xl font-semibold text-white">
                    {status.capabilities.maxConcurrentExecutions}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Footer */}
          <p className="text-xs text-slate-600 text-right">
            Last refreshed:{" "}
            {lastRefreshed ? lastRefreshed.toLocaleTimeString() : "—"} · Auto-refreshes every 30 s
          </p>
        </>
      )}

      {/* AI Operations — Sprint 9.1 */}
      <div className="border-t border-[#1E3A5F] pt-8">
        <AIOperationsSection platformFetch={platformFetch} />
      </div>
    </div>
  );
}
