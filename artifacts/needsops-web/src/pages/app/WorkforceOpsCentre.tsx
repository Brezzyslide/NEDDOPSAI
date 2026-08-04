/**
 * Workforce Operations Centre — /app/:slug/workforce-ops
 * Sprint 26
 *
 * The operational command centre for the AI Workforce.
 * Answers: What is each specialist doing? Are they healthy? What needs attention?
 *
 * Sections:
 *   1. Workforce Summary metrics strip
 *   2. Specialist roster with operational status
 *   3. Alerts panel
 *   4. Organisation Workforce Health executive summary
 */

import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AppShell from "@/components/layout/AppShell";
import { useAuthFetch } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkforceSummary {
  totalSpecialists: number;
  byStatus: {
    active: number;
    busy: number;
    idle: number;
    awaitingApproval: number;
    suspended: number;
    trainingRequired: number;
    offline: number;
  };
  averageQualityScore: number | null;
  averageConfidence: number | null;
  organisationReadinessScore: number;
  activeTaskCount: number;
  pendingApprovalsCount: number;
}

interface WorkforceAlert {
  id: string;
  specialistCode: string | null;
  specialistTitle: string | null;
  type: string;
  title: string;
  detail: string;
  severity: "critical" | "high" | "medium" | "low";
  createdAt: string;
  acknowledged: boolean;
}

interface OrgWorkforceHealth {
  workforceReadinessScore: number;
  averageQuality: number | null;
  knowledgeCoverage: number;
  trainingCompletion: number;
  activeWorkload: number;
  outstandingApprovals: number;
  recommendations: Array<{
    priority: "high" | "medium" | "low";
    title: string;
    detail: string;
    actionUrl: string;
  }>;
  generatedAt: string;
}

interface SpecialistEntry {
  code: string;
  title: string;
  descriptor: string;
  domain: string;
  department: string;
  packCode: string;
  executionStatus: string;
  dnaStatus: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const OPS_STATUS: Record<string, { label: string; dot: string; badge: string }> = {
  active:            { label: "Active",             dot: "bg-emerald-400",  badge: "bg-emerald-900/30 text-emerald-400" },
  busy:              { label: "Busy",               dot: "bg-cyan-400",     badge: "bg-cyan-900/30 text-cyan-400" },
  idle:              { label: "Idle",               dot: "bg-blue-400",     badge: "bg-blue-900/30 text-blue-400" },
  awaiting_approval: { label: "Awaiting Approval",  dot: "bg-amber-400",    badge: "bg-amber-900/30 text-amber-400" },
  suspended:         { label: "Suspended",          dot: "bg-red-400",      badge: "bg-red-900/30 text-red-400" },
  training_required: { label: "Training Required",  dot: "bg-orange-400",   badge: "bg-orange-900/30 text-orange-400" },
  offline:           { label: "Offline",            dot: "bg-[#64748B]",    badge: "bg-[#1E3A5F] text-[#64748B]" },
};

const SEVERITY_COLOURS = {
  critical: { bar: "bg-red-500",    badge: "bg-red-900/30 text-red-400",       icon: "🔴" },
  high:     { bar: "bg-orange-400", badge: "bg-orange-900/30 text-orange-400", icon: "🟠" },
  medium:   { bar: "bg-amber-400",  badge: "bg-amber-900/30 text-amber-400",   icon: "🟡" },
  low:      { bar: "bg-blue-400",   badge: "bg-blue-900/30 text-blue-400",     icon: "🔵" },
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function ReadinessRing({ score, size = 56 }: { score: number; size?: number }) {
  const colour = score >= 80 ? "#34D399" : score >= 50 ? "#FBBF24" : "#F87171";
  const r = (size / 2) - 4;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1E3A5F" strokeWidth="3.5"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={colour} strokeWidth="3.5"
        strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
        style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%" }}/>
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle"
        fontSize={size < 48 ? "9" : "11"} fontWeight="600" fill={colour}>
        {score}
      </text>
    </svg>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, colour = "text-white" }: {
  label: string; value: string | number; sub?: string; colour?: string;
}) {
  return (
    <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4 flex flex-col gap-1">
      <span className="text-[#64748B] text-xs uppercase tracking-wide">{label}</span>
      <span className={`text-2xl font-bold ${colour}`}>{value}</span>
      {sub && <span className="text-[#64748B] text-xs">{sub}</span>}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const s = OPS_STATUS[status] ?? OPS_STATUS.offline!;
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${s.dot}`}/>
      <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${s.badge}`}>{s.label}</span>
    </span>
  );
}

function SpecialistRow({
  spec,
  trainingStatus,
  readinessScore,
  onNavigate,
}: {
  spec: SpecialistEntry;
  trainingStatus: string | null;
  readinessScore: number;
  onNavigate: () => void;
}) {
  const opsStatus = trainingStatus === "suspended" ? "suspended"
    : trainingStatus === "ready"           ? "active"
    : trainingStatus === "needs_attention" ? "training_required"
    : trainingStatus === "review_required" ? "awaiting_approval"
    : !trainingStatus || trainingStatus === "not_started" ? "offline"
    : "idle";

  return (
    <button
      onClick={onNavigate}
      className="w-full text-left bg-[#112033] border border-[#1E3A5F] rounded-xl p-4 hover:border-[#00D4FF]/40 transition-all group"
    >
      <div className="flex items-center gap-4">
        <ReadinessRing score={readinessScore} size={48}/>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-white font-semibold text-sm truncate">{spec.title}</span>
          </div>
          <p className="text-[#64748B] text-xs truncate">{spec.descriptor}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <StatusDot status={opsStatus}/>
          <span className="text-[#64748B] text-xs">{spec.domain?.split(",")[0]?.trim()}</span>
        </div>
        <span className="text-[#64748B] group-hover:text-[#00D4FF] transition-colors ml-1">→</span>
      </div>
    </button>
  );
}

function AlertRow({ alert, onAcknowledge }: { alert: WorkforceAlert; onAcknowledge?: () => void }) {
  const s = SEVERITY_COLOURS[alert.severity];
  return (
    <div className={`relative overflow-hidden bg-[#112033] border border-[#1E3A5F] rounded-xl p-4`}>
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${s.bar}`}/>
      <div className="pl-3 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${s.badge}`}>
              {alert.severity.toUpperCase()}
            </span>
            {alert.specialistTitle && (
              <span className="text-[#64748B] text-xs">{alert.specialistTitle}</span>
            )}
          </div>
          <p className="text-white text-sm font-medium mb-0.5">{alert.title}</p>
          <p className="text-[#94A3B8] text-xs leading-relaxed">{alert.detail}</p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className="text-[#64748B] text-xs">{timeAgo(alert.createdAt)}</span>
          {onAcknowledge && (
            <button
              onClick={e => { e.stopPropagation(); onAcknowledge(); }}
              className="text-xs text-[#64748B] hover:text-[#00D4FF] transition-colors"
            >
              Acknowledge
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function HealthBar({ label, value, colour }: { label: string; value: number; colour: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[#94A3B8] text-xs">{label}</span>
        <span className={`text-sm font-semibold ${colour}`}>{value}%</span>
      </div>
      <div className="h-1.5 bg-[#1E3A5F] rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${colour.includes("emerald") ? "bg-emerald-400" : colour.includes("amber") ? "bg-amber-400" : colour.includes("red") ? "bg-red-400" : "bg-[#00D4FF]"}`}
          style={{ width: `${value}%` }}/>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WorkforceOpsCentre() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const apiFetch = useAuthFetch();
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());

  const BASE = `/v1/organisations/${slug}`;

  const { data: summary, isLoading: sumLoading } = useQuery<WorkforceSummary>({
    queryKey: ["workforce-ops-summary", slug],
    queryFn: () => apiFetch(`${BASE}/workforce-ops/summary`).then(r => r.json()),
    refetchInterval: 30_000,
  });

  const { data: alertsData, isLoading: alertsLoading } = useQuery<{ alerts: WorkforceAlert[]; total: number }>({
    queryKey: ["workforce-ops-alerts", slug],
    queryFn: () => apiFetch(`${BASE}/workforce-ops/alerts`).then(r => r.json()),
    refetchInterval: 60_000,
  });

  const { data: health } = useQuery<OrgWorkforceHealth>({
    queryKey: ["workforce-ops-health", slug],
    queryFn: () => apiFetch(`${BASE}/workforce-ops/health`).then(r => r.json()),
    refetchInterval: 120_000,
  });

  // Specialist list from the catalogue endpoint
  const { data: specialistsData } = useQuery<{ specialists: SpecialistEntry[]; total: number }>({
    queryKey: ["workforce-specialists"],
    queryFn: () => apiFetch("/v1/workforce/specialists").then(r => r.json()),
  });

  const specialists = specialistsData?.specialists ?? [];

  const allAlerts = (alertsData?.alerts ?? []).filter(a => !dismissedAlerts.has(a.id));
  const filteredAlerts = severityFilter === "all"
    ? allAlerts
    : allAlerts.filter(a => a.severity === severityFilter);

  const criticalCount = allAlerts.filter(a => a.severity === "critical").length;
  const highCount     = allAlerts.filter(a => a.severity === "high").length;

  const readinessColour = (score: number) =>
    score >= 80 ? "text-emerald-400" : score >= 50 ? "text-amber-400" : "text-red-400";

  return (
    <AppShell orgSlug={slug!}>
      {/* ── Header ── */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Workforce Operations</h1>
            <p className="text-[#64748B] text-sm">
              Supervise and manage your AI workforce — health, readiness, and workload at a glance.
            </p>
          </div>
          {(criticalCount > 0 || highCount > 0) && (
            <div className="flex items-center gap-2 bg-red-900/20 border border-red-900/40 rounded-xl px-4 py-2 shrink-0">
              <span className="text-red-400 text-sm font-semibold">
                {criticalCount > 0 ? `${criticalCount} critical` : `${highCount} high`} alert{(criticalCount + highCount) > 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Summary Metrics ── */}
      <section className="mb-8">
        <h2 className="text-[#94A3B8] text-xs uppercase tracking-wide mb-3">Workforce Overview</h2>
        {sumLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4 h-20 animate-pulse"/>
            ))}
          </div>
        ) : summary ? (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <MetricCard label="Total" value={summary.totalSpecialists} sub="specialists"/>
            <MetricCard label="Active" value={summary.byStatus.active}
              colour={summary.byStatus.active > 0 ? "text-emerald-400" : "text-white"}/>
            <MetricCard label="Idle" value={summary.byStatus.idle} colour="text-blue-400"/>
            <MetricCard label="Awaiting Approval" value={summary.byStatus.awaitingApproval}
              colour={summary.byStatus.awaitingApproval > 0 ? "text-amber-400" : "text-white"}/>
            <MetricCard label="Training Required" value={summary.byStatus.trainingRequired}
              colour={summary.byStatus.trainingRequired > 0 ? "text-orange-400" : "text-white"}/>
            <MetricCard label="Suspended" value={summary.byStatus.suspended}
              colour={summary.byStatus.suspended > 0 ? "text-red-400" : "text-white"}/>
            <MetricCard label="Offline" value={summary.byStatus.offline} colour="text-[#64748B]"/>
            <MetricCard
              label="Org Readiness"
              value={`${summary.organisationReadinessScore}%`}
              colour={readinessColour(summary.organisationReadinessScore)}
              sub="of specialists ready"
            />
            <MetricCard
              label="Avg Quality"
              value={summary.averageQualityScore != null ? summary.averageQualityScore : "—"}
              colour={summary.averageQualityScore != null && summary.averageQualityScore >= 75 ? "text-emerald-400" : "text-amber-400"}
              sub="/ 100"
            />
            <MetricCard label="Active Tasks" value={summary.activeTaskCount}
              colour={summary.activeTaskCount > 0 ? "text-cyan-400" : "text-white"}/>
            <MetricCard label="Pending Approvals" value={summary.pendingApprovalsCount}
              colour={summary.pendingApprovalsCount > 0 ? "text-amber-400" : "text-white"}/>
          </div>
        ) : null}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left: Specialist Roster ── */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-[#94A3B8] text-xs uppercase tracking-wide">Specialists</h2>
            <span className="text-[#64748B] text-xs">{specialists.length} in catalogue</span>
          </div>
          {specialists.length === 0 ? (
            <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-8 text-center">
              <p className="text-[#64748B] text-sm">Loading specialists…</p>
            </div>
          ) : (
            specialists.map(spec => (
              <SpecialistRow
                key={spec.code}
                spec={spec}
                trainingStatus={null}
                readinessScore={0}
                onNavigate={() => setLocation(`/app/${slug}/workforce-ops/${spec.code}`)}
              />
            ))
          )}
        </div>

        {/* ── Right: Alerts + Health ── */}
        <div className="space-y-6">
          {/* Alerts Panel */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[#94A3B8] text-xs uppercase tracking-wide">Alerts</h2>
              <div className="flex items-center gap-1.5">
                {(["all", "critical", "high", "medium", "low"] as const).map(sev => (
                  <button
                    key={sev}
                    onClick={() => setSeverityFilter(sev)}
                    className={`text-xs px-2 py-0.5 rounded-full transition-colors capitalize ${
                      severityFilter === sev
                        ? "bg-[#00D4FF]/20 text-[#00D4FF] border border-[#00D4FF]/40"
                        : "text-[#64748B] hover:text-white"
                    }`}
                  >
                    {sev}
                  </button>
                ))}
              </div>
            </div>

            {alertsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="bg-[#112033] border border-[#1E3A5F] rounded-xl h-20 animate-pulse"/>
                ))}
              </div>
            ) : filteredAlerts.length === 0 ? (
              <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-6 text-center">
                <p className="text-emerald-400 text-sm font-medium mb-1">No alerts</p>
                <p className="text-[#64748B] text-xs">Your workforce is operating normally.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredAlerts.map(alert => (
                  <AlertRow
                    key={alert.id}
                    alert={alert}
                    onAcknowledge={() => setDismissedAlerts(prev => new Set([...prev, alert.id]))}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Org Workforce Health */}
          {health && (
            <div>
              <h2 className="text-[#94A3B8] text-xs uppercase tracking-wide mb-3">Workforce Health</h2>
              <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5 space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <ReadinessRing score={health.workforceReadinessScore} size={52}/>
                  <div>
                    <p className="text-white text-sm font-semibold">Overall Readiness</p>
                    <p className="text-[#64748B] text-xs">Organisation score</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <HealthBar
                    label="Training Completion"
                    value={health.trainingCompletion}
                    colour={health.trainingCompletion >= 70 ? "text-emerald-400" : health.trainingCompletion >= 40 ? "text-amber-400" : "text-red-400"}
                  />
                  <HealthBar
                    label="Knowledge Coverage"
                    value={health.knowledgeCoverage}
                    colour={health.knowledgeCoverage >= 70 ? "text-emerald-400" : health.knowledgeCoverage >= 40 ? "text-amber-400" : "text-red-400"}
                  />
                  {health.averageQuality != null && (
                    <HealthBar
                      label="Average Quality"
                      value={health.averageQuality}
                      colour={health.averageQuality >= 75 ? "text-emerald-400" : health.averageQuality >= 55 ? "text-amber-400" : "text-red-400"}
                    />
                  )}
                </div>
                <div className="border-t border-[#1E3A5F] pt-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-[#64748B]">Active workload</span>
                    <p className="text-white font-semibold">{health.activeWorkload} task{health.activeWorkload !== 1 ? "s" : ""}</p>
                  </div>
                  <div>
                    <span className="text-[#64748B]">Outstanding approvals</span>
                    <p className={`font-semibold ${health.outstandingApprovals > 0 ? "text-amber-400" : "text-white"}`}>
                      {health.outstandingApprovals}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Recommendations */}
          {health && health.recommendations.length > 0 && (
            <div>
              <h2 className="text-[#94A3B8] text-xs uppercase tracking-wide mb-3">Recommendations</h2>
              <div className="space-y-2">
                {health.recommendations.map((rec, i) => (
                  <button
                    key={i}
                    onClick={() => setLocation(rec.actionUrl)}
                    className="w-full text-left bg-[#112033] border border-[#1E3A5F] rounded-xl p-4 hover:border-[#00D4FF]/40 transition-all"
                  >
                    <div className="flex items-start gap-2">
                      <span className={`mt-0.5 text-xs font-semibold shrink-0 ${
                        rec.priority === "high" ? "text-orange-400" : rec.priority === "medium" ? "text-amber-400" : "text-blue-400"
                      }`}>
                        {rec.priority.toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium mb-0.5">{rec.title}</p>
                        <p className="text-[#64748B] text-xs leading-relaxed">{rec.detail}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
