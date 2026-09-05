/**
 * Execution Timeline Service — Sprint 27.1
 *
 * Builds a human-readable execution timeline from conversation execution_update
 * messages. No new DB tables — reuses messages already written by the
 * execution coordinator's lifecycle helpers.
 *
 * Timeline entries are ordered chronologically and surfaced in:
 *   - Completed Work detail
 *   - Governance Centre
 *   - Audit view
 *   - Workforce Operations Centre
 *
 * Never duplicates audit events — reads only from conversation messages.
 */

import { db, conversationMessagesTable, conversationsTable, completedWorkTable, withSystemTenantContext } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

type DbClient = typeof db;

function withExecutionTimelineTenant<T>(
  organizationId: string,
  purpose: string,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  return withSystemTenantContext(
    { tenantId: organizationId, serviceIdentity: "execution_timeline_service", purpose },
    fn,
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type TimelineEventKind =
  | "started"
  | "progress"
  | "clarification_requested"
  | "clarification_received"
  | "completed"
  | "failed"
  | "approved"
  | "rejected";

export interface TimelineEntry {
  id: string;
  timestamp: string;
  kind: TimelineEventKind;
  /** Human-readable label shown in UI */
  humanLabel: string;
  /** Optional link to completed work */
  completedWorkId?: string;
  /** The execution stage machine name if applicable */
  stage?: string;
  /** correlationId linking all events from the same execution run */
  correlationId?: string;
}

export interface ExecutionTimeline {
  conversationId: string;
  entries: TimelineEntry[];
  isComplete: boolean;
  hasFailure: boolean;
}

// ─── Event type → kind mapping ────────────────────────────────────────────────

const EVENT_KIND_MAP: Record<string, TimelineEventKind> = {
  "execution.started":               "started",
  "execution.step_started":          "progress",
  "execution.step_completed":        "progress",
  "execution.awaiting_approval":     "clarification_requested",
  "execution.paused":                "clarification_requested",
  "execution.resumed":               "clarification_received",
  "execution.completed":             "completed",
  "execution.failed":                "failed",
  "execution.cancelled":             "failed",
  "execution.accepted":              "started",
};

// ─── Core query ───────────────────────────────────────────────────────────────

/**
 * Returns the execution timeline for a conversation by reading its
 * execution_update messages in chronological order.
 */
export async function getConversationTimeline(
  organizationId: string,
  conversationId: string,
): Promise<ExecutionTimeline> {
  const messages = await withExecutionTimelineTenant(organizationId, "execution_timeline.conversation", async (client) => client
    .select()
    .from(conversationMessagesTable)
    .where(
      and(
        eq(conversationMessagesTable.organizationId, organizationId),
        eq(conversationMessagesTable.conversationId, conversationId),
        eq(conversationMessagesTable.messageType, "execution_update"),
      ),
    )
    .orderBy(conversationMessagesTable.createdAt));

  const entries: TimelineEntry[] = messages.map(m => {
    const data = (m.structuredContent as { data?: Record<string, unknown> } | null)?.data ?? {};
    const eventType = (data.eventType as string | undefined) ?? "";
    const kind: TimelineEventKind = EVENT_KIND_MAP[eventType] ?? "progress";

    return {
      id: m.id,
      timestamp: m.createdAt.toISOString(),
      kind,
      humanLabel: buildHumanLabel(m.content, eventType, data),
      completedWorkId: (data.completedWorkId as string | undefined) ?? undefined,
      stage: (data.stepName as string | undefined) ?? undefined,
      correlationId: m.correlationId ?? undefined,
    };
  });

  const isComplete = entries.some(e => e.kind === "completed");
  const hasFailure = entries.some(e => e.kind === "failed");

  return { conversationId, entries, isComplete, hasFailure };
}

/**
 * Returns the execution timeline for a completed work item by looking up
 * its linked conversation.
 */
export async function getCompletedWorkTimeline(
  organizationId: string,
  completedWorkId: string,
): Promise<ExecutionTimeline | null> {
  const [work] = await withExecutionTimelineTenant(organizationId, "execution_timeline.completed_work.lookup", async (client) => client
    .select({ conversationId: completedWorkTable.conversationId })
    .from(completedWorkTable)
    .where(
      and(
        eq(completedWorkTable.organizationId, organizationId),
        eq(completedWorkTable.id, completedWorkId),
      ),
    )
    .limit(1));

  if (!work?.conversationId) return null;
  return getConversationTimeline(organizationId, work.conversationId);
}

/**
 * Returns timelines for all conversations with execution activity in an org,
 * limited to the most recent N conversations.
 */
export async function getOrgExecutionTimelines(
  organizationId: string,
  limit = 20,
): Promise<ExecutionTimeline[]> {
  // Find conversations that have execution_update messages
  const convIds = await withExecutionTimelineTenant(organizationId, "execution_timeline.org_conversations", async (client) => client
    .selectDistinct({ conversationId: conversationMessagesTable.conversationId })
    .from(conversationMessagesTable)
    .where(
      and(
        eq(conversationMessagesTable.organizationId, organizationId),
        eq(conversationMessagesTable.messageType, "execution_update"),
      ),
    )
    .orderBy(desc(conversationMessagesTable.createdAt))
    .limit(limit));

  if (convIds.length === 0) return [];

  const timelines = await Promise.all(
    convIds.map(({ conversationId }) =>
      getConversationTimeline(organizationId, conversationId),
    ),
  );

  return timelines.filter(t => t.entries.length > 0);
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function buildHumanLabel(
  content: string,
  eventType: string,
  data: Record<string, unknown>,
): string {
  // Use rich content from the message itself when available (most descriptive)
  if (content && content.length < 200) return content;

  // Fallback to stage-based labels
  const stage = data.stepName as string | undefined;
  if (stage) return stage;
  if (eventType === "execution.completed") return "Work completed and ready for review.";
  if (eventType === "execution.failed") return "Execution encountered an error.";
  if (eventType === "execution.started") return "Execution started.";
  return "Execution update.";
}
