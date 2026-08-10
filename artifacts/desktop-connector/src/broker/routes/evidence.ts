/**
 * POST /v1/evidence/discover — Sprint 29O.1 (corrected spawn-mode implementation)
 *
 * Mac-side evidence discovery endpoint.  The NeedsOps API (Replit) sends a
 * governed discovery request; this route spawns the local OpenClaw binary in
 * RPC mode, collects structured candidate evidence, validates each record, and
 * returns raw CandidateEvidence[].
 *
 * ── Mode behaviour ────────────────────────────────────────────────────────────
 *
 *   simulated       Config.gatewayMode !== "live".  Returns candidates:[] with
 *                   openClawStatus:"simulated".  Clearly labelled, no fake data.
 *
 *   live / spawn    Spawns `openclaw agent --mode rpc --json`, writes a
 *                   governed evidence_discovery request to stdin, reads
 *                   newline-delimited JSON events from stdout, finds the
 *                   discovery_result event, validates and returns candidates.
 *                   On timeout or parse failure: candidates:[], status:"unavailable".
 *
 *   live / bridge   Calls POST /agent/discover on the bridge URL.
 *                   If OpenClaw does not expose that endpoint (404, network
 *                   error, or non-JSON response): candidates:[], status:"unavailable".
 *                   Does NOT fall back to synthetic data.
 *
 * ── Security ──────────────────────────────────────────────────────────────────
 *
 *   Auth is enforced by createAuthMiddleware() before this router is reached.
 *   OpenClaw's local port is never exposed through the tunnel.
 *   organisationId is carried through to every candidate (tenant boundary).
 *
 * ── Contract invariants ───────────────────────────────────────────────────────
 *
 *   Synthetic / connectivity-test candidates are NEVER returned in live mode.
 *   The Authority Gate on the Replit side is downstream and unchanged.
 *   Every returned candidate is raw (not pre-accepted).
 */

import { Router, type Request, type Response } from "express";
import { randomUUID, createHash } from "crypto";
import { spawn } from "node:child_process";
import type { BrokerConfig, IGatewayAdapter } from "../types.js";
import type pino from "pino";

// ─── Constants ─────────────────────────────────────────────────────────────────

const MAX_DISCOVERY_TIMEOUT_MS = 60_000;
const MAX_HOPS                 = 5;
const MAX_SOURCES              = 20;
const MAX_PASSAGES             = 10;
/** Extra milliseconds added on top of timeoutMs for process SIGKILL grace */
const KILL_GRACE_MS            = 5_000;

// ─── Wire types ────────────────────────────────────────────────────────────────

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
  failureReason?:      string;
}

// ─── Internal params shape ─────────────────────────────────────────────────────

interface DiscoveryParams {
  organizationId:         string;
  executionId:            string;
  specialistCode:         string;
  searchObjective:        string;
  unresolvedRefs:         string[];
  allowedDiscoveryScope:  string;
  allowExternal:          boolean;
  maxHops:                number;
  maxSources:             number;
  maxPassages:            number;
  timeoutMs:              number;
}

// ─── Router factory ────────────────────────────────────────────────────────────

export function createEvidenceRouter(
  config: BrokerConfig,
  gateway: IGatewayAdapter,
  logger: pino.Logger,
): Router {
  const router = Router();

  router.post("/evidence/discover", async (req: Request, res: Response) => {
    const startMs = Date.now();
    const body    = req.body as DiscoveryBrokerRequest;

    // ── Required field validation ────────────────────────────────────────────
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
    const params: DiscoveryParams = {
      organizationId:        body.organizationId.trim(),
      executionId:           body.executionId.trim(),
      specialistCode:        body.specialistCode,
      searchObjective:       body.searchObjective.trim(),
      unresolvedRefs:        Array.isArray(body.unresolvedReferences) ? body.unresolvedReferences : [],
      allowedDiscoveryScope: body.allowedDiscoveryScope ?? "internal_and_external",
      allowExternal:         body.allowExternalWebSearch ?? false,
      maxHops:               Math.min(body.maxHops    ?? 2, MAX_HOPS),
      maxSources:            Math.min(body.maxSources ?? 5, MAX_SOURCES),
      maxPassages:           Math.min(body.maxPassages ?? 3, MAX_PASSAGES),
      timeoutMs:             Math.min(body.timeoutMs  ?? 20_000, MAX_DISCOVERY_TIMEOUT_MS),
    };

    logger.info({
      organizationId: params.organizationId,
      executionId:    params.executionId,
      specialistCode: params.specialistCode,
      timeoutMs:      params.timeoutMs,
      maxHops:        params.maxHops,
      maxSources:     params.maxSources,
      maxPassages:    params.maxPassages,
      mode:           config.gatewayMode,
      liveMode:       config.liveMode,
    }, "[evidence-discovery] Request received");

    // ── Dispatch based on gateway mode ────────────────────────────────────────
    let result: DiscoveryBrokerResponse;

    if (config.gatewayMode !== "live") {
      // ── Simulated: clearly labelled, no fake data ──────────────────────────
      result = {
        candidates:          [],
        discoveryDurationMs: Date.now() - startMs,
        openClawStatus:      "simulated",
        hopsFollowed:        0,
      };
    } else if (config.liveMode === "bridge-http") {
      // ── Bridge-HTTP: call /agent/discover if it exists ─────────────────────
      result = await callBridgeDiscover(params, config.gatewayUrl, logger);
      result.discoveryDurationMs = Date.now() - startMs;
    } else {
      // ── Spawn: invoke OpenClaw CLI via RPC stdin/stdout ────────────────────
      result = await callSpawnDiscover(params, config.openclawBin, logger);
      result.discoveryDurationMs = Date.now() - startMs;
    }

    logger.info({
      organizationId:      params.organizationId,
      executionId:         params.executionId,
      openClawStatus:      result.openClawStatus,
      candidatesReturned:  result.candidates.length,
      discoveryDurationMs: result.discoveryDurationMs,
      ...(result.failureReason ? { failureReason: result.failureReason } : {}),
    }, "[evidence-discovery] Complete");

    res.json(result);
  });

  return router;
}

// ─── Spawn-mode discovery ─────────────────────────────────────────────────────

/**
 * Spawn `openclaw agent --mode rpc --json`, write a governed evidence_discovery
 * request to stdin, collect newline-delimited JSON events from stdout, find the
 * discovery_result event, and return validated candidates.
 *
 * On timeout the process is sent SIGTERM then SIGKILL.
 * On any failure: candidates:[], openClawStatus:"unavailable".
 * Synthetic / connectivity-test candidates are NEVER injected.
 */
export async function callSpawnDiscover(
  params: DiscoveryParams,
  openclawBin: string,
  logger: pino.Logger,
): Promise<DiscoveryBrokerResponse> {
  const sessionId = randomUUID();

  // Build the RPC request
  const rpcRequest = {
    action:          "evidence_discovery",
    sessionId,
    executionId:     params.executionId,
    tenantId:        params.organizationId,
    discoveryParams: {
      specialistCode:         params.specialistCode,
      searchObjective:        params.searchObjective,
      unresolvedReferences:   params.unresolvedRefs,
      allowedDiscoveryScope:  params.allowedDiscoveryScope,
      allowExternalWebSearch: params.allowExternal,
      maxHops:                params.maxHops,
      maxSources:             params.maxSources,
      maxPassages:            params.maxPassages,
    },
    instruction: buildDiscoveryInstruction(params),
  };

  return new Promise<DiscoveryBrokerResponse>(resolve => {
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    let stdoutBuf = "";
    let discoveryResult: BrokerCandidateEvidence[] | null = null;
    let hopsFollowed = 0;

    const settle = (response: DiscoveryBrokerResponse) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      resolve(response);
    };

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(openclawBin, ["agent", "--mode", "rpc", "--json"], {
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (spawnErr) {
      logger.error({ err: (spawnErr as Error).message, openclawBin },
        "[evidence-discovery] Failed to spawn OpenClaw binary");
      settle({
        candidates:          [],
        discoveryDurationMs: 0,
        openClawStatus:      "unavailable",
        hopsFollowed:        0,
        failureReason:       `Failed to spawn ${openclawBin}: ${(spawnErr as Error).message}`,
      });
      return;
    }

    // ── Write governed discovery request to stdin ─────────────────────────────
    try {
      proc.stdin!.write(JSON.stringify(rpcRequest) + "\n");
      // Close stdin so OpenClaw knows no more input is coming for this request
      proc.stdin!.end();
    } catch (writeErr) {
      logger.error({ err: (writeErr as Error).message },
        "[evidence-discovery] Failed to write to OpenClaw stdin");
    }

    // ── Collect newline-delimited JSON events from stdout ─────────────────────
    proc.stdout!.setEncoding("utf8");
    proc.stdout!.on("data", (chunk: string) => {
      stdoutBuf += chunk;
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          // Non-JSON line (progress text, log output) — skip
          continue;
        }

        const eventType = String(event["type"] ?? event["event"] ?? "").toLowerCase();

        if (eventType === "discovery_result" || eventType === "candidates") {
          // Primary success event
          const raw = event["candidates"];
          if (Array.isArray(raw)) {
            discoveryResult = validateAndFilterCandidates(
              raw as Record<string, unknown>[],
              params.organizationId,
              params.executionId,
              logger,
            );
            hopsFollowed = typeof event["hopsFollowed"] === "number" ? event["hopsFollowed"] : 1;
          }
        } else if (eventType === "completed" || eventType === "done" || eventType === "finish") {
          // Some versions embed candidates in the terminal event
          const raw = event["candidates"];
          if (Array.isArray(raw) && discoveryResult === null) {
            discoveryResult = validateAndFilterCandidates(
              raw as Record<string, unknown>[],
              params.organizationId,
              params.executionId,
              logger,
            );
            hopsFollowed = typeof event["hopsFollowed"] === "number" ? event["hopsFollowed"] : 1;
          }
        } else if (eventType === "error" || eventType === "failed" || eventType === "failure") {
          const reason = String(event["error"] ?? event["message"] ?? "OpenClaw reported failure");
          logger.warn({ reason }, "[evidence-discovery] OpenClaw reported error event");
          // Don't settle yet — let process exit handle it cleanly
        }
      }
    });

    proc.stderr!.setEncoding("utf8");
    proc.stderr!.on("data", (chunk: string) => {
      // Log stderr at debug level — OpenClaw writes informational messages here
      logger.debug({ stderr: chunk.trim() }, "[evidence-discovery] OpenClaw stderr");
    });

    // ── Process exit ──────────────────────────────────────────────────────────
    proc.once("exit", (code, signal) => {
      // Flush remaining stdout buffer
      if (stdoutBuf.trim()) {
        try {
          const event = JSON.parse(stdoutBuf.trim()) as Record<string, unknown>;
          const eventType = String(event["type"] ?? event["event"] ?? "").toLowerCase();
          const raw = event["candidates"];
          if (Array.isArray(raw) && discoveryResult === null &&
              (eventType === "discovery_result" || eventType === "candidates" || eventType === "completed")) {
            discoveryResult = validateAndFilterCandidates(
              raw as Record<string, unknown>[],
              params.organizationId,
              params.executionId,
              logger,
            );
            hopsFollowed = typeof event["hopsFollowed"] === "number" ? event["hopsFollowed"] : 1;
          }
        } catch { /* ignore */ }
      }

      if (discoveryResult !== null) {
        logger.info({ candidates: discoveryResult.length, hopsFollowed, code, signal },
          "[evidence-discovery] OpenClaw spawn completed with candidates");
        settle({
          candidates:          discoveryResult,
          discoveryDurationMs: 0,
          openClawStatus:      "available",
          hopsFollowed,
        });
      } else {
        const reason = signal
          ? `OpenClaw process killed by signal ${signal}`
          : `OpenClaw exited with code ${String(code)} without returning candidates`;
        logger.warn({ code, signal, reason }, "[evidence-discovery] OpenClaw spawn unavailable");
        settle({
          candidates:          [],
          discoveryDurationMs: 0,
          openClawStatus:      "unavailable",
          hopsFollowed:        0,
          failureReason:       reason,
        });
      }
    });

    proc.once("error", (err) => {
      logger.error({ err: err.message }, "[evidence-discovery] OpenClaw process error");
      settle({
        candidates:          [],
        discoveryDurationMs: 0,
        openClawStatus:      "unavailable",
        hopsFollowed:        0,
        failureReason:       `OpenClaw process error: ${err.message}`,
      });
    });

    // ── Timeout enforcement ───────────────────────────────────────────────────
    killTimer = setTimeout(() => {
      if (settled) return;
      logger.warn({ timeoutMs: params.timeoutMs },
        "[evidence-discovery] OpenClaw discovery timed out — sending SIGTERM");
      try { proc.kill("SIGTERM"); } catch { /* already dead */ }

      setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch { /* already dead */ }
      }, KILL_GRACE_MS);

      settle({
        candidates:          [],
        discoveryDurationMs: 0,
        openClawStatus:      "unavailable",
        hopsFollowed:        0,
        failureReason:       `OpenClaw discovery timed out after ${params.timeoutMs}ms`,
      });
    }, params.timeoutMs);
  });
}

// ─── Bridge-HTTP discovery ────────────────────────────────────────────────────

/**
 * Call POST /agent/discover on the OpenClaw bridge server.
 *
 * Only used when OPENCLAW_LIVE_MODE=bridge-http.
 * If the bridge does not expose /agent/discover (404 or network error):
 *   returns candidates:[], openClawStatus:"unavailable".
 * No synthetic data is ever returned.
 */
export async function callBridgeDiscover(
  params: DiscoveryParams,
  bridgeUrl: string | null,
  logger: pino.Logger,
): Promise<DiscoveryBrokerResponse> {
  if (!bridgeUrl) {
    return { candidates: [], discoveryDurationMs: 0, openClawStatus: "unavailable",
      hopsFollowed: 0, failureReason: "OPENCLAW_GATEWAY_URL is not configured" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    const res = await fetch(`${bridgeUrl.replace(/\/$/, "")}/agent/discover`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        action:                 "evidence_search",
        organizationId:         params.organizationId,
        executionId:            params.executionId,
        specialistCode:         params.specialistCode,
        searchObjective:        params.searchObjective,
        unresolvedReferences:   params.unresolvedRefs,
        allowedDiscoveryScope:  params.allowedDiscoveryScope,
        allowExternalWebSearch: params.allowExternal,
        maxHops:                params.maxHops,
        maxSources:             params.maxSources,
        maxPassages:            params.maxPassages,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      logger.warn({ status: res.status, bridgeUrl },
        "[evidence-discovery] Bridge /agent/discover returned non-OK (endpoint may not exist)");
      return { candidates: [], discoveryDurationMs: 0, openClawStatus: "unavailable",
        hopsFollowed: 0, failureReason: `Bridge returned HTTP ${res.status}` };
    }

    let body: Record<string, unknown>;
    try {
      body = await res.json() as Record<string, unknown>;
    } catch {
      logger.warn("[evidence-discovery] Bridge /agent/discover returned non-JSON body");
      return { candidates: [], discoveryDurationMs: 0, openClawStatus: "unavailable",
        hopsFollowed: 0, failureReason: "Bridge returned non-JSON response" };
    }

    const raw = body["candidates"];
    if (!Array.isArray(raw)) {
      return { candidates: [], discoveryDurationMs: 0, openClawStatus: "unavailable",
        hopsFollowed: 0, failureReason: "Bridge response missing candidates array" };
    }

    const candidates = validateAndFilterCandidates(
      raw as Record<string, unknown>[],
      params.organizationId,
      params.executionId,
      logger,
    );
    const hopsFollowed = typeof body["hopsFollowed"] === "number" ? body["hopsFollowed"] : 0;

    return { candidates, discoveryDurationMs: 0, openClawStatus: "available", hopsFollowed };
  } catch (err) {
    const isTimeout = (err as Error).name === "AbortError";
    const reason = isTimeout
      ? `Bridge /agent/discover timed out after ${params.timeoutMs}ms`
      : `Bridge /agent/discover unreachable: ${(err as Error).message}`;
    logger.warn({ err: (err as Error).message }, `[evidence-discovery] ${reason}`);
    return { candidates: [], discoveryDurationMs: 0, openClawStatus: "unavailable",
      hopsFollowed: 0, failureReason: reason };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Candidate validation ──────────────────────────────────────────────────────

const REQUIRED_STRING_FIELDS: (keyof BrokerCandidateEvidence)[] = [
  "sourceTitle", "supportingPassage", "passageHash",
  "retrievalMethod", "retrievalTimestamp", "contentType", "accessLocation",
];

/**
 * Validate and filter raw candidate objects returned by OpenClaw.
 *
 * Rules:
 *   - Required string fields must be present and non-empty
 *   - retrievalMethod must NOT be "connectivity_test" (synthetic fixture guard)
 *   - passageHash is verified against supportingPassage; corrected if wrong
 *   - openClawConfidence and relevanceScore are clamped to [0, 1]
 *   - organisationId and executionId are stamped from the request (not trusted from OpenClaw)
 *   - discoveryId is generated fresh if absent or invalid
 *
 * Malformed candidates are dropped with a debug log — never included.
 */
export function validateAndFilterCandidates(
  raw: Record<string, unknown>[],
  organisationId: string,
  executionId:    string,
  logger:         pino.Logger,
): BrokerCandidateEvidence[] {
  const valid: BrokerCandidateEvidence[] = [];

  for (const item of raw) {
    // Required string fields
    let ok = true;
    for (const field of REQUIRED_STRING_FIELDS) {
      if (typeof item[field] !== "string" || !(item[field] as string).trim()) {
        logger.debug({ field, item }, "[evidence-discovery] Candidate dropped: missing required field");
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    // Synthetic fixture guard — retrievalMethod must not be connectivity_test
    if ((item["retrievalMethod"] as string) === "connectivity_test") {
      logger.warn({ item }, "[evidence-discovery] Candidate dropped: connectivity_test retrievalMethod rejected in live mode");
      continue;
    }

    // Passage hash verification / correction
    const passage  = item["supportingPassage"] as string;
    const expected = createHash("sha256").update(passage).digest("hex");
    const provided = item["passageHash"] as string;
    const passageHash = (provided && provided.length === 64 && /^[0-9a-f]+$/i.test(provided))
      ? (provided === expected ? provided : expected)  // recompute if mismatch
      : expected;

    if (provided && provided !== expected) {
      logger.debug({ provided, expected }, "[evidence-discovery] Candidate passageHash corrected");
    }

    // Clamp scores
    const clamp = (v: unknown): number => {
      const n = typeof v === "number" ? v : parseFloat(String(v));
      return isNaN(n) ? 0 : Math.max(0, Math.min(1, n));
    };

    const candidate: BrokerCandidateEvidence = {
      // Tenant fields stamped from request — never trusted from OpenClaw
      organisationId,
      executionId,
      discoveryId:       typeof item["discoveryId"] === "string" && item["discoveryId"] ? item["discoveryId"] as string : randomUUID(),
      sourceType:        typeof item["sourceType"] === "string" ? item["sourceType"] as string : "unknown_external",
      isExternal:        item["isExternal"] === true,
      sourceTitle:       (item["sourceTitle"] as string).trim(),
      supportingPassage: passage.trim(),
      passageHash,
      retrievalTimestamp: typeof item["retrievalTimestamp"] === "string" ? item["retrievalTimestamp"] as string : new Date().toISOString(),
      retrievalMethod:   (item["retrievalMethod"] as string).trim(),
      discoveryReason:   typeof item["discoveryReason"] === "string" ? (item["discoveryReason"] as string).trim() : "Discovered by OpenClaw",
      openClawConfidence: clamp(item["openClawConfidence"]),
      relevanceScore:    clamp(item["relevanceScore"]),
      contentType:       (item["contentType"] as string).trim(),
      accessLocation:    (item["accessLocation"] as string).trim(),
    };

    // Optional fields
    const optStr = (k: string) => typeof item[k] === "string" && (item[k] as string).trim() ? item[k] as string : undefined;
    candidate.internalSourceId          = optStr("internalSourceId");
    candidate.internalSourceVersionId   = optStr("internalSourceVersionId");
    candidate.internalChunkId           = optStr("internalChunkId");
    candidate.sourceUrl                 = optStr("sourceUrl");
    candidate.publisherDomain           = optStr("publisherDomain");
    candidate.claimedPublisher          = optStr("claimedPublisher");
    candidate.jurisdiction              = optStr("jurisdiction");
    candidate.unresolvedReferenceContext = optStr("unresolvedReferenceContext");
    candidate.authorityType             = optStr("authorityType");
    candidate.publicationDate           = optStr("publicationDate");
    candidate.effectiveDate             = optStr("effectiveDate");

    valid.push(candidate);
  }

  return valid;
}

// ─── Discovery instruction builder ───────────────────────────────────────────

/**
 * Build the governed discovery instruction sent to OpenClaw via the RPC request.
 *
 * This is the primary instruction field.  OpenClaw must follow it precisely.
 * The instruction is tightly bounded: discovery and evidence retrieval only.
 * No professional analysis, compliance conclusions, or gap analysis.
 */
export function buildDiscoveryInstruction(params: DiscoveryParams): string {
  const lines: string[] = [
    "EVIDENCE DISCOVERY TASK — NeedsOps Governed Evidence Discovery",
    "",
    "You are performing EVIDENCE DISCOVERY ONLY for the NeedsOps AI+ platform.",
    "DO NOT perform professional analysis, compliance conclusions, or gap analysis.",
    "DO NOT fabricate, invent, or paraphrase evidence.",
    "Your SOLE task: locate real sources that match the search objective and return verbatim supporting passages.",
    "",
    "═══ SEARCH PARAMETERS ═══",
    `ORGANISATION ID:       ${params.organizationId}`,
    `EXECUTION ID:          ${params.executionId}`,
    `SPECIALIST CODE:       ${params.specialistCode}`,
    `SEARCH OBJECTIVE:      ${params.searchObjective}`,
    `ALLOWED SCOPE:         ${params.allowedDiscoveryScope}`,
    `EXTERNAL WEB SEARCH:   ${params.allowExternal ? "PERMITTED" : "NOT PERMITTED"}`,
    `MAX REFERENCE HOPS:    ${params.maxHops}`,
    `MAX SOURCES:           ${params.maxSources}`,
    `MAX PASSAGES/SOURCE:   ${params.maxPassages}`,
  ];

  if (params.unresolvedRefs.length > 0) {
    lines.push("", "UNRESOLVED REFERENCES (must be located):");
    for (const ref of params.unresolvedRefs) {
      lines.push(`  - ${ref}`);
    }
  }

  lines.push(
    "",
    "═══ REQUIRED OUTPUT FORMAT ═══",
    "Return ONE JSON object with this exact structure (no markdown, no prose, pure JSON):",
    "",
    JSON.stringify({
      type: "discovery_result",
      hopsFollowed: "<number>",
      candidates: [{
        sourceTitle:        "<exact title of the source document>",
        supportingPassage:  "<verbatim passage from the source — no paraphrase>",
        passageHash:        "<SHA-256 hex of supportingPassage>",
        retrievalMethod:    "<how found: e.g. 'semantic_search', 'url_fetch', 'cross_reference'>",
        retrievalTimestamp: "<ISO-8601 timestamp>",
        retrievalReason:    "<why this candidate was found>",
        discoveryReason:    "<why this candidate is relevant to the search objective>",
        sourceType:         "<organisational|external_legislation|external_regulation|external_guidance|external_standard|external_case_law|unknown_external>",
        isExternal:         "<true if source is outside the organisational library>",
        contentType:        "<policy|legislation|procedure|guidance|standard|case_law|other>",
        accessLocation:     "<URL or path where source was found>",
        openClawConfidence: "<number 0-1: your confidence this is relevant — ADVISORY ONLY>",
        relevanceScore:     "<number 0-1: relevance to the search objective>",
        sourceUrl:          "<optional: URL for external sources>",
        publisherDomain:    "<optional: e.g. legislation.gov.uk>",
        claimedPublisher:   "<optional: publisher name>",
        jurisdiction:       "<optional: e.g. UK, EU, England_and_Wales>",
        authorityType:      "<optional: legislation|regulation|government_guidance|standard|case_law>",
      }],
    }, null, 2),
    "",
    "CRITICAL RULES:",
    "  1. Return ONLY the JSON object above — no explanation, no markdown fences.",
    "  2. supportingPassage must be verbatim text from the actual source — never invented.",
    "  3. passageHash must be SHA-256 of the exact supportingPassage text.",
    `  4. Return at most ${params.maxSources} sources and ${params.maxPassages} passages per source.`,
    "  5. If no relevant sources are found, return candidates: []",
    "  6. Never cross organisational tenant boundaries.",
  );

  return lines.join("\n");
}
