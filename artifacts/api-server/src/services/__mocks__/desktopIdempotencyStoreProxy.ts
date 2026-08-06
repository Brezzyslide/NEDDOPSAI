/**
 * desktopIdempotencyStoreProxy.ts
 *
 * In-process replica of the desktop-side idempotency store for use in
 * API-server tests that need to verify deduplication behaviour.
 *
 * The actual desktop store lives in artifacts/desktop-connector/src/idempotencyStore.ts
 * and cannot be cross-imported from the API-server vitest context.
 * This proxy mirrors the public interface exactly for testing purposes.
 */

interface DesktopRecord {
  organisationId: string;
  deviceId: string;
  idempotencyKey: string;
  requestId: string;
  state: "executing" | "completed" | "failed";
  startedAt: string;
  finalResult?: {
    success: boolean;
    data?: unknown;
    errorCode?: string;
    errorMessage?: string;
    completedAt?: string;
  };
}

const store = new Map<string, DesktopRecord>();

function storeKey(organisationId: string, deviceId: string, idempotencyKey: string): string {
  return `${organisationId}::${deviceId}::${idempotencyKey}`;
}

export function checkDesktopIdempotency(
  organisationId: string,
  deviceId: string,
  idempotencyKey: string,
): DesktopRecord | null {
  return store.get(storeKey(organisationId, deviceId, idempotencyKey)) ?? null;
}

export function beginDesktopIdempotencyRecord(
  organisationId: string,
  deviceId: string,
  idempotencyKey: string,
  requestId: string,
): void {
  const key = storeKey(organisationId, deviceId, idempotencyKey);
  if (store.has(key)) return; // idempotent — no-op on replay
  store.set(key, {
    organisationId, deviceId, idempotencyKey, requestId,
    state: "executing",
    startedAt: new Date().toISOString(),
  });
}

export function finaliseDesktopIdempotencyRecord(
  organisationId: string,
  deviceId: string,
  idempotencyKey: string,
  result: {
    success: boolean;
    data?: unknown;
    errorCode?: string;
    errorMessage?: string;
    completedAt?: string;
  },
): void {
  const key = storeKey(organisationId, deviceId, idempotencyKey);
  const existing = store.get(key);
  if (!existing) return;
  store.set(key, {
    ...existing,
    state: result.success ? "completed" : "failed",
    finalResult: result,
  });
}

export function _resetDesktopIdempotencyStore(): void {
  store.clear();
}
