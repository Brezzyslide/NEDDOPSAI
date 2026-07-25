/**
 * Platform Runtime Monitor — /platform/runtime
 *
 * Sprint 8: OpenClaw Runtime Integration
 *
 * Displays the current state of the OpenClaw Runtime Broker connection.
 * When no runtime is connected, shows an honest "not connected" state —
 * does not fabricate health data.
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
    </div>
  );
}
