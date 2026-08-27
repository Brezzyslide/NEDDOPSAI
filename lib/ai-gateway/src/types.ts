/**
 * AI Privacy Gateway — Types — Sprint 7 / Sprint 9.1 / Sprint 28.7
 *
 * All AI interactions involving customer information must pass through the
 * gateway. The gateway enforces identity, organisation isolation, purpose
 * classification, audit requirements, and provider approval.
 */

// ─── Output mode ──────────────────────────────────────────────────────────────

/**
 * Declares the expected output format for an AI request.
 *
 * Callers MUST set this explicitly — do not rely on provider defaults.
 *
 * - "text"       → Free-form prose or markdown. No response_format constraint
 *                  is sent to the provider. Required for specialist work
 *                  execution, self-review revision, and executive briefings.
 *
 * - "json"       → Structured JSON object. Sends response_format: json_object
 *                  to the provider. The prompt MUST contain the word "json".
 *                  Required for classification, scoring, and routing calls.
 *
 * - "structured" → Reserved for JSON Schema validation (strict typed output).
 *                  Architecture prepared; currently behaves identically to
 *                  "json". Callers should use this to signal intent so the
 *                  transition to full schema validation requires no caller changes.
 */
export type GatewayOutputMode = "text" | "json" | "structured";

// ─── Runtime profile ─────────────────────────────────────────────────────────

/**
 * More specific runtime intent for provider behavior that cannot be safely
 * inferred from the broad privacy purpose alone.
 *
 * Example: both short CoS classification and long-form professional drafting
 * flow through the same gateway, but they need different timeout/retry/fallback
 * behavior.
 */
export type AIRuntimeProfile =
  | "conversation_intelligence"
  | "professional_execution"
  | "final_synthesis"
  | "targeted_repair"
  | "self_review"
  | "default";

// ─── Purpose classification ───────────────────────────────────────────────────

/**
 * Every AI request must declare its purpose. The gateway enforces that only
 * approved purposes are permitted for each role.
 */
export type AIPurpose =
  | "task_planning"              // AI-assisted task creation and planning
  | "task_execution"             // AI executing an approved task
  | "workforce_routing"          // Matching tasks to specialists
  | "compliance_check"           // Checking against NDIS regulations
  | "report_generation"          // Generating summary reports
  | "knowledge_retrieval"        // RAG retrieval from org knowledge base
  | "search_assistance"          // Helping users search records
  | "conversation_intelligence"  // Sprint 9.1: Chief of Staff conversation understanding
  | "blueprint_classification"   // Sprint 28.7: Semantic work blueprint selection
  | "executive_briefing"         // Sprint 28.7: Executive dashboard AI briefing
  | "work_self_review_revision"  // Sprint 28.7: Specialist self-review draft revision
  | "knowledge_curation"         // Sprint 28.7: Knowledge Hub curation proposals
  | "internal_tooling"           // Platform internal (not customer-facing)
  | "testing";                   // Test and development only

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
  retrievedFields?: string[];
  /**
   * Declares the expected output format. Callers MUST set this explicitly.
   * See GatewayOutputMode for full documentation.
   *
   * - "text"       → prose/markdown (specialist work, briefings, revision)
   * - "json"       → structured JSON object (classification, scoring, routing)
   * - "structured" → reserved for JSON Schema validation; behaves as "json"
   *
   * When omitted, the gateway defaults to "json" for backward compatibility
   * and emits a console.warn. New callers must always set this field.
   */
  outputMode?: GatewayOutputMode;
  /** Model identifier (e.g. "gpt-4o-mini") */
  model?: string;
  maxTokens?: number;
  /**
   * Purpose-specific provider runtime profile.
   * Does not change data access permissions; it controls timeout/retry/fallback
   * policy for the already-authorised gateway request.
   */
  runtimeProfile?: AIRuntimeProfile;
  /**
   * External provider failures may use deterministic fallback for low-risk
   * planning/classification, but professional work generation must fail clearly
   * rather than manufacture content.
   */
  allowProviderFallback?: boolean;
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
  /** Sprint 9.1: token usage (undefined for internal/deterministic) */
  usage?: AITokenUsage;
  /** Sprint 9.1: actual model used */
  model?: string;
  /** Sprint 9.1: true when the deterministic fallback was used instead of OpenAI */
  usedFallback?: boolean;
  /** Sprint 9.1: reason the fallback was used */
  fallbackReason?: string;
  /** Sprint 9.1: time from request to response in ms */
  latencyMs?: number;
  /** Provider timeout configured for this request. */
  configuredTimeoutMs?: number;
  /** Provider retry attempts consumed before success/failure. */
  retryCount?: number;
  /** Runtime profile used to choose provider timeout/retry policy. */
  runtimeProfile?: AIRuntimeProfile;
  /** Machine-readable provider failure kind when fallback or failure occurs. */
  providerFailureKind?: string;
  /** Sprint 28.7: output mode declared by the caller */
  outputMode: GatewayOutputMode;
  /** Sprint 28.7: response_format value sent to the provider, or null for text mode */
  responseFormat: string | null;
  /** Provider completion finish reason when available. */
  finishReason?: string | null;
}

// ─── Token usage ──────────────────────────────────────────────────────────────

export interface AITokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// ─── Provider health ──────────────────────────────────────────────────────────

export interface AIProviderHealth {
  provider: ApprovedProvider;
  connected: boolean;
  configured: boolean;
  requiresApproval: boolean;
  model?: string;
}

// ─── Minimum-necessary retrieval ─────────────────────────────────────────────

/**
 * Defines which data fields are permitted for each purpose.
 * The gateway enforces this allowlist — no fields outside the list are
 * permitted to be passed to an AI provider.
 *
 * Data classes used by task_execution:
 *   task_core                  — task.id / title / description / executionPlan
 *   specialist_identity        — specialist.name / capabilities
 *   approved_organisation_evidence — organisationLibrarySources.* (no storageKey)
 *   approved_organisation_memory   — cosMemories.* (title reference only, no raw content)
 *   task_scoped_uploads        — taskUploads.* (no storageKey, no authorityLevel)
 *   entity_scoped_knowledge    — entityKnowledge.* (clearance-checked, task-scoped)
 *
 * Purpose separation:
 *   conversation_intelligence  — library presence metadata only; NO evidence chunks
 *   task_execution             — retrieved evidence chunks permitted
 *   knowledge_retrieval        — raw chunk retrieval; NO task or specialist context
 *   report_generation          — aggregates only; NO individual record content
 */
export const PURPOSE_FIELD_ALLOWLIST: Record<AIPurpose, string[]> = {
  // ── task_planning ── AI-assisted task creation; task metadata only
  task_planning:              ["task.id", "task.title", "task.description", "task.priority", "task.state"],

  // ── task_execution ── Evidence-aware specialist runtime
  //   task_core + specialist_identity (retained from metadata-only era)
  //   + approved_organisation_evidence, approved_organisation_memory,
  //     task_scoped_uploads, entity_scoped_knowledge (Sprint 22+)
  //
  //   Explicitly excluded: storageKey (raw GCS paths), embedding vectors,
  //   hidden system prompts, internal chain-of-thought, unrelated org memory,
  //   other-task uploads, unapproved library documents, taskUploads.authorityLevel.
  task_execution: [
    // task_core
    "task.id",
    "task.title",
    "task.description",
    "task.executionPlan",
    // blueprint-scoped execution context for final deliverable synthesis.
    // These fields describe the approved method and output contract only;
    // hidden prompts, chain-of-thought, storage keys, and unrelated records
    // remain excluded.
    "blueprint.objective",
    "blueprint.sections",
    "deliverableContract",
    "failedDraft.content",
    "gateFailures",
    "evidencePack.chunks",
    // specialist_identity
    "specialist.name",
    "specialist.capabilities",
    // approved_organisation_evidence (ManifestLibrarySource — storageKey excluded)
    "organisationLibrarySources.sourceId",
    "organisationLibrarySources.title",
    "organisationLibrarySources.sourceType",
    "organisationLibrarySources.versionLabel",
    "organisationLibrarySources.authorityLevel",
    "organisationLibrarySources.relevantChunks.text",
    "organisationLibrarySources.relevantChunks.confidence",
    // approved_organisation_memory (ManifestMemoryRef — approved text, 800-char truncated)
    // Safeguards: status=approved, org-scoped, relevance-filtered at assembly time.
    "cosMemories.memoryId",
    "cosMemories.memoryType",
    "cosMemories.title",
    "cosMemories.approvalStatus",
    "cosMemories.content",
    // task_scoped_uploads (ManifestLibrarySource — storageKey + authorityLevel excluded)
    "taskUploads.sourceId",
    "taskUploads.title",
    "taskUploads.sourceType",
    "taskUploads.versionLabel",
    // entity_scoped_knowledge (clearance-checked, task-scoped)
    "entityKnowledge.entityType",
    "entityKnowledge.entityId",
    "entityKnowledge.title",
    "entityKnowledge.relevantContent",
    "entityKnowledge.clearance",
  ],

  workforce_routing:          ["task.id", "task.title", "task.requiredCapabilities", "specialist.id", "specialist.capabilities", "specialist.availability"],
  compliance_check:           ["task.id", "task.title", "task.description", "approval.type", "approval.state"],
  report_generation:          ["task.aggregates", "approval.aggregates", "usage.aggregates"],
  // knowledge_retrieval — raw chunk retrieval; no task/specialist context permitted
  knowledge_retrieval:        ["knowledge.chunk", "knowledge.source", "knowledge.relevanceScore"],
  // search_assistance — task list metadata only; no content or evidence
  search_assistance:          ["task.id", "task.title", "task.state"],
  // conversation_intelligence — task/conversation metadata; no evidence chunks
  conversation_intelligence:  ["conversation.id", "task.id", "task.title", "task.state", "task.priority"],
  // Sprint 28.7 — internal-system purposes (no customer PII permitted)
  blueprint_classification:   [],    // Blueprint metadata only; no customer content
  executive_briefing:         ["task.aggregates", "task.state"],  // Aggregates only; no individual records
  work_self_review_revision:  [],    // Draft content only; passed inline, not retrieved
  knowledge_curation:         ["knowledge.chunk", "knowledge.source"],  // Chunk content for curation
  internal_tooling:           [],    // No customer data — platform internal only
  testing:                    ["test.mock"],  // Only mock data in test environment
};

// ─── Role → purpose authorisation ────────────────────────────────────────────

/**
 * Maps org roles to permitted AI purposes.
 * Gateway enforces this — members cannot invoke purposes their role doesn't permit.
 */
export const ROLE_PURPOSE_ALLOWLIST: Record<string, AIPurpose[]> = {
  owner:         ["task_planning", "task_execution", "workforce_routing", "compliance_check", "report_generation", "knowledge_retrieval", "search_assistance", "conversation_intelligence", "executive_briefing"],
  administrator: ["task_planning", "task_execution", "workforce_routing", "compliance_check", "report_generation", "knowledge_retrieval", "search_assistance", "conversation_intelligence", "executive_briefing"],
  manager:       ["task_planning", "task_execution", "workforce_routing", "knowledge_retrieval", "search_assistance", "conversation_intelligence"],
  member:        ["task_planning", "knowledge_retrieval", "search_assistance", "conversation_intelligence"],
  support:       ["search_assistance"],
  // Sprint 28.7: internal platform operations role — permitted for all system-initiated purposes.
  // Never granted to org users; only used by background services and specialist runtimes.
  system:        ["task_execution", "workforce_routing", "compliance_check", "knowledge_retrieval",
                  "blueprint_classification", "work_self_review_revision", "knowledge_curation",
                  "conversation_intelligence", "internal_tooling"],
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
  /** Structured list of denied field paths — safe for internal logs and audit. */
  public readonly deniedFields: string[];
  constructor(message: string, deniedFields: string[] = []) {
    super(message, "DATA_NOT_PERMITTED");
    this.deniedFields = deniedFields;
  }
}
