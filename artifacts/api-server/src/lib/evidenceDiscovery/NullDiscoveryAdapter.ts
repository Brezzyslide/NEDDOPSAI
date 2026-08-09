/**
 * Sprint 29N.6 — Part A / Part L: Null Discovery Adapter (Cloud default)
 *
 * This is the Cloud deployment's current evidence discovery adapter.
 *
 * Why null and not a real adapter:
 *   OpenClaw runs as an external binary process that is spawned by the Desktop
 *   Connector (artifacts/desktop-connector). It requires the openclaw binary
 *   to be installed on the host machine. In the Cloud/Replit deployment, no
 *   such binary is present — the OpenClaw runtime is desktop-only today.
 *
 *   The IGatewayAdapter / LiveGatewayAdapter in desktop-connector/src/broker/
 *   gatewayAdapter.ts spawns the binary via 'openclaw agent --mode rpc --json'
 *   or calls it via the browser bridge. Neither mechanism is available in Cloud.
 *
 *   lib/knowledge/providers/FutureProviders.ts explicitly marks Cloud knowledge
 *   providers as NotImplemented placeholders.
 *
 * What this means for the evidence pipeline:
 *   - P1/P2 (KRS sufficient) → NullAdapter never called → no impact whatsoever
 *   - P3/P4 (escalation required) → NullAdapter returns 0 candidates → honest
 *     execution failure rather than evidence-free Completed Work
 *   - P9 (OpenClaw unavailable, KRS sufficient) → NullAdapter never called → OK
 *   - P10 (OpenClaw unavailable, escalation required) → fails honestly
 *
 * Future:
 *   When a Cloud OpenClaw runtime becomes available (e.g. via cloud connector,
 *   SaaS agent API, or relay service), implement a CloudOpenClawDiscoveryAdapter
 *   that satisfies IEvidenceDiscoveryAdapter. The orchestrator will use it in
 *   place of this NullDiscoveryAdapter once isAvailable() returns true.
 *
 *   The HybridOpenClawDiscoveryAdapter (for Desktop Connector relay) would also
 *   implement the same interface, adding local filesystem and private network reach.
 */

import type {
  IEvidenceDiscoveryAdapter,
  AdapterDiscoveryResult,
  AdapterDiscoveryParams,
} from "./IEvidenceDiscoveryAdapter.js";

export class NullDiscoveryAdapter implements IEvidenceDiscoveryAdapter {
  readonly adapterName = "null_no_runtime";

  /**
   * Cloud OpenClaw is not yet available.
   * Always returns false so the orchestrator knows no discovery can run.
   */
  isAvailable(): boolean {
    return false;
  }

  /**
   * Returns an empty candidate set immediately.
   *
   * Because isAvailable() returns false, the orchestrator will not normally
   * call this method. It is implemented defensively in case of a logic error.
   */
  async discover(params: AdapterDiscoveryParams): Promise<AdapterDiscoveryResult> {
    const start = Date.now();
    console.info(
      "[NullDiscoveryAdapter] discover() called — no Cloud OpenClaw runtime available. " +
      `executionId=${params.escalation.executionId} scope=${params.escalation.allowedDiscoveryScope}`,
    );
    return {
      adapterName:       this.adapterName,
      candidates:        [],
      hopsFollowed:      0,
      completedCleanly:  true,
      failureReason:     "No Cloud OpenClaw runtime available in this deployment",
      durationMs:        Date.now() - start,
    };
  }

  reachDescription(): string {
    return "No discovery adapter available — Cloud OpenClaw runtime not yet deployed. " +
      "Evidence discovery requires OpenClaw binary (currently Desktop Connector only).";
  }
}

/** Singleton — one null adapter per process */
export const nullDiscoveryAdapter = new NullDiscoveryAdapter();
