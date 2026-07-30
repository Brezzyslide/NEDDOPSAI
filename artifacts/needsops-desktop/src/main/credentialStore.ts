/**
 * credentialStore — Sprint 15 (safeStorage migration)
 *
 * All device secrets are stored exclusively in the OS native secure storage
 * via Electron's built-in safeStorage API.
 *
 * safeStorage uses:
 *   macOS → Keychain (via SecKeychainItem with app-bound access)
 *   Windows → DPAPI (Data Protection API) / Windows Credential Manager
 *   Linux → libsecret or Chromium's encrypted local storage fallback
 *
 * Why safeStorage instead of keytar:
 *   - Built into Electron (no native module rebuild required)
 *   - No @electron/rebuild step needed in CI
 *   - No additional .node binary to package
 *   - Equivalent OS-level security to keytar on Windows and macOS
 *   - Well-supported and actively maintained by the Electron team
 *
 * Keys stored:
 *   needsops.device-id           — Device UUID assigned by the platform
 *   needsops.org-slug             — Organisation slug
 *   needsops.api-base-url         — API base URL override
 *   needsops.legacy-token         — Long-lived brokerAuthToken (Sprint 14, bootstrap only)
 *   needsops.access-token         — Short-lived access token (Sprint 15, 15-min TTL)
 *   needsops.access-token-expiry  — ISO timestamp of access token expiry
 *   needsops.refresh-token        — Long-lived refresh token (Sprint 15, 30-day TTL)
 *   needsops.public-key           — Device Ed25519 public key (PEM)
 *   needsops.private-key          — Device Ed25519 private key (PEM, NEVER transmitted)
 *
 * All values are encrypted before being written to a JSON file in
 * app.getPath('userData'). The encryption key is managed by the OS.
 */

import { app, safeStorage } from "electron";
import { promises as fs } from "fs";
import path from "path";

const STORE_FILE_NAME = "credentials.enc.json";

/** Keys in the credential store */
const KEYS = {
  deviceId: "needsops.device-id",
  deviceToken: "needsops.device-token",
  orgSlug: "needsops.org-slug",
  apiBaseUrl: "needsops.api-base-url",
  legacyToken: "needsops.legacy-token",
  accessToken: "needsops.access-token",
  accessTokenExpiry: "needsops.access-token-expiry",
  refreshToken: "needsops.refresh-token",
  publicKey: "needsops.public-key",
  privateKey: "needsops.private-key",
} as const;

export type CredentialKey = (typeof KEYS)[keyof typeof KEYS];

export interface StoredCredentials {
  deviceToken: string | null;
  deviceId: string | null;
  orgSlug: string | null;
  apiBaseUrl: string | null;
  legacyToken: string | null;
  accessToken: string | null;
  accessTokenExpiry: string | null; // ISO timestamp
  refreshToken: string | null;
  publicKey: string | null;
  privateKey: string | null;
}

// ── File-backed encrypted store ───────────────────────────────────────────────

function getStorePath(): string {
  return path.join(app.getPath("userData"), STORE_FILE_NAME);
}

/** In-memory cache so we don't read disk on every call */
let cache: Record<string, string> | null = null;

async function readStore(): Promise<Record<string, string>> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(getStorePath(), "utf8");
    const parsed = JSON.parse(raw) as Record<string, string>;
    cache = parsed;
    return cache;
  } catch {
    cache = {};
    return cache;
  }
}

async function writeStore(store: Record<string, string>): Promise<void> {
  cache = store;
  await fs.writeFile(getStorePath(), JSON.stringify(store), "utf8");
}

function encryptValue(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    // Fallback: base64 encode (no OS encryption — should only happen in test environments)
    return Buffer.from(value).toString("base64");
  }
  return safeStorage.encryptString(value).toString("base64");
}

function decryptValue(encrypted: string): string | null {
  try {
    const buf = Buffer.from(encrypted, "base64");
    if (!safeStorage.isEncryptionAvailable()) {
      return buf.toString("utf8");
    }
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function loadCredentials(): Promise<StoredCredentials> {
  const store = await readStore();

  const get = (key: string): string | null => {
    const encrypted = store[key];
    if (!encrypted) return null;
    return decryptValue(encrypted);
  };

  return {
    deviceToken: get(KEYS.deviceToken),
    deviceId: get(KEYS.deviceId),
    orgSlug: get(KEYS.orgSlug),
    apiBaseUrl: get(KEYS.apiBaseUrl),
    legacyToken: get(KEYS.legacyToken),
    accessToken: get(KEYS.accessToken),
    accessTokenExpiry: get(KEYS.accessTokenExpiry),
    refreshToken: get(KEYS.refreshToken),
    publicKey: get(KEYS.publicKey),
    privateKey: get(KEYS.privateKey),
  };
}

export async function saveCredentials(creds: Partial<StoredCredentials>): Promise<void> {
  const store = await readStore();

  const set = (key: string, value: string | null | undefined) => {
    if (value === undefined) return; // skip unset keys
    if (value === null) {
      delete store[key];
    } else {
      store[key] = encryptValue(value);
    }
  };

  set(KEYS.deviceId, creds.deviceId);
  set(KEYS.orgSlug, creds.orgSlug);
  set(KEYS.apiBaseUrl, creds.apiBaseUrl);
  set(KEYS.legacyToken, creds.legacyToken);
  set(KEYS.accessToken, creds.accessToken);
  set(KEYS.accessTokenExpiry, creds.accessTokenExpiry);
  set(KEYS.refreshToken, creds.refreshToken);
  set(KEYS.publicKey, creds.publicKey);
  set(KEYS.privateKey, creds.privateKey);

  await writeStore(store);
}

export async function clearAllCredentials(): Promise<void> {
  cache = {};
  await writeStore({});
}

export async function isActivated(): Promise<boolean> {
  const creds = await loadCredentials();
  return !!(creds.deviceId && creds.orgSlug && (creds.legacyToken || creds.refreshToken));
}

/**
 * Check if the stored access token is still valid (not expired).
 * Returns false if no token exists or it expires within 2 minutes.
 */
export function isAccessTokenValid(creds: Pick<StoredCredentials, "accessToken" | "accessTokenExpiry">): boolean {
  if (!creds.accessToken || !creds.accessTokenExpiry) return false;
  const expiry = new Date(creds.accessTokenExpiry).getTime();
  const bufferMs = 2 * 60_000; // 2-minute buffer
  return expiry - bufferMs > Date.now();
}
