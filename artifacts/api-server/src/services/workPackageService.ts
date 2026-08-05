/**
 * Work Package Service — Sprint 22 (Work Execution Engine & Completed Work)
 *
 * Assembles an immutable Work Package Manifest before specialist execution.
 * Retrieves every knowledge source, memory, and entity reference needed for
 * the work, stamps model/prompt versions, and writes an immutable manifest row.
 *
 * The manifest is the complete audit record of what the specialist had access
 * to — it never changes after assembly.
 */

import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  workPackageManifestsTable,
  knowledgeSourcesTable,
  organisationMemoryTable,
  type ManifestLibrarySource,
  type ManifestMemoryRef,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import type { WorkBlueprint } from "./workBlueprintService.js";

// ─── Prompt version — increment when system prompt changes materially ─────────
export const CURRENT_PROMPT_VERSION = "sprint22.1.0";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AssembleManifestInput {
  organizationId: string;
  requesterId: string;
  conversationId?: string;
  blueprint: WorkBlueprint | null;
  /** Pre-identified task upload source IDs (conversation-scoped) */
  taskUploadSourceIds?: string[];
  /** Entity knowledge provided inline */
  entityKnowledge?: Record<string, unknown>;
  /** Override model version (e.g. from AI gateway) */
  modelVersion?: string;
}

export interface WorkPackageManifest {
  id: string;
  organizationId: string;
  completedWorkId: string | null;
  executionId: string;
  blueprintId: string | null;
  blueprintVersion: string | null;
  primarySpecialist: string;
  supportingSpecialists: string[];
  organisationLibrarySources: ManifestLibrarySource[];
  cosMemories: ManifestMemoryRef[];
  specialistMemories: ManifestMemoryRef[];
  entityKnowledge: Record<string, unknown>;
  taskUploads: ManifestLibrarySource[];
  modelVersion: string | null;
  promptVersion: string | null;
  assembledAt: Date;
  requesterId: string | null;
  createdAt: Date;
}

// ─── Assembly ─────────────────────────────────────────────────────────────────

export async function assembleWorkPackage(
  input: AssembleManifestInput,
): Promise<WorkPackageManifest> {
  const { organizationId, requesterId, blueprint, taskUploadSourceIds = [], entityKnowledge = {} } = input;

  const executionId = randomUUID();
  const primarySpecialist = blueprint?.primarySpecialist ?? "chief_of_staff";
  const supportingSpecialists = blueprint?.supportingSpecialists ?? [];
  const requiredKnowledgeTypes = blueprint?.requiredLibraryKnowledge ?? [];

  // ── Retrieve Organisation Library sources ────────────────────────────────
  let librarySources: ManifestLibrarySource[] = [];
  if (requiredKnowledgeTypes.length > 0) {
    const sourceRows = await db
      .select({
        id: knowledgeSourcesTable.id,
        title: knowledgeSourcesTable.title,
        sourceType: knowledgeSourcesTable.sourceType,
        authorityLevel: knowledgeSourcesTable.authorityLevel,
        storageKey: knowledgeSourcesTable.storageKey,
        versionLabel: knowledgeSourcesTable.versionLabel,
      })
      .from(knowledgeSourcesTable)
      .where(
        and(
          eq(knowledgeSourcesTable.organizationId, organizationId),
          eq(knowledgeSourcesTable.status, "approved"),
          eq(knowledgeSourcesTable.sourceScope, "library"),
          inArray(knowledgeSourcesTable.sourceType, requiredKnowledgeTypes),
        )
      )
      .limit(40);

    librarySources = sourceRows.map(r => ({
      sourceId: r.id,
      title: r.title,
      sourceType: r.sourceType,
      authorityLevel: r.authorityLevel ?? undefined,
      storageKey: r.storageKey ?? undefined,
      versionLabel: r.versionLabel ?? undefined,
    }));
  }

  // ── Retrieve CoS memory ──────────────────────────────────────────────────
  const memoryRows = await db
    .select({
      id: organisationMemoryTable.id,
      memoryType: organisationMemoryTable.memoryType,
      title: organisationMemoryTable.title,
      approvalStatus: organisationMemoryTable.status,
    })
    .from(organisationMemoryTable)
    .where(
      and(
        eq(organisationMemoryTable.organizationId, organizationId),
        eq(organisationMemoryTable.status, "approved"),
      )
    )
    .limit(30);

  const requiredMemoryTypes = new Set(blueprint?.requiredMemories ?? []);
  const cosMemories: ManifestMemoryRef[] = [];
  const specialistMemories: ManifestMemoryRef[] = [];

  for (const row of memoryRows) {
    const ref: ManifestMemoryRef = {
      memoryId: row.id,
      memoryType: row.memoryType,
      title: row.title,
      approvalStatus: row.approvalStatus ?? undefined,
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
    const uploadRows = await db
      .select({
        id: knowledgeSourcesTable.id,
        title: knowledgeSourcesTable.title,
        sourceType: knowledgeSourcesTable.sourceType,
        storageKey: knowledgeSourcesTable.storageKey,
      })
      .from(knowledgeSourcesTable)
      .where(
        and(
          eq(knowledgeSourcesTable.organizationId, organizationId),
          eq(knowledgeSourcesTable.sourceScope, "task"),
          inArray(knowledgeSourcesTable.id, taskUploadSourceIds),
        )
      );

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
  const id = randomUUID();
  const now = new Date();

  await db.insert(workPackageManifestsTable).values({
    id,
    organizationId,
    completedWorkId: null,
    executionId,
    blueprintId: blueprint?.id ?? null,
    blueprintVersion: blueprint?.version ?? null,
    primarySpecialist,
    supportingSpecialists,
    organisationLibrarySources: librarySources,
    cosMemories,
    specialistMemories,
    entityKnowledge,
    taskUploads,
    modelVersion,
    promptVersion: CURRENT_PROMPT_VERSION,
    assembledAt: now,
    requesterId,
    createdAt: now,
  });

  return {
    id,
    organizationId,
    completedWorkId: null,
    executionId,
    blueprintId: blueprint?.id ?? null,
    blueprintVersion: blueprint?.version ?? null,
    primarySpecialist,
    supportingSpecialists,
    organisationLibrarySources: librarySources,
    cosMemories,
    specialistMemories,
    entityKnowledge,
    taskUploads,
    modelVersion,
    promptVersion: CURRENT_PROMPT_VERSION,
    assembledAt: now,
    requesterId,
    createdAt: now,
  };
}

/**
 * Link a manifest to its completed work item after creation.
 */
export async function linkManifestToCompletedWork(
  manifestId: string,
  completedWorkId: string,
): Promise<void> {
  await db
    .update(workPackageManifestsTable)
    .set({ completedWorkId })
    .where(eq(workPackageManifestsTable.id, manifestId));
}

/**
 * Get a manifest by ID.
 */
export async function getManifest(
  id: string,
  organizationId: string,
): Promise<WorkPackageManifest | null> {
  const rows = await db
    .select()
    .from(workPackageManifestsTable)
    .where(
      and(
        eq(workPackageManifestsTable.id, id),
        eq(workPackageManifestsTable.organizationId, organizationId),
      )
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    organizationId: row.organizationId,
    completedWorkId: row.completedWorkId ?? null,
    executionId: row.executionId,
    blueprintId: row.blueprintId ?? null,
    blueprintVersion: row.blueprintVersion ?? null,
    primarySpecialist: row.primarySpecialist,
    supportingSpecialists: (row.supportingSpecialists as string[]) ?? [],
    organisationLibrarySources: (row.organisationLibrarySources as ManifestLibrarySource[]) ?? [],
    cosMemories: (row.cosMemories as ManifestMemoryRef[]) ?? [],
    specialistMemories: (row.specialistMemories as ManifestMemoryRef[]) ?? [],
    entityKnowledge: (row.entityKnowledge as Record<string, unknown>) ?? {},
    taskUploads: (row.taskUploads as ManifestLibrarySource[]) ?? [],
    modelVersion: row.modelVersion ?? null,
    promptVersion: row.promptVersion ?? null,
    assembledAt: row.assembledAt,
    requesterId: row.requesterId ?? null,
    createdAt: row.createdAt,
  };
}
