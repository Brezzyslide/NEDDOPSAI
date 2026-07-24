/**
 * Platform Dashboard — /platform
 * Real metrics: org counts, trial status, tasks, approvals, recent audit events.
 * No fake MRR. Charts for org growth (recharts).
 */
import { useEffect, useState } from "react";
import { usePlatformFetch } from "@/lib/platformApi";
import PlatformShell from "@/components/layout/PlatformShell";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface Metrics {
  totalOrganisations: number;
  activeOrganisations: number;
  suspendedOrganisations: number;
  organisationsOnTrial: number;
  trialExpired: number;
  activeUsers: number;
  totalUsers: number;
  tasksCreated: number;
  pendingApprovals: number;
  usageWarnings: number;
  systemHealthStatus: string;
}

interface DashboardData {
  metrics: Metrics;
  recentAuditEvents: any[];
  generatedAt: string;
  note: string;
}

function StatCard({ label, value, sub, accent }: { label: string; value: number | string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-[#1E3A5F] bg-[#0B1829] p-5">
      <div className="text-xs font-medium uppercase tracking-wider text-[#64748B]">{label}</div>
      <div className={`mt-1 text-3xl font-bold ${accent ?? "text-[#E2E8F0]"}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-[#4A5568]">{sub}</div>}
    </div>
  );
}

export default function PlatformDashboard() {
  const fetch = usePlatformFetch();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch("/dashboard")
      .then(r => r.json())
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const m = data?.metrics;

  const orgStatusData = m
    ? [
        { name: "Active",    value: m.activeOrganisations,    color: "#10B981" },
        { name: "Trial",     value: m.organisationsOnTrial,   color: "#00D4FF" },
        { name: "Suspended", value: m.suspendedOrganisations, color: "#F59E0B" },
        { name: "Expired",   value: m.trialExpired,           color: "#F87171" },
      ]
    : [];

  return (
    <PlatformShell>
      <div className="flex h-full flex-col overflow-y-auto">
        <header className="flex h-14 shrink-0 items-center border-b border-[#1E3A5F] px-6">
          <h1 className="text-lg font-semibold text-[#E2E8F0]">Platform Dashboard</h1>
          {data && (
            <span className="ml-auto text-xs text-[#4A5568]">
              Updated {new Date(data.generatedAt).toLocaleTimeString()}
            </span>
          )}
        </header>

        {loading && (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#00D4FF] border-t-transparent" />
          </div>
        )}

        {error && (
          <div className="m-6 rounded-xl border border-red-800 bg-red-950/30 p-4 text-sm text-red-400">{error}</div>
        )}

        {data && (
          <div className="flex-1 space-y-6 p-6">
            {/* System Health Banner */}
            <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
              m?.systemHealthStatus === "operational"
                ? "border-emerald-800 bg-emerald-950/20 text-emerald-400"
                : "border-yellow-800 bg-yellow-950/20 text-yellow-400"
            }`}>
              <span className="text-lg">{m?.systemHealthStatus === "operational" ? "✓" : "⚠"}</span>
              <span className="text-sm font-medium capitalize">
                System {m?.systemHealthStatus ?? "—"}
              </span>
              <span className="ml-auto text-xs text-[#4A5568]">{data.note}</span>
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              <StatCard label="Total Orgs"      value={m?.totalOrganisations ?? "—"} />
              <StatCard label="Active Orgs"     value={m?.activeOrganisations ?? "—"}  accent="text-emerald-400" />
              <StatCard label="On Trial"        value={m?.organisationsOnTrial ?? "—"} accent="text-[#00D4FF]" />
              <StatCard label="Suspended"       value={m?.suspendedOrganisations ?? "—"} accent="text-yellow-400" />
              <StatCard label="Trial Expired"   value={m?.trialExpired ?? "—"}        accent="text-red-400" />
              <StatCard label="Active Members"  value={m?.activeUsers ?? "—"} />
              <StatCard label="Total Users"     value={m?.totalUsers ?? "—"} />
              <StatCard label="Tasks Created"   value={m?.tasksCreated ?? "—"} />
              <StatCard label="Pending Approvals" value={m?.pendingApprovals ?? "—"} accent={m && m.pendingApprovals > 0 ? "text-yellow-400" : undefined} />
              <StatCard label="Usage Warnings"  value={m?.usageWarnings ?? 0} accent={m && m.usageWarnings > 0 ? "text-red-400" : undefined} />
            </div>

            {/* Charts */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-[#1E3A5F] bg-[#0B1829] p-5">
                <h2 className="mb-4 text-sm font-semibold text-[#E2E8F0]">Organisation Status Breakdown</h2>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={orgStatusData} barSize={40}>
                    <XAxis dataKey="name" stroke="#64748B" tick={{ fontSize: 12, fill: "#94A3B8" }} />
                    <YAxis stroke="#64748B" tick={{ fontSize: 12, fill: "#94A3B8" }} />
                    <Tooltip
                      contentStyle={{ background: "#0B1829", border: "1px solid #1E3A5F", borderRadius: 8 }}
                      labelStyle={{ color: "#E2E8F0" }}
                      itemStyle={{ color: "#94A3B8" }}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {orgStatusData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Recent Audit Events */}
              <div className="rounded-xl border border-[#1E3A5F] bg-[#0B1829] p-5">
                <h2 className="mb-3 text-sm font-semibold text-[#E2E8F0]">Recent Audit Events</h2>
                <div className="space-y-2 overflow-y-auto max-h-[200px]">
                  {(data.recentAuditEvents ?? []).length === 0 && (
                    <p className="text-xs text-[#4A5568]">No audit events yet.</p>
                  )}
                  {(data.recentAuditEvents ?? []).map((evt: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 rounded-lg bg-[#08111e] p-2">
                      <div className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#00D4FF]" />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-[#E2E8F0]">{evt.eventType}</div>
                        <div className="text-xs text-[#4A5568]">
                          {evt.createdAt ? new Date(evt.createdAt).toLocaleString() : "—"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </PlatformShell>
  );
}
