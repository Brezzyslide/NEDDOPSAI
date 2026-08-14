/**
 * OrgMemoryProvider — P3 Knowledge Provider
 *
 * Retrieves approved Chief of Staff Memory (organisation_memory table).
 * These are curated organisational intelligence items:
 *   - Terminology
 *   - Policies
 *   - Writing style
 *   - Business rules
 *   - Approval thresholds
 *   - Escalation rules
 *
 * Memory items are NOT knowledge_chunks — they are structured records
 * with their own type, confidence, and importance scoring.
 *
 * Only 'approved' records enter AI context.
 * Expired, superseded, or not-yet-effective records are excluded.
 * Specialist-scoped memory is included alongside org-wide memory.
 */
import { db } from "@workspace/db";
import { organisationMemoryTable } from "@workspace/db";
import { and, eq, or, isNull, lte, gt, isNotNull, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import type {
  IKnowledgeProvider,
  RetrievalContext,
  KnowledgeProviderResult,
  KnowledgeItem,
} from "../IKnowledgeProvider.js";
import { mapKnowledgeCurrentness } from "../currentness.js";

/** Confidence threshold below which memory items are deprioritised */
const MIN_CONFIDENCE = 0.5;

export class OrgMemoryProvider implements IKnowledgeProvider {
  readonly providerId    = "org_memory";
  readonly displayName   = "Org Memory Provider (P3)";
  readonly priorityLayer = "org_memory" as const;
  readonly isImplemented = true;

  async retrieve(context: RetrievalContext): Promise<KnowledgeProviderResult> {
    const start = Date.now();
    const now   = new Date();

    const rows = await db
      .select()
      .from(organisationMemoryTable)
      .where(
        and(
          eq(organisationMemoryTable.organizationId, context.organisationId),
          eq(organisationMemoryTable.status, "approved"),
          isNull(organisationMemoryTable.supersededBy),
          or(
            isNull(organisationMemoryTable.specialistId),
            eq(organisationMemoryTable.specialistId, context.specialistId),
          ),
          or(
            isNull(organisationMemoryTable.effectiveFrom),
            lte(organisationMemoryTable.effectiveFrom, now),
          ),
          or(
            isNull(organisationMemoryTable.effectiveTo),
            gt(organisationMemoryTable.effectiveTo, now),
          ),
          or(
            isNull(organisationMemoryTable.expiresAt),
            gt(organisationMemoryTable.expiresAt, now),
          ),
        ),
      )
      .orderBy(desc(organisationMemoryTable.importance))
      .limit(context.maxItems ?? 40);

    // Apply keyword relevance scoring (deterministic, no embedding required)
    const scoredRows = rows
      .filter(row => Number(row.confidence ?? 0) >= MIN_CONFIDENCE)
      .map(row => ({
        row,
        relevanceScore: scoreMemoryRelevance(row.title, row.content, context.query),
      }))
      .sort((a, b) => {
        // Sort: pinned decisions first, then by importance + relevance
        const aScore = a.row.importance + a.relevanceScore * 3;
        const bScore = b.row.importance + b.relevanceScore * 3;
        return bScore - aScore;
      });

    const items: KnowledgeItem[] = scoredRows.map(({ row, relevanceScore }) => {
      const retrievedAt = new Date().toISOString();
      return {
        itemId:                   randomUUID(),
        provider:                 this.providerId,
        priorityLayer:            "org_memory",
        sourceId:                 row.id,
        versionId:                null,
        chunkId:                  null,
        sourceTitle:              row.title,
        sectionTitle:             row.memoryType,
        pageNumber:               null,
        headingPath:              null,
        content:                  row.content,
        tokenCount:               estimateTokens(row.content),
        authorityLevel:           "primary",  // org memory is primary for organisation-specific facts
        sensitivityClassification: "internal",
        effectiveFrom:            row.effectiveFrom?.toISOString() ?? null,
        effectiveTo:              row.effectiveTo?.toISOString() ?? null,
        isCurrent:                true,
        provenance: {
          sourceOrigin:       "memory",
          recordIdentifier:   row.id,
          documentIdentifier: row.id,
          retrievedAt,
          effectiveFrom:      row.effectiveFrom?.toISOString(),
          effectiveTo:        row.effectiveTo?.toISOString(),
        },
        currentness: mapKnowledgeCurrentness({
          isCurrent: true,
          sourceVersionStatus: row.status,
          effectiveFrom: row.effectiveFrom,
          effectiveTo: row.effectiveTo,
          checkedAt: retrievedAt,
          version: null,
        }),
        semanticScore:            relevanceScore,
        lexicalScore:             relevanceScore,
      };
    });

    return {
      provider:      this.providerId,
      priorityLayer: this.priorityLayer,
      items,
      durationMs:    Date.now() - start,
    };
  }
}

/**
 * Deterministic keyword relevance score (0-1).
 * Used when embeddings are unavailable for org memory items.
 */
function scoreMemoryRelevance(title: string, content: string, query: string): number {
  if (!query.trim()) return 0.5;

  const queryTokens = query.toLowerCase().split(/\W+/).filter(t => t.length > 2);
  if (queryTokens.length === 0) return 0.5;

  const text = `${title} ${content}`.toLowerCase();
  const matched = queryTokens.filter(token => {
    const pattern = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
    return pattern.test(text);
  });

  return matched.length / queryTokens.length;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
