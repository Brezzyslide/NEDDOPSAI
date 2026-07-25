/**
 * AI Privacy Gateway — Core — Sprint 7
 *
 * ALL AI requests involving customer data MUST pass through this gateway.
 * Direct model-provider calls are prohibited in application code.
 *
 * The gateway enforces:
 *   1. Authenticated user identity (never trusted from request body)
 *   2. Verified organisation membership (from platform DB)
 *   3. Purpose classification (caller declares intent)
 *   4. Role → purpose authorisation (role must be permitted for purpose)
 *   5. Minimum-necessary data access (only allowlisted fields per purpose)
 *   6. Approved model provider (registry of approved providers)
 *   7. Correlation ID tracing
 *   8. Mandatory audit event before and after any provider call
 *   9. Human approval requirement enforcement
 *   10. Retention classification
 *
 * Sprint 7 implementation note:
 *   No external AI provider calls are made in this sprint — the application
 *   uses deterministic routing only. The gateway establishes the enforced
 *   interface that Sprint 9 will connect to real providers.
 *   Any future model-provider call MUST go through this gateway.
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
} from "./types";

// ─── Gateway factory ──────────────────────────────────────────────────────────

export interface AIGateway {
  context: AIGatewayContext;
  /**
   * Processes an AI request through all gateway enforcement layers.
   * Writes audit events before and after the provider call.
   * Returns a response with tracing metadata.
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
  // ── Validate context at creation time ──────────────────────────────────────
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
  const now = new Date();

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

  // ── Provider call ──────────────────────────────────────────────────────────
  // Sprint 7 foundation: no real LLM calls — gateway enforces the interface.
  // Sprint 9 will connect real providers here.
  let content: string;

  if (ctx.provider === "internal") {
    // Internal deterministic routing — no external call
    content = `[AI Gateway Sprint 7 Foundation] Provider: ${ctx.provider}, Purpose: ${ctx.purpose}, Correlation: ${ctx.correlationId}. Real LLM integration is pending Sprint 9.`;
  } else {
    // External provider path — not yet connected in Sprint 7
    // This enforces that no application code bypasses the gateway:
    // the gateway is the ONLY place where external provider calls will be added.
    throw new AIGatewayError(
      `External AI provider "${ctx.provider}" is not yet connected. ` +
      "Sprint 9 will connect approved providers through this gateway. " +
      "Do not add direct provider SDK calls in application code.",
      "PROVIDER_NOT_CONNECTED",
    );
  }

  const response: AIResponse = {
    responseId,
    content,
    requiresHumanApproval: ctx.requiresHumanApproval,
    purpose: ctx.purpose,
    provider: ctx.provider,
    correlationId: ctx.correlationId,
    auditEventId: requestAuditId,
    generatedAt: now,
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
  });

  return response;
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
    isSensitive: true,  // All AI gateway events are sensitive
    metadata: {
      correlationId: params.ctx.correlationId,
      provider: params.ctx.provider,
      purpose: params.ctx.purpose,
      role: params.ctx.role,
      retentionClass: params.ctx.retentionClass,
      phase: params.phase,
      retrievedFieldCount: params.retrievedFields.length,
      // Note: retrievedFields are listed by name only — no values are logged
      retrievedFields: params.retrievedFields,
      requiresHumanApproval: params.requiresHumanApproval ?? params.ctx.requiresHumanApproval,
    },
    occurredAt: new Date(),
  }).catch(() => {
    // Audit write failure must not suppress the AI response, but must be logged
    console.error("[AI Gateway] WARN: Failed to write audit event for response", params.responseId);
  });
}

// ─── Provider registry ────────────────────────────────────────────────────────

/**
 * Lists all approved providers and their connection status.
 * Used by the platform console to show gateway health.
 */
export function getProviderRegistry(): Array<{
  provider: ApprovedProvider;
  connected: boolean;
  requiresApproval: boolean;
}> {
  return APPROVED_PROVIDERS.map(provider => ({
    provider,
    connected: provider === "internal",   // Only internal is connected in Sprint 7
    requiresApproval: provider !== "internal",
  }));
}
