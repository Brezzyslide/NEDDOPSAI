/**
 * credentialStore — OS Keychain Integration
 * Sprint 14
 *
 * All device secrets are stored exclusively in the OS native keychain.
 * Nothing is ever written to disk files or environment variables.
 *
 * macOS → Keychain Access
 * Windows → Windows Credential Manager
 *
 * Keys stored:
 *   needsops/device-token    — Bearer token for API authentication
 *   needsops/device-id       — Device UUID assigned by the platform
 *   needsops/org-slug        — Organisation slug this device belongs to
 *   needsops/api-base-url    — API base URL (optional override)
 */

// keytar is loaded lazily so test environments can mock it
let keytar: typeof import("keytar") | null = null;

async function getKeytar() {
  if (!keytar) {
    keytar = await import("keytar");
  }
  return keytar;
}

const SERVICE = "NeedsOps AI+";

const KEYS = {
  deviceToken: "device-token",
  deviceId: "device-id",
  orgSlug: "org-slug",
  apiBaseUrl: "api-base-url",
} as const;

export interface StoredCredentials {
  deviceToken: string | null;
  deviceId: string | null;
  orgSlug: string | null;
  apiBaseUrl: string | null;
}

export async function loadCredentials(): Promise<StoredCredentials> {
  const kt = await getKeytar();
  const [deviceToken, deviceId, orgSlug, apiBaseUrl] = await Promise.all([
    kt.getPassword(SERVICE, KEYS.deviceToken),
    kt.getPassword(SERVICE, KEYS.deviceId),
    kt.getPassword(SERVICE, KEYS.orgSlug),
    kt.getPassword(SERVICE, KEYS.apiBaseUrl),
  ]);
  return { deviceToken, deviceId, orgSlug, apiBaseUrl };
}

export async function saveCredentials(creds: Partial<StoredCredentials>): Promise<void> {
  const kt = await getKeytar();
  const ops: Promise<void>[] = [];

  if (creds.deviceToken !== undefined) {
    ops.push(creds.deviceToken
      ? kt.setPassword(SERVICE, KEYS.deviceToken, creds.deviceToken)
      : kt.deletePassword(SERVICE, KEYS.deviceToken).then(() => {}));
  }
  if (creds.deviceId !== undefined) {
    ops.push(creds.deviceId
      ? kt.setPassword(SERVICE, KEYS.deviceId, creds.deviceId)
      : kt.deletePassword(SERVICE, KEYS.deviceId).then(() => {}));
  }
  if (creds.orgSlug !== undefined) {
    ops.push(creds.orgSlug
      ? kt.setPassword(SERVICE, KEYS.orgSlug, creds.orgSlug)
      : kt.deletePassword(SERVICE, KEYS.orgSlug).then(() => {}));
  }
  if (creds.apiBaseUrl !== undefined) {
    ops.push(creds.apiBaseUrl
      ? kt.setPassword(SERVICE, KEYS.apiBaseUrl, creds.apiBaseUrl)
      : kt.deletePassword(SERVICE, KEYS.apiBaseUrl).then(() => {}));
  }

  await Promise.all(ops);
}

export async function clearAllCredentials(): Promise<void> {
  const kt = await getKeytar();
  await Promise.all(
    Object.values(KEYS).map(k => kt.deletePassword(SERVICE, k).catch(() => {})),
  );
}

export async function isActivated(): Promise<boolean> {
  const creds = await loadCredentials();
  return !!(creds.deviceToken && creds.deviceId && creds.orgSlug);
}
