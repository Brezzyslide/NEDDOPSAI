/**
 * @workspace/ai-gateway — Sprint 7 Foundation
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
 *   • External provider connections: NOT YET CONNECTED (Sprint 9)
 *   • Internal deterministic routing: ACTIVE
 */

export {
  createAIGateway,
  getProviderRegistry,
  type AIGateway,
} from "./aiGateway";

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
} from "./types";
