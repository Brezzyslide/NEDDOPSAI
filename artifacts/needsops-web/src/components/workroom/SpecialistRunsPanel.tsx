/**
 * Specialist Runs Panel — Sprint 9.5
 *
 * Displays all specialist runs for a task in the Task Workroom right panel.
 * Shows status, confidence, findings summary, clarification requests,
 * and allows users to submit clarification responses.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthFetch } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpecialistRun {
  id: string;
  workforceRoleCode: string;
  workerProfileCode: string;
  status: string;
  priority: number;
  attemptNumber: number;
  maximumAttempts: number;
  approvalRequired: boolean;
  clarificationRequired: boolean;
  confidence: number | null;
  resultSummary: string | null;
  resultData: SpecialistRunResult | null;
  lastError: string | null;
  specialistInstructionVersion: string;
  modelProvider: string | null;
  modelName: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  createdAt: string;
}

interface SpecialistRunResult {
  findings: Array<{ title: string; description: string; severity?: string; confidence: number }>;
  recommendations: Array<{ action: string; reason: string; priority: string; approvalRequired: boolean }>;
  risks: Array<{ risk: string; likelihood?: string }>;
  unresolvedQuestions: Array<{ question: string; reason: string; blocking: boolean }>;
  requestedExternalActions: Array<{ actionType: string; approvalRequired: boolean; riskLevel: string }>;
  confidence: number;
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  created:               { label: "Created",              color: "text-[#64748B]",    icon: "◎" },
  queued:                { label: "Queued",               color: "text-blue-400",     icon: "⏳" },
  preparing:             { label: "Preparing",            color: "text-purple-400",   icon: "🔄" },
  running:               { label: "Running",              color: "text-cyan-400",     icon: "⚡" },
  awaiting_clarification:{ label: "Needs Clarification",  color: "text-amber-400",    icon: "❓" },
  awaiting_approval:     { label: "Awaiting Approval",    color: "text-amber-400",    icon: "⚠️" },
  waiting_for_dependency:{ label: "Waiting",              color: "text-[#64748B]",    icon: "⏸" },
  waiting_for_runtime:   { label: "Waiting for Runtime",  color: "text-purple-400",   icon: "🔌" },
  completed:             { label: "Completed",            color: "text-emerald-400",  icon: "✅" },
  failed:                { label: "Failed",               color: "text-red-400",      icon: "✕" },
  cancelled:             { label: "Cancelled",            color: "text-[#64748B]",    icon: "✕" },
  expired:               { label: "Expired",              color: "text-[#64748B]",    icon: "⌛" },
};

const ROLE_LABELS: Record<string, string> = {
  compliance_officer:  "Compliance Officer",
  document_specialist: "Document Specialist",
  operations_manager:  "Operations Manager",
  chief_of_staff:      "Chief of Staff",
  research_specialist: "Research Specialist",
  executive_assistant: "Executive Assistant",
};

// ─── Component ────────────────────────────────────────────────────────────────

interface SpecialistRunsPanelProps {
  orgSlug: string;
  taskId: string;
}

export default function SpecialistRunsPanel({ orgSlug, taskId }: SpecialistRunsPanelProps) {
  const authFetch = useAuthFetch();
  const queryClient = useQueryClient();
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [clarificationInput, setClarificationInput] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["specialist-runs", orgSlug, taskId],
    queryFn: async () => {
      const res = await authFetch(`/v1/organisations/${orgSlug}/tasks/${taskId}/specialist-runs`);
      if (!res.ok) throw new Error("Failed to load specialist runs");
      return res.json() as Promise<{ runs: SpecialistRun[] }>;
    },
    refetchInterval: 8000, // Poll every 8s during active runs
  });

  const submitClarification = useMutation({
    mutationFn: async ({ runId, response }: { runId: string; response: string }) => {
      const res = await authFetch(
        `/v1/organisations/${orgSlug}/tasks/${taskId}/specialist-runs/${runId}/clarification`,
        { method: "POST", body: JSON.stringify({ response }) },
      );
      if (!res.ok) throw new Error("Failed to submit clarification");
      return res.json();
    },
    onSuccess: (_data, { runId }) => {
      setClarificationInput(prev => ({ ...prev, [runId]: "" }));
      queryClient.invalidateQueries({ queryKey: ["specialist-runs", orgSlug, taskId] });
    },
  });

  const cancelRun = useMutation({
    mutationFn: async (runId: string) => {
      const res = await authFetch(
        `/v1/organisations/${orgSlug}/tasks/${taskId}/specialist-runs/${runId}/cancel`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to cancel run");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["specialist-runs", orgSlug, taskId] });
    },
  });

  const runs = data?.runs ?? [];
  if (isLoading && runs.length === 0) {
    return (
      <div className="px-4 py-3">
        <p className="text-[#64748B] text-xs text-center animate-pulse">Loading specialist runs…</p>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="px-4 py-4 text-center">
        <div className="h-8 w-8 rounded-lg bg-[#112033] border border-[#1E3A5F] flex items-center justify-center mx-auto mb-2 text-base">🧠</div>
        <p className="text-[#64748B] text-xs">No specialist runs yet. Runs are created when the Chief of Staff dispatches specialists to work on this task.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {runs.map(run => {
        const cfg = STATUS_CONFIG[run.status] ?? { label: run.status, color: "text-[#64748B]", icon: "◎" };
        const isExpanded = expandedRunId === run.id;
        const label = ROLE_LABELS[run.workforceRoleCode] ?? run.workforceRoleCode.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

        return (
          <div key={run.id} className="bg-[#112033] border border-[#1E3A5F] rounded-xl overflow-hidden">
            {/* Run header */}
            <button
              onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-[#0D1B2E] transition-colors"
            >
              <span className="text-base shrink-0" title={cfg.label}>{cfg.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[#E2E8F0] text-xs font-semibold truncate">{label}</p>
                  {run.attemptNumber > 1 && (
                    <span className="text-[10px] text-[#64748B] shrink-0">Attempt {run.attemptNumber}/{run.maximumAttempts}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-[10px] font-medium ${cfg.color}`}>{cfg.label}</span>
                  {run.confidence !== null && run.status === "completed" && (
                    <span className="text-[10px] text-[#64748B]">
                      {Math.round(run.confidence * 100)}% confidence
                    </span>
                  )}
                  {run.approvalRequired && (
                    <span className="text-[10px] bg-amber-900/30 text-amber-400 px-1 rounded">Approval required</span>
                  )}
                </div>
              </div>
              <span className="text-[#64748B] text-xs shrink-0">{isExpanded ? "▲" : "▼"}</span>
            </button>

            {/* Expanded details */}
            {isExpanded && (
              <div className="border-t border-[#1E3A5F] px-3 py-3 space-y-3">
                {/* Run metadata */}
                <div className="grid grid-cols-2 gap-2 text-[10px] text-[#64748B]">
                  <div>
                    <p className="font-semibold text-[#94A3B8] mb-0.5">Worker Profile</p>
                    <p>{run.workerProfileCode.replace(/_/g, " ")}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-[#94A3B8] mb-0.5">Instruction v</p>
                    <p>{run.specialistInstructionVersion}</p>
                  </div>
                  {run.modelProvider && (
                    <div>
                      <p className="font-semibold text-[#94A3B8] mb-0.5">Model</p>
                      <p>{run.modelProvider}/{run.modelName}</p>
                    </div>
                  )}
                  {run.startedAt && (
                    <div>
                      <p className="font-semibold text-[#94A3B8] mb-0.5">Started</p>
                      <p>{new Date(run.startedAt).toLocaleTimeString()}</p>
                    </div>
                  )}
                  {run.completedAt && (
                    <div>
                      <p className="font-semibold text-[#94A3B8] mb-0.5">Completed</p>
                      <p>{new Date(run.completedAt).toLocaleTimeString()}</p>
                    </div>
                  )}
                </div>

                {/* Summary */}
                {run.resultSummary && (
                  <div>
                    <p className="text-[10px] font-semibold text-[#94A3B8] mb-1">Summary</p>
                    <p className="text-xs text-[#CBD5E1] leading-relaxed">{run.resultSummary}</p>
                  </div>
                )}

                {/* Findings */}
                {(run.resultData?.findings?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-[#94A3B8] mb-1.5">
                      Findings ({run.resultData!.findings.length})
                    </p>
                    <div className="space-y-1.5">
                      {run.resultData!.findings.slice(0, 3).map((f, i) => (
                        <div key={i} className="bg-[#0D1B2E] rounded-lg px-2.5 py-2">
                          <div className="flex items-center gap-1.5 mb-1">
                            <p className="text-xs font-semibold text-[#E2E8F0] truncate">{f.title}</p>
                            {f.severity && (
                              <SeverityBadge severity={f.severity} />
                            )}
                          </div>
                          <p className="text-[10px] text-[#94A3B8] line-clamp-2">{f.description}</p>
                          <p className="text-[10px] text-[#64748B] mt-1">{Math.round(f.confidence * 100)}% confidence</p>
                        </div>
                      ))}
                      {run.resultData!.findings.length > 3 && (
                        <p className="text-[10px] text-[#64748B] text-center">
                          + {run.resultData!.findings.length - 3} more findings
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Unresolved questions */}
                {(run.resultData?.unresolvedQuestions?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-amber-400 mb-1.5">
                      ❓ Unresolved Questions ({run.resultData!.unresolvedQuestions.filter(q => q.blocking).length} blocking)
                    </p>
                    <div className="space-y-1">
                      {run.resultData!.unresolvedQuestions.map((q, i) => (
                        <div key={i} className={`rounded-lg px-2.5 py-2 ${q.blocking ? "bg-amber-950/20 border border-amber-900/30" : "bg-[#0D1B2E]"}`}>
                          <p className="text-xs text-[#CBD5E1]">{q.question}</p>
                          <p className="text-[10px] text-[#64748B] mt-0.5">{q.reason}</p>
                          {q.blocking && <span className="text-[10px] text-amber-400 font-semibold">Blocking</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* External actions */}
                {(run.resultData?.requestedExternalActions?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-[#94A3B8] mb-1.5">
                      External Actions Requested ({run.resultData!.requestedExternalActions.length})
                    </p>
                    <div className="space-y-1">
                      {run.resultData!.requestedExternalActions.map((a, i) => (
                        <div key={i} className="flex items-center gap-2 bg-[#0D1B2E] rounded-lg px-2.5 py-1.5">
                          <span className="text-[10px] text-[#94A3B8] flex-1 truncate">{a.actionType}</span>
                          {a.approvalRequired && (
                            <span className="text-[10px] bg-amber-900/30 text-amber-400 px-1 rounded shrink-0">Needs approval</span>
                          )}
                          <RiskBadge risk={a.riskLevel} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Error */}
                {run.lastError && run.status === "failed" && (
                  <div className="bg-red-950/20 border border-red-900/30 rounded-lg px-2.5 py-2">
                    <p className="text-[10px] font-semibold text-red-400 mb-0.5">Error</p>
                    <p className="text-[10px] text-red-300">{run.lastError}</p>
                  </div>
                )}

                {/* Clarification form */}
                {run.status === "awaiting_clarification" && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold text-amber-400">Provide clarification to resume this run</p>
                    <textarea
                      value={clarificationInput[run.id] ?? ""}
                      onChange={e => setClarificationInput(prev => ({ ...prev, [run.id]: e.target.value }))}
                      placeholder="Provide the information the specialist needs…"
                      rows={3}
                      className="w-full bg-[#0D1B2E] border border-[#1E3A5F] rounded-lg px-3 py-2 text-xs text-[#E2E8F0] placeholder-[#475569] focus:outline-none focus:border-[#00D4FF]/50 resize-none"
                    />
                    <button
                      onClick={() => {
                        const response = clarificationInput[run.id];
                        if (response?.trim()) {
                          submitClarification.mutate({ runId: run.id, response });
                        }
                      }}
                      disabled={!clarificationInput[run.id]?.trim() || submitClarification.isPending}
                      className="w-full py-1.5 bg-[#00D4FF] text-[#0B1829] text-xs font-semibold rounded-lg hover:bg-[#00D4FF]/90 disabled:opacity-40 transition-colors"
                    >
                      {submitClarification.isPending ? "Submitting…" : "Submit Clarification"}
                    </button>
                  </div>
                )}

                {/* Cancel button for running/queued runs */}
                {["queued", "preparing", "running", "awaiting_approval"].includes(run.status) && (
                  <button
                    onClick={() => {
                      if (confirm("Cancel this specialist run?")) {
                        cancelRun.mutate(run.id);
                      }
                    }}
                    disabled={cancelRun.isPending}
                    className="w-full py-1.5 text-xs text-[#64748B] hover:text-red-400 border border-[#1E3A5F] rounded-lg transition-colors"
                  >
                    {cancelRun.isPending ? "Cancelling…" : "Cancel Run"}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Badge helpers ─────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    critical: "bg-red-900/30 text-red-400",
    high:     "bg-orange-900/30 text-orange-400",
    medium:   "bg-amber-900/30 text-amber-400",
    low:      "bg-emerald-900/30 text-emerald-400",
  };
  return (
    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase shrink-0 ${map[severity] ?? "bg-[#1E3A5F] text-[#64748B]"}`}>
      {severity}
    </span>
  );
}

function RiskBadge({ risk }: { risk: string }) {
  const map: Record<string, string> = {
    critical: "text-red-400",
    high:     "text-orange-400",
    medium:   "text-amber-400",
    low:      "text-emerald-400",
  };
  return (
    <span className={`text-[9px] font-semibold shrink-0 ${map[risk] ?? "text-[#64748B]"}`}>
      {risk}
    </span>
  );
}
