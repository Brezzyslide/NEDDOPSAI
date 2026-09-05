/**
 * Completed Work Service — Sprint 22 (Work Execution Engine & Completed Work)
 *
 * Manages the full lifecycle of Completed Work items — the permanent record
 * of every professional output produced by the AI Workforce.
 *
 * Lifecycle: draft → awaiting_approval → approved
 *                  ↘ rejected → reopened → awaiting_approval
 *            approved → archived | superseded
 *
 * Promote-to-Library: approved Completed Work may be promoted into the
 * Organisation Library as approved_example, template, policy, or procedure.
 */

import { randomUUID } from "crypto";
import { db, withSystemTenantContext } from "@workspace/db";
import {
  completedWorkTable,
  completedWorkVersionsTable,
  completedWorkCommentsTable,
  completedWorkAssetsTable,
  workPackageManifestsTable,
  knowledgeSourcesTable,
  COMPLETED_WORK_STATUSES,
  type CompletedWorkStatus,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { logOrgEvent } from "./auditService.js";
import type { ReviewResult } from "./selfReviewService.js";
import type { WorkPackageManifest } from "./workPackageService.js";
import { findUnconfirmedCarePlanProtectiveStrategies } from "./carePlanBehaviourStrategyService.js";

type DbClient = typeof db;

function withCompletedWorkTenant<T>(
  organizationId: string,
  purpose: string,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  return withSystemTenantContext(
    { tenantId: organizationId, serviceIdentity: "completed_work_service", purpose },
    fn,
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateDraftInput {
  organizationId: string;
  conversationId?: string;
  blueprintId?: string;
  blueprintVersion?: string | null;
  blueprintContentHash?: string | null;
  blueprintProvenanceStatus?: string | null;
  blueprintFamily?: string | null;
  blueprintMode?: string | null;
  canonicalIntent?: string | null;
  manifestId?: string;
  primarySpecialist: string;
  title: string;
  outputType: string;
  contentMarkdown: string;
  reviewResult?: ReviewResult;
  createdByUserId: string;
  assetIds?: Array<{
    assetId: string;
    assetType: "library_source" | "memory" | "template" | "example" | "task_upload";
    role?: "primary" | "supporting" | "citation" | "style" | "template";
    citationRef?: string;
  }>;
  artifactRequired?: boolean;
  artifactState?: string | null;
  artifactId?: string | null;
}

export interface CompletedWorkItem {
  id: string;
  organizationId: string;
  conversationId: string | null;
  blueprintId: string | null;
  blueprintVersion: string | null;
  blueprintContentHash: string | null;
  blueprintProvenanceStatus: string;
  blueprintFamily: string | null;
  blueprintMode: string | null;
  canonicalIntent: string | null;
  manifestId: string | null;
  primarySpecialist: string;
  title: string;
  outputType: string;
  status: CompletedWorkStatus;
  currentVersionId: string | null;
  /**
   * The version that was pinned at the moment of approval.
   * Set by approve() and never mutated by addVersion(), reopen(), or restore.
   * Export and viewer resolve to this version when status is "approved".
   * Null for legacy rows created before this field existed.
   */
  approvedVersionId: string | null;
  artifactState: string | null;
  artifactRequired: boolean;
  artifactId: string | null;
  createdByUserId: string;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  archivedAt: Date | null;
  reopenedAt: Date | null;
  supersededById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompletedWorkVersion {
  id: string;
  completedWorkId: string;
  organizationId: string;
  versionNumber: number;
  contentMarkdown: string | null;
  qualityScore: number | null;
  reviewDimensions: unknown[];
  changeNote: string | null;
  isAutoRevision: string;
  createdByUserId: string | null;
  createdAt: Date;
}

export interface CompletedWorkListFilters {
  status?: CompletedWorkStatus;
  primarySpecialist?: string;
  outputType?: string;
  conversationId?: string;
  limit?: number;
  offset?: number;
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createDraft(input: CreateDraftInput): Promise<CompletedWorkItem> {
  const id = randomUUID();
  const versionId = randomUUID();
  const now = new Date();

  // Parent + first version are written atomically.
  // Parent MUST be inserted before the version — completed_work_versions.completed_work_id
  // carries a FK reference to completed_work.id (onDelete: cascade). Inserting the version
  // first causes an immediate FK violation (PostgreSQL error 23503).
  // On any failure the transaction rolls back both writes — no orphaned rows.
  await withCompletedWorkTenant(input.organizationId, "completed_work.create", async (client) => {
    await client.transaction(async (tx) => {
      // ── 1. Parent row (must exist before version FK can resolve) ───────────
      await tx.insert(completedWorkTable).values({
        id,
        organizationId: input.organizationId,
        conversationId: input.conversationId ?? null,
        blueprintId: input.blueprintId ?? null,
        blueprintVersion: input.blueprintVersion ?? null,
        blueprintContentHash: input.blueprintContentHash ?? null,
        blueprintProvenanceStatus: input.blueprintProvenanceStatus ?? (
          input.blueprintContentHash ? "hash_pinned" : "provenance_unverified"
        ),
        blueprintFamily: input.blueprintFamily ?? null,
        blueprintMode: input.blueprintMode ?? null,
        canonicalIntent: input.canonicalIntent ?? null,
        manifestId: input.manifestId ?? null,
        primarySpecialist: input.primarySpecialist,
        title: input.title,
        outputType: input.outputType,
        status: "draft",
        currentVersionId: versionId,
        approvalWorkflow: {},
        artifactState: input.artifactState ?? null,
        artifactRequired: input.artifactRequired ?? false,
        artifactId: input.artifactId ?? null,
        createdByUserId: input.createdByUserId,
        approvedByUserId: null,
        approvedAt: null,
        rejectedAt: null,
        archivedAt: null,
        reopenedAt: null,
        supersededById: null,
        createdAt: now,
        updatedAt: now,
      });

      // ── 2. Initial version (FK now satisfiable) ─────────────────────────────
      await tx.insert(completedWorkVersionsTable).values({
        id: versionId,
        completedWorkId: id,
        organizationId: input.organizationId,
        versionNumber: 1,
        contentMarkdown: input.contentMarkdown,
        qualityScore: input.reviewResult?.qualityScore ?? null,
        reviewDimensions: input.reviewResult?.dimensions ?? [],
        changeNote: "Initial draft",
        isAutoRevision: input.reviewResult?.revised ? "true" : "false",
        createdByUserId: input.createdByUserId,
        createdAt: now,
      });
    });

    if (input.manifestId) {
      await client
        .update(workPackageManifestsTable)
        .set({ completedWorkId: id })
        .where(eq(workPackageManifestsTable.id, input.manifestId));
    }

    if (input.assetIds && input.assetIds.length > 0) {
      const assetRows = input.assetIds.map(a => ({
        id: randomUUID(),
        completedWorkId: id,
        organizationId: input.organizationId,
        assetType: a.assetType,
        assetId: a.assetId,
        role: a.role ?? "supporting",
        citationRef: a.citationRef ?? null,
        createdAt: now,
      }));
      await client.insert(completedWorkAssetsTable).values(assetRows);
    }
  });

  await logOrgEvent({
    organizationId: input.organizationId,
    actorUserId: input.createdByUserId,
    eventType: "completed_work_created",
    resourceType: "completed_work",
    resourceId: id,
    metadata: { title: input.title, outputType: input.outputType, specialist: input.primarySpecialist },
  });

  const created = await getCompletedWork(id, input.organizationId);
  if (!created) throw new Error("Completed work not found after creation");
  return created;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getCompletedWork(
  id: string,
  organizationId: string,
): Promise<CompletedWorkItem | null> {
  const rows = await withCompletedWorkTenant(organizationId, "completed_work.get", async (client) => client
    .select()
    .from(completedWorkTable)
    .where(
      and(
        eq(completedWorkTable.id, id),
        eq(completedWorkTable.organizationId, organizationId),
      )
    )
    .limit(1));

  const row = rows[0];
  if (!row) return null;
  return mapRow(row);
}

export async function listCompletedWork(
  organizationId: string,
  filters: CompletedWorkListFilters = {},
): Promise<CompletedWorkItem[]> {
  const { limit = 20, offset = 0 } = filters;

  const conditions = [eq(completedWorkTable.organizationId, organizationId)];
  if (filters.status) conditions.push(eq(completedWorkTable.status, filters.status));
  if (filters.primarySpecialist) conditions.push(eq(completedWorkTable.primarySpecialist, filters.primarySpecialist));
  if (filters.outputType) conditions.push(eq(completedWorkTable.outputType, filters.outputType));
  if (filters.conversationId) conditions.push(eq(completedWorkTable.conversationId, filters.conversationId));

  const rows = await withCompletedWorkTenant(organizationId, "completed_work.list", async (client) => client
    .select()
    .from(completedWorkTable)
    .where(and(...conditions))
    .orderBy(desc(completedWorkTable.createdAt))
    .limit(limit)
    .offset(offset));

  const items = rows.map(mapRow);

  // Batch-fetch latest quality score per item (one extra query, not N)
  if (items.length > 0) {
    const ids = items.map(i => i.id);
    const qualityRows = await withCompletedWorkTenant(organizationId, "completed_work.list.quality", async (client) => client
      .selectDistinctOn([completedWorkVersionsTable.completedWorkId], {
        completedWorkId: completedWorkVersionsTable.completedWorkId,
        qualityScore: completedWorkVersionsTable.qualityScore,
      })
      .from(completedWorkVersionsTable)
      .where(inArray(completedWorkVersionsTable.completedWorkId, ids))
      .orderBy(completedWorkVersionsTable.completedWorkId, desc(completedWorkVersionsTable.versionNumber)));

    const qualityMap = new Map<string, number | null>();
    for (const r of qualityRows) {
      qualityMap.set(r.completedWorkId, r.qualityScore ?? null);
    }
    return items.map(item => ({ ...item, latestQualityScore: qualityMap.get(item.id) ?? null }));
  }

  return items;
}

export async function getVersions(
  completedWorkId: string,
  organizationId: string,
): Promise<CompletedWorkVersion[]> {
  const rows = await withCompletedWorkTenant(organizationId, "completed_work.versions.list", async (client) => client
    .select()
    .from(completedWorkVersionsTable)
    .where(
      and(
        eq(completedWorkVersionsTable.completedWorkId, completedWorkId),
        eq(completedWorkVersionsTable.organizationId, organizationId),
      )
    )
    .orderBy(desc(completedWorkVersionsTable.versionNumber)));

  return rows.map(r => ({
    id: r.id,
    completedWorkId: r.completedWorkId,
    organizationId: r.organizationId,
    versionNumber: r.versionNumber,
    contentMarkdown: r.contentMarkdown ?? null,
    qualityScore: r.qualityScore ?? null,
    reviewDimensions: (r.reviewDimensions as unknown[]) ?? [],
    changeNote: r.changeNote ?? null,
    isAutoRevision: r.isAutoRevision ?? "false",
    createdByUserId: r.createdByUserId ?? null,
    createdAt: r.createdAt,
  }));
}

// ─── State transitions ────────────────────────────────────────────────────────

export async function submitForApproval(
  id: string,
  organizationId: string,
  actorUserId: string,
): Promise<CompletedWorkItem> {
  return transitionStatus(id, organizationId, "draft", "awaiting_approval", actorUserId, {
    eventType: "completed_work_submitted",
  });
}

export async function approve(
  id: string,
  organizationId: string,
  actorUserId: string,
): Promise<CompletedWorkItem> {
  // Pin the exact version that exists at the moment of signing.
  // Subsequent addVersion() / restore calls update currentVersionId but NEVER
  // touch approvedVersionId — the approval is permanently attached to this version.
  const versions = await getVersions(id, organizationId);
  const versionToPinId = versions[0]?.id ?? null;
  const work = await getCompletedWork(id, organizationId);
  if (!work) throw Object.assign(new Error("Completed work not found"), { statusCode: 404 });
  if (work.outputType === "care_plan") {
    const issues = findUnconfirmedCarePlanProtectiveStrategies(versions[0]?.contentMarkdown ?? "");
    if (issues.length > 0) {
      throw Object.assign(
        new Error(`Cannot approve care plan while protective strategies are unconfirmed: ${issues.map((issue) => issue.strategy).join(", ")}`),
        {
          statusCode: 400,
          details: issues,
        },
      );
    }
  }
  const approvedAt = new Date();

  return transitionStatus(id, organizationId, "awaiting_approval", "approved", actorUserId, {
    eventType: "completed_work_approved",
    extraUpdates: {
      approvedByUserId: actorUserId,
      approvedAt,
      approvedVersionId: versionToPinId,
    },
    // Audit metadata: must allow reconstruction of who/when/which-work/which-exact-version
    // without depending on the mutable current state of the completed_work row.
    metadata: {
      completedWorkId: id,
      approvedVersionId: versionToPinId,
      approvedByUserId: actorUserId,
      approvedAt: approvedAt.toISOString(),
    },
  });
}

/**
 * Canonical approved-version resolver — single source of truth for all callers.
 *
 * Three cases (must be kept in sync with the viewer and export service):
 *
 *   CASE 1 — Modern approved record (status === "approved", approvedVersionId !== null)
 *     Resolve the exact pinned version. Validate it belongs to this work item's version list.
 *     If it cannot be resolved → FAIL CLOSED with APPROVED_VERSION_INTEGRITY_ERROR.
 *     Never substitute versions[0] / latest / current.
 *
 *   CASE 2 — Legacy approved record (status === "approved", approvedVersionId === null)
 *     LEGACY_APPROVAL_FALLBACK: created before this column existed.
 *     Use versions[0] (latest). Explicitly distinguishable from Case 1.
 *
 *   CASE 3 — Non-approved work (any other status)
 *     Use versions[0] (current/latest). No pin applies.
 */
export function resolveApprovedVersion(
  work: Pick<CompletedWorkItem, "id" | "status" | "approvedVersionId">,
  versions: CompletedWorkVersion[],
): CompletedWorkVersion {
  if (versions.length === 0) {
    throw Object.assign(
      new Error("No versions available for this completed work item"),
      { statusCode: 400 },
    );
  }

  if (work.status === "approved" && work.approvedVersionId != null) {
    // CASE 1: Modern approved record — approvedVersionId is a non-null, non-undefined string.
    // Must resolve exactly (fail closed). Never substitute versions[0] / latest / current.
    const pinned = versions.find(v => v.id === work.approvedVersionId);
    if (!pinned) {
      throw Object.assign(
        new Error(
          `APPROVED_VERSION_INTEGRITY_ERROR: The approved version for completed work "${work.id}" ` +
          `cannot be resolved. This artefact must not be represented as approved content.`,
        ),
        { code: "APPROVED_VERSION_INTEGRITY_ERROR", statusCode: 409 },
      );
    }
    return pinned;
  }

  if (work.status === "approved" && work.approvedVersionId == null) {
    // CASE 2: LEGACY_APPROVAL_FALLBACK — null/undefined pin pre-dates this column.
    // Intentional backward compatibility. Do NOT treat as a broken modern pin.
    return versions[0]!;
  }

  // CASE 3: Non-approved work — use current/latest version
  return versions[0]!;
}

/**
 * Returns the exact version that was pinned at approval time.
 * For legacy rows (approvedVersionId is null), falls back to versions[0].
 * Returns null only when the work item or its versions cannot be found.
 * Throws APPROVED_VERSION_INTEGRITY_ERROR for modern rows with an unresolvable pin.
 */
export async function getApprovedVersion(
  id: string,
  organizationId: string,
): Promise<CompletedWorkVersion | null> {
  const [work, versions] = await Promise.all([
    getCompletedWork(id, organizationId),
    getVersions(id, organizationId),
  ]);
  if (!work || versions.length === 0) return null;
  return resolveApprovedVersion(work, versions);
}

export async function reject(
  id: string,
  organizationId: string,
  actorUserId: string,
  reason?: string,
): Promise<CompletedWorkItem> {
  return transitionStatus(id, organizationId, "awaiting_approval", "rejected", actorUserId, {
    eventType: "completed_work_rejected",
    extraUpdates: { rejectedAt: new Date() },
    metadata: reason ? { reason } : undefined,
  });
}

export async function archive(
  id: string,
  organizationId: string,
  actorUserId: string,
): Promise<CompletedWorkItem> {
  const existing = await getCompletedWork(id, organizationId);
  if (!existing) throw Object.assign(new Error("Completed work not found"), { statusCode: 404 });

  const ARCHIVABLE = new Set<CompletedWorkStatus>(["draft", "approved", "rejected", "reopened"]);
  if (!ARCHIVABLE.has(existing.status)) {
    throw Object.assign(
      new Error(`Cannot archive work in status "${existing.status}"`),
      { statusCode: 400 },
    );
  }

  const now = new Date();
  await withCompletedWorkTenant(organizationId, "completed_work.archive", async (client) => client
    .update(completedWorkTable)
    .set({ status: "archived", archivedAt: now, updatedAt: now })
    .where(and(eq(completedWorkTable.id, id), eq(completedWorkTable.organizationId, organizationId))));

  await logOrgEvent({
    organizationId,
    actorUserId,
    eventType: "completed_work_archived",
    resourceType: "completed_work",
    resourceId: id,
    metadata: { previousStatus: existing.status },
  });

  const updated = await getCompletedWork(id, organizationId);
  if (!updated) throw new Error("Completed work not found after archive");
  return updated;
}

export async function reopen(
  id: string,
  organizationId: string,
  actorUserId: string,
): Promise<CompletedWorkItem> {
  return transitionStatus(id, organizationId, "rejected", "reopened", actorUserId, {
    eventType: "completed_work_reopened",
    extraUpdates: { reopenedAt: new Date() },
  });
}

export async function supersedeByNewItem(
  id: string,
  newId: string,
  organizationId: string,
  actorUserId: string,
): Promise<CompletedWorkItem> {
  const existing = await getCompletedWork(id, organizationId);
  if (!existing) throw Object.assign(new Error("Completed work not found"), { statusCode: 404 });

  const now = new Date();
  await withCompletedWorkTenant(organizationId, "completed_work.supersede", async (client) => client
    .update(completedWorkTable)
    .set({ status: "superseded", supersededById: newId, updatedAt: now })
    .where(and(eq(completedWorkTable.id, id), eq(completedWorkTable.organizationId, organizationId))));

  await logOrgEvent({
    organizationId,
    actorUserId,
    eventType: "completed_work_superseded",
    resourceType: "completed_work",
    resourceId: id,
    metadata: { supersededById: newId },
  });

  const updated = await getCompletedWork(id, organizationId);
  if (!updated) throw new Error("Completed work not found after supersede");
  return updated;
}

// ─── Versioning ───────────────────────────────────────────────────────────────

export async function addVersion(
  id: string,
  organizationId: string,
  contentMarkdown: string,
  changeNote: string,
  actorUserId: string,
  reviewResult?: ReviewResult,
): Promise<CompletedWorkVersion> {
  const existing = await getCompletedWork(id, organizationId);
  if (!existing) throw Object.assign(new Error("Completed work not found"), { statusCode: 404 });

  const versions = await getVersions(id, organizationId);
  const nextVersion = (versions[0]?.versionNumber ?? 0) + 1;

  const versionId = randomUUID();
  const now = new Date();

  await withCompletedWorkTenant(organizationId, "completed_work.version.add", async (client) => {
    await client.insert(completedWorkVersionsTable).values({
      id: versionId,
      completedWorkId: id,
      organizationId,
      versionNumber: nextVersion,
      contentMarkdown,
      qualityScore: reviewResult?.qualityScore ?? null,
      reviewDimensions: reviewResult?.dimensions ?? [],
      changeNote,
      isAutoRevision: reviewResult?.revised ? "true" : "false",
      createdByUserId: actorUserId,
      createdAt: now,
    });

    await client
      .update(completedWorkTable)
      .set({ currentVersionId: versionId, updatedAt: now })
      .where(and(eq(completedWorkTable.id, id), eq(completedWorkTable.organizationId, organizationId)));
  });

  await logOrgEvent({
    organizationId,
    actorUserId,
    eventType: "completed_work_version_added",
    resourceType: "completed_work",
    resourceId: id,
    metadata: { versionNumber: nextVersion, changeNote },
  });

  return {
    id: versionId,
    completedWorkId: id,
    organizationId,
    versionNumber: nextVersion,
    contentMarkdown,
    qualityScore: reviewResult?.qualityScore ?? null,
    reviewDimensions: reviewResult?.dimensions ?? [],
    changeNote,
    isAutoRevision: reviewResult?.revised ? "true" : "false",
    createdByUserId: actorUserId,
    createdAt: now,
  };
}

// ─── Comments ─────────────────────────────────────────────────────────────────

export async function addComment(
  id: string,
  organizationId: string,
  content: string,
  authorUserId: string,
): Promise<void> {
  const existing = await getCompletedWork(id, organizationId);
  if (!existing) throw Object.assign(new Error("Completed work not found"), { statusCode: 404 });

  const commentId = randomUUID();
  await withCompletedWorkTenant(organizationId, "completed_work.comment.add", async (client) => client.insert(completedWorkCommentsTable).values({
      id: commentId,
      completedWorkId: id,
      organizationId,
      content,
      authorUserId,
      createdAt: new Date(),
    }));

  await logOrgEvent({
    organizationId,
    actorUserId: authorUserId,
    eventType: "completed_work_comment_added",
    resourceType: "completed_work",
    resourceId: id,
    metadata: {},
  });
}

export async function getComments(id: string, organizationId: string) {
  return withCompletedWorkTenant(organizationId, "completed_work.comments.list", async (client) => client
    .select()
    .from(completedWorkCommentsTable)
    .where(
      and(
        eq(completedWorkCommentsTable.completedWorkId, id),
        eq(completedWorkCommentsTable.organizationId, organizationId),
      )
    )
    .orderBy(desc(completedWorkCommentsTable.createdAt)));
}

// ─── Comment resolution (Sprint 25 Hardening) ────────────────────────────────

export async function resolveComment(
  commentId: string,
  workId: string,
  organizationId: string,
  actorUserId: string,
): Promise<void> {
  const rows = await withCompletedWorkTenant(organizationId, "completed_work.comment.resolve.get", async (client) => client
    .select()
    .from(completedWorkCommentsTable)
    .where(
      and(
        eq(completedWorkCommentsTable.id, commentId),
        eq(completedWorkCommentsTable.completedWorkId, workId),
        eq(completedWorkCommentsTable.organizationId, organizationId),
      )
    )
    .limit(1));

  const comment = rows[0];
  if (!comment) throw Object.assign(new Error("Comment not found"), { statusCode: 404 });
  if (comment.status === "resolved") throw Object.assign(new Error("Comment is already resolved"), { statusCode: 400 });

  await withCompletedWorkTenant(organizationId, "completed_work.comment.resolve", async (client) => client
    .update(completedWorkCommentsTable)
    .set({ status: "resolved", resolvedByUserId: actorUserId, resolvedAt: new Date() })
    .where(and(
      eq(completedWorkCommentsTable.id, commentId),
      eq(completedWorkCommentsTable.completedWorkId, workId),
      eq(completedWorkCommentsTable.organizationId, organizationId),
    )));

  await logOrgEvent({
    organizationId,
    actorUserId,
    eventType: "completed_work_comment_resolved" as any,
    resourceType: "completed_work_comment",
    resourceId: commentId,
    metadata: { workId },
  });
}

export async function reopenComment(
  commentId: string,
  workId: string,
  organizationId: string,
  actorUserId: string,
): Promise<void> {
  const rows = await withCompletedWorkTenant(organizationId, "completed_work.comment.reopen.get", async (client) => client
    .select()
    .from(completedWorkCommentsTable)
    .where(
      and(
        eq(completedWorkCommentsTable.id, commentId),
        eq(completedWorkCommentsTable.completedWorkId, workId),
        eq(completedWorkCommentsTable.organizationId, organizationId),
      )
    )
    .limit(1));

  const comment = rows[0];
  if (!comment) throw Object.assign(new Error("Comment not found"), { statusCode: 404 });
  if (comment.status === "open") throw Object.assign(new Error("Comment is already open"), { statusCode: 400 });

  await withCompletedWorkTenant(organizationId, "completed_work.comment.reopen", async (client) => client
    .update(completedWorkCommentsTable)
    .set({ status: "reopened", reopenedByUserId: actorUserId, reopenedAt: new Date() })
    .where(and(
      eq(completedWorkCommentsTable.id, commentId),
      eq(completedWorkCommentsTable.completedWorkId, workId),
      eq(completedWorkCommentsTable.organizationId, organizationId),
    )));

  await logOrgEvent({
    organizationId,
    actorUserId,
    eventType: "completed_work_comment_reopened" as any,
    resourceType: "completed_work_comment",
    resourceId: commentId,
    metadata: { workId },
  });
}

// ─── Promote to Organisation Library ─────────────────────────────────────────

export async function promoteToLibrary(
  id: string,
  organizationId: string,
  documentType: string,
  actorUserId: string,
): Promise<{ knowledgeSourceId: string }> {
  const existing = await getCompletedWork(id, organizationId);
  if (!existing) throw Object.assign(new Error("Completed work not found"), { statusCode: 404 });
  if (existing.status !== "approved") {
    throw Object.assign(
      new Error("Only approved Completed Work can be promoted to the Organisation Library"),
      { statusCode: 400 },
    );
  }

  const PROMOTABLE_TYPES = new Set(["approved_example", "template", "policy", "procedure"]);
  if (!PROMOTABLE_TYPES.has(documentType)) {
    throw Object.assign(
      new Error(`Invalid documentType "${documentType}" for Library promotion. Must be one of: ${[...PROMOTABLE_TYPES].join(", ")}`),
      { statusCode: 400 },
    );
  }

  // Get current version content
  const versions = await getVersions(id, organizationId);
  const currentVersion = versions[0];
  if (!currentVersion || !currentVersion.contentMarkdown) {
    throw Object.assign(new Error("No content available for promotion"), { statusCode: 400 });
  }

  const sourceId = randomUUID();
  const now2 = new Date();

  // Create a knowledge source record directly (content stored in DB, not GCS)
  await withCompletedWorkTenant(organizationId, "completed_work.promote_to_library", async (client) => client.insert(knowledgeSourcesTable).values({
    id:                        sourceId,
    organizationId,
    sourceScope:               "library",
    taskId:                    null,
    title:                     existing.title,
    description:               `Promoted from Completed Work item #${id}`,
    sourceType:                documentType,
    originalFileName:          null,
    mimeType:                  "text/markdown",
    storageProvider:           "local",
    storageKey:                `completed_work/${id}/content.md`,
    checksum:                  null,
    fileSize:                  currentVersion.contentMarkdown?.length ?? null,
    language:                  "en",
    status:                    "review_required",
    authorityLevel:            "authoritative",
    sensitivityClassification: "internal",
    effectiveFrom:             null,
    effectiveTo:               null,
    versionLabel:              "1.0",
    isCurrent:                 true,
    uploadedByUserId:          actorUserId,
    createdAt:                 now2,
    updatedAt:                 now2,
  } as never));

  await logOrgEvent({
    organizationId,
    actorUserId,
    eventType: "completed_work_promoted_to_library",
    resourceType: "completed_work",
    resourceId: id,
    metadata: { documentType, knowledgeSourceId: sourceId },
  });

  return { knowledgeSourceId: sourceId };
}

// ─── Assets ───────────────────────────────────────────────────────────────────

export async function getAssets(id: string, organizationId: string) {
  return withCompletedWorkTenant(organizationId, "completed_work.assets.list", async (client) => client
    .select()
    .from(completedWorkAssetsTable)
    .where(
      and(
        eq(completedWorkAssetsTable.completedWorkId, id),
        eq(completedWorkAssetsTable.organizationId, organizationId),
      )
    ));
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function transitionStatus(
  id: string,
  organizationId: string,
  fromStatus: CompletedWorkStatus,
  toStatus: CompletedWorkStatus,
  actorUserId: string,
  options: {
    eventType: string;
    extraUpdates?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
): Promise<CompletedWorkItem> {
  const existing = await getCompletedWork(id, organizationId);
  if (!existing) throw Object.assign(new Error("Completed work not found"), { statusCode: 404 });
  if (existing.status !== fromStatus) {
    throw Object.assign(
      new Error(`Cannot transition from "${existing.status}" to "${toStatus}" — expected "${fromStatus}"`),
      { statusCode: 400 },
    );
  }

  const now = new Date();
  await withCompletedWorkTenant(organizationId, "completed_work.transition", async (client) => client
    .update(completedWorkTable)
    .set({ status: toStatus, updatedAt: now, ...(options.extraUpdates ?? {}) })
    .where(and(eq(completedWorkTable.id, id), eq(completedWorkTable.organizationId, organizationId))));

  await logOrgEvent({
    organizationId,
    actorUserId,
    eventType: options.eventType,
    resourceType: "completed_work",
    resourceId: id,
    metadata: { previousStatus: fromStatus, newStatus: toStatus, ...options.metadata },
  });

  const updated = await getCompletedWork(id, organizationId);
  if (!updated) throw new Error("Completed work not found after status transition");
  return updated;
}

function mapRow(row: typeof completedWorkTable.$inferSelect): CompletedWorkItem {
  return {
    id: row.id,
    organizationId: row.organizationId,
    conversationId: row.conversationId ?? null,
    blueprintId: row.blueprintId ?? null,
    blueprintVersion: row.blueprintVersion ?? null,
    blueprintContentHash: row.blueprintContentHash ?? null,
    blueprintProvenanceStatus: row.blueprintProvenanceStatus ?? "provenance_unverified",
    blueprintFamily: row.blueprintFamily ?? null,
    blueprintMode: row.blueprintMode ?? null,
    canonicalIntent: row.canonicalIntent ?? null,
    manifestId: row.manifestId ?? null,
    primarySpecialist: row.primarySpecialist,
    title: row.title,
    outputType: row.outputType,
    status: row.status as CompletedWorkStatus,
    currentVersionId: row.currentVersionId ?? null,
    approvedVersionId: (row as any).approvedVersionId ?? null,
    artifactState: row.artifactState ?? null,
    artifactRequired: row.artifactRequired ?? false,
    artifactId: row.artifactId ?? null,
    createdByUserId: row.createdByUserId,
    approvedByUserId: row.approvedByUserId ?? null,
    approvedAt: row.approvedAt ?? null,
    rejectedAt: row.rejectedAt ?? null,
    archivedAt: row.archivedAt ?? null,
    reopenedAt: row.reopenedAt ?? null,
    supersededById: row.supersededById ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
