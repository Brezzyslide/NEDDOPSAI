/**
 * Workforce Chat — /app/:slug/chat
 * Sprint 9: General workforce conversation. The Chief of Staff can discuss ideas,
 * brainstorm, answer questions, and recognise when a task is being proposed.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import AppShell from "@/components/layout/AppShell";
import { useAuthFetch } from "@/lib/api";

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

interface Conversation {
  id: string;
  title?: string;
  conversationType: string;
  status: string;
  primaryTaskId?: string;
  lastMessageAt?: string;
}

interface TaskProposalData {
  title: string;
  summary: string;
  priority: string;
  suggestedRoles: string[];
  actions: string[];
}

function SenderLabel({ senderType, workforceRoleCode }: { senderType: MessageSenderType; workforceRoleCode?: string }) {
  if (senderType === "user") return null;
  const roleName = workforceRoleCode
    ? workforceRoleCode.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    : "Chief of Staff";
  const color = senderType === "runtime" ? "text-purple-400" : "text-[#00D4FF]";
  return <p className={`text-xs font-semibold mb-1 ${color}`}>{roleName}</p>;
}

function TaskProposalCard({
  data,
  onCreateTask,
  onContinue,
  creating,
}: {
  data: TaskProposalData;
  onCreateTask: (title: string, summary: string) => void;
  onContinue: () => void;
  creating: boolean;
}) {
  return (
    <div className="mt-3 bg-[#0B1829] border border-[#00D4FF]/30 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[#00D4FF] text-xs font-bold uppercase tracking-wider">Proposed Task</span>
      </div>
      <p className="text-[#E2E8F0] font-semibold text-sm">{data.title}</p>
      {data.suggestedRoles?.filter(r => r !== "chief_of_staff").length > 0 && (
        <div>
          <p className="text-[#64748B] text-xs mb-1">Suggested workforce:</p>
          <div className="flex flex-wrap gap-1.5">
            {data.suggestedRoles.filter(r => r !== "chief_of_staff").map(r => (
              <span key={r} className="text-xs px-2 py-0.5 rounded-full bg-[#1E3A5F] text-[#94A3B8]">
                {r.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onCreateTask(data.title, data.summary)}
          disabled={creating}
          className="px-3 py-1.5 bg-[#00D4FF] text-[#0B1829] text-xs font-semibold rounded-lg hover:bg-[#00D4FF]/90 disabled:opacity-50 transition-colors"
        >
          {creating ? "Creating…" : "Create task"}
        </button>
        <button
          onClick={onContinue}
          className="px-3 py-1.5 text-xs text-[#64748B] hover:text-[#E2E8F0] border border-[#1E3A5F] rounded-lg transition-colors"
        >
          Continue discussing
        </button>
      </div>
    </div>
  );
}

function MessageBubble({
  msg,
  onCreateTask,
  onContinueDiscussing,
  creatingTask,
}: {
  msg: Message;
  onCreateTask: (title: string, summary: string) => void;
  onContinueDiscussing: () => void;
  creatingTask: boolean;
}) {
  const isUser = msg.senderType === "user";
  const isSystem = msg.senderType === "system";

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <span className="text-xs text-[#64748B] bg-[#1E3A5F]/30 px-3 py-1 rounded-full">
          {msg.content}
        </span>
      </div>
    );
  }

  const proposalData = msg.messageType === "task_proposal" && msg.structuredContent
    ? (msg.structuredContent as { data: TaskProposalData }).data
    : null;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      <div className={`max-w-[75%] ${isUser ? "order-2" : ""}`}>
        {!isUser && (
          <SenderLabel senderType={msg.senderType} workforceRoleCode={msg.workforceRoleCode} />
        )}
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
            isUser
              ? "bg-[#00D4FF]/15 text-[#E2E8F0] border border-[#00D4FF]/20"
              : "bg-[#112033] text-[#CBD5E1] border border-[#1E3A5F]"
          }`}
        >
          {msg.content}
          {proposalData && (
            <TaskProposalCard
              data={proposalData}
              onCreateTask={onCreateTask}
              onContinue={onContinueDiscussing}
              creating={creatingTask}
            />
          )}
        </div>
        <p className="text-[#475569] text-xs mt-1 px-1">
          {new Date(msg.createdAt).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>
    </div>
  );
}

// Treat JS undefined, empty string, or the literal string "undefined" as invalid
function isValidSlug(s: string | undefined): s is string {
  return !!s && s !== "undefined";
}

export default function WorkforceChatPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const { isSignedIn } = useAuth();
  const apiFetch = useAuthFetch();

  // If the slug is missing or invalid (e.g. user navigated to /app/undefined/chat),
  // bounce them back to org selection immediately.
  useEffect(() => {
    if (!isValidSlug(slug)) setLocation("/app-home");
  }, [slug, setLocation]);
  const qc = useQueryClient();

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [creatingTask, setCreatingTask] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Create or reuse the general conversation — only after Clerk auth is ready
  useEffect(() => {
    if (!isValidSlug(slug) || !isSignedIn) return;
    apiFetch(`/v1/organisations/${slug}/conversations`, {
      method: "POST",
      body: JSON.stringify({ conversationType: "general_workforce", title: "Workforce Chat" }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.conversation) {
          setConversationId(d.conversation.id);
          // Load existing messages
          apiFetch(`/v1/organisations/${slug}/conversations/${d.conversation.id}/messages`)
            .then(r => r.json())
            .then(d2 => {
              if (d2.messages) setMessages(d2.messages);
            })
            .catch(() => {});
        }
      })
      .catch(() => setError("Failed to start conversation."));
  }, [slug, isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isStreaming || !conversationId || !slug) return;
    const text = input.trim();
    setInput("");
    setError(null);
    setIsStreaming(true);
    setStreamingText("");

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await apiFetch(
        `/v1/organisations/${slug}/conversations/${conversationId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ content: text }),
          // @ts-ignore — signal is valid
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
  }, [input, isStreaming, conversationId, slug, apiFetch]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleCreateTask = async (title: string, summary: string) => {
    if (!conversationId || !slug) return;
    setCreatingTask(true);
    try {
      const r = await apiFetch(
        `/v1/organisations/${slug}/conversations/${conversationId}/create-task`,
        { method: "POST", body: JSON.stringify({ title, description: summary }) }
      );
      const d = await r.json();
      if (d.task) {
        setLocation(`/app/${slug}/tasks/${d.task.id}`);
      }
    } catch {
      setError("Failed to create task.");
    } finally {
      setCreatingTask(false);
    }
  };

  return (
    <AppShell orgSlug={slug ?? ""}>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#1E3A5F] flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-lg font-semibold text-[#E2E8F0]">Workforce Chat</h1>
            <p className="text-[#64748B] text-xs mt-0.5">Discuss ideas, brainstorm, or ask your Chief of Staff to create a task</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-[#64748B]">Chief of Staff</span>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {messages.length === 0 && !streamingText && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-4 pb-8">
              <div className="h-14 w-14 rounded-2xl bg-[#00D4FF]/10 border border-[#00D4FF]/20 flex items-center justify-center text-2xl">🤖</div>
              <div>
                <p className="text-[#E2E8F0] font-semibold">Your Chief of Staff is ready</p>
                <p className="text-[#64748B] text-sm mt-1 max-w-xs">
                  Describe what you need help with. I can brainstorm, answer questions, or create a formal task for your AI workforce.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center mt-2">
                {[
                  "We have an NDIS audit coming up",
                  "Review our incident reports",
                  "What does the SCHADS Award say?",
                ].map(s => (
                  <button
                    key={s}
                    onClick={() => { setInput(s); textareaRef.current?.focus(); }}
                    className="text-xs px-3 py-1.5 rounded-full border border-[#1E3A5F] text-[#64748B] hover:text-[#E2E8F0] hover:border-[#00D4FF]/30 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map(msg => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              onCreateTask={handleCreateTask}
              onContinueDiscussing={() => setInput("Tell me more about the options")}
              creatingTask={creatingTask}
            />
          ))}

          {/* Streaming preview */}
          {streamingText && (
            <div className="flex justify-start mb-4">
              <div className="max-w-[75%]">
                <p className="text-xs font-semibold text-[#00D4FF] mb-1">Chief of Staff</p>
                <div className="bg-[#112033] border border-[#1E3A5F] rounded-2xl px-4 py-3 text-sm text-[#CBD5E1] leading-relaxed whitespace-pre-wrap">
                  {streamingText}
                  <span className="inline-block w-1.5 h-4 bg-[#00D4FF]/60 animate-pulse ml-0.5 align-middle" />
                </div>
              </div>
            </div>
          )}

          {error && (
            <p className="text-red-400 text-xs text-center py-2">{error}</p>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-6 py-4 border-t border-[#1E3A5F] shrink-0">
          <div className="flex gap-3 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe what you need…"
              rows={1}
              className="flex-1 bg-[#112033] border border-[#1E3A5F] rounded-xl px-4 py-3 text-sm text-[#E2E8F0] placeholder-[#475569] focus:outline-none focus:border-[#00D4FF]/50 resize-none min-h-[44px] max-h-40 overflow-y-auto"
              style={{ height: "auto" }}
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
          <p className="text-[#475569] text-xs mt-2">Press Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </AppShell>
  );
}
