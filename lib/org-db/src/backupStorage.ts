/**
 * Backup Storage Provider — Sprint 7.1
 *
 * Abstraction layer for storing encrypted backup payloads outside application
 * memory. Swap the provider to change the backing storage without modifying
 * business logic.
 *
 * Current implementations:
 *   FilesystemBackupProvider  — writes to local disk (dev/test backend)
 *   ReplitObjectStorageProvider — writes to GCS via Replit Object Storage
 *
 * Future providers:
 *   S3BackupProvider          — Amazon S3
 *   R2BackupProvider          — Cloudflare R2
 *   GCSBackupProvider         — Google Cloud Storage (direct)
 *   AzureBlobBackupProvider   — Azure Blob Storage
 *
 * Security:
 *   • All payloads are AES-256-GCM encrypted before reaching this layer.
 *   • The provider stores and retrieves opaque bytes — it never decrypts.
 *   • Each backup is namespaced by organisationId to prevent cross-org
 *     retrieval at the storage level.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";

// ─── Interface ────────────────────────────────────────────────────────────────

export interface BackupStorageProvider {
  /**
   * Stores an encrypted backup payload.
   * Returns a storage reference (opaque string) for later retrieval.
   */
  store(organizationId: string, backupId: string, encryptedPayload: string): Promise<string>;

  /**
   * Retrieves an encrypted payload by storage reference.
   * Throws if not found or if the reference belongs to a different org.
   */
  retrieve(organizationId: string, storageRef: string): Promise<string>;

  /**
   * Deletes a backup by storage reference.
   */
  delete(organizationId: string, storageRef: string): Promise<void>;

  /**
   * Returns true if the backup exists.
   */
  exists(organizationId: string, storageRef: string): Promise<boolean>;

  /**
   * Lists all backup references for an organisation, ordered newest-first.
   */
  list(organizationId: string): Promise<string[]>;

  /**
   * Provider name (for logging and audit).
   */
  readonly providerName: string;
}

export class BackupStorageError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = "BackupStorageError";
  }
}

// ─── Filesystem provider (dev / test) ────────────────────────────────────────

/**
 * FilesystemBackupProvider
 *
 * Stores encrypted backups as files on the local filesystem.
 * Suitable for development and testing. Data persists across server restarts
 * within the Replit workspace environment.
 *
 * Storage layout:
 *   <baseDir>/<orgId>/<backupId>.enc
 *
 * ⚠️  NOT for production use — use a cloud provider (GCS, S3, R2, Azure)
 * before handling real client data.
 */
export class FilesystemBackupProvider implements BackupStorageProvider {
  readonly providerName = "filesystem";

  constructor(private readonly baseDir: string = "/home/runner/workspace/.backup-store") {}

  private orgDir(organizationId: string): string {
    // Sanitise: only allow UUID characters
    if (!/^[0-9a-f-]{36}$/.test(organizationId)) {
      throw new BackupStorageError(`Invalid organizationId format: ${organizationId}`);
    }
    return join(this.baseDir, organizationId);
  }

  private refToPath(organizationId: string, storageRef: string): string {
    const dir = this.orgDir(organizationId);
    // storageRef must be a backupId (UUID) — no path traversal
    const match = storageRef.match(/^([0-9a-f-]{36})$/);
    if (!match) throw new BackupStorageError(`Invalid storageRef: ${storageRef}`);
    return join(dir, `${storageRef}.enc`);
  }

  async store(organizationId: string, backupId: string, encryptedPayload: string): Promise<string> {
    const dir = this.orgDir(organizationId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = this.refToPath(organizationId, backupId);
    writeFileSync(path, encryptedPayload, "utf8");
    return backupId; // storageRef = backupId for filesystem provider
  }

  async retrieve(organizationId: string, storageRef: string): Promise<string> {
    const path = this.refToPath(organizationId, storageRef);
    if (!existsSync(path)) {
      throw new BackupStorageError(`Backup not found: ${storageRef} for org ${organizationId}`);
    }
    return readFileSync(path, "utf8");
  }

  async delete(organizationId: string, storageRef: string): Promise<void> {
    const path = this.refToPath(organizationId, storageRef);
    if (existsSync(path)) unlinkSync(path);
  }

  async exists(organizationId: string, storageRef: string): Promise<boolean> {
    try {
      const path = this.refToPath(organizationId, storageRef);
      return existsSync(path);
    } catch {
      return false;
    }
  }

  async list(organizationId: string): Promise<string[]> {
    const dir = this.orgDir(organizationId);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter(f => f.endsWith(".enc"))
      .map(f => f.replace(".enc", ""))
      .sort((a, b) => {
        // Sort by mtime descending (newest first)
        const statA = statSync(join(dir, `${a}.enc`));
        const statB = statSync(join(dir, `${b}.enc`));
        return statB.mtimeMs - statA.mtimeMs;
      });
  }

  /**
   * Removes backups older than the retention period.
   * @param organizationId
   * @param retentionDays - number of days to keep backups
   */
  async pruneOldBackups(organizationId: string, retentionDays: number): Promise<number> {
    const dir = this.orgDir(organizationId);
    if (!existsSync(dir)) return 0;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let pruned = 0;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".enc")) continue;
      const path = join(dir, file);
      const { mtimeMs } = statSync(path);
      if (mtimeMs < cutoff) {
        unlinkSync(path);
        pruned++;
      }
    }
    return pruned;
  }
}

// ─── Default provider ─────────────────────────────────────────────────────────

let _defaultProvider: BackupStorageProvider | null = null;

export function getDefaultBackupStorageProvider(): BackupStorageProvider {
  if (!_defaultProvider) {
    _defaultProvider = new FilesystemBackupProvider();
  }
  return _defaultProvider;
}

export function setDefaultBackupStorageProvider(provider: BackupStorageProvider): void {
  _defaultProvider = provider;
}
