/**
 * @workspace/integrations — Integration provider types
 *
 * Sprint 0 shell. Defines the interfaces that all future integrations
 * (Google, Microsoft, Xero, Zoho) must conform to.
 */

// ─── Provider registry ────────────────────────────────────────────────────────

export type IntegrationProvider =
  | "google"         // Google Drive, Gmail, Calendar
  | "microsoft"      // Microsoft 365 (Teams, SharePoint, Outlook)
  | "xero"           // Xero accounting
  | "zoho"           // Zoho CRM/Books
  | "openai"         // OpenAI API (AI worker backbone)
  | "openclaw";      // OpenClaw orchestration gateway

export type IntegrationStatus =
  | "not_connected"
  | "connected"
  | "expired"
  | "error"
  | "pending_consent";

// ─── OAuth token storage ──────────────────────────────────────────────────────

/**
 * Stored per-organisation OAuth token set.
 * IMPORTANT: tokens must be encrypted at rest — never stored as plain text.
 */
export interface OAuthTokenSet {
  /** The integration provider */
  provider: IntegrationProvider;
  /** Organisation this token belongs to */
  organizationId: string;
  /** Encrypted access token (encryption handled by secrets service) */
  accessTokenEncrypted: string;
  /** Encrypted refresh token */
  refreshTokenEncrypted: string | null;
  /** Token expiry (UTC ISO string) */
  expiresAt: string | null;
  /** OAuth scopes granted */
  scopes: string[];
  /** When this record was last updated */
  updatedAt: string;
}

// ─── Integration config ───────────────────────────────────────────────────────

export interface IntegrationConfig {
  provider: IntegrationProvider;
  /** Human-readable display name */
  label: string;
  /** OAuth scopes required for this integration */
  requiredScopes: string[];
  /** Whether this integration is available on the current subscription tier */
  availableOnTiers: string[];
}

// ─── Integration interface ────────────────────────────────────────────────────

/**
 * All integration providers must implement this interface.
 * Sprint 2+: each provider (Google, Microsoft, Xero, etc.) will have a concrete class.
 */
export interface Integration {
  readonly provider: IntegrationProvider;
  /** Returns true if the organisation has a valid, non-expired token */
  isConnected(organizationId: string): Promise<boolean>;
  /** Returns the current connection status */
  getStatus(organizationId: string): Promise<IntegrationStatus>;
  /** Disconnect and revoke tokens */
  disconnect(organizationId: string): Promise<void>;
}

// ─── Webhook types ────────────────────────────────────────────────────────────

export interface InboundWebhook {
  provider: IntegrationProvider;
  organizationId: string;
  eventType: string;
  payload: unknown;
  receivedAt: string;
  signature?: string;
}
