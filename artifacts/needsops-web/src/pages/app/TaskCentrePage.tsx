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

const STATE_TABS: { label: string; states: TaskState[] }[] = [
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

  const currentTab = STATE_TABS[activeTab]!;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["tasks", slug, activeTab],
    queryFn: () =>
      apiFetch(`/v1/organisations/${slug}/tasks?state=${currentTab.states.join(",")}`).then(r => r.json()),
    enabled: !!slug,
  });

  const createMutation = useMutation({
    mutationFn: (body: object) =>
      apiFetch(`/v1/organisations/${slug}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(r => r.json()),
    onSuccess: () => {
      setShowCreate(false);
      setNewTitle("");
      setNewDesc("");
      setNewPriority("normal");
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
            onClick={() => setShowCreate(true)}
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
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => createMutation.mutate({ title: newTitle, description: newDesc, priority: newPriority })}
                  disabled={!newTitle.trim() || createMutation.isPending}
                  className="px-4 py-2 bg-[#00D4FF] text-[#0B1829] text-sm font-semibold rounded-lg hover:bg-[#00D4FF]/90 disabled:opacity-50 transition-colors"
                >
                  {createMutation.isPending ? "Submitting…" : "Submit to Chief of Staff"}
                </button>
                <button
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 text-sm text-[#64748B] hover:text-[#E2E8F0] transition-colors"
                >
                  Cancel
                </button>
              </div>
              {createMutation.isSuccess && (
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
            {activeTab === 0 && (
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
              const badge = STATE_BADGE[task.currentState as TaskState];
              const priorityCls = PRIORITY_BADGE[task.priority] ?? PRIORITY_BADGE.normal!;
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
