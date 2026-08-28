/**
 * AI Privacy Gateway — Core — Sprint 7 / Sprint 9.1
 *
 * ALL AI requests involving customer data MUST pass through this gateway.
 * Direct model-provider calls are prohibited in application code.
 *
 * Sprint 9.1 additions:
 *   - OpenAI provider connected when AI_PROVIDER=openai
 *   - Deterministic fallback when OpenAI fails
 *   - Token usage tracking
 *   - Fallback event logging
 *
 * Usage:
 *   const gateway = createAIGateway(ctx);
 *   const response = await gateway.process(request);
 */

import { randomUUID } from "crypto";
import { db as platformDb, orgAuditLogTable } from "@workspace/db";
import {
  APPROVED_PROVIDERS,
  PURPOSE_FIELD_ALLOWLIST,
  ROLE_PURPOSE_ALLOWLIST,
  AIGatewayError,
  AIGatewayAuthError,
  AIGatewayPurposeError,
  AIGatewayProviderError,
  AIGatewayDataError,
  type AIGatewayContext,
  type AIRequest,
  type AIResponse,
  type AIPurpose,
  type ApprovedProvider,
  type AIProviderHealth,
  type GatewayOutputMode,
  type AIRuntimeProfile,
} from "./types.js";
import {
  callOpenAI,
  isOpenAIConfigured,
  getOpenAIModel,
  OpenAIProviderError,
} from "./providers/openai.js";
import {
  recordSuccess,
  recordFailure,
  recordFallback,
  getGlobalStats,
} from "./usageTracker.js";

// ─── Gateway factory ──────────────────────────────────────────────────────────

export interface AIGateway {
  context: AIGatewayContext;
  /**
   * Processes an AI request through all gateway enforcement layers.
   * Writes audit events before and after the provider call.
   * Returns a response with tracing metadata.
   *
   * Sprint 9.1: If AI_PROVIDER=openai and the call succeeds, returns real LLM output.
   * If OpenAI fails for any reason, automatically falls back to the internal
   * deterministic placeholder and sets usedFallback=true on the response.
   */
  process(request: AIRequest): Promise<AIResponse>;
  /**
   * Validates a set of retrieved data fields against the purpose allowlist.
   * Call before constructing the AI request payload.
   * Throws AIGatewayDataError if any field is not permitted.
   */
  validateRetrievedFields(fields: string[]): void;
}

/**
 * Creates an AI gateway instance for a single request lifecycle.
 * The context is immutable after creation.
 */
export function createAIGateway(ctx: AIGatewayContext): AIGateway {
  validateContext(ctx);

  return {
    context: Object.freeze({ ...ctx }),
    process: (request) => processRequest(ctx, request),
    validateRetrievedFields: (fields) => validateFields(ctx.purpose, fields),
  };
}

// ─── Context validation ───────────────────────────────────────────────────────

function validateContext(ctx: AIGatewayContext): void {
  if (!ctx.userId?.trim()) {
    throw new AIGatewayAuthError("AI gateway requires a verified userId");
  }
  if (!ctx.organizationId?.trim()) {
    throw new AIGatewayAuthError("AI gateway requires a verified organizationId");
  }
  if (!ctx.correlationId?.trim()) {
    throw new AIGatewayError("AI gateway requires a correlationId", "MISSING_CORRELATION_ID");
  }
  if (!APPROVED_PROVIDERS.includes(ctx.provider)) {
    throw new AIGatewayProviderError(
      `Provider "${ctx.provider}" is not in the approved provider list. ` +
      `Approved: ${APPROVED_PROVIDERS.join(", ")}`,
    );
  }

  const permittedPurposes = ROLE_PURPOSE_ALLOWLIST[ctx.role] ?? [];
  if (!permittedPurposes.includes(ctx.purpose)) {
    throw new AIGatewayPurposeError(
      `Role "${ctx.role}" is not authorised for purpose "${ctx.purpose}". ` +
      `Permitted purposes: ${permittedPurposes.join(", ")}`,
    );
  }
}

// ─── Field validation ─────────────────────────────────────────────────────────

function validateFields(purpose: AIPurpose, fields: string[]): void {
  const allowlisted = PURPOSE_FIELD_ALLOWLIST[purpose] ?? [];
  const forbidden = fields.filter(f => !allowlisted.includes(f));
  if (forbidden.length > 0) {
    throw new AIGatewayDataError(
      `Data fields not permitted for purpose "${purpose}": ${forbidden.join(", ")}. ` +
      `Permitted fields: ${allowlisted.join(", ")}`,
      forbidden,
    );
  }
}

// ─── Request processing ───────────────────────────────────────────────────────

async function processRequest(ctx: AIGatewayContext, request: AIRequest): Promise<AIResponse> {
  const responseId = randomUUID();
  const requestAuditId = randomUUID();
  const startMs = Date.now();
  const retrievedFields = request.retrievedFields ?? [];
  const runtimeProfile = resolveRuntimeProfile(ctx, request);
  const fallbackAllowed = resolveProviderFallbackAllowed(request, runtimeProfile);

  // ── Output mode — resolve with backward-compat default ───────────────────
  // Sprint 28.7: callers must declare outputMode explicitly.
  // The legacy default is "json" (historic behavior was always json_object).
  const outputMode: GatewayOutputMode = request.outputMode ?? (() => {
    console.warn(
      `[AI Gateway] WARN: outputMode not declared by caller — defaulting to "json". ` +
      `correlationId=${ctx.correlationId} purpose=${ctx.purpose}. ` +
      `Set outputMode explicitly on every gateway.process() call.`,
    );
    return "json" as GatewayOutputMode;
  })();

  // Validate retrieved fields against purpose allowlist.
  // On denial: write a structured audit event (with denied field paths) THEN re-throw.
  // The customer-facing message is constructed by the caller from the correlationId.
  if (retrievedFields.length > 0) {
    try {
      validateFields(ctx.purpose, retrievedFields);
    } catch (err) {
      if (err instanceof AIGatewayDataError) {
        await writeGatewayDenialAuditEvent(ctx, err.deniedFields);
        // Log denied fields internally; do not surface field names in the thrown message
        // — the caller should present a safe customer message referencing correlationId.
        console.error(
          `[AI Gateway] DATA_NOT_PERMITTED correlationId=${ctx.correlationId} ` +
          `purpose=${ctx.purpose} org=${ctx.organizationId} ` +
          `denied=[${err.deniedFields.join(", ")}]`,
        );
      }
      throw err;
    }
  }

  // ── Pre-request audit event ────────────────────────────────────────────────
  await writeGatewayAuditEvent({
    auditId: requestAuditId,
    ctx,
    eventType: "ai_gateway.request_initiated",
    phase: "request",
    responseId,
    retrievedFields,
    outputMode,
    runtimeProfile,
    fallbackAllowed,
  });

  // ── Provider routing ───────────────────────────────────────────────────────
  const configuredProvider = getConfiguredProvider();
  let content: string;
  let usedFallback = false;
  let fallbackReason: string | undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  let actualModel: string | undefined;
  let actualResponseFormat: string | null = null;
  let actualFinishReason: string | null = null;
  let cachedInputTokens: number | null = null;
  let configuredTimeoutMs: number | undefined;
  let retryCount: number | undefined;
  let providerFailureKind: string | undefined;

  if (ctx.provider === "internal" || configuredProvider === "internal") {
    // Internal deterministic routing — no external call
    content = buildInternalResponse(ctx);
  } else if (configuredProvider === "openai") {
    // OpenAI provider — fallback only when the caller's runtime profile permits it.
    try {
      const result = await callOpenAI({ ...request, outputMode, runtimeProfile });
      content = result.content;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
      actualModel = result.model;
      actualResponseFormat = result.responseFormat;
      actualFinishReason = result.finishReason;
      cachedInputTokens = result.cachedInputTokens;
      configuredTimeoutMs = result.configuredTimeoutMs;
      retryCount = result.retries;
      recordSuccess({
        organizationId: ctx.organizationId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs,
      });
    } catch (err) {
      // Log and fall back to internal
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorKind = err instanceof OpenAIProviderError ? err.kind : "api_error";
      providerFailureKind = errorKind;
      configuredTimeoutMs = err instanceof OpenAIProviderError ? err.timeoutMs : undefined;
      retryCount = err instanceof OpenAIProviderError ? err.retries : undefined;
      fallbackReason = `OpenAI ${errorKind}: ${errorMsg}`;
      recordFailure(ctx.organizationId);
      if (!fallbackAllowed) {
        const latencyMs = Date.now() - startMs;
        await writeGatewayAuditEvent({
          auditId: randomUUID(),
          ctx,
          eventType: "ai_gateway.provider_failure",
          phase: "response",
          responseId,
          retrievedFields,
          requiresHumanApproval: ctx.requiresHumanApproval,
          usedFallback: false,
          fallbackReason,
          inputTokens,
          outputTokens,
          latencyMs,
          outputMode,
          runtimeProfile,
          fallbackAllowed,
          configuredTimeoutMs,
          retryCount,
          providerFailureKind,
        });
        console.warn(
          `[AI Gateway] WARN: OpenAI provider failed — deterministic fallback disabled. ` +
          `correlationId=${ctx.correlationId} runtimeProfile=${runtimeProfile} ` +
          `outputMode=${outputMode} reason="${fallbackReason}"`,
        );
        const providerFailureCode = errorKind === "timeout" ? "PROVIDER_TIMEOUT" : "PROVIDER_RUNTIME_FAILURE";
        throw new AIGatewayError(
          `AI provider ${errorKind} for ${runtimeProfile}: ${fallbackReason}`,
          providerFailureCode,
        );
      }
      usedFallback = true;
      recordFallback(ctx.organizationId);
      content = buildInternalResponse(ctx);
      console.warn(
        `[AI Gateway] WARN: OpenAI provider failed — using deterministic fallback. ` +
        `correlationId=${ctx.correlationId} runtimeProfile=${runtimeProfile} ` +
        `outputMode=${outputMode} reason="${fallbackReason}"`,
      );
    }
  } else {
    // Other external providers not yet connected
    throw new AIGatewayError(
      `External AI provider "${ctx.provider}" is not yet connected. ` +
      "Configure AI_PROVIDER=openai to enable external provider support.",
      "PROVIDER_NOT_CONNECTED",
    );
  }

  const latencyMs = Date.now() - startMs;

  const response: AIResponse = {
    responseId,
    content,
    requiresHumanApproval: ctx.requiresHumanApproval,
    purpose: ctx.purpose,
    provider: ctx.provider,
    correlationId: ctx.correlationId,
    auditEventId: requestAuditId,
    generatedAt: new Date(),
    latencyMs,
    model: actualModel,
    usedFallback,
    fallbackReason,
    configuredTimeoutMs,
    retryCount,
    runtimeProfile,
    providerFailureKind,
    usage: inputTokens > 0 ? { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, cachedInputTokens } : undefined,
    outputMode,
    responseFormat: actualResponseFormat,
    finishReason: actualFinishReason,
    cachedInputTokens,
  };

  // ── Post-response audit event ──────────────────────────────────────────────
  await writeGatewayAuditEvent({
    auditId: randomUUID(),
    ctx,
    eventType: "ai_gateway.response_delivered",
    phase: "response",
    responseId,
    retrievedFields,
    requiresHumanApproval: ctx.requiresHumanApproval,
    usedFallback,
    fallbackReason,
    inputTokens,
    outputTokens,
    latencyMs,
    outputMode,
    runtimeProfile,
    fallbackAllowed,
    modelUsed: actualModel,
    responseFormat: actualResponseFormat,
    finishReason: actualFinishReason,
    configuredTimeoutMs,
    retryCount,
    providerFailureKind,
  });

  return response;
}

// ─── Internal fallback response ───────────────────────────────────────────────

function buildInternalResponse(ctx: AIGatewayContext): string {
  return JSON.stringify({
    _source: "internal_deterministic",
    provider: ctx.provider,
    purpose: ctx.purpose,
    correlationId: ctx.correlationId,
  });
}

function resolveRuntimeProfile(ctx: AIGatewayContext, request: AIRequest): AIRuntimeProfile {
  if (request.runtimeProfile) return request.runtimeProfile;
  if (ctx.purpose === "conversation_intelligence") return "conversation_intelligence";
  if (ctx.purpose === "work_self_review_revision") return "self_review";
  return "default";
}

function resolveProviderFallbackAllowed(request: AIRequest, runtimeProfile: AIRuntimeProfile): boolean {
  if (typeof request.allowProviderFallback === "boolean") {
    return request.allowProviderFallback;
  }
  return !(
    runtimeProfile === "professional_execution" ||
    runtimeProfile === "final_synthesis" ||
    runtimeProfile === "targeted_repair"
  );
}

// ─── Provider config ──────────────────────────────────────────────────────────

function getConfiguredProvider(): ApprovedProvider {
  const env = (process.env.AI_PROVIDER ?? "internal").toLowerCase().trim();
  if (APPROVED_PROVIDERS.includes(env as ApprovedProvider)) {
    return env as ApprovedProvider;
  }
  return "internal";
}

// ─── Audit writer ─────────────────────────────────────────────────────────────

interface GatewayAuditParams {
  auditId: string;
  ctx: AIGatewayContext;
  eventType: string;
  phase: "request" | "response";
  responseId: string;
  retrievedFields: string[];
  requiresHumanApproval?: boolean;
  usedFallback?: boolean;
  fallbackReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  /** Sprint 28.7 diagnostics */
  outputMode?: GatewayOutputMode;
  runtimeProfile?: AIRuntimeProfile;
  fallbackAllowed?: boolean;
  modelUsed?: string;
  responseFormat?: string | null;
  finishReason?: string | null;
  configuredTimeoutMs?: number;
  retryCount?: number;
  providerFailureKind?: string;
}

/**
 * Writes a structured audit event when the gateway denies a data-field request.
 * Records denied field paths internally; does NOT expose them in the thrown error
 * message visible to end-users (caller uses correlationId for customer messaging).
 * Satisfies Part 9 of the task_execution data-field contract.
 */
async function writeGatewayDenialAuditEvent(
  ctx: AIGatewayContext,
  deniedFields: string[],
): Promise<void> {
  await platformDb.insert(orgAuditLogTable).values({
    id: randomUUID(),
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    actorType: "ai_gateway",
    eventType: "ai_gateway.field_access_denied" as any,
    resourceType: "ai_request",
    resourceId: ctx.correlationId,
    accessPurpose: ctx.purpose,
    isSensitive: true,
    metadata: {
      correlationId: ctx.correlationId,
      purpose: ctx.purpose,
      role: ctx.role,
      decision: "denied",
      // Full field paths logged internally for platform operators — never sent to customers.
      deniedFieldPaths: deniedFields,
      permittedDataClasses: PURPOSE_FIELD_ALLOWLIST[ctx.purpose as AIPurpose] ?? [],
    },
    occurredAt: new Date(),
  }).catch(() => {
    console.error("[AI Gateway] WARN: Failed to write field-denial audit event", ctx.correlationId);
  });
}

async function writeGatewayAuditEvent(params: GatewayAuditParams): Promise<void> {
  await platformDb.insert(orgAuditLogTable).values({
    id: params.auditId,
    organizationId: params.ctx.organizationId,
    actorUserId: params.ctx.userId,
    actorType: "ai_gateway",
    eventType: params.eventType as any,
    resourceType: "ai_request",
    resourceId: params.responseId,
    accessPurpose: params.ctx.purpose,
    isSensitive: true,
    metadata: {
      correlationId: params.ctx.correlationId,
      provider: params.ctx.provider,
      configuredProvider: getConfiguredProvider(),
      purpose: params.ctx.purpose,
      role: params.ctx.role,
      retentionClass: params.ctx.retentionClass,
      phase: params.phase,
      retrievedFieldCount: params.retrievedFields.length,
      retrievedFields: params.retrievedFields,
      requiresHumanApproval: params.requiresHumanApproval ?? params.ctx.requiresHumanApproval,
      usedFallback: params.usedFallback ?? false,
      fallbackReason: params.fallbackReason ?? null,
      inputTokens: params.inputTokens ?? 0,
      outputTokens: params.outputTokens ?? 0,
      latencyMs: params.latencyMs ?? null,
      outputMode: params.outputMode ?? null,
      runtimeProfile: params.runtimeProfile ?? null,
      fallbackAllowed: params.fallbackAllowed ?? null,
      modelUsed: params.modelUsed ?? null,
      responseFormat: params.responseFormat ?? null,
      finishReason: params.finishReason ?? null,
      configuredTimeoutMs: params.configuredTimeoutMs ?? null,
      retryCount: params.retryCount ?? null,
      providerFailureKind: params.providerFailureKind ?? null,
    },
    occurredAt: new Date(),
  }).catch(() => {
    console.error("[AI Gateway] WARN: Failed to write audit event for response", params.responseId);
  });
}

// ─── Provider registry ────────────────────────────────────────────────────────

/**
 * Lists all approved providers and their connection status.
 * Used by the platform console to show gateway health.
 */
export function getProviderRegistry(): AIProviderHealth[] {
  const configured = getConfiguredProvider();
  return APPROVED_PROVIDERS.map(provider => {
    if (provider === "openai") {
      return {
        provider,
        connected: configured === "openai" && isOpenAIConfigured(),
        configured: isOpenAIConfigured(),
        requiresApproval: true,
        model: isOpenAIConfigured() ? getOpenAIModel() : undefined,
      };
    }
    return {
      provider,
      connected: provider === "internal",
      configured: provider === "internal",
      requiresApproval: provider !== "internal",
    };
  });
}

/**
 * Returns the current active provider and its health summary.
 * Used by the platform AI Operations dashboard.
 */
export function getActiveProviderStatus(): {
  provider: ApprovedProvider;
  connected: boolean;
  model: string | undefined;
  usageStats: ReturnType<typeof getGlobalStats>;
} {
  const provider = getConfiguredProvider();
  const model = provider === "openai" && isOpenAIConfigured() ? getOpenAIModel() : undefined;
  return {
    provider,
    connected: provider === "internal" || (provider === "openai" && isOpenAIConfigured()),
    model,
    usageStats: getGlobalStats(provider, model ?? "deterministic"),
  };
}
