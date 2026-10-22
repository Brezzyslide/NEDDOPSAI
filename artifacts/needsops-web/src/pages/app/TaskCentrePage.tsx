/**
 * Task Centre — /app/:slug/tasks
 * View and manage the AI task queue.
 */

import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AppShell from "@/components/layout/AppShell";
import { useAuthFetch } from "@/lib/api";

type TaskState = "draft" | "queued" | "planning" | "awaiting_approval" | "evidence_required" | "approved" | "executing" | "completed" | "cancelled" | "failed";

interface ParticipantResolutionCandidate {
  id: string;
  displayName?: string | null;
  preferredName?: string | null;
  externalParticipantId?: string | null;
  isSuggestion?: boolean;
}

interface ParticipantResolutionState {
  status: "confirmation_required" | "ambiguous" | "unresolved";
  requestedName?: string;
  clarifyingQuestion?: string;
  candidates?: ParticipantResolutionCandidate[];
}

interface CreateTaskBody {
  title: string;
  description?: string;
  priority: string;
  subjectParticipantIds?: string[];
}

type CreateTaskResult =
  | { kind: "created"; task?: unknown }
  | { kind: "participant_resolution_required"; participantResolution: ParticipantResolutionState };

const STATE_TABS: { label: string; states: TaskState[] }[] = [
  { label: "Needs Attention", states: ["awaiting_approval", "evidence_required", "failed"] },
  { label: "Active", states: ["queued", "planning", "approved", "executing"] },
  { label: "Awaiting Input", states: ["awaiting_approval", "evidence_required"] },
  { label: "Completed", states: ["completed"] },
  { label: "Cancelled", states: ["cancelled"] },
  { label: "Failed", states: ["failed"] },
];

const STATE_BADGE: Record<TaskState, { label: string; cls: string }> = {
  draft:             { label: "Draft",             cls: "bg-[#1E3A5F] text-[#64748B]" },
  queued:            { label: "Queued",            cls: "bg-blue-900/30 text-blue-400" },
  planning:          { label: "Planning",          cls: "bg-purple-900/30 text-purple-400" },
  awaiting_approval: { label: "Awaiting Approval", cls: "bg-amber-900/30 text-amber-400" },
  evidence_required: { label: "Evidence Required", cls: "bg-orange-900/30 text-orange-400" },
  approved:          { label: "Approved",          cls: "bg-cyan-900/30 text-cyan-400" },
  executing:         { label: "Executing",         cls: "bg-indigo-900/30 text-indigo-400" },
  completed:         { label: "Completed",         cls: "bg-emerald-900/30 text-emerald-400" },
  cancelled:         { label: "Cancelled",         cls: "bg-[#1E3A5F] text-[#64748B]" },
  failed:            { label: "Failed",            cls: "bg-red-900/30 text-red-400" },
};

const BLOCKED_DRAFT_BADGE = { label: "Unapproved Draft Blocked", cls: "bg-red-900/25 text-red-300" };

function hasBlockedDraft(task: { metadata?: Record<string, any> | null }): boolean {
  const incompleteDraft = task.metadata?.incompleteDraft;
  return !!incompleteDraft && typeof incompleteDraft === "object";
}

const PRIORITY_BADGE: Record<string, string> = {
  low: "text-[#64748B]",
  normal: "text-[#94A3B8]",
  high: "text-amber-400",
  urgent: "text-red-400",
};

export default function TaskCentrePage() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const apiFetch = useAuthFetch();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPriority, setNewPriority] = useState<string>("normal");
  const [participantResolution, setParticipantResolution] = useState<ParticipantResolutionState | null>(null);
  const [pendingCreateBody, setPendingCreateBody] = useState<CreateTaskBody | null>(null);

  const currentTab = STATE_TABS[activeTab]!;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["tasks", slug, activeTab],
    queryFn: () =>
      apiFetch(`/v1/organisations/${slug}/tasks?state=${currentTab.states.join(",")}`).then(r => r.json()),
    enabled: !!slug,
  });

  const clearCreateForm = () => {
    setShowCreate(false);
    setNewTitle("");
    setNewDesc("");
    setNewPriority("normal");
    setParticipantResolution(null);
    setPendingCreateBody(null);
  };

  const buildCreateBody = (): CreateTaskBody => ({
    title: newTitle,
    description: newDesc,
    priority: newPriority,
  });

  const createMutation = useMutation({
    mutationFn: async (body: CreateTaskBody): Promise<CreateTaskResult> => {
      const response = await apiFetch(`/v1/organisations/${slug}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 409 && payload?.error?.code === "PARTICIPANT_RESOLUTION_REQUIRED") {
        return {
          kind: "participant_resolution_required",
          participantResolution: payload.error.participantResolution as ParticipantResolutionState,
        };
      }
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to create task");
      }
      return { kind: "created", task: payload?.task };
    },
    onSuccess: (result, body) => {
      if (result.kind === "participant_resolution_required") {
        setParticipantResolution(result.participantResolution);
        setPendingCreateBody(body);
        return;
      }
      clearCreateForm();
      qc.invalidateQueries({ queryKey: ["tasks", slug] });
    },
  });

  const tasks: any[] = data?.tasks ?? [];

  return (
    <AppShell orgSlug={slug ?? ""}>
      <div className="p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[#E2E8F0]">Task Centre</h1>
            <p className="text-[#64748B] text-sm mt-1">AI-assisted tasks managed by your workforce</p>
          </div>
          <button
            onClick={() => {
              setParticipantResolution(null);
              setPendingCreateBody(null);
              setShowCreate(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-[#00D4FF] text-[#0B1829] text-sm font-semibold rounded-lg hover:bg-[#00D4FF]/90 transition-colors"
          >
            + New Task
          </button>
        </div>

        {/* Create task panel */}
        {showCreate && (
          <div className="mb-6 bg-[#112033] border border-[#00D4FF]/30 rounded-xl p-6">
            <h3 className="text-[#E2E8F0] font-semibold mb-4">Create New Task</h3>
            <div className="space-y-3">
              <div>
                <label className="text-[#64748B] text-xs mb-1 block">Task Title *</label>
                <input
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="e.g. Review compliance policy for NDIS audit"
                  className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] placeholder-[#64748B] focus:outline-none focus:border-[#00D4FF]/50"
                />
              </div>
              <div>
                <label className="text-[#64748B] text-xs mb-1 block">Description (optional)</label>
                <textarea
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  placeholder="Provide additional context for the Chief of Staff…"
                  rows={3}
                  className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] placeholder-[#64748B] focus:outline-none focus:border-[#00D4FF]/50 resize-none"
                />
              </div>
              <div>
                <label className="text-[#64748B] text-xs mb-1 block">Priority</label>
                <select
                  value={newPriority}
                  onChange={e => setNewPriority(e.target.value)}
                  className="bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF]/50"
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              {participantResolution && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-3 space-y-2">
                  <p className="text-amber-300 text-xs font-semibold uppercase tracking-wider">
                    Participant confirmation required
                  </p>
                  <p className="text-[#CBD5E1] text-xs">
                    {participantResolution.clarifyingQuestion ?? "Select the participant before creating this task."}
                  </p>
                  {(participantResolution.candidates ?? []).length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {(participantResolution.candidates ?? []).map(candidate => {
                        const label = candidate.displayName ?? candidate.preferredName ?? "Unnamed participant";
                        const details = [
                          candidate.preferredName ? `Preferred: ${candidate.preferredName}` : null,
                          `Participant ID ${candidate.id}`,
                          candidate.externalParticipantId ? `External ID ${candidate.externalParticipantId}` : null,
                          candidate.isSuggestion ? "Suggested match" : null,
                        ].filter(Boolean);
                        return (
                          <button
                            key={candidate.id}
                            type="button"
                            onClick={() => createMutation.mutate({
                              ...(pendingCreateBody ?? buildCreateBody()),
                              subjectParticipantIds: [candidate.id],
                            })}
                            disabled={createMutation.isPending}
                            className="w-full text-left px-3 py-2 rounded-lg border border-[#1E3A5F] bg-[#0B1829] hover:border-[#00D4FF]/40 disabled:opacity-50 transition-colors"
                          >
                            <span className="block text-sm font-semibold text-[#E2E8F0]">{label}</span>
                            <span className="block text-xs text-[#64748B] mt-0.5">{details.join(" · ")}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[#94A3B8] text-xs">
                      {participantResolution.requestedName
                        ? `No participant found matching "${participantResolution.requestedName}".`
                        : "No matching participant was found."}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setParticipantResolution(null);
                      setPendingCreateBody(null);
                    }}
                    className="text-xs text-[#94A3B8] hover:text-[#E2E8F0] transition-colors"
                  >
                    Decline / choose later
                  </button>
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => {
                    setParticipantResolution(null);
                    setPendingCreateBody(null);
                    createMutation.mutate(buildCreateBody());
                  }}
                  disabled={!newTitle.trim() || createMutation.isPending}
                  className="px-4 py-2 bg-[#00D4FF] text-[#0B1829] text-sm font-semibold rounded-lg hover:bg-[#00D4FF]/90 disabled:opacity-50 transition-colors"
                >
                  {createMutation.isPending ? "Submitting…" : "Submit to Chief of Staff"}
                </button>
                <button
                  onClick={clearCreateForm}
                  className="px-4 py-2 text-sm text-[#64748B] hover:text-[#E2E8F0] transition-colors"
                >
                  Cancel
                </button>
              </div>
              {createMutation.isSuccess && createMutation.data?.kind === "created" && (
                <p className="text-emerald-400 text-xs">Task created and assigned to your AI workforce.</p>
              )}
              {createMutation.isError && (
                <p className="text-red-400 text-xs">Failed to create task. Please try again.</p>
              )}
            </div>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex gap-1 mb-5 bg-[#112033] rounded-lg p-1 w-fit">
          {STATE_TABS.map((tab, i) => (
            <button
              key={tab.label}
              onClick={() => setActiveTab(i)}
              className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                i === activeTab
                  ? "bg-[#00D4FF]/10 text-[#00D4FF] font-medium"
                  : "text-[#64748B] hover:text-[#E2E8F0]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tasks list */}
        {isLoading ? (
          <p className="text-[#64748B] text-sm">Loading tasks…</p>
        ) : tasks.length === 0 ? (
          <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-10 text-center">
            <p className="text-[#64748B] text-sm">No tasks in this category</p>
            {currentTab.label === "Active" && (
              <button
                onClick={() => setShowCreate(true)}
                className="mt-3 text-[#00D4FF] text-sm hover:underline"
              >
                Create your first task →
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map((task: any) => {
              const blockedDraft = hasBlockedDraft(task);
              const badge = blockedDraft ? BLOCKED_DRAFT_BADGE : STATE_BADGE[task.currentState as TaskState];
              const priorityCls = PRIORITY_BADGE[task.priority] ?? PRIORITY_BADGE.normal!;
              const failureReason = task.currentState === "failed"
                ? task.metadata?.executionFailure?.errorMessage
                : null;
              return (
                <div
                  key={task.id}
                  onClick={() => setLocation(`/app/${slug}/tasks/${task.id}`)}
                  className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5 hover:border-[#00D4FF]/30 transition-colors cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <p className="text-[#E2E8F0] font-semibold text-sm">{task.title}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge?.cls}`}>
                          {badge?.label}
                        </span>
                        <span className={`text-xs font-medium uppercase ${priorityCls}`}>
                          {task.priority}
                        </span>
                      </div>
                      {task.description && (
                        <p className="text-[#64748B] text-xs line-clamp-1">{task.description}</p>
                      )}
                      {failureReason && (
                        <p className="text-red-300/80 text-xs line-clamp-2 mt-1">{failureReason}</p>
                      )}
                      {blockedDraft && (
                        <p className="text-red-300/80 text-xs line-clamp-2 mt-1">
                          Review the draft and its completion-check findings. The draft is blocked from approval.
                        </p>
                      )}
                      <p className="text-[#64748B] text-xs mt-1.5">
                        {new Date(task.createdAt).toLocaleString("en-AU")}
                        {task.approvalState === "pending_approval" && (
                          <span className="ml-3 text-amber-400/80">Pending approval</span>
                        )}
                        {task.approvalState === "required" && !["awaiting_approval", "evidence_required"].includes(task.currentState) && (
                          <span className="ml-3 text-slate-500">Approval gate later</span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
