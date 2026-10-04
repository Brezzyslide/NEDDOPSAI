export type IngestionErrorCategory = "transient" | "permanent" | "unknown";

/** Codes that are inherently permanent — the document itself is the problem. */
const PERMANENT_CODES = new Set([
  "UNSUPPORTED_FILE_TYPE", "CORRUPTED_DOCUMENT", "CORRUPTED_FILE",
  "ENCRYPTED_DOCUMENT", "EMPTY_DOCUMENT", "OVERSIZED_CONTENT",
  "NO_CHUNKS", "SENSITIVITY_BLOCKED", "MISSING_STORAGE_KEY",
  "INVALID_STORAGE_KEY", "SOURCE_REVOKED", "SOURCE_NOT_FOUND", "VERSION_NOT_FOUND",
  "OBJECT_NOT_FOUND", "STORAGE_NOT_CONFIGURED", "STORAGE_MISCONFIGURED",
  "JOB_NOT_FOUND", "EXTRACTION_FAILED_PERMANENT",
]);

/** Codes that are transient — infrastructure/network, worth retrying. */
const TRANSIENT_CODES = new Set([
  "FETCH_FAILED_TRANSIENT", "EMBEDDING_TIMEOUT", "EMBEDDING_UNAVAILABLE",
  "STORAGE_TIMEOUT", "DB_TIMEOUT",
]);

export function classifyIngestionError(code: string, err?: unknown): IngestionErrorCategory {
  if (PERMANENT_CODES.has(code)) return "permanent";
  if (TRANSIENT_CODES.has(code)) return "transient";
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  if (
    msg.includes("timeout") || msg.includes("econnrefused") ||
    msg.includes("econnreset") || msg.includes("etimedout") ||
    msg.includes("network error") || msg.includes("socket hang up")
  ) return "transient";
  return "unknown";
}
