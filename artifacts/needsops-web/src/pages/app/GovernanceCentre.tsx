/**
 * Governance Centre — /app/:slug/governance
 *
 * Sprint 24 hub page. Provides:
 *   - Organisation Health summary (knowledge + specialists + pending + library + memory)
 *   - AI recommendations derived from existing data
 *   - Navigation cards to each governance sub-section with live counts
 *   - Recent governance activity strip
 */

import { useParams, useLocation } from "wouter";
import { useQuery }               from "@tanstack/react-query";
import { Show }                   from "@clerk/react";
import { Redirect }               from "wouter";
import AppShell                   from "@/components/layout/AppShell";
import { useAuthFetch }           from "@/lib/api";

// ─── Governance Metrics types ─────────────────────────────────────────────────
interface GovernanceMetrics {
  pendingApprovals:        number;
  approvedLast30Days:      number;
  rejectedLast30Days:      number;
  avgApprovalHours:        number | null;
  approvalsAgedOver48h:    number;
  approvalAgingBuckets:    { under24h: number; h24to48: number; over48h: number };
  approvedMemoryCount:     number;
  pendingMemoryCount:      number;
  memoryHealthScore:       number | null;
  completedWorkPending:    number;
  executionSuccessRate:    number | null;
  publishedBlueprintCount: number;
  draftBlueprintCount:     number;
  blueprintCoverage:       number;
  governanceScore:         number | null;
  governanceEventsLast30Days: number;
  topGovernanceActors:     { actorUserId: string | null; count: number }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreColour(score: number | null) {
  if (score === null) return { text: "text-[#94A3B8]", bg: "bg-slate-400", ring: "ring-slate-400/30" };
  if (score >= 80) return { text: "text-emerald-400", bg: "bg-emerald-400", ring: "ring-emerald-400/30" };
  if (score >= 60) return { text: "text-amber-400",   bg: "bg-amber-400",   ring: "ring-amber-400/30" };
  return               { text: "text-red-400",        bg: "bg-red-400",     ring: "ring-red-400/30" };
}

function scoreHex(score: number | null) {
  if (score === null) return "#94A3B8";
  if (score >= 80) return "#34D399";
  if (score >= 60) return "#FBBF24";
  return "#F87171";
}

function HealthMeter({ score }: { score: number | null }) {
  const c   = scoreColour(score);
  const deg = score === null ? 0 : Math.round((score / 100) * 360);
  return (
    <div className={`relative h-28 w-28 rounded-full ring-4 ${c.ring} flex items-center justify-center`}
         style={{ background: `conic-gradient(${scoreHex(score)} ${deg}deg, #1E3A5F ${deg}deg)` }}>
      <div className="h-20 w-20 rounded-full bg-[#0B1829] flex flex-col items-center justify-center">
        <span className={`text-2xl font-bold ${c.text}`}>{score === null ? "-" : score}</span>
        <span className="text-[#64748B] text-xs">{score === null ? "No score" : "/ 100"}</span>
      </div>
    </div>
  );
}

function HealthIndicator({ label, value, max, unit, inverse }: {
  label: string; value: number | null; max: number; unit?: string; inverse?: boolean;
}) {
  const hasValue = value !== null;
  const pct   = hasValue ? Math.min(100, (value / max) * 100) : 0;
  const good  = hasValue && (inverse ? value === 0 : pct >= 70);
  const warn  = hasValue && (inverse ? value > 0 && value <= 3 : pct >= 40 && pct < 70);
  const barCls = good ? "bg-emerald-400" : warn ? "bg-amber-400" : "bg-red-400";
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[#94A3B8] text-xs">{label}</span>
        <span className={`text-sm font-semibold ${!hasValue ? "text-[#94A3B8]" : good ? "text-emerald-400" : warn ? "text-amber-400" : "text-red-400"}`}>
          {hasValue ? `${value}${unit ?? ""}` : "Not enough data"}
        </span>
      </div>
      <div className="h-1.5 bg-[#1E3A5F] rounded-full overflow-hidden">
        {hasValue && (
          <div className={`h-full rounded-full transition-all ${barCls}`} style={{ width: `${inverse ? Math.max(0, 100 - pct) : pct}%` }} />
        )}
      </div>
    </div>
  );
}

function NavCard({ icon, title, description, count, countLabel, urgent, onClick }: {
  icon: string; title: string; description: string;
  count?: number; countLabel?: string; urgent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-[#112033] border rounded-xl p-5 hover:border-[#00D4FF]/40 transition-all group ${
        urgent && (count ?? 0) > 0 ? "border-amber-900/50" : "border-[#1E3A5F]"
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <span className="text-2xl">{icon}</span>
        {count !== undefined && count > 0 && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            urgent ? "bg-amber-900/40 text-amber-400" : "bg-[#00D4FF]/10 text-[#00D4FF]"
          }`}>
            {count} {countLabel}
          </span>
        )}
      </div>
      <p className="text-[#E2E8F0] font-semibold text-sm mb-1 group-hover:text-white">{title}</p>
      <p className="text-[#64748B] text-xs leading-relaxed">{description}</p>
    </button>
  );
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const EVENT_LABEL: Record<string, string> = {
  "knowledge.approved":         "Policy approved",
  "knowledge.rejected":         "Policy rejected",
  "memory.approved":            "Memory entry approved",
  "memory.rejected":            "Memory entry rejected",
  "approval.granted":           "Approval granted",
  "approval.rejected":          "Approval rejected",
  "specialist.trained":         "Specialist updated",
  "knowledge.curation.completed":"Curation completed",
  "work.approved":              "Work approved",
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function GovernanceCentre() {
  const { slug }        = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const apiFetch        = useAuthFetch();

  const { data: healthData } = useQuery({
    queryKey: ["knowledge-health", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/knowledge/health`).then(r => r.json()),
    enabled: !!slug && slug !== "undefined", staleTime: 120_000,
  });

  const { data: proposalsData } = useQuery({
    queryKey: ["proposals-gov", slug, "proposed"],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/knowledge/curation/proposals?status=proposed&limit=50`).then(r => r.json()),
    enabled: !!slug && slug !== "undefined", staleTime: 60_000,
  });

  const { data: memoryData } = useQuery({
    queryKey: ["memory-gov", slug, "proposed"],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/memory?status=proposed&limit=50`).then(r => r.json()),
    enabled: !!slug && slug !== "undefined", staleTime: 60_000,
  });

  const { data: approvalsData } = useQuery({
    queryKey: ["approvals-gov", slug, "pending"],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/approvals?state=pending`).then(r => r.json()),
    enabled: !!slug && slug !== "undefined", staleTime: 30_000,
  });

  const { data: completedWorkData } = useQuery({
    queryKey: ["completed-work-gov", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/completed-work?limit=50`).then(r => r.json()),
    enabled: !!slug && slug !== "undefined", staleTime: 60_000,
  });

  const { data: auditData } = useQuery({
    queryKey: ["audit-gov", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/audit?limit=8`).then(r => r.json()),
    enabled: !!slug && slug !== "undefined", staleTime: 60_000,
  });

  // Sprint 29: Governance metrics
  const { data: metricsData } = useQuery({
    queryKey: ["governance-metrics", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/approvals/metrics`).then(r => r.json()),
    enabled: !!slug && slug !== "undefined", staleTime: 120_000,
  });
  const metrics = metricsData?.metrics as GovernanceMetrics | undefined;

  const health      = healthData as Record<string, any> | undefined;
  const healthScore = health ? (health.healthScore ?? health.overallScore ?? health.score ?? null) : null;

  const pendingProposals  = proposalsData?.total ?? proposalsData?.proposals?.length ?? 0;
  const pendingMemory     = memoryData?.total ?? memoryData?.items?.length ?? 0;
  const pendingApprovals  = approvalsData?.approvals?.length ?? 0;
  const pendingWork       = (completedWorkData?.completedWork ?? []).filter((w: any) => w.status === "awaiting_approval").length;
  const totalPending      = pendingProposals + pendingMemory + pendingApprovals + pendingWork;

  // Organisation health dimensions
  const libTotal     = health?.librarySourceCount ?? null;
  const libApproved  = health?.approvedSourceCount ?? 0;
  const libPct       = libTotal === null ? null : libTotal > 0 ? Math.round((libApproved / libTotal) * 100) : null;
  const memApproved  = health?.approvedMemoryCount ?? 0;
  const memTotal     = health ? memApproved + pendingMemory : null;
  const memQuality   = memTotal === null || memTotal === 0 ? null : memApproved;
  const specCoverage = health ? (health.specialistCoverage ?? null) : null;
  const conflicts    = (health?.conflictingKnowledge ?? 0) + (health?.duplicateKnowledge ?? 0);
  const retraining   = health?.specialistsNeedingRetraining?.length ?? 0;

  // Aggregate organisation health score (weighted)
  const orgHealthScore =
    healthScore === null || specCoverage === null || libPct === null
      ? null
      : Math.round((healthScore * 0.4) + (specCoverage * 0.25) + (libPct * 0.2) + (Math.max(0, 100 - conflicts * 10) * 0.15));

  // AI-derived recommendations (no extra LLM call — derive from data)
  const recommendations: string[] = [];
  if (pendingProposals > 0) recommendations.push(`${pendingProposals} knowledge update${pendingProposals > 1 ? "s" : ""} proposed by your AI Workforce are awaiting your review.`);
  if (pendingMemory > 0)    recommendations.push(`${pendingMemory} memory proposal${pendingMemory > 1 ? "s" : ""} need approval before the Chief of Staff can use them.`);
  if (conflicts > 0)        recommendations.push(`${conflicts} conflicting or duplicate knowledge entries detected — review in the Knowledge Health dashboard.`);
  if (retraining > 0)       recommendations.push(`${retraining} specialist${retraining > 1 ? "s" : ""} may need retraining based on recent knowledge changes.`);
  if (pendingWork > 0)      recommendations.push(`${pendingWork} completed work item${pendingWork > 1 ? "s" : ""} awaiting your approval in the Approval Centre.`);
  if (orgHealthScore === null) recommendations.push("Organisation health is not yet computable because the knowledge or memory baseline is incomplete.");
  if (recommendations.length === 0) recommendations.push("Your AI Workforce is operating well. No immediate action required.");

  const recentEvents = (auditData?.events ?? []).slice(0, 6);

  const go = (path: string) => setLocation(path);

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <AppShell orgSlug={slug ?? ""}>
        <div className="p-8 max-w-6xl mx-auto">

          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[#E2E8F0]">Governance Centre</h1>
            <p className="text-[#64748B] text-sm mt-1">Supervise your AI Workforce — every decision visible and auditable</p>
          </div>

          {/* Organisation Health Summary */}
          <div className="bg-[#112033] border border-[#1E3A5F] rounded-2xl p-6 mb-8">
            <div className="flex flex-col md:flex-row gap-8">
              {/* Score */}
              <div className="flex flex-col items-center justify-center gap-3 shrink-0">
                <HealthMeter score={orgHealthScore} />
                <div className="text-center">
                  <p className="text-[#E2E8F0] font-semibold text-sm">Organisation Health</p>
                  <p className="text-[#64748B] text-xs">
                    {orgHealthScore === null ? "Not enough data" : orgHealthScore >= 80 ? "Healthy" : orgHealthScore >= 60 ? "Needs attention" : "Requires action"}
                  </p>
                </div>
              </div>

              {/* Dimensions */}
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-5">
                <HealthIndicator label="Knowledge Quality"   value={healthScore}    max={100} unit="%" />
                <HealthIndicator label="Specialist Readiness" value={specCoverage}  max={100} unit="%" />
                <HealthIndicator label="Library Completeness" value={libPct}        max={100} unit="%" />
                <HealthIndicator label="Memory Quality"      value={memQuality}    max={Math.max(1, memTotal ?? 0)} />
                <HealthIndicator label="Conflicts & Duplicates" value={conflicts}   max={10} inverse />
                <HealthIndicator label="Pending Decisions"   value={totalPending}  max={20} inverse />
              </div>

              {/* Recommendations */}
              <div className="md:w-72 shrink-0">
                <p className="text-[#E2E8F0] text-xs font-semibold uppercase tracking-widest mb-3">Recommendations</p>
                <div className="space-y-2">
                  {recommendations.slice(0, 4).map((r, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="shrink-0 mt-0.5 text-[#00D4FF] text-xs">→</span>
                      <p className="text-[#94A3B8] text-xs leading-relaxed">{r}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Sprint 29: Governance Metrics Panel */}
          {metrics && (
            <div className="bg-[#112033] border border-[#1E3A5F] rounded-2xl p-6 mb-8">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <p className="text-[#E2E8F0] font-semibold">Governance Score</p>
                  <p className="text-[#64748B] text-xs mt-0.5">How consistently your AI Workforce is governed</p>
                </div>
                <div className="flex flex-col items-end">
                  <span className={`text-4xl font-bold tabular-nums ${
                    metrics.governanceScore === null ? "text-[#94A3B8]" :
                    metrics.governanceScore >= 80 ? "text-emerald-400" :
                    metrics.governanceScore >= 60 ? "text-amber-400" : "text-red-400"
                  }`}>{metrics.governanceScore === null ? "Not enough data" : Math.round(metrics.governanceScore)}</span>
                  <span className="text-[#64748B] text-xs">{metrics.governanceScore === null ? "Insufficient governance data" : "/ 100"}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
                {/* Approval ageing */}
                <div className="bg-[#0B1829] border border-[#1E3A5F] rounded-xl p-3">
                  <p className="text-[#64748B] text-xs mb-1">Pending</p>
                  <p className="text-[#E2E8F0] text-xl font-bold">{metrics.pendingApprovals}</p>
                  {metrics.approvalsAgedOver48h > 0 && (
                    <p className="text-red-400 text-xs mt-0.5">{metrics.approvalsAgedOver48h} aged &gt;48h</p>
                  )}
                </div>
                {/* Avg resolution time */}
                <div className="bg-[#0B1829] border border-[#1E3A5F] rounded-xl p-3">
                  <p className="text-[#64748B] text-xs mb-1">Avg. resolution</p>
                  <p className="text-[#E2E8F0] text-xl font-bold">
                    {metrics.avgApprovalHours !== null ? `${metrics.avgApprovalHours.toFixed(1)}h` : "—"}
                  </p>
                  <p className="text-[#64748B] text-xs mt-0.5">{metrics.approvedLast30Days} resolved (30d)</p>
                </div>
                {/* Memory health */}
                <div className="bg-[#0B1829] border border-[#1E3A5F] rounded-xl p-3">
                  <p className="text-[#64748B] text-xs mb-1">Memory health</p>
                  <p className={`text-xl font-bold ${
                    metrics.memoryHealthScore === null ? "text-[#94A3B8]" :
                    metrics.memoryHealthScore >= 80 ? "text-emerald-400" :
                    metrics.memoryHealthScore >= 60 ? "text-amber-400" : "text-red-400"
                  }`}>{metrics.memoryHealthScore === null ? "Not enough data" : `${Math.round(metrics.memoryHealthScore)}%`}</p>
                  <p className="text-[#64748B] text-xs mt-0.5">{metrics.approvedMemoryCount} approved entries</p>
                </div>
                {/* Blueprint coverage */}
                <div className="bg-[#0B1829] border border-[#1E3A5F] rounded-xl p-3">
                  <p className="text-[#64748B] text-xs mb-1">Blueprint coverage</p>
                  <p className={`text-xl font-bold ${
                    metrics.blueprintCoverage >= 70 ? "text-emerald-400" :
                    metrics.blueprintCoverage >= 40 ? "text-amber-400" : "text-[#94A3B8]"
                  }`}>{Math.round(metrics.blueprintCoverage)}%</p>
                  <p className="text-[#64748B] text-xs mt-0.5">{metrics.publishedBlueprintCount} published</p>
                </div>
              </div>

              {/* Aging breakdown */}
              {(metrics.approvalAgingBuckets.over48h > 0 || metrics.approvalAgingBuckets.h24to48 > 0) && (
                <div className="border-t border-[#1E3A5F] pt-4">
                  <p className="text-[#64748B] text-xs uppercase tracking-widest font-semibold mb-3">Approval ageing</p>
                  <div className="flex items-center gap-6">
                    {[
                      { label: "Under 24h", count: metrics.approvalAgingBuckets.under24h, cls: "text-emerald-400" },
                      { label: "24–48h",    count: metrics.approvalAgingBuckets.h24to48,  cls: "text-amber-400" },
                      { label: "Over 48h",  count: metrics.approvalAgingBuckets.over48h,  cls: "text-red-400" },
                    ].map(b => (
                      <div key={b.label} className="flex items-center gap-2">
                        <span className={`text-lg font-bold tabular-nums ${b.cls}`}>{b.count}</span>
                        <span className="text-[#64748B] text-xs">{b.label}</span>
                      </div>
                    ))}
                    {metrics.topGovernanceActors.length > 0 && (
                      <div className="ml-auto text-right">
                        <p className="text-[#64748B] text-xs">Top actor</p>
                        <p className="text-[#94A3B8] text-xs font-mono">{metrics.topGovernanceActors[0]?.actorUserId ?? "—"}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Navigation grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
            <NavCard
              icon="✅" title="Approval Centre"
              description="Review and action every pending decision in one place."
              count={totalPending} countLabel="pending" urgent
              onClick={() => go(`/app/${slug}/approvals`)}
            />
            <NavCard
              icon="🧠" title="Knowledge Review"
              description="Review AI-proposed knowledge updates before they take effect."
              count={pendingProposals} countLabel="proposals" urgent
              onClick={() => go(`/app/${slug}/approvals`)}
            />
            <NavCard
              icon="💡" title="Memory Governance"
              description="Review, pin, and manage what your AI Workforce remembers."
              count={pendingMemory} countLabel="pending" urgent
              onClick={() => go(`/app/${slug}/memory`)}
            />
            <NavCard
              icon="❤️" title="Knowledge Health"
              description="Coverage, freshness, conflicts, and retraining recommendations."
              onClick={() => go(`/app/${slug}/governance/knowledge-health`)}
            />
            <NavCard
              icon="🕐" title="Governance Timeline"
              description="A chronological record of all governance activity."
              onClick={() => go(`/app/${slug}/governance/timeline`)}
            />
            <NavCard
              icon="📋" title="Audit Log"
              description="Detailed activity log with actor, time, and resource context."
              onClick={() => go(`/app/${slug}/audit`)}
            />
          </div>

          {/* Recent activity */}
          {recentEvents.length > 0 && (
            <div className="bg-[#112033] border border-[#1E3A5F] rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[#E2E8F0] font-semibold text-sm">Recent Governance Activity</p>
                <button onClick={() => go(`/app/${slug}/governance/timeline`)}
                  className="text-[#00D4FF] text-xs hover:underline">View timeline →</button>
              </div>
              <div className="space-y-2">
                {recentEvents.map((e: any) => (
                  <div key={e.id} className="flex items-center gap-3 py-2 border-b border-[#1E3A5F]/50 last:border-0">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#00D4FF]/60 shrink-0" />
                    <p className="flex-1 text-[#94A3B8] text-xs">
                      {EVENT_LABEL[e.event_type ?? e.eventType] ?? (e.event_type ?? e.eventType)?.replace(/_/g, " ")}
                    </p>
                    <span className="text-[#64748B] text-xs shrink-0">{timeAgo(e.occurred_at ?? e.occurredAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </AppShell>
    </>
  );
}
