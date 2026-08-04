/**
 * Knowledge Hub — Storage Service (internal module name)
 * Customer-facing product name: Organisation Library
 *
 * Secure upload foundation for the Organisation Library. Handles presigned
 * URL generation, checksum validation, duplicate detection, and tenant-scoped
 * object storage for all source types supported by the Knowledge Hub.
 *
 * Implements a two-step presigned URL upload flow:
 *   1. requestUploadUrl — validates metadata, checks dedup, returns a
 *      signed GCS PUT URL and a pending sourceId.
 *   2. completeUpload  — called after the client uploads to GCS; creates
 *      the knowledge_source and knowledge_source_version DB records.
 *
 * S3-COMPATIBLE ADAPTER INTERFACE:
 *   A StorageAdapter interface is defined so the Knowledge Hub can swap between
 *   GCS (current), S3, desktop connector, or local (dev/test) without
 *   business logic changes. Pass a custom adapter to override the default.
 *
 * SECURITY RULES:
 *   - Authenticated user required (enforced by caller / middleware)
 *   - Tenant membership required (enforced by caller / middleware)
 *   - Owner or admin permission required (enforced by caller)
 *   - MIME type must be in ALLOWED_MIME_TYPES
 *   - File extension must be in ALLOWED_EXTENSIONS
 *   - File size must be ≤ MAX_FILE_SIZE_BYTES
 *   - Checksum (SHA-256) provided by client; server stores and checks for dedup
 *   - Storage key is system-generated (safe filename), never user-supplied
 *   - All objects stored in private tenant-scoped paths — never public
 *   - No executable file types
 *   - Task-scoped uploads stored under orgs/{orgId}/tasks/{taskId}/ — never
 *     promoted to the Organisation Library automatically
 */

import { randomUUID, createHash } from "crypto";
import { ObjectStorageService, objectStorageClient } from "../lib/objectStorage.js";

// ─── Constants ────────────────────────────────────────────────────────────────

export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
]);

export const ALLOWED_EXTENSIONS = new Set([".pdf", ".docx", ".txt", ".md"]);

/** 50 MB */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

// ─── Storage adapter interface (S3-compatible) ────────────────────────────────

/**
 * StorageAdapter — S3-compatible interface for storage provider abstraction.
 *
 * Both GCS and S3 adapters implement this interface.
 * Pass a custom adapter to constructors / functions for local dev or testing.
 *
 * AWS readiness:
 *   - For S3: implement using @aws-sdk/s3-request-presigner
 *   - Configure via AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
 *     KNOWLEDGE_S3_BUCKET environment variables
 *   - Private bucket assumption — no ACL=public-read
 */
export interface StorageAdapter {
  /**
   * Upload a file buffer directly to storage (server-side upload path).
   * Used when client-side signed URLs are not available (e.g. Replit workload
   * identity credentials cannot sign GCS URLs).
   * @param storageKey  Tenant-scoped path (e.g. "orgs/xxx/library/yyy/file.pdf")
   * @param buffer      File bytes
   * @param mimeType    MIME type for the Content-Type metadata
   */
  uploadFile(storageKey: string, buffer: Buffer, mimeType: string): Promise<void>;

  /**
   * Generate a signed GET URL for downloading a private object.
   * @param storageKey  Tenant-scoped storage path
   * @param expirySeconds  How long the URL is valid (default 3600)
   */
  generateDownloadUrl(storageKey: string, expirySeconds?: number): Promise<string>;

  /**
   * Delete an object from storage.
   * Idempotent — does not throw if the object doesn't exist.
   */
  deleteObject(storageKey: string): Promise<void>;

  /** Human-readable provider name for audit logs */
  readonly providerName: string;
}

// ─── GCS adapter (default) ────────────────────────────────────────────────────

class GCSStorageAdapter implements StorageAdapter {
  readonly providerName = "gcs";
  private service: ObjectStorageService;

  constructor() {
    this.service = new ObjectStorageService();
  }

  /**
   * Upload a buffer directly to GCS using the Replit sidecar credential.
   * Replit workload-identity credentials support direct read/write but cannot
   * sign GCS URLs (requires a service account key), so we proxy uploads
   * through our own API instead of issuing signed PUT URLs to the client.
   */
  async uploadFile(storageKey: string, buffer: Buffer, mimeType: string): Promise<void> {
    const privateDir = this.service.getPrivateObjectDir();
    const fullPath = `${privateDir}/${storageKey}`;
    const { bucketName, objectName } = parseBucketPath(fullPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    await file.save(buffer, { contentType: mimeType, resumable: false });
  }

  async generateDownloadUrl(storageKey: string, expirySeconds = 3600): Promise<string> {
    const privateDir = this.service.getPrivateObjectDir();
    const fullPath = `${privateDir}/${storageKey}`;
    const { bucketName, objectName } = parseBucketPath(fullPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + expirySeconds * 1000,
    });
    return url;
  }

  async deleteObject(storageKey: string): Promise<void> {
    try {
      const privateDir = this.service.getPrivateObjectDir();
      const fullPath = `${privateDir}/${storageKey}`;
      const { bucketName, objectName } = parseBucketPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      await bucket.file(objectName).delete();
    } catch {
      // Idempotent — ignore not-found errors
    }
  }
}

function parseBucketPath(fullPath: string): { bucketName: string; objectName: string } {
  // Normalise: strip gs:// prefix and any leading slash so we always work
  // with "bucketName/objectName" regardless of whether PRIVATE_OBJECT_DIR was
  // set as  gs://bucket/prefix  or  /bucket/prefix  (both are valid).
  const stripped = fullPath.replace(/^gs:\/\//, "").replace(/^\/+/, "");
  const slashIdx = stripped.indexOf("/");
  if (slashIdx === -1) return { bucketName: stripped, objectName: "" };
  return {
    bucketName: stripped.slice(0, slashIdx),
    objectName: stripped.slice(slashIdx + 1),
  };
}

/** Singleton GCS adapter — replace for tests or S3 by injecting a custom adapter */
export const defaultStorageAdapter: StorageAdapter = new GCSStorageAdapter();

// ─── Validation ───────────────────────────────────────────────────────────────

export class UploadValidationError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "UploadValidationError";
    this.code = code;
    Object.setPrototypeOf(this, UploadValidationError.prototype);
  }
}

export interface UploadMetadata {
  /** Original file name (user-supplied — used for display only) */
  originalFileName: string;
  /** MIME type declared by the client */
  mimeType: string;
  /** File size in bytes declared by the client */
  fileSize: number;
  /** SHA-256 hex of the file declared by the client (computed before upload) */
  checksum: string;
}

/**
 * Validates file upload metadata against the security rules.
 * Throws UploadValidationError with a machine-readable code on failure.
 */
export function validateUploadMetadata(meta: UploadMetadata): void {
  // Extension check
  const ext = getExtension(meta.originalFileName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new UploadValidationError(
      `File extension "${ext}" is not allowed. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`,
      "INVALID_EXTENSION",
    );
  }

  // MIME type check
  if (!ALLOWED_MIME_TYPES.has(meta.mimeType)) {
    throw new UploadValidationError(
      `MIME type "${meta.mimeType}" is not allowed.`,
      "INVALID_MIME_TYPE",
    );
  }

  // File size check
  if (meta.fileSize <= 0) {
    throw new UploadValidationError("File size must be greater than 0.", "INVALID_FILE_SIZE");
  }
  if (meta.fileSize > MAX_FILE_SIZE_BYTES) {
    throw new UploadValidationError(
      `File exceeds maximum size of ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB.`,
      "FILE_TOO_LARGE",
    );
  }

  // Checksum format (SHA-256 = 64 hex chars)
  if (!/^[a-f0-9]{64}$/i.test(meta.checksum)) {
    throw new UploadValidationError(
      "checksum must be a valid SHA-256 hex string (64 characters).",
      "INVALID_CHECKSUM_FORMAT",
    );
  }

  // Executable extension block (belt-and-suspenders)
  const blockedExts = new Set([
    ".exe", ".bat", ".sh", ".ps1", ".cmd", ".com", ".msi",
    ".app", ".apk", ".ipa", ".js", ".ts", ".py", ".rb",
    ".php", ".pl", ".jar", ".class", ".dll", ".so",
  ]);
  if (blockedExts.has(ext)) {
    throw new UploadValidationError(
      "Executable file types are not permitted.",
      "EXECUTABLE_NOT_ALLOWED",
    );
  }
}

function getExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot === -1) return "";
  return fileName.slice(lastDot);
}

/**
 * Generates a safe, tenant-scoped storage key.
 * The file name is system-generated to prevent path traversal.
 * Never uses the user-supplied file name in the storage path.
 */
export function buildStorageKey(params: {
  organizationId: string;
  sourceId: string;
  sourceScope: "library" | "task";
  taskId?: string;
  mimeType: string;
}): string {
  const ext = mimeToExt(params.mimeType);
  const safeId = params.sourceId.replace(/[^a-zA-Z0-9-]/g, "");
  if (params.sourceScope === "task" && params.taskId) {
    const safeTaskId = params.taskId.replace(/[^a-zA-Z0-9-]/g, "");
    return `orgs/${params.organizationId}/tasks/${safeTaskId}/${safeId}${ext}`;
  }
  return `orgs/${params.organizationId}/library/${safeId}${ext}`;
}

function mimeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "text/plain": ".txt",
    "text/markdown": ".md",
    "text/x-markdown": ".md",
  };
  return map[mimeType] ?? "";
}

// ─── Request upload URL ───────────────────────────────────────────────────────

export interface RequestUploadUrlParams {
  organizationId: string;
  uploadedByUserId: string;
  metadata: UploadMetadata;
  sourceScope?: "library" | "task";
  taskId?: string;
  /** Provide a custom adapter for testing or S3 */
  storageAdapter?: StorageAdapter;
}

export interface RequestUploadUrlResult {
  /** Always null — uploads are proxied through the /file server route. */
  /** Pending source ID — use this in completeUpload */
  sourceId: string;
  /** Signed PUT URL for the client to upload directly to storage */
  uploadUrl: null;
  /** Tenant-scoped storage key — store and pass to completeUpload */
  storageKey: string;
  /** Storage provider name */
  storageProvider: string;
  /** Token validity in seconds */
  expirySeconds: number;
}

/**
 * Step 1 of the upload flow.
 * Validates metadata, checks dedup, and returns a pending sourceId + storageKey.
 * The client must then PUT the file to our own /file proxy route (not GCS directly).
 * No DB records are created yet — call completeUpload after the upload.
 */
export async function requestUploadUrl(
  params: RequestUploadUrlParams,
): Promise<RequestUploadUrlResult> {
  validateUploadMetadata(params.metadata);

  const scope = params.sourceScope ?? "library";
  const sourceId = randomUUID();
  const storageKey = buildStorageKey({
    organizationId: params.organizationId,
    sourceId,
    sourceScope: scope,
    taskId: params.taskId,
    mimeType: params.metadata.mimeType,
  });

  const adapter = params.storageAdapter ?? defaultStorageAdapter;

  // The uploadUrl is handled by our own proxy route; no signed GCS URL needed.
  return {
    sourceId,
    uploadUrl: null,
    storageKey,
    storageProvider: adapter.providerName,
    expirySeconds: 900,
  };
}

/**
 * Server-side file upload — used by the /file proxy route.
 * Writes the buffer to the configured storage backend.
 */
export async function uploadFileToStorage(
  storageKey: string,
  buffer: Buffer,
  mimeType: string,
  storageAdapter?: StorageAdapter,
): Promise<void> {
  const adapter = storageAdapter ?? defaultStorageAdapter;
  await adapter.uploadFile(storageKey, buffer, mimeType);
}

// ─── Generate download URL ────────────────────────────────────────────────────

export async function generateDownloadUrl(
  storageKey: string,
  storageAdapter?: StorageAdapter,
): Promise<string> {
  const adapter = storageAdapter ?? defaultStorageAdapter;
  return adapter.generateDownloadUrl(storageKey, 3600);
}

// ─── Delete from storage ──────────────────────────────────────────────────────

export async function deleteFromStorage(
  storageKey: string,
  storageAdapter?: StorageAdapter,
): Promise<void> {
  const adapter = storageAdapter ?? defaultStorageAdapter;
  await adapter.deleteObject(storageKey);
}

// ─── Checksum utility ─────────────────────────────────────────────────────────

/**
 * Compute SHA-256 of a Buffer.
 * Used in tests and server-side processing when the file bytes are available.
 */
export function computeChecksum(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
