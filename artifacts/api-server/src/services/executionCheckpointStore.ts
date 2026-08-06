/**
 * Execution Checkpoint Store — Sprint 27.1
 *
 * @legacy ISOLATED — Sprint 29F.1 classification: RETAIN TEMPORARILY
 *
 * This in-memory store has been SUPERSEDED by the DB-backed executionCheckpointService
 * (lib/db/src/schema/executionCheckpoints.ts + sprint272-checkpoint-persist.sql).
 * It is retained only because sprint271 tests reference it directly.
 *
 * DO NOT add new callers. Use executionCheckpointService for all new code.
 * Remove when sprint271 tests are migrated.
 *
 * ───────────────────────────────────────────────────────
 * ORIGINAL DESCRIPTION (Sprint 27.1):
 *
 * In-memory store for pipeline checkpoints.
 * Allows the work execution pipeline to pause at validation when clarification
 * is required, then RESUME from the same point after the user responds —
 * without rebuilding the blueprint or reassembling the work package.
 *
 * Checkpoints expire after 30 minutes. Cleanup runs on access and on a
 * periodic timer so abandoned checkpoints never accumulate.
 *
 * NOTE: In-process storage only — checkpoints are lost on server restart.
 */

import type { WorkPackageManifest } from "./workPackageService.js";
import type { WorkBlueprint } from "./workBlueprintService.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExecutionCheckpoint {
  /** Unique ID for this checkpoint — matches the execution correlationId */
  correlationId: string;
  /** Conversation that owns this checkpoint (used as lookup key) */
  conversationId: string;
  organizationId: string;
  requesterId: string;
  /** Original user request text */
  originalRequest: string;
  /** Blueprint selected in stage 1 (may be null if none matched) */
  blueprint: WorkBlueprint | null;
  /** Work package manifest assembled in stage 2 */
  manifest: WorkPackageManifest;
  /** The clarification questions returned by validation */
  clarificationQuestions: string[];
  /** ISO timestamp when this checkpoint was created */
  createdAt: string;
  /** ISO timestamp when this checkpoint expires */
  expiresAt: string;
}

// ─── Store ────────────────────────────────────────────────────────────────────

const CHECKPOINT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // clean up every 5 minutes

// Primary key: conversationId (one active checkpoint per conversation)
const store = new Map<string, ExecutionCheckpoint>();

/** Start background cleanup timer. */
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [convId, cp] of store.entries()) {
    if (new Date(cp.expiresAt).getTime() < now) {
      store.delete(convId);
    }
  }
}, CLEANUP_INTERVAL_MS);

// Allow process to exit without waiting for this timer
if (cleanupTimer.unref) cleanupTimer.unref();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Save a checkpoint for a conversation.
 * Overwrites any existing checkpoint for the same conversation.
 */
export function saveCheckpoint(checkpoint: Omit<ExecutionCheckpoint, "createdAt" | "expiresAt">): void {
  const now = Date.now();
  const full: ExecutionCheckpoint = {
    ...checkpoint,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CHECKPOINT_TTL_MS).toISOString(),
  };
  store.set(checkpoint.conversationId, full);
}

/**
 * Retrieve the active checkpoint for a conversation, or null if none/expired.
 */
export function getCheckpoint(conversationId: string): ExecutionCheckpoint | null {
  const cp = store.get(conversationId);
  if (!cp) return null;
  if (new Date(cp.expiresAt).getTime() < Date.now()) {
    store.delete(conversationId);
    return null;
  }
  return cp;
}

/**
 * Remove the active checkpoint for a conversation (called on resume or cancel).
 */
export function clearCheckpoint(conversationId: string): void {
  store.delete(conversationId);
}

/**
 * Check whether a conversation has an active (non-expired) checkpoint.
 */
export function hasActiveCheckpoint(conversationId: string): boolean {
  return getCheckpoint(conversationId) !== null;
}
