/**
 * POST /v1/evidence/discover — Sprint 29O.1
 *
 * Mac-side evidence discovery endpoint.  The NeedsOps API (Replit) sends a
 * governed discovery request; this route validates it, delegates to the local
 * OpenClaw runtime, and returns raw CandidateEvidence[].
 *
 * Auth:   Already enforced by the broker auth middleware before this router is
 *         reached.  Constant-time Bearer token comparison in auth.ts.
 *
 * Limits enforced here:
 *   - Required fields check (400)
 *   - timeoutMs capped at MAX_DISCOVERY_TIMEOUT_MS
 *   - maxHops / maxSources / maxPassages capped at documented maxima
 *   - Body size limit is enforced by express.json({ limit: config.maxBodyBytes })
 *     before this handler runs.
 *   - organisationId and executionId must be non-empty strings (tenant boundary)
 *
 * Security:
 *   - OpenClaw's local port (OPENCLAW_GATEWAY_URL, default 19001) is NEVER
 *     directly exposed through the tunnel.  All traffic enters port BROKER_PORT
 *     (default 19002) and goes through auth before reaching this handler.
 *   - organisationId is carried through to every candidate so the Authority
 *     Gate on the Replit side can enforce tenant boundaries.
 */

import { Router, type Request, type Response } from "express";
import { randomUUID, createHash } from "crypto";
import type { BrokerConfig, IGatewayAdapter } from "../types.js";
import type pino from "pino";

// ─── Constants ─────────────────────────────────────────────────────────────────

const MAX_DISCOVERY_TIMEOUT_MS = 60_000;   // hard cap
const MAX_HOPS                 = 5;
const MAX_SOURCES              = 20;
const MAX_PASSAGES             = 10;

// ─── Wire types (broker does not import from api-server) ──────────────────────

export interface DiscoveryBrokerRequest {
  organizationId:          string;
  executionId:             string;
  specialistCode:          string;
  searchObjective:         string;
  unresolvedReferences?:   string[];
  allowedDiscoveryScope?:  string;
  allowExternalWebSearch?: boolean;
  maxHops?:                number;
  maxSources?:             number;
  maxPassages?:            number;
  timeoutMs?:              number;
}

export interface BrokerCandidateEvidence {
  organisationId:            string;
  executionId:               string;
  discoveryId:               string;
  sourceType:                string;
  isExternal:                boolean;
  internalSourceId?:         string;
  internalSourceVersionId?:  string;
  internalChunkId?:          string;
  sourceUrl?:                string;
  publisherDomain?:          string;
  claimedPublisher?:         string;
  jurisdiction?:             string;
  sourceTitle:               string;
  supportingPassage:         string;
  passageHash:               string;
  retrievalTimestamp:        string;
  retrievalMethod:           string;
  discoveryReason:           string;
  unresolvedReferenceContext?: string;
  authorityType?:            string;
  publicationDate?:          string;
  effectiveDate?:            string;
  openClawConfidence:        number;
  relevanceScore:            number;
  contentType:               string;
  accessLocation:            string;
}

export interface DiscoveryBrokerResponse {
  candidates:          BrokerCandidateEvidence[];
  discoveryDurationMs: number;
  openClawStatus:      "available" | "simulated" | "unavailable";
  hopsFollowed:        number;
}

// ─── Router factory ────────────────────────────────────────────────────────────

export function createEvidenceRouter(
  config: BrokerConfig,
  gateway: IGatewayAdapter,
  logger: pino.Logger,
): Router {
  const router = Router();

  // ── POST /evidence/discover ────────────────────────────────────────────────
  router.post("/evidence/discover", async (req: Request, res: Response) => {
    const startMs = Date.now();

    // ── Validate required fields ─────────────────────────────────────────────
    const body = req.body as DiscoveryBrokerRequest;

    if (!body.organizationId || typeof body.organizationId !== "string" || !body.organizationId.trim()) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "organizationId is required." } });
      return;
    }
    if (!body.executionId || typeof body.executionId !== "string" || !body.executionId.trim()) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "executionId is required." } });
      return;
    }
    if (!body.specialistCode || typeof body.specialistCode !== "string") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "specialistCode is required." } });
      return;
    }
    if (!body.searchObjective || typeof body.searchObjective !== "string" || !body.searchObjective.trim()) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "searchObjective is required." } });
      return;
    }

    // ── Apply caps ────────────────────────────────────────────────────────────
    const timeoutMs  = Math.min(body.timeoutMs  ?? 20_000, MAX_DISCOVERY_TIMEOUT_MS);
    const maxHops    = Math.min(body.maxHops    ?? 2,      MAX_HOPS);
    const maxSources = Math.min(body.maxSources ?? 5,      MAX_SOURCES);
    const maxPassages= Math.min(body.maxPassages ?? 3,     MAX_PASSAGES);
    const allowExternal = body.allowExternalWebSearch ?? false;
    const unresolvedRefs = Array.isArray(body.unresolvedReferences) ? body.unresolvedReferences : [];

    logger.info({
      organizationId: body.organizationId,
      executionId:    body.executionId,
      specialistCode: body.specialistCode,
      timeoutMs, maxHops, maxSources, maxPassages,
    }, "[evidence-discovery] Discovery request received");

    // ── Health-check the gateway (proves OpenClaw is live) ───────────────────
    let gwHealth: { ok: boolean; version?: string } = { ok: false };
    try {
      gwHealth = await gateway.healthCheck();
    } catch {
      // Not fatal — we return empty candidates honestly
      logger.warn("[evidence-discovery] Gateway health check failed");
    }

    // ── Attempt OpenClaw evidence search ─────────────────────────────────────
    //
    // Sprint 29O.1 — connectivity proof.
    //
    // OpenClaw's exact evidence-search API will be confirmed during the first
    // live round-trip.  For now:
    //
    //   SIMULATED / gateway unavailable:
    //     Return one synthetic test candidate so the Replit-to-Mac round-trip
    //     can be proven end-to-end without requiring OpenClaw to be live.
    //
    //   LIVE gateway (bridge-http mode):
    //     Call POST /agent/discover on the bridge URL with the search payload.
    //     If OpenClaw does not yet expose /agent/discover, the call fails
    //     gracefully and the synthetic candidate is still returned so the
    //     HTTP round-trip proof succeeds.
    //
    // The synthetic candidate is clearly labelled as a test fixture; the
    // NeedsOps Authority Gate will reject it (UNKNOWN_SOURCE_TYPE / no DB
    // record) — which is the correct behaviour for a proof document.

    let candidates: BrokerCandidateEvidence[] = [];
    let openClawStatus: DiscoveryBrokerResponse["openClawStatus"] = "simulated";
    let hopsFollowed = 0;

    if (gwHealth.ok && config.gatewayMode === "live" && config.gatewayUrl) {
      try {
        candidates = await callOpenClawDiscover(
          config.gatewayUrl,
          {
            organizationId:   body.organizationId,
            executionId:      body.executionId,
            searchObjective:  body.searchObjective,
            unresolvedRefs,
            allowExternal,
            maxHops, maxSources, maxPassages,
            timeoutMs,
          },
          timeoutMs,
          logger,
        );
        openClawStatus = "available";
        hopsFollowed   = 1; // conservative — update when OpenClaw reports hops
      } catch (err) {
        logger.warn({ err: (err as Error).message },
          "[evidence-discovery] OpenClaw discover call failed — returning simulated candidate");
        openClawStatus = "unavailable";
      }
    }

    // Synthetic test candidate (always included when live OpenClaw returned nothing)
    if (candidates.length === 0) {
      candidates = [makeSyntheticTestCandidate(body.organizationId, body.executionId, body.searchObjective)];
    }

    const discoveryDurationMs = Date.now() - startMs;

    logger.info({
      organizationId:      body.organizationId,
      executionId:         body.executionId,
      candidatesReturned:  candidates.length,
      openClawStatus,
      discoveryDurationMs,
    }, "[evidence-discovery] Discovery complete");

    const response: DiscoveryBrokerResponse = {
      candidates,
      discoveryDurationMs,
      openClawStatus,
      hopsFollowed,
    };

    res.json(response);
  });

  return router;
}

// ─── OpenClaw discovery call ───────────────────────────────────────────────────

interface OpenClawDiscoverParams {
  organizationId:  string;
  executionId:     string;
  searchObjective: string;
  unresolvedRefs:  string[];
  allowExternal:   boolean;
  maxHops:         number;
  maxSources:      number;
  maxPassages:     number;
  timeoutMs:       number;
}

async function callOpenClawDiscover(
  bridgeUrl: string,
  params: OpenClawDiscoverParams,
  timeoutMs: number,
  logger: pino.Logger,
): Promise<BrokerCandidateEvidence[]> {
  // Attempt POST /agent/discover on the local OpenClaw bridge.
  // This endpoint may not be implemented in all OpenClaw versions;
  // a 404 is treated as "not yet available" and handled gracefully.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${bridgeUrl.replace(/\/$/, "")}/agent/discover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action:          "evidence_search",
        organizationId:  params.organizationId,
        executionId:     params.executionId,
        searchObjective: params.searchObjective,
        unresolvedRefs:  params.unresolvedRefs,
        allowExternal:   params.allowExternal,
        maxHops:         params.maxHops,
        maxSources:      params.maxSources,
        maxPassages:     params.maxPassages,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      logger.debug({ status: res.status }, "[evidence-discovery] /agent/discover returned non-OK");
      return [];
    }

    const body = await res.json() as { candidates?: BrokerCandidateEvidence[] };
    return Array.isArray(body.candidates) ? body.candidates : [];
  } catch (err) {
    logger.debug({ err: (err as Error).message }, "[evidence-discovery] /agent/discover call failed");
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ─── Synthetic test candidate ─────────────────────────────────────────────────

function makeSyntheticTestCandidate(
  organisationId: string,
  executionId:    string,
  searchObjective: string,
): BrokerCandidateEvidence {
  const passage = `[SPRINT 29O.1 TEST FIXTURE] Connectivity proof candidate for: "${searchObjective}". ` +
    `This synthetic document was generated by the NeedsOps Desktop Connector broker at ${new Date().toISOString()} ` +
    `to prove the Replit → Cloudflare Tunnel → Mac Broker → NeedsOps round-trip. ` +
    `It will be rejected by the NeedsOps Authority Gate (correct behaviour for a test fixture).`;

  const passageHash = createHash("sha256").update(passage).digest("hex");

  return {
    organisationId,
    executionId,
    discoveryId:       randomUUID(),
    sourceType:        "unknown_external",
    isExternal:        false,
    sourceTitle:       "Sprint 29O.1 Connectivity Test Fixture",
    supportingPassage: passage,
    passageHash,
    retrievalTimestamp: new Date().toISOString(),
    retrievalMethod:   "connectivity_test",
    discoveryReason:   "Synthetic candidate generated by broker to prove HTTP round-trip connectivity",
    openClawConfidence: 0.0,
    relevanceScore:    0.0,
    contentType:       "test_fixture",
    accessLocation:    "broker://synthetic/connectivity-proof",
  };
}
