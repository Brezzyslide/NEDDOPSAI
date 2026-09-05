/**
 * Work Package Service — Sprint 22 (Work Execution Engine & Completed Work)
 *
 * Assembles an immutable Work Package Manifest before specialist execution.
 * Retrieves every knowledge source, memory, and entity reference needed for
 * the work, stamps model/prompt versions, and writes an immutable manifest row.
 *
 * Sprint 28.6: assembleWorkPackage now also queries candidate sources that were
 * NOT included (wrong status, pending ingestion, zero chunks, etc.) and returns
 * them as ExcludedSource records. These are stored in selectionMetadata so the
 * Execution Inspector can surface them without a DB migration.
 */

import { randomUUID } from "crypto";
import { db, withSystemTenantContext } from "@workspace/db";
import {
  workPackageManifestsTable,
  knowledgeSourcesTable,
  knowledgeSourceVersionsTable,
  knowledgeChunksTable,
  ingestionJobsTable,
  organisationMemoryTable,
  type ManifestLibrarySource,
  type ManifestMemoryRef,
  type BlueprintSelectionMetadata,
  type ManifestValidationSnapshot,
  type ManifestPerformanceMetrics,
  type ManifestFailureInfo,
} from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import type { WorkBlueprint } from "./workBlueprintService.js";

type DbClient = typeof db;

function withWorkPackageTenant<T>(
  organizationId: string,
  purpose: string,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  return withSystemTenantContext(
    { tenantId: organizationId, serviceIdentity: "work_package_service", purpose },
    fn,
  );
}

// ─── Guard ────────────────────────────────────────────────────────────────────

function assertSelectFields(
  fields: Record<string, unknown>,
  label: string,
): void {
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) {
      throw new Error(
        `[workPackageService] Drizzle .select() at "${label}": ` +
        `field "${key}" is ${String(value)} — column name mismatch in schema or stale @workspace/db build.`,
      );
    }
  }
}

// ─── Prompt version ───────────────────────────────────────────────────────────
export const CURRENT_PROMPT_VERSION = "sprint22.1.0";

// ─── Excluded source types (Sprint 28.6) ─────────────────────────────────────

export type ExclusionReason =
  | "awaiting_approval"        // ingested but not yet approved by admin
  | "ingestion_pending"        // queued/processing, not yet available
  | "ingestion_failed"         // dead_lettered or exhausted retries
  | "zero_chunks"              // approved but no chunks created (corruption / re-embed needed)
  | "archived"                 // source was archived/retired
  | "superseded"               // is_current = false, newer version exists
  | "confidence_below_threshold" // included in manifest but retrieval confidence too low
  | "clearance_denied";        // sensitivity clearance check failed

export interface ExcludedSource {
  sourceId:       string;
  title:          string;
  exclusionReason: ExclusionReason;
  /** Current status on knowledge_sources */
  status:         string;
  /** Current ingestion_status on the active version */
  ingestionStatus: string | null;
  /** Ingestion job status for the active version */
  jobStatus:      string | null;
  /** Last ingestion error code, if dead_lettered */
  lastErrorCode:  string | null;
  /** Chunk count (0 if ingestion not complete) */
  chunkCount:     number;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AssembleManifestInput {
  organizationId: string;
  requesterId: string;
  conversationId?: string;
  blueprint: WorkBlueprint | null;
  taskUploadSourceIds?: string[];
  entityKnowledge?: Record<string, unknown>;
  modelVersion?: string;
  selectionMetadata?: BlueprintSelectionMetadata;
  /**
   * Sprint 29I (D1): Specialist pre-selected by the Chief of Staff plan.
   * When provided, takes precedence over blueprint.primarySpecialist.
   *
   * Architecture boundary:
   *   blueprint.primarySpecialist = recommended specialist for DIRECT blueprint
   *     execution (no CoS plan). It is the recipe author's suggestion.
   *   selectedSpecialist = the CoS decision recorded in task_execution_plans.
   *     It is the runtime authority for all task-path executions.
   *
   * Blueprint remains authoritative for output structure, validation rules,
   * quality dimensions, mandatory citations, and success criteria — never
   * for specialist ownership.
   */
  selectedSpecialist?: string;
}

export interface ManifestObservabilityUpdate {
  validationSnapshot?: ManifestValidationSnapshot;
  performanceMetrics?: ManifestPerformanceMetrics;
  failureInfo?: ManifestFailureInfo;
}

export async function updateManifestObservability(
  manifestId: string,
  updates: ManifestObservabilityUpdate,
  organizationId: string,
): Promise<void> {
  const set: Partial<typeof workPackageManifestsTable.$inferInsert> = {};
  if (updates.validationSnapshot !== undefined) set.validationSnapshot = updates.validationSnapshot;
  if (updates.performanceMetrics !== undefined) set.performanceMetrics = updates.performanceMetrics;
  if (updates.failureInfo !== undefined) set.failureInfo = updates.failureInfo;
  if (Object.keys(set).length === 0) return;

  await withWorkPackageTenant(organizationId, "work_package_manifest.observability.update", async (client) => client
    .update(workPackageManifestsTable)
    .set(set)
    .where(
      and(
        eq(workPackageManifestsTable.id, manifestId),
        eq(workPackageManifestsTable.organizationId, organizationId),
      ),
    ));
}

export interface WorkPackageManifest {
  id: string;
  organizationId: string;
  completedWorkId: string | null;
  executionId: string;
  blueprintId: string | null;
  blueprintVersion: string | null;
  canonicalIntent: string | null;
  blueprintFamily: string | null;
  blueprintMode: string | null;
  templateId: string | null;
  templateVersion: string | null;
  contractSnapshot: Record<string, unknown> | null;
  primarySpecialist: string;
  supportingSpecialists: string[];
  organisationLibrarySources: ManifestLibrarySource[];
  cosMemories: ManifestMemoryRef[];
  specialistMemories: ManifestMemoryRef[];
  entityKnowledge: Record<string, unknown>;
  taskUploads: ManifestLibrarySource[];
  selectionMetadata?: BlueprintSelectionMetadata | null;
  modelVersion: string | null;
  promptVersion: string | null;
  assembledAt: Date;
  requesterId: string | null;
  createdAt: Date;
}

/** Extended result that includes excluded-source diagnostics (not persisted in manifest row). */
export interface AssembleWorkPackageResult {
  manifest: WorkPackageManifest;
  excludedSources: ExcludedSource[];
}

// ─── Assembly ─────────────────────────────────────────────────────────────────

export async function assembleWorkPackage(
  input: AssembleManifestInput,
): Promise<AssembleWorkPackageResult> {
  const { organizationId, requesterId, blueprint, taskUploadSourceIds = [], entityKnowledge = {} } = input;

  const executionId = randomUUID();
  // Sprint 29I (D1): Specialist precedence
  //   1. selectedSpecialist — CoS plan authority for all task-path executions
  //   2. blueprint.primarySpecialist — fallback candidate (direct blueprint execution only)
  //   3. "chief_of_staff" — last-resort default (should not occur in production)
  //
  // Blueprint.primarySpecialist is the RECIPE AUTHOR'S RECOMMENDATION. It is not
  // authoritative when the Chief of Staff has already selected a specialist via
  // task_execution_plans.primarySpecialist. Blueprint governs work structure
  // (output types, validation rules, quality dimensions) — never specialist identity.
  const primarySpecialist = input.selectedSpecialist
    ?? blueprint?.primarySpecialist
    ?? "chief_of_staff";
  const supportingSpecialists = blueprint?.supportingSpecialists ?? [];
  const requiredKnowledgeTypes = blueprint?.requiredLibraryKnowledge ?? [];

  // ── Retrieve Organisation Library sources ────────────────────────────────
  let librarySources: ManifestLibrarySource[] = [];
  let excludedSources: ExcludedSource[] = [];

  if (requiredKnowledgeTypes.length > 0) {
    const _libFields = {
      id: knowledgeSourcesTable.id,
      title: knowledgeSourcesTable.title,
      sourceType: knowledgeSourcesTable.sourceType,
      authorityLevel: knowledgeSourcesTable.authorityLevel,
      storageKey: knowledgeSourcesTable.storageKey,
      versionLabel: knowledgeSourcesTable.versionLabel,
      status: knowledgeSourcesTable.status,
      isCurrent: knowledgeSourcesTable.isCurrent,
    };
    assertSelectFields(_libFields, "library-sources");

    // Query ALL candidate sources (any status) so we can report exclusions
    const allCandidates = await withWorkPackageTenant(organizationId, "work_package.library_sources.select", async (client) => client
      .select(_libFields)
      .from(knowledgeSourcesTable)
      .where(
        and(
          eq(knowledgeSourcesTable.organizationId, organizationId),
          eq(knowledgeSourcesTable.sourceScope, "library"),
          inArray(knowledgeSourcesTable.sourceType, requiredKnowledgeTypes),
        )
      )
      .limit(80));

    const approvedCurrent = allCandidates.filter(
      r => r.status === "approved" && r.isCurrent,
    );
    const excluded = allCandidates.filter(
      r => !(r.status === "approved" && r.isCurrent),
    );

    librarySources = approvedCurrent.map(r => ({
      sourceId: r.id,
      title: r.title,
      sourceType: r.sourceType,
      authorityLevel: r.authorityLevel ?? undefined,
      storageKey: r.storageKey ?? undefined,
      versionLabel: r.versionLabel ?? undefined,
    }));

    if (excluded.length > 0) {
      excludedSources = await _buildExcludedSources(excluded, organizationId);
    }
  }

  // ── Retrieve CoS memory ──────────────────────────────────────────────────
  const _memFields = {
    id: organisationMemoryTable.id,
    memoryType: organisationMemoryTable.memoryType,
    title: organisationMemoryTable.title,
    content: organisationMemoryTable.content,
    approvalStatus: organisationMemoryTable.status,
  };
  assertSelectFields(_memFields, "cos-memory");
  const memoryRows = await withWorkPackageTenant(organizationId, "work_package.organisation_memory.select", async (client) => client
    .select(_memFields)
    .from(organisationMemoryTable)
    .where(
      and(
        eq(organisationMemoryTable.organizationId, organizationId),
        eq(organisationMemoryTable.status, "approved"),
      )
    )
    .limit(30));

  const requiredMemoryTypes = new Set(blueprint?.requiredMemories ?? []);
  const cosMemories: ManifestMemoryRef[] = [];
  const specialistMemories: ManifestMemoryRef[] = [];
  const MEMORY_CONTENT_MAX_CHARS = 800;

  for (const row of memoryRows) {
    const rawContent = row.content?.trim() ?? "";
    const ref: ManifestMemoryRef = {
      memoryId: row.id,
      memoryType: row.memoryType,
      title: row.title,
      approvalStatus: row.approvalStatus ?? undefined,
      content: rawContent.length > 0
        ? rawContent.slice(0, MEMORY_CONTENT_MAX_CHARS) +
          (rawContent.length > MEMORY_CONTENT_MAX_CHARS ? " [truncated]" : "")
        : undefined,
    };
    if (requiredMemoryTypes.has(row.memoryType) || requiredMemoryTypes.size === 0) {
      cosMemories.push(ref);
    } else {
      specialistMemories.push(ref);
    }
  }

  // ── Retrieve task uploads ────────────────────────────────────────────────
  let taskUploads: ManifestLibrarySource[] = [];
  if (taskUploadSourceIds.length > 0) {
    const _uploadFields = {
      id: knowledgeSourcesTable.id,
      title: knowledgeSourcesTable.title,
      sourceType: knowledgeSourcesTable.sourceType,
      storageKey: knowledgeSourcesTable.storageKey,
    };
    assertSelectFields(_uploadFields, "task-uploads");
    const uploadRows = await withWorkPackageTenant(organizationId, "work_package.task_uploads.select", async (client) => client
      .select(_uploadFields)
      .from(knowledgeSourcesTable)
      .where(
        and(
          eq(knowledgeSourcesTable.organizationId, organizationId),
          eq(knowledgeSourcesTable.sourceScope, "task"),
          inArray(knowledgeSourcesTable.id, taskUploadSourceIds),
        )
      ));

    taskUploads = uploadRows.map(r => ({
      sourceId: r.id,
      title: r.title,
      sourceType: r.sourceType,
      storageKey: r.storageKey ?? undefined,
    }));
  }

  // ── Determine model version ──────────────────────────────────────────────
  const modelVersion = input.modelVersion ??
    (process.env.OPENAI_MODEL_VERSION ?? process.env.AI_MODEL_VERSION ?? null);

  // ── Write immutable manifest ─────────────────────────────────────────────
  // Store excludedSources inside selectionMetadata JSONB so they are available
  // to the Execution Inspector without requiring a new DB column.
  const selectionMetadataWithExclusions = input.selectionMetadata
    ? { ...input.selectionMetadata, excludedSources }
    : (excludedSources.length > 0 ? { method: "none" as const, confidence: 0, matchedKeywords: [], fallbackUsed: false, excludedSources } : null);

  const id = randomUUID();
  const now = new Date();

  await withWorkPackageTenant(organizationId, "work_package_manifest.insert", async (client) => client.insert(workPackageManifestsTable).values({
    id,
    organizationId,
    completedWorkId: null,
    executionId,
    blueprintId: blueprint?.id ?? null,
    blueprintVersion: blueprint?.version ?? null,
    canonicalIntent: input.selectionMetadata?.canonicalIntent ?? null,
    blueprintFamily: blueprint?.blueprintFamily ?? input.selectionMetadata?.blueprintFamily ?? null,
    blueprintMode: input.selectionMetadata?.blueprintMode ?? null,
    templateId: blueprint?.defaultTemplateId ?? null,
    templateVersion: null,
    contractSnapshot: blueprint
      ? {
          deliverableContract: blueprint.deliverableContract,
          evidenceContract: blueprint.evidenceContract,
          sectionsExpected: true,
        }
      : null,
    primarySpecialist,
    supportingSpecialists,
    organisationLibrarySources: librarySources,
    cosMemories,
    specialistMemories,
    entityKnowledge,
    taskUploads,
    selectionMetadata: selectionMetadataWithExclusions ?? null,
    modelVersion,
    promptVersion: CURRENT_PROMPT_VERSION,
    assembledAt: now,
    requesterId,
    createdAt: now,
  }));

  const manifest: WorkPackageManifest = {
    id,
    organizationId,
    completedWorkId: null,
    executionId,
    blueprintId: blueprint?.id ?? null,
    blueprintVersion: blueprint?.version ?? null,
    canonicalIntent: input.selectionMetadata?.canonicalIntent ?? null,
    blueprintFamily: blueprint?.blueprintFamily ?? input.selectionMetadata?.blueprintFamily ?? null,
    blueprintMode: input.selectionMetadata?.blueprintMode ?? null,
    templateId: blueprint?.defaultTemplateId ?? null,
    templateVersion: null,
    contractSnapshot: blueprint
      ? {
          deliverableContract: blueprint.deliverableContract,
          evidenceContract: blueprint.evidenceContract,
          sectionsExpected: true,
        }
      : null,
    primarySpecialist,
    supportingSpecialists,
    organisationLibrarySources: librarySources,
    cosMemories,
    specialistMemories,
    entityKnowledge,
    taskUploads,
    selectionMetadata: selectionMetadataWithExclusions ?? null,
    modelVersion,
    promptVersion: CURRENT_PROMPT_VERSION,
    assembledAt: now,
    requesterId,
    createdAt: now,
  };

  return { manifest, excludedSources };
}

// ─── Excluded source builder ──────────────────────────────────────────────────

async function _buildExcludedSources(
  candidates: Array<{ id: string; title: string; status: string; isCurrent: boolean }>,
  organizationId: string,
): Promise<ExcludedSource[]> {
  if (candidates.length === 0) return [];

  const sourceIds = candidates.map(c => c.id);

  // Fetch current version ingestion status + job info in one pass
  const [versionRows, jobRows, chunkCounts] = await withWorkPackageTenant(
    organizationId,
    "work_package.excluded_sources.inspect",
    async (client) => Promise.all([
    client
      .select({
        knowledgeSourceId: knowledgeSourceVersionsTable.knowledgeSourceId,
        ingestionStatus:   knowledgeSourceVersionsTable.ingestionStatus,
      })
      .from(knowledgeSourceVersionsTable)
      .where(
        and(
          eq(knowledgeSourceVersionsTable.organizationId, organizationId),
          eq(knowledgeSourceVersionsTable.isCurrent, true),
          inArray(knowledgeSourceVersionsTable.knowledgeSourceId, sourceIds),
        )
      )
      .limit(sourceIds.length),

    client.execute<{ knowledge_source_id: string; status: string; last_error_code: string | null }>(sql`
      SELECT DISTINCT ON (knowledge_source_id)
        knowledge_source_id,
        status,
        last_error_code
      FROM ingestion_jobs
      WHERE organization_id = ${organizationId}
        AND knowledge_source_id = ANY(${sql.raw(`ARRAY[${sourceIds.map(id => `'${id}'`).join(",")}]`)})
      ORDER BY knowledge_source_id, created_at DESC
    `).then(r => (r.rows ?? r as any) as Array<{ knowledge_source_id: string; status: string; last_error_code: string | null }>),

    client.execute<{ knowledge_source_id: string; cnt: string }>(sql`
      SELECT knowledge_source_id, COUNT(*)::int AS cnt
      FROM knowledge_chunks
      WHERE organization_id = ${organizationId}
        AND knowledge_source_id = ANY(${sql.raw(`ARRAY[${sourceIds.map(id => `'${id}'`).join(",")}]`)})
        AND deleted_at IS NULL
      GROUP BY knowledge_source_id
    `).then(r => (r.rows ?? r as any) as Array<{ knowledge_source_id: string; cnt: string }>),
  ]),
  );

  const versionMap  = new Map(versionRows.map(v => [v.knowledgeSourceId, v.ingestionStatus]));
  const jobMap      = new Map(jobRows.map(j => [j.knowledge_source_id, j]));
  const chunkMap    = new Map(chunkCounts.map(c => [c.knowledge_source_id, parseInt(c.cnt, 10)]));

  return candidates.map(candidate => {
    const ingestionStatus = versionMap.get(candidate.id) ?? null;
    const job             = jobMap.get(candidate.id);
    const chunkCount      = chunkMap.get(candidate.id) ?? 0;
    const jobStatus       = job?.status ?? null;
    const lastErrorCode   = job?.last_error_code ?? null;

    let exclusionReason: ExclusionReason;

    if (!candidate.isCurrent) {
      exclusionReason = "superseded";
    } else if (candidate.status === "archived" || candidate.status === "revoked") {
      exclusionReason = "archived";
    } else if (candidate.status === "review_required") {
      exclusionReason = "awaiting_approval";
    } else if (candidate.status === "approved" && chunkCount === 0) {
      exclusionReason = "zero_chunks";
    } else if (
      jobStatus === "dead_lettered" ||
      ingestionStatus === "failed" ||
      ingestionStatus === "cancelled"
    ) {
      exclusionReason = "ingestion_failed";
    } else if (
      candidate.status === "uploaded" ||
      ingestionStatus === "pending" ||
      ingestionStatus === "processing" ||
      jobStatus === "queued" || jobStatus === "fetching" || jobStatus === "extracting" ||
      jobStatus === "normalising" || jobStatus === "chunking" || jobStatus === "embedding"
    ) {
      exclusionReason = "ingestion_pending";
    } else {
      exclusionReason = "ingestion_pending";
    }

    return {
      sourceId:        candidate.id,
      title:           candidate.title,
      exclusionReason,
      status:          candidate.status,
      ingestionStatus: ingestionStatus ?? null,
      jobStatus,
      lastErrorCode,
      chunkCount,
    };
  });
}

// ─── Manifest link ────────────────────────────────────────────────────────────

export async function linkManifestToCompletedWork(
  manifestId: string,
  completedWorkId: string,
  organizationId: string,
): Promise<void> {
  await withWorkPackageTenant(organizationId, "work_package_manifest.completed_work.link", async (client) => client
    .update(workPackageManifestsTable)
    .set({ completedWorkId })
    .where(
      and(
        eq(workPackageManifestsTable.id, manifestId),
        eq(workPackageManifestsTable.organizationId, organizationId),
      ),
    ));
}

export async function getManifest(
  id: string,
  organizationId: string,
): Promise<WorkPackageManifest | null> {
  const rows = await withWorkPackageTenant(organizationId, "work_package_manifest.get", async (client) => client
    .select()
    .from(workPackageManifestsTable)
    .where(
      and(
        eq(workPackageManifestsTable.id, id),
        eq(workPackageManifestsTable.organizationId, organizationId),
      )
    )
    .limit(1));

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    organizationId: row.organizationId,
    completedWorkId: row.completedWorkId ?? null,
    executionId: row.executionId,
    blueprintId: row.blueprintId ?? null,
    blueprintVersion: row.blueprintVersion ?? null,
    canonicalIntent: row.canonicalIntent ?? null,
    blueprintFamily: row.blueprintFamily ?? null,
    blueprintMode: row.blueprintMode ?? null,
    templateId: row.templateId ?? null,
    templateVersion: row.templateVersion ?? null,
    contractSnapshot: (row.contractSnapshot as Record<string, unknown> | null) ?? null,
    primarySpecialist: row.primarySpecialist,
    supportingSpecialists: (row.supportingSpecialists as string[]) ?? [],
    organisationLibrarySources: (row.organisationLibrarySources as ManifestLibrarySource[]) ?? [],
    cosMemories: (row.cosMemories as ManifestMemoryRef[]) ?? [],
    specialistMemories: (row.specialistMemories as ManifestMemoryRef[]) ?? [],
    entityKnowledge: (row.entityKnowledge as Record<string, unknown>) ?? {},
    taskUploads: (row.taskUploads as ManifestLibrarySource[]) ?? [],
    selectionMetadata: (row.selectionMetadata as BlueprintSelectionMetadata | null) ?? null,
    modelVersion: row.modelVersion ?? null,
    promptVersion: row.promptVersion ?? null,
    assembledAt: row.assembledAt,
    requesterId: row.requesterId ?? null,
    createdAt: row.createdAt,
  };
}
