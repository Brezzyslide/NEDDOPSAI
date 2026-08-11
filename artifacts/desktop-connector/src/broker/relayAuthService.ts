/**
 * relayAuthService — Relay Authentication Lifecycle Manager
 *
 * Manages the access-token / refresh-token lifecycle for the outbound
 * WebSocket relay (Sprint 15 / relay hardening).
 *
 * Responsibilities:
 *   - Load credentials from the credential store on startup
 *   - Return a valid access token, refreshing automatically when near expiry
 *   - Rotate refresh tokens on every use (server enforces single-use rotation)
 *   - Signal reauthentication_required when the refresh token is expired/revoked
 *   - Schedule proactive token refresh before the 15-minute access token expires
 *   - Deduplicate concurrent refresh calls (mutex via shared promise)
 *   - Never log raw tokens or refresh tokens
 *
 * Token contract:
 *   - Access token: short-lived (15-min TTL), audience "device-relay"
 *   - Refresh token: single-use rotation; server issues a new pair on each use
 *   - brokerAuthToken is NOT accepted here — that is a separate bootstrap credential
 *
 * Tenant binding:
 *   - organizationId is read from the credential store (set at registration)
 *   - NEEDSOPS_ORG_SLUG must NOT be used as the security boundary
 */

import type { Logger } from "pino";
import type { ICredentialStore, RelayCredentials } from "./credentialStore.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Refresh access token when this many ms remain on its TTL. */
export const REFRESH_BEFORE_EXPIRY_MS = 4 * 60_000; // 4 minutes

// ── Errors ────────────────────────────────────────────────────────────────────

export class ReauthenticationRequiredError extends Error {
  readonly code = "REAUTHENTICATION_REQUIRED" as const;

  constructor(reason: string) {
    super(`Reauthentication required: ${reason}`);
    this.name = "ReauthenticationRequiredError";
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

/** Shape of the /v1/devices/auth/refresh response. */
export interface RefreshResponse {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface RelayAuthServiceConfig {
  /** NeedsOps API HTTPS base URL, e.g. https://api.needsops.com */
  apiBaseUrl: string;
  store: ICredentialStore;
  logger: Logger;
  /**
   * Override the global fetch for testing.
   * Defaults to the global fetch available in Node 18+.
   */
  fetchFn?: typeof fetch;
}

// ── RelayAuthService ──────────────────────────────────────────────────────────

export class RelayAuthService {
  private credentials: RelayCredentials | null = null;
  private refreshPromise: Promise<void> | null = null;
  private proactiveTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(private readonly config: RelayAuthServiceConfig) {}

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Load credentials from the store.
   * Must be called once before getValidAccessToken().
   *
   * Returns true if credentials were found and loaded.
   * Returns false if the store is empty (device pairing required).
   */
  async initialise(): Promise<boolean> {
    const creds = await this.config.store.load();
    if (!creds) {
      this.config.logger.warn("[relay-auth] No stored credentials found — device pairing is required");
      return false;
    }
    this.credentials = creds;
    this.config.logger.info(
      {
        deviceId: creds.deviceId,
        organizationId: creds.organizationId,
        accessTokenPresent: true,
        refreshTokenPresent: true,
        accessTokenExpiresAt: creds.accessTokenExpiresAt,
        refreshTokenExpiresAt: creds.refreshTokenExpiresAt,
      },
      "[relay-auth] Credentials loaded from store",
    );
    this.scheduleProactiveRefresh();
    return true;
  }

  /** Stop background timers. Always call on broker shutdown. */
  destroy(): void {
    this.destroyed = true;
    if (this.proactiveTimer) {
      clearTimeout(this.proactiveTimer);
      this.proactiveTimer = null;
    }
  }

  // ── Token access ────────────────────────────────────────────────────────────

  /**
   * Return a valid access token.
   *
   * If the access token has >REFRESH_BEFORE_EXPIRY_MS remaining, returns it
   * directly (no network call).
   *
   * If the access token is near expiry or already expired, calls
   * POST /v1/devices/auth/refresh and rotates credentials before returning
   * the new access token.
   *
   * Throws ReauthenticationRequiredError when:
   *   - No credentials are stored
   *   - The refresh token is expired
   *   - The server rejects the refresh token (401)
   *
   * Multiple concurrent callers share a single in-flight refresh (mutex).
   */
  async getValidAccessToken(): Promise<string> {
    if (!this.credentials) {
      throw new ReauthenticationRequiredError("no stored credentials — device pairing required");
    }

    const now = Date.now();
    const accessExpiry  = new Date(this.credentials.accessTokenExpiresAt).getTime();
    const refreshExpiry = new Date(this.credentials.refreshTokenExpiresAt).getTime();

    // Fast path: access token still valid with enough margin
    if (accessExpiry - now > REFRESH_BEFORE_EXPIRY_MS) {
      return this.credentials.accessToken;
    }

    // Check refresh token before attempting the network call
    if (now >= refreshExpiry) {
      this.credentials = null;
      await this.config.store.clear();
      throw new ReauthenticationRequiredError("refresh token has expired");
    }

    // Refresh — deduplicate concurrent callers
    this.config.logger.info("[relay-auth] Access token near or past expiry — refreshing");
    await this.refresh();
    return this.credentials!.accessToken;
  }

  // ── Credential management ───────────────────────────────────────────────────

  /**
   * Save fresh credentials after initial pairing (activation + challenge/exchange).
   * Also called by the pairing script after a successful exchange.
   */
  async saveCredentials(creds: RelayCredentials): Promise<void> {
    this.credentials = creds;
    await this.config.store.save(creds);
    this.config.logger.info(
      {
        deviceId:              creds.deviceId,
        organizationId:        creds.organizationId,
        accessTokenPresent:    true,
        refreshTokenPresent:   true,
        accessTokenExpiresAt:  creds.accessTokenExpiresAt,
        refreshTokenExpiresAt: creds.refreshTokenExpiresAt,
      },
      "[relay-auth] Credentials saved",
    );
    this.scheduleProactiveRefresh();
  }

  /**
   * The device UUID from stored credentials.
   * Authoritative source — do NOT use NEEDSOPS_DEVICE_ID as security boundary.
   */
  get deviceId(): string | null {
    return this.credentials?.deviceId ?? null;
  }

  /**
   * The organisation UUID from stored credentials.
   * Authoritative source — do NOT use NEEDSOPS_ORG_SLUG as security boundary.
   */
  get organizationId(): string | null {
    return this.credentials?.organizationId ?? null;
  }

  // ── Private: token refresh ──────────────────────────────────────────────────

  /**
   * Deduplicating refresh: concurrent callers await the same promise.
   */
  private refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.doRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async doRefresh(): Promise<void> {
    if (!this.credentials) {
      throw new ReauthenticationRequiredError("no credentials to refresh");
    }

    const currentRefreshToken = this.credentials.refreshToken;
    const url = `${this.config.apiBaseUrl.replace(/\/$/, "")}/v1/devices/auth/refresh`;

    const fetchFn = this.config.fetchFn ?? fetch;
    let res: Response;
    try {
      res = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // SECURITY: refresh token travels only in the request body — never logged
        body: JSON.stringify({ refreshToken: currentRefreshToken }),
      });
    } catch (networkErr: any) {
      // Transient network error — caller should retry; credentials remain valid for now
      throw new Error(`Token refresh network error: ${networkErr.message}`);
    }

    if (res.status === 401) {
      // Server rejected the refresh token — revoked, reused, or expired server-side
      this.credentials = null;
      await this.config.store.clear();
      throw new ReauthenticationRequiredError("refresh token rejected by server (401)");
    }

    if (!res.ok) {
      throw new Error(`Token refresh failed: HTTP ${res.status}`);
    }

    let body: RefreshResponse;
    try {
      body = (await res.json()) as RefreshResponse;
    } catch {
      throw new Error("Token refresh: malformed JSON response from server");
    }

    if (!body.accessToken || !body.refreshToken || !body.accessTokenExpiresAt || !body.refreshTokenExpiresAt) {
      throw new Error("Token refresh: missing required fields in server response");
    }

    // Rotate — stale credentials replaced; old refresh token must never be used again
    this.credentials = {
      deviceId:              this.credentials.deviceId,
      organizationId:        this.credentials.organizationId,
      accessToken:           body.accessToken,
      accessTokenExpiresAt:  body.accessTokenExpiresAt,
      refreshToken:          body.refreshToken,
      refreshTokenExpiresAt: body.refreshTokenExpiresAt,
    };

    await this.config.store.save(this.credentials);

    // SECURITY: log metadata only — never include raw tokens
    this.config.logger.info(
      {
        deviceId:              this.credentials.deviceId,
        accessTokenPresent:    true,
        refreshTokenPresent:   true,
        accessTokenExpiresAt:  this.credentials.accessTokenExpiresAt,
        refreshTokenExpiresAt: this.credentials.refreshTokenExpiresAt,
      },
      "[relay-auth] Tokens rotated successfully",
    );

    // Reschedule proactive refresh for the new TTL
    this.scheduleProactiveRefresh();
  }

  // ── Private: proactive refresh timer ───────────────────────────────────────

  private scheduleProactiveRefresh(): void {
    if (this.destroyed || !this.credentials) return;

    // Cancel existing timer before scheduling a new one
    if (this.proactiveTimer) {
      clearTimeout(this.proactiveTimer);
      this.proactiveTimer = null;
    }

    const expiry = new Date(this.credentials.accessTokenExpiresAt).getTime();
    const delay  = Math.max(0, expiry - Date.now() - REFRESH_BEFORE_EXPIRY_MS);

    this.proactiveTimer = setTimeout(async () => {
      this.proactiveTimer = null;
      if (this.destroyed) return;
      try {
        await this.refresh();
        this.config.logger.info("[relay-auth] Proactive token refresh completed");
      } catch (err: any) {
        if (err instanceof ReauthenticationRequiredError) {
          this.config.logger.error(
            { code: err.code, reason: err.message },
            "[relay-auth] Proactive refresh failed — reauthentication required",
          );
        } else {
          // Transient error — RelayClient will call getValidAccessToken() again
          // on its next reconnect attempt, which will trigger a fresh refresh then.
          this.config.logger.warn(
            { err: err.message },
            "[relay-auth] Proactive refresh failed — will retry on next connection attempt",
          );
        }
      }
    }, delay);
  }
}
