/**
 * Workforce Specialist Detail — /app/:slug/workforce-ops/:specialistId
 * Sprint 26
 *
 * Professional profile for a single AI specialist.
 * Tabs: Overview · Readiness · Workload · Performance · Knowledge · Actions
 */

import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AppShell from "@/components/layout/AppShell";
import { useAuthFetch } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpecialistOpsProfile {
  code: string;
  title: string;
  descriptor: string;
  domain: string;
  department: string;
  dnaVersion: string;
  packCode: string;
  operationalStatus: string;
  trainingStatus: string | null;
  trainingRecord: {
    configurationComplete: boolean;
    knowledgeSourcesApproved: boolean;
    retrievalTestPassed: boolean;
    sampleTaskPassed: boolean;
    approvedAt: string | null;
    lastTestedAt: string | null;
    notes: string | null;
  } | null;
  orgConfig: {
    goals: string[];
    preferredStyle: string | null;
    escalationContacts: unknown[];
    lastConfirmedAt: string | null;
  } | null;
  recentWork: Array<{ id: string; title: string; status: string; createdAt: string }>;
  currentTasks: Array<{ id: string; title: string; state: string; createdAt: string }>;
  lastActivity: string | null;
}

interface ReadinessBlocker {
  code: string;
  reason: string;
  severity: "critical" | "high" | "medium" | "low";
  recommendedAction: string;
  resolveUrl: string;
}

interface SpecialistReadiness {
  specialistCode: string;
  isReady: boolean;
  readinessScore: number;
  blockers: ReadinessBlocker[];
  lastReviewed: string | null;
}

interface WorkloadQueue {
  activeRuns: Array<{ id: string; taskId: string; status: string; startedAt: string | null; confidence: string | null }>;
  waitingQueue: Array<{ id: string; runId: string; status: string; priority: number; queuedAt: string }>;
  recentCompleted: Array<{ id: string; title: string; status: string; createdAt: string }>;
  failedRuns: Array<{ id: string; taskId: string; lastError: string | null; failedAt: string | null }>;
  averageExecutionMs: number | null;
  queueLength: number;
  totalRetries: number;
}

interface SpecialistPerformance {
  period: 7 | 30 | 90;
  workCompleted: number;
  approvalRate: number | null;
  rejectionRate: number | null;
  averageSelfReviewScore: number | null;
  averageConfidence: number | null;
  knowledgeUtilisation: number | null;
  averageTurnaroundHours: number | null;
}

interface SpecialistKnowledge {
  assignedSources: Array<{ id: string; title: string; sourceType: string; status: string; approvedAt: string | null }>;
  pendingSourceCount: number;
  trainingStatus: string | null;
  lastRetrained: string | null;
  knowledgeHealthSummary: { approved: number; pending: number; needsReview: number; total: number };
  memoryCount: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const OPS_STATUS: Record<string, { label: string; dot: string; badge: string }> = {
  active:            { label: "Active",             dot: "bg-emerald-400", badge: "bg-emerald-900/30 text-emerald-400" },
  busy:              { label: "Busy",               dot: "bg-cyan-400",    badge: "bg-cyan-900/30 text-cyan-400" },
  idle:              { label: "Idle",               dot: "bg-blue-400",    badge: "bg-blue-900/30 text-blue-400" },
  awaiting_approval: { label: "Awaiting Approval",  dot: "bg-amber-400",   badge: "bg-amber-900/30 text-amber-400" },
  suspended:         { label: "Suspended",          dot: "bg-red-400",     badge: "bg-red-900/30 text-red-400" },
  training_required: { label: "Training Required",  dot: "bg-orange-400",  badge: "bg-orange-900/30 text-orange-400" },
  offline:           { label: "Offline",            dot: "bg-[#64748B]",   badge: "bg-[#1E3A5F] text-[#64748B]" },
};

const TRAINING_STATUS: Record<string, { label: string; cls: string }> = {
  not_started:          { label: "Not Started",          cls: "bg-[#1E3A5F] text-[#64748B]" },
  configuring:          { label: "Configuring",          cls: "bg-blue-900/30 text-blue-400" },
  knowledge_processing: { label: "Processing Knowledge", cls: "bg-purple-900/30 text-purple-400" },
  review_required:      { label: "Review Required",      cls: "bg-amber-900/30 text-amber-400" },
  testing:              { label: "Testing",              cls: "bg-cyan-900/30 text-cyan-400" },
  ready:                { label: "Ready",                cls: "bg-emerald-900/30 text-emerald-400" },
  needs_attention:      { label: "Needs Attention",      cls: "bg-orange-900/30 text-orange-400" },
  suspended:            { label: "Suspended",            cls: "bg-red-900/30 text-red-400" },
};

const WORK_STATUS: Record<string, { label: string; cls: string }> = {
  draft:             { label: "Draft",             cls: "bg-blue-900/30 text-blue-400" },
  awaiting_approval: { label: "Awaiting Approval", cls: "bg-amber-900/30 text-amber-400" },
  approved:          { label: "Approved",          cls: "bg-emerald-900/30 text-emerald-400" },
  rejected:          { label: "Rejected",          cls: "bg-red-900/30 text-red-400" },
  archived:          { label: "Archived",          cls: "bg-[#1E3A5F] text-[#64748B]" },
};

const SEVERITY_COLOURS = {
  critical: { bar: "bg-red-500",    badge: "bg-red-900/30 text-red-400" },
  high:     { bar: "bg-orange-400", badge: "bg-orange-900/30 text-orange-400" },
  medium:   { bar: "bg-amber-400",  badge: "bg-amber-900/30 text-amber-400" },
  low:      { bar: "bg-blue-400",   badge: "bg-blue-900/30 text-blue-400" },
};

const ACTION_CONFIG: Array<{
  key: string;
  label: string;
  description: string;
  danger?: boolean;
  icon: string;
}> = [
  { key: "pause",            label: "Pause",            icon: "⏸",  description: "Temporarily pause this specialist. In-progress work will complete." },
  { key: "resume",           label: "Resume",           icon: "▶",  description: "Resume a paused specialist and return them to active status." },
  { key: "suspend",          label: "Suspend",          icon: "🚫", description: "Suspend this specialist. No new work will be dispatched.", danger: true },
  { key: "enable",           label: "Enable",           icon: "✅", description: "Enable a suspended specialist and restore their operational status." },
  { key: "force_retraining", label: "Force Retraining", icon: "🔄", description: "Flag this specialist for immediate retraining review." },
  { key: "refresh_knowledge",label: "Refresh Knowledge",icon: "📚", description: "Re-index all approved knowledge sources for this specialist." },
];

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function ReadinessRing({ score, size = 64 }: { score: number; size?: number }) {
  const colour = score >= 80 ? "#34D399" : score >= 50 ? "#FBBF24" : "#F87171";
  const r = (size / 2) - 5;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <svg width={size} height={size}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1E3A5F" strokeWidth="4"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={colour} strokeWidth="4"
        strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
        style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%" }}/>
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle"
        fontSize="13" fontWeight="700" fill={colour}>{score}</text>
    </svg>
  );
}

function Checklist({ items }: { items: Array<{ label: string; done: boolean }> }) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2.5">
          <span className={`w-4.5 h-4.5 rounded-full flex items-center justify-center text-xs shrink-0 ${
            item.done ? "bg-emerald-900/40 text-emerald-400" : "bg-[#1E3A5F] text-[#64748B]"
          }`}>
            {item.done ? "✓" : "○"}
          </span>
          <span className={`text-sm ${item.done ? "text-white" : "text-[#64748B]"}`}>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status, map }: { status: string; map: Record<string, { label: string; cls: string }> }) {
  const s = map[status] ?? { label: status, cls: "bg-[#1E3A5F] text-[#64748B]" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = ["Overview", "Readiness", "Workload", "Performance", "Knowledge", "Actions"] as const;
type Tab = (typeof TABS)[number];

// ─── Tab: Overview ────────────────────────────────────────────────────────────

function OverviewTab({ profile, slug }: { profile: SpecialistOpsProfile; slug: string }) {
  const [, setLocation] = useLocation();
  const tr = profile.trainingRecord;
  const oc = profile.orgConfig;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {/* Employee File Summary */}
      <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5">
        <h3 className="text-white font-semibold text-sm mb-4">Employee File</h3>
        <dl className="space-y-3 text-sm">
          <div className="flex items-start justify-between gap-4">
            <dt className="text-[#64748B] shrink-0">Role</dt>
            <dd className="text-white font-medium text-right">{profile.title}</dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="text-[#64748B] shrink-0">Department</dt>
            <dd className="text-white capitalize text-right">{profile.department}</dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="text-[#64748B] shrink-0">Pack</dt>
            <dd className="text-white capitalize text-right">{profile.packCode}</dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="text-[#64748B] shrink-0">DNA Version</dt>
            <dd className="text-[#00D4FF] font-mono text-right">{profile.dnaVersion}</dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="text-[#64748B] shrink-0">Domain</dt>
            <dd className="text-white text-right text-xs leading-relaxed">{profile.domain}</dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="text-[#64748B] shrink-0">Last Activity</dt>
            <dd className="text-white text-right">{profile.lastActivity ? timeAgo(profile.lastActivity) : "—"}</dd>
          </div>
        </dl>
      </div>

      {/* Training readiness checklist */}
      <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5">
        <h3 className="text-white font-semibold text-sm mb-4">Training Readiness</h3>
        {tr ? (
          <Checklist items={[
            { label: "Configuration complete", done: tr.configurationComplete },
            { label: "Approved knowledge sources", done: tr.knowledgeSourcesApproved },
            { label: "Retrieval test passed", done: tr.retrievalTestPassed },
            { label: "Sample task passed", done: tr.sampleTaskPassed },
          ]}/>
        ) : (
          <p className="text-[#64748B] text-sm">Training has not been started for this specialist.</p>
        )}
        {tr?.lastTestedAt && (
          <p className="text-[#64748B] text-xs mt-3">Last tested {timeAgo(tr.lastTestedAt)}</p>
        )}
        {tr?.notes && (
          <div className="mt-3 bg-amber-900/10 border border-amber-900/30 rounded-lg px-3 py-2">
            <p className="text-amber-400 text-xs">{tr.notes}</p>
          </div>
        )}
        <button
          onClick={() => setLocation(`/app/${slug}/workforce/${profile.code}/training`)}
          className="mt-4 w-full text-center text-xs text-[#00D4FF] hover:underline"
        >
          Open Training Page →
        </button>
      </div>

      {/* Organisation config */}
      {oc && (
        <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5">
          <h3 className="text-white font-semibold text-sm mb-4">Organisation Configuration</h3>
          {oc.goals.length > 0 ? (
            <ul className="space-y-1.5 mb-4">
              {oc.goals.map((g, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-[#00D4FF] mt-0.5 shrink-0">•</span>
                  <span className="text-white">{g}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-[#64748B] text-sm mb-4">No goals configured.</p>}
          {oc.preferredStyle && (
            <p className="text-[#64748B] text-xs">Preferred style: <span className="text-white capitalize">{oc.preferredStyle}</span></p>
          )}
          {oc.lastConfirmedAt && (
            <p className="text-[#64748B] text-xs mt-1">Last confirmed {timeAgo(oc.lastConfirmedAt)}</p>
          )}
        </div>
      )}

      {/* Recent Work */}
      <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5">
        <h3 className="text-white font-semibold text-sm mb-4">Recent Completed Work</h3>
        {profile.recentWork.length === 0 ? (
          <p className="text-[#64748B] text-sm">No completed work yet.</p>
        ) : (
          <div className="space-y-2">
            {profile.recentWork.map(w => (
              <button
                key={w.id}
                onClick={() => setLocation(`/app/${slug}/work/${w.id}`)}
                className="w-full text-left flex items-center justify-between gap-3 py-2 border-b border-[#1E3A5F]/50 last:border-0 hover:text-[#00D4FF] transition-colors"
              >
                <span className="text-white text-sm truncate">{w.title}</span>
                <StatusBadge status={w.status} map={WORK_STATUS}/>
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setLocation(`/app/${slug}/work`)}
          className="mt-3 text-xs text-[#00D4FF] hover:underline"
        >
          View all completed work →
        </button>
      </div>

      {/* Navigation links */}
      <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: "📚", label: "Organisation Library", url: `/app/${slug}/library` },
          { icon: "📄", label: "Completed Work",       url: `/app/${slug}/work` },
          { icon: "🧠", label: "Memory",               url: `/app/${slug}/memory` },
          { icon: "🎓", label: "Training",             url: `/app/${slug}/workforce/${profile.code}/training` },
        ].map(link => (
          <button
            key={link.url}
            onClick={() => setLocation(link.url)}
            className="bg-[#0D1B2A] border border-[#1E3A5F] rounded-xl p-3 hover:border-[#00D4FF]/40 transition-all text-left flex items-center gap-2"
          >
            <span className="text-lg">{link.icon}</span>
            <span className="text-[#94A3B8] text-xs">{link.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Tab: Readiness ───────────────────────────────────────────────────────────

function ReadinessTab({ readiness, slug }: { readiness: SpecialistReadiness; slug: string }) {
  const [, setLocation] = useLocation();
  return (
    <div className="space-y-4">
      <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5 flex items-center gap-6">
        <ReadinessRing score={readiness.readinessScore} size={72}/>
        <div>
          <p className="text-white text-lg font-semibold mb-1">
            {readiness.isReady ? "Ready for Work" : "Not Ready"}
          </p>
          <p className="text-[#64748B] text-sm">
            {readiness.blockers.length === 0
              ? "This specialist has no readiness blockers."
              : `${readiness.blockers.length} blocker${readiness.blockers.length > 1 ? "s" : ""} identified.`}
          </p>
          {readiness.lastReviewed && (
            <p className="text-[#64748B] text-xs mt-1">Last reviewed {timeAgo(readiness.lastReviewed)}</p>
          )}
        </div>
      </div>

      {readiness.blockers.length > 0 ? (
        <div className="space-y-3">
          {readiness.blockers.map(blocker => {
            const s = SEVERITY_COLOURS[blocker.severity];
            return (
              <div key={blocker.code} className="relative overflow-hidden bg-[#112033] border border-[#1E3A5F] rounded-xl p-4">
                <div className={`absolute left-0 top-0 bottom-0 w-1 ${s.bar}`}/>
                <div className="pl-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${s.badge}`}>
                      {blocker.severity.toUpperCase()}
                    </span>
                    <span className="text-white font-medium text-sm">{blocker.code.replace(/_/g, " ")}</span>
                  </div>
                  <p className="text-[#94A3B8] text-sm mb-2">{blocker.reason}</p>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[#64748B] text-xs italic">{blocker.recommendedAction}</p>
                    <button
                      onClick={() => setLocation(blocker.resolveUrl)}
                      className="shrink-0 text-xs text-[#00D4FF] hover:underline"
                    >
                      Resolve →
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-[#112033] border border-emerald-900/30 rounded-xl p-6 text-center">
          <p className="text-emerald-400 font-semibold mb-1">No blockers</p>
          <p className="text-[#64748B] text-sm">This specialist meets all readiness requirements.</p>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Workload ────────────────────────────────────────────────────────────

function WorkloadTab({ workload, slug }: { workload: WorkloadQueue; slug: string }) {
  const [, setLocation] = useLocation();
  const RUN_STATUS: Record<string, { label: string; cls: string }> = {
    created:   { label: "Created",   cls: "bg-[#1E3A5F] text-[#94A3B8]" },
    running:   { label: "Running",   cls: "bg-cyan-900/30 text-cyan-400" },
    claimed:   { label: "Claimed",   cls: "bg-blue-900/30 text-blue-400" },
    completed: { label: "Completed", cls: "bg-emerald-900/30 text-emerald-400" },
    failed:    { label: "Failed",    cls: "bg-red-900/30 text-red-400" },
    cancelled: { label: "Cancelled", cls: "bg-[#1E3A5F] text-[#64748B]" },
  };

  return (
    <div className="space-y-5">
      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4">
          <p className="text-[#64748B] text-xs mb-1">Active Runs</p>
          <p className="text-2xl font-bold text-cyan-400">{workload.activeRuns.length}</p>
        </div>
        <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4">
          <p className="text-[#64748B] text-xs mb-1">Waiting</p>
          <p className="text-2xl font-bold text-blue-400">{workload.queueLength}</p>
        </div>
        <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4">
          <p className="text-[#64748B] text-xs mb-1">Total Retries</p>
          <p className={`text-2xl font-bold ${workload.totalRetries > 0 ? "text-amber-400" : "text-white"}`}>{workload.totalRetries}</p>
        </div>
      </div>

      {/* Active Runs */}
      <div>
        <h3 className="text-[#94A3B8] text-xs uppercase tracking-wide mb-2">Active Executions</h3>
        {workload.activeRuns.length === 0 ? (
          <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4 text-center">
            <p className="text-[#64748B] text-sm">No active executions.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {workload.activeRuns.map(run => (
              <div key={run.id} className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-white text-sm font-medium truncate">Task {run.taskId.slice(-8)}</p>
                  {run.startedAt && <p className="text-[#64748B] text-xs">Started {timeAgo(run.startedAt)}</p>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {run.confidence && (
                    <span className="text-[#94A3B8] text-xs">{Math.round(parseFloat(run.confidence) * 100)}% conf.</span>
                  )}
                  <StatusBadge status={run.status} map={RUN_STATUS}/>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Waiting Queue */}
      <div>
        <h3 className="text-[#94A3B8] text-xs uppercase tracking-wide mb-2">Waiting Queue</h3>
        {workload.waitingQueue.length === 0 ? (
          <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4 text-center">
            <p className="text-[#64748B] text-sm">Queue is empty.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {workload.waitingQueue.map(item => (
              <div key={item.id} className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-white text-sm font-medium truncate">Run {item.runId.slice(-8)}</p>
                  <p className="text-[#64748B] text-xs">Queued {timeAgo(item.queuedAt)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[#64748B] text-xs">P{item.priority}</span>
                  <StatusBadge status={item.status} map={{ waiting: { label: "Waiting", cls: "bg-blue-900/30 text-blue-400" }, blocked: { label: "Blocked", cls: "bg-amber-900/30 text-amber-400" } }}/>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Failed Runs */}
      {workload.failedRuns.length > 0 && (
        <div>
          <h3 className="text-[#94A3B8] text-xs uppercase tracking-wide mb-2">Recent Failures</h3>
          <div className="space-y-2">
            {workload.failedRuns.map(run => (
              <div key={run.id} className="bg-[#112033] border border-red-900/30 rounded-xl p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">Task {run.taskId.slice(-8)}</p>
                    {run.lastError && <p className="text-red-400 text-xs mt-0.5 truncate">{run.lastError}</p>}
                  </div>
                  {run.failedAt && <p className="text-[#64748B] text-xs shrink-0">{timeAgo(run.failedAt)}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Performance ─────────────────────────────────────────────────────────

function PerformanceTab({
  performance,
  period,
  onPeriodChange,
}: {
  performance: SpecialistPerformance;
  period: 7 | 30 | 90;
  onPeriodChange: (p: 7 | 30 | 90) => void;
}) {
  const metrics = [
    { label: "Work Completed",       value: performance.workCompleted,                   unit: "",   colour: "text-white" },
    { label: "Approval Rate",        value: performance.approvalRate,                    unit: "%",  colour: "text-emerald-400" },
    { label: "Rejection Rate",       value: performance.rejectionRate,                   unit: "%",  colour: performance.rejectionRate && performance.rejectionRate > 20 ? "text-red-400" : "text-white" },
    { label: "Avg Self-Review Score",value: performance.averageSelfReviewScore,          unit: "/100", colour: "text-[#00D4FF]" },
    { label: "Avg Confidence",       value: performance.averageConfidence,               unit: "%",  colour: "text-cyan-400" },
    { label: "Avg Turnaround",       value: performance.averageTurnaroundHours,          unit: "h",  colour: "text-blue-400" },
  ];

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="flex items-center gap-2">
        <span className="text-[#64748B] text-xs mr-1">Period:</span>
        {([7, 30, 90] as const).map(p => (
          <button
            key={p}
            onClick={() => onPeriodChange(p)}
            className={`text-xs px-3 py-1 rounded-full transition-colors ${
              period === p
                ? "bg-[#00D4FF]/20 text-[#00D4FF] border border-[#00D4FF]/40"
                : "text-[#64748B] hover:text-white border border-[#1E3A5F]"
            }`}
          >
            {p} days
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {metrics.map(m => (
          <div key={m.label} className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4">
            <p className="text-[#64748B] text-xs mb-1">{m.label}</p>
            <p className={`text-2xl font-bold ${m.colour}`}>
              {m.value != null ? `${m.value}${m.unit}` : "—"}
            </p>
          </div>
        ))}
      </div>

      {performance.workCompleted === 0 && (
        <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-6 text-center">
          <p className="text-[#64748B] text-sm">No completed work in the selected period.</p>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Knowledge ───────────────────────────────────────────────────────────

function KnowledgeTab({ knowledge, slug }: { knowledge: SpecialistKnowledge; slug: string }) {
  const [, setLocation] = useLocation();
  const SOURCE_STATUS: Record<string, { label: string; cls: string }> = {
    approved:      { label: "Approved",       cls: "bg-emerald-900/30 text-emerald-400" },
    pending_review:{ label: "Pending Review", cls: "bg-amber-900/30 text-amber-400" },
    needs_review:  { label: "Needs Review",   cls: "bg-orange-900/30 text-orange-400" },
    processing:    { label: "Processing",     cls: "bg-blue-900/30 text-blue-400" },
    draft:         { label: "Draft",          cls: "bg-[#1E3A5F] text-[#64748B]" },
  };

  const { approved, pending, needsReview, total } = knowledge.knowledgeHealthSummary;

  return (
    <div className="space-y-5">
      {/* Health summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4">
          <p className="text-[#64748B] text-xs mb-1">Total Sources</p>
          <p className="text-2xl font-bold text-white">{total}</p>
        </div>
        <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4">
          <p className="text-[#64748B] text-xs mb-1">Approved</p>
          <p className="text-2xl font-bold text-emerald-400">{approved}</p>
        </div>
        <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4">
          <p className="text-[#64748B] text-xs mb-1">Pending Review</p>
          <p className={`text-2xl font-bold ${pending > 0 ? "text-amber-400" : "text-white"}`}>{pending}</p>
        </div>
        <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4">
          <p className="text-[#64748B] text-xs mb-1">Needs Review</p>
          <p className={`text-2xl font-bold ${needsReview > 0 ? "text-orange-400" : "text-white"}`}>{needsReview}</p>
        </div>
      </div>

      {/* Training status */}
      <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-[#64748B] text-xs mb-1">Training Status</p>
          <StatusBadge status={knowledge.trainingStatus ?? "not_started"} map={TRAINING_STATUS}/>
          {knowledge.lastRetrained && (
            <p className="text-[#64748B] text-xs mt-1">Last retrained {timeAgo(knowledge.lastRetrained)}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-[#64748B] text-xs mb-1">Org Memory Usage</p>
          <p className="text-white font-semibold">{knowledge.memoryCount} entries</p>
        </div>
      </div>

      {/* Source list */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[#94A3B8] text-xs uppercase tracking-wide">Knowledge Sources</h3>
          <button onClick={() => setLocation(`/app/${slug}/library`)}
            className="text-xs text-[#00D4FF] hover:underline">
            Manage Library →
          </button>
        </div>
        {knowledge.assignedSources.length === 0 ? (
          <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-6 text-center">
            <p className="text-[#64748B] text-sm">No knowledge sources found.</p>
            <button onClick={() => setLocation(`/app/${slug}/library`)}
              className="mt-2 text-xs text-[#00D4FF] hover:underline">
              Upload documents →
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {knowledge.assignedSources.map(s => (
              <button
                key={s.id}
                onClick={() => setLocation(`/app/${slug}/library/${s.id}`)}
                className="w-full text-left bg-[#112033] border border-[#1E3A5F] rounded-xl p-3 hover:border-[#00D4FF]/40 transition-all flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-white text-sm truncate">{s.title}</p>
                  <p className="text-[#64748B] text-xs capitalize">{s.sourceType.replace(/_/g, " ")}</p>
                </div>
                <StatusBadge status={s.status} map={SOURCE_STATUS}/>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Quick links */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setLocation(`/app/${slug}/library`)}
          className="text-xs text-[#64748B] hover:text-[#00D4FF] border border-[#1E3A5F] rounded-full px-3 py-1 transition-colors">
          📚 Organisation Library
        </button>
        <button onClick={() => setLocation(`/app/${slug}/governance/knowledge-health`)}
          className="text-xs text-[#64748B] hover:text-[#00D4FF] border border-[#1E3A5F] rounded-full px-3 py-1 transition-colors">
          ❤️ Knowledge Health
        </button>
        <button onClick={() => setLocation(`/app/${slug}/governance`)}
          className="text-xs text-[#64748B] hover:text-[#00D4FF] border border-[#1E3A5F] rounded-full px-3 py-1 transition-colors">
          🏛 Governance Centre
        </button>
      </div>
    </div>
  );
}

// ─── Tab: Actions ─────────────────────────────────────────────────────────────

function ActionsTab({
  specialistCode,
  specialistTitle,
  slug,
}: {
  specialistCode: string;
  specialistTitle: string;
  slug: string;
}) {
  const apiFetch = useAuthFetch();
  const qc = useQueryClient();
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (action: string) => {
      const r = await apiFetch(
        `/v1/organisations/${slug}/workforce-ops/${specialistCode}/actions`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) },
      );
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err?.error?.message ?? "Action failed.");
      }
      return r.json();
    },
    onSuccess: (data) => {
      setResult(data.message);
      setConfirmAction(null);
      qc.invalidateQueries({ queryKey: ["workforce-ops-specialist", slug, specialistCode] });
      qc.invalidateQueries({ queryKey: ["workforce-ops-readiness", slug, specialistCode] });
      qc.invalidateQueries({ queryKey: ["workforce-ops-summary", slug] });
    },
    onError: (err: Error) => {
      setResult(`Error: ${err.message}`);
      setConfirmAction(null);
    },
  });

  return (
    <div className="space-y-4">
      {result && (
        <div className={`border rounded-xl p-4 text-sm ${
          result.startsWith("Error:")
            ? "bg-red-900/20 border-red-900/40 text-red-400"
            : "bg-emerald-900/20 border-emerald-900/40 text-emerald-400"
        }`}>
          {result}
          <button onClick={() => setResult(null)} className="ml-3 text-xs opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      <p className="text-[#64748B] text-sm">
        All management actions require confirmation and are recorded in the audit log.
        Actions are performed on <span className="text-white font-medium">{specialistTitle}</span>.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {ACTION_CONFIG.map(action => (
          confirmAction === action.key ? (
            <div key={action.key} className={`bg-[#112033] border rounded-xl p-4 ${action.danger ? "border-red-900/40" : "border-[#00D4FF]/40"}`}>
              <p className="text-white font-semibold text-sm mb-1">{action.icon} Confirm: {action.label}</p>
              <p className="text-[#94A3B8] text-xs mb-4">{action.description}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => mutation.mutate(action.key)}
                  disabled={mutation.isPending}
                  className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    action.danger
                      ? "bg-red-900/40 text-red-400 hover:bg-red-900/60"
                      : "bg-[#00D4FF]/20 text-[#00D4FF] hover:bg-[#00D4FF]/30"
                  }`}
                >
                  {mutation.isPending ? "Processing…" : "Confirm"}
                </button>
                <button
                  onClick={() => setConfirmAction(null)}
                  className="flex-1 py-1.5 rounded-lg text-sm text-[#64748B] hover:text-white border border-[#1E3A5F] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              key={action.key}
              onClick={() => setConfirmAction(action.key)}
              className={`text-left bg-[#112033] border border-[#1E3A5F] rounded-xl p-4 hover:border-[#00D4FF]/40 transition-all ${
                action.danger ? "hover:border-red-900/40" : ""
              }`}
            >
              <p className="text-white font-medium text-sm mb-1">{action.icon} {action.label}</p>
              <p className="text-[#64748B] text-xs leading-relaxed">{action.description}</p>
            </button>
          )
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WorkforceSpecialistDetail() {
  const { slug, specialistId } = useParams<{ slug: string; specialistId: string }>();
  const [, setLocation] = useLocation();
  const apiFetch = useAuthFetch();
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [perfPeriod, setPerfPeriod] = useState<7 | 30 | 90>(30);

  const BASE = `/v1/organisations/${slug}/workforce-ops/${specialistId}`;

  const { data: profile, isLoading: profileLoading } = useQuery<SpecialistOpsProfile>({
    queryKey: ["workforce-ops-specialist", slug, specialistId],
    queryFn: () => apiFetch(`${BASE}/profile`).then(r => r.json()),
    enabled: !!slug && !!specialistId,
  });

  const { data: readiness } = useQuery<SpecialistReadiness>({
    queryKey: ["workforce-ops-readiness", slug, specialistId],
    queryFn: () => apiFetch(`${BASE}/readiness`).then(r => r.json()),
    enabled: activeTab === "Readiness" && !!slug && !!specialistId,
  });

  const { data: workload } = useQuery<WorkloadQueue>({
    queryKey: ["workforce-ops-workload", slug, specialistId],
    queryFn: () => apiFetch(`${BASE}/workload`).then(r => r.json()),
    enabled: activeTab === "Workload" && !!slug && !!specialistId,
    refetchInterval: 15_000,
  });

  const { data: performance } = useQuery<SpecialistPerformance>({
    queryKey: ["workforce-ops-performance", slug, specialistId, perfPeriod],
    queryFn: () => apiFetch(`${BASE}/performance?period=${perfPeriod}`).then(r => r.json()),
    enabled: activeTab === "Performance" && !!slug && !!specialistId,
  });

  const { data: knowledge } = useQuery<SpecialistKnowledge>({
    queryKey: ["workforce-ops-knowledge", slug, specialistId],
    queryFn: () => apiFetch(`${BASE}/knowledge`).then(r => r.json()),
    enabled: activeTab === "Knowledge" && !!slug && !!specialistId,
  });

  if (profileLoading) {
    return (
      <AppShell orgSlug={slug!}>
        <div className="flex items-center justify-center h-64">
          <div className="text-[#64748B] text-sm">Loading specialist profile…</div>
        </div>
      </AppShell>
    );
  }

  if (!profile) {
    return (
      <AppShell orgSlug={slug!}>
        <div className="text-center py-16">
          <p className="text-[#64748B]">Specialist not found.</p>
          <button onClick={() => setLocation(`/app/${slug}/workforce-ops`)}
            className="mt-4 text-[#00D4FF] text-sm hover:underline">
            ← Back to Operations Centre
          </button>
        </div>
      </AppShell>
    );
  }

  const opsStatus = OPS_STATUS[profile.operationalStatus] ?? OPS_STATUS.offline!;

  return (
    <AppShell orgSlug={slug!}>
      {/* ── Header ── */}
      <div className="mb-6">
        <button
          onClick={() => setLocation(`/app/${slug}/workforce-ops`)}
          className="text-[#64748B] text-xs hover:text-[#00D4FF] transition-colors mb-3 flex items-center gap-1"
        >
          ← Workforce Operations
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white mb-0.5">{profile.title}</h1>
            <p className="text-[#64748B] text-sm">{profile.descriptor}</p>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${opsStatus.dot}`}/>
              <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${opsStatus.badge}`}>
                {opsStatus.label}
              </span>
            </span>
            <span className="text-[#64748B] text-xs font-mono">DNA v{profile.dnaVersion}</span>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex items-center gap-0.5 mb-6 border-b border-[#1E3A5F] overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? "border-[#00D4FF] text-[#00D4FF]"
                : "border-transparent text-[#64748B] hover:text-[#94A3B8]"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      {activeTab === "Overview" && (
        <OverviewTab profile={profile} slug={slug!}/>
      )}
      {activeTab === "Readiness" && (
        readiness
          ? <ReadinessTab readiness={readiness} slug={slug!}/>
          : <div className="flex items-center justify-center h-32"><p className="text-[#64748B] text-sm">Loading readiness analysis…</p></div>
      )}
      {activeTab === "Workload" && (
        workload
          ? <WorkloadTab workload={workload} slug={slug!}/>
          : <div className="flex items-center justify-center h-32"><p className="text-[#64748B] text-sm">Loading workload data…</p></div>
      )}
      {activeTab === "Performance" && (
        performance
          ? <PerformanceTab performance={performance} period={perfPeriod} onPeriodChange={setPerfPeriod}/>
          : <div className="flex items-center justify-center h-32"><p className="text-[#64748B] text-sm">Loading performance data…</p></div>
      )}
      {activeTab === "Knowledge" && (
        knowledge
          ? <KnowledgeTab knowledge={knowledge} slug={slug!}/>
          : <div className="flex items-center justify-center h-32"><p className="text-[#64748B] text-sm">Loading knowledge data…</p></div>
      )}
      {activeTab === "Actions" && (
        <ActionsTab
          specialistCode={profile.code}
          specialistTitle={profile.title}
          slug={slug!}
        />
      )}
    </AppShell>
  );
}
