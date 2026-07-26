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
    );
  }
}

// ─── Request processing ───────────────────────────────────────────────────────

async function processRequest(ctx: AIGatewayContext, request: AIRequest): Promise<AIResponse> {
  const responseId = randomUUID();
  const requestAuditId = randomUUID();
  const startMs = Date.now();

  // Validate retrieved fields against purpose allowlist
  if (request.retrievedFields.length > 0) {
    validateFields(ctx.purpose, request.retrievedFields);
  }

  // ── Pre-request audit event ────────────────────────────────────────────────
  await writeGatewayAuditEvent({
    auditId: requestAuditId,
    ctx,
    eventType: "ai_gateway.request_initiated",
    phase: "request",
    responseId,
    retrievedFields: request.retrievedFields,
  });

  // ── Provider routing ───────────────────────────────────────────────────────
  const configuredProvider = getConfiguredProvider();
  let content: string;
  let usedFallback = false;
  let fallbackReason: string | undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  let actualModel: string | undefined;

  if (ctx.provider === "internal" || configuredProvider === "internal") {
    // Internal deterministic routing — no external call
    content = buildInternalResponse(ctx);
  } else if (configuredProvider === "openai") {
    // OpenAI provider — with automatic fallback to internal on failure
    try {
      const result = await callOpenAI(request);
      content = result.content;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
      actualModel = result.model;
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
      fallbackReason = `OpenAI ${errorKind}: ${errorMsg}`;
      usedFallback = true;
      recordFailure(ctx.organizationId);
      recordFallback(ctx.organizationId);
      content = buildInternalResponse(ctx);
      console.warn(
        `[AI Gateway] WARN: OpenAI provider failed — using deterministic fallback. ` +
        `correlationId=${ctx.correlationId} reason="${fallbackReason}"`,
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
    usage: inputTokens > 0 ? { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens } : undefined,
  };

  // ── Post-response audit event ──────────────────────────────────────────────
  await writeGatewayAuditEvent({
    auditId: randomUUID(),
    ctx,
    eventType: "ai_gateway.response_delivered",
    phase: "response",
    responseId,
    retrievedFields: request.retrievedFields,
    requiresHumanApproval: ctx.requiresHumanApproval,
    usedFallback,
    fallbackReason,
    inputTokens,
    outputTokens,
    latencyMs,
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
