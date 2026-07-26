/**
 * Task Workroom — /app/:slug/tasks/:taskId
 * Sprint 9: The full collaborative workspace for a single task.
 *
 * Layout:
 *   Left (flex-1): Conversation thread + composer
 *   Right (320px): Task header, status, plan, approvals, workforce
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AppShell from "@/components/layout/AppShell";
import { useAuthFetch } from "@/lib/api";

// ─── Types ─────────────────────────────────────────────────────────────────────

type TaskState =
  | "draft" | "queued" | "planning" | "awaiting_approval"
  | "approved" | "executing" | "completed" | "cancelled" | "failed";

type MessageSenderType = "user" | "chief_of_staff" | "workforce_role" | "runtime" | "system";
type MessageType =
  | "text" | "question" | "clarification_request" | "task_proposal" | "task_created"
  | "plan_proposal" | "plan_revision" | "delegation" | "progress" | "status_change"
  | "approval_request" | "approval_decision" | "execution_update" | "warning"
  | "error" | "output" | "result" | "follow_up" | "system_notice";

interface Message {
  id: string;
  senderType: MessageSenderType;
  senderUserId?: string;
  workforceRoleCode?: string;
  messageType: MessageType;
  content: string;
  structuredContent?: Record<string, unknown> | null;
  createdAt: string;
}

interface Task {
  id: string;
  title: string;
  description?: string;
  currentState: TaskState;
  priority: string;
  approvalState: string;
  createdAt: string;
}

interface PlanStep {
  stepNumber: number;
  specialistCode: string;
  specialistName: string;
  action: string;
  estimatedDuration: string;
  requiresApproval: boolean;
}

interface Plan {
  planId: string;
  taskTitle: string;
  primarySpecialist: string;
  assignedSpecialists: string[];
  steps: PlanStep[];
  estimatedTotalDuration: string;
  requiresApproval: boolean;
  approvalType: string;
  reasoning: string;
  confidence: number;
}

interface Approval {
  id: string;
  state: string;
  approvalType: string;
  requestedAt: string;
  expiresAt?: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const STATE_CONFIG: Record<TaskState, { label: string; cls: string; icon: string }> = {
  draft:             { label: "Draft",             cls: "bg-[#1E3A5F] text-[#64748B]",            icon: "◎" },
  queued:            { label: "Queued",            cls: "bg-blue-900/30 text-blue-400",            icon: "⏳" },
  planning:          { label: "Planning",          cls: "bg-purple-900/30 text-purple-400",        icon: "🧠" },
  awaiting_approval: { label: "Awaiting Approval", cls: "bg-amber-900/30 text-amber-400",          icon: "⚠️" },
  approved:          { label: "Approved",          cls: "bg-cyan-900/30 text-cyan-400",            icon: "✓" },
  executing:         { label: "Executing",         cls: "bg-indigo-900/30 text-indigo-400",        icon: "⚡" },
  completed:         { label: "Completed",         cls: "bg-emerald-900/30 text-emerald-400",      icon: "✅" },
  cancelled:         { label: "Cancelled",         cls: "bg-[#1E3A5F] text-[#64748B]",            icon: "✕" },
  failed:            { label: "Failed",            cls: "bg-red-900/30 text-red-400",              icon: "✕" },
};

// ─── Sub-components ────────────────────────────────────────────────────────────

function SenderLabel({ senderType, workforceRoleCode }: { senderType: MessageSenderType; workforceRoleCode?: string }) {
  if (senderType === "user") return null;
  const roleName = workforceRoleCode
    ? workforceRoleCode.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    : senderType === "runtime" ? "Runtime" : "Chief of Staff";
  const color =
    senderType === "runtime" ? "text-purple-400"
    : senderType === "system" ? "text-[#64748B]"
    : "text-[#00D4FF]";
  return <p className={`text-xs font-semibold mb-1 ${color}`}>{roleName}</p>;
}

function ApprovalCard({
  data,
  onApprove,
  onReject,
  approving,
}: {
  data: Record<string, unknown>;
  onApprove: () => void;
  onReject: () => void;
  approving: boolean;
}) {
  return (
    <div className="mt-3 bg-amber-950/20 border border-amber-500/30 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-amber-400 font-bold text-xs uppercase tracking-wider">⚠ Approval Required</span>
      </div>
      {data.requestedAction && (
        <p className="text-[#E2E8F0] text-sm font-medium">{String(data.requestedAction)}</p>
      )}
      {data.reason && (
        <p className="text-[#94A3B8] text-xs">{String(data.reason)}</p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onApprove}
          disabled={approving}
          className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-colors"
        >
          {approving ? "Approving…" : "Approve"}
        </button>
        <button
          onClick={onReject}
          disabled={approving}
          className="px-3 py-1.5 bg-red-900/40 text-red-400 border border-red-900/50 text-xs font-semibold rounded-lg hover:bg-red-900/60 disabled:opacity-50 transition-colors"
        >
          Reject
        </button>
        <button className="px-3 py-1.5 text-xs text-[#64748B] hover:text-[#E2E8F0] border border-[#1E3A5F] rounded-lg transition-colors">
          Request changes
        </button>
      </div>
    </div>
  );
}

function PlanCard({ data }: { data: Record<string, unknown> }) {
  const steps = data.steps as PlanStep[] | undefined;
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-3 bg-[#0B1829] border border-[#1E3A5F] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[#00D4FF] text-xs font-bold uppercase tracking-wider">Work Plan</span>
        <button onClick={() => setExpanded(v => !v)} className="text-xs text-[#64748B] hover:text-[#E2E8F0]">
          {expanded ? "Hide steps" : "Show steps"}
        </button>
      </div>
      {data.estimatedTotalDuration && (
        <p className="text-[#94A3B8] text-xs">Estimated: {String(data.estimatedTotalDuration)}</p>
      )}
      {expanded && steps && steps.length > 0 && (
        <div className="space-y-2">
          {steps.map((step) => (
            <div key={step.stepNumber} className="flex gap-3 text-xs">
              <span className="h-5 w-5 rounded-full bg-[#1E3A5F] text-[#64748B] flex items-center justify-center shrink-0 font-mono text-[10px]">{step.stepNumber}</span>
              <div>
                <p className="text-[#94A3B8] font-medium">{step.specialistName}</p>
                <p className="text-[#64748B]">{step.action}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <span className="text-xs px-2 py-0.5 rounded-full bg-[#1E3A5F] text-[#64748B]">
          {(data.actions as string[] | undefined)?.includes("approve_plan") ? "Awaiting approval" : "Plan active"}
        </span>
      </div>
    </div>
  );
}

function ClarificationCard({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="mt-3 bg-blue-950/20 border border-blue-500/20 rounded-xl p-4 space-y-2">
      <span className="text-blue-400 text-xs font-bold uppercase tracking-wider">Clarification Required</span>
      {Array.isArray(data.questions) && data.questions.map((q: string, i: number) => (
        <p key={i} className="text-[#E2E8F0] text-sm">{i + 1}. {q}</p>
      ))}
      {data.requestedBy && (
        <p className="text-[#64748B] text-xs">Requested by: {String(data.requestedBy)}</p>
      )}
    </div>
  );
}

function ExecutionUpdateCard({ data }: { data: Record<string, unknown> }) {
  const isTerminal = ["execution.completed", "execution.failed", "execution.cancelled"].includes(String(data.eventType));
  const border = String(data.eventType).includes("failed") ? "border-red-900/30"
    : String(data.eventType).includes("completed") ? "border-emerald-900/30"
    : "border-[#1E3A5F]";
  return (
    <div className={`mt-2 bg-[#0B1829] border ${border} rounded-lg px-3 py-2 flex items-start gap-2`}>
      <span className="text-base">{
        String(data.eventType).includes("fail") ? "✕"
        : String(data.eventType).includes("complete") ? "✅"
        : String(data.eventType).includes("paused") ? "⏸"
        : "⚡"
      }</span>
      <div>
        <p className="text-[#E2E8F0] text-xs font-medium">{String(data.humanMessage)}</p>
        {data.stepNumber && data.totalSteps && (
          <p className="text-[#64748B] text-xs mt-0.5">Step {Number(data.stepNumber)} of {Number(data.totalSteps)}</p>
        )}
      </div>
    </div>
  );
}

function MessageBubble({
  msg,
  onApprove,
  onReject,
  approving,
}: {
  msg: Message;
  onApprove: (approvalId: string) => void;
  onReject: (approvalId: string) => void;
  approving: boolean;
}) {
  const isUser = msg.senderType === "user";
  const isSystem = msg.senderType === "system";

  if (isSystem) {
    return (
      <div className="flex justify-center my-3">
        <span className="text-xs text-[#64748B] bg-[#1E3A5F]/30 px-3 py-1 rounded-full">{msg.content}</span>
      </div>
    );
  }

  const sc = msg.structuredContent as Record<string, unknown> | null | undefined;
  const scType = sc?.type as string | undefined;
  const scData = sc?.data as Record<string, unknown> | undefined;

  const approvalId = scData?.approvalId as string | undefined;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      <div className="max-w-[78%]">
        {!isUser && <SenderLabel senderType={msg.senderType} workforceRoleCode={msg.workforceRoleCode} />}
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
            isUser
              ? "bg-[#00D4FF]/15 text-[#E2E8F0] border border-[#00D4FF]/20"
              : "bg-[#112033] text-[#CBD5E1] border border-[#1E3A5F]"
          }`}
        >
          {msg.content}
          {scType === "approval_request" && scData && approvalId && (
            <ApprovalCard
              data={scData}
              onApprove={() => onApprove(approvalId)}
              onReject={() => onReject(approvalId)}
              approving={approving}
            />
          )}
          {scType === "plan_proposal" && scData && <PlanCard data={scData} />}
          {scType === "clarification_request" && scData && <ClarificationCard data={scData} />}
          {scType === "execution_update" && scData && <ExecutionUpdateCard data={scData} />}
        </div>
        <p className="text-[#475569] text-xs mt-1 px-1">
          {new Date(msg.createdAt).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>
    </div>
  );
}

// ─── Right panel ───────────────────────────────────────────────────────────────

function TaskSidePanel({
  task,
  plan,
  pendingApproval,
  onCommand,
  commandLoading,
}: {
  task: Task;
  plan: Plan | null;
  pendingApproval: Approval | null;
  onCommand: (cmd: string) => void;
  commandLoading: boolean;
}) {
  const state = STATE_CONFIG[task.currentState];
  const assignedRoles = plan?.assignedSpecialists ?? [];

  return (
    <div className="w-80 shrink-0 border-l border-[#1E3A5F] overflow-y-auto bg-[#0A1628] flex flex-col">
      {/* Task header */}
      <div className="p-5 border-b border-[#1E3A5F]">
        <div className="flex items-start gap-2 mb-3">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 mt-0.5 ${state.cls}`}>
            {state.icon} {state.label}
          </span>
          <span className={`text-xs font-medium uppercase ${
            task.priority === "urgent" ? "text-red-400"
            : task.priority === "high" ? "text-amber-400"
            : "text-[#64748B]"
          }`}>{task.priority}</span>
        </div>
        <h2 className="text-[#E2E8F0] font-semibold text-sm leading-snug">{task.title}</h2>
        {task.description && (
          <p className="text-[#64748B] text-xs mt-2 line-clamp-3">{task.description}</p>
        )}
        <p className="text-[#475569] text-xs mt-2">{new Date(task.createdAt).toLocaleDateString("en-AU")}</p>
      </div>

      {/* Actions */}
      {!["completed", "cancelled", "failed"].includes(task.currentState) && (
        <div className="p-4 border-b border-[#1E3A5F]">
          <p className="text-[#64748B] text-xs uppercase tracking-wider mb-2">Actions</p>
          <div className="space-y-1.5">
            {task.currentState === "awaiting_approval" && (
              <>
                <button
                  onClick={() => onCommand("approve_plan")}
                  disabled={commandLoading}
                  className="w-full text-left text-xs px-3 py-2 rounded-lg bg-emerald-900/20 text-emerald-400 hover:bg-emerald-900/40 transition-colors disabled:opacity-50"
                >
                  ✓ Approve plan
                </button>
                <button
                  onClick={() => onCommand("reject_plan")}
                  disabled={commandLoading}
                  className="w-full text-left text-xs px-3 py-2 rounded-lg bg-red-900/20 text-red-400 hover:bg-red-900/30 transition-colors disabled:opacity-50"
                >
                  ✕ Reject plan
                </button>
              </>
            )}
            {["failed"].includes(task.currentState) && (
              <button
                onClick={() => onCommand("retry")}
                disabled={commandLoading}
                className="w-full text-left text-xs px-3 py-2 rounded-lg bg-blue-900/20 text-blue-400 hover:bg-blue-900/30 transition-colors disabled:opacity-50"
              >
                ↺ Retry
              </button>
            )}
            <button
              onClick={() => onCommand("cancel")}
              disabled={commandLoading || ["completed", "cancelled"].includes(task.currentState)}
              className="w-full text-left text-xs px-3 py-2 rounded-lg text-[#64748B] hover:text-red-400 hover:bg-red-900/10 transition-colors disabled:opacity-30"
            >
              ✕ Cancel task
            </button>
          </div>
        </div>
      )}

      {/* Plan */}
      {plan && (
        <div className="p-4 border-b border-[#1E3A5F]">
          <p className="text-[#64748B] text-xs uppercase tracking-wider mb-3">Plan</p>
          <div className="space-y-1.5">
            <div className="text-xs text-[#94A3B8] flex justify-between">
              <span>Duration</span>
              <span className="text-[#CBD5E1]">{plan.estimatedTotalDuration}</span>
            </div>
            <div className="text-xs text-[#94A3B8] flex justify-between">
              <span>Steps</span>
              <span className="text-[#CBD5E1]">{plan.steps.length}</span>
            </div>
            <div className="text-xs text-[#94A3B8] flex justify-between">
              <span>Approval</span>
              <span className="text-[#CBD5E1]">{plan.requiresApproval ? plan.approvalType.replace(/_/g, " ") : "None"}</span>
            </div>
          </div>
        </div>
      )}

      {/* Workforce */}
      {assignedRoles.length > 0 && (
        <div className="p-4">
          <p className="text-[#64748B] text-xs uppercase tracking-wider mb-3">Workforce</p>
          <div className="space-y-2">
            {assignedRoles.map(role => (
              <div key={role} className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-full bg-[#1E3A5F] flex items-center justify-center text-xs text-[#00D4FF] shrink-0">
                  {role === "chief_of_staff" ? "⬡" : role[0]?.toUpperCase()}
                </div>
                <span className="text-xs text-[#94A3B8]">
                  {role.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                </span>
                {role === "chief_of_staff" && (
                  <span className="text-xs text-[#64748B]">· coordinating</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function TaskWorkroomPage() {
  const { slug, taskId } = useParams<{ slug: string; taskId: string }>();
  const [, setLocation] = useLocation();
  const apiFetch = useAuthFetch();
  const qc = useQueryClient();

  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [approving, setApproving] = useState(false);
  const [commandLoading, setCommandLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load workroom data
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["workroom", slug, taskId],
    queryFn: () =>
      apiFetch(`/v1/organisations/${slug}/tasks/${taskId}/workroom`).then(r => r.json()),
    enabled: !!slug && !!taskId,
    refetchInterval: 15_000, // poll for execution updates
  });

  const task: Task | undefined = data?.task;
  const plan: Plan | null = data?.plan ?? null;
  const pendingApproval: Approval | null = data?.pendingApproval ?? null;

  useEffect(() => {
    if (data?.messages) {
      setMessages(data.messages);
    }
    if (data?.conversation?.id) {
      setConversationId(data.conversation.id);
    }
  }, [data]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isStreaming || !taskId || !slug) return;
    const text = input.trim();
    setInput("");
    setError(null);
    setIsStreaming(true);
    setStreamingText("");

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await apiFetch(
        `/v1/organisations/${slug}/tasks/${taskId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ content: text }),
          // @ts-ignore
          signal: abort.signal,
        }
      );

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          const evt = JSON.parse(raw) as Record<string, unknown>;
          if (evt.type === "token") {
            setStreamingText(prev => prev + (evt.content as string));
          } else if (evt.type === "user_message") {
            setMessages(prev => [...prev, evt.message as Message]);
          } else if (evt.type === "agent_message") {
            setMessages(prev => [...prev, evt.message as Message]);
            setStreamingText("");
          } else if (evt.type === "done") {
            setIsStreaming(false);
          }
        }
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") setError("Failed to send message.");
    } finally {
      setIsStreaming(false);
      setStreamingText("");
    }
  }, [input, isStreaming, taskId, slug, apiFetch]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const handleApprove = async (approvalId: string) => {
    if (!slug || !taskId) return;
    setApproving(true);
    try {
      await apiFetch(`/v1/organisations/${slug}/approvals/${approvalId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ decision: "approved", notes: "Approved via task workroom." }),
      });
      await refetch();
    } catch { setError("Failed to approve."); }
    finally { setApproving(false); }
  };

  const handleReject = async (approvalId: string) => {
    if (!slug || !taskId) return;
    setApproving(true);
    try {
      await apiFetch(`/v1/organisations/${slug}/approvals/${approvalId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ decision: "rejected", notes: "Rejected via task workroom." }),
      });
      await refetch();
    } catch { setError("Failed to reject."); }
    finally { setApproving(false); }
  };

  const handleCommand = async (command: string) => {
    if (!slug || !taskId) return;
    setCommandLoading(true);
    setError(null);
    try {
      const r = await apiFetch(`/v1/organisations/${slug}/tasks/${taskId}/commands`, {
        method: "POST",
        body: JSON.stringify({ command }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error?.message ?? "Command failed."); return; }
      if (d.agentMessage) setMessages(prev => [...prev, d.agentMessage]);
      await refetch();
    } catch { setError("Failed to execute command."); }
    finally { setCommandLoading(false); }
  };

  if (isLoading) {
    return (
      <AppShell orgSlug={slug ?? ""}>
        <div className="flex items-center justify-center h-full">
          <p className="text-[#64748B] text-sm">Loading workroom…</p>
        </div>
      </AppShell>
    );
  }

  if (!task) {
    return (
      <AppShell orgSlug={slug ?? ""}>
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <p className="text-[#E2E8F0] font-semibold">Task not found</p>
            <button onClick={() => setLocation(`/app/${slug}/tasks`)} className="mt-3 text-[#00D4FF] text-sm hover:underline">
              Back to Task Centre
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell orgSlug={slug ?? ""}>
      <div className="flex h-full overflow-hidden">
        {/* ── Conversation column ── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Thread header */}
          <div className="px-6 py-3 border-b border-[#1E3A5F] shrink-0 flex items-center gap-3">
            <button
              onClick={() => setLocation(`/app/${slug}/tasks`)}
              className="text-[#64748B] hover:text-[#E2E8F0] text-sm transition-colors"
            >
              ← Tasks
            </button>
            <span className="text-[#1E3A5F]">|</span>
            <p className="text-[#E2E8F0] font-medium text-sm truncate">{task.title}</p>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {messages.length === 0 && !streamingText && (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3 pb-8">
                <div className="h-12 w-12 rounded-xl bg-[#00D4FF]/10 border border-[#00D4FF]/20 flex items-center justify-center text-xl">💬</div>
                <div>
                  <p className="text-[#E2E8F0] font-semibold text-sm">Task Workroom</p>
                  <p className="text-[#64748B] text-xs mt-1 max-w-xs">
                    The conversation for this task will appear here. You can ask questions, request changes, or track progress.
                  </p>
                </div>
              </div>
            )}

            {messages.map(msg => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                onApprove={handleApprove}
                onReject={handleReject}
                approving={approving}
              />
            ))}

            {streamingText && (
              <div className="flex justify-start mb-4">
                <div className="max-w-[78%]">
                  <p className="text-xs font-semibold text-[#00D4FF] mb-1">Chief of Staff</p>
                  <div className="bg-[#112033] border border-[#1E3A5F] rounded-2xl px-4 py-3 text-sm text-[#CBD5E1] leading-relaxed whitespace-pre-wrap">
                    {streamingText}
                    <span className="inline-block w-1.5 h-4 bg-[#00D4FF]/60 animate-pulse ml-0.5 align-middle" />
                  </div>
                </div>
              </div>
            )}

            {error && <p className="text-red-400 text-xs text-center py-2">{error}</p>}
            <div ref={bottomRef} />
          </div>

          {/* Composer */}
          <div className="px-6 py-4 border-t border-[#1E3A5F] shrink-0">
            {["completed", "cancelled"].includes(task.currentState) && (
              <p className="text-[#64748B] text-xs text-center mb-2">
                This task is {task.currentState}. You can still discuss the outcome below.
              </p>
            )}
            <div className="flex gap-3 items-end">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  task.currentState === "awaiting_approval"
                    ? "Approve, reject, or ask a question…"
                    : task.currentState === "executing"
                    ? "Ask the workforce a question or request a status update…"
                    : "Ask a question, request changes, or give instructions…"
                }
                rows={1}
                className="flex-1 bg-[#112033] border border-[#1E3A5F] rounded-xl px-4 py-3 text-sm text-[#E2E8F0] placeholder-[#475569] focus:outline-none focus:border-[#00D4FF]/50 resize-none min-h-[44px] max-h-40 overflow-y-auto"
                onInput={e => {
                  const t = e.target as HTMLTextAreaElement;
                  t.style.height = "auto";
                  t.style.height = Math.min(t.scrollHeight, 160) + "px";
                }}
                disabled={isStreaming}
              />
              {isStreaming ? (
                <button
                  onClick={() => { abortRef.current?.abort(); setIsStreaming(false); setStreamingText(""); }}
                  className="px-4 py-3 text-xs bg-red-900/30 text-red-400 border border-red-900/50 rounded-xl hover:bg-red-900/50 transition-colors shrink-0"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={sendMessage}
                  disabled={!input.trim()}
                  className="px-4 py-3 text-xs bg-[#00D4FF] text-[#0B1829] font-semibold rounded-xl hover:bg-[#00D4FF]/90 disabled:opacity-40 transition-colors shrink-0"
                >
                  Send
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Right panel ── */}
        <TaskSidePanel
          task={task}
          plan={plan}
          pendingApproval={pendingApproval}
          onCommand={handleCommand}
          commandLoading={commandLoading}
        />
      </div>
    </AppShell>
  );
}
