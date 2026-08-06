/**
 * idempotencyStore — Sprint 29F.1 (Part 1, desktop side)
 *
 * Deduplication store for the NeedsOps Connector desktop runtime.
 *
 * The desktop connector may receive duplicate write operation requests from
 * the relay in these scenarios:
 *   - Lost acknowledgement: the connector completed but the server timed out
 *     before receiving the response, then retried with the same idempotencyKey.
 *   - Transport reconnect: the relay re-delivers unacknowledged frames on
 *     reconnect.
 *   - Duplicate relay messages: the server-side bridge sent the request twice
 *     before the first response was received.
 *
 * Key: `{organisationId}:{deviceId}:{idempotencyKey}`
 * A duplicate request with the same key returns the stored result (or
 * in-progress status) without executing the write a second time.
 *
 * Bounds:
 *   - Maximum 500 active entries (LRU eviction)
 *   - Entries expire after 24 hours
 */

export type DesktopIdempotencyState = "executing" | "completed" | "failed";

export interface DesktopIdempotencyRecord {
  key: string;
  state: DesktopIdempotencyState;
  requestId: string;
  firstReceivedAt: string;
  lastReceivedAt: string;
  attemptNumber: number;
  finalResult: DesktopIdempotencyResult | null;
}

export interface DesktopIdempotencyResult {
  success: boolean;
  data?: unknown;
  errorCode?: string;
  errorMessage?: string;
  completedAt: string;
}

const MAX_ENTRIES = 500;
const ENTRY_TTL_MS = 24 * 60 * 60 * 1_000;

const store = new Map<string, DesktopIdempotencyRecord>();

function buildKey(
  organisationId: string,
  deviceId: string,
  idempotencyKey: string,
): string {
  return `${organisationId}:${deviceId}:${idempotencyKey}`;
}

function purgeExpired(): void {
  const cutoff = Date.now() - ENTRY_TTL_MS;
  for (const [key, rec] of store) {
    if (new Date(rec.firstReceivedAt).getTime() < cutoff) {
      store.delete(key);
    }
  }
}

function evictLruIfNeeded(): void {
  if (store.size < MAX_ENTRIES) return;
  const oldest = store.keys().next().value;
  if (oldest) store.delete(oldest);
}

/**
 * Check whether a write operation with this idempotency key has been seen before.
 *
 * Returns:
 *   - null          — first occurrence, caller should proceed with execution
 *   - record with state "executing" — duplicate while in-flight, caller should wait/return in-progress
 *   - record with state "completed"/"failed" — duplicate after completion, return stored result
 */
export function checkDesktopIdempotency(
  organisationId: string,
  deviceId: string,
  idempotencyKey: string,
): DesktopIdempotencyRecord | null {
  const key = buildKey(organisationId, deviceId, idempotencyKey);
  const record = store.get(key);
  if (!record) return null;

  record.attemptNumber += 1;
  record.lastReceivedAt = new Date().toISOString();
  return record;
}

/**
 * Begin tracking a write operation on the desktop side.
 * Must be called before execution begins.
 */
export function beginDesktopIdempotencyRecord(
  organisationId: string,
  deviceId: string,
  idempotencyKey: string,
  requestId: string,
): DesktopIdempotencyRecord {
  purgeExpired();
  evictLruIfNeeded();

  const key = buildKey(organisationId, deviceId, idempotencyKey);
  const now = new Date().toISOString();

  const record: DesktopIdempotencyRecord = {
    key,
    state: "executing",
    requestId,
    firstReceivedAt: now,
    lastReceivedAt: now,
    attemptNumber: 0,
    finalResult: null,
  };

  store.set(key, record);
  return record;
}

/**
 * Finalise a record after execution completes or fails.
 */
export function finaliseDesktopIdempotencyRecord(
  organisationId: string,
  deviceId: string,
  idempotencyKey: string,
  result: DesktopIdempotencyResult,
): void {
  const key = buildKey(organisationId, deviceId, idempotencyKey);
  const record = store.get(key);
  if (!record) return;

  record.state = result.success ? "completed" : "failed";
  record.finalResult = result;
  record.lastReceivedAt = new Date().toISOString();
}

/** FOR TEST USE ONLY */
export function _resetDesktopIdempotencyStore(): void {
  store.clear();
}
