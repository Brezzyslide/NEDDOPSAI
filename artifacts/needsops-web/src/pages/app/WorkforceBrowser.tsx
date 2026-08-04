/**
 * WorkforceBrowser — legacy pack-based workforce browser.
 * Task #41: Updated to use SpecialistDisplayState for distinct badges.
 */

import React from "react";
import { useListWorkforcePacks } from "@workspace/api-client-react";
import { Box, CheckCircle2, ChevronRight, Cpu, Layers, Lock, Clock, FlaskConical, AlertCircle } from "lucide-react";
import {
  getSpecialistDisplayState,
  DISPLAY_STATE_META,
  type SpecialistDisplayState,
} from "@/lib/specialistDisplayState";

// ─── Worker status badge using the canonical display state ────────────────────

interface WorkerStatusIconProps { state: SpecialistDisplayState }
function WorkerStatusIcon({ state }: WorkerStatusIconProps) {
  switch (state) {
    case "active":              return <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />;
    case "coming_soon":         return <Clock className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />;
    case "dna_pending":         return <FlaskConical className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />;
    case "archived":
    case "deprecated":
    case "unavailable_for_plan": return <Lock className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" />;
    default:                    return <AlertCircle className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />;
  }
}

// ─── Tier colour ──────────────────────────────────────────────────────────────

const getTierColor = (tier: string) => {
  switch (tier) {
    case "enterprise":    return "text-[#b975f8] border-[#b975f8]/30 bg-[#b975f8]/10";
    case "professional":  return "text-[#3b82f6] border-[#3b82f6]/30 bg-[#3b82f6]/10";
    case "starter":       return "text-[#94a3b8] border-[#94a3b8]/30 bg-[#94a3b8]/10";
    default:              return "text-muted-foreground border-border bg-transparent";
  }
};

// ─── Pack status badge ────────────────────────────────────────────────────────

function PackStatusBadge({ status }: { status: string }) {
  const state = getSpecialistDisplayState({
    executionStatus: status,
    comingSoon: status === "coming_soon",
  });
  const meta = DISPLAY_STATE_META[state];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

// ─── Main browser ─────────────────────────────────────────────────────────────

export function WorkforceBrowser() {
  const { data, isLoading } = useListWorkforcePacks();

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b border-border pb-6 animate-in fade-in">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3 mb-2">
            <Layers className="w-8 h-8 text-primary" />
            Workforce Packs
          </h1>
          <p className="text-muted-foreground">Specialized AI worker configurations ready for tenant deployment.</p>
        </div>
        <div className="flex gap-2">
          <select className="bg-card border border-border text-sm rounded-sm px-3 py-2 text-foreground focus:outline-none focus:border-primary/50 font-mono">
            <option value="all">ALL INDUSTRIES</option>
            <option value="ndis">NDIS PROVIDERS</option>
            <option value="finance">FINANCIAL SERVICES</option>
          </select>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="font-medium uppercase tracking-wide">Status:</span>
        {(["active", "coming_soon", "dna_pending", "unavailable_for_plan"] as SpecialistDisplayState[]).map(s => (
          <span key={s} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${DISPLAY_STATE_META[s].cls}`}>
            {DISPLAY_STATE_META[s].label}
          </span>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-card border border-border rounded-md h-80 animate-pulse bg-background/50" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {data?.items?.map((pack, index) => {
            const packState = getSpecialistDisplayState({
              executionStatus: pack.status,
              comingSoon: pack.status === "coming_soon",
            });
            const canDeploy = packState === "active";

            return (
              <div
                key={pack.id}
                className="bg-card border border-border rounded-md overflow-hidden group hover:border-primary/40 transition-all duration-300 flex flex-col relative animate-in fade-in slide-in-from-bottom-4"
                style={{ animationDelay: `${index * 100}ms` }}
              >
                {/* Subtle background glow effect on hover */}
                <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

                <div className="p-6 border-b border-border relative z-10">
                  <div className="flex justify-between items-start mb-4">
                    <div className="w-12 h-12 rounded bg-secondary flex items-center justify-center border border-border text-primary group-hover:shadow-[0_0_15px_rgba(0,240,255,0.2)] transition-all">
                      <Cpu className="w-6 h-6" />
                    </div>
                    <div className="flex items-center gap-2">
                      <PackStatusBadge status={pack.status} />
                      <span className={`px-2 py-0.5 text-[10px] uppercase tracking-wider font-mono border rounded-sm ${getTierColor(pack.tier)}`}>
                        {pack.tier}
                      </span>
                    </div>
                  </div>

                  <h3 className="text-xl font-bold mb-1 text-foreground">{pack.name}</h3>
                  <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-3">Industry: {pack.industry}</div>
                  <p className="text-sm text-muted-foreground line-clamp-2">{pack.description}</p>
                </div>

                <div className="p-6 flex-1 bg-background/50 relative z-10">
                  <h4 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
                    <Box className="w-3.5 h-3.5" /> Included AI Personas ({pack.workers.length})
                  </h4>

                  <div className="space-y-3">
                    {pack.workers.slice(0, 3).map(worker => {
                      // Workers in this endpoint don't have individual executionStatus —
                      // infer from the pack status for display purposes
                      const workerState = getSpecialistDisplayState({
                        executionStatus: pack.status === "available" ? "available" : pack.status,
                        comingSoon:      pack.status === "coming_soon",
                      });
                      return (
                        <div key={worker.id} className="flex items-start gap-2">
                          <WorkerStatusIcon state={workerState} />
                          <div>
                            <div className="text-sm font-medium">{worker.name}</div>
                            <div className="text-xs text-muted-foreground">{worker.role}</div>
                          </div>
                        </div>
                      );
                    })}
                    {pack.workers.length > 3 && (
                      <div className="text-xs text-muted-foreground font-mono pl-6 pt-1">
                        + {pack.workers.length - 3} additional workers...
                      </div>
                    )}
                  </div>

                  {/* Coming-soon notice */}
                  {packState === "coming_soon" && (
                    <div className="mt-4 rounded-lg bg-amber-900/10 border border-amber-700/20 px-3 py-2">
                      <p className="text-xs text-amber-400">{DISPLAY_STATE_META.coming_soon.tooltip}</p>
                    </div>
                  )}

                  {/* DNA pending notice */}
                  {packState === "dna_pending" && (
                    <div className="mt-4 rounded-lg bg-blue-900/10 border border-blue-700/20 px-3 py-2">
                      <p className="text-xs text-blue-400">🧬 {DISPLAY_STATE_META.dna_pending.tooltip}</p>
                    </div>
                  )}
                </div>

                <div className="p-4 border-t border-border bg-secondary/30 relative z-10">
                  {canDeploy ? (
                    <button className="w-full flex items-center justify-center gap-2 bg-secondary hover:bg-primary/20 hover:text-primary border border-border hover:border-primary/40 text-foreground py-2 rounded-sm text-sm font-medium transition-all group/btn">
                      Deploy Package
                      <ChevronRight className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
                    </button>
                  ) : (
                    <button
                      disabled
                      title={DISPLAY_STATE_META[packState].tooltip}
                      className="w-full flex items-center justify-center gap-2 bg-background border border-border text-muted-foreground py-2 rounded-sm text-sm font-medium opacity-70 cursor-not-allowed"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      {DISPLAY_STATE_META[packState].label}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
