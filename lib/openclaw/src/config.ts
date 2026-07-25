/**
 * @workspace/openclaw — Runtime configuration
 *
 * All OpenClaw connection parameters are read from environment variables.
 * No URLs, secrets, or identifiers are hard-coded.
 *
 * Environment variables:
 *
 *   OPENCLAW_RUNTIME_URL          Base URL of the OpenClaw Runtime Broker.
 *                                 If absent, the engine runs in "not connected" mode.
 *                                 Example: https://broker.openclaw.internal
 *
 *   OPENCLAW_AUTH_TOKEN_REF       Reference to the authentication token stored in
 *                                 the platform secrets service. The RuntimeBrokerClient
 *                                 resolves this reference at runtime — never stores
 *                                 the token value directly.
 *                                 Example: openclaw_broker_auth_token
 *
 *   OPENCLAW_WEBHOOK_SECRET       HMAC-SHA256 shared secret used to verify that
 *                                 inbound webhook events originate from a legitimate
 *                                 OpenClaw runtime. Must be set in production.
 *
 *   OPENCLAW_CALLBACK_BASE_URL    The externally reachable base URL of this NeedsOps
 *                                 instance. Appended with /v1/runtime/events to form
 *                                 the callbackUrl in execution packages.
 *                                 Example: https://api.needsops.com
 *
 *   OPENCLAW_TIMEOUT_MS           HTTP request timeout in milliseconds.
 *                                 Default: 30000 (30 s)
 *
 *   OPENCLAW_RETRY_ATTEMPTS       Number of retry attempts for transient failures.
 *                                 Default: 3
 *
 *   OPENCLAW_RETRY_DELAY_MS       Base delay between retries (exponential back-off).
 *                                 Default: 1000 (1 s)
 *
 *   OPENCLAW_HEARTBEAT_INTERVAL_MS  How often to poll the broker health endpoint.
 *                                 Default: 30000 (30 s)
 *
 *   OPENCLAW_EXECUTION_TTL_SECONDS  How long after creation an execution package
 *                                 remains valid for submission.
 *                                 Default: 300 (5 min)
 */

export interface OpenClawConfig {
  /** Base URL of the OpenClaw Runtime Broker. Null means "not configured". */
  runtimeUrl: string | null;
  /** Secret reference for broker authentication (never the token itself). */
  authTokenRef: string | null;
  /** HMAC secret for verifying inbound webhook events. */
  webhookSecret: string | null;
  /** Base URL of this NeedsOps instance, used to build the callback URL. */
  callbackBaseUrl: string | null;
  /** HTTP timeout in milliseconds. */
  timeoutMs: number;
  /** Number of retry attempts for transient HTTP failures. */
  retryAttempts: number;
  /** Base delay between retries in milliseconds. */
  retryDelayMs: number;
  /** Interval between broker health checks in milliseconds. */
  heartbeatIntervalMs: number;
  /** How long an execution package is valid (seconds). */
  executionTtlSeconds: number;
}

export function loadOpenClawConfig(): OpenClawConfig {
  return {
    runtimeUrl: process.env.OPENCLAW_RUNTIME_URL ?? null,
    authTokenRef: process.env.OPENCLAW_AUTH_TOKEN_REF ?? null,
    webhookSecret: process.env.OPENCLAW_WEBHOOK_SECRET ?? null,
    callbackBaseUrl: process.env.OPENCLAW_CALLBACK_BASE_URL ?? null,
    timeoutMs: parseInt(process.env.OPENCLAW_TIMEOUT_MS ?? "30000", 10),
    retryAttempts: parseInt(process.env.OPENCLAW_RETRY_ATTEMPTS ?? "3", 10),
    retryDelayMs: parseInt(process.env.OPENCLAW_RETRY_DELAY_MS ?? "1000", 10),
    heartbeatIntervalMs: parseInt(process.env.OPENCLAW_HEARTBEAT_INTERVAL_MS ?? "30000", 10),
    executionTtlSeconds: parseInt(process.env.OPENCLAW_EXECUTION_TTL_SECONDS ?? "300", 10),
  };
}

/**
 * Returns true if the OpenClaw runtime is configured (URL is set).
 * Used by the engine to skip all broker calls when not configured.
 */
export function isOpenClawConfigured(config: OpenClawConfig): boolean {
  return config.runtimeUrl !== null && config.runtimeUrl.trim().length > 0;
}

/**
 * Build the full webhook callback URL for inclusion in execution packages.
 * Returns null if callbackBaseUrl is not configured.
 */
export function buildCallbackUrl(config: OpenClawConfig): string | null {
  if (!config.callbackBaseUrl) return null;
  const base = config.callbackBaseUrl.replace(/\/$/, "");
  return `${base}/v1/runtime/events`;
}
