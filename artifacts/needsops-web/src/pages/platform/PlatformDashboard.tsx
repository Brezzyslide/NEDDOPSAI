/**
 * Platform Dashboard — /platform
 * Real metrics: org counts, trial status, tasks, approvals, recent audit events.
 * Pending Actions section at top. No fake MRR. Charts for org growth (recharts).
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

// ─── Pending Actions Card ──────────────────────────────────────────────────────
function ActionCard({
  icon, title, count, description, linkLabel, linkHref, variant,
}: {
  icon: string; title: string; count: number | string; description: string;
  linkLabel: string; linkHref: string; variant: "amber" | "blue" | "red";
}) {
  const colours = {
    amber: {
      border: "border-amber-800/60",
      bg: "bg-amber-950/20",
      icon: "text-amber-400",
      count: "text-amber-400",
      link: "text-amber-400 hover:text-amber-300 border-amber-700 hover:bg-amber-950/30",
    },
    blue: {
      border: "border-[#00D4FF]/30",
      bg: "bg-[#00D4FF]/5",
      icon: "text-[#00D4FF]",
      count: "text-[#00D4FF]",
      link: "text-[#00D4FF] hover:text-[#00B8E0] border-[#00D4FF]/40 hover:bg-[#00D4FF]/10",
    },
    red: {
      border: "border-red-800/60",
      bg: "bg-red-950/20",
      icon: "text-red-400",
      count: "text-red-400",
      link: "text-red-400 hover:text-red-300 border-red-800 hover:bg-red-950/30",
    },
  }[variant];

  return (
    <div className={`flex items-center gap-4 rounded-xl border px-5 py-4 ${colours.border} ${colours.bg}`}>
      <span className={`text-2xl ${colours.icon}`}>{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className={`text-2xl font-bold ${colours.count}`}>{count}</span>
          <span className="text-sm font-medium text-[#E2E8F0]">{title}</span>
        </div>
        <p className="text-xs text-[#4A5568]">{description}</p>
      </div>
      <a href={linkHref}
        className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${colours.link}`}>
        {linkLabel} →
      </a>
    </div>
  );
}

export default function PlatformDashboard() {
  const fetch = usePlatformFetch();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pending Actions data
  const [packRequestCount, setPackRequestCount] = useState<number | null>(null);
  const [expiringTrialsCount, setExpiringTrialsCount] = useState<number | null>(null);
  const [onboardingOrgCount, setOnboardingOrgCount] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch("/dashboard")
      .then(r => r.json())
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));

    // Fetch pending pack access requests count
    fetch("/pack-access-requests?status=pending")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) setPackRequestCount(d.total ?? d.requests?.length ?? 0);
      })
      .catch(() => {});

    // Fetch expiring trials count
    fetch("/trials/expiring?days=7")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) setExpiringTrialsCount(d.total ?? d.trials?.length ?? 0);
      })
      .catch(() => {});

    // Fetch orgs — count those with status=onboarding
    fetch("/organisations?status=onboarding&limit=1")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) setOnboardingOrgCount(d.total ?? d.organisations?.length ?? 0);
      })
      .catch(() => {});
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

  const hasPendingActions =
    (packRequestCount !== null && packRequestCount > 0) ||
    (expiringTrialsCount !== null && expiringTrialsCount > 0) ||
    (onboardingOrgCount !== null && onboardingOrgCount > 0);

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

            {/* ─── Pending Actions ─────────────────────────────────────────── */}
            {(hasPendingActions || packRequestCount !== null) && (
              <div>
                <h2 className="mb-3 text-sm font-semibold text-[#E2E8F0]">
                  Pending Actions
                  {hasPendingActions && (
                    <span className="ml-2 rounded-full bg-amber-400/20 px-2 py-0.5 text-xs text-amber-400">
                      Attention required
                    </span>
                  )}
                </h2>
                <div className="space-y-2">
                  {packRequestCount !== null && (
                    <ActionCard
                      icon="📦"
                      title="Pending Pack Requests"
                      count={packRequestCount}
                      description="Pack access requests awaiting approval"
                      linkLabel="Review"
                      linkHref="/platform/pack-access-requests"
                      variant={packRequestCount > 0 ? "amber" : "blue"}
                    />
                  )}
                  {expiringTrialsCount !== null && (
                    <ActionCard
                      icon="⏳"
                      title="Trials Expiring in 7 Days"
                      count={expiringTrialsCount}
                      description="These trials need attention — convert or extend before they expire"
                      linkLabel="View trials"
                      linkHref="/platform/trials"
                      variant={expiringTrialsCount > 0 ? "amber" : "blue"}
                    />
                  )}
                  {onboardingOrgCount !== null && onboardingOrgCount > 0 && (
                    <ActionCard
                      icon="🏢"
                      title="Organisations Awaiting Approval"
                      count={onboardingOrgCount}
                      description="Organisations in onboarding status pending review"
                      linkLabel="View orgs"
                      linkHref="/platform/organisations?status=onboarding"
                      variant="blue"
                    />
                  )}
                </div>
              </div>
            )}

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
                <a href="/platform/audit" className="mt-3 block text-xs text-[#00D4FF] hover:underline">
                  View all audit events →
                </a>
              </div>
            </div>

            {/* Quick Links */}
            <div className="rounded-xl border border-[#1E3A5F] bg-[#0B1829] p-5">
              <h2 className="mb-3 text-sm font-semibold text-[#E2E8F0]">Quick Links</h2>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "All Organisations", href: "/platform/organisations" },
                  { label: "Trials", href: "/platform/trials" },
                  { label: "Pack Requests", href: "/platform/pack-access-requests" },
                  { label: "Audit Log", href: "/platform/audit" },
                  { label: "Platform Users", href: "/platform/users" },
                  { label: "Feature Flags", href: "/platform/feature-flags" },
                ].map(l => (
                  <a key={l.href} href={l.href}
                    className="rounded-lg border border-[#1E3A5F] px-3 py-1.5 text-xs text-[#94A3B8] hover:border-[#00D4FF]/40 hover:text-[#00D4FF]">
                    {l.label}
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </PlatformShell>
  );
}
