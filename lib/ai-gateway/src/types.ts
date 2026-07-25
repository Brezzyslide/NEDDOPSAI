/**
 * AI Privacy Gateway — Types — Sprint 7
 *
 * All AI interactions involving customer information must pass through the
 * gateway. The gateway enforces identity, organisation isolation, purpose
 * classification, audit requirements, and provider approval.
 */

// ─── Purpose classification ───────────────────────────────────────────────────

/**
 * Every AI request must declare its purpose. The gateway enforces that only
 * approved purposes are permitted for each role.
 */
export type AIPurpose =
  | "task_planning"           // AI-assisted task creation and planning
  | "task_execution"          // AI executing an approved task
  | "workforce_routing"       // Matching tasks to specialists
  | "compliance_check"        // Checking against NDIS regulations
  | "report_generation"       // Generating summary reports
  | "knowledge_retrieval"     // RAG retrieval from org knowledge base
  | "search_assistance"       // Helping users search records
  | "internal_tooling"        // Platform internal (not customer-facing)
  | "testing";                // Test and development only

// ─── Retention classification ──────────────────────────────────────────────────

export type RetentionClass =
  | "transient"               // Not retained — one-shot response only
  | "session"                 // Retained for session duration
  | "operational"             // Retained in org DB for operational period
  | "audit"                   // Retained in audit log for compliance period
  | "long_term";              // NDIS compliance: 7 years

// ─── Provider registry ────────────────────────────────────────────────────────

/** Approved AI model providers */
export type ApprovedProvider =
  | "anthropic"
  | "openai"
  | "openrouter"
  | "gemini"
  | "internal";               // Internal deterministic routing (no external LLM)

/** No external LLM calls are permitted outside this list */
export const APPROVED_PROVIDERS: ApprovedProvider[] = [
  "anthropic",
  "openai",
  "openrouter",
  "gemini",
  "internal",
];

// ─── Gateway context ──────────────────────────────────────────────────────────

/**
 * Required context for every AI request through the gateway.
 * The gateway verifies all fields before processing.
 */
export interface AIGatewayContext {
  /** Authenticated user ID — from Clerk session, never from request body */
  userId: string;
  /** Verified organisation ID — from platform DB membership check */
  organizationId: string;
  /** User's role in the organisation */
  role: string;
  /** User's operational permissions */
  permissions: string[];
  /** Purpose of this AI invocation — determines what data may be retrieved */
  purpose: AIPurpose;
  /** Request correlation ID for distributed tracing */
  correlationId: string;
  /** Approved provider to invoke */
  provider: ApprovedProvider;
  /** How long the AI response may be retained */
  retentionClass: RetentionClass;
  /**
   * Whether a human must approve the AI output before it can act.
   * Must be TRUE for any action that modifies records or sends messages.
   */
  requiresHumanApproval: boolean;
}

// ─── AI request and response ──────────────────────────────────────────────────

export interface AIRequest {
  /** System prompt — may NOT contain raw customer PII */
  systemPrompt: string;
  /** User message — constructed by the gateway, never passed raw from client */
  userMessage: string;
  /**
   * Data fields retrieved for this request — minimum necessary only.
   * Each field must be justified by the declared purpose.
   */
  retrievedFields: string[];
  /** Model identifier (e.g. "claude-3-5-haiku-20241022") */
  model?: string;
  maxTokens?: number;
}

export interface AIResponse {
  /** Gateway-assigned ID for this response */
  responseId: string;
  /** The AI-generated content */
  content: string;
  /** Whether human approval is required before acting on this response */
  requiresHumanApproval: boolean;
  /** The purpose this response was generated for */
  purpose: AIPurpose;
  /** Provider used */
  provider: ApprovedProvider;
  /** Correlation ID for tracing */
  correlationId: string;
  /** Audit event ID written for this response */
  auditEventId: string;
  /** UTC timestamp */
  generatedAt: Date;
}

// ─── Minimum-necessary retrieval ─────────────────────────────────────────────

/**
 * Defines which data fields are permitted for each purpose.
 * The gateway enforces this allowlist — no fields outside the list are
 * permitted to be passed to an AI provider.
 */
export const PURPOSE_FIELD_ALLOWLIST: Record<AIPurpose, string[]> = {
  task_planning: ["task.id", "task.title", "task.description", "task.priority", "task.state"],
  task_execution: ["task.id", "task.title", "task.description", "task.executionPlan", "specialist.name", "specialist.capabilities"],
  workforce_routing: ["task.id", "task.title", "task.requiredCapabilities", "specialist.id", "specialist.capabilities", "specialist.availability"],
  compliance_check: ["task.id", "task.title", "task.description", "approval.type", "approval.state"],
  report_generation: ["task.aggregates", "approval.aggregates", "usage.aggregates"],
  knowledge_retrieval: ["knowledge.chunk", "knowledge.source", "knowledge.relevanceScore"],
  search_assistance: ["task.id", "task.title", "task.state"],
  internal_tooling: [],    // No customer data — platform internal only
  testing: ["test.mock"],  // Only mock data in test environment
};

// ─── Role → purpose authorisation ────────────────────────────────────────────

/**
 * Maps org roles to permitted AI purposes.
 * Gateway enforces this — members cannot invoke purposes their role doesn't permit.
 */
export const ROLE_PURPOSE_ALLOWLIST: Record<string, AIPurpose[]> = {
  owner:         ["task_planning", "task_execution", "workforce_routing", "compliance_check", "report_generation", "knowledge_retrieval", "search_assistance"],
  administrator: ["task_planning", "task_execution", "workforce_routing", "compliance_check", "report_generation", "knowledge_retrieval", "search_assistance"],
  manager:       ["task_planning", "task_execution", "workforce_routing", "knowledge_retrieval", "search_assistance"],
  member:        ["task_planning", "knowledge_retrieval", "search_assistance"],
  support:       ["search_assistance"],
};

// ─── Error types ──────────────────────────────────────────────────────────────

export class AIGatewayError extends Error {
  public readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "AIGatewayError";
    this.code = code;
  }
}

export class AIGatewayAuthError extends AIGatewayError {
  constructor(message: string) {
    super(message, "AUTH_REJECTED");
  }
}

export class AIGatewayPurposeError extends AIGatewayError {
  constructor(message: string) {
    super(message, "PURPOSE_NOT_PERMITTED");
  }
}

export class AIGatewayProviderError extends AIGatewayError {
  constructor(message: string) {
    super(message, "PROVIDER_NOT_APPROVED");
  }
}

export class AIGatewayDataError extends AIGatewayError {
  constructor(message: string) {
    super(message, "DATA_NOT_PERMITTED");
  }
}
