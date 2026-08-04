/**
 * IRuntimeAdapter — Runtime Discovery and Health Interface
 * Sprint 34: Cross-Platform Desktop Connector Architecture
 *
 * This interface decouples the connector from any specific AI execution runtime.
 * The IGatewayAdapter (in broker/types.ts) handles execution submission and
 * status tracking. This interface handles discovery, health, and metadata only.
 *
 * Supported runtimes:
 *   OpenClawRuntimeAdapter  — current production runtime
 *   OllamaRuntimeAdapter    — local LLM server
 *   LMStudioRuntimeAdapter  — LM Studio local API
 *   VllmRuntimeAdapter      — vLLM inference server
 *
 * Runtime selection for execution remains config-driven via OPENCLAW_GATEWAY_MODE
 * and the existing IGatewayAdapter factory. This adapter is for discovery only.
 *
 * Future runtimes (Docker, remote GPU, Kubernetes) implement the same interface.
 */

// ── Runtime capabilities ──────────────────────────────────────────────────────

export type RuntimeCapability =
  | "browser"            // Browser automation (OpenClaw)
  | "llm"                // Local LLM inference (Ollama, LM Studio, vLLM)
  | "local_files"        // File system access
  | "code_execution"     // Execute code locally
  | "vision"             // Image/screen understanding
  | "audio"              // Audio processing
  | "gpu_acceleration"   // Hardware GPU available
  | "docker"             // Docker container execution
  | "remote"             // Remote execution endpoint
  | "kubernetes";        // Kubernetes worker

// ── Runtime info ─────────────────────────────────────────────────────────────

export interface RuntimeInfo {
  /** Unique identifier for this runtime type. e.g. 'openclaw', 'ollama' */
  id: string;
  /** Human-readable name. e.g. 'OpenClaw', 'Ollama' */
  name: string;
  /** Whether the runtime was found and is reachable on this machine. */
  available: boolean;
  /** Version string if known. null if unavailable or undetectable. */
  version: string | null;
  /**
   * HTTP endpoint for API-based runtimes (Ollama, LM Studio, vLLM).
   * Not applicable for spawn-mode runtimes (OpenClaw CLI).
   */
  endpoint?: string;
  /** What this runtime can do. Used for capability reporting to the cloud. */
  capabilities: RuntimeCapability[];
  /**
   * Why the runtime is unavailable, if available === false.
   * Helps the user understand what to install or configure.
   */
  unavailableReason?: string;
  /** Timestamp of the last discovery check. ISO 8601. */
  discoveredAt: string;
}

// ── IRuntimeAdapter ───────────────────────────────────────────────────────────

export interface IRuntimeAdapter {
  /** Matches RuntimeInfo.id */
  readonly id: string;
  /** Matches RuntimeInfo.name */
  readonly name: string;

  /**
   * Check whether this runtime is available on the current machine.
   * Should be fast (< 5 seconds). Does not need to be exact — a best-effort
   * check (binary exists, HTTP probe, process list) is sufficient.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Return full runtime info including availability, version, and capabilities.
   * Called by RuntimeDiscovery. Should never throw — return available: false
   * with an unavailableReason instead of throwing.
   */
  getInfo(): Promise<RuntimeInfo>;
}
