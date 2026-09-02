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
  /** true while the message is optimistically rendered pending server confirmation */
  _pending?: boolean;
  /** true if the send request failed — message shown in an error state */
  _failed?: boolean;
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
  sourceUserRequest?: string;
  priority: string;
  suggestedRoles: string[];
  primaryProfessionalOwner?: string;
  primaryProfessionalOwnerName?: string;
  supportingSpecialists?: string[];
  supportingSpecialistNames?: string[];
  coordinator?: string | null;
  coordinatorName?: string | null;
  assignedSpecialists?: string[];
  assignedSpecialistNames?: string[];
  actions: string[];
}

interface ParticipantResolutionCandidate {
  id: string;
  displayName?: string | null;
  preferredName?: string | null;
  externalParticipantId?: string | null;
  matchType?: string;
  isSuggestion?: boolean;
  similarity?: number;
}

interface ParticipantResolutionState {
  status: "confirmation_required" | "ambiguous" | "unresolved";
  requestedName?: string;
  clarifyingQuestion?: string;
  candidates?: ParticipantResolutionCandidate[];
}

function formatRoleName(role: string) {
  return role.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function stableHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(i) | 0;
  }
  return Math.abs(hash).toString(36);
}

function buildTaskCreateIdempotencyKey(conversationId: string, title: string, summary: string): string {
  const normalised = `${title} ${summary}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `conversation-create:${conversationId}:${stableHash(normalised)}`;
}

function buildTaskProposalKey(title: string, summary: string): string {
  return stableHash(`${title}\n${summary}`);
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
  existingTaskId,
  participantResolution,
  orgSlug,
}: {
  data: TaskProposalData;
  onCreateTask: (title: string, summary: string, subjectParticipantId?: string, sourceUserRequest?: string) => void;
  onContinue: () => void;
  creating: boolean;
  existingTaskId?: string | null;
  participantResolution?: ParticipantResolutionState;
  orgSlug?: string;
}) {
  const apiFetch = useAuthFetch();
  const participantCandidates = participantResolution?.candidates ?? [];
  const requestedName = participantResolution?.requestedName?.trim() ?? "";
  const [newParticipantName, setNewParticipantName] = useState(requestedName);
  const [duplicateWarnings, setDuplicateWarnings] = useState<ParticipantResolutionCandidate[]>([]);
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);
  const [createParticipantError, setCreateParticipantError] = useState<string | null>(null);
  const [creatingParticipant, setCreatingParticipant] = useState(false);

  useEffect(() => {
    setNewParticipantName(requestedName);
    setDuplicateWarnings([]);
    setDuplicateAcknowledged(false);
    setCreateParticipantError(null);
  }, [requestedName]);

  const handleCreateParticipantFromCard = async () => {
    if (!orgSlug || creatingParticipant || creating) return;
    const displayName = newParticipantName.trim();
    if (displayName.length < 2) {
      setCreateParticipantError("Enter a participant name first.");
      return;
    }
    setCreateParticipantError(null);
    setCreatingParticipant(true);
    try {
      if (!duplicateAcknowledged) {
        const warningRes = await apiFetch(
          `/v1/organisations/${orgSlug}/participants/duplicate-warnings?q=${encodeURIComponent(displayName)}&limit=5`,
        );
        const warningBody = await warningRes.json().catch(() => ({}));
        const warnings = (warningBody?.warnings ?? []) as Array<{ participant: ParticipantResolutionCandidate }>;
        if (warningRes.ok && warnings.length > 0) {
          setDuplicateWarnings(warnings.map(warning => warning.participant));
          setDuplicateAcknowledged(true);
          return;
        }
      }

      const res = await apiFetch(`/v1/organisations/${orgSlug}/participants`, {
        method: "POST",
        body: JSON.stringify({ displayName }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.participant?.id) {
        setCreateParticipantError(body?.error?.message ?? "Could not create participant.");
        return;
      }
      onCreateTask(data.title, data.summary, body.participant.id, data.sourceUserRequest);
    } catch {
      setCreateParticipantError("Could not create participant.");
    } finally {
      setCreatingParticipant(false);
    }
  };

  return (
    <div className="mt-3 bg-[#0B1829] border border-[#00D4FF]/30 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[#00D4FF] text-xs font-bold uppercase tracking-wider">
          {existingTaskId ? "Task Created" : "Proposed Task"}
        </span>
        {existingTaskId && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-400">✓ Linked</span>
        )}
      </div>
      <p className="text-[#E2E8F0] font-semibold text-sm">{data.title}</p>
      {data.primaryProfessionalOwner ? (
        <div className="space-y-2">
          <div>
            <p className="text-[#64748B] text-xs mb-1">Primary specialist:</p>
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#1E3A5F] text-[#E2E8F0]">
              {data.primaryProfessionalOwnerName ?? formatRoleName(data.primaryProfessionalOwner)}
            </span>
          </div>
          {(data.supportingSpecialists?.length ?? 0) > 0 && (
            <div>
              <p className="text-[#64748B] text-xs mb-1">Supporting specialists:</p>
              <div className="flex flex-wrap gap-1.5">
                {data.supportingSpecialists!.map((r, index) => (
                  <span key={r} className="text-xs px-2 py-0.5 rounded-full bg-[#1E3A5F] text-[#94A3B8]">
                    {data.supportingSpecialistNames?.[index] ?? formatRoleName(r)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {data.coordinator && (
            <div>
              <p className="text-[#64748B] text-xs mb-1">Coordinator:</p>
              <span className="text-xs px-2 py-0.5 rounded-full bg-[#13263F] text-[#94A3B8]">
                {data.coordinatorName ?? formatRoleName(data.coordinator)}
              </span>
            </div>
          )}
        </div>
      ) : data.suggestedRoles?.filter(r => r !== "chief_of_staff").length > 0 && (
        <div>
          <p className="text-[#64748B] text-xs mb-1">Suggested workforce:</p>
          <div className="flex flex-wrap gap-1.5">
            {data.suggestedRoles.filter(r => r !== "chief_of_staff").map(r => (
              <span key={r} className="text-xs px-2 py-0.5 rounded-full bg-[#1E3A5F] text-[#94A3B8]">
                {formatRoleName(r)}
              </span>
            ))}
          </div>
        </div>
      )}
      {participantResolution && !existingTaskId && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-3 space-y-2">
          <p className="text-amber-300 text-xs font-semibold uppercase tracking-wider">
            Participant confirmation required
          </p>
          <p className="text-[#CBD5E1] text-xs">
            {participantResolution.clarifyingQuestion ?? "Select the participant before creating this task."}
          </p>
          {participantCandidates.length > 0 && (
            <div className="flex flex-col gap-2">
              {participantCandidates.map(candidate => {
                const label = candidate.displayName ?? candidate.preferredName ?? "Unnamed participant";
                const detail = candidate.externalParticipantId ? `ID ${candidate.externalParticipantId}` : null;
                return (
                  <button
                    key={candidate.id}
                    onClick={() => onCreateTask(data.title, data.summary, candidate.id, data.sourceUserRequest)}
                    disabled={creating}
                    className="w-full text-left px-3 py-2 rounded-lg border border-[#1E3A5F] bg-[#112033] hover:border-[#00D4FF]/40 disabled:opacity-50 transition-colors"
                  >
                    <span className="block text-sm font-semibold text-[#E2E8F0]">{label}</span>
                    <span className="block text-xs text-[#64748B] mt-0.5">
                      {[detail, candidate.isSuggestion ? "Suggested match" : null].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                  );
                })}
            </div>
          )}
          <div className="space-y-2">
            {participantCandidates.length > 0 && (
              <p className="text-[#94A3B8] text-xs">Or create a new participant identity instead.</p>
            )}
            {participantCandidates.length === 0 && (
              <p className="text-[#94A3B8] text-xs">
                {requestedName
                  ? `No participant found matching "${requestedName}". Create one?`
                  : "No matching participant was found. Create one before opening the task."}
              </p>
            )}
            <input
              value={newParticipantName}
              onChange={event => {
                setNewParticipantName(event.target.value);
                setDuplicateWarnings([]);
                setDuplicateAcknowledged(false);
              }}
              placeholder="Participant name"
              className="w-full rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-3 py-2 text-sm text-[#E2E8F0] placeholder:text-[#64748B] outline-none focus:border-[#00D4FF]"
            />
            {duplicateWarnings.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-2">
                <p className="text-amber-300 text-xs font-semibold">Possible existing participant</p>
                {duplicateWarnings.map(warning => (
                  <p key={warning.id} className="text-[#CBD5E1] text-xs mt-1">
                    {warning.displayName ?? warning.preferredName ?? warning.id}
                    {warning.externalParticipantId ? ` · ID ${warning.externalParticipantId}` : ""}
                  </p>
                ))}
                <p className="text-[#94A3B8] text-xs mt-1">Create a new identity only if this is a different person.</p>
              </div>
            )}
            {createParticipantError && <p className="text-red-400 text-xs">{createParticipantError}</p>}
            <button
              onClick={handleCreateParticipantFromCard}
              disabled={creatingParticipant || creating || newParticipantName.trim().length < 2}
              className="w-full px-3 py-2 rounded-lg bg-[#00D4FF] text-[#0B1829] text-xs font-semibold hover:bg-[#00D4FF]/90 disabled:opacity-50 transition-colors"
            >
              {creatingParticipant
                ? "Creating..."
                : duplicateWarnings.length > 0
                  ? "Create new participant anyway"
                  : "Create participant and task"}
            </button>
          </div>
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onCreateTask(data.title, data.summary, undefined, data.sourceUserRequest)}
          disabled={creating}
          className="px-3 py-1.5 bg-[#00D4FF] text-[#0B1829] text-xs font-semibold rounded-lg hover:bg-[#00D4FF]/90 disabled:opacity-50 transition-colors"
        >
          {creating ? "Opening…" : existingTaskId ? "View task →" : "Create task"}
        </button>
        {!existingTaskId && (
          <button
            onClick={onContinue}
            className="px-3 py-1.5 text-xs text-[#64748B] hover:text-[#E2E8F0] border border-[#1E3A5F] rounded-lg transition-colors"
          >
            Continue discussing
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * ClarificationCard — rendered inside MessageBubble for clarification_request messages.
 *
 * Distinguishes three variants:
 *   1. Confirmation required (structuredContent null, or questions array empty):
 *      CoS is asking the user to explicitly approve proceeding. Shows a
 *      "Confirm and proceed" button that sends a confirmation message through the
 *      normal conversation pathway — no direct DB manipulation.
 *
 *   2. Free-text questions (structuredContent.data.questions non-empty):
 *      CoS needs specific answers before it can proceed. Renders the questions
 *      visually so the user knows what to address, but does NOT offer a one-click
 *      confirm (the user must type their answers — the questions may need individual
 *      free-text responses).
 *
 *   3. Informational clarification (no questions, no confirmation needed — future):
 *      Fallback to plain text only; ClarificationCard is not rendered.
 */
function ClarificationCard({
  msg,
  onConfirm,
}: {
  msg: Message;
  onConfirm: () => void;
}) {
  // Structured content shape: { type: "clarification_request", data: { questions, blocking, requestedBy } }
  // When the CoS fires task_clarification mode with no specific sub-questions,
  // the server stores structuredContent = null.  Both null and an empty questions array
  // indicate a confirmation-style clarification.
  const structured = msg.structuredContent as {
    type: string;
    data: { questions: string[]; blocking: boolean; requestedBy: string };
  } | null | undefined;

  const questions: string[] = structured?.data?.questions ?? [];
  const hasQuestions = questions.length > 0;

  if (!hasQuestions) {
    // ── Confirmation variant ───────────────────────────────────────────────────
    // The Chief of Staff has made a proposal and is asking for explicit approval
    // to proceed. Show a distinct confirmation affordance so the user doesn't
    // need to guess that typing "yes" is required.
    return (
      <div className="mt-3 bg-[#0B1829] border border-amber-500/30 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-amber-400 text-sm">⚡</span>
          <span className="text-amber-400 text-xs font-bold uppercase tracking-wider">
            Confirmation Required
          </span>
        </div>
        <p className="text-[#94A3B8] text-xs">
          Confirm to proceed and create the task, or continue discussing to refine the proposal.
        </p>
        <div className="flex gap-2 pt-1">
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 bg-[#00D4FF] text-[#0B1829] text-xs font-semibold rounded-lg hover:bg-[#00D4FF]/90 transition-colors"
          >
            Confirm and proceed
          </button>
          <button
            onClick={() => {
              // Scroll to input — the user wants to ask something first
              document.querySelector<HTMLTextAreaElement>("textarea")?.focus();
            }}
            className="px-3 py-1.5 text-xs text-[#64748B] hover:text-[#E2E8F0] border border-[#1E3A5F] rounded-lg transition-colors"
          >
            Continue discussing
          </button>
        </div>
      </div>
    );
  }

  // ── Questions variant ────────────────────────────────────────────────────────
  // The CoS has specific questions that need free-text answers. Render them
  // visually so the user knows what to address. No one-click confirm here —
  // each question may need a different answer.
  return (
    <div className="mt-3 bg-[#0B1829] border border-[#1E3A5F] rounded-xl p-4 space-y-3">
      <p className="text-[#64748B] text-xs font-semibold uppercase tracking-wider">
        Please answer to continue
      </p>
      <ul className="space-y-2">
        {questions.map((q, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <span className="text-[#00D4FF] text-xs mt-0.5 shrink-0 font-semibold">{i + 1}.</span>
            <span className="text-[#CBD5E1]">{q}</span>
          </li>
        ))}
      </ul>
      <p className="text-[#475569] text-xs">Type your answer in the chat below</p>
    </div>
  );
}

function MessageBubble({
  msg,
  onCreateTask,
  onContinueDiscussing,
  onConfirm,
  creatingTask,
  existingTaskId,
  participantResolution,
}: {
  msg: Message;
  onCreateTask: (title: string, summary: string, subjectParticipantId?: string) => void;
  onContinueDiscussing: () => void;
  onConfirm: () => void;
  creatingTask: boolean;
  existingTaskId?: string | null;
  participantResolution?: ParticipantResolutionState;
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

  // Show the clarification card for clarification_request messages from the CoS.
  // The card variant (confirmation vs. free-text questions) is determined inside
  // ClarificationCard based on the message's structuredContent.questions array.
  const isClarification = msg.messageType === "clarification_request" && !isUser;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      <div className={`max-w-[75%] ${isUser ? "order-2" : ""}`}>
        {!isUser && (
          <SenderLabel senderType={msg.senderType} workforceRoleCode={msg.workforceRoleCode} />
        )}
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
            isUser
              ? msg._failed
                ? "bg-red-900/30 text-[#E2E8F0] border border-red-500/40"
                : "bg-[#00D4FF]/15 text-[#E2E8F0] border border-[#00D4FF]/20"
              : "bg-[#112033] text-[#CBD5E1] border border-[#1E3A5F]"
          } ${msg._pending ? "opacity-60" : ""}`}
        >
          {msg.content}
          {proposalData && (
            <TaskProposalCard
              data={proposalData}
              onCreateTask={onCreateTask}
              onContinue={onContinueDiscussing}
              creating={creatingTask}
              existingTaskId={existingTaskId}
              participantResolution={participantResolution}
              orgSlug={slug}
            />
          )}
          {isClarification && (
            <ClarificationCard msg={msg} onConfirm={onConfirm} />
          )}
        </div>
        <p className="text-[#475569] text-xs mt-1 px-1 flex items-center gap-1.5">
          {msg._pending && <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#64748B] animate-pulse" />}
          {msg._failed && <span className="text-red-400">Failed to send</span>}
          {!msg._failed && !msg._pending && new Date(msg.createdAt).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
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
  /**
   * linkedTaskId tracks a task that was created/auto-dispatched DURING THIS SESSION.
   *
   * Architecture rule (Sprint 29M workroom fix):
   *   - general_workforce conversations are reusable front-desk threads. They may
   *     create many independent tasks over their lifetime and must never inherit a
   *     session-wide task link from their historical primaryTaskId.
   *   - task_workroom conversations belong to exactly one task; their primaryTaskId
   *     is the legitimate task context and may be inherited.
   *
   * This state is therefore only set from:
   *   1. task_auto_created SSE events in this session
   *   2. handleCreateTask success responses in this session
   *   3. primaryTaskId of a task_workroom conversation (on load)
   *
   * It is NEVER set from the primaryTaskId of a general_workforce conversation,
   * because that value is a historical artefact (stale task link from a previous
   * session) and would contaminate proposal cards in the current session.
   */
  const [linkedTaskId, setLinkedTaskId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [creatingTask, setCreatingTask] = useState(false);
  const [participantResolutionByProposal, setParticipantResolutionByProposal] = useState<Record<string, ParticipantResolutionState>>({});
  const [error, setError] = useState<string | null>(null);
  const [autoCreatedTask, setAutoCreatedTask] = useState<{
    taskId: string;
    title: string;
    dispatched: boolean;
    requiresApproval: boolean;
  } | null>(null);
  const [autoCreatedTasks, setAutoCreatedTasks] = useState<Array<{
    taskId: string;
    title: string;
    dispatched: boolean;
    requiresApproval: boolean;
  }>>([]);
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
          // Architecture rule: only inherit primaryTaskId for task_workroom conversations.
          // A general_workforce conversation is a reusable front-desk thread — its
          // primaryTaskId (if any) is a historical artefact from a previous session and
          // must not become the session-wide linked task, which would corrupt proposal
          // cards for new tasks submitted in this session.
          if (
            d.conversation.conversationType === "task_workroom" &&
            d.conversation.primaryTaskId
          ) {
            setLinkedTaskId(d.conversation.primaryTaskId);
          }
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

  /**
   * Send a message through the existing conversation/message pathway.
   *
   * @param overrideText — when provided, this text is sent instead of the
   *   current input field value. Used by the ClarificationCard "Confirm and
   *   proceed" button, which bypasses the input field so the user does not
   *   need to type a confirmation phrase manually.
   */
  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText !== undefined ? overrideText : input).trim();
    if (!text || isStreaming || !conversationId || !slug) return;
    // Only clear the input field if the message came from it (not from a button)
    if (overrideText === undefined) setInput("");
    setError(null);
    setIsStreaming(true);
    setStreamingText("");

    // Optimistic UI: add user message immediately so the user sees it
    // before the network round-trip completes.
    const clientId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setMessages(prev => [...prev, {
      id: clientId,
      senderType: "user" as MessageSenderType,
      messageType: "text" as MessageType,
      content: text,
      createdAt: new Date().toISOString(),
      _pending: true,
    }]);

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

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({})) as Record<string, unknown>;
        const msg = (errBody as any)?.error?.message ?? `Server error (${res.status})`;
        setError(msg);
        setMessages(prev => prev.filter(m => m.id !== clientId));
        return;
      }

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
          let evt: Record<string, unknown>;
          try { evt = JSON.parse(raw) as Record<string, unknown>; }
          catch { continue; }
          if (evt.type === "token") {
            setStreamingText(prev => prev + (evt.content as string));
          } else if (evt.type === "user_message") {
            // Reconcile: replace optimistic message with server-confirmed message
            setMessages(prev => [
              ...prev.filter(m => m.id !== clientId),
              evt.message as Message,
            ]);
          } else if (evt.type === "agent_message") {
            // Idempotent append — skip if the message is already in state.
            // Guard: server coerces agentMessage to null (never undefined) but a defensive
            // null check prevents a crash if the JSON key is missing for any reason.
            // Do NOT use optional chaining — the guard is intentional contract enforcement.
            const msg = evt.message as Message | null | undefined;
            if (msg) {
              setMessages(prev => {
                if (prev.some(m => m.id === msg.id)) return prev;
                return [...prev, msg];
              });
            }
            setStreamingText("");
	          } else if (evt.type === "task_auto_created") {
	            // CoS created and dispatched a task automatically — show a persistent card
	            const auto = evt as unknown as {
	              taskId: string; title: string;
	              dispatched: boolean; requiresApproval: boolean;
	            };
	            setAutoCreatedTask(auto);
	            setAutoCreatedTasks(prev => {
	              if (prev.some(task => task.taskId === auto.taskId)) return prev;
	              return [...prev, auto].slice(-5);
	            });
	            // Track the linked task so proposal cards know a task already exists
	            setLinkedTaskId(auto.taskId);
          } else if (evt.type === "done") {
            setIsStreaming(false);
          } else if (evt.type === "error") {
            setError((evt.message as string) ?? "The Chief of Staff encountered an error.");
            setStreamingText("");
            setMessages(prev => prev.filter(m => m.id !== clientId));
          }
        }
      }
    } catch (e: any) {
      if (e?.name === "AbortError") {
        // Aborted — remove optimistic message cleanly
        setMessages(prev => prev.filter(m => m.id !== clientId));
      } else {
        setError("Failed to send message.");
        // Keep message visible but mark as failed so user knows
        setMessages(prev => prev.map(m =>
          m.id === clientId ? { ...m, _pending: false, _failed: true } : m,
        ));
      }
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

  const handleCreateTask = async (title: string, summary: string, subjectParticipantId?: string, sourceUserRequest?: string) => {
    if (!conversationId || !slug || creatingTask) return;

    // If a task is already linked to this conversation, navigate there directly
    if (linkedTaskId) {
      setLocation(`/app/${slug}/tasks/${linkedTaskId}`);
      return;
    }

    setCreatingTask(true);
    try {
      const idempotencyKey = buildTaskCreateIdempotencyKey(conversationId, title, summary);
      const proposalKey = buildTaskProposalKey(title, summary);
      const r = await apiFetch(
        `/v1/organisations/${slug}/conversations/${conversationId}/create-task`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({
            title,
            description: summary,
            sourceUserRequest,
            idempotencyKey,
            subjectParticipantIds: subjectParticipantId ? [subjectParticipantId] : undefined,
          }),
        }
      );
      const d = await r.json();
      if (r.status === 409 && d?.error?.code === "PARTICIPANT_RESOLUTION_REQUIRED") {
        const participantResolution = d.error.participantResolution as ParticipantResolutionState | undefined;
        if (participantResolution) {
          setParticipantResolutionByProposal(prev => ({
            ...prev,
            [proposalKey]: participantResolution,
          }));
          setError(null);
        } else {
          setError(d?.error?.message ?? "Please confirm which participant this task is for.");
        }
        return;
      }
      if (r.status === 409 && d?.error?.code === "DUPLICATE_TASK") {
        // A task was already created for this conversation (e.g. by auto-dispatch).
        // Navigate to it if we have the ID, otherwise reload the conversation to fetch it.
        if (linkedTaskId) {
          setLocation(`/app/${slug}/tasks/${linkedTaskId}`);
        } else {
          // Re-fetch the conversation to get the primaryTaskId, then navigate
          const conv = await apiFetch(`/v1/organisations/${slug}/conversations`, {
            method: "POST",
            body: JSON.stringify({ conversationType: "general_workforce", title: "Workforce Chat" }),
          }).then(res => res.json()).catch(() => null);
          const taskId = conv?.conversation?.primaryTaskId;
          if (taskId) {
            setLinkedTaskId(taskId);
            setLocation(`/app/${slug}/tasks/${taskId}`);
          } else {
            setError("A task already exists for this conversation. Check Active Work to find it.");
          }
        }
        return;
      }
      if (!r.ok) {
        setError(d?.error?.message ?? `Failed to create task (${r.status}).`);
        return;
      }
      if (d.task) {
        setParticipantResolutionByProposal(prev => {
          const next = { ...prev };
          delete next[proposalKey];
          return next;
        });
        setLinkedTaskId(d.task.id);
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
              onConfirm={() => sendMessage("Confirm, please proceed.")}
              creatingTask={creatingTask}
              existingTaskId={linkedTaskId}
              participantResolution={
                msg.messageType === "task_proposal" && msg.structuredContent
                  ? participantResolutionByProposal[
                      buildTaskProposalKey(
                        ((msg.structuredContent as { data: TaskProposalData }).data).title,
                        ((msg.structuredContent as { data: TaskProposalData }).data).summary,
                      )
                    ]
                  : undefined
              }
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

          {/* Task #27 — Auto-dispatch notification card */}
	          {(autoCreatedTasks.length > 0 || autoCreatedTask) && (
	            <div className="mx-auto max-w-[75%] mb-4">
	              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-900/20 px-4 py-3">
	                <div className="flex items-start gap-3">
	                  <span className="text-emerald-400 text-lg mt-0.5">⚡</span>
	                  <div className="flex-1 min-w-0">
	                    <p className="text-emerald-400 text-xs font-semibold mb-0.5">
	                      {(autoCreatedTasks.length === 1 ? autoCreatedTasks[0] : autoCreatedTask)?.dispatched
	                        ? autoCreatedTasks.length > 1 ? "Tasks created — queued for execution" : "Task created — queued for execution"
	                        : autoCreatedTasks.length > 1 ? "Tasks created — readiness recorded" : "Task created — readiness recorded"}
	                    </p>
	                    {(autoCreatedTasks.length > 0 ? autoCreatedTasks : [autoCreatedTask!]).map(task => (
	                      <div key={task.taskId} className="mt-2">
	                        <p className="text-[#CBD5E1] text-sm font-medium truncate">{task.title}</p>
	                        {task.requiresApproval && (
	                          <p className="text-[#64748B] text-xs mt-0.5">
	                            Approval requirements are recorded; a concrete approval request appears only at the required gate.
	                          </p>
	                        )}
	                        <a
	                          href={`/app/${slug}/tasks/${task.taskId}`}
	                          className="inline-block mt-1 text-xs text-[#00D4FF] hover:underline"
	                        >
	                          View task →
	                        </a>
	                      </div>
	                    ))}
	                  </div>
	                  <button
	                    onClick={() => { setAutoCreatedTask(null); setAutoCreatedTasks([]); }}
                    className="text-[#475569] hover:text-[#94A3B8] text-xs shrink-0"
                    aria-label="Dismiss"
                  >
                    ✕
                  </button>
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
                onClick={() => sendMessage()}
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
