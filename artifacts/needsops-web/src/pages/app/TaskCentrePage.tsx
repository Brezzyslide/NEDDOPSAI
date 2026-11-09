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

interface ParticipantOption {
  id: string;
  displayName?: string | null;
  preferredName?: string | null;
  externalParticipantId?: string | null;
  status?: string | null;
}

interface CreateTaskBody {
  title: string;
  description?: string;
  priority: string;
  originatingModule?: string;
  allowDuplicate?: boolean;
  sourceUserRequest?: string;
  subjectParticipantIds?: string[];
}

type CreateTaskResult =
  | { kind: "created"; task?: unknown };

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
  const [selectedCarePlanParticipantId, setSelectedCarePlanParticipantId] = useState("");

  const currentTab = STATE_TABS[activeTab]!;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["tasks", slug, activeTab],
    queryFn: () =>
      apiFetch(`/v1/organisations/${slug}/tasks?state=${currentTab.states.join(",")}`).then(r => r.json()),
    enabled: !!slug,
  });

  const participantsQuery = useQuery({
    queryKey: ["task-centre-participants", slug],
    queryFn: async () => {
      const response = await apiFetch(`/v1/organisations/${slug}/participants?limit=200`);
      if (!response.ok) throw new Error("Failed to load participants");
      const payload = await response.json();
      return (payload?.participants ?? []) as ParticipantOption[];
    },
    enabled: !!slug && slug !== "undefined",
    staleTime: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: async (body: CreateTaskBody): Promise<CreateTaskResult> => {
      const response = await apiFetch(`/v1/organisations/${slug}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Failed to create task");
      }
      return { kind: "created", task: payload?.task };
    },
    onSuccess: () => {
      setSelectedCarePlanParticipantId("");
      qc.invalidateQueries({ queryKey: ["tasks", slug] });
    },
  });

  const tasks: any[] = data?.tasks ?? [];
  const createParticipantCarePlan = () => {
    if (!selectedCarePlanParticipantId) return;
    const requestText = "Create a participant-specific care plan.";
    createMutation.mutate({
      title: "Create participant-specific care plan",
      description: requestText,
      priority: "normal",
      originatingModule: "task_centre_direct_care_plan",
      allowDuplicate: true,
      sourceUserRequest: requestText,
      subjectParticipantIds: [selectedCarePlanParticipantId],
    });
  };

  const participantOptions = participantsQuery.data ?? [];
  const selectedCarePlanParticipant = participantOptions.find(
    participant => participant.id === selectedCarePlanParticipantId,
  );
  const canCreateCarePlan =
    Boolean(selectedCarePlanParticipantId) &&
    !participantsQuery.isLoading &&
    !participantsQuery.isError &&
    !createMutation.isPending;

  return (
    <AppShell orgSlug={slug ?? ""}>
      <div className="p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[#E2E8F0]">Task Centre</h1>
            <p className="text-[#64748B] text-sm mt-1">AI-assisted tasks managed by your workforce</p>
          </div>
        </div>

        <div className="mb-6 bg-[#112033] border border-[#1E3A5F] rounded-xl p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex-1">
              <h2 className="text-[#E2E8F0] font-semibold text-sm">Create participant care plan</h2>
              <p className="text-[#64748B] text-xs mt-1">
                Starts a fresh care-plan task directly with the selected participant already bound.
              </p>
              <label className="text-[#64748B] text-xs mt-3 mb-1 block" htmlFor="care-plan-participant">
                Participant
              </label>
              <select
                id="care-plan-participant"
                value={selectedCarePlanParticipantId}
                onChange={e => setSelectedCarePlanParticipantId(e.target.value)}
                disabled={participantsQuery.isLoading || participantsQuery.isError || participantOptions.length === 0}
                className="w-full max-w-xl bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF]/50 disabled:opacity-50"
              >
                <option value="">
                  {participantsQuery.isLoading
                    ? "Loading participants..."
                    : participantOptions.length === 0
                      ? "No participants available"
                      : "Select a participant"}
                </option>
                {participantOptions.map(participant => {
                  const label = participant.displayName ?? participant.preferredName ?? "Unnamed participant";
                  const external = participant.externalParticipantId ? ` (${participant.externalParticipantId})` : "";
                  return (
                    <option key={participant.id} value={participant.id}>
                      {label}{external}
                    </option>
                  );
                })}
              </select>
              {selectedCarePlanParticipant && (
                <p className="text-[#64748B] text-xs mt-1">
                  Bound participant ID: <span className="font-mono text-[#00D4FF]">{selectedCarePlanParticipant.id}</span>
                </p>
              )}
              {participantsQuery.isError && (
                <p className="text-red-400 text-xs mt-1">Could not load participants.</p>
              )}
            </div>
            <button
              type="button"
              onClick={createParticipantCarePlan}
              disabled={!canCreateCarePlan}
              className="px-4 py-2 bg-[#00D4FF] text-[#0B1829] text-sm font-semibold rounded-lg hover:bg-[#00D4FF]/90 disabled:opacity-50 transition-colors"
            >
              {createMutation.isPending ? "Creating…" : "Create care plan"}
            </button>
          </div>
        </div>

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
              <p className="mt-3 text-[#64748B] text-xs">Use the participant selector above to create a care-plan task.</p>
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
