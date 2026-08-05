/**
 * Execution Checkpoint Service — Sprint 27.2
 *
 * Durable DB-backed replacement for the in-memory executionCheckpointStore.
 * Checkpoints survive API restarts, support atomic state transitions, and
 * enforce one active checkpoint per conversation.
 *
 * State machine:
 *   active → awaiting_clarification → resuming → resumed → completed
 *                                              ↘ failed
 *   (any) → cancelled | expired
 */

import { randomUUID } from "crypto";
import { eq, and, lt, or, inArray } from "drizzle-orm";
import { db, executionCheckpointsTable } from "@workspace/db";
import type { WorkBlueprint } from "./workBlueprintService.js";
import type { WorkPackageManifest } from "./workPackageService.js";
import { logOrgEvent } from "./auditService.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CheckpointPayload {
  originalRequest: string;
  blueprint: WorkBlueprint | null;
  manifest: WorkPackageManifest;
}

export interface CreateCheckpointInput {
  correlationId: string;
  conversationId: string;
  organizationId: string;
  taskId?: string;
  requesterId: string;
  specialistCode?: string;
  blueprintId?: string;
  workPackageManifestId?: string;
  clarificationQuestions: string[];
  payload: CheckpointPayload;
  /** TTL in milliseconds — defaults to 30 minutes */
  ttlMs?: number;
}

export interface ActiveCheckpoint {
  id: string;
  conversationId: string;
  organizationId: string;
  taskId: string | null;
  correlationId: string;
  status: string;
  clarificationQuestions: string[];
  clarificationAnswer: string | null;
  payload: CheckpointPayload;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface BeginResumeResult {
  resumed: boolean;
  reason?: "no_checkpoint" | "already_resuming" | "expired" | "invalid_status";
  checkpoint?: ActiveCheckpoint;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const ACTIVE_STATUSES = ["active", "awaiting_clarification"] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rowToCheckpoint(row: typeof executionCheckpointsTable.$inferSelect): ActiveCheckpoint {
  return {
    id:                     row.id,
    conversationId:         row.conversationId,
    organizationId:         row.organizationId,
    taskId:                 row.taskId,
    correlationId:          row.correlationId,
    status:                 row.status,
    clarificationQuestions: (row.clarificationQuestions as string[]) ?? [],
    clarificationAnswer:    row.clarificationAnswer,
    payload:                row.checkpointPayload as CheckpointPayload,
    createdAt:              row.createdAt,
    expiresAt:              row.expiresAt,
  };
}

function isExpired(row: typeof executionCheckpointsTable.$inferSelect): boolean {
  return !!row.expiresAt && row.expiresAt < new Date();
}

// ─── Operations ───────────────────────────────────────────────────────────────

/**
 * Create a new checkpoint. If an existing active checkpoint for the same
 * conversation exists, it is cancelled first (idempotent replacement).
 */
export async function createCheckpoint(input: CreateCheckpointInput): Promise<ActiveCheckpoint> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? DEFAULT_TTL_MS));
  const id = randomUUID();

  // Cancel any previous active checkpoint for this conversation
  await db
    .update(executionCheckpointsTable)
    .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
    .where(and(
      eq(executionCheckpointsTable.conversationId, input.conversationId),
      inArray(executionCheckpointsTable.status, [...ACTIVE_STATUSES]),
    ));

  const [row] = await db
    .insert(executionCheckpointsTable)
    .values({
      id,
      organizationId:         input.organizationId,
      conversationId:         input.conversationId,
      taskId:                 input.taskId,
      correlationId:          input.correlationId,
      specialistCode:         input.specialistCode,
      blueprintId:            input.blueprintId,
      workPackageManifestId:  input.workPackageManifestId,
      status:                 "awaiting_clarification",
      checkpointPayload:      input.payload as Record<string, unknown>,
      clarificationQuestions: input.clarificationQuestions,
      expiresAt,
      createdAt:              now,
      updatedAt:              now,
    })
    .returning();

  await logOrgEvent({
    eventType: "checkpoint.created",
    organizationId: input.organizationId,
    actorType: "system",
    resourceType: "conversation",
    resourceId: input.conversationId,
    metadata: {
      checkpointId: id,
      conversationId: input.conversationId,
      taskId: input.taskId,
      correlationId: input.correlationId,
      clarificationCount: input.clarificationQuestions.length,
    },
  }).catch(() => {});

  return rowToCheckpoint(row);
}

/**
 * Return the active (awaiting_clarification) checkpoint for a conversation,
 * or null if none exists or has expired.
 */
export async function getActiveCheckpointByConversation(
  conversationId: string,
): Promise<ActiveCheckpoint | null> {
  const [row] = await db
    .select()
    .from(executionCheckpointsTable)
    .where(and(
      eq(executionCheckpointsTable.conversationId, conversationId),
      inArray(executionCheckpointsTable.status, [...ACTIVE_STATUSES]),
    ))
    .limit(1);

  if (!row) return null;
  if (isExpired(row)) {
    await db
      .update(executionCheckpointsTable)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(executionCheckpointsTable.id, row.id));
    return null;
  }
  return rowToCheckpoint(row);
}

/** Boolean helper — safe to call before every message. */
export async function hasActiveCheckpoint(conversationId: string): Promise<boolean> {
  const cp = await getActiveCheckpointByConversation(conversationId);
  return cp !== null;
}

/**
 * Store the user's clarification answer against the checkpoint.
 * Idempotent — subsequent calls overwrite with the latest answer.
 */
export async function recordClarificationAnswer(
  checkpointId: string,
  answer: string,
): Promise<void> {
  await db
    .update(executionCheckpointsTable)
    .set({ clarificationAnswer: answer, updatedAt: new Date() })
    .where(eq(executionCheckpointsTable.id, checkpointId));
}

/**
 * Atomic compare-and-set transition: awaiting_clarification → resuming.
 * Returns { resumed: false, reason } if the checkpoint is already being
 * resumed (prevents duplicate resumes from two simultaneous replies).
 */
export async function beginResume(conversationId: string): Promise<BeginResumeResult> {
  const existing = await getActiveCheckpointByConversation(conversationId);
  if (!existing) {
    return { resumed: false, reason: "no_checkpoint" };
  }

  if (existing.status === "resuming") {
    return { resumed: false, reason: "already_resuming" };
  }

  // Atomic update: only transitions if still awaiting_clarification
  const updated = await db
    .update(executionCheckpointsTable)
    .set({ status: "resuming", resumedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(executionCheckpointsTable.id, existing.id),
      eq(executionCheckpointsTable.status, "awaiting_clarification"),
    ))
    .returning();

  if (updated.length === 0) {
    // Another request already transitioned it — idempotent result
    return { resumed: false, reason: "already_resuming" };
  }

  await logOrgEvent({
    eventType: "checkpoint.resume_started",
    organizationId: existing.organizationId,
    actorType: "system",
    resourceType: "conversation",
    resourceId: conversationId,
    metadata: { checkpointId: existing.id, correlationId: existing.correlationId },
  }).catch(() => {});

  return { resumed: true, checkpoint: { ...existing, status: "resuming" } };
}

export async function markResumed(checkpointId: string): Promise<void> {
  await db
    .update(executionCheckpointsTable)
    .set({ status: "resumed", updatedAt: new Date() })
    .where(eq(executionCheckpointsTable.id, checkpointId));
}

export async function markCompleted(checkpointId: string): Promise<void> {
  await db
    .update(executionCheckpointsTable)
    .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
    .where(eq(executionCheckpointsTable.id, checkpointId));
}

export async function markFailed(checkpointId: string): Promise<void> {
  await db
    .update(executionCheckpointsTable)
    .set({ status: "failed", updatedAt: new Date() })
    .where(eq(executionCheckpointsTable.id, checkpointId));
}

export async function cancelCheckpoint(checkpointId: string): Promise<void> {
  await db
    .update(executionCheckpointsTable)
    .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
    .where(eq(executionCheckpointsTable.id, checkpointId));
}

/**
 * Mark all awaiting_clarification checkpoints that have passed their
 * expiresAt as expired. Safe to call on a schedule (e.g. every 10 min).
 */
export async function expireStaleCheckpoints(): Promise<number> {
  const now = new Date();
  const result = await db
    .update(executionCheckpointsTable)
    .set({ status: "expired", updatedAt: now })
    .where(and(
      inArray(executionCheckpointsTable.status, [...ACTIVE_STATUSES]),
      lt(executionCheckpointsTable.expiresAt, now),
    ))
    .returning({ id: executionCheckpointsTable.id });

  return result.length;
}

/**
 * On startup: find any checkpoints that were mid-resume when the process died
 * and return them to awaiting_clarification so the user can retry.
 */
export async function recoverStuckResumes(): Promise<number> {
  const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
  const stuckCutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);

  const result = await db
    .update(executionCheckpointsTable)
    .set({ status: "awaiting_clarification", updatedAt: new Date() })
    .where(and(
      eq(executionCheckpointsTable.status, "resuming"),
      lt(executionCheckpointsTable.updatedAt, stuckCutoff),
    ))
    .returning({ id: executionCheckpointsTable.id });

  if (result.length > 0) {
    console.info(`[CheckpointService] Recovered ${result.length} stuck checkpoint(s) to awaiting_clarification`);
  }
  return result.length;
}

// ─── Test-only reset helper (preserved for backward compatibility) ─────────────

let _testResetCallback: (() => void) | null = null;
/** @internal — only for unit tests that need a clean slate */
export function _registerTestResetCallback(fn: () => void): void {
  _testResetCallback = fn;
}
/** @internal */
export function _resetForTesting(): void {
  _testResetCallback?.();
}
