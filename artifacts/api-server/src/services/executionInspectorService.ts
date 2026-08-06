/**
 * Execution Inspector Service — Sprint 27.4 (Execution Inspector & Runtime Transparency)
 *
 * Assembles a structured, RBAC-filtered inspection snapshot from existing
 * database tables. Never touches execution logic — read-only observability only.
 *
 * Data sources:
 *   - work_package_manifests       : specialist, blueprint, sources, memories, timing
 *   - retrieval_audit_events       : evidence detail, scores, retrieval timing
 *   - completed_work               : status, conversationId
 *   - work_blueprints              : blueprint name (joined via blueprintId)
 *   - knowledge_chunks             : first-chunk preview per source (best-effort)
 *   - executionTimelineService     : human-readable execution timeline
 *
 * Security:
 *   - Org users  → only their own executions (requesterId must match actorUserId)
 *   - Platform owners → all executions across all orgs (orgId may be any tenant)
 *
 * Never exposes: system prompts, embedding vectors, API keys, chain-of-thought,
 * raw LLM payloads, or sensitive model internals.
 */

import { db } from "@workspace/db";
import {
  workPackageManifestsTable,
  retrievalAuditEventsTable,
  completedWorkTable,
  workBlueprintsTable,
  knowledgeChunksTable,
  type ManifestLibrarySource,
  type ManifestMemoryRef,
  type BlueprintSelectionMetadata,
  type ManifestValidationSnapshot,
  type ManifestPerformanceMetrics,
  type ManifestFailureInfo,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { getConversationTimeline } from "./executionTimelineService.js";
import type { TimelineEntry } from "./executionTimelineService.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface InspectorEvidenceSource {
  sourceId: string;
  title: string;
  version: string | null;
  authorityLevel: string | null;
  sourceType: string;
  chunkCount: number;
  confidence: number | null;
  chunkPreview: string | null;
  /** Human-readable citation — internal use only, never shown as raw prompt text */
  citation: string | null;
  retrieved: boolean;
}

/** Sprint 28.6 — a candidate source that was excluded from this execution */
export interface InspectorExcludedSource {
  sourceId:        string;
  title:           string;
  exclusionReason: string;
  status:          string;
  ingestionStatus: string | null;
  jobStatus:       string | null;
  lastErrorCode:   string | null;
  chunkCount:      number;
}

export interface InspectorBlueprint {
  blueprintId: string | null;
  name: string | null;
  version: string | null;
  selectionMethod: "keyword" | "semantic" | "none";
  matchedPhrase: string | null;
  semanticReason: string | null;
  confidence: number;
  validationPassed: boolean | null;
  validationMissingItems: string[];
  requiredKnowledge: Array<{ name: string; retrieved: boolean }>;
}

export interface InspectorSpecialistRuntime {
  dnaLoaded: boolean;
  organisationMemoryEntries: number;
  evidenceChunks: number;
  taskUploads: number;
  blueprintLoaded: boolean;
  expectedDeliverablesLoaded: boolean;
}

export interface InspectorTimeline {
  entries: TimelineEntry[];
  isComplete: boolean;
  hasFailure: boolean;
}

export interface InspectorGatewayDiagnostics {
  /** Output mode the caller declared on the gateway request */
  outputMode: string;
  /** AI provider the gateway routed to */
  provider: string;
  /** Model identifier used (null when unknown or fallback) */
  model: string | null;
  /** response_format value sent to the provider, or null when text mode */
  responseFormat: string | null;
  /** True when the AI provider failed and the deterministic fallback was used */
  usedFallback: boolean;
  /** Human-readable reason the fallback was triggered */
  fallbackReason: string | null;
}

export interface InspectorDiagnostics {
  state: "running" | "awaiting_clarification" | "failed" | "completed";
  clarificationItems: Array<{ name: string; reason: string }>;
  failedStage: string | null;
  rootCause: string | null;
  retryAvailable: boolean;
  /**
   * Sprint 28.7 — gateway execution diagnostics.
   * Populated from failure info when the root cause is an AI gateway issue.
   * Null when the execution is still running or completed successfully via a path
   * that did not record gateway metadata.
   */
  gateway: InspectorGatewayDiagnostics | null;
}

export interface InspectorPerformance {
  blueprintSelectionMs: number | null;
  validationMs: number | null;
  retrievalMs: number | null;
  llmMs: number | null;
  reviewMs: number | null;
  totalMs: number | null;
  evidenceCacheHit: boolean;
  chunkCount: number;
  memoryCount: number;
}

export interface ExecutionInspection {
  /** The execution correlation ID stored on the manifest */
  executionId: string;
  manifestId: string;
  conversationId: string | null;
  completedWorkId: string | null;

  summary: {
    leadSpecialist: string;
    supportingSpecialists: string[];
    blueprintName: string | null;
    blueprintVersion: string | null;
    selectionMethod: "keyword" | "semantic" | "none";
    selectionConfidence: number;
    currentStage: string;
    runtimeStatus: "executing" | "completed" | "failed" | "awaiting_clarification" | "reviewing" | "unknown";
    knowledgeConfidence: number | null;
    validationPassed: boolean | null;
    completedWorkStatus: string | null;
    startedAt: string;
    durationMs: number | null;
  };

  evidence: {
    sources: InspectorEvidenceSource[];
    excludedSources: InspectorExcludedSource[];
    memoryEntries: number;
    taskUploads: number;
    totalChunks: number;
    noEvidenceReason: string | null;
  };

  blueprint: InspectorBlueprint;

  specialistRuntime: InspectorSpecialistRuntime;

  timeline: InspectorTimeline;

  diagnostics: InspectorDiagnostics;

  performance: InspectorPerformance;
}

// ─── RBAC guard type ──────────────────────────────────────────────────────────

export type InspectorActorRole = "org_user" | "platform_owner";

// ─── Internal helpers ─────────────────────────────────────────────────────────

function deriveRuntimeStatus(
  completedWorkStatus: string | null,
  timelineIsComplete: boolean,
  timelineHasFailure: boolean,
  failureInfo: ManifestFailureInfo | null,
): ExecutionInspection["summary"]["runtimeStatus"] {
  if (failureInfo?.state === "awaiting_clarification") return "awaiting_clarification";
  if (failureInfo?.state === "failed") return "failed";
  if (timelineHasFailure) return "failed";
  if (completedWorkStatus === "draft" && timelineIsComplete) return "reviewing";
  if (completedWorkStatus && completedWorkStatus !== "draft") return "completed";
  if (timelineIsComplete) return "completed";
  return "executing";
}

function currentStageFromTimeline(entries: TimelineEntry[]): string {
  if (entries.length === 0) return "Initialising";
  const last = entries[entries.length - 1];
  if (last.humanLabel && last.humanLabel.length < 80) return last.humanLabel;
  if (last.stage) return last.stage;
  return last.kind;
}

function deriveConfidence(
  scoreMetadata: unknown,
  chunkIds: unknown,
): number | null {
  const ids = (chunkIds as string[] | null) ?? [];
  if (!ids.length) return null;
  const meta = scoreMetadata as Record<string, { baseScore?: number }> | null;
  if (!meta) return null;
  const scores = Object.values(meta).map(v => v?.baseScore ?? 0).filter(s => s > 0);
  if (!scores.length) return null;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100;
}

// ─── Core function ────────────────────────────────────────────────────────────

/**
 * Get a full execution inspection snapshot by executionId.
 *
 * Returns null when no manifest is found, or when the actor is an org_user
 * who is not the requester of this execution.
 */
export async function getExecutionInspection(
  executionId: string,
  organizationId: string,
  actorUserId: string,
  actorRole: InspectorActorRole,
): Promise<ExecutionInspection | null> {
  // ── 1. Load manifest ────────────────────────────────────────────────────────
  const [manifestRow] = await db
    .select()
    .from(workPackageManifestsTable)
    .where(
      and(
        eq(workPackageManifestsTable.executionId, executionId),
        eq(workPackageManifestsTable.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!manifestRow) return null;

  // RBAC: org_users can only inspect their own executions
  if (actorRole === "org_user" && manifestRow.requesterId !== actorUserId) {
    return null;
  }

  return _buildInspection(manifestRow, organizationId);
}

/**
 * Get a full execution inspection snapshot by completedWorkId.
 * Looks up the manifest via the completedWorkId FK.
 */
export async function getInspectionByCompletedWorkId(
  completedWorkId: string,
  organizationId: string,
  actorUserId: string,
  actorRole: InspectorActorRole,
): Promise<ExecutionInspection | null> {
  const [manifestRow] = await db
    .select()
    .from(workPackageManifestsTable)
    .where(
      and(
        eq(workPackageManifestsTable.completedWorkId, completedWorkId),
        eq(workPackageManifestsTable.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!manifestRow) return null;

  if (actorRole === "org_user" && manifestRow.requesterId !== actorUserId) {
    return null;
  }

  return _buildInspection(manifestRow, organizationId);
}

// ─── Builder ──────────────────────────────────────────────────────────────────

async function _buildInspection(
  manifestRow: typeof workPackageManifestsTable.$inferSelect,
  organizationId: string,
): Promise<ExecutionInspection> {
  const manifestId = manifestRow.id;
  const executionId = manifestRow.executionId;

  // ── 2. Load retrieval audit event (best-effort) ─────────────────────────────
  const [auditRow] = await db
    .select()
    .from(retrievalAuditEventsTable)
    .where(
      and(
        eq(retrievalAuditEventsTable.executionId, executionId),
        eq(retrievalAuditEventsTable.organizationId, organizationId),
      ),
    )
    .orderBy(retrievalAuditEventsTable.createdAt)
    .limit(1);

  // ── 3. Load completed work (best-effort) ────────────────────────────────────
  const [completedWorkRow] = manifestRow.completedWorkId
    ? await db
        .select({
          id: completedWorkTable.id,
          status: completedWorkTable.status,
          conversationId: completedWorkTable.conversationId,
        })
        .from(completedWorkTable)
        .where(
          and(
            eq(completedWorkTable.id, manifestRow.completedWorkId),
            eq(completedWorkTable.organizationId, organizationId),
          ),
        )
        .limit(1)
    : [];

  // ── 4. Load blueprint name (best-effort) ────────────────────────────────────
  const [blueprintRow] = manifestRow.blueprintId
    ? await db
        .select({ name: workBlueprintsTable.title, version: workBlueprintsTable.version })
        .from(workBlueprintsTable)
        .where(eq(workBlueprintsTable.id, manifestRow.blueprintId))
        .limit(1)
    : [];

  // ── 5. Load execution timeline ───────────────────────────────────────────────
  const conversationId = completedWorkRow?.conversationId ?? null;
  const timeline = conversationId
    ? await getConversationTimeline(organizationId, conversationId).catch(() => ({
        conversationId,
        entries: [],
        isComplete: false,
        hasFailure: false,
      }))
    : { conversationId: "", entries: [], isComplete: false, hasFailure: false };

  // ── 6. Derive observability values ───────────────────────────────────────────
  const librarySources = (manifestRow.organisationLibrarySources as ManifestLibrarySource[]) ?? [];
  const taskUploads = (manifestRow.taskUploads as ManifestLibrarySource[]) ?? [];
  const cosMemories = (manifestRow.cosMemories as ManifestMemoryRef[]) ?? [];
  const specialistMemories = (manifestRow.specialistMemories as ManifestMemoryRef[]) ?? [];
  const selMeta = manifestRow.selectionMetadata as BlueprintSelectionMetadata | null;
  const valSnap = manifestRow.validationSnapshot as ManifestValidationSnapshot | null;
  const perfMeta = manifestRow.performanceMetrics as ManifestPerformanceMetrics | null;
  const failInfo = manifestRow.failureInfo as ManifestFailureInfo | null;

  const retrievedSourceIds = new Set<string>(
    (auditRow?.sourceIds as string[] | null) ?? [],
  );
  const chunkIds = (auditRow?.chunkIds as string[] | null) ?? [];
  const memoryIds = (auditRow?.memoryIds as string[] | null) ?? [];
  const taskUploadIds = (auditRow?.taskUploadIds as string[] | null) ?? [];

  // ── 7. Build per-source evidence detail ─────────────────────────────────────
  const evidenceSources = await _buildEvidenceSources(
    librarySources,
    taskUploads,
    retrievedSourceIds,
    chunkIds,
    auditRow?.scoreMetadata ?? null,
    organizationId,
  );

  // ── 8. Derive overall confidence from scores ─────────────────────────────────
  const knowledgeConfidence = deriveConfidence(
    auditRow?.scoreMetadata ?? null,
    auditRow?.chunkIds ?? null,
  );

  // ── 9. Derive runtime status ─────────────────────────────────────────────────
  const runtimeStatus = deriveRuntimeStatus(
    completedWorkRow?.status ?? null,
    timeline.isComplete,
    timeline.hasFailure,
    failInfo,
  );

  const currentStage = currentStageFromTimeline(timeline.entries);

  // ── 10. Compute timing ───────────────────────────────────────────────────────
  const startedAt = manifestRow.assembledAt.toISOString();
  let durationMs: number | null = null;
  if (perfMeta?.totalMs) {
    durationMs = perfMeta.totalMs;
  } else if (timeline.entries.length >= 2) {
    const first = new Date(timeline.entries[0].timestamp).getTime();
    const last = new Date(timeline.entries[timeline.entries.length - 1].timestamp).getTime();
    durationMs = last - first;
  }

  // ── 11. Blueprint detail ─────────────────────────────────────────────────────
  const blueprintDetail: InspectorBlueprint = {
    blueprintId: manifestRow.blueprintId ?? null,
    name: blueprintRow?.name ?? null,
    version: manifestRow.blueprintVersion ?? blueprintRow?.version ?? null,
    selectionMethod: selMeta?.method ?? "none",
    matchedPhrase: (selMeta?.method === "keyword" && selMeta.matchedKeywords?.length)
      ? selMeta.matchedKeywords.join(", ")
      : null,
    semanticReason: selMeta?.method === "semantic" ? "Classified by LLM semantic analysis" : null,
    confidence: selMeta?.confidence ?? 0,
    validationPassed: valSnap?.passed ?? null,
    validationMissingItems: valSnap?.missingItems ?? [],
    requiredKnowledge: librarySources.map(s => ({
      name: s.title,
      retrieved: retrievedSourceIds.has(s.sourceId),
    })),
  };

  // ── 12. Specialist runtime counts ────────────────────────────────────────────
  const specialistRuntime: InspectorSpecialistRuntime = {
    dnaLoaded: true, // DNA is always loaded for active specialists
    organisationMemoryEntries: cosMemories.length + specialistMemories.length,
    evidenceChunks: chunkIds.length,
    taskUploads: taskUploadIds.length || taskUploads.length,
    blueprintLoaded: !!manifestRow.blueprintId,
    expectedDeliverablesLoaded: !!manifestRow.blueprintId,
  };

  // ── 13. Diagnostics ──────────────────────────────────────────────────────────
  const diagnosticsState: InspectorDiagnostics["state"] =
    failInfo?.state === "awaiting_clarification"
      ? "awaiting_clarification"
      : failInfo?.state === "failed"
      ? "failed"
      : runtimeStatus === "completed"
      ? "completed"
      : "running";

  // ── Sprint 28.7 — gateway diagnostics ────────────────────────────────────
  // Detect whether the failure was caused by an AI gateway issue (provider
  // failure / fallback). The rootCause message written by generateDraft
  // contains the marker phrase "gateway used fallback" when the deterministic
  // fallback fired, and "OpenAI" when a raw API error was the cause.
  const rootCauseText = failInfo?.rootCause ?? "";
  const isFallbackRootCause = rootCauseText.includes("gateway used fallback") ||
    rootCauseText.includes("AI specialist execution did not produce content");
  const isOpenAIErrorRootCause = rootCauseText.toLowerCase().includes("openai");

  let gatewayDiagnostics: InspectorGatewayDiagnostics | null = null;
  if (failInfo?.failedStage === "executing" && (isFallbackRootCause || isOpenAIErrorRootCause)) {
    // Work execution always uses outputMode "text" (Sprint 28.7 fix).
    // Provider is "openai" for all production orgs on this path.
    gatewayDiagnostics = {
      outputMode:     "text",
      provider:       "openai",
      model:          null,  // Actual model is in the gateway audit log; not stored in manifest
      responseFormat: null,  // text mode → no response_format sent
      usedFallback:   isFallbackRootCause,
      fallbackReason: isFallbackRootCause ? rootCauseText : null,
    };
  }

  const diagnostics: InspectorDiagnostics = {
    state: diagnosticsState,
    clarificationItems: failInfo?.clarificationItems ?? [],
    failedStage: failInfo?.failedStage ?? null,
    rootCause: failInfo?.rootCause ?? null,
    retryAvailable: failInfo?.retryAvailable ?? false,
    gateway: gatewayDiagnostics,
  };

  // ── 14. Performance ──────────────────────────────────────────────────────────
  const performance: InspectorPerformance = {
    blueprintSelectionMs: perfMeta?.blueprintSelectionMs ?? null,
    validationMs: perfMeta?.validationMs ?? null,
    retrievalMs: perfMeta?.retrievalMs ?? (auditRow?.retrievalDurationMs ?? null),
    llmMs: perfMeta?.llmMs ?? null,
    reviewMs: perfMeta?.reviewMs ?? null,
    totalMs: perfMeta?.totalMs ?? durationMs,
    evidenceCacheHit: perfMeta?.evidenceCacheHit ?? false,
    chunkCount: chunkIds.length,
    memoryCount: memoryIds.length || cosMemories.length + specialistMemories.length,
  };

  // ── 15. No-evidence reason ───────────────────────────────────────────────────
  let noEvidenceReason: string | null = null;
  if (librarySources.length === 0 && taskUploads.length === 0) {
    noEvidenceReason =
      manifestRow.blueprintId
        ? "Blueprint does not require library knowledge for this work type"
        : "No blueprint selected — ad-hoc execution without evidence requirements";
  } else if (chunkIds.length === 0 && (librarySources.length > 0 || taskUploads.length > 0)) {
    noEvidenceReason = "Evidence sources were listed in the manifest but no chunks passed the confidence threshold (≥ 0.05)";
  }

  // ── 16. Excluded sources (Sprint 28.6) ────────────────────────────────────
  // Read from selectionMetadata.excludedSources stored at assembly time.
  const selMetaRaw = manifestRow.selectionMetadata as (Record<string, unknown> & { excludedSources?: unknown[] }) | null;
  const excludedSources: InspectorExcludedSource[] = (selMetaRaw?.excludedSources ?? []).map((s: any) => ({
    sourceId:        s.sourceId ?? "",
    title:           s.title ?? "",
    exclusionReason: s.exclusionReason ?? "unknown",
    status:          s.status ?? "unknown",
    ingestionStatus: s.ingestionStatus ?? null,
    jobStatus:       s.jobStatus ?? null,
    lastErrorCode:   s.lastErrorCode ?? null,
    chunkCount:      s.chunkCount ?? 0,
  }));

  // If no sources were included but excluded sources exist, add that to the no-evidence reason.
  if (
    librarySources.length === 0 && taskUploads.length === 0 &&
    excludedSources.length > 0 && !noEvidenceReason
  ) {
    const failedCount = excludedSources.filter(s => s.exclusionReason === "ingestion_failed").length;
    const pendingCount = excludedSources.filter(s => s.exclusionReason === "ingestion_pending").length;
    const awaitingCount = excludedSources.filter(s => s.exclusionReason === "awaiting_approval").length;
    const parts: string[] = [];
    if (failedCount) parts.push(`${failedCount} source(s) failed ingestion`);
    if (pendingCount) parts.push(`${pendingCount} source(s) still processing`);
    if (awaitingCount) parts.push(`${awaitingCount} source(s) awaiting approval`);
    if (parts.length) noEvidenceReason = `Required sources excluded: ${parts.join(", ")}`;
  }

  return {
    executionId,
    manifestId,
    conversationId,
    completedWorkId: manifestRow.completedWorkId ?? null,

    summary: {
      leadSpecialist: manifestRow.primarySpecialist,
      supportingSpecialists: (manifestRow.supportingSpecialists as string[]) ?? [],
      blueprintName: blueprintRow?.name ?? null,
      blueprintVersion: manifestRow.blueprintVersion ?? blueprintRow?.version ?? null,
      selectionMethod: selMeta?.method ?? "none",
      selectionConfidence: selMeta?.confidence ?? 0,
      currentStage,
      runtimeStatus,
      knowledgeConfidence,
      validationPassed: valSnap?.passed ?? null,
      completedWorkStatus: completedWorkRow?.status ?? null,
      startedAt,
      durationMs,
    },

    evidence: {
      sources: evidenceSources,
      excludedSources,
      memoryEntries: cosMemories.length + specialistMemories.length,
      taskUploads: taskUploads.length,
      totalChunks: chunkIds.length,
      noEvidenceReason,
    },

    blueprint: blueprintDetail,
    specialistRuntime,
    timeline: {
      entries: timeline.entries,
      isComplete: timeline.isComplete,
      hasFailure: timeline.hasFailure,
    },
    diagnostics,
    performance,
  };
}

// ─── Evidence source builder ──────────────────────────────────────────────────

async function _buildEvidenceSources(
  librarySources: ManifestLibrarySource[],
  taskUploads: ManifestLibrarySource[],
  retrievedSourceIds: Set<string>,
  chunkIds: string[],
  scoreMetadata: unknown,
  organizationId: string,
): Promise<InspectorEvidenceSource[]> {
  const allSources = [...librarySources, ...taskUploads];
  if (allSources.length === 0) return [];

  const allSourceIds = allSources.map(s => s.sourceId);

  // Fetch chunk counts per source (first chunk only for preview — 150 chars)
  const chunkSet = new Set(chunkIds);

  // Get first chunk text per source for preview
  const previewMap = new Map<string, string>();
  if (allSourceIds.length > 0 && chunkIds.length > 0) {
    try {
      const previewRows = await db
        .select({
          sourceId: knowledgeChunksTable.knowledgeSourceId,
          text: knowledgeChunksTable.text,
          chunkId: knowledgeChunksTable.id,
        })
        .from(knowledgeChunksTable)
        .where(
          and(
            eq(knowledgeChunksTable.organizationId, organizationId),
            inArray(knowledgeChunksTable.knowledgeSourceId, allSourceIds),
          ),
        )
        .orderBy(knowledgeChunksTable.chunkIndex)
        .limit(allSourceIds.length * 3); // a few chunks per source, pick first hit

      for (const row of previewRows) {
        if (!previewMap.has(row.sourceId) && chunkSet.has(row.chunkId) && row.text) {
          previewMap.set(row.sourceId, row.text.slice(0, 150).trim());
        }
      }
    } catch {
      // Preview is best-effort; don't abort the inspection
    }
  }

  // Compute chunk count per source from the chunk IDs
  // We derive counts from knowledge_chunks only if chunkIds are available;
  // otherwise fall back to manifest source count (presence implies retrieval).
  const chunkCountMap = new Map<string, number>();
  if (chunkIds.length > 0 && allSourceIds.length > 0) {
    try {
      const countRows = await db
        .select({
          sourceId: knowledgeChunksTable.knowledgeSourceId,
          id: knowledgeChunksTable.id,
        })
        .from(knowledgeChunksTable)
        .where(
          and(
            eq(knowledgeChunksTable.organizationId, organizationId),
            inArray(knowledgeChunksTable.id, chunkIds.slice(0, 200)),
          ),
        )
        .limit(200);

      for (const row of countRows) {
        chunkCountMap.set(row.sourceId, (chunkCountMap.get(row.sourceId) ?? 0) + 1);
      }
    } catch {
      // Best-effort
    }
  }

  // Per-source confidence from scoreMetadata
  const meta = scoreMetadata as Record<string, { baseScore?: number; sourceId?: string }> | null;
  const sourceConfidenceMap = new Map<string, number>();
  if (meta) {
    for (const entry of Object.values(meta)) {
      if (entry?.sourceId && entry?.baseScore != null) {
        const existing = sourceConfidenceMap.get(entry.sourceId) ?? 0;
        if (entry.baseScore > existing) {
          sourceConfidenceMap.set(entry.sourceId, entry.baseScore);
        }
      }
    }
  }

  return allSources.map(source => ({
    sourceId: source.sourceId,
    title: source.title,
    version: source.versionLabel ?? null,
    authorityLevel: source.authorityLevel ?? null,
    sourceType: source.sourceType,
    chunkCount: chunkCountMap.get(source.sourceId) ?? (retrievedSourceIds.has(source.sourceId) ? 1 : 0),
    confidence: sourceConfidenceMap.get(source.sourceId) ?? null,
    chunkPreview: previewMap.get(source.sourceId) ?? null,
    citation: source.versionLabel ? `${source.title}, ${source.versionLabel}` : source.title,
    retrieved: retrievedSourceIds.has(source.sourceId),
  }));
}
