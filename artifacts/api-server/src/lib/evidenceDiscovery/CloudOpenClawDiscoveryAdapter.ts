/**
 * Sprint 29O.1 — Cloud OpenClaw Discovery Adapter
 *
 * Implements IEvidenceDiscoveryAdapter by forwarding evidence discovery
 * requests to the Mac-side OpenClaw broker via RuntimeBrokerClient.
 *
 * This adapter is available ONLY when:
 *   1. OPENCLAW_RUNTIME_URL is configured, AND
 *   2. The most recent broker health check succeeded (state === "connected")
 *
 * Otherwise NullDiscoveryAdapter continues to be used, and execution
 * continues without OpenClaw evidence (degraded but honest).
 *
 * Contract enforcement:
 *   - Returns raw CandidateEvidence[] — NOT AcceptedEvidence
 *   - Every returned candidate still passes through the NeedsOps Authority Gate
 *   - Adapter confidence is advisory; the gate assigns the final authority class
 *   - Tenant boundary is enforced by passing organisationId through the request
 *   - Must never throw — returns completedCleanly=false on any error
 *
 * Architecture rule (Part D of sprint brief):
 *   The CloudOpenClawDiscoveryAdapter is the ONLY place in api-server that
 *   calls RuntimeBrokerClient.discoverEvidence(). All other services use
 *   the orchestrator, which calls this adapter through the IEvidenceDiscoveryAdapter
 *   interface.
 */

import type {
  IEvidenceDiscoveryAdapter,
  AdapterDiscoveryResult,
  AdapterDiscoveryParams,
} from "./IEvidenceDiscoveryAdapter.js";
import type { CandidateEvidence } from "../../types/candidateEvidence.js";
import {
  RuntimeBrokerClient,
  loadOpenClawConfig,
  isOpenClawConfigured,
} from "@workspace/openclaw";
import type { BrokerCandidateEvidence } from "@workspace/openclaw";

// ─── Singleton broker client ───────────────────────────────────────────────────
//
// The adapter reuses the same RuntimeBrokerClient used by OpenClawExecutionEngine
// (same config, same heartbeat state). A new client is constructed here because
// the execution engine's client is private to that class; the config is identical.

let _client: RuntimeBrokerClient | null = null;

function getBrokerClient(): RuntimeBrokerClient | null {
  const config = loadOpenClawConfig();
  if (!isOpenClawConfigured(config)) return null;
  if (!_client) {
    _client = new RuntimeBrokerClient(config);
    // Trigger an initial health check so isAvailable() can return true quickly
    void _client.getHealth();
  }
  return _client;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class CloudOpenClawDiscoveryAdapter implements IEvidenceDiscoveryAdapter {
  readonly adapterName = "cloud_openclaw_broker";

  /**
   * Returns true when OPENCLAW_RUNTIME_URL is set AND the last health check
   * succeeded. Falls back to false (NullDiscoveryAdapter takes over) if the
   * runtime is unreachable.
   */
  isAvailable(): boolean {
    const client = getBrokerClient();
    if (!client) return false;
    const status = client.connectionStatus;
    // Only return true when the broker has confirmed connectivity via a health check.
    // "connecting" is the initial state before any health check — we do not count
    // that as available because the broker may be unreachable. The heartbeat loop
    // transitions state to "connected" after a successful health check.
    return status.state === "connected";
  }

  async discover(params: AdapterDiscoveryParams): Promise<AdapterDiscoveryResult> {
    const start = Date.now();
    const { escalation, timeoutMs } = params;

    const client = getBrokerClient();
    if (!client) {
      return {
        adapterName:      this.adapterName,
        candidates:       [],
        hopsFollowed:     0,
        completedCleanly: false,
        failureReason:    "OpenClaw broker client could not be initialised — OPENCLAW_RUNTIME_URL not set",
        durationMs:       Date.now() - start,
      };
    }

    try {
      const response = await client.discoverEvidence({
        organizationId:         escalation.organisationId,
        executionId:            escalation.executionId,
        specialistCode:         "chief_of_staff", // populated from escalation context
        searchObjective:        buildSearchObjective(escalation),
        unresolvedReferences:   escalation.unresolvedReferences ?? [],
        allowedDiscoveryScope:  escalation.allowedDiscoveryScope,
        allowExternalWebSearch: escalation.externalAuthorityRequired?.length > 0,
        maxHops:                escalation.maxHops,
        maxSources:             escalation.maxSources,
        maxPassages:            escalation.maxPassages,
        timeoutMs:              Math.min(timeoutMs, escalation.timeoutMs),
      });

      const candidates = response.candidates.map(c => brokerCandidateToCandidateEvidence(c));

      return {
        adapterName:      this.adapterName,
        candidates,
        hopsFollowed:     response.hopsFollowed,
        completedCleanly: true,
        durationMs:       Date.now() - start,
      };
    } catch (err) {
      return {
        adapterName:      this.adapterName,
        candidates:       [],
        hopsFollowed:     0,
        completedCleanly: false,
        failureReason:    `Cloud broker request failed: ${(err as Error).message}`,
        durationMs:       Date.now() - start,
      };
    }
  }

  reachDescription(): string {
    const config = loadOpenClawConfig();
    const url = config.runtimeUrl ?? "(not configured)";
    return `OpenClaw runtime via Cloudflare tunnel (broker URL: ${url}). ` +
      "Reaches all evidence accessible to NeedsTech OpenClaw on the connected Mac.";
  }
}

// ─── Type mapping ──────────────────────────────────────────────────────────────

/**
 * Map a BrokerCandidateEvidence (from lib/openclaw wire types) to the
 * full CandidateEvidence type used by the NeedsOps api-server.
 * The sourceType field is narrowed: unknown values become "unknown_external".
 */
function brokerCandidateToCandidateEvidence(
  b: BrokerCandidateEvidence,
): CandidateEvidence {
  const validSourceTypes = new Set([
    "organisational",
    "external_legislation",
    "external_regulation",
    "external_guidance",
    "external_standard",
    "external_case_law",
    "unknown_external",
  ]);

  const validAuthorityTypes = new Set([
    "legislation", "regulation", "government_guidance", "standard", "case_law",
  ]);

  return {
    organisationId:             b.organisationId,
    executionId:                b.executionId,
    discoveryId:                b.discoveryId,
    sourceType:                 validSourceTypes.has(b.sourceType)
                                  ? (b.sourceType as CandidateEvidence["sourceType"])
                                  : "unknown_external",
    isExternal:                 b.isExternal,
    internalSourceId:           b.internalSourceId,
    internalSourceVersionId:    b.internalSourceVersionId,
    internalChunkId:            b.internalChunkId,
    sourceUrl:                  b.sourceUrl,
    publisherDomain:            b.publisherDomain,
    claimedPublisher:           b.claimedPublisher,
    jurisdiction:               b.jurisdiction,
    sourceTitle:                b.sourceTitle,
    supportingPassage:          b.supportingPassage,
    passageHash:                b.passageHash,
    retrievalTimestamp:         b.retrievalTimestamp,
    retrievalMethod:            b.retrievalMethod,
    discoveryReason:            b.discoveryReason,
    unresolvedReferenceContext: b.unresolvedReferenceContext,
    authorityType:              (b.authorityType && validAuthorityTypes.has(b.authorityType))
                                  ? (b.authorityType as CandidateEvidence["authorityType"])
                                  : undefined,
    publicationDate:            b.publicationDate,
    effectiveDate:              b.effectiveDate,
    openClawConfidence:         b.openClawConfidence,
    relevanceScore:             b.relevanceScore,
    contentType:                b.contentType,
    accessLocation:             b.accessLocation,
  };
}

/**
 * Synthesise a human-readable search objective from the escalation decision.
 * The broker/OpenClaw uses this as the primary search query.
 */
function buildSearchObjective(
  escalation: AdapterDiscoveryParams["escalation"],
): string {
  const parts: string[] = [];

  if (escalation.requiredEvidence?.length) {
    parts.push(`Required evidence: ${escalation.requiredEvidence.join("; ")}`);
  }
  if (escalation.unresolvedReferences?.length) {
    parts.push(`Unresolved references: ${escalation.unresolvedReferences.join("; ")}`);
  }
  if (escalation.externalAuthorityRequired?.length) {
    parts.push(`External authority needed: ${escalation.externalAuthorityRequired.join("; ")}`);
  }

  return parts.length > 0
    ? parts.join(". ")
    : `Evidence discovery for execution ${escalation.executionId}`;
}

/** Singleton instance for the orchestrator */
export const cloudOpenClawDiscoveryAdapter = new CloudOpenClawDiscoveryAdapter();
