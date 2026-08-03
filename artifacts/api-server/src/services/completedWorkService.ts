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
import { db } from "@workspace/db";
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
import { eq, and, desc } from "drizzle-orm";
import { logOrgEvent } from "./auditService.js";
import type { ReviewResult } from "./selfReviewService.js";
import type { WorkPackageManifest } from "./workPackageService.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateDraftInput {
  organizationId: string;
  conversationId?: string;
  blueprintId?: string;
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
}

export interface CompletedWorkItem {
  id: string;
  organizationId: string;
  conversationId: string | null;
  blueprintId: string | null;
  manifestId: string | null;
  primarySpecialist: string;
  title: string;
  outputType: string;
  status: CompletedWorkStatus;
  currentVersionId: string | null;
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

  // Create initial version
  await db.insert(completedWorkVersionsTable).values({
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

  // Create work item
  await db.insert(completedWorkTable).values({
    id,
    organizationId: input.organizationId,
    conversationId: input.conversationId ?? null,
    blueprintId: input.blueprintId ?? null,
    manifestId: input.manifestId ?? null,
    primarySpecialist: input.primarySpecialist,
    title: input.title,
    outputType: input.outputType,
    status: "draft",
    currentVersionId: versionId,
    approvalWorkflow: {},
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

  // Link manifest to completed work
  if (input.manifestId) {
    await db
      .update(workPackageManifestsTable)
      .set({ completedWorkId: id })
      .where(eq(workPackageManifestsTable.id, input.manifestId));
  }

  // Record assets used
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
    await db.insert(completedWorkAssetsTable).values(assetRows);
  }

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
  const rows = await db
    .select()
    .from(completedWorkTable)
    .where(
      and(
        eq(completedWorkTable.id, id),
        eq(completedWorkTable.organizationId, organizationId),
      )
    )
    .limit(1);

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

  const rows = await db
    .select()
    .from(completedWorkTable)
    .where(and(...conditions))
    .orderBy(desc(completedWorkTable.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map(mapRow);
}

export async function getVersions(
  completedWorkId: string,
  organizationId: string,
): Promise<CompletedWorkVersion[]> {
  const rows = await db
    .select()
    .from(completedWorkVersionsTable)
    .where(
      and(
        eq(completedWorkVersionsTable.completedWorkId, completedWorkId),
        eq(completedWorkVersionsTable.organizationId, organizationId),
      )
    )
    .orderBy(desc(completedWorkVersionsTable.versionNumber));

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
  return transitionStatus(id, organizationId, "awaiting_approval", "approved", actorUserId, {
    eventType: "completed_work_approved",
    extraUpdates: { approvedByUserId: actorUserId, approvedAt: new Date() },
  });
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
  await db
    .update(completedWorkTable)
    .set({ status: "archived", archivedAt: now, updatedAt: now })
    .where(eq(completedWorkTable.id, id));

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
  await db
    .update(completedWorkTable)
    .set({ status: "superseded", supersededById: newId, updatedAt: now })
    .where(eq(completedWorkTable.id, id));

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

  await db.insert(completedWorkVersionsTable).values({
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

  await db
    .update(completedWorkTable)
    .set({ currentVersionId: versionId, updatedAt: now })
    .where(eq(completedWorkTable.id, id));

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
  await db.insert(completedWorkCommentsTable).values({
    id: commentId,
    completedWorkId: id,
    organizationId,
    content,
    authorUserId,
    createdAt: new Date(),
  });

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
  return db
    .select()
    .from(completedWorkCommentsTable)
    .where(
      and(
        eq(completedWorkCommentsTable.completedWorkId, id),
        eq(completedWorkCommentsTable.organizationId, organizationId),
      )
    )
    .orderBy(desc(completedWorkCommentsTable.createdAt));
}

// ─── Comment resolution (Sprint 25 Hardening) ────────────────────────────────

export async function resolveComment(
  commentId: string,
  workId: string,
  organizationId: string,
  actorUserId: string,
): Promise<void> {
  const rows = await db
    .select()
    .from(completedWorkCommentsTable)
    .where(
      and(
        eq(completedWorkCommentsTable.id, commentId),
        eq(completedWorkCommentsTable.completedWorkId, workId),
        eq(completedWorkCommentsTable.organizationId, organizationId),
      )
    )
    .limit(1);

  const comment = rows[0];
  if (!comment) throw Object.assign(new Error("Comment not found"), { statusCode: 404 });
  if (comment.status === "resolved") throw Object.assign(new Error("Comment is already resolved"), { statusCode: 400 });

  await db
    .update(completedWorkCommentsTable)
    .set({ status: "resolved", resolvedByUserId: actorUserId, resolvedAt: new Date() })
    .where(eq(completedWorkCommentsTable.id, commentId));

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
  const rows = await db
    .select()
    .from(completedWorkCommentsTable)
    .where(
      and(
        eq(completedWorkCommentsTable.id, commentId),
        eq(completedWorkCommentsTable.completedWorkId, workId),
        eq(completedWorkCommentsTable.organizationId, organizationId),
      )
    )
    .limit(1);

  const comment = rows[0];
  if (!comment) throw Object.assign(new Error("Comment not found"), { statusCode: 404 });
  if (comment.status === "open") throw Object.assign(new Error("Comment is already open"), { statusCode: 400 });

  await db
    .update(completedWorkCommentsTable)
    .set({ status: "reopened", reopenedByUserId: actorUserId, reopenedAt: new Date() })
    .where(eq(completedWorkCommentsTable.id, commentId));

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
  await db.insert(knowledgeSourcesTable).values({
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
  } as never);

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
  return db
    .select()
    .from(completedWorkAssetsTable)
    .where(
      and(
        eq(completedWorkAssetsTable.completedWorkId, id),
        eq(completedWorkAssetsTable.organizationId, organizationId),
      )
    );
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
  await db
    .update(completedWorkTable)
    .set({ status: toStatus, updatedAt: now, ...(options.extraUpdates ?? {}) })
    .where(eq(completedWorkTable.id, id));

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
    manifestId: row.manifestId ?? null,
    primarySpecialist: row.primarySpecialist,
    title: row.title,
    outputType: row.outputType,
    status: row.status as CompletedWorkStatus,
    currentVersionId: row.currentVersionId ?? null,
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
