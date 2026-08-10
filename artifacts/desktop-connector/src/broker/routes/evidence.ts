/**
 * POST /v1/evidence/discover — Sprint 29O.1 (real CLI contract implementation)
 *
 * Mac-side evidence discovery endpoint.  The NeedsOps API (Replit) sends a
 * governed discovery request; this route spawns the local OpenClaw binary,
 * collects structured candidate evidence, validates each record, and returns
 * raw CandidateEvidence[].
 *
 * ── Proven OpenClaw CLI contract (OpenClaw 2026.7.2) ─────────────────────────
 *
 *   WORKING COMMAND:
 *     openclaw agent --agent main --message-file <tmpfile> --json
 *
 *   INVALID (do not use):
 *     openclaw agent --mode rpc --json   ← OpenClaw does not recognise --mode
 *
 *   Output: a single JSON object written to stdout (not streaming events):
 *     {
 *       "runId":  "<string>",
 *       "status": "ok",
 *       "result": {
 *         "payloads": [
 *           { "text": "{\"candidates\":[...]}" }
 *         ]
 *       }
 *     }
 *
 *   The assistant's response lives in result.payloads[].text.
 *   We JSON-parse that text to obtain { "candidates": [...] }.
 *
 * ── Mode behaviour ────────────────────────────────────────────────────────────
 *
 *   simulated       Config.gatewayMode !== "live".  Returns candidates:[] with
 *                   openClawStatus:"simulated".  Clearly labelled, no fake data.
 *
 *   live / spawn    Writes the governed instruction to a temp file.
 *                   Spawns `openclaw agent --agent main --message-file <f> --json`.
 *                   Collects all stdout into a buffer.
 *                   On exit: JSON-parses the top-level result, extracts
 *                   result.payloads[].text, JSON-parses that to { candidates }.
 *                   On timeout: SIGTERM then SIGKILL, returns unavailable.
 *                   On any parsing failure: candidates:[], unavailable/available
 *                   (see failure table in callSpawnDiscover).
 *
 *   live / bridge   Calls POST /agent/discover on the bridge URL.
 *                   If OpenClaw does not expose that endpoint (404, network
 *                   error, or non-JSON response): candidates:[], status:"unavailable".
 *                   Does NOT fall back to synthetic data.
 *
 * ── Scope bounding ────────────────────────────────────────────────────────────
 *
 *   allowedRoots:      Directories OpenClaw may search (absolute Mac paths).
 *   knownSourcePaths:  Specific files that should be checked (absolute Mac paths).
 *
 *   When either field is non-empty, buildDiscoveryInstruction emits a SCOPED
 *   SEARCH BOUNDARIES section that explicitly tells OpenClaw where to look,
 *   preventing an unbounded filesystem crawl that would exhaust the 45-second
 *   timeout.
 *
 *   For internal_references_only scope, at least one of these fields SHOULD be
 *   provided by the caller (e.g. org workspace root paths from org settings).
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
 *
 * ── Localhost curl test (spawn mode) ─────────────────────────────────────────
 *
 *   Prerequisite: broker running locally (node dist/index.js or ts-node), and
 *   OPENCLAW_GATEWAY_MODE=live, OPENCLAW_LIVE_MODE=spawn-cli.
 *
 *   curl -s -X POST http://127.0.0.1:19001/v1/evidence/discover \
 *     -H "Content-Type: application/json" \
 *     -H "Authorization: Bearer $(cat ~/.needsops/broker.token 2>/dev/null || echo dev)" \
 *     -d '{
 *       "organizationId": "test-org-001",
 *       "executionId":    "test-exec-001",
 *       "specialistCode": "chief_of_staff",
 *       "searchObjective": "Find fatigue management policy requirements for roster scheduling",
 *       "allowedRoots": ["/Users/tayephilipajao/.openclaw/workspace/rostering"],
 *       "knownSourcePaths": [],
 *       "allowedDiscoveryScope": "internal_references_only",
 *       "allowExternalWebSearch": false,
 *       "maxHops": 2,
 *       "maxSources": 5,
 *       "maxPassages": 3,
 *       "timeoutMs": 45000
 *     }' | jq '{status: .openClawStatus, count: (.candidates | length)}'
 *
 *   Success = {"status":"available","count":<n≥1>} within 45 seconds.
 */

import { Router, type Request, type Response } from "express";
import { randomUUID, createHash } from "crypto";
import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  /** Absolute Mac paths OpenClaw may search within. When provided, search is bounded to these directories. */
  allowedRoots?:           string[];
  /** Specific absolute Mac file paths the specialist knows should contain relevant content. */
  knownSourcePaths?:       string[];
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
  /** Absolute Mac paths OpenClaw may search within. Empty = no restriction. */
  allowedRoots:           string[];
  /** Specific file paths the specialist has identified as relevant. Empty = no restriction. */
  knownSourcePaths:       string[];
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
      allowedRoots:          Array.isArray(body.allowedRoots)      ? body.allowedRoots.filter(r => typeof r === "string" && r.trim())      : [],
      knownSourcePaths:      Array.isArray(body.knownSourcePaths)  ? body.knownSourcePaths.filter(p => typeof p === "string" && p.trim())  : [],
      maxHops:               Math.min(body.maxHops    ?? 2, MAX_HOPS),
      maxSources:            Math.min(body.maxSources ?? 5, MAX_SOURCES),
      maxPassages:           Math.min(body.maxPassages ?? 3, MAX_PASSAGES),
      timeoutMs:             Math.min(body.timeoutMs  ?? 45_000, MAX_DISCOVERY_TIMEOUT_MS),
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
      // ── Spawn: invoke OpenClaw CLI with --message-file ────────────────────
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
 * Invoke `openclaw agent --agent main --message-file <tmpfile> --json`.
 *
 * This matches the proven CLI contract for OpenClaw 2026.7.2:
 *   - The binary does NOT support --mode rpc
 *   - The governed instruction is written to a temp file (safe for multiline/quotes)
 *   - OpenClaw writes a single JSON object to stdout (not streaming events)
 *   - The assistant payload is in result.payloads[].text
 *   - That text is JSON-parsed to get { "candidates": [...] }
 *
 * Failure behaviour:
 *   - Binary not found / spawn error     → unavailable
 *   - Non-zero exit code                 → unavailable
 *   - Killed by signal / timeout         → unavailable
 *   - stdout not valid JSON              → unavailable
 *   - result.payloads missing/empty      → unavailable
 *   - payload.text not valid JSON        → available, candidates:[] (OpenClaw ran)
 *   - payload has no candidates array    → available, candidates:[]
 *   - candidate fails validation         → candidate dropped
 *
 * Synthetic / connectivity-test candidates are NEVER returned in live mode.
 * The temp file is always deleted after the process exits.
 */
export async function callSpawnDiscover(
  params: DiscoveryParams,
  openclawBin: string,
  logger: pino.Logger,
): Promise<DiscoveryBrokerResponse> {
  // ── Write governed instruction to a temp file ─────────────────────────────
  const instruction = buildDiscoveryInstruction(params);
  const tmpFile     = join(tmpdir(), `needsops-discovery-${randomUUID()}.txt`);

  try {
    writeFileSync(tmpFile, instruction, "utf8");
  } catch (writeErr) {
    logger.error({ err: (writeErr as Error).message, tmpFile },
      "[evidence-discovery] Failed to write instruction temp file");
    return {
      candidates:          [],
      discoveryDurationMs: 0,
      openClawStatus:      "unavailable",
      hopsFollowed:        0,
      failureReason:       `Failed to write temp instruction file: ${(writeErr as Error).message}`,
    };
  }

  return new Promise<DiscoveryBrokerResponse>(resolve => {
    let settled    = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    let stdoutBuf  = "";

    const settle = (response: DiscoveryBrokerResponse) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      // Always clean up the temp file
      try { unlinkSync(tmpFile); } catch { /* already gone */ }
      resolve(response);
    };

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(
        openclawBin,
        ["agent", "--agent", "main", "--message-file", tmpFile, "--json"],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (spawnErr) {
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
      logger.error({ err: (spawnErr as Error).message, openclawBin },
        "[evidence-discovery] Failed to spawn OpenClaw binary");
      resolve({
        candidates:          [],
        discoveryDurationMs: 0,
        openClawStatus:      "unavailable",
        hopsFollowed:        0,
        failureReason:       `Failed to spawn ${openclawBin}: ${(spawnErr as Error).message}`,
      });
      return;
    }

    // ── Collect all stdout into buffer ───────────────────────────────────────
    proc.stdout!.setEncoding("utf8");
    proc.stdout!.on("data", (chunk: string) => {
      stdoutBuf += chunk;
    });

    proc.stderr!.setEncoding("utf8");
    proc.stderr!.on("data", (chunk: string) => {
      logger.debug({ stderr: chunk.trim() }, "[evidence-discovery] OpenClaw stderr");
    });

    // ── Process exit — parse complete JSON output ────────────────────────────
    proc.once("exit", (code, signal) => {
      if (signal) {
        logger.warn({ signal }, "[evidence-discovery] OpenClaw killed by signal");
        settle({
          candidates:          [],
          discoveryDurationMs: 0,
          openClawStatus:      "unavailable",
          hopsFollowed:        0,
          failureReason:       `OpenClaw process killed by signal ${signal}`,
        });
        return;
      }

      if (code !== 0) {
        logger.warn({ code, stderr: stdoutBuf.slice(0, 200) },
          "[evidence-discovery] OpenClaw exited with non-zero code");
        settle({
          candidates:          [],
          discoveryDurationMs: 0,
          openClawStatus:      "unavailable",
          hopsFollowed:        0,
          failureReason:       `OpenClaw exited with code ${String(code)}`,
        });
        return;
      }

      // ── Parse top-level JSON ───────────────────────────────────────────────
      let topLevel: Record<string, unknown>;
      try {
        topLevel = JSON.parse(stdoutBuf.trim()) as Record<string, unknown>;
      } catch {
        logger.warn({ raw: stdoutBuf.slice(0, 300) },
          "[evidence-discovery] OpenClaw stdout is not valid JSON");
        settle({
          candidates:          [],
          discoveryDurationMs: 0,
          openClawStatus:      "unavailable",
          hopsFollowed:        0,
          failureReason:       "OpenClaw output JSON malformed",
        });
        return;
      }

      // ── Extract result.payloads ───────────────────────────────────────────
      const result   = topLevel["result"] as Record<string, unknown> | undefined;
      const payloads = result?.["payloads"];

      if (!Array.isArray(payloads) || payloads.length === 0) {
        logger.warn({ topLevel },
          "[evidence-discovery] OpenClaw response missing result.payloads");
        settle({
          candidates:          [],
          discoveryDurationMs: 0,
          openClawStatus:      "unavailable",
          hopsFollowed:        0,
          failureReason:       "OpenClaw response missing result.payloads",
        });
        return;
      }

      // ── Find first payload with non-empty text ────────────────────────────
      const textPayload = (payloads as Record<string, unknown>[]).find(
        p => typeof p["text"] === "string" && (p["text"] as string).trim(),
      );

      if (!textPayload) {
        logger.warn("[evidence-discovery] No text payload in OpenClaw result.payloads");
        settle({
          candidates:          [],
          discoveryDurationMs: 0,
          openClawStatus:      "unavailable",
          hopsFollowed:        0,
          failureReason:       "No text payload in OpenClaw response",
        });
        return;
      }

      // ── JSON-parse the assistant text → { candidates: [...] } ────────────
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse((textPayload["text"] as string).trim()) as Record<string, unknown>;
      } catch {
        logger.warn({ text: (textPayload["text"] as string).slice(0, 300) },
          "[evidence-discovery] OpenClaw assistant payload is not valid JSON");
        // OpenClaw ran but the assistant didn't return machine-readable JSON.
        // Status is "available" (the binary executed) but candidates are empty.
        settle({
          candidates:          [],
          discoveryDurationMs: 0,
          openClawStatus:      "available",
          hopsFollowed:        0,
          failureReason:       "OpenClaw assistant payload is not valid JSON",
        });
        return;
      }

      // ── Extract candidates array ──────────────────────────────────────────
      const rawCandidates = parsed["candidates"];
      if (!Array.isArray(rawCandidates)) {
        logger.warn({ parsed },
          "[evidence-discovery] OpenClaw assistant payload missing candidates array");
        settle({
          candidates:          [],
          discoveryDurationMs: 0,
          openClawStatus:      "available",
          hopsFollowed:        0,
          failureReason:       "OpenClaw payload missing candidates array",
        });
        return;
      }

      const candidates = validateAndFilterCandidates(
        rawCandidates as Record<string, unknown>[],
        params.organizationId,
        params.executionId,
        logger,
      );

      logger.info({ candidates: candidates.length },
        "[evidence-discovery] OpenClaw spawn completed with candidates");

      settle({
        candidates,
        discoveryDurationMs: 0,
        openClawStatus:      "available",
        hopsFollowed:        1,
      });
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
        allowedRoots:           params.allowedRoots,
        knownSourcePaths:       params.knownSourcePaths,
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
 * Build the governed discovery instruction written to the temp file and sent
 * to OpenClaw via --message-file.
 *
 * OpenClaw must return a single JSON object matching { "candidates": [...] }
 * in its assistant text payload (result.payloads[].text).
 * No prose, no markdown fences, no streaming events.
 */
export function buildDiscoveryInstruction(params: DiscoveryParams): string {
  const hasRoots = params.allowedRoots.length > 0;
  const hasPaths = params.knownSourcePaths.length > 0;
  const isScoped = hasRoots || hasPaths;

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

  // ── Scoped search boundaries ──────────────────────────────────────────────
  // When allowedRoots or knownSourcePaths are provided, bound the search space
  // explicitly.  This prevents an open-ended crawl that would exhaust the
  // timeout.  For internal_references_only scope, at least one boundary MUST
  // be provided by the caller or results may be empty.
  if (isScoped) {
    lines.push("", "═══ SCOPED SEARCH BOUNDARIES ═══");
    lines.push("Search ONLY within the locations listed below.");
    lines.push("Do NOT access any file, directory, or URL that is not covered by these paths.");

    if (hasRoots) {
      lines.push("", "ALLOWED ROOTS (search any file within these directories):");
      for (const root of params.allowedRoots) {
        lines.push(`  ${root}`);
      }
    }

    if (hasPaths) {
      lines.push("", "KNOWN SOURCE PATHS (check these files first — they are expected to contain relevant content):");
      for (const p of params.knownSourcePaths) {
        lines.push(`  ${p}`);
      }
    }
  } else if (params.allowedDiscoveryScope === "internal_references_only") {
    lines.push("", "═══ SCOPE ═══");
    lines.push("Search scope is INTERNAL ONLY.");
    lines.push("Do NOT access external URLs, websites, or any resource outside the local workspace.");
  }

  if (params.unresolvedRefs.length > 0) {
    lines.push("", "UNRESOLVED REFERENCES (must be located):");
    for (const ref of params.unresolvedRefs) {
      lines.push(`  - ${ref}`);
    }
  }

  lines.push(
    "",
    "═══ REQUIRED OUTPUT FORMAT ═══",
    "Your response MUST be a single JSON object with this exact structure.",
    "No markdown, no prose, no code fences — pure JSON only.",
    "",
    JSON.stringify({
      candidates: [{
        sourceTitle:        "<exact title of the source document>",
        supportingPassage:  "<verbatim passage from the source — no paraphrase>",
        passageHash:        "<SHA-256 hex of supportingPassage>",
        retrievalMethod:    "<how found: e.g. local_file, semantic_search, url_fetch, cross_reference>",
        retrievalTimestamp: "<ISO-8601 timestamp>",
        discoveryReason:    "<why this candidate is relevant to the search objective>",
        sourceType:         "<organisational|external_legislation|external_regulation|external_guidance|external_standard|external_case_law|unknown_external>",
        isExternal:         "<true if source is outside the organisational library>",
        contentType:        "<policy|legislation|procedure|guidance|standard|case_law|other>",
        accessLocation:     "<absolute file path or URL where source was found>",
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
    "  5. If no relevant sources are found, return: {\"candidates\": []}",
    "  6. Never cross organisational tenant boundaries.",
    "  7. Do not include the schema example in your output — replace every field with real values.",
    ...(isScoped ? ["  8. Only access files within the SCOPED SEARCH BOUNDARIES above — never outside them."] : []),
  );

  return lines.join("\n");
}
