/**
 * @workspace/ai-gateway — Sprint 9.1
 *
 * AI Privacy Gateway for NeedsOps AI+.
 *
 * ALL AI requests involving customer data MUST pass through this gateway.
 * Direct model-provider SDK calls in application code are prohibited.
 *
 * Current status:
 *   • Gateway enforcement layer: ACTIVE
 *   • Audit event writing: ACTIVE
 *   • Purpose + role authorisation: ACTIVE
 *   • Field-level access control: ACTIVE
 *   • OpenAI provider: ACTIVE when AI_PROVIDER=openai + OPENAI_API_KEY set
 *   • Deterministic fallback: ACTIVE
 *   • Usage tracking: ACTIVE
 */

export {
  createAIGateway,
  getProviderRegistry,
  getActiveProviderStatus,
  type AIGateway,
} from "./aiGateway.js";

export {
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
  type RetentionClass,
  type AITokenUsage,
  type AIProviderHealth,
  type GatewayOutputMode,
  type AIRuntimeProfile,
} from "./types.js";

export {
  recordSuccess,
  recordFailure,
  recordFallback,
  incrementActiveStreams,
  decrementActiveStreams,
  getGlobalStats,
  getOrgStats,
  type OrgUsageStats,
  type GlobalUsageStats,
} from "./usageTracker.js";

export {
  isOpenAIConfigured,
  getOpenAIModel,
  resolveOpenAIRuntimePolicy,
  // Knowledge Hub embedding support (Task #16)
  callOpenAIEmbeddings,
  getEmbeddingDimensions,
  OpenAIProviderError,
  type OpenAIEmbeddingResult,
  type OpenAIRuntimePolicy,
} from "./providers/openai.js";
