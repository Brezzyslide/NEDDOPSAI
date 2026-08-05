/**
 * Knowledge Hub — Source Service (internal module name)
 * Customer-facing product name: Organisation Library
 *
 * Manages the full lifecycle of Organisation Library sources:
 *   - create (complete upload)
 *   - list / get
 *   - update metadata
 *   - assign / remove scopes
 *   - approve / revoke
 *   - supersede (replace with a new source)
 *   - replace version (transactional: promotes new version, demotes old)
 *   - delete (soft delete)
 *   - reprocess placeholder (marks version for re-ingestion in Task #16)
 *   - list version history
 *
 * NAMING:
 *   "Organisation Library" is the customer-facing name shown in all UI.
 *   "Knowledge Hub" is the internal platform/module name used in developer
 *   documentation, architecture diagrams, and service descriptions.
 *   Database tables retain the existing knowledge_* naming convention.
 *
 * BACKWARDS COMPATIBILITY:
 *   - Does NOT touch organisation_memory, specialist_language_profiles,
 *     or any Task #14 specialist context service.
 *   - Existing org memory is NOT migrated into knowledge_sources here.
 *
 * ORGANISATION LIBRARY GOVERNANCE:
 *   - Only 'approved' library sources are eligible for specialist training
 *   - Only owner/admin may approve sources
 *   - Superseded versions remain queryable for audit
 *   - Deleted sources are soft-deleted (deletedAt set) — never hard-deleted
 *   - Task-scoped uploads are NEVER automatically promoted to the Organisation Library
 */

import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  knowledgeSourcesTable,
  knowledgeSourceScopesTable,
  knowledgeSourceVersionsTable,
  type KnowledgeSource,
  type KnowledgeSourceVersion,
  type KnowledgeSourceScopeRecord,
  KNOWLEDGE_SOURCE_STATUSES,
  KNOWLEDGE_SOURCE_TYPES,
  KNOWLEDGE_AUTHORITY_LEVELS,
  KNOWLEDGE_SENSITIVITY_LEVELS,
  KNOWLEDGE_SOURCE_SCOPES,
  KNOWLEDGE_SCOPE_TYPES,
  type KnowledgeSourceStatus,
  type KnowledgeScopeType,
} from "@workspace/db";
import { eq, and, desc, isNull, ne, not } from "drizzle-orm";
import { logOrgEvent } from "./auditService.js";
import { enqueueCurationJobAsync } from "./knowledgeCurationService.js";
import { getIngestionQueue } from "../lib/ingestionQueue/index.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CompleteUploadInput {
  /** sourceId returned by requestUploadUrl */
  sourceId: string;
  organizationId: string;
  uploadedByUserId: string;
  /** Metadata about the knowledge asset */
  title: string;
  description?: string;
  sourceType: string;
  language?: string;
  authorityLevel?: string;
  sensitivityClassification?: string;
  effectiveFrom?: Date;
  effectiveTo?: Date;
  versionLabel?: string;
  sourceScope?: "library" | "task";
  taskId?: string;
  /** From requestUploadUrl */
  storageKey: string;
  storageProvider: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
}

export interface UpdateSourceMetadataInput {
  title?: string;
  description?: string;
  sourceType?: string;
  language?: string;
  authorityLevel?: string;
  sensitivityClassification?: string;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
  versionLabel?: string;
}

export interface AssignScopeInput {
  knowledgeSourceId: string;
  organizationId: string;
  scopeType: string;
  scopeId: string;
  actorUserId: string;
}

export interface ReplaceVersionInput {
  knowledgeSourceId: string;
  organizationId: string;
  uploadedByUserId: string;
  versionLabel?: string;
  storageKey: string;
  storageProvider: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
}

export class KnowledgeSourceError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "KnowledgeSourceError";
    this.code = code;
    Object.setPrototypeOf(this, KnowledgeSourceError.prototype);
  }
}

// ─── Validation helpers ───────────────────────────────────────────────────────

function validateSourceType(t: string): void {
  if (!KNOWLEDGE_SOURCE_TYPES.includes(t as never)) {
    throw new KnowledgeSourceError(
      `Invalid sourceType "${t}". Must be one of: ${KNOWLEDGE_SOURCE_TYPES.join(", ")}`,
      "INVALID_SOURCE_TYPE",
    );
  }
}

function validateScopeType(t: string): void {
  if (!KNOWLEDGE_SCOPE_TYPES.includes(t as never)) {
    throw new KnowledgeSourceError(
      `Invalid scopeType "${t}". Must be one of: ${KNOWLEDGE_SCOPE_TYPES.join(", ")}`,
      "INVALID_SCOPE_TYPE",
    );
  }
}

// ─── Duplicate checksum detection ────────────────────────────────────────────

export async function findDuplicateChecksum(
  organizationId: string,
  checksum: string,
  excludeSourceId?: string,
): Promise<KnowledgeSource | null> {
  const rows = await db
    .select()
    .from(knowledgeSourcesTable)
    .where(
      and(
        eq(knowledgeSourcesTable.organizationId, organizationId),
        eq(knowledgeSourcesTable.checksum, checksum),
        isNull(knowledgeSourcesTable.deletedAt),
        ...(excludeSourceId ? [ne(knowledgeSourcesTable.id, excludeSourceId)] : []),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

// ─── Complete upload (create source + initial version) ───────────────────────

/**
 * Step 2 of the upload flow.
 * Called after the client has successfully uploaded the file to GCS.
 * Creates the knowledge_source record and initial knowledge_source_version.
 *
 * Performs duplicate checksum detection — returns the existing sourceId
 * if a duplicate is found (idempotent completion).
 */
export async function completeUpload(input: CompleteUploadInput): Promise<{
  source: KnowledgeSource;
  version: KnowledgeSourceVersion;
  isDuplicate: boolean;
}> {
  // Validate inputs
  validateSourceType(input.sourceType);

  const authorityLevel = KNOWLEDGE_AUTHORITY_LEVELS.includes(input.authorityLevel as never)
    ? input.authorityLevel!
    : "supporting";

  const sensitivity = KNOWLEDGE_SENSITIVITY_LEVELS.includes(
    input.sensitivityClassification as never,
  )
    ? input.sensitivityClassification!
    : "internal";

  const scope = KNOWLEDGE_SOURCE_SCOPES.includes(input.sourceScope as never)
    ? input.sourceScope!
    : "library";

  // Duplicate detection
  const duplicate = await findDuplicateChecksum(
    input.organizationId,
    input.checksum,
    input.sourceId,
  );
  if (duplicate) {
    const existingVersion = await getCurrentVersion(duplicate.id, input.organizationId);
    return {
      source: duplicate,
      version: existingVersion!,
      isDuplicate: true,
    };
  }

  const versionId = randomUUID();
  const versionLabel = input.versionLabel ?? "v1";

  // Create source record
  const [source] = await db
    .insert(knowledgeSourcesTable)
    .values({
      id: input.sourceId,
      organizationId: input.organizationId,
      sourceScope: scope,
      taskId: input.taskId ?? null,
      title: input.title.trim().slice(0, 500),
      description: input.description?.trim().slice(0, 2000) ?? null,
      sourceType: input.sourceType,
      originalFileName: input.originalFileName,
      mimeType: input.mimeType,
      storageProvider: input.storageProvider,
      storageKey: input.storageKey,
      checksum: input.checksum,
      fileSize: input.fileSize,
      language: input.language ?? "en",
      status: "uploaded",
      authorityLevel,
      sensitivityClassification: sensitivity,
      effectiveFrom: input.effectiveFrom ?? null,
      effectiveTo: input.effectiveTo ?? null,
      versionLabel,
      isCurrent: true,
      uploadedByUserId: input.uploadedByUserId,
    })
    .returning();

  // Create initial version record
  const [version] = await db
    .insert(knowledgeSourceVersionsTable)
    .values({
      id: versionId,
      knowledgeSourceId: input.sourceId,
      organizationId: input.organizationId,
      versionLabel,
      checksum: input.checksum,
      storageKey: input.storageKey,
      storageProvider: input.storageProvider,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      originalFileName: input.originalFileName,
      isCurrent: true,
      status: "uploaded",
      uploadedByUserId: input.uploadedByUserId,
      ingestionStatus: "pending",
      ingestionMetadata: {},
    })
    .returning();

  logOrgEvent({
    eventType: "knowledge.source.uploaded",
    organizationId: input.organizationId,
    actorUserId: input.uploadedByUserId,
    resourceType: "knowledge_source",
    resourceId: input.sourceId,
    metadata: {
      sourceType: input.sourceType,
      sourceScope: scope,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      versionLabel,
    },
  }).catch(() => {});

  return { source: source!, version: version!, isDuplicate: false };
}

// ─── List ─────────────────────────────────────────────────────────────────────

export interface ListSourcesParams {
  organizationId: string;
  sourceScope?: "library" | "task";
  taskId?: string;
  status?: KnowledgeSourceStatus[];
  sourceType?: string;
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
}

export async function listKnowledgeSources(
  params: ListSourcesParams,
): Promise<{ sources: KnowledgeSource[]; total: number }> {
  const {
    organizationId,
    sourceScope,
    taskId,
    status,
    sourceType,
    limit = 50,
    offset = 0,
    includeDeleted = false,
  } = params;

  const conditions = [eq(knowledgeSourcesTable.organizationId, organizationId)];

  if (!includeDeleted) conditions.push(isNull(knowledgeSourcesTable.deletedAt));
  if (sourceScope) conditions.push(eq(knowledgeSourcesTable.sourceScope, sourceScope));
  if (taskId) conditions.push(eq(knowledgeSourcesTable.taskId!, taskId));
  if (sourceType) conditions.push(eq(knowledgeSourcesTable.sourceType, sourceType));

  const rows = await db
    .select()
    .from(knowledgeSourcesTable)
    .where(and(...conditions))
    .orderBy(desc(knowledgeSourcesTable.createdAt))
    .limit(Math.min(limit, 200))
    .offset(offset);

  // Filter by status in memory (avoids complex SQL for small sets)
  const filtered = status?.length ? rows.filter((r) => status.includes(r.status as KnowledgeSourceStatus)) : rows;

  return { sources: filtered, total: filtered.length };
}

// ─── Get single source ────────────────────────────────────────────────────────

export async function getKnowledgeSource(
  sourceId: string,
  organizationId: string,
): Promise<KnowledgeSource | null> {
  const [row] = await db
    .select()
    .from(knowledgeSourcesTable)
    .where(
      and(
        eq(knowledgeSourcesTable.id, sourceId),
        eq(knowledgeSourcesTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

// ─── Update metadata ──────────────────────────────────────────────────────────

export async function updateSourceMetadata(
  sourceId: string,
  organizationId: string,
  actorUserId: string,
  input: UpdateSourceMetadataInput,
): Promise<KnowledgeSource> {
  const source = await getKnowledgeSource(sourceId, organizationId);
  if (!source) throw new KnowledgeSourceError("Knowledge source not found.", "NOT_FOUND");
  if (source.deletedAt) throw new KnowledgeSourceError("Cannot update a deleted source.", "DELETED");
  if (source.status === "revoked") {
    throw new KnowledgeSourceError("Cannot update a revoked source.", "REVOKED");
  }

  if (input.sourceType) validateSourceType(input.sourceType);

  const updates: Partial<KnowledgeSource> = { updatedAt: new Date() };
  if (input.title) updates.title = input.title.trim().slice(0, 500);
  if (input.description !== undefined)
    updates.description = input.description?.trim().slice(0, 2000) ?? null;
  if (input.sourceType) updates.sourceType = input.sourceType;
  if (input.language) updates.language = input.language;
  if (input.authorityLevel && KNOWLEDGE_AUTHORITY_LEVELS.includes(input.authorityLevel as never))
    updates.authorityLevel = input.authorityLevel;
  if (
    input.sensitivityClassification &&
    KNOWLEDGE_SENSITIVITY_LEVELS.includes(input.sensitivityClassification as never)
  )
    updates.sensitivityClassification = input.sensitivityClassification;
  if (input.effectiveFrom !== undefined) updates.effectiveFrom = input.effectiveFrom;
  if (input.effectiveTo !== undefined) updates.effectiveTo = input.effectiveTo;
  if (input.versionLabel) updates.versionLabel = input.versionLabel;

  const [updated] = await db
    .update(knowledgeSourcesTable)
    .set(updates)
    .where(
      and(
        eq(knowledgeSourcesTable.id, sourceId),
        eq(knowledgeSourcesTable.organizationId, organizationId),
      ),
    )
    .returning();

  logOrgEvent({
    eventType: "knowledge.source.updated",
    organizationId,
    actorUserId,
    resourceType: "knowledge_source",
    resourceId: sourceId,
    metadata: { fields: Object.keys(input) },
  }).catch(() => {});

  return updated!;
}

// ─── Approve ──────────────────────────────────────────────────────────────────

export async function approveKnowledgeSource(
  sourceId: string,
  organizationId: string,
  approvedByUserId: string,
): Promise<KnowledgeSource> {
  const source = await getKnowledgeSource(sourceId, organizationId);
  if (!source) throw new KnowledgeSourceError("Knowledge source not found.", "NOT_FOUND");
  if (source.deletedAt) throw new KnowledgeSourceError("Cannot approve a deleted source.", "DELETED");
  if (source.status === "revoked")
    throw new KnowledgeSourceError("Cannot approve a revoked source.", "REVOKED");

  const [updated] = await db
    .update(knowledgeSourcesTable)
    .set({
      status: "approved",
      approvedByUserId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(knowledgeSourcesTable.id, sourceId),
        eq(knowledgeSourcesTable.organizationId, organizationId),
      ),
    )
    .returning();

  // Mirror approval on the current version
  await db
    .update(knowledgeSourceVersionsTable)
    .set({ status: "approved", approvedByUserId, approvedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(knowledgeSourceVersionsTable.knowledgeSourceId, sourceId),
        eq(knowledgeSourceVersionsTable.organizationId, organizationId),
        eq(knowledgeSourceVersionsTable.isCurrent, true),
      ),
    );

  logOrgEvent({
    eventType: "knowledge.source.approved",
    organizationId,
    actorUserId: approvedByUserId,
    resourceType: "knowledge_source",
    resourceId: sourceId,
  }).catch(() => {});

  // Sprint 21: trigger knowledge curation (fire-and-forget)
  getCurrentVersion(sourceId, organizationId).then(version => {
    if (version) {
      enqueueCurationJobAsync({
        organizationId,
        knowledgeSourceId: sourceId,
        sourceVersionId:   version.id,
        triggerEvent:      "approved",
        actorUserId:       approvedByUserId,
      });
    }
  }).catch(() => {});

  return updated!;
}

// ─── Revoke ───────────────────────────────────────────────────────────────────

export async function revokeKnowledgeSource(
  sourceId: string,
  organizationId: string,
  actorUserId: string,
  reason?: string,
): Promise<KnowledgeSource> {
  const source = await getKnowledgeSource(sourceId, organizationId);
  if (!source) throw new KnowledgeSourceError("Knowledge source not found.", "NOT_FOUND");
  if (source.status === "revoked")
    throw new KnowledgeSourceError("Source is already revoked.", "ALREADY_REVOKED");

  const [updated] = await db
    .update(knowledgeSourcesTable)
    .set({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(knowledgeSourcesTable.id, sourceId),
        eq(knowledgeSourcesTable.organizationId, organizationId),
      ),
    )
    .returning();

  logOrgEvent({
    eventType: "knowledge.source.revoked",
    organizationId,
    actorUserId,
    resourceType: "knowledge_source",
    resourceId: sourceId,
    isSensitive: true,
    metadata: { reason: reason?.slice(0, 500) },
  }).catch(() => {});

  // Sprint 21: trigger curation job to retire any related proposals
  getCurrentVersion(sourceId, organizationId).then(version => {
    if (version) {
      enqueueCurationJobAsync({
        organizationId,
        knowledgeSourceId: sourceId,
        sourceVersionId:   version.id,
        triggerEvent:      "archived",
        actorUserId,
      });
    }
  }).catch(() => {});

  return updated!;
}

// ─── Soft delete ──────────────────────────────────────────────────────────────

export async function deleteKnowledgeSource(
  sourceId: string,
  organizationId: string,
  actorUserId: string,
): Promise<void> {
  const source = await getKnowledgeSource(sourceId, organizationId);
  if (!source) throw new KnowledgeSourceError("Knowledge source not found.", "NOT_FOUND");
  if (source.deletedAt) throw new KnowledgeSourceError("Source is already deleted.", "ALREADY_DELETED");

  await db
    .update(knowledgeSourcesTable)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(knowledgeSourcesTable.id, sourceId),
        eq(knowledgeSourcesTable.organizationId, organizationId),
      ),
    );

  logOrgEvent({
    eventType: "knowledge.source.deleted",
    organizationId,
    actorUserId,
    resourceType: "knowledge_source",
    resourceId: sourceId,
    isSensitive: true,
  }).catch(() => {});
}

// ─── Supersede ────────────────────────────────────────────────────────────────

/**
 * Mark an existing source as superseded by a newer source.
 * Both records must belong to the same organisation.
 */
export async function supersedeKnowledgeSource(
  oldSourceId: string,
  newSourceId: string,
  organizationId: string,
  actorUserId: string,
): Promise<void> {
  const [oldSource, newSource] = await Promise.all([
    getKnowledgeSource(oldSourceId, organizationId),
    getKnowledgeSource(newSourceId, organizationId),
  ]);

  if (!oldSource) throw new KnowledgeSourceError("Source to supersede not found.", "NOT_FOUND");
  if (!newSource) throw new KnowledgeSourceError("Superseding source not found.", "NEW_SOURCE_NOT_FOUND");
  if (oldSource.deletedAt)
    throw new KnowledgeSourceError("Cannot supersede a deleted source.", "DELETED");
  if (oldSource.status === "revoked")
    throw new KnowledgeSourceError("Cannot supersede a revoked source.", "REVOKED");
  if (oldSourceId === newSourceId)
    throw new KnowledgeSourceError("A source cannot supersede itself.", "SELF_SUPERSEDE");

  await db
    .update(knowledgeSourcesTable)
    .set({
      status: "superseded",
      isCurrent: false,
      supersededBySourceId: newSourceId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(knowledgeSourcesTable.id, oldSourceId),
        eq(knowledgeSourcesTable.organizationId, organizationId),
      ),
    );

  logOrgEvent({
    eventType: "knowledge.source.superseded",
    organizationId,
    actorUserId,
    resourceType: "knowledge_source",
    resourceId: oldSourceId,
    metadata: { supersededBySourceId: newSourceId },
  }).catch(() => {});

  // Sprint 21: trigger version intelligence curation on new source
  // Sprint 27.3: also enqueue ingestion so new content is indexed immediately
  getCurrentVersion(newSourceId, organizationId).then(newVersion => {
    getCurrentVersion(oldSourceId, organizationId).then(oldVersion => {
      if (newVersion) {
        // Curation: review the quality / freshness of existing chunks
        enqueueCurationJobAsync({
          organizationId,
          knowledgeSourceId:  newSourceId,
          sourceVersionId:    newVersion.id,
          previousVersionId:  oldVersion?.id,
          triggerEvent:       "superseded",
          actorUserId,
        });
        // Ingestion: extract, chunk and embed the new source content
        getIngestionQueue().enqueue({
          organizationId,
          knowledgeSourceId:  newSourceId,
          sourceVersionId:    newVersion.id,
          actorUserId,
        }).catch(err => {
          console.error(
            `[knowledgeSourceService] Failed to enqueue ingestion after supersede ` +
            `(newSourceId=${newSourceId}, versionId=${newVersion.id}):`,
            err,
          );
        });
      }
    }).catch(() => {});
  }).catch(() => {});
}

// ─── Version management ───────────────────────────────────────────────────────

export async function getCurrentVersion(
  knowledgeSourceId: string,
  organizationId: string,
): Promise<KnowledgeSourceVersion | null> {
  const [row] = await db
    .select()
    .from(knowledgeSourceVersionsTable)
    .where(
      and(
        eq(knowledgeSourceVersionsTable.knowledgeSourceId, knowledgeSourceId),
        eq(knowledgeSourceVersionsTable.organizationId, organizationId),
        eq(knowledgeSourceVersionsTable.isCurrent, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listVersionHistory(
  knowledgeSourceId: string,
  organizationId: string,
): Promise<KnowledgeSourceVersion[]> {
  return db
    .select()
    .from(knowledgeSourceVersionsTable)
    .where(
      and(
        eq(knowledgeSourceVersionsTable.knowledgeSourceId, knowledgeSourceId),
        eq(knowledgeSourceVersionsTable.organizationId, organizationId),
      ),
    )
    .orderBy(desc(knowledgeSourceVersionsTable.createdAt));
}

/**
 * Replace the current version with a new one.
 * Transactional: old version is demoted atomically with new version promotion.
 * Old version is retained for audit — it is never deleted.
 */
export async function replaceSourceVersion(
  input: ReplaceVersionInput & { actorUserId: string },
): Promise<{ newVersion: KnowledgeSourceVersion; oldVersion: KnowledgeSourceVersion | null }> {
  const source = await getKnowledgeSource(input.knowledgeSourceId, input.organizationId);
  if (!source) throw new KnowledgeSourceError("Knowledge source not found.", "NOT_FOUND");
  if (source.deletedAt) throw new KnowledgeSourceError("Cannot version a deleted source.", "DELETED");
  if (source.status === "revoked")
    throw new KnowledgeSourceError("Cannot version a revoked source.", "REVOKED");

  const oldVersion = await getCurrentVersion(input.knowledgeSourceId, input.organizationId);
  const newVersionId = randomUUID();

  // Determine new version label
  let newVersionLabel = input.versionLabel;
  if (!newVersionLabel) {
    // Auto-increment: v1 → v2 → v3 etc.
    const allVersions = await listVersionHistory(input.knowledgeSourceId, input.organizationId);
    newVersionLabel = `v${allVersions.length + 1}`;
  }

  // Transactional version swap
  await db.transaction(async (tx) => {
    // 1. Demote old current version
    if (oldVersion) {
      await tx
        .update(knowledgeSourceVersionsTable)
        .set({
          isCurrent: false,
          status: "superseded",
          supersededById: newVersionId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(knowledgeSourceVersionsTable.id, oldVersion.id),
            eq(knowledgeSourceVersionsTable.organizationId, input.organizationId),
          ),
        );
    }

    // 2. Insert new current version
    await tx.insert(knowledgeSourceVersionsTable).values({
      id: newVersionId,
      knowledgeSourceId: input.knowledgeSourceId,
      organizationId: input.organizationId,
      versionLabel: newVersionLabel!,
      checksum: input.checksum,
      storageKey: input.storageKey,
      storageProvider: input.storageProvider,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      originalFileName: input.originalFileName,
      isCurrent: true,
      status: "uploaded",
      uploadedByUserId: input.uploadedByUserId,
      ingestionStatus: "pending",
      ingestionMetadata: {},
    });

    // 3. Update parent source record — storage fields only.
    //    Approval status is intentionally NOT reset: replacing a version of an
    //    already-approved policy document does not revoke its approval. The new
    //    content must be re-ingested, but the document remains visible to the
    //    execution pipeline during that window. If the org admin decides the new
    //    content requires re-review, they can explicitly revoke or archive it.
    await tx
      .update(knowledgeSourcesTable)
      .set({
        versionLabel: newVersionLabel,
        checksum: input.checksum,
        storageKey: input.storageKey,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        originalFileName: input.originalFileName,
        // status: intentionally omitted — preserve existing approval state
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(knowledgeSourcesTable.id, input.knowledgeSourceId),
          eq(knowledgeSourcesTable.organizationId, input.organizationId),
        ),
      );
  });

  const [newVersion] = await db
    .select()
    .from(knowledgeSourceVersionsTable)
    .where(eq(knowledgeSourceVersionsTable.id, newVersionId))
    .limit(1);

  logOrgEvent({
    eventType: "knowledge.source.version_replaced",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    resourceType: "knowledge_source",
    resourceId: input.knowledgeSourceId,
    metadata: {
      oldVersionId: oldVersion?.id ?? null,
      newVersionId,
      oldVersionLabel: oldVersion?.versionLabel,
      newVersionLabel,
    },
  }).catch(() => {});

  // ── Automatically enqueue ingestion for the new version ───────────────────
  // Ingestion extracts text, chunks, and embeds the new content so it becomes
  // available to hybridRetrievalService and the KnowledgeResolutionService.
  // This fires-and-forgets: a failure here must never abort the version swap.
  // newVersionId is computed via randomUUID() earlier in this function —
  // use it directly rather than newVersion!.id to avoid a null-access if the
  // post-transaction SELECT returns no rows (e.g. in test environments).
  getIngestionQueue().enqueue({
    organizationId:    input.organizationId,
    knowledgeSourceId: input.knowledgeSourceId,
    sourceVersionId:   newVersionId,
    actorUserId:       input.actorUserId,
  }).catch(err => {
    console.error(
      `[knowledgeSourceService] Failed to enqueue ingestion after version replacement ` +
      `(sourceId=${input.knowledgeSourceId}, versionId=${newVersionId}):`,
      err,
    );
  });

  return { newVersion: newVersion!, oldVersion };
}

/**
 * Mark a version for re-ingestion by Task #16.
 * Sets ingestionStatus back to 'pending' so the extraction pipeline picks it up.
 */
export async function markVersionForReprocess(
  knowledgeSourceId: string,
  organizationId: string,
  actorUserId: string,
): Promise<void> {
  const current = await getCurrentVersion(knowledgeSourceId, organizationId);
  if (!current) throw new KnowledgeSourceError("No current version found.", "NO_CURRENT_VERSION");

  await db
    .update(knowledgeSourceVersionsTable)
    .set({ ingestionStatus: "pending", ingestionMetadata: {}, updatedAt: new Date() })
    .where(eq(knowledgeSourceVersionsTable.id, current.id));

  // Reset the parent source status to uploaded so it re-enters the pipeline
  await db
    .update(knowledgeSourcesTable)
    .set({ status: "uploaded", updatedAt: new Date() })
    .where(
      and(
        eq(knowledgeSourcesTable.id, knowledgeSourceId),
        eq(knowledgeSourcesTable.organizationId, organizationId),
      ),
    );

  logOrgEvent({
    eventType: "knowledge.source.reprocess_requested",
    organizationId,
    actorUserId,
    resourceType: "knowledge_source",
    resourceId: knowledgeSourceId,
    metadata: { versionId: current.id },
  }).catch(() => {});
}

// ─── Scope management ─────────────────────────────────────────────────────────

export async function assignScope(input: AssignScopeInput): Promise<KnowledgeSourceScopeRecord> {
  const source = await getKnowledgeSource(input.knowledgeSourceId, input.organizationId);
  if (!source) throw new KnowledgeSourceError("Knowledge source not found.", "NOT_FOUND");
  if (source.sourceScope === "task") {
    throw new KnowledgeSourceError(
      "Task-scoped sources cannot have explicit scope assignments. " +
        "Promote to library first.",
      "TASK_SCOPE_CONFLICT",
    );
  }
  validateScopeType(input.scopeType);

  // Upsert: if duplicate, return existing
  const existing = await db
    .select()
    .from(knowledgeSourceScopesTable)
    .where(
      and(
        eq(knowledgeSourceScopesTable.knowledgeSourceId, input.knowledgeSourceId),
        eq(knowledgeSourceScopesTable.scopeType, input.scopeType),
        eq(knowledgeSourceScopesTable.scopeId, input.scopeId),
      ),
    )
    .limit(1);

  if (existing[0]) return existing[0];

  const [scope] = await db
    .insert(knowledgeSourceScopesTable)
    .values({
      id: randomUUID(),
      knowledgeSourceId: input.knowledgeSourceId,
      organizationId: input.organizationId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
    })
    .returning();

  logOrgEvent({
    eventType: "knowledge.source.scope_assigned",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    resourceType: "knowledge_source",
    resourceId: input.knowledgeSourceId,
    metadata: { scopeType: input.scopeType, scopeId: input.scopeId },
  }).catch(() => {});

  return scope!;
}

export async function removeScope(
  knowledgeSourceId: string,
  organizationId: string,
  scopeType: string,
  scopeId: string,
  actorUserId: string,
): Promise<void> {
  validateScopeType(scopeType);

  await db
    .delete(knowledgeSourceScopesTable)
    .where(
      and(
        eq(knowledgeSourceScopesTable.knowledgeSourceId, knowledgeSourceId),
        eq(knowledgeSourceScopesTable.organizationId, organizationId),
        eq(knowledgeSourceScopesTable.scopeType, scopeType),
        eq(knowledgeSourceScopesTable.scopeId, scopeId),
      ),
    );

  logOrgEvent({
    eventType: "knowledge.source.scope_removed",
    organizationId,
    actorUserId,
    resourceType: "knowledge_source",
    resourceId: knowledgeSourceId,
    metadata: { scopeType, scopeId },
  }).catch(() => {});
}

export async function listScopes(
  knowledgeSourceId: string,
  organizationId: string,
): Promise<KnowledgeSourceScopeRecord[]> {
  return db
    .select()
    .from(knowledgeSourceScopesTable)
    .where(
      and(
        eq(knowledgeSourceScopesTable.knowledgeSourceId, knowledgeSourceId),
        eq(knowledgeSourceScopesTable.organizationId, organizationId),
      ),
    );
}
