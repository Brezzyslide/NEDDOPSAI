/**
 * Knowledge Health Dashboard — /app/:slug/governance/knowledge-health
 *
 * Sprint 24. Frontend for the existing KnowledgeHealthService.
 *
 * KnowledgeHealthMetrics shape:
 *   librarySourceCount, approvedSourceCount, processingSourceCount, reviewRequiredCount,
 *   approvedMemoryCount, pendingProposals, conflictingKnowledge, duplicateKnowledge,
 *   obsoleteKnowledge, specialistCoverage, specialistsNeedingRetraining,
 *   recentlyChangedPolicies, recentlyApprovedKnowledge, failedCurationJobs,
 *   healthScore, computedAt
 */

import { useState }               from "react";
import { useParams, useLocation } from "wouter";
import { useQuery }               from "@tanstack/react-query";
import { Show }                   from "@clerk/react";
import { Redirect }               from "wouter";
import AppShell                   from "@/components/layout/AppShell";
import { useAuthFetch }           from "@/lib/api";

// ─── Components ───────────────────────────────────────────────────────────────

function MetricCard({
  icon, label, value, unit, subtext, accent, onClick,
}: {
  icon: string; label: string; value: number | string;
  unit?: string; subtext?: string; accent?: string; onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`bg-[#112033] border border-[#1E3A5F] rounded-xl p-5 ${onClick ? "cursor-pointer hover:border-[#00D4FF]/40 transition-colors" : ""}`}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-xl">{icon}</span>
        {subtext && <span className="text-[#64748B] text-xs">{subtext}</span>}
      </div>
      <p className={`text-2xl font-bold mb-1 ${accent ?? "text-[#E2E8F0]"}`}>
        {value}{unit}
      </p>
      <p className="text-[#64748B] text-xs">{label}</p>
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const colour = score >= 80 ? "#34D399" : score >= 60 ? "#FBBF24" : "#F87171";
  const ring   = score >= 80 ? "ring-emerald-400/20" : score >= 60 ? "ring-amber-400/20" : "ring-red-400/20";
  const deg    = Math.round((score / 100) * 360);
  return (
    <div className={`relative h-32 w-32 rounded-full ring-4 ${ring} flex items-center justify-center shrink-0`}
         style={{ background: `conic-gradient(${colour} ${deg}deg, #1E3A5F ${deg}deg)` }}>
      <div className="h-24 w-24 rounded-full bg-[#0B1829] flex flex-col items-center justify-center">
        <span className="text-3xl font-bold" style={{ color: colour }}>{score}</span>
        <span className="text-[#64748B] text-xs">/ 100</span>
      </div>
    </div>
  );
}

function ProgressBar({ value, max, inverse }: { value: number; max: number; inverse?: boolean }) {
  const pct  = Math.min(100, max > 0 ? Math.round((value / max) * 100) : 0);
  const disp = inverse ? Math.max(0, 100 - pct) : pct;
  const cls  = disp >= 70 ? "bg-emerald-400" : disp >= 40 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="h-2 bg-[#1E3A5F] rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${cls} transition-all`} style={{ width: `${disp}%` }} />
    </div>
  );
}

function DetailRow({ label, value, good, warn }: { label: string; value: string; good?: boolean; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-[#1E3A5F] last:border-0">
      <span className="text-[#94A3B8] text-sm">{label}</span>
      <span className={`text-sm font-medium ${good ? "text-emerald-400" : warn ? "text-amber-400" : "text-[#E2E8F0]"}`}>
        {value}
      </span>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function KnowledgeHealthPage() {
  const { slug }        = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const apiFetch        = useAuthFetch();
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["knowledge-health-detail", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/knowledge/health`).then(r => r.json()),
    enabled: !!slug, staleTime: 120_000,
  });

  const m = data as Record<string, any> | undefined;

  const score                  = m?.healthScore ?? 0;
  const libraryTotal           = m?.librarySourceCount ?? 0;
  const approved               = m?.approvedSourceCount ?? 0;
  const processing             = m?.processingSourceCount ?? 0;
  const reviewRequired         = m?.reviewRequiredCount ?? 0;
  const approvedMemory         = m?.approvedMemoryCount ?? 0;
  const pendingProposals       = m?.pendingProposals ?? 0;
  const conflicting            = m?.conflictingKnowledge ?? 0;
  const duplicate              = m?.duplicateKnowledge ?? 0;
  const obsolete               = m?.obsoleteKnowledge ?? 0;
  const specialistCoverage     = m?.specialistCoverage ?? 0;
  const retraining             = (m?.specialistsNeedingRetraining ?? []) as string[];
  const changedPolicies        = m?.recentlyChangedPolicies ?? 0;
  const recentApprovals        = m?.recentlyApprovedKnowledge ?? 0;
  const failedJobs             = m?.failedCurationJobs ?? 0;
  const coveragePct            = libraryTotal > 0 ? Math.round((approved / libraryTotal) * 100) : 100;
  const computedAt             = m?.computedAt ? new Date(m.computedAt).toLocaleString("en-AU") : "—";

  const toggle = (key: string) => setExpanded(e => e === key ? null : key);

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <AppShell orgSlug={slug ?? ""}>
        <div className="p-8 max-w-5xl mx-auto">

          {/* Header */}
          <div className="flex items-start justify-between mb-7">
            <div>
              <button onClick={() => setLocation(`/app/${slug}/governance`)} className="text-[#64748B] text-xs hover:text-[#E2E8F0] mb-2 block">← Governance Centre</button>
              <h1 className="text-2xl font-bold text-[#E2E8F0]">Knowledge Health</h1>
              <p className="text-[#64748B] text-sm mt-1">
                {isLoading ? "Loading…" : `Last computed ${computedAt}`}
              </p>
            </div>
            <button
              onClick={() => refetch()}
              className="px-4 py-2 bg-[#112033] border border-[#1E3A5F] text-[#64748B] text-sm rounded-lg hover:text-[#E2E8F0] transition-colors"
            >
              Refresh
            </button>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1,2,3,4].map(i => <div key={i} className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5 animate-pulse h-28" />)}
            </div>
          ) : (
            <>
              {/* Overall score */}
              <div className="bg-[#112033] border border-[#1E3A5F] rounded-2xl p-6 mb-6 flex flex-col sm:flex-row items-center gap-6">
                <ScoreRing score={score} />
                <div className="flex-1">
                  <p className="text-[#E2E8F0] font-bold text-lg mb-1">
                    {score >= 80 ? "Healthy" : score >= 60 ? "Needs Attention" : "Requires Action"}
                  </p>
                  <p className="text-[#64748B] text-sm mb-4">
                    Your organisation's knowledge base is in {score >= 80 ? "good" : score >= 60 ? "fair" : "poor"} condition.
                    {retraining.length > 0 && ` ${retraining.length} specialist${retraining.length > 1 ? "s" : ""} may benefit from retraining.`}
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    <div><p className="text-[#64748B] text-xs mb-1">Coverage</p><ProgressBar value={coveragePct} max={100} /></div>
                    <div><p className="text-[#64748B] text-xs mb-1">Specialist readiness</p><ProgressBar value={specialistCoverage} max={100} /></div>
                    <div><p className="text-[#64748B] text-xs mb-1">Issues</p><ProgressBar value={conflicting + duplicate + obsolete} max={10} inverse /></div>
                  </div>
                </div>
              </div>

              {/* Metric cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                <MetricCard icon="📚" label="Library documents" value={libraryTotal}
                  subtext={`${approved} approved`} />
                <MetricCard icon="💡" label="Memory entries" value={approvedMemory}
                  subtext={`${pendingProposals} pending`}
                  accent={pendingProposals > 0 ? "text-amber-400" : undefined} />
                <MetricCard icon="🔍" label="Pending review" value={reviewRequired}
                  accent={reviewRequired > 0 ? "text-amber-400" : "text-[#E2E8F0]"}
                  onClick={() => setLocation(`/app/${slug}/library`)} />
                <MetricCard icon="❤️" label="Knowledge score" value={score} unit="%"
                  accent={score >= 80 ? "text-emerald-400" : score >= 60 ? "text-amber-400" : "text-red-400"} />
              </div>

              {/* Expandable sections */}
              <div className="space-y-3">

                {/* Issues */}
                <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl overflow-hidden">
                  <button onClick={() => toggle("issues")}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#1E3A5F]/20 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">⚠️</span>
                      <div className="text-left">
                        <p className="text-[#E2E8F0] text-sm font-medium">Knowledge Issues</p>
                        <p className="text-[#64748B] text-xs">{conflicting + duplicate + obsolete} total issues detected</p>
                      </div>
                    </div>
                    <span className="text-[#64748B] text-sm">{expanded === "issues" ? "▲" : "▼"}</span>
                  </button>
                  {expanded === "issues" && (
                    <div className="px-5 pb-5 border-t border-[#1E3A5F]">
                      <div className="mt-4">
                        <DetailRow label="Conflicting entries" value={String(conflicting)}
                          warn={conflicting > 0} good={conflicting === 0} />
                        <DetailRow label="Duplicate entries" value={String(duplicate)}
                          warn={duplicate > 0} good={duplicate === 0} />
                        <DetailRow label="Obsolete entries" value={String(obsolete)}
                          warn={obsolete > 0} good={obsolete === 0} />
                        <DetailRow label="Failed curation jobs" value={String(failedJobs)}
                          warn={failedJobs > 0} good={failedJobs === 0} />
                      </div>
                      {(conflicting + duplicate + obsolete) > 0 && (
                        <button onClick={() => setLocation(`/app/${slug}/approvals`)}
                          className="mt-4 px-4 py-2 bg-[#00D4FF]/10 border border-[#00D4FF]/30 text-[#00D4FF] text-xs rounded-lg hover:bg-[#00D4FF]/20 transition-colors">
                          Review in Approval Centre →
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Proposals */}
                <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl overflow-hidden">
                  <button onClick={() => toggle("proposals")}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#1E3A5F]/20 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">📝</span>
                      <div className="text-left">
                        <p className="text-[#E2E8F0] text-sm font-medium">Proposals & Changes</p>
                        <p className="text-[#64748B] text-xs">{pendingProposals} pending · {recentApprovals} recently approved · {changedPolicies} policy changes</p>
                      </div>
                    </div>
                    <span className="text-[#64748B] text-sm">{expanded === "proposals" ? "▲" : "▼"}</span>
                  </button>
                  {expanded === "proposals" && (
                    <div className="px-5 pb-5 border-t border-[#1E3A5F]">
                      <div className="mt-4">
                        <DetailRow label="Pending proposals" value={String(pendingProposals)}
                          warn={pendingProposals > 0} good={pendingProposals === 0} />
                        <DetailRow label="Recently approved knowledge" value={String(recentApprovals)} good={recentApprovals > 0} />
                        <DetailRow label="Recently changed policies" value={String(changedPolicies)} />
                        <DetailRow label="Approved documents" value={`${approved} / ${libraryTotal}`} good={libraryTotal > 0 && approved === libraryTotal} />
                        <DetailRow label="Awaiting processing" value={String(processing)} />
                        <DetailRow label="Flagged for review" value={String(reviewRequired)} warn={reviewRequired > 0} good={reviewRequired === 0} />
                      </div>
                      {pendingProposals > 0 && (
                        <button onClick={() => setLocation(`/app/${slug}/approvals`)}
                          className="mt-4 px-4 py-2 bg-[#00D4FF]/10 border border-[#00D4FF]/30 text-[#00D4FF] text-xs rounded-lg hover:bg-[#00D4FF]/20 transition-colors">
                          Review {pendingProposals} proposal{pendingProposals > 1 ? "s" : ""} →
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Specialist coverage */}
                <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl overflow-hidden">
                  <button onClick={() => toggle("specialists")}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#1E3A5F]/20 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">🤖</span>
                      <div className="text-left">
                        <p className="text-[#E2E8F0] text-sm font-medium">Specialist Coverage</p>
                        <p className="text-[#64748B] text-xs">{specialistCoverage}% coverage · {retraining.length} needing retraining</p>
                      </div>
                    </div>
                    <span className="text-[#64748B] text-sm">{expanded === "specialists" ? "▲" : "▼"}</span>
                  </button>
                  {expanded === "specialists" && (
                    <div className="px-5 pb-5 border-t border-[#1E3A5F]">
                      <div className="mt-4">
                        <DetailRow label="Knowledge coverage" value={`${specialistCoverage}%`}
                          good={specialistCoverage >= 80} warn={specialistCoverage >= 50 && specialistCoverage < 80} />
                        <DetailRow label="Specialists needing retraining" value={String(retraining.length)}
                          warn={retraining.length > 0} good={retraining.length === 0} />
                      </div>
                      {retraining.length > 0 && (
                        <div className="mt-4 space-y-2">
                          <p className="text-[#64748B] text-xs uppercase tracking-widest font-semibold">Retraining recommended for:</p>
                          {retraining.map((s: string) => (
                            <div key={s} className="flex items-center gap-2 px-3 py-2 bg-amber-900/20 border border-amber-900/40 rounded-lg">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                              <span className="text-amber-300 text-xs capitalize">{s.replace(/_/g, " ")}</span>
                            </div>
                          ))}
                          <button onClick={() => setLocation(`/app/${slug}/workforce`)}
                            className="mt-2 px-4 py-2 bg-[#00D4FF]/10 border border-[#00D4FF]/30 text-[#00D4FF] text-xs rounded-lg hover:bg-[#00D4FF]/20 transition-colors">
                            Go to Specialist Training →
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

              </div>
            </>
          )}
        </div>
      </AppShell>
    </>
  );
}
