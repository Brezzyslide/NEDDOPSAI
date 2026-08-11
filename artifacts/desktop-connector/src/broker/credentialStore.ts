/**
 * credentialStore — Relay Credential Persistence Abstraction
 *
 * PRODUCTION SECURE STORE
 *   macOS Keychain / Windows Credential Manager / Linux libsecret via `keytar`.
 *   Not yet wired — requires native bindings and an Electron build pipeline.
 *   Set NEEDSOPS_CREDENTIAL_STORE=keychain once keytar is installed.
 *
 * TEMPORARY DEVELOPMENT FALLBACK  ← current default
 *   AES-256-GCM encrypted JSON at ~/.needsops/relay-credentials.json.
 *   Encryption key is derived from hostname + username — provides obfuscation,
 *   NOT OS-level protection. File permissions are set to 0o600 (owner only).
 *   Do NOT use this in production deployments.
 *
 * Switching stores:
 *   NEEDSOPS_CREDENTIAL_STORE=file     (default) — encrypted file
 *   NEEDSOPS_CREDENTIAL_STORE=keychain           — macOS/Win/Linux OS keychain
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

// ── Credential shape ───────────────────────────────────────────────────────────

export interface RelayCredentials {
  /** Device UUID — set at registration; authoritative identity. */
  deviceId: string;
  /** Organisation UUID from the server's device record — authoritative tenant binding. */
  organizationId: string;
  /** Short-lived relay access token (audience: device-relay). 15-min TTL. */
  accessToken: string;
  /** ISO-8601 expiry of the access token. */
  accessTokenExpiresAt: string;
  /** Opaque single-use refresh token. Rotate on every use. */
  refreshToken: string;
  /** ISO-8601 expiry of the refresh token. */
  refreshTokenExpiresAt: string;
}

// ── Interface ──────────────────────────────────────────────────────────────────

export interface ICredentialStore {
  /**
   * Load stored relay credentials.
   * Returns null if no credentials have been persisted yet.
   * Never throws — returns null on read/decrypt error.
   */
  load(): Promise<RelayCredentials | null>;

  /**
   * Persist relay credentials.
   * Overwrites any existing stored credentials atomically.
   */
  save(credentials: RelayCredentials): Promise<void>;

  /**
   * Delete stored credentials.
   * Called when reauthentication is required so stale tokens are not reused.
   * Safe to call when no credentials are stored.
   */
  clear(): Promise<void>;
}

// ── TEMPORARY DEVELOPMENT FALLBACK ────────────────────────────────────────────

const CREDENTIAL_DIR  = path.join(os.homedir(), ".needsops");
const CREDENTIAL_PATH = path.join(CREDENTIAL_DIR, "relay-credentials.json");
const STORE_LABEL     = "TEMPORARY DEVELOPMENT FALLBACK";

/**
 * Derive a machine-local obfuscation key from stable OS identifiers.
 *
 * This is NOT a strong cryptographic secret. It provides obfuscation only:
 * anyone with access to the file and knowledge of the host+username can
 * decrypt it. Replace with KeychainCredentialStore for production.
 */
function deriveMachineKey(): Buffer {
  const seed = [
    os.hostname(),
    os.userInfo().username,
    "needsops-relay-dev-v1",
  ].join("|");
  return crypto.createHash("sha256").update(seed).digest();
}

function encryptCredentials(credentials: RelayCredentials): string {
  const plaintext = JSON.stringify(credentials);
  const key = deriveMachineKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Layout: [iv:12][tag:16][ciphertext:n] → base64
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

function decryptCredentials(encoded: string): RelayCredentials {
  const key = deriveMachineKey();
  const buf = Buffer.from(encoded, "base64");
  if (buf.length < 29) throw new Error("Credential blob too short");
  const iv         = buf.subarray(0, 12);
  const tag        = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
  return JSON.parse(plaintext) as RelayCredentials;
}

function isValidCredentials(v: unknown): v is RelayCredentials {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o["deviceId"] === "string" &&
    typeof o["organizationId"] === "string" &&
    typeof o["accessToken"] === "string" &&
    typeof o["accessTokenExpiresAt"] === "string" &&
    typeof o["refreshToken"] === "string" &&
    typeof o["refreshTokenExpiresAt"] === "string"
  );
}

/**
 * TEMPORARY DEVELOPMENT FALLBACK
 *
 * Stores relay credentials at ~/.needsops/relay-credentials.json using
 * AES-256-GCM with a hostname-derived key. File permissions: 0o600.
 *
 * Replace with KeychainCredentialStore for production use.
 */
export class FileCredentialStore implements ICredentialStore {
  async load(): Promise<RelayCredentials | null> {
    try {
      const raw = fs.readFileSync(CREDENTIAL_PATH, "utf8").trim();
      const creds = decryptCredentials(raw);
      if (!isValidCredentials(creds)) return null;
      return creds;
    } catch {
      return null;
    }
  }

  async save(credentials: RelayCredentials): Promise<void> {
    fs.mkdirSync(CREDENTIAL_DIR, { recursive: true });
    const encoded = encryptCredentials(credentials);
    // Write to a temp file then rename for atomicity
    const tmp = `${CREDENTIAL_PATH}.tmp`;
    fs.writeFileSync(tmp, encoded, { mode: 0o600 });
    fs.renameSync(tmp, CREDENTIAL_PATH);
  }

  async clear(): Promise<void> {
    try {
      fs.unlinkSync(CREDENTIAL_PATH);
    } catch {
      // Acceptable — file may not exist
    }
  }

  /** Path to the credential file — used for diagnostics/tests only. */
  static get path(): string {
    return CREDENTIAL_PATH;
  }
}

// ── PRODUCTION SECURE STORE ───────────────────────────────────────────────────

/**
 * PRODUCTION SECURE STORE
 *
 * Stores relay credentials in the OS credential manager via `keytar`:
 *   - macOS  → Keychain
 *   - Windows → Credential Manager
 *   - Linux  → libsecret / GNOME Keyring
 *
 * Not yet active. Activate by:
 *   1. `pnpm add keytar` in this package
 *   2. Set NEEDSOPS_CREDENTIAL_STORE=keychain in the broker env
 *
 * Credentials are stored as a single JSON entry:
 *   service:  "needsops-relay"
 *   account:  "relay-credentials-<deviceId>"
 */
export class KeychainCredentialStore implements ICredentialStore {
  private readonly SERVICE = "needsops-relay";

  async load(): Promise<RelayCredentials | null> {
    throw new Error(
      `${STORE_LABEL}: KeychainCredentialStore requires the \`keytar\` native module. ` +
      "Set NEEDSOPS_CREDENTIAL_STORE=file (default) for the development fallback."
    );
  }

  async save(_credentials: RelayCredentials): Promise<void> {
    throw new Error(
      `${STORE_LABEL}: KeychainCredentialStore requires the \`keytar\` native module.`
    );
  }

  async clear(): Promise<void> {
    throw new Error(
      `${STORE_LABEL}: KeychainCredentialStore requires the \`keytar\` native module.`
    );
  }
}

// ── Factory ────────────────────────────────────────────────────────────────────

/**
 * Create the credential store configured by NEEDSOPS_CREDENTIAL_STORE.
 *
 * "file"     (default) — TEMPORARY DEVELOPMENT FALLBACK
 * "keychain"           — PRODUCTION SECURE STORE (requires keytar)
 */
export function createCredentialStore(): ICredentialStore {
  const mode = process.env["NEEDSOPS_CREDENTIAL_STORE"] ?? "file";
  if (mode === "keychain") return new KeychainCredentialStore();
  return new FileCredentialStore();
}
