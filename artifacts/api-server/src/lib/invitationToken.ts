import { createHash, randomBytes } from "crypto";

/** Default invitation expiry in days */
export const INVITATION_EXPIRY_DAYS = 7;

/**
 * Generates a cryptographically secure invitation token.
 * Returns the raw token (to embed in the email URL) and its SHA-256 hash
 * (to store in the database — the raw token is NEVER stored).
 */
export function generateInvitationToken(): {
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const rawToken = randomBytes(32).toString("hex"); // 64-char hex string
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);
  return { rawToken, tokenHash, expiresAt };
}

/**
 * Hashes a raw invitation token for secure storage/lookup.
 */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Builds the invitation acceptance URL.
 * Format: {WEB_APP_URL}/invitations/{token}/accept
 *
 * Uses WEB_APP_URL env var (set this to your public web app base URL).
 * Falls back to APP_BASE_URL then localhost for dev convenience.
 */
export function buildInvitationUrl(
  rawToken: string,
  baseUrl?: string,
): string {
  const base =
    baseUrl ??
    process.env.WEB_APP_URL ??
    process.env.APP_BASE_URL ??
    `http://localhost:${process.env.PORT ?? 5001}`;
  // Strip trailing slash so the path is clean
  return `${base.replace(/\/$/, "")}/invitations/${rawToken}/accept`;
}
