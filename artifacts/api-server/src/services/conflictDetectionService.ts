/**
 * conflictDetectionService — Task #17 (Knowledge Orchestration Engine)
 *
 * Detects conflicts among retrieved knowledge items before they are assembled
 * into the specialist instruction. Returns structured warnings.
 *
 * Detected conflict types:
 *   superseded_version     — older version of a document exists alongside newer
 *   outdated_version       — isCurrent = false (shouldn't appear, but checked)
 *   policy_conflict        — two policy-authority sources covering same topic
 *   memory_conflict        — two org memory items of same type with contradictory signals
 *   effective_date_overlap — two mandatory/primary sources with overlapping effective windows
 *
 * DESIGN RULE: Do not silently choose one conflicting item.
 * Return warnings; the orchestration engine surfaces them to the assembler.
 *
 * SCOPE: Structural conflict detection only (no LLM calls).
 * Deep semantic conflict resolution is deferred to future sprints.
 */

import type { KnowledgeItem, AuthorityLevel } from "../lib/knowledge/IKnowledgeProvider.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ConflictType =
  | "superseded_version"
  | "outdated_version"
  | "policy_conflict"
  | "memory_conflict"
  | "effective_date_overlap"
  | "duplicate_content";

export interface ConflictWarning {
  conflictType: ConflictType;
  severity: "warning" | "error";
  description: string;
  /** IDs of conflicting items */
  itemIds: string[];
  /** Source IDs involved */
  sourceIds: string[];
  /** Suggested resolution (informational — never auto-applied) */
  resolution: string;
}

export interface ConflictDetectionResult {
  conflicts: ConflictWarning[];
  /** Items recommended for exclusion due to supersession */
  excludeItemIds: Set<string>;
  /** Source IDs flagged as outdated */
  outdatedSourceIds: Set<string>;
}

// ─── High-authority levels for overlap checking ───────────────────────────────

const HIGH_AUTHORITY_LEVELS: AuthorityLevel[] = ["mandatory", "primary"];

// ─── Main detection function ───────────────────────────────────────────────────

/**
 * Analyse a list of retrieved knowledge items for structural conflicts.
 * Returns warnings and a set of item IDs to exclude.
 */
export function detectConflicts(items: KnowledgeItem[]): ConflictDetectionResult {
  const conflicts: ConflictWarning[] = [];
  const excludeItemIds   = new Set<string>();
  const outdatedSourceIds = new Set<string>();

  const chunkItems  = items.filter(i => i.chunkId !== null);
  const memoryItems = items.filter(i => i.chunkId === null && i.priorityLayer === "org_memory");

  // ── 1. Superseded versions ─────────────────────────────────────────────────
  detectSupersededVersions(chunkItems, conflicts, excludeItemIds, outdatedSourceIds);

  // ── 2. Outdated (non-current) versions ─────────────────────────────────────
  detectOutdatedVersions(chunkItems, conflicts, outdatedSourceIds);

  // ── 3. Effective date overlaps among mandatory/primary sources ─────────────
  detectEffectiveDateOverlaps(chunkItems, conflicts);

  // ── 4. Memory conflicts (same type, same org) ──────────────────────────────
  detectMemoryConflicts(memoryItems, conflicts);

  // ── 5. Duplicate content (same chunkId retrieved by multiple providers) ────
  detectDuplicateContent(items, conflicts, excludeItemIds);

  return { conflicts, excludeItemIds, outdatedSourceIds };
}

// ─── Superseded version detection ─────────────────────────────────────────────

function detectSupersededVersions(
  items: KnowledgeItem[],
  conflicts: ConflictWarning[],
  excludeItemIds: Set<string>,
  outdatedSourceIds: Set<string>,
): void {
  // Group by sourceId — if multiple versions appear, the lower version is superseded
  const bySource = groupBy(items, i => i.sourceId);

  for (const [sourceId, sourceItems] of bySource.entries()) {
    if (sourceItems.length <= 1) continue;

    // Multiple chunks from different versions of the same source
    const versionGroups = groupBy(sourceItems, i => i.versionId ?? "none");
    if (versionGroups.size <= 1) continue;

    // The orchestration engine should only retrieve isCurrent=true sources.
    // If we have multiple versions here, something is wrong — flag as conflict.
    const versionIds = Array.from(versionGroups.keys());
    const olderItems = sourceItems.filter(i => !i.isCurrent);

    for (const item of olderItems) {
      excludeItemIds.add(item.itemId);
      outdatedSourceIds.add(sourceId);
    }

    conflicts.push({
      conflictType: "superseded_version",
      severity: "warning",
      description:
        `Source "${sourceItems[0]?.sourceTitle ?? sourceId}" has multiple versions ` +
        `(${versionIds.join(", ")}) present in the retrieved context. ` +
        `Older versions have been excluded.`,
      itemIds:   olderItems.map(i => i.itemId),
      sourceIds: [sourceId],
      resolution: "Only the current version of this document is included in context.",
    });
  }
}

// ─── Outdated version detection ────────────────────────────────────────────────

function detectOutdatedVersions(
  items: KnowledgeItem[],
  conflicts: ConflictWarning[],
  outdatedSourceIds: Set<string>,
): void {
  const outdated = items.filter(i => !i.isCurrent);

  for (const item of outdated) {
    if (!outdatedSourceIds.has(item.sourceId)) {
      outdatedSourceIds.add(item.sourceId);
      conflicts.push({
        conflictType: "outdated_version",
        severity: "warning",
        description:
          `Source "${item.sourceTitle}" (ID: ${item.sourceId}) is not the current version.`,
        itemIds:   [item.itemId],
        sourceIds: [item.sourceId],
        resolution: "Review and re-approve the latest version of this document.",
      });
    }
  }
}

// ─── Effective date overlap detection ─────────────────────────────────────────

function detectEffectiveDateOverlaps(
  items: KnowledgeItem[],
  conflicts: ConflictWarning[],
): void {
  // Only check mandatory/primary authority items from the library
  const highAuthority = items.filter(
    i =>
      HIGH_AUTHORITY_LEVELS.includes(i.authorityLevel) &&
      i.priorityLayer !== "task_upload" &&
      i.effectiveFrom !== null,
  );

  // Group by source title similarity (simple: same first 30 chars)
  const byTitle = groupBy(highAuthority, i => i.sourceTitle.slice(0, 30).toLowerCase());

  for (const [, titleGroup] of byTitle.entries()) {
    if (titleGroup.length <= 1) continue;

    // Check all pairs for overlap
    for (let a = 0; a < titleGroup.length; a++) {
      for (let b = a + 1; b < titleGroup.length; b++) {
        const itemA = titleGroup[a]!;
        const itemB = titleGroup[b]!;

        if (itemA.sourceId === itemB.sourceId) continue;
        if (!datesOverlap(itemA, itemB)) continue;

        conflicts.push({
          conflictType: "effective_date_overlap",
          severity: "warning",
          description:
            `Two high-authority sources with similar titles have overlapping effective ` +
            `date windows: "${itemA.sourceTitle}" and "${itemB.sourceTitle}". ` +
            `Verify which is the authoritative version for this time period.`,
          itemIds:   [itemA.itemId, itemB.itemId],
          sourceIds: [itemA.sourceId, itemB.sourceId],
          resolution:
            "Supersede the older document in the Organisation Library to resolve the overlap.",
        });
      }
    }
  }
}

function datesOverlap(a: KnowledgeItem, b: KnowledgeItem): boolean {
  const aFrom = a.effectiveFrom ? new Date(a.effectiveFrom).getTime() : 0;
  const aTo   = a.effectiveTo   ? new Date(a.effectiveTo).getTime()   : Infinity;
  const bFrom = b.effectiveFrom ? new Date(b.effectiveFrom).getTime() : 0;
  const bTo   = b.effectiveTo   ? new Date(b.effectiveTo).getTime()   : Infinity;
  return aFrom <= bTo && bFrom <= aTo;
}

// ─── Memory conflict detection ─────────────────────────────────────────────────

function detectMemoryConflicts(
  items: KnowledgeItem[],
  conflicts: ConflictWarning[],
): void {
  // Group by memoryType (stored in sectionTitle for memory items)
  const byType = groupBy(items, i => i.sectionTitle ?? "unknown");

  for (const [memoryType, typeItems] of byType.entries()) {
    if (typeItems.length <= 1) continue;

    // Flag when the same memory type has multiple items — human should verify
    // (Deep semantic contradiction requires LLM — deferred to future sprint)
    if (typeItems.length >= 3) {
      conflicts.push({
        conflictType: "memory_conflict",
        severity: "warning",
        description:
          `${typeItems.length} approved memory items of type "${memoryType}" are in context. ` +
          `Verify these records are consistent and consolidate where possible.`,
        itemIds:   typeItems.map(i => i.itemId),
        sourceIds: typeItems.map(i => i.sourceId),
        resolution:
          "Review the memory items in the Organisation Memory panel and " +
          "supersede any that are no longer accurate.",
      });
    }
  }
}

// ─── Duplicate content detection ──────────────────────────────────────────────

function detectDuplicateContent(
  items: KnowledgeItem[],
  conflicts: ConflictWarning[],
  excludeItemIds: Set<string>,
): void {
  // Exact duplicate: same chunkId retrieved by multiple providers
  const byChunkId = groupBy(
    items.filter(i => i.chunkId !== null),
    i => i.chunkId!,
  );

  for (const [chunkId, dupes] of byChunkId.entries()) {
    if (dupes.length <= 1) continue;

    // Keep highest priority layer; exclude the rest
    const sorted = [...dupes].sort(
      (a, b) => PRIORITY_INDEX[a.priorityLayer] - PRIORITY_INDEX[b.priorityLayer],
    );

    const keeper = sorted[0]!;
    const extras = sorted.slice(1);

    for (const extra of extras) {
      excludeItemIds.add(extra.itemId);
    }

    conflicts.push({
      conflictType: "duplicate_content",
      severity: "warning",
      description:
        `Chunk "${chunkId}" was returned by ${dupes.length} providers ` +
        `(${dupes.map(d => d.provider).join(", ")}). ` +
        `Retaining highest-priority copy from "${keeper.provider}".`,
      itemIds:   extras.map(e => e.itemId),
      sourceIds: [...new Set(dupes.map(d => d.sourceId))],
      resolution: "Duplicate removed — highest priority provider's copy retained.",
    });
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const PRIORITY_INDEX: Record<string, number> = {
  task_upload: 0,
  entity:      1,
  org_memory:  2,
  specialist:  3,
  library:     4,
  desktop:     5,
  cloud:       6,
  web_search:  7,
};

function groupBy<T>(arr: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of arr) {
    const k = key(item);
    const existing = map.get(k);
    if (existing) existing.push(item);
    else map.set(k, [item]);
  }
  return map;
}
