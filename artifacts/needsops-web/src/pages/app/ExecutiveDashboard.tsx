/**
 * Executive Dashboard — Sprint 23
 *
 * The operational home for every organisation. Replaces AppDashboard as the
 * default landing page at /app/:slug.
 *
 * Sections:
 *   1. CoS Executive Briefing
 *   2. Operational metrics strip
 *   3. Active Work summary
 *   4. Recently Completed Work
 *   5. Pending Decisions
 *   6. AI Workforce status
 *   7. Desktop Connector status
 */

import { useParams, useLocation } from "wouter";
import { useQuery }               from "@tanstack/react-query";
import { Show }                   from "@clerk/react";
import { Redirect }               from "wouter";
import AppShell                   from "@/components/layout/AppShell";
import { useAuthFetch }           from "@/lib/api";

// ─── Status helpers ───────────────────────────────────────────────────────────

const WORK_STATUS: Record<string, { label: string; cls: string }> = {
  draft:             { label: "In Progress",       cls: "bg-blue-900/30 text-blue-400" },
  awaiting_approval: { label: "Awaiting Approval", cls: "bg-amber-900/30 text-amber-400" },
  approved:          { label: "Approved",          cls: "bg-emerald-900/30 text-emerald-400" },
  rejected:          { label: "Rejected",          cls: "bg-red-900/30 text-red-400" },
  archived:          { label: "Archived",          cls: "bg-[#1E3A5F] text-[#64748B]" },
  reopened:          { label: "Reopened",          cls: "bg-purple-900/30 text-purple-400" },
};

const TASK_STATUS: Record<string, { label: string; cls: string }> = {
  queued:            { label: "Queued",            cls: "bg-blue-900/30 text-blue-400" },
  planning:          { label: "Planning",          cls: "bg-purple-900/30 text-purple-400" },
  awaiting_approval: { label: "Awaiting Approval", cls: "bg-amber-900/30 text-amber-400" },
  executing:         { label: "Executing",         cls: "bg-cyan-900/30 text-cyan-400" },
  completed:         { label: "Completed",         cls: "bg-emerald-900/30 text-emerald-400" },
  failed:            { label: "Failed",            cls: "bg-red-900/30 text-red-400" },
};

function StatusBadge({ status, map }: { status: string; map: Record<string, { label: string; cls: string }> }) {
  const s = map[status] ?? { label: status, cls: "bg-[#1E3A5F] text-[#64748B]" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── CoS Briefing Widget ──────────────────────────────────────────────────────

function BriefingWidget({ slug }: { slug: string }) {
  const apiFetch = useAuthFetch();
  const { data, isLoading } = useQuery({
    queryKey: ["executive-briefing", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/executive-briefing`).then(r => r.json()),
    staleTime: 5 * 60 * 1000, // cache 5 min
  });

  return (
    <div className="bg-gradient-to-r from-[#0A1628] to-[#112033] border border-[#1E3A5F] rounded-xl p-6 mb-6">
      <div className="flex items-start gap-4">
        <div className="shrink-0 h-10 w-10 rounded-xl bg-[#00D4FF]/10 border border-[#00D4FF]/30 flex items-center justify-center">
          <span className="text-[#00D4FF] font-bold text-xs">CoS</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[#64748B] text-xs uppercase tracking-widest font-semibold mb-2">
            Chief of Staff · Executive Briefing
          </p>
          {isLoading ? (
            <div className="space-y-2">
              <div className="h-4 bg-[#1E3A5F] rounded animate-pulse w-3/4" />
              <div className="h-4 bg-[#1E3A5F] rounded animate-pulse w-1/2" />
            </div>
          ) : (
            <p className="text-[#E2E8F0] text-sm leading-relaxed">
              {data?.briefing ?? "Your AI Workforce is standing by. No active items require attention."}
            </p>
          )}
        </div>
        {data?.usedAI && (
          <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-[#00D4FF]/10 text-[#00D4FF] font-semibold border border-[#00D4FF]/20">
            AI
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Metric card ──────────────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, accent, onClick,
}: {
  label: string; value: string | number; sub?: string;
  accent?: string; onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-left bg-[#112033] border border-[#1E3A5F] rounded-xl p-5 hover:border-[#00D4FF]/40 transition-colors w-full"
    >
      <p className="text-[#64748B] text-xs mb-2">{label}</p>
      <p className="font-bold text-2xl" style={{ color: accent ?? "#E2E8F0" }}>{value}</p>
      {sub && <p className="text-[#64748B] text-xs mt-1">{sub}</p>}
    </button>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-[#E2E8F0] font-semibold text-base">{title}</h2>
      {action && (
        <button onClick={onAction} className="text-[#00D4FF] text-xs hover:underline">
          {action} →
        </button>
      )}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <span className="text-2xl mb-2 opacity-40">{icon}</span>
      <p className="text-[#64748B] text-sm">{text}</p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ExecutiveDashboard() {
  const { slug }         = useParams<{ slug: string }>();
  const [, setLocation]  = useLocation();
  const apiFetch         = useAuthFetch();

  // Core data
  const { data: orgData } = useQuery({
    queryKey: ["org", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}`).then(r => r.json()),
    enabled: !!slug,
  });

  const { data: devicesData } = useQuery({
    queryKey: ["devices", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/devices`).then(r => r.json()),
    enabled: !!slug,
    refetchInterval: 30_000,
  });

  const { data: completedWorkData } = useQuery({
    queryKey: ["completed-work-dashboard", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/completed-work?limit=50`).then(r => r.json()),
    enabled: !!slug,
    staleTime: 60_000,
  });

  const { data: tasksData } = useQuery({
    queryKey: ["tasks-dashboard", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/tasks`).then(r => r.json()),
    enabled: !!slug,
    staleTime: 30_000,
  });

  const { data: approvalsData } = useQuery({
    queryKey: ["approvals-dashboard", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/approvals?state=pending`).then(r => r.json()),
    enabled: !!slug,
    staleTime: 30_000,
  });

  // Sprint 29N.10: additional sources to compute the full unified pending-decisions count
  // (matches ApprovalsPage's 7-source unified queue)
  const { data: proposalsDashData } = useQuery({
    queryKey: ["proposals-dashboard", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/knowledge/curation/proposals?status=proposed&limit=50`).then(r => r.json()),
    enabled: !!slug, staleTime: 60_000,
  });
  const { data: memoryDashData } = useQuery({
    queryKey: ["memory-dashboard", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/memory?status=proposed&limit=50`).then(r => r.json()),
    enabled: !!slug, staleTime: 60_000,
  });
  const { data: sourcesDashData } = useQuery({
    queryKey: ["sources-review-dashboard", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/knowledge/sources?status=review_required&limit=50`).then(r => r.json()),
    enabled: !!slug, staleTime: 60_000,
  });
  const { data: intentsDashData } = useQuery({
    queryKey: ["intents-dashboard", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/execution-intents?status=pending_approval&limit=50`).then(r => r.json()),
    enabled: !!slug, staleTime: 60_000,
  });
  const { data: packReqDashData } = useQuery({
    queryKey: ["pack-requests-dashboard", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/pack-access-requests?status=pending&limit=50`).then(r => r.json()),
    enabled: !!slug, staleTime: 60_000,
  });

  const { data: healthData } = useQuery({
    queryKey: ["knowledge-health-dashboard", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/knowledge/health`).then(r => r.json()),
    enabled: !!slug,
    staleTime: 5 * 60_000,
  });

  const { data: notifData } = useQuery({
    queryKey: ["notif-unread-dashboard", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/notifications/unread-count`).then(r => r.json()),
    enabled: !!slug,
    refetchInterval: 60_000,
  });

  const { data: specialistsData } = useQuery({
    queryKey: ["workforce-specialists"],
    queryFn: () => apiFetch("/v1/workforce/specialists").then(r => r.json()),
    staleTime: 5 * 60_000,
  });

  // Derived values
  const org             = orgData?.organisation;
  const devices: any[]  = devicesData?.devices ?? [];
  const hasDevice       = devices.some((d: any) => d.status === "connected");
  const devicesLoaded   = devicesData !== undefined;

  const allWork: any[]  = completedWorkData?.completedWork ?? [];
  const activeWork      = allWork.filter((w: any) => w.status === "draft");
  const awaitingApproval= allWork.filter((w: any) => w.status === "awaiting_approval");
  const recentCompleted = allWork.filter((w: any) => w.status === "approved").slice(0, 4);

  const activeTasks: any[] = (tasksData?.tasks ?? []).filter(
    (t: any) => ["executing", "planning", "queued"].includes(t.currentState ?? t.state),
  ).slice(0, 4);

  const pendingApprovals: any[] = approvalsData?.approvals ?? [];

  // Sprint 29N.10: aggregate all 7 pending-decision sources to match ApprovalsPage unified count
  const totalPendingDecisions =
    pendingApprovals.length +
    awaitingApproval.length +
    (proposalsDashData?.proposals ?? []).length +
    (memoryDashData?.memories ?? memoryDashData?.items ?? []).length +
    (sourcesDashData?.sources ?? []).length +
    (intentsDashData?.intents ?? []).length +
    (packReqDashData?.requests ?? []).length;

  const healthScore: number | null =
    healthData?.overallScore ?? healthData?.score ?? null;

  const unreadCount: number = notifData?.unreadCount ?? 0;

  const specialists: any[] = specialistsData?.specialists ?? [];
  const activeSpecialists  = specialists.filter((s: any) =>
    s.executionStatus === "available" || s.dnaStatus === "active",
  );

  const hour    = new Date().getHours();
  const timeStr = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <AppShell orgSlug={slug ?? ""}>
        <div className="p-8 max-w-7xl mx-auto">

          {/* Page header */}
          <div className="mb-7">
            <p className="text-[#64748B] text-sm mb-1">
              {new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </p>
            <h1 className="text-2xl font-bold text-[#E2E8F0]">
              Good {timeStr}{org?.displayName ? `, ${org.displayName}` : ""}
            </h1>
          </div>

          {/* Device banner */}
          {devicesLoaded && !hasDevice && (
            <div className="mb-6 flex items-center gap-4 p-4 rounded-xl border border-[#00D4FF]/30 bg-[#00D4FF]/5">
              <span className="text-2xl shrink-0">💻</span>
              <div className="flex-1 min-w-0">
                <p className="text-[#E2E8F0] font-semibold text-sm">Connect a device to get started</p>
                <p className="text-[#64748B] text-xs mt-0.5">
                  Install NeedsOps AI+ on your computer so your AI Workforce can work on your behalf.
                </p>
              </div>
              <button
                onClick={() => setLocation(`/app/${slug}/install`)}
                className="shrink-0 px-4 py-2 bg-[#00D4FF] text-[#0B1829] font-semibold text-sm rounded-lg hover:bg-[#00B8D9] transition-colors"
              >
                Install now →
              </button>
            </div>
          )}

          {/* CoS Briefing */}
          {slug && <BriefingWidget slug={slug} />}

          {/* Metrics strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <MetricCard
              label="Active Work"
              value={activeWork.length + activeTasks.length}
              sub={activeWork.length > 0 ? `${activeWork.length} in progress` : "No active work"}
              onClick={() => setLocation(`/app/${slug}/active-work`)}
            />
            <MetricCard
              label="Pending Decisions"
              value={totalPendingDecisions}
              sub="Approvals required"
              accent={totalPendingDecisions > 0 ? "#FB923C" : undefined}
              onClick={() => setLocation(`/app/${slug}/approvals`)}
            />
            <MetricCard
              label="Knowledge Health"
              value={healthScore !== null ? healthScore : "—"}
              sub={healthScore !== null ? (healthScore >= 80 ? "Strong" : healthScore >= 60 ? "Satisfactory" : "Needs attention") : "No data yet"}
              accent={healthScore !== null ? (healthScore >= 80 ? "#34D399" : healthScore >= 60 ? "#00D4FF" : "#FB923C") : undefined}
              onClick={() => setLocation(`/app/${slug}/library`)}
            />
            <MetricCard
              label="Unread Messages"
              value={unreadCount}
              sub="In conversations"
              accent={unreadCount > 0 ? "#00D4FF" : undefined}
              onClick={() => setLocation(`/app/${slug}/notifications`)}
            />
          </div>

          {/* Main content grid */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

            {/* Left column (2/3) */}
            <div className="xl:col-span-2 space-y-6">

              {/* Active Work */}
              <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5">
                <SectionHeader
                  title="Active Work"
                  action="View all"
                  onAction={() => setLocation(`/app/${slug}/active-work`)}
                />
                {activeWork.length === 0 && activeTasks.length === 0 ? (
                  <EmptyState icon="⚡" text="No active work items" />
                ) : (
                  <div className="space-y-2">
                    {activeWork.slice(0, 3).map((w: any) => (
                      <div key={w.id} className="flex items-center gap-3 p-3 rounded-lg bg-[#0B1829] border border-[#1E3A5F]">
                        <div className="flex-1 min-w-0">
                          <p className="text-[#E2E8F0] text-sm font-medium truncate">{w.title ?? "Untitled work"}</p>
                          <p className="text-[#64748B] text-xs mt-0.5">{w.primarySpecialist?.replace(/_/g, " ") ?? "AI Workforce"}</p>
                        </div>
                        <StatusBadge status={w.status} map={WORK_STATUS} />
                      </div>
                    ))}
                    {activeTasks.slice(0, 2).map((t: any) => (
                      <div
                        key={t.id}
                        className="flex items-center gap-3 p-3 rounded-lg bg-[#0B1829] border border-[#1E3A5F] cursor-pointer hover:border-[#00D4FF]/30 transition-colors"
                        onClick={() => setLocation(`/app/${slug}/tasks/${t.id}`)}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-[#E2E8F0] text-sm font-medium truncate">{t.title ?? "Untitled task"}</p>
                          <p className="text-[#64748B] text-xs mt-0.5">Task · {timeAgo(t.createdAt)}</p>
                        </div>
                        <StatusBadge status={t.currentState ?? t.state ?? "queued"} map={TASK_STATUS} />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recently Completed */}
              <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5">
                <SectionHeader
                  title="Recently Completed"
                  action="View all"
                  onAction={() => setLocation(`/app/${slug}/work`)}
                />
                {recentCompleted.length === 0 ? (
                  <EmptyState icon="✅" text="No completed work yet" />
                ) : (
                  <div className="space-y-2">
                    {recentCompleted.map((w: any) => (
                      <div key={w.id} className="flex items-center gap-3 p-3 rounded-lg bg-[#0B1829] border border-[#1E3A5F]">
                        <div className="flex-1 min-w-0">
                          <p className="text-[#E2E8F0] text-sm font-medium truncate">{w.title ?? "Completed work"}</p>
                          <p className="text-[#64748B] text-xs mt-0.5">
                            {w.primarySpecialist?.replace(/_/g, " ") ?? "AI Workforce"} · {timeAgo(w.updatedAt ?? w.createdAt)}
                          </p>
                        </div>
                        <span className="text-emerald-400 text-sm">✓</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* AI Workforce */}
              <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5">
                <SectionHeader
                  title="AI Workforce"
                  action="Manage"
                  onAction={() => setLocation(`/app/${slug}/workforce`)}
                />
                {activeSpecialists.length === 0 ? (
                  <EmptyState icon="🤖" text="No specialists active" />
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {activeSpecialists.slice(0, 4).map((s: any) => (
                      <div
                        key={s.id ?? s.code}
                        className="flex items-center gap-3 p-3 rounded-lg bg-[#0B1829] border border-[#1E3A5F] cursor-pointer hover:border-[#00D4FF]/30 transition-colors"
                        onClick={() => setLocation(`/app/${slug}/workforce/${s.code ?? s.id}/training`)}
                      >
                        <div className="h-8 w-8 rounded-lg bg-[#00D4FF]/10 border border-[#00D4FF]/20 flex items-center justify-center text-xs font-bold text-[#00D4FF] shrink-0">
                          {(s.name ?? s.code ?? "AI")[0]?.toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[#E2E8F0] text-sm font-medium truncate">
                            {s.name ?? s.code?.replace(/_/g, " ")}
                          </p>
                          <p className="text-[#64748B] text-xs mt-0.5 capitalize">
                            {s.executionStatus === "available" ? "Available" : s.dnaStatus ?? "Active"}
                          </p>
                        </div>
                        <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right column (1/3) */}
            <div className="space-y-6">

              {/* Quick actions */}
              <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5">
                <h2 className="text-[#E2E8F0] font-semibold text-base mb-4">Quick Actions</h2>
                <div className="space-y-2">
                  {[
                    { label: "Start New Work",       icon: "⚡", path: `/app/${slug}/chat` },
                    { label: "AI Workforce",          icon: "🤖", path: `/app/${slug}/workforce` },
                    { label: "Active Work",           icon: "📋", path: `/app/${slug}/active-work` },
                    { label: "Organisation Library",  icon: "📚", path: `/app/${slug}/library` },
                    { label: "Approvals",             icon: "✅", path: `/app/${slug}/approvals` },
                  ].map(a => (
                    <button
                      key={a.label}
                      onClick={() => setLocation(a.path)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg bg-[#0B1829] border border-[#1E3A5F] text-sm text-[#E2E8F0] hover:border-[#00D4FF]/40 hover:text-[#00D4FF] transition-colors text-left"
                    >
                      <span>{a.icon}</span>
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Pending Decisions */}
              <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5">
                <SectionHeader
                  title="Pending Decisions"
                  action={pendingApprovals.length + awaitingApproval.length > 0 ? "View all" : undefined}
                  onAction={() => setLocation(`/app/${slug}/approvals`)}
                />
                {pendingApprovals.length === 0 && awaitingApproval.length === 0 ? (
                  <EmptyState icon="✅" text="No pending approvals" />
                ) : (
                  <div className="space-y-2">
                    {[...awaitingApproval.slice(0, 2), ...pendingApprovals.slice(0, 2)].map((item: any, i: number) => (
                      <div key={item.id ?? i} className="p-3 rounded-lg bg-[#0B1829] border border-amber-900/30">
                        <p className="text-[#E2E8F0] text-sm font-medium truncate">
                          {item.title ?? item.approvalType?.replace(/_/g, " ") ?? "Approval required"}
                        </p>
                        <p className="text-[#64748B] text-xs mt-0.5">
                          {item.createdAt ? timeAgo(item.createdAt) : "Pending"}
                        </p>
                      </div>
                    ))}
                    {pendingApprovals.length + awaitingApproval.length > 4 && (
                      <p className="text-[#64748B] text-xs text-center pt-1">
                        +{pendingApprovals.length + awaitingApproval.length - 4} more
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Desktop Connector */}
              <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5">
                <h2 className="text-[#E2E8F0] font-semibold text-base mb-4">Desktop Connector</h2>
                {devicesLoaded ? (
                  hasDevice ? (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        <span className="text-emerald-400 text-sm font-medium">Connected</span>
                      </div>
                      {devices.filter((d: any) => d.status === "connected").slice(0, 2).map((d: any) => (
                        <div key={d.id} className="text-[#64748B] text-xs truncate">{d.name ?? d.id}</div>
                      ))}
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="h-2 w-2 rounded-full bg-[#64748B]" />
                        <span className="text-[#64748B] text-sm">Not connected</span>
                      </div>
                      <button
                        onClick={() => setLocation(`/app/${slug}/install`)}
                        className="text-[#00D4FF] text-xs hover:underline"
                      >
                        Install desktop app →
                      </button>
                    </div>
                  )
                ) : (
                  <div className="h-4 bg-[#1E3A5F] rounded animate-pulse w-1/2" />
                )}
              </div>
            </div>
          </div>
        </div>
      </AppShell>
    </>
  );
}
