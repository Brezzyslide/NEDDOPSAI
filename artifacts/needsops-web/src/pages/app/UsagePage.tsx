/**
 * Usage Page — /app/:slug/usage
 * Sprint 3: Shows all 13 usage dimensions with current vs. limit,
 * colour-coded threshold bars (green / amber / red), and warning banners.
 */

import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Show } from "@clerk/react";
import { Redirect } from "wouter";
import AppShell from "@/components/layout/AppShell";
import { useAuthFetch } from "@/lib/api";

const DIMENSION_META: Record<string, { label: string; icon: string; category: string }> = {
  ai_tasks_monthly:          { label: "AI Tasks / Month",          icon: "🤖", category: "Compute" },
  ai_specialist_calls:       { label: "Specialist Calls",          icon: "📡", category: "Compute" },
  seat_count:                { label: "Team Seats",                icon: "👥", category: "Access" },
  workforce_pack_count:      { label: "Workforce Packs",           icon: "📦", category: "Access" },
  specialist_access_count:   { label: "Specialist Access",         icon: "🧑‍💼", category: "Access" },
  task_approval_count:       { label: "Task Approvals",            icon: "✅", category: "Workflow" },
  browser_sessions_monthly:  { label: "Browser Sessions / Month",  icon: "🌐", category: "Compute" },
  api_calls_monthly:         { label: "API Calls / Month",         icon: "🔗", category: "Integrations" },
  connector_count:           { label: "Active Connectors",         icon: "⚡", category: "Integrations" },
  storage_bytes:             { label: "Storage",                   icon: "💾", category: "Data" },
  audit_log_retention_days:  { label: "Audit Log Retention",       icon: "📋", category: "Data" },
  email_sends_monthly:       { label: "Email Sends / Month",       icon: "📧", category: "Integrations" },
  webhook_calls_monthly:     { label: "Webhook Calls / Month",     icon: "📣", category: "Integrations" },
};

const CATEGORIES = ["Compute", "Access", "Workflow", "Integrations", "Data"];

function formatLimit(value: number | null, code: string): string {
  if (value === null) return "Unlimited";
  if (code === "storage_bytes") {
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(0)} GB`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(0)} MB`;
    return `${value} B`;
  }
  if (code === "audit_log_retention_days") return `${value} days`;
  return value.toLocaleString();
}

function warningLevel(pct: number | null): "ok" | "warn" | "critical" {
  if (pct === null) return "ok";
  if (pct >= 100) return "critical";
  if (pct >= 80) return "warn";
  return "ok";
}

const LEVEL_COLOURS = {
  ok:       { bar: "#00D4FF", text: "text-[#00D4FF]" },
  warn:     { bar: "#FB923C", text: "text-amber-400" },
  critical: { bar: "#F87171", text: "text-red-400" },
};

export default function UsagePage() {
  const { slug } = useParams<{ slug: string }>();
  const apiFetch = useAuthFetch();

  const { data: usageData, isLoading } = useQuery({
    queryKey: ["usage", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/usage`).then(r => r.json()),
    enabled: !!slug,
    refetchInterval: 30_000,
  });

  const allowances: any[] = usageData?.allowances ?? [];

  // Global warnings
  const warnings = allowances.filter((a: any) => {
    const lvl = warningLevel(a.usagePct ?? null);
    return lvl === "warn" || lvl === "critical";
  });

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <AppShell orgSlug={slug ?? ""}>
        <div className="p-8 max-w-5xl">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[#E2E8F0]">Usage &amp; Limits</h1>
            <p className="text-[#64748B] text-sm mt-1">
              Real-time usage across all 13 dimensions. Refreshes every 30 seconds.
            </p>
          </div>

          {/* Warning banners */}
          {warnings.length > 0 && (
            <div className="mb-6 space-y-2">
              {warnings.map((a: any) => {
                const lvl = warningLevel(a.usagePct ?? null);
                const meta = DIMENSION_META[a.dimensionCode];
                return (
                  <div
                    key={a.dimensionCode}
                    className={`flex items-center gap-3 rounded-lg px-4 py-3 border text-sm ${
                      lvl === "critical"
                        ? "bg-red-900/20 border-red-500/30 text-red-200"
                        : "bg-amber-900/20 border-amber-500/30 text-amber-200"
                    }`}
                  >
                    <span className="shrink-0">{lvl === "critical" ? "🚨" : "⚠"}</span>
                    <span>
                      <strong>{meta?.label ?? a.dimensionCode}</strong>
                      {" "}is at{" "}
                      <strong>{Math.round(a.usagePct ?? 0)}%</strong>
                      {lvl === "critical" ? " — limit reached." : " — approaching limit."}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {isLoading ? (
            <div className="text-[#64748B] text-sm">Loading usage data…</div>
          ) : (
            <div className="space-y-8">
              {CATEGORIES.map(cat => {
                const dims = allowances.filter((a: any) => {
                  const meta = DIMENSION_META[a.dimensionCode];
                  return meta?.category === cat;
                });
                if (dims.length === 0) return null;

                return (
                  <section key={cat}>
                    <h2 className="text-[#64748B] text-xs uppercase tracking-widest mb-3">{cat}</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {dims.map((a: any) => {
                        const meta = DIMENSION_META[a.dimensionCode] ?? {
                          label: a.dimensionCode,
                          icon: "📊",
                          category: cat,
                        };
                        const limit: number | null = a.hardLimit ?? null;
                        const used: number = a.currentUsage ?? 0;
                        const pct = limit !== null ? Math.min(Math.round((used / limit) * 100), 100) : null;
                        const lvl = warningLevel(pct);
                        const colours = LEVEL_COLOURS[lvl];

                        return (
                          <div
                            key={a.dimensionCode}
                            className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5"
                          >
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex items-center gap-2.5">
                                <span className="text-lg">{meta.icon}</span>
                                <div>
                                  <p className="text-[#E2E8F0] text-sm font-medium">{meta.label}</p>
                                  <p className="text-[#64748B] text-xs">{a.dimensionCode}</p>
                                </div>
                              </div>
                              {pct !== null && (
                                <span className={`text-xs font-bold tabular-nums ${colours.text}`}>
                                  {pct}%
                                </span>
                              )}
                            </div>

                            {/* Usage bar */}
                            {limit !== null ? (
                              <>
                                <div className="h-1.5 bg-[#1E3A5F] rounded-full overflow-hidden mb-2">
                                  <div
                                    className="h-full rounded-full transition-all"
                                    style={{ width: `${pct ?? 0}%`, backgroundColor: colours.bar }}
                                  />
                                </div>
                                <div className="flex justify-between text-xs text-[#64748B]">
                                  <span>{formatLimit(used, a.dimensionCode)} used</span>
                                  <span>{formatLimit(limit, a.dimensionCode)} limit</span>
                                </div>
                              </>
                            ) : (
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 bg-[#1E3A5F] rounded-full flex-1" />
                                <span className="text-xs text-emerald-400 shrink-0">Unlimited</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}

              {allowances.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-[#64748B] text-sm">No usage data available yet.</p>
                  <p className="text-[#64748B] text-xs mt-1">Usage is recorded as your team works with the platform.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </AppShell>
    </>
  );
}
