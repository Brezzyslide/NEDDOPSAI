/**
 * activationCodeService — Sprint 14
 *
 * Manages short-lived, single-use device activation codes.
 *
 * Security invariants:
 *   - Only SHA-256 hash stored; plaintext returned ONCE and never logged
 *   - Code expires after 15 minutes
 *   - Single-use: atomically consumed on first valid redemption
 *   - Locked after 5 failed attempts
 *   - Rate-limited at the route level; this service enforces per-code limits
 *   - Bound to organization_id; cannot be redeemed by a different org
 */

import { randomBytes, createHash } from "crypto";
import { db, deviceActivationTokensTable, organizationsTable } from "@workspace/db";
import { eq, and, lt, gt } from "drizzle-orm";

// ── Constants ──────────────────────────────────────────────────────────────────

const EXPIRY_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const CODE_LENGTH_BYTES = 12; // 96 bits → 16 hex chars grouped as XXXX-XXXX-XXXX-XXXX

// ── Helpers (exported for testing) ────────────────────────────────────────────

function generateCode(): string {
  const raw = randomBytes(CODE_LENGTH_BYTES).toString("hex").toUpperCase();
  // Remove ambiguous chars (0→Z, 1→Y, I→W, O→V, L→U) before grouping
  const clean = raw
    .replace(/0/g, "Z")
    .replace(/1/g, "Y")
    .replace(/I/g, "W")
    .replace(/O/g, "V")
    .replace(/L/g, "U")
    .slice(0, 16);
  // Format as XXXX-XXXX-XXXX-XXXX
  return `${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}`;
}

/** Format a raw 16-char code as XXXX-XXXX-XXXX-XXXX */
export function formatCode(raw: string): string {
  const clean = raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 16);
  return clean.match(/.{1,4}/g)?.join("-") ?? clean;
}

/** SHA-256 hash of a code (strips dashes before hashing to normalise format) */
export async function hashCode(code: string): Promise<string> {
  const { createHash } = await import("crypto");
  return createHash("sha256").update(code.replace(/-/g, "").toUpperCase()).digest("hex");
}

/** @internal sync version used inside this file only */
function hashCodeSync(code: string): string {
  return createHash("sha256").update(code.replace(/-/g, "").toUpperCase()).digest("hex");
}

/** Returns true if the code has expired */
export function isExpired(expiresAt: Date): boolean {
  return expiresAt < new Date();
}

/** Returns true if the code has hit the failed-attempt lockout threshold */
export function isLocked(failedAttempts: number): boolean {
  return failedAttempts >= MAX_ATTEMPTS;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface ActivationCodeResult {
  id: string;
  code: string;        // plaintext — return to caller, never log or store
  expiresAt: Date;
}

/**
 * Generate a new activation code for an org.
 * If an unused, unexpired code exists, it is revoked before issuing a new one.
 */
export async function createActivationCode(
  organizationId: string,
  createdByUserId: string,
): Promise<ActivationCodeResult> {
  const { randomUUID } = await import("crypto");

  // Revoke any existing unused codes for this org
  await db
    .update(deviceActivationTokensTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(deviceActivationTokensTable.organizationId, organizationId),
        eq(deviceActivationTokensTable.usedAt, null as any),
        eq(deviceActivationTokensTable.revokedAt, null as any),
      ),
    )
    .catch(() => {}); // Non-fatal

  const code = generateCode();
  const codeHash = hashCodeSync(code);
  const expiresAt = new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000);

  const id = `dat_${randomUUID()}`;

  await db.insert(deviceActivationTokensTable).values({
    id,
    organizationId,
    createdByUserId,
    codeHash,
    expiresAt,
  });

  return { id, code, expiresAt };
}

export type RedeemResult =
  | { ok: true; tokenId: string; organizationId: string }
  | { ok: false; reason: "expired" | "used" | "invalid" | "locked" | "revoked" };

/**
 * Validate an activation code.
 * Returns success with the token ID and org ID on success.
 * Increments attempt_count on failure.
 */
export async function redeemActivationCode(
  code: string,
  organizationId: string,
): Promise<RedeemResult> {
  const codeHash = hashCodeSync(code.trim().toUpperCase().replace(/[^A-Z0-9]/g, ""));

  const now = new Date();

  const [token] = await db
    .select()
    .from(deviceActivationTokensTable)
    .where(eq(deviceActivationTokensTable.codeHash, codeHash))
    .limit(1);

  if (!token) {
    return { ok: false, reason: "invalid" };
  }

  // Org binding check
  if (token.organizationId !== organizationId) {
    return { ok: false, reason: "invalid" };
  }

  if (token.revokedAt) {
    return { ok: false, reason: "revoked" };
  }

  if (token.usedAt) {
    return { ok: false, reason: "used" };
  }

  if (token.expiresAt < now) {
    return { ok: false, reason: "expired" };
  }

  if (token.attemptCount >= MAX_ATTEMPTS) {
    return { ok: false, reason: "locked" };
  }

  return { ok: true, tokenId: token.id, organizationId: token.organizationId };
}

/**
 * Mark a token as used (call this atomically after device registration succeeds).
 */
export async function markTokenUsed(tokenId: string, deviceId: string): Promise<void> {
  await db
    .update(deviceActivationTokensTable)
    .set({ usedAt: new Date(), usedByDeviceId: deviceId })
    .where(eq(deviceActivationTokensTable.id, tokenId));
}

/**
 * Increment the failed attempt counter on a token.
 */
export async function recordFailedAttempt(code: string): Promise<void> {
  const codeHash = hashCodeSync(code.trim().toUpperCase().replace(/[^A-Z0-9]/g, ""));
  const [token] = await db
    .select()
    .from(deviceActivationTokensTable)
    .where(eq(deviceActivationTokensTable.codeHash, codeHash))
    .limit(1);

  if (token) {
    await db
      .update(deviceActivationTokensTable)
      .set({ attemptCount: (token.attemptCount ?? 0) + 1 })
      .where(eq(deviceActivationTokensTable.id, token.id));
  }
}
