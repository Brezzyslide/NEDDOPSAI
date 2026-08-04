/**
 * Organisation Memory Service — Sprint 9.2
 *
 * Manages tenant-scoped organisation memory lifecycle.
 * All data stored in platform DB (organisation_memory table) with organization_id FK.
 * Only approved memory enters Chief of Staff context.
 */

import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { organisationMemoryTable, orgAuditLogTable } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import type { OrganisationMemoryItem } from "./contextSelectionService.js";

export type MemoryStatus = "proposed" | "approved" | "rejected" | "superseded" | "expired";
export type MemoryType =
  | "organisation_profile" | "operating_preference" | "terminology"
  | "approval_rule" | "reporting_line" | "system_information" | "workflow"
  | "policy_reference" | "customer_preference" | "risk_constraint"
  | "compliance_context" | "other";

const VALID_MEMORY_TYPES: MemoryType[] = [
  "organisation_profile","operating_preference","terminology","approval_rule",
  "reporting_line","system_information","workflow","policy_reference",
  "customer_preference","risk_constraint","compliance_context","other",
];
const VALID_STATUSES: MemoryStatus[] = ["proposed","approved","rejected","superseded","expired"];

export interface CreateMemoryInput {
  memoryType: MemoryType;
  title: string;
  content: string;
  structuredContent?: Record<string, unknown>;
  sourceType: "conversation" | "manual" | "ai_proposed" | "import";
  sourceId?: string;
  confidence?: number;
  importance?: number;
  effectiveFrom?: Date;
  effectiveTo?: Date;
  expiresAt?: Date;
  createdBy: string;
}

export interface MemoryConflict {
  existingId: string;
  existingTitle: string;
  description: string;
}

// ─── Create (proposed) ────────────────────────────────────────────────────────

export async function proposeOrganisationMemory(
  organizationId: string,
  input: CreateMemoryInput,
): Promise<{ id: string; conflicts: MemoryConflict[] }> {
  const id = randomUUID();
  const conflicts = await detectConflictsForNew(organizationId, input);

  await db.insert(organisationMemoryTable).values({
    id,
    organizationId,
    memoryType: VALID_MEMORY_TYPES.includes(input.memoryType) ? input.memoryType : "other",
    title: input.title.slice(0, 200),
    content: input.content.slice(0, 5000),
    structuredContent: input.structuredContent ?? {},
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    status: "proposed",
    confidence: String(Math.min(1, Math.max(0, input.confidence ?? 0.8))),
    importance: Math.min(10, Math.max(1, input.importance ?? 5)),
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    expiresAt: input.expiresAt,
    createdBy: input.createdBy,
  });

  await writeMemoryAudit(organizationId, input.createdBy, "memory.proposed", id, {
    memoryType: input.memoryType, title: input.title.slice(0, 100), conflicts: conflicts.length,
  });
  return { id, conflicts };
}

// ─── Approve ──────────────────────────────────────────────────────────────────

export async function approveOrganisationMemory(
  organizationId: string, memoryId: string, approvedBy: string,
): Promise<boolean> {
  try {
    await db.update(organisationMemoryTable)
      .set({ status: "approved", approvedBy, approvedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(organisationMemoryTable.organizationId, organizationId), eq(organisationMemoryTable.id, memoryId), eq(organisationMemoryTable.status, "proposed")));
    await writeMemoryAudit(organizationId, approvedBy, "memory.approved", memoryId, {});
    return true;
  } catch { return false; }
}

// ─── Reject ───────────────────────────────────────────────────────────────────

export async function rejectOrganisationMemory(
  organizationId: string, memoryId: string, rejectedBy: string,
): Promise<boolean> {
  try {
    await db.update(organisationMemoryTable)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(and(eq(organisationMemoryTable.organizationId, organizationId), eq(organisationMemoryTable.id, memoryId)));
    await writeMemoryAudit(organizationId, rejectedBy, "memory.rejected", memoryId, {});
    return true;
  } catch { return false; }
}

// ─── Supersede ────────────────────────────────────────────────────────────────

export async function supersedeOrganisationMemory(
  organizationId: string, oldId: string, newId: string, userId: string,
): Promise<boolean> {
  try {
    await db.update(organisationMemoryTable)
      .set({ status: "superseded", supersededBy: newId, updatedAt: new Date() })
      .where(and(eq(organisationMemoryTable.organizationId, organizationId), eq(organisationMemoryTable.id, oldId)));
    await writeMemoryAudit(organizationId, userId, "memory.superseded", oldId, { supersededBy: newId });
    return true;
  } catch { return false; }
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateOrganisationMemory(
  organizationId: string,
  memoryId: string,
  updates: Partial<Pick<CreateMemoryInput, "title"|"content"|"structuredContent"|"confidence"|"importance"|"expiresAt">>,
  userId: string,
): Promise<boolean> {
  try {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.title !== undefined) patch.title = updates.title.slice(0, 200);
    if (updates.content !== undefined) patch.content = updates.content.slice(0, 5000);
    if (updates.structuredContent !== undefined) patch.structuredContent = updates.structuredContent;
    if (updates.confidence !== undefined) patch.confidence = String(Math.min(1, Math.max(0, updates.confidence)));
    if (updates.importance !== undefined) patch.importance = Math.min(10, Math.max(1, updates.importance));
    if (updates.expiresAt !== undefined) patch.expiresAt = updates.expiresAt;

    await db.update(organisationMemoryTable)
      .set(patch as Partial<typeof organisationMemoryTable.$inferInsert>)
      .where(and(eq(organisationMemoryTable.organizationId, organizationId), eq(organisationMemoryTable.id, memoryId)));
    await writeMemoryAudit(organizationId, userId, "memory.updated", memoryId, {});
    return true;
  } catch { return false; }
}

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listOrganisationMemory(
  organizationId: string,
  filters: { status?: MemoryStatus | MemoryStatus[]; memoryType?: MemoryType; includeExpired?: boolean; limit?: number; offset?: number } = {},
): Promise<{ items: OrganisationMemoryItem[]; total: number }> {
  try {
    const now = new Date();
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = filters.offset ?? 0;

    const conditions: Parameters<typeof and>[] = [
      eq(organisationMemoryTable.organizationId, organizationId) as any,
    ];
    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      conditions.push(inArray(organisationMemoryTable.status, statuses) as any);
    }
    if (filters.memoryType) {
      conditions.push(eq(organisationMemoryTable.memoryType, filters.memoryType) as any);
    }

    const rows = await db.select().from(organisationMemoryTable)
      .where(and(...(conditions as [any])))
      .orderBy(desc(organisationMemoryTable.importance), desc(organisationMemoryTable.updatedAt))
      .limit(limit + 1)
      .offset(offset);

    const filtered = filters.includeExpired
      ? rows
      : rows.filter(r => !r.expiresAt || r.expiresAt > now);

    const hasMore = filtered.length > limit;
    const items = filtered.slice(0, limit).map(mapRow);

    return { items, total: hasMore ? offset + limit + 1 : offset + items.length };
  } catch { return { items: [], total: 0 }; }
}

// ─── Conflict detection ───────────────────────────────────────────────────────

async function detectConflictsForNew(
  organizationId: string, input: CreateMemoryInput,
): Promise<MemoryConflict[]> {
  const conflicts: MemoryConflict[] = [];
  try {
    const existing = await db.select({ id: organisationMemoryTable.id, title: organisationMemoryTable.title })
      .from(organisationMemoryTable)
      .where(and(eq(organisationMemoryTable.organizationId, organizationId), eq(organisationMemoryTable.memoryType, input.memoryType), eq(organisationMemoryTable.status, "approved")))
      .limit(10);

    for (const row of existing) {
      if (titleSimilarity(input.title, row.title) > 0.6) {
        conflicts.push({
          existingId: row.id,
          existingTitle: row.title,
          description: `An approved "${input.memoryType}" record with a similar title already exists. Consider superseding it.`,
        });
      }
    }
  } catch { /* non-critical */ }
  return conflicts;
}

function titleSimilarity(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const wb = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) { if (wb.has(w)) shared++; }
  return shared / Math.max(wa.size, wb.size);
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

function mapRow(r: typeof organisationMemoryTable.$inferSelect): OrganisationMemoryItem {
  return {
    id: r.id,
    memoryType: r.memoryType,
    title: r.title,
    content: r.content,
    structuredContent: (r.structuredContent as Record<string, unknown>) ?? {},
    status: r.status,
    confidence: parseFloat(String(r.confidence ?? "0.8")),
    importance: r.importance,
    sourceType: r.sourceType,
    sourceId: r.sourceId ?? null,
    effectiveFrom: r.effectiveFrom ?? null,
    effectiveTo: r.effectiveTo ?? null,
    expiresAt: r.expiresAt ?? null,
    approvedBy: r.approvedBy ?? null,
    approvedAt: r.approvedAt ?? null,
    createdAt: r.createdAt,
  };
}

// ─── Merge (Sprint 29) ────────────────────────────────────────────────────────

export interface MergeMemoryInput {
  targetId:   string; // the surviving record
  sourceId:   string; // the record to be absorbed
  mergedBy:   string;
  mergedTitle?:   string;
  mergedContent?: string;
}

/**
 * Merge two memory records into one.
 * - Updates the target with optional new title/content
 * - Supersedes the source (marks it superseded with supersededBy = targetId)
 * - Writes audit events for both operations
 */
export async function mergeOrganisationMemory(
  organizationId: string,
  input: MergeMemoryInput,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // Load both records and validate ownership
    const [targetRow] = await db
      .select()
      .from(organisationMemoryTable)
      .where(and(eq(organisationMemoryTable.organizationId, organizationId), eq(organisationMemoryTable.id, input.targetId)))
      .limit(1);
    const [sourceRow] = await db
      .select()
      .from(organisationMemoryTable)
      .where(and(eq(organisationMemoryTable.organizationId, organizationId), eq(organisationMemoryTable.id, input.sourceId)))
      .limit(1);

    if (!targetRow) return { ok: false, error: "Target memory record not found." };
    if (!sourceRow) return { ok: false, error: "Source memory record not found." };

    // Update target with merged content (if provided)
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.mergedTitle)   patch.title   = input.mergedTitle.slice(0, 200);
    if (input.mergedContent) patch.content = input.mergedContent.slice(0, 5000);
    // Keep target confidence at the higher of the two
    const mergedConfidence = Math.max(
      parseFloat(String(targetRow.confidence ?? "0.8")),
      parseFloat(String(sourceRow.confidence ?? "0.8")),
    );
    patch.confidence = String(mergedConfidence);

    await db
      .update(organisationMemoryTable)
      .set(patch as any)
      .where(and(eq(organisationMemoryTable.organizationId, organizationId), eq(organisationMemoryTable.id, input.targetId)));

    // Supersede the source
    await db
      .update(organisationMemoryTable)
      .set({ status: "superseded", supersededBy: input.targetId, updatedAt: new Date() })
      .where(and(eq(organisationMemoryTable.organizationId, organizationId), eq(organisationMemoryTable.id, input.sourceId)));

    await writeMemoryAudit(organizationId, input.mergedBy, "memory.merged", input.targetId, {
      sourceId: input.sourceId,
      sourceTitle: sourceRow.title,
    });
    await writeMemoryAudit(organizationId, input.mergedBy, "memory.superseded", input.sourceId, {
      supersededBy: input.targetId,
      mergedInto: input.targetId,
    });

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Merge failed" };
  }
}

// ─── Per-memory audit history (Sprint 29) ────────────────────────────────────

export async function getMemoryAuditHistory(
  organizationId: string,
  memoryId: string,
): Promise<(typeof orgAuditLogTable.$inferSelect)[]> {
  try {
    const { desc: descOrder } = await import("drizzle-orm");
    return db
      .select()
      .from(orgAuditLogTable)
      .where(
        and(
          eq(orgAuditLogTable.organizationId, organizationId),
          eq(orgAuditLogTable.resourceId, memoryId),
        ),
      )
      .orderBy(descOrder(orgAuditLogTable.occurredAt))
      .limit(50);
  } catch { return []; }
}

// ─── Audit ────────────────────────────────────────────────────────────────────

async function writeMemoryAudit(orgId: string, userId: string, eventType: string, resourceId: string, metadata: Record<string, unknown>) {
  try {
    await db.insert(orgAuditLogTable).values({
      id: randomUUID(), organizationId: orgId, actorUserId: userId, actorType: "user",
      eventType, resourceType: "organisation_memory", resourceId,
      isSensitive: false, metadata, occurredAt: new Date(),
    });
  } catch { /* non-critical */ }
}
