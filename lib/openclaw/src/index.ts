/**
 * @workspace/openclaw
 *
 * OpenClaw Runtime Adapter for NeedsOps AI+.
 *
 * This package is the only part of NeedsOps that knows about the OpenClaw
 * Runtime Broker. All other platform code uses the ExecutionEngine interface
 * from @workspace/agent-runtime.
 */

export { OpenClawExecutionEngine } from "./openClawExecutionEngine.js";
export { RuntimeBrokerClient, BrokerRequestError } from "./runtimeBrokerClient.js";
export { loadOpenClawConfig, isOpenClawConfigured, buildCallbackUrl } from "./config.js";
export type { OpenClawConfig } from "./config.js";
export {
  translateToOpenClawPackage,
  validateExecutionPackage,
  getStatusMessage,
  EXECUTION_STATUS_MESSAGES,
  ExecutionPackageValidationError,
} from "./executionPackageTranslator.js";
export {
  translateOpenClawEvent,
  validateOpenClawEvent,
  resolveStatusTransition,
  resolveTaskStateUpdate,
  isTerminalStatus,
  EVENT_TO_STATUS_TRANSITION,
  TERMINAL_EXECUTION_STATUSES,
  RuntimeEventValidationError,
} from "./runtimeEventTranslator.js";
export type {
  OpenClawExecutionPackage,
  OpenClawSubmissionResponse,
  OpenClawStatusResponse,
  OpenClawHealthResponse,
  OpenClawWebhookEvent,
  OpenClawEventType,
  BrokerConnectionStatus,
  BrokerConnectionState,
} from "./types.js";
