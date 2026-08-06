/**
 * writeIdempotencyService — Sprint 29F.1 (Connector Hardening, Part 1)
 *
 * Server-side deduplication store for connector write operations.
 *
 * Prevents duplicate writes caused by:
 *   - Lost acknowledgements (the server dispatched but the reply was dropped)
 *   - Duplicate relay messages (the client retried delivery)
 *   - Transport reconnect replay (the relay re-sends unacknowledged frames)
 *   - Timeout-after-success (the connector completed but the server timed out)
 *
 * Dedup key: `{organisationId}:{deviceId}:{idempotencyKey}`
 *
 * Behaviour:
 *   1. First request  → not found → caller executes → records result
 *   2. Duplicate while executing → returns IdempotencyState "executing"
 *   3. Duplicate after completion → returns stored completed/failed result
 *   4. Duplicate after failure → returns stored failed result
 *      (human retry must use a NEW idempotency key — never automatic re-key)
 *
 * Bounds:
 *   - Maximum 1 000 active entries (LRU eviction when exceeded)
 *   - Entries expire after ENTRY_TTL_MS (24 hours)
 *
 * This store is intentionally in-memory. On cold start, the execution_actions
 * DB table can be used to reconstruct completed/failed states for idempotency
 * checks (see executionActionLifecycleService).
 */

import { logger } from "../lib/logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type IdempotencyState = "executing" | "completed" | "failed";

export interface IdempotencyRecord {
  /** Composite key used for store lookup */
  key: string;
  state: IdempotencyState;
  /** ISO timestamp of the first request received */
  firstReceivedAt: string;
  /** ISO timestamp of the most recent request received (for duplicate detection) */
  lastReceivedAt: string;
  /** Zero for the first attempt; incremented on each duplicate check */
  attemptNumber: number;
  /** The operation ID that is/was executing (same as requestId from bridge) */
  operationId: string;
  /** The actionId from the ExecutionAction */
  actionId: string;
  /** The executionId this action belongs to */
  executionId: string;
  /** The final result once execution completes — null while executing */
  finalResult: IdempotencyResult | null;
}

export interface IdempotencyResult {
  success: boolean;
  status: "completed" | "failed";
  completedAt: string;
  /** Opaque connector-returned data (safe subset) */
  data?: unknown;
  errorCode?: string;
  errorMessage?: string;
}

export interface IdempotencyCheckResult {
  /** Whether a matching record exists */
  found: boolean;
  /** The record if found */
  record?: IdempotencyRecord;
  /** True when the same operation is already in-flight */
  isExecuting?: boolean;
  /** True when the result was already stored (duplicate request after completion) */
  isDuplicate?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of entries before LRU eviction. */
const MAX_ENTRIES = 1_000;

/** How long a completed/failed entry is retained (24 hours). */
const ENTRY_TTL_MS = 24 * 60 * 60 * 1_000;

// ─── Internal store ────────────────────────────────────────────────────────────

// Using a Map preserves insertion order for LRU eviction (oldest inserted = first).
const store = new Map<string, IdempotencyRecord>();

// Periodic cleanup timer
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanupRunning(): void {
  if (cleanupTimer) return;
  // Run cleanup every 30 minutes
  cleanupTimer = setInterval(purgeExpiredEntries, 30 * 60 * 1_000);
  // Allow Node.js to exit even with timer running
  if (cleanupTimer.unref) cleanupTimer.unref();
}

function purgeExpiredEntries(): void {
  const cutoff = Date.now() - ENTRY_TTL_MS;
  let removed = 0;
  for (const [key, record] of store) {
    if (new Date(record.firstReceivedAt).getTime() < cutoff) {
      store.delete(key);
      removed++;
    }
  }
  if (removed > 0) {
    logger.debug({ removed, remaining: store.size }, "[idempotency] Purged expired entries");
  }
}

function evictLruIfNeeded(): void {
  if (store.size < MAX_ENTRIES) return;
  // Map.keys() returns insertion order — first entry is oldest
  const oldest = store.keys().next().value;
  if (oldest) {
    store.delete(oldest);
    logger.debug({ key: oldest }, "[idempotency] LRU eviction");
  }
}

function buildKey(organisationId: string, deviceId: string, idempotencyKey: string): string {
  return `${organisationId}:${deviceId}:${idempotencyKey}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check whether an idempotency key has already been seen.
 *
 * Call this BEFORE dispatching a write operation to the connector.
 * If the result is `found === true`, callers must NOT re-execute and should
 * instead return the stored result or wait for the in-progress operation.
 */
export function checkIdempotency(
  organisationId: string,
  deviceId: string,
  idempotencyKey: string,
): IdempotencyCheckResult {
  const key = buildKey(organisationId, deviceId, idempotencyKey);
  const record = store.get(key);

  if (!record) return { found: false };

  // Increment attempt count on each check after the first
  record.attemptNumber += 1;
  record.lastReceivedAt = new Date().toISOString();

  if (record.state === "executing") {
    return { found: true, record, isExecuting: true, isDuplicate: false };
  }

  // completed or failed — return stored result
  return { found: true, record, isExecuting: false, isDuplicate: true };
}

/**
 * Begin an idempotency record for a write operation that is about to be dispatched.
 *
 * Must be called immediately before the connector dispatch so that concurrent
 * duplicate requests see `state: "executing"` and do not double-dispatch.
 */
export function beginIdempotencyRecord(
  organisationId: string,
  deviceId: string,
  idempotencyKey: string,
  operationId: string,
  actionId: string,
  executionId: string,
): IdempotencyRecord {
  ensureCleanupRunning();
  evictLruIfNeeded();

  const key = buildKey(organisationId, deviceId, idempotencyKey);
  const now = new Date().toISOString();

  const record: IdempotencyRecord = {
    key,
    state: "executing",
    firstReceivedAt: now,
    lastReceivedAt: now,
    attemptNumber: 0,
    operationId,
    actionId,
    executionId,
    finalResult: null,
  };

  store.set(key, record);
  return record;
}

/**
 * Finalise an idempotency record after the connector returns a result.
 *
 * Stores the result so duplicate requests return the same outcome without
 * re-executing.
 */
export function finaliseIdempotencyRecord(
  organisationId: string,
  deviceId: string,
  idempotencyKey: string,
  result: IdempotencyResult,
): void {
  const key = buildKey(organisationId, deviceId, idempotencyKey);
  const record = store.get(key);

  if (!record) {
    logger.warn({ key }, "[idempotency] finalise called for unknown key (record may have been evicted)");
    return;
  }

  record.state = result.status;
  record.finalResult = result;
  record.lastReceivedAt = new Date().toISOString();
}

/**
 * FOR TEST USE ONLY — clears the entire dedup store.
 */
export function _resetIdempotencyStore(): void {
  store.clear();
}
