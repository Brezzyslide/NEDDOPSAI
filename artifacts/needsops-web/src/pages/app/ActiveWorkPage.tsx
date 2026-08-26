/**
 * Active Work — Sprint 23
 *
 * Operational view of all work items across statuses.
 * Combines Sprint 22 Completed Work items (draft/awaiting_approval/recently approved)
 * with existing Task records.
 *
 * Status views: All · In Progress · Awaiting Approval · Recently Completed · Failed
 *
 * Note: Completed Work detail portal is Sprint 25. This page shows summary cards
 * that link to the future detail view.
 */

import { useState }               from "react";
import { useParams, useLocation } from "wouter";
import { useQuery }               from "@tanstack/react-query";
import { Show }                   from "@clerk/react";
import { Redirect }               from "wouter";
import AppShell                   from "@/components/layout/AppShell";
import { useAuthFetch }           from "@/lib/api";

// ─── Status config ────────────────────────────────────────────────────────────

const WORK_STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  draft:             { label: "In Progress",       cls: "bg-blue-900/30 text-blue-400",      dot: "bg-blue-400" },
  awaiting_approval: { label: "Awaiting Approval", cls: "bg-amber-900/30 text-amber-400",    dot: "bg-amber-400" },
  approved:          { label: "Approved",          cls: "bg-emerald-900/30 text-emerald-400",dot: "bg-emerald-400" },
  rejected:          { label: "Rejected",          cls: "bg-red-900/30 text-red-400",        dot: "bg-red-400" },
  archived:          { label: "Archived",          cls: "bg-[#1E3A5F] text-[#64748B]",       dot: "bg-[#64748B]" },
  reopened:          { label: "Reopened",          cls: "bg-purple-900/30 text-purple-400",  dot: "bg-purple-400" },
};

const TASK_STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  queued:            { label: "Queued",            cls: "bg-blue-900/30 text-blue-400",      dot: "bg-blue-400" },
  planning:          { label: "Planning",          cls: "bg-purple-900/30 text-purple-400",  dot: "bg-purple-400" },
  awaiting_approval: { label: "Awaiting Approval", cls: "bg-amber-900/30 text-amber-400",    dot: "bg-amber-400" },
  evidence_required: { label: "Evidence Required", cls: "bg-orange-900/30 text-orange-400",  dot: "bg-orange-400" },
  approved:          { label: "Approved",          cls: "bg-cyan-900/30 text-cyan-400",      dot: "bg-cyan-400" },
  executing:         { label: "Executing",         cls: "bg-cyan-900/30 text-cyan-400",      dot: "bg-cyan-400" },
  completed:         { label: "Completed",         cls: "bg-emerald-900/30 text-emerald-400",dot: "bg-emerald-400" },
  failed:            { label: "Failed",            cls: "bg-red-900/30 text-red-400",        dot: "bg-red-400" },
};

type WorkFilter = "all" | "in_progress" | "awaiting_approval" | "completed" | "failed";

const FILTERS: { key: WorkFilter; label: string }[] = [
  { key: "all",              label: "All" },
  { key: "in_progress",      label: "In Progress" },
  { key: "awaiting_approval",label: "Awaiting Approval" },
  { key: "completed",        label: "Completed" },
  { key: "failed",           label: "Failed" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function StatusBadge({ status, map }: { status: string; map: Record<string, { label: string; cls: string; dot: string }> }) {
  const m = map[status] ?? { label: status, cls: "bg-[#1E3A5F] text-[#64748B]", dot: "bg-[#64748B]" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${m.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

// ─── Work item card ───────────────────────────────────────────────────────────

function WorkCard({
  title, specialist, status, blueprint, timestamp, type, onClick,
}: {
  title: string; specialist?: string; status: string; blueprint?: string;
  timestamp: string; type: "work" | "task"; onClick?: () => void;
}) {
  const map = type === "work" ? WORK_STATUS_META : TASK_STATUS_META;
  return (
    <div
      onClick={onClick}
      className={`bg-[#112033] border border-[#1E3A5F] rounded-xl p-5 transition-colors ${onClick ? "cursor-pointer hover:border-[#00D4FF]/40" : ""}`}
    >
      <div className="flex items-start gap-4">
        <div className="shrink-0 h-9 w-9 rounded-lg bg-[#0B1829] border border-[#1E3A5F] flex items-center justify-center text-sm">
          {type === "work" ? "📋" : "📌"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 mb-2">
            <p className="text-[#E2E8F0] font-medium text-sm leading-snug">{title}</p>
            <StatusBadge status={status} map={map} />
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {specialist && (
              <span className="text-[#64748B] text-xs capitalize">
                {specialist.replace(/_/g, " ")}
              </span>
            )}
            {blueprint && (
              <>
                <span className="text-[#1E3A5F]">·</span>
                <span className="text-[#64748B] text-xs">{blueprint}</span>
              </>
            )}
            <span className="text-[#1E3A5F]">·</span>
            <span className="text-[#64748B] text-xs">{timeAgo(timestamp)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Stat chip ────────────────────────────────────────────────────────────────

function StatChip({ label, count, accent }: { label: string; count: number; accent?: string }) {
  return (
    <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl px-5 py-4 text-center">
      <p className="font-bold text-xl" style={{ color: accent ?? "#E2E8F0" }}>{count}</p>
      <p className="text-[#64748B] text-xs mt-0.5">{label}</p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ActiveWorkPage() {
  const { slug }        = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const apiFetch        = useAuthFetch();
  const [filter, setFilter] = useState<WorkFilter>("all");

  // Sprint 29M Part D: use /active-executions for accurate in-flight data.
  // This endpoint aggregates tasks (active states) + specialist_runs (active states)
  // + execution_intents (dispatched) in a single query.
  const { data: activeData, isLoading } = useQuery({
    queryKey: ["active-executions", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/active-executions`).then(r => r.json()),
    enabled: !!slug, staleTime: 15_000, refetchInterval: 30_000,
  });

  const allActive: any[] = activeData?.activeExecutions ?? [];
  const totals = activeData?.totals ?? { tasks: 0, specialistRuns: 0, executionIntents: 0 };

  // Stats derived from the unified active-executions response
  const IN_PROGRESS_STATUSES = ["executing", "approved", "planning", "queued", "running", "claimed", "created", "waiting_for_runtime"];

  const inProgressCount  = allActive.filter(e => IN_PROGRESS_STATUSES.includes(e.status)).length;
  const awaitingCount    = allActive.filter(e => e.status === "awaiting_approval" || e.status === "evidence_required").length;
  const dispatchedCount  = allActive.filter(e => e.status === "dispatched").length;
  const totalCount       = allActive.length;

  // Filter logic
  function matchesFilter(status: string): boolean {
    if (filter === "all") return true;
    if (filter === "in_progress")
      return IN_PROGRESS_STATUSES.includes(status);
    if (filter === "awaiting_approval") return status === "awaiting_approval" || status === "evidence_required";
    if (filter === "completed") return status === "dispatched";
    if (filter === "failed") return false; // failed tasks not returned by active-executions
    return true;
  }

  const visible = allActive.filter(e => matchesFilter(e.status));

  // Sort newest-first (server already sorts, but apply locally after filter)
  const combined = visible.sort((a: any, b: any) =>
    new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
  );

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <AppShell orgSlug={slug ?? ""}>
        <div className="p-8 max-w-5xl mx-auto">
          {/* Header */}
          <div className="mb-7">
            <h1 className="text-2xl font-bold text-[#E2E8F0]">Active Work</h1>
            <p className="text-[#64748B] text-sm mt-1">All work being managed by your AI Workforce</p>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatChip label="In Progress"       count={inProgressCount}  accent="#60A5FA" />
            <StatChip label="Awaiting Approval" count={awaitingCount}    accent={awaitingCount > 0 ? "#FB923C" : undefined} />
            <StatChip label="Dispatched"        count={dispatchedCount}  accent={dispatchedCount > 0 ? "#A78BFA" : undefined} />
            <StatChip label="Total Active"      count={totalCount}       accent="#E2E8F0" />
          </div>
          {/* Data source note */}
          {totals.specialistRuns > 0 || totals.executionIntents > 0 ? (
            <p className="text-xs text-[#64748B] mb-4">
              {totals.tasks} task{totals.tasks !== 1 ? "s" : ""}
              {totals.specialistRuns > 0 ? ` · ${totals.specialistRuns} specialist run${totals.specialistRuns !== 1 ? "s" : ""}` : ""}
              {totals.executionIntents > 0 ? ` · ${totals.executionIntents} dispatched action${totals.executionIntents !== 1 ? "s" : ""}` : ""}
            </p>
          ) : null}

          {/* Filter tabs */}
          <div className="flex items-center gap-1 mb-6 p-1 bg-[#112033] border border-[#1E3A5F] rounded-xl w-fit overflow-x-auto">
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`shrink-0 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  filter === f.key
                    ? "bg-[#00D4FF]/10 text-[#00D4FF]"
                    : "text-[#64748B] hover:text-[#E2E8F0]"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Content */}
          {isLoading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => (
                <div key={i} className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5 animate-pulse">
                  <div className="flex gap-4">
                    <div className="h-9 w-9 bg-[#1E3A5F] rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-[#1E3A5F] rounded w-2/3" />
                      <div className="h-3 bg-[#1E3A5F] rounded w-1/3" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : combined.length === 0 ? (
            <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-16 text-center">
              <p className="text-4xl mb-3 opacity-30">⚡</p>
              <p className="text-[#E2E8F0] font-medium text-lg mb-1">No active work</p>
              <p className="text-[#64748B] text-sm mb-5">
                {filter === "all"
                  ? "Your AI Workforce has no tasks in progress right now."
                  : `No items matching "${FILTERS.find(f => f.key === filter)?.label}".`}
              </p>
              {filter === "all" && (
                <button
                  onClick={() => setLocation(`/app/${slug}/chat`)}
                  className="px-5 py-2.5 bg-[#00D4FF] text-[#0B1829] font-semibold text-sm rounded-lg hover:bg-[#00B8D9] transition-colors"
                >
                  Start new work →
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {combined.map((item: any) => {
                const type: "work" | "task" = item.kind === "specialist_run" || item.kind === "execution_intent"
                  ? "task"
                  : "task";
                return (
                  <WorkCard
                    key={item.id}
                    title={item.title ?? "Untitled"}
                    specialist={item.specialistCode}
                    status={item.status}
                    blueprint={item.kind === "execution_intent" ? "Dispatched Action" : undefined}
                    timestamp={item.startedAt ?? item.queuedAt ?? item.createdAt}
                    type={type}
                    onClick={item.taskId ? () => setLocation(`/app/${slug}/tasks/${item.taskId}`) : undefined}
                  />
                );
              })}
            </div>
          )}
        </div>
      </AppShell>
    </>
  );
}
