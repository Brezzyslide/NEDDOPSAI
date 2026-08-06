/**
 * connectorEvidenceResolverService — Sprint 29E (NeedsOps Connector P6 Foundation)
 *
 * Implements the IResourceProvider contract for the NeedsOps Connector (P6).
 *
 * Architecture rule (non-negotiable):
 *   The Unified Execution Engine never selects providers.
 *   The ResourceRegistry never interprets user intent.
 *   This provider owns all desktop evidence retrieval.
 *   It never constructs EvidenceChunk — that belongs to the registry adapter.
 *   OpenClaw is an internal runtime only — this service speaks only the
 *   ConnectorBridge API and never references OpenClaw in user-facing output.
 *
 * Sprint 29E scope: read-only operations only.
 *   locate / search / inspect / read
 *
 * Not in scope (Sprint 29F):
 *   write / automation / Outlook / Excel / browser / terminal
 */

import { randomUUID } from "crypto";
import type { IResourceProvider, ResourceHandle, EvidenceRequest, ResourceContentType, ResourceProviderCode } from "../lib/resources/types.js";
import {
  connectorSearch,
  connectorRead,
  connectorLocate,
  connectorInspect,
} from "./connectorBridgeService.js";
import {
  openConnectorSession,
  closeConnectorSession,
  recordConnectorOperation,
} from "./connectorSessionManagerService.js";
import {
  getConnectedDevicesForOrg,
} from "./deviceRelayService.js";
import { tenantCanUseConnector } from "./entitlementService.js";
import { logger } from "../lib/logger.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum files to read per evidence resolution to keep context size bounded */
const MAX_CONNECTOR_FILES = 5;

/** Minimum content length to treat a file as contributing evidence */
const MIN_CONTENT_LENGTH = 50;

/** Default timeout per operation */
const OP_TIMEOUT_MS = 20_000;

// ─── ConnectorEvidenceResolver ────────────────────────────────────────────────

/**
 * Resource provider for the NeedsOps Connector (P6).
 *
 * Participates in the three-stage ResourceRegistry resolution model:
 *   Stage 1: KnowledgeResolutionService (P1–P5) — unchanged
 *   Stage 2: ConnectorEvidenceResolver (P6) — this class
 *   Stage 3: Registry merges all handles into a unified EvidencePack
 *
 * Desktop evidence participates in ranking, confidence scoring, deduplication,
 * citations, and validation exactly like organisation library evidence —
 * specialists never know which provider sourced a given chunk.
 */
export class ConnectorEvidenceResolver implements IResourceProvider {
  readonly providerCode: ResourceProviderCode = "connector";
  readonly priority = 6; // P6 — after all library providers
  readonly isImplemented = true;

  /**
   * isAvailable: checks entitlement AND connected device presence.
   *
   * The registry calls this before resolve(). If false, the provider is skipped.
   * Does not open a session — that happens inside resolve() to keep session
   * lifetime as short as possible.
   */
  async isAvailable(organisationId: string): Promise<boolean> {
    try {
      // 1. Check entitlement — connector access must be granted
      const entitlement = await tenantCanUseConnector(organisationId, "local_file_connector");
      if (!entitlement.allowed) return false;

      // 2. Check connected device — relay must have an active connection for this org
      const devices = getConnectedDevicesForOrg(organisationId);
      return devices.length > 0;
    } catch {
      // isAvailable must never throw — return false on any error
      return false;
    }
  }

  /**
   * resolve: open a session, retrieve file evidence via the bridge, return handles.
   *
   * Flow:
   *   1. Open connector session (validates entitlement + device)
   *   2. Search for files matching the query
   *   3. Locate + read the top N results
   *   4. Build ResourceHandle[] with resolvedContent populated
   *   5. Close session
   *
   * The registry's private adapter converts handles to EvidenceChunk[].
   * This method never constructs EvidenceChunk directly.
   */
  async resolve(request: EvidenceRequest): Promise<ResourceHandle[]> {
    const { executionId, organisationId, userRequest, searchTerms } = request;

    // Open session — validates entitlement and device registration
    let deviceId: string;
    try {
      const session = await openConnectorSession(executionId, organisationId);
      deviceId = session.deviceId;
    } catch (err) {
      // Session open failures propagate as structured capability errors
      throw err;
    }

    const handles: ResourceHandle[] = [];
    const searchQuery = searchTerms && searchTerms.length > 0
      ? searchTerms.join(" ")
      : userRequest;

    try {
      // ── Step 1: Search for relevant files ──────────────────────────────────
      const searchResult = await connectorSearch(
        deviceId,
        organisationId,
        executionId,
        searchQuery,
        { timeoutMs: OP_TIMEOUT_MS },
      );

      recordConnectorOperation(executionId, {
        requestId:     `search_${randomUUID().slice(0, 8)}`,
        operationType: "search",
        query:         searchQuery,
        success:       searchResult.success,
        latencyMs:     searchResult.latencyMs,
        recordedAt:    new Date().toISOString(),
      });

      if (!searchResult.success) {
        logger.warn(
          { executionId, errorCode: searchResult.errorCode },
          "[connector-evidence] Search failed — no connector evidence",
        );
        return handles;
      }

      const rawItems = (searchResult.data as { items?: unknown[] } | null)?.items ?? [];
      const items = rawItems.slice(0, MAX_CONNECTOR_FILES) as Array<{
        fileId?: string;
        name?: string;
        type?: string;
        size?: number;
        path?: string;
      }>;

      // ── Step 2: Read each file ─────────────────────────────────────────────
      for (const item of items) {
        if (!item.fileId) continue;

        // Inspect metadata first
        const inspectResult = await connectorInspect(
          deviceId,
          organisationId,
          executionId,
          item.fileId,
          { timeoutMs: OP_TIMEOUT_MS },
        ).catch(() => null);

        recordConnectorOperation(executionId, {
          requestId:     `inspect_${randomUUID().slice(0, 8)}`,
          operationType: "inspect",
          resourceId:    item.fileId,
          success:       inspectResult?.success ?? false,
          latencyMs:     inspectResult?.latencyMs ?? 0,
          recordedAt:    new Date().toISOString(),
        });

        const meta = (inspectResult?.data as Record<string, unknown> | null) ?? {};

        // Read full content
        const readResult = await connectorRead(
          deviceId,
          organisationId,
          executionId,
          item.fileId,
          { timeoutMs: OP_TIMEOUT_MS },
        ).catch(() => null);

        recordConnectorOperation(executionId, {
          requestId:     `read_${randomUUID().slice(0, 8)}`,
          operationType: "read",
          resourceId:    item.fileId,
          success:       readResult?.success ?? false,
          latencyMs:     readResult?.latencyMs ?? 0,
          recordedAt:    new Date().toISOString(),
        });

        if (!readResult?.success) continue;

        const content = (readResult.data as { content?: string } | null)?.content ?? "";
        if (content.length < MIN_CONTENT_LENGTH) continue;

        const fileName = String(meta["name"] ?? item.name ?? item.fileId);
        const mimeType = String(meta["mimeType"] ?? "");
        const fileSize = (meta["size"] as number | null) ?? item.size ?? null;
        const modifiedAt = (meta["modifiedAt"] as string | null) ?? null;

        handles.push({
          id:          `connector_${item.fileId}_${randomUUID().slice(0, 8)}`,
          provider:    "connector",
          uri:         item.fileId,
          permissions: ["read"],
          contentType: inferContentType(fileName, mimeType),
          metadata: {
            title:      fileName,
            size:       fileSize,
            mimeType,
            modifiedAt,
            source:     "desktop_file",
            provider:   "needsops_connector",
          },
          confidence:      computeConfidence(searchQuery, fileName),
          isTransient:     true,
          resolvedContent: content,
        });
      }

      logger.info(
        { executionId, filesFound: rawItems.length, handlesBuilt: handles.length },
        "[connector-evidence] Evidence resolution complete",
      );
    } catch (err) {
      // Non-fatal retrieval errors — return what we have
      logger.warn(
        { executionId, err: (err as Error).message },
        "[connector-evidence] Retrieval error (returning partial handles)",
      );
    } finally {
      // Close the session — cleanup regardless of success or failure
      closeConnectorSession(executionId, "resolve_complete");
    }

    return handles;
  }

  /**
   * close: no-op for this provider.
   *
   * The ConnectorSessionManager handles its own lifecycle (idle timeout +
   * explicit close in resolve()). The registry calls close() per the provider
   * lifecycle contract; this provider has nothing additional to clean up.
   */
  async close(): Promise<void> {
    // intentional no-op — session lifecycle owned by ConnectorSessionManager
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Infer the resource content type from the file name and MIME type.
 * Falls back to "file" for unknown types.
 */
function inferContentType(fileName: string, mimeType: string): ResourceContentType {
  const lower = fileName.toLowerCase();
  const mime = mimeType.toLowerCase();

  if (lower.endsWith(".pdf") || mime === "application/pdf") {
    // Heuristic: classify based on name keywords
    if (/policy/i.test(lower)) return "policy_document";
    if (/procedure|process/i.test(lower)) return "procedure_document";
    if (/legislation|act|regulation/i.test(lower)) return "legislation";
    if (/standard/i.test(lower)) return "standard";
    if (/template/i.test(lower)) return "template";
    return "file";
  }

  if (lower.endsWith(".docx") || lower.endsWith(".doc") || mime.includes("word")) {
    if (/policy/i.test(lower)) return "policy_document";
    if (/procedure|process/i.test(lower)) return "procedure_document";
    if (/template/i.test(lower)) return "template";
    return "file";
  }

  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || mime.includes("excel") || mime.includes("spreadsheet")) {
    return "spreadsheet";
  }

  if (lower.endsWith(".pptx") || lower.endsWith(".ppt") || mime.includes("presentation")) {
    return "presentation";
  }

  if (lower.endsWith(".eml") || lower.endsWith(".msg") || mime.includes("message")) {
    return "email";
  }

  return "file";
}

/**
 * Compute relevance confidence for a file given the search query.
 *
 * Simple keyword-overlap heuristic. Future sprints may use embedding similarity.
 * Range: 0.5 (no overlap) to 0.9 (all query terms matched in filename).
 */
function computeConfidence(query: string, fileName: string): number {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  if (queryTerms.length === 0) return 0.55;

  const lowerName = fileName.toLowerCase();
  const matchedTerms = queryTerms.filter(t => lowerName.includes(t)).length;
  const ratio = matchedTerms / queryTerms.length;

  // Scale from 0.5 (no match) to 0.9 (full match)
  return Math.round((0.5 + ratio * 0.4) * 100) / 100;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createConnectorEvidenceResolver(): ConnectorEvidenceResolver {
  return new ConnectorEvidenceResolver();
}
