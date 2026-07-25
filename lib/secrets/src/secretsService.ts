/**
 * Secrets Management Service — Sprint 7
 *
 * Provides an abstraction for storing, retrieving, rotating, and revoking
 * secrets. The backing store is AES-256-GCM encrypted rows in the
 * platform_secrets table. In production this would be replaced by AWS Secrets
 * Manager, HashiCorp Vault, or GCP Secret Manager — the interface is identical.
 *
 * Security guarantees:
 *   • Plaintext values never stored — only encrypted blobs
 *   • Master key comes from SESSION_SECRET env var (min 32 chars)
 *   • IV is unique per secret (never reused)
 *   • Revoked secrets cannot be retrieved
 *   • Expired secrets cannot be retrieved
 *   • No plaintext appears in logs, errors, or audit events
 *   • Functions never throw the plaintext value in error messages
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db as platformDb, platformSecretsTable } from "@workspace/db";

// ─── Master key derivation ────────────────────────────────────────────────────

function getMasterKey(): Buffer {
  const raw = process.env["SESSION_SECRET"];
  if (!raw || raw.length < 32) {
    throw new SecretsError(
      "SESSION_SECRET must be at least 32 characters to use the secrets service. " +
      "Set a strong random value in your environment.",
    );
  }
  // Derive a 32-byte key using SHA-256 of the secret (deterministic, no external dep)
  return createHash("sha256").update(raw).digest();
}

// ─── Encryption / Decryption ──────────────────────────────────────────────────

const ALGO = "aes-256-gcm";
const IV_BYTES = 16;
const TAG_BYTES = 16;

function encrypt(plaintext: string): string {
  const key = getMasterKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv + tag + ciphertext)
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decrypt(encoded: string): string {
  const key = getMasterKey();
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8");
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SecretStatus {
  secretRef: string;
  version: number;
  isRevoked: boolean;
  isExpired: boolean;
  lastValidatedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoreSecretOptions {
  /** ISO datetime after which the secret must not be used */
  expiresAt?: Date;
  /** Non-sensitive description or tags */
  metadata?: Record<string, unknown>;
}

// ─── Core operations ──────────────────────────────────────────────────────────

/**
 * Stores a secret under the given reference key. Overwrites if already exists.
 * For a new version of an existing secret, use rotateSecret instead.
 */
export async function storeSecret(
  secretRef: string,
  value: Record<string, string>,
  options: StoreSecretOptions = {},
): Promise<void> {
  validateRef(secretRef);
  const plaintext = JSON.stringify(value);
  const encryptedValue = encrypt(plaintext);

  const [existing] = await platformDb
    .select({ id: platformSecretsTable.id, version: platformSecretsTable.version })
    .from(platformSecretsTable)
    .where(eq(platformSecretsTable.secretRef, secretRef))
    .limit(1);

  if (existing) {
    await platformDb
      .update(platformSecretsTable)
      .set({
        encryptedValue,
        version: existing.version + 1,
        isRevoked: false,
        revokedAt: null,
        expiresAt: options.expiresAt ?? null,
        metadata: options.metadata ?? {},
        updatedAt: new Date(),
      })
      .where(eq(platformSecretsTable.secretRef, secretRef));
  } else {
    await platformDb.insert(platformSecretsTable).values({
      id: randomUUID(),
      secretRef,
      encryptedValue,
      version: 1,
      isRevoked: false,
      expiresAt: options.expiresAt ?? null,
      metadata: options.metadata ?? {},
    });
  }
}

/**
 * Retrieves and decrypts a secret.
 * Throws if the secret does not exist, is revoked, or has expired.
 * Never exposes the plaintext value in error messages.
 */
export async function retrieveSecret(secretRef: string): Promise<Record<string, string>> {
  validateRef(secretRef);

  const [row] = await platformDb
    .select()
    .from(platformSecretsTable)
    .where(eq(platformSecretsTable.secretRef, secretRef))
    .limit(1);

  if (!row) {
    throw new SecretsError(`Secret not found: ${secretRef}`);
  }
  if (row.isRevoked) {
    throw new SecretsError(`Secret has been revoked: ${secretRef}`);
  }
  if (row.expiresAt && row.expiresAt < new Date()) {
    throw new SecretsError(`Secret has expired: ${secretRef}`);
  }

  try {
    const plaintext = decrypt(row.encryptedValue);
    return JSON.parse(plaintext) as Record<string, string>;
  } catch {
    // Do NOT include any partial plaintext or encrypted value in this error
    throw new SecretsError(`Failed to decrypt secret: ${secretRef}. ` +
      "The master key may have changed or the secret is corrupt.");
  }
}

/**
 * Rotates a secret: stores new value with version incremented.
 * Old version is overwritten. Caller must drain connection pools that used old credentials.
 */
export async function rotateSecret(
  secretRef: string,
  newValue: Record<string, string>,
  options: StoreSecretOptions = {},
): Promise<{ newVersion: number }> {
  await storeSecret(secretRef, newValue, options);

  const [row] = await platformDb
    .select({ version: platformSecretsTable.version })
    .from(platformSecretsTable)
    .where(eq(platformSecretsTable.secretRef, secretRef))
    .limit(1);

  return { newVersion: row?.version ?? 1 };
}

/**
 * Revokes a secret immediately. Revoked secrets cannot be retrieved.
 * Connection pools using the old credentials must be drained by the caller.
 */
export async function revokeSecret(secretRef: string): Promise<void> {
  validateRef(secretRef);

  const result = await platformDb
    .update(platformSecretsTable)
    .set({ isRevoked: true, revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(platformSecretsTable.secretRef, secretRef));

  if (!result) {
    throw new SecretsError(`Cannot revoke — secret not found: ${secretRef}`);
  }
}

/**
 * Returns status metadata about a secret without decrypting its value.
 */
export async function getSecretStatus(secretRef: string): Promise<SecretStatus | null> {
  const [row] = await platformDb
    .select({
      secretRef: platformSecretsTable.secretRef,
      version: platformSecretsTable.version,
      isRevoked: platformSecretsTable.isRevoked,
      lastValidatedAt: platformSecretsTable.lastValidatedAt,
      expiresAt: platformSecretsTable.expiresAt,
      createdAt: platformSecretsTable.createdAt,
      updatedAt: platformSecretsTable.updatedAt,
    })
    .from(platformSecretsTable)
    .where(eq(platformSecretsTable.secretRef, secretRef))
    .limit(1);

  if (!row) return null;

  return {
    secretRef: row.secretRef,
    version: row.version,
    isRevoked: row.isRevoked,
    isExpired: !!row.expiresAt && row.expiresAt < new Date(),
    lastValidatedAt: row.lastValidatedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Marks a secret as successfully validated (e.g. connection test passed).
 */
export async function markSecretValidated(secretRef: string): Promise<void> {
  await platformDb
    .update(platformSecretsTable)
    .set({ lastValidatedAt: new Date(), updatedAt: new Date() })
    .where(eq(platformSecretsTable.secretRef, secretRef));
}

// ─── Credential reference helpers ─────────────────────────────────────────────

/**
 * Generates a deterministic credential reference for an org's database.
 * Format: "org:<orgId>:db:v1"
 * Version is incremented on each credential rotation.
 */
export function buildOrgDbCredentialRef(organizationId: string, version: number = 1): string {
  return `org:${organizationId}:db:v${version}`;
}

/**
 * Parses an org DB credential ref, returning orgId and version.
 * Returns null if the format is not recognised.
 */
export function parseOrgDbCredentialRef(ref: string): { organizationId: string; version: number } | null {
  const match = ref.match(/^org:([^:]+):db:v(\d+)$/);
  if (!match) return null;
  return { organizationId: match[1]!, version: Number(match[2]) };
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validateRef(secretRef: string): void {
  if (!secretRef || secretRef.trim().length === 0) {
    throw new SecretsError("secretRef must not be empty");
  }
  if (secretRef.length > 256) {
    throw new SecretsError("secretRef must not exceed 256 characters");
  }
  // Prevent log injection via ref
  if (/[\n\r\t]/.test(secretRef)) {
    throw new SecretsError("secretRef must not contain newlines or tabs");
  }
}

// ─── Error type ───────────────────────────────────────────────────────────────

export class SecretsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsError";
  }
}
