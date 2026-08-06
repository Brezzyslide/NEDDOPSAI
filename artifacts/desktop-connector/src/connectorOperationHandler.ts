/**
 * connectorOperationHandler — Sprint 29F.2 (Part A)
 *
 * Desktop-side handler for connector_op_request relay messages.
 * Wired into the RelayClient as `onConnectorOpRequest`.
 *
 * Responsibilities:
 *   1. Classify the incoming operation as write (idempotency required) or
 *      read-only (no destructive-operation deduplication needed).
 *   2. For write operations: check desktop-side idempotency before executing.
 *      Return stored result on duplicate. Never execute a write twice.
 *   3. Execute the appropriate filesystem or stub operation.
 *   4. Finalise the idempotency record with the result.
 *   5. Return a structured ConnectorOpResponse.
 *
 * Operation support matrix:
 *   ✅ locate    — check file/directory exists
 *   ✅ search    — list files matching a pattern in a directory
 *   ✅ read      — read file content (text)
 *   ✅ inspect   — read file metadata (stat)
 *   ✅ write     — write/overwrite file content
 *   ✅ create    — create new file (exclusive)
 *   ✅ move      — move/rename a file or directory
 *   ⚠️ word_create / word_edit / word_export — OPERATION_NOT_AVAILABLE (requires Office)
 *   ⚠️ excel_update — OPERATION_NOT_AVAILABLE (requires Office)
 *   ⚠️ email_draft  — OPERATION_NOT_AVAILABLE (requires Outlook/Mail.app)
 *   ❌ email.send_email — UNSUPPORTED (intentionally blocked — not a current goal)
 *   ❌ browser_interaction — UNSUPPORTED
 *   ❌ terminal_command — UNSUPPORTED
 *
 * Security:
 *   - Path inputs are validated to prevent directory traversal.
 *   - Paths outside the user's home directory are rejected.
 *   - Maximum read size: 10MB.
 *   - Write content is size-limited to prevent disk exhaustion.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { Logger } from "pino";
import type { ConnectorOpResponse } from "./broker/relayClient.js";
import {
  checkDesktopIdempotency,
  beginDesktopIdempotencyRecord,
  finaliseDesktopIdempotencyRecord,
} from "./idempotencyStore.js";

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_READ_BYTES  = 10 * 1024 * 1024; // 10 MB
const MAX_WRITE_BYTES = 10 * 1024 * 1024; // 10 MB

// Write operations require idempotency protection.
// Read-only evidence operations do not.
const WRITE_OPERATION_TYPES = new Set([
  "write",
  "create",
  "move",
  "word_create",
  "word_edit",
  "word_export",
  "excel_update",
  "email_draft",
]);

// Operations that will never be supported (always fail closed)
const UNSUPPORTED_FOREVER = new Set([
  "email.send_email",
  "send_email",
  "browser_interaction",
  "terminal_command",
]);

// Office stubs — require installed Office applications, which we cannot assume
const OFFICE_STUBS = new Set([
  "word_create",
  "word_edit",
  "word_export",
  "excel_update",
  "email_draft",
]);

// ── Types ──────────────────────────────────────────────────────────────────────

export interface OperationHandlerConfig {
  organisationId: string;
  deviceId: string;
  logger: Logger;
}

// ── Path security ──────────────────────────────────────────────────────────────

function normalisePath(rawPath: string): string | null {
  if (!rawPath || typeof rawPath !== "string") return null;
  const resolved = path.resolve(rawPath);
  const home = os.homedir();
  // Reject paths outside home directory (defence-in-depth; acceptance tests use a temp dir)
  if (!resolved.startsWith(home)) return null;
  return resolved;
}

// ── Read-only operations ───────────────────────────────────────────────────────

async function executeLocate(rawPath: string): Promise<ConnectorOpResponse> {
  const safePath = normalisePath(rawPath);
  if (!safePath) {
    return { success: false, errorCode: "INVALID_PATH", errorMessage: "Path is invalid or outside allowed directory" };
  }
  try {
    await fs.access(safePath);
    const stat = await fs.stat(safePath);
    return {
      success: true,
      data: {
        found: true,
        path: safePath,
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile(),
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      },
    };
  } catch {
    return { success: true, data: { found: false, path: safePath } };
  }
}

async function executeRead(rawPath: string): Promise<ConnectorOpResponse> {
  const safePath = normalisePath(rawPath);
  if (!safePath) {
    return { success: false, errorCode: "INVALID_PATH", errorMessage: "Path is invalid or outside allowed directory" };
  }
  try {
    const stat = await fs.stat(safePath);
    if (stat.size > MAX_READ_BYTES) {
      return {
        success: false,
        errorCode: "FILE_TOO_LARGE",
        errorMessage: `File exceeds maximum read size of ${MAX_READ_BYTES / 1024 / 1024}MB`,
      };
    }
    const content = await fs.readFile(safePath, "utf-8");
    return {
      success: true,
      data: {
        path: safePath,
        content,
        size: stat.size,
        encoding: "utf-8",
        readAt: new Date().toISOString(),
      },
    };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { success: false, errorCode: "FILE_NOT_FOUND", errorMessage: `File not found: ${safePath}` };
    if (code === "EACCES") return { success: false, errorCode: "PERMISSION_DENIED", errorMessage: `Permission denied reading: ${safePath}` };
    return { success: false, errorCode: "READ_ERROR", errorMessage: String(err) };
  }
}

async function executeInspect(rawPath: string): Promise<ConnectorOpResponse> {
  const safePath = normalisePath(rawPath);
  if (!safePath) {
    return { success: false, errorCode: "INVALID_PATH", errorMessage: "Path is invalid or outside allowed directory" };
  }
  try {
    const stat = await fs.stat(safePath);
    return {
      success: true,
      data: {
        path: safePath,
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
        size: stat.size,
        createdAt: stat.birthtime.toISOString(),
        modifiedAt: stat.mtime.toISOString(),
        accessedAt: stat.atime.toISOString(),
        permissions: (stat.mode & 0o777).toString(8),
      },
    };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { success: false, errorCode: "FILE_NOT_FOUND", errorMessage: `Not found: ${safePath}` };
    return { success: false, errorCode: "INSPECT_ERROR", errorMessage: String(err) };
  }
}

async function executeSearch(rawDir: string, pattern: string): Promise<ConnectorOpResponse> {
  const safeDir = normalisePath(rawDir);
  if (!safeDir) {
    return { success: false, errorCode: "INVALID_PATH", errorMessage: "Directory path is invalid or outside allowed directory" };
  }
  try {
    const entries = await fs.readdir(safeDir, { withFileTypes: true, recursive: true });
    const lowerPattern = (pattern ?? "").toLowerCase();
    const matched = entries
      .filter(e => !lowerPattern || e.name.toLowerCase().includes(lowerPattern))
      .slice(0, 100) // cap results
      .map(e => ({
        name: e.name,
        path: path.join(e.parentPath ?? safeDir, e.name),
        isDirectory: e.isDirectory(),
      }));
    return { success: true, data: { directory: safeDir, pattern, results: matched, total: matched.length } };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { success: false, errorCode: "DIRECTORY_NOT_FOUND", errorMessage: `Directory not found: ${safeDir}` };
    return { success: false, errorCode: "SEARCH_ERROR", errorMessage: String(err) };
  }
}

// ── Write operations (protected by idempotency) ────────────────────────────────

async function executeWrite(rawPath: string, content: string): Promise<ConnectorOpResponse> {
  const safePath = normalisePath(rawPath);
  if (!safePath) {
    return { success: false, errorCode: "INVALID_PATH", errorMessage: "Path is invalid or outside allowed directory" };
  }
  if (content && Buffer.byteLength(content, "utf-8") > MAX_WRITE_BYTES) {
    return { success: false, errorCode: "CONTENT_TOO_LARGE", errorMessage: "Write content exceeds maximum size" };
  }
  try {
    await fs.mkdir(path.dirname(safePath), { recursive: true });
    await fs.writeFile(safePath, content ?? "", "utf-8");
    const stat = await fs.stat(safePath);
    return { success: true, data: { path: safePath, size: stat.size, writtenAt: new Date().toISOString() } };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES") return { success: false, errorCode: "PERMISSION_DENIED", errorMessage: `Permission denied writing: ${safePath}` };
    if (code === "EBUSY" || code === "ENOTEMPTY") return { success: false, errorCode: "FILE_LOCKED", errorMessage: `File is locked or in use: ${safePath}` };
    return { success: false, errorCode: "WRITE_ERROR", errorMessage: String(err) };
  }
}

async function executeCreate(rawPath: string, content: string): Promise<ConnectorOpResponse> {
  const safePath = normalisePath(rawPath);
  if (!safePath) {
    return { success: false, errorCode: "INVALID_PATH", errorMessage: "Path is invalid or outside allowed directory" };
  }
  if (content && Buffer.byteLength(content, "utf-8") > MAX_WRITE_BYTES) {
    return { success: false, errorCode: "CONTENT_TOO_LARGE", errorMessage: "Write content exceeds maximum size" };
  }
  try {
    await fs.mkdir(path.dirname(safePath), { recursive: true });
    // wx flag = create exclusively (fail if already exists)
    await fs.writeFile(safePath, content ?? "", { encoding: "utf-8", flag: "wx" });
    const stat = await fs.stat(safePath);
    return { success: true, data: { path: safePath, size: stat.size, createdAt: new Date().toISOString() } };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return { success: false, errorCode: "FILE_EXISTS", errorMessage: `File already exists: ${safePath}` };
    if (code === "EACCES") return { success: false, errorCode: "PERMISSION_DENIED", errorMessage: `Permission denied creating: ${safePath}` };
    return { success: false, errorCode: "CREATE_ERROR", errorMessage: String(err) };
  }
}

async function executeMove(rawSource: string, rawDest: string): Promise<ConnectorOpResponse> {
  const safeSource = normalisePath(rawSource);
  const safeDest   = normalisePath(rawDest);
  if (!safeSource || !safeDest) {
    return { success: false, errorCode: "INVALID_PATH", errorMessage: "Source or destination path is invalid or outside allowed directory" };
  }
  try {
    await fs.mkdir(path.dirname(safeDest), { recursive: true });
    await fs.rename(safeSource, safeDest);
    return { success: true, data: { source: safeSource, destination: safeDest, movedAt: new Date().toISOString() } };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { success: false, errorCode: "FILE_NOT_FOUND", errorMessage: `Source file not found: ${safeSource}` };
    if (code === "EACCES") return { success: false, errorCode: "PERMISSION_DENIED", errorMessage: `Permission denied moving: ${safeSource}` };
    return { success: false, errorCode: "MOVE_ERROR", errorMessage: String(err) };
  }
}

// ── Office stubs (OPERATION_NOT_AVAILABLE) ─────────────────────────────────────

function executeOfficeStub(operationType: string): ConnectorOpResponse {
  return {
    success: false,
    errorCode: "OPERATION_NOT_AVAILABLE",
    errorMessage:
      `The operation "${operationType}" requires an installed Office application ` +
      "(Microsoft Word, Excel, or Outlook). This operation is not available in the " +
      "current environment. Install and activate the required Office application " +
      "to enable this capability.",
  };
}

// ── Core handler ───────────────────────────────────────────────────────────────

/**
 * Process a single connector_op_request payload from the relay.
 * Wired into RelayClient.config.onConnectorOpRequest.
 */
export async function handleConnectorOpRequest(
  payload: Record<string, unknown>,
  config: OperationHandlerConfig,
): Promise<ConnectorOpResponse> {
  const requestId     = String(payload["requestId"] ?? "");
  const executionId   = String(payload["executionId"] ?? "");
  const operationType = String(payload["operationType"] ?? "");
  const rawPath       = String(payload["path"] ?? payload["query"] ?? "");
  const destination   = String(payload["destination"] ?? "");
  const pattern       = String(payload["pattern"] ?? "");
  const idempotencyKey = typeof payload["idempotencyKey"] === "string" ? payload["idempotencyKey"] : null;
  const parameters    = (payload["parameters"] ?? {}) as Record<string, unknown>;
  const content       = String(parameters["content"] ?? payload["content"] ?? "");

  const { organisationId, deviceId, logger } = config;

  // ── Reject permanently unsupported operations ──────────────────────────────
  if (UNSUPPORTED_FOREVER.has(operationType)) {
    logger.warn({ operationType, requestId }, "[connector-handler] Unsupported operation rejected");
    return {
      success: false,
      errorCode: "UNSUPPORTED_OPERATION",
      errorMessage:
        `The operation "${operationType}" is not permitted. ` +
        "NeedsOps Connector does not support sending emails, browser interaction, or terminal execution.",
    };
  }

  // ── Office stubs ────────────────────────────────────────────────────────────
  if (OFFICE_STUBS.has(operationType)) {
    logger.info({ operationType, requestId }, "[connector-handler] Office stub — OPERATION_NOT_AVAILABLE");
    // Still record idempotency for write stubs so duplicate deliveries don't confuse the relay
    if (idempotencyKey && WRITE_OPERATION_TYPES.has(operationType)) {
      const existing = checkDesktopIdempotency(organisationId, deviceId, idempotencyKey);
      if (existing) {
        if (existing.state === "completed" || existing.state === "failed") {
          return existing.finalResult ?? executeOfficeStub(operationType);
        }
      } else {
        beginDesktopIdempotencyRecord(organisationId, deviceId, idempotencyKey, requestId);
        const stubResult = executeOfficeStub(operationType);
        finaliseDesktopIdempotencyRecord(organisationId, deviceId, idempotencyKey, {
          success: false,
          errorCode: stubResult.errorCode,
          errorMessage: stubResult.errorMessage,
          completedAt: new Date().toISOString(),
        });
        return stubResult;
      }
    }
    return executeOfficeStub(operationType);
  }

  // ── Write operations: desktop-side idempotency ─────────────────────────────
  if (WRITE_OPERATION_TYPES.has(operationType) && idempotencyKey) {
    const existing = checkDesktopIdempotency(organisationId, deviceId, idempotencyKey);

    if (existing) {
      switch (existing.state) {
        case "executing":
          // Duplicate while in-flight — must not execute again
          logger.warn({ idempotencyKey, requestId }, "[connector-handler] Duplicate write detected (in-flight) — refusing re-execution");
          return {
            success: false,
            errorCode: "OPERATION_IN_PROGRESS",
            errorMessage: "This operation is currently in progress. Duplicate delivery received — no re-execution.",
          };

        case "completed":
        case "failed":
          // Duplicate after completion — return stored result without executing
          logger.info({ idempotencyKey, requestId, state: existing.state }, "[connector-handler] Duplicate write detected — returning stored result");
          if (existing.finalResult) {
            const r = existing.finalResult;
            return {
              success: r.success,
              data:    r.data,
              errorCode:    r.errorCode,
              errorMessage: r.errorMessage,
            };
          }
          break;
      }
    }

    // First time seeing this key — begin tracking
    beginDesktopIdempotencyRecord(organisationId, deviceId, idempotencyKey, requestId);
    logger.info({ operationType, idempotencyKey, requestId, executionId }, "[connector-handler] Executing write operation");

    const result = await executeWriteOperation(operationType, rawPath, destination, content, logger);

    finaliseDesktopIdempotencyRecord(organisationId, deviceId, idempotencyKey, {
      success:   result.success,
      data:      result.data,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      completedAt: new Date().toISOString(),
    });

    return result;
  }

  // ── Read-only operations (no idempotency protection needed) ────────────────
  logger.info({ operationType, requestId, executionId }, "[connector-handler] Executing read-only operation");
  return executeReadOperation(operationType, rawPath, pattern, logger);
}

// ── Operation router helpers ───────────────────────────────────────────────────

async function executeWriteOperation(
  operationType: string,
  rawPath: string,
  destination: string,
  content: string,
  logger: Logger,
): Promise<ConnectorOpResponse> {
  switch (operationType) {
    case "write":
      return executeWrite(rawPath, content);
    case "create":
      return executeCreate(rawPath, content);
    case "move":
      return executeMove(rawPath, destination);
    default:
      // Catch-all for any write type not yet implemented
      return { success: false, errorCode: "WRITE_TYPE_NOT_IMPLEMENTED", errorMessage: `Write operation "${operationType}" is not yet implemented` };
  }
}

async function executeReadOperation(
  operationType: string,
  rawPath: string,
  pattern: string,
  logger: Logger,
): Promise<ConnectorOpResponse> {
  switch (operationType) {
    case "locate":
      return executeLocate(rawPath);
    case "read":
      return executeRead(rawPath);
    case "inspect":
      return executeInspect(rawPath);
    case "search":
      return executeSearch(rawPath, pattern);
    default:
      return {
        success: false,
        errorCode: "UNKNOWN_OPERATION",
        errorMessage: `Unknown operation type: "${operationType}"`,
      };
  }
}
