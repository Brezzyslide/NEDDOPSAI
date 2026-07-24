/**
 * Platform Usage Monitor — /platform/usage
 * Charts, top consuming orgs, warning thresholds, trends.
 */
import { useEffect, useState } from "react";
import { usePlatformFetch } from "@/lib/platformApi";
import PlatformShell from "@/components/layout/PlatformShell";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend, Cell,
} from "recharts";

type View = "overview" | "top-orgs" | "warnings" | "trends";

export default function PlatformUsage() {
  const fetch = usePlatformFetch();
  const [view, setView] = useState<View>("overview");
  const [summary, setSummary] = useState<any>(null);
  const [topOrgs, setTopOrgs] = useState<any[]>([]);
  const [warnings, setWarnings] = useState<any[]>([]);
  const [trends, setTrends] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch("/usage-monitor/summary").then(r => r.json()),
      fetch("/usage-monitor/top-orgs?limit=10").then(r => r.json()),
      fetch("/usage-monitor/warnings").then(r => r.json()),
      fetch("/usage-monitor/trends?months=6").then(r => r.json()),
    ]).then(([s, t, w, tr]) => {
      setSummary(s);
      setTopOrgs(t.topOrgs ?? []);
      setWarnings(w.warnings ?? []);
      setTrends(tr.trends ?? []);
    }).finally(() => setLoading(false));
  }, []);

  // Build chart data for top dims this month
  const dimChart = (summary?.dimensionTotalsThisMonth ?? []).slice(0, 8).map((d: any) => ({
    name: d.dimensionCode.replace("ai_", "").replace(/_/g, " "),
    total: Number(d.total),
  }));

  // Build trend chart data
  const trendsByDim: Record<string, any[]> = {};
  for (const t of trends) {
    if (!trendsByDim[t.dimensionCode]) trendsByDim[t.dimensionCode] = [];
    trendsByDim[t.dimensionCode]!.push({ period: t.period, total: t.total });
  }
  const topDims = Object.keys(trendsByDim).slice(0, 4);
  const colors = ["#00D4FF", "#10B981", "#F59E0B", "#F87171"];

  return (
    <PlatformShell>
      <div className="flex h-full flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#1E3A5F] px-6">
          <h1 className="text-lg font-semibold text-[#E2E8F0]">Usage Monitor</h1>
          {warnings.length > 0 && (
            <span className="rounded-full bg-yellow-950/30 px-2 py-0.5 text-xs font-medium text-yellow-400">
              {warnings.length} warning{warnings.length !== 1 ? "s" : ""}
            </span>
          )}
          <a href="/v1/platform/export/usage" target="_blank" className="ml-2 text-xs text-[#00D4FF]">CSV Export</a>
        </header>

        <div className="flex shrink-0 border-b border-[#1E3A5F] bg-[#08111e]">
          {([
            { id: "overview", label: "Overview" },
            { id: "top-orgs", label: "Top Consumers" },
            { id: "warnings", label: `Warnings${warnings.length ? ` (${warnings.length})` : ""}` },
            { id: "trends", label: "Trends" },
          ] as { id: View; label: string }[]).map(v => (
            <button key={v.id} onClick={() => setView(v.id)}
              className={`px-4 py-2.5 text-sm transition-colors ${view === v.id ? "border-b-2 border-[#00D4FF] text-[#00D4FF]" : "text-[#64748B] hover:text-[#E2E8F0]"}`}>
              {v.label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#00D4FF] border-t-transparent" />
          </div>
        )}

        {!loading && (
          <div className="flex-1 overflow-y-auto p-6">
            {/* OVERVIEW */}
            {view === "overview" && summary && (
              <div className="space-y-6">
                <div className="grid grid-cols-3 gap-4">
                  <div className="rounded-xl border border-[#1E3A5F] bg-[#0B1829] p-4 text-center">
                    <div className="text-2xl font-bold text-[#E2E8F0]">{summary.totalUsageEvents?.toLocaleString()}</div>
                    <div className="text-xs text-[#64748B]">Total Usage Events</div>
                  </div>
                  <div className="rounded-xl border border-[#1E3A5F] bg-[#0B1829] p-4 text-center">
                    <div className="text-2xl font-bold text-[#00D4FF]">{summary.monthlyUsageEvents?.toLocaleString()}</div>
                    <div className="text-xs text-[#64748B]">This Month</div>
                  </div>
                  <div className="rounded-xl border border-[#1E3A5F] bg-[#0B1829] p-4 text-center">
                    <div className="text-2xl font-bold text-[#E2E8F0]">{summary.totalOrganisations}</div>
                    <div className="text-xs text-[#64748B]">Active Orgs</div>
                  </div>
                </div>

                {dimChart.length > 0 && (
                  <div className="rounded-xl border border-[#1E3A5F] bg-[#0B1829] p-5">
                    <h2 className="mb-4 text-sm font-semibold text-[#E2E8F0]">Usage by Dimension (this month)</h2>
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={dimChart} layout="vertical" margin={{ left: 80 }}>
                        <XAxis type="number" stroke="#64748B" tick={{ fontSize: 11, fill: "#94A3B8" }} />
                        <YAxis type="category" dataKey="name" stroke="#64748B" tick={{ fontSize: 11, fill: "#94A3B8" }} width={80} />
                        <Tooltip contentStyle={{ background: "#0B1829", border: "1px solid #1E3A5F", borderRadius: 8 }} labelStyle={{ color: "#E2E8F0" }} />
                        <Bar dataKey="total" fill="#00D4FF" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )}

            {/* TOP ORGS */}
            {view === "top-orgs" && (
              <div>
                {topOrgs.length === 0 && <p className="text-sm text-[#4A5568]">No usage data this month.</p>}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#1E3A5F] text-left text-xs text-[#64748B]">
                      <th className="pb-2">#</th><th className="pb-2">Organisation</th><th className="pb-2">Dimension</th><th className="pb-2 text-right">Total (month)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1E3A5F]">
                    {topOrgs.map((o: any, i: number) => (
                      <tr key={i}>
                        <td className="py-2 text-[#4A5568]">{i + 1}</td>
                        <td className="py-2">
                          <div className="text-[#E2E8F0]">{o.org?.name ?? o.org?.id ?? "—"}</div>
                        </td>
                        <td className="py-2 font-mono text-xs text-[#00D4FF]">{o.dimensionCode}</td>
                        <td className="py-2 text-right font-mono text-[#E2E8F0]">{o.totalThisMonth?.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* WARNINGS */}
            {view === "warnings" && (
              <div className="space-y-2">
                {warnings.length === 0 && <p className="text-sm text-[#4A5568]">No usage warnings. All orgs are within thresholds.</p>}
                {warnings.map((w: any, i: number) => (
                  <div key={i} className={`rounded-lg border px-4 py-3 ${w.level === "critical" ? "border-red-800 bg-red-950/10" : "border-yellow-800 bg-yellow-950/10"}`}>
                    <div className="flex items-center gap-3">
                      <span className={`text-lg ${w.level === "critical" ? "text-red-400" : "text-yellow-400"}`}>
                        {w.level === "critical" ? "⚠" : "⚡"}
                      </span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[#E2E8F0]">{w.org?.name ?? w.orgId}</span>
                          <span className="font-mono text-xs text-[#00D4FF]">{w.dimensionCode}</span>
                        </div>
                        <div className="mt-1 text-xs text-[#94A3B8]">
                          {w.used?.toLocaleString()} / {w.limit?.toLocaleString()} — {w.pct}% used
                        </div>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${w.level === "critical" ? "bg-red-950/30 text-red-400" : "bg-yellow-950/30 text-yellow-400"}`}>
                        {w.pct}%
                      </span>
                    </div>
                    {/* Progress bar */}
                    <div className="mt-2 h-1.5 w-full rounded-full bg-[#1E3A5F]">
                      <div className={`h-1.5 rounded-full ${w.level === "critical" ? "bg-red-400" : "bg-yellow-400"}`}
                        style={{ width: `${Math.min(100, w.pct)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* TRENDS */}
            {view === "trends" && (
              <div className="rounded-xl border border-[#1E3A5F] bg-[#0B1829] p-5">
                <h2 className="mb-4 text-sm font-semibold text-[#E2E8F0]">Usage Trends (6 months, top dimensions)</h2>
                {trends.length === 0 && <p className="text-sm text-[#4A5568]">No trend data yet.</p>}
                {trends.length > 0 && (
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1E3A5F" />
                      <XAxis dataKey="period" type="category" allowDuplicatedCategory={false} stroke="#64748B" tick={{ fontSize: 11, fill: "#94A3B8" }} />
                      <YAxis stroke="#64748B" tick={{ fontSize: 11, fill: "#94A3B8" }} />
                      <Tooltip contentStyle={{ background: "#0B1829", border: "1px solid #1E3A5F", borderRadius: 8 }} />
                      <Legend wrapperStyle={{ color: "#94A3B8", fontSize: 12 }} />
                      {topDims.map((dim, i) => (
                        <Line
                          key={dim}
                          data={trendsByDim[dim]}
                          type="monotone"
                          dataKey="total"
                          name={dim}
                          stroke={colors[i % colors.length]}
                          dot={false}
                          strokeWidth={2}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </PlatformShell>
  );
}
