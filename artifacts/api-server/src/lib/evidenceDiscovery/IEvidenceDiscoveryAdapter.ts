/**
 * Sprint 29N.6 — Part L: Evidence Discovery Adapter Interface
 *
 * Both Cloud and Hybrid discovery implementations must implement this interface
 * so they can be substituted behind the same discovery orchestrator.
 *
 * Cloud can reach:
 *   - Governed cloud-accessible organisational sources (cross-reference follow)
 *   - Approved external web sources (Authority Registry validated)
 *   - Cloud integrations when later authorised
 *
 * Hybrid can additionally reach:
 *   - Customer-local files
 *   - Local applications
 *   - Private network resources
 *   - Desktop Connector resources
 *
 * Neither gets authority merely because of where it runs.
 * Both must return CandidateEvidence.
 * Both must go through the same NeedsOps Authority Gate.
 *
 * CRITICAL: Adapters MUST NOT perform final professional analysis, compliance
 * conclusions, or gap analysis. They locate, retrieve, and return — they do
 * not decide. See Part I of the sprint brief.
 */

import type { EvidenceEscalationDecision } from "../../services/evidenceEscalationService.js";
import type { CandidateEvidence } from "../../types/candidateEvidence.js";
import type { EvidencePack } from "../../services/knowledgeResolutionService.js";

// ─── Adapter interface ────────────────────────────────────────────────────────

/**
 * Result from a single evidence discovery adapter invocation.
 * All candidates returned are raw — they have not yet been through the
 * NeedsOps Authority Gate. The orchestrator runs the gate after this returns.
 */
export interface AdapterDiscoveryResult {
  /** Unique adapter identifier — used for observability and routing */
  adapterName: string;
  /** All raw candidates discovered by this adapter */
  candidates: CandidateEvidence[];
  /** Number of document reference hops followed */
  hopsFollowed: number;
  /** Whether the adapter ran to completion (false = timeout or error) */
  completedCleanly: boolean;
  /** Human-readable explanation if the adapter could not complete */
  failureReason?: string;
  /** Wall-clock time from adapter invocation to return (ms) */
  durationMs: number;
}

/**
 * Parameters passed to an adapter's discover() call.
 * The adapter must respect all scope, hop, and timeout constraints.
 */
export interface AdapterDiscoveryParams {
  /** The escalation decision describing what to look for */
  escalation: EvidenceEscalationDecision;
  /** The V1 EvidencePack that was insufficient — context for the search */
  currentEvidencePack: EvidencePack;
  /** Adapter must not run longer than this (ms) */
  timeoutMs: number;
}

/**
 * Common interface for all evidence discovery adapters.
 *
 * Both Cloud and Hybrid implementations must satisfy this contract.
 * The orchestrator calls discover() and then runs every returned candidate
 * through the NeedsOps Authority Gate before anything touches the EvidencePack.
 *
 * Adapters MUST:
 *   - Respect escalation.maxHops
 *   - Respect escalation.maxSources
 *   - Respect escalation.maxPassages
 *   - Respect escalation.timeoutMs
 *   - Respect escalation.allowedDiscoveryScope
 *   - Never cross organisational tenant boundaries
 *   - Return raw candidates — NOT pre-validated AcceptedEvidence
 *
 * Adapters MUST NOT:
 *   - Write directly into an EvidencePack
 *   - Perform professional gap analysis or compliance conclusions
 *   - Assign their own authority scores as NeedsOps authority
 *   - Access sources outside the allowedDiscoveryScope
 *   - Throw — return completedCleanly=false with failureReason instead
 */
export interface IEvidenceDiscoveryAdapter {
  /** Unique stable name for this adapter — used in observability */
  readonly adapterName: string;

  /**
   * Returns true when this adapter is available in the current environment.
   * The orchestrator checks this before calling discover().
   */
  isAvailable(): boolean;

  /**
   * Discover candidate evidence based on the escalation decision.
   *
   * Must never throw. Returns completedCleanly=false on error or timeout.
   */
  discover(params: AdapterDiscoveryParams): Promise<AdapterDiscoveryResult>;

  /**
   * A brief description of what this adapter can reach.
   * Logged to observability to help diagnose discovery gaps.
   */
  reachDescription(): string;
}
