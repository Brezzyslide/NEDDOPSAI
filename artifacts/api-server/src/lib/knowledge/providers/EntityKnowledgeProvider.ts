/**
 * EntityKnowledgeProvider — P2 Knowledge Provider
 *
 * Retrieves knowledge attached to entities:
 *   participant | client | project | contract | supplier | employee | location | asset
 *
 * Only retrieved when entity IDs are provided and directly relevant.
 * Uses knowledge_source_scopes with scope_type = 'entity' to find
 * entity-scoped library documents.
 *
 * NOTE: Entity knowledge scoped sources are currently sparse — this provider
 * will return results as the platform populates entity-scoped documents
 * through the Organisation Library UI (Task #18).
 */
import { randomUUID } from "crypto";
import type {
  IKnowledgeProvider,
  RetrievalContext,
  KnowledgeProviderResult,
  KnowledgeItem,
} from "../IKnowledgeProvider.js";
import { retrieveChunks } from "../../../services/hybridRetrievalService.js";
import { mapKnowledgeCurrentness } from "../currentness.js";

export type EntityType =
  | "participant"
  | "client"
  | "project"
  | "contract"
  | "supplier"
  | "employee"
  | "location"
  | "asset";

export class EntityKnowledgeProvider implements IKnowledgeProvider {
  readonly providerId    = "entity_knowledge";
  readonly displayName   = "Entity Knowledge Provider (P2)";
  readonly priorityLayer = "entity" as const;
  readonly isImplemented = true;

  async retrieve(context: RetrievalContext): Promise<KnowledgeProviderResult> {
    const start = Date.now();

    // No entity IDs = skip silently
    if (!context.entityIds || context.entityIds.length === 0) {
      return {
        provider:      this.providerId,
        priorityLayer: this.priorityLayer,
        items:         [],
        durationMs:    Date.now() - start,
      };
    }

    // Entity-scoped chunks use scope_type='entity'. This retrieves library
    // documents that have been explicitly scoped to these entity IDs.
    // The current DB schema uses knowledge_source_scopes; entity sources
    // populate as the platform matures.
    const chunks = await retrieveChunks({
      organisationId:    context.organisationId,
      query:             context.query,
      queryEmbedding:    context.queryEmbedding ?? null,
      scopeMode:         "entity_scoped",
      allowedSensitivity: context.allowedSensitivity,
      excludeSourceIds:  context.excludeSourceIds ?? [],
      limit:             context.maxItems ?? 20,
    });

    const items: KnowledgeItem[] = chunks.map(chunk => {
      const retrievedAt = new Date().toISOString();
      return {
        itemId:                   randomUUID(),
        provider:                 this.providerId,
        priorityLayer:            "entity",
        sourceId:                 chunk.knowledgeSourceId,
        versionId:                chunk.sourceVersionId,
        chunkId:                  chunk.id,
        sourceTitle:              chunk.sourceTitle,
        sectionTitle:             chunk.sectionTitle,
        pageNumber:               chunk.pageNumber,
        headingPath:              chunk.headingPath,
        content:                  chunk.text,
        tokenCount:               chunk.tokenCount ?? estimateTokens(chunk.text),
        authorityLevel:           chunk.authorityLevel as any,
        sensitivityClassification: chunk.sensitivityClassification as any,
        effectiveFrom:            chunk.effectiveFrom?.toISOString() ?? null,
        effectiveTo:              chunk.effectiveTo?.toISOString() ?? null,
        isCurrent:                chunk.isCurrent,
        provenance: {
          sourceOrigin:       "internal_krs",
          recordIdentifier:   chunk.knowledgeSourceId,
          documentIdentifier: chunk.sourceVersionId,
          retrievedAt,
          effectiveFrom:      chunk.effectiveFrom?.toISOString(),
          effectiveTo:        chunk.effectiveTo?.toISOString(),
        },
        currentness: mapKnowledgeCurrentness({
          isCurrent: chunk.isCurrent,
          sourceVersionIsCurrent: chunk.sourceVersionIsCurrent,
          sourceVersionStatus: chunk.sourceVersionStatus,
          effectiveFrom: chunk.effectiveFrom,
          effectiveTo: chunk.effectiveTo,
          checkedAt: retrievedAt,
          version: chunk.sourceVersionLabel ?? chunk.sourceVersionId,
        }),
        semanticScore:            chunk.semanticScore,
        lexicalScore:             chunk.lexicalScore,
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

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
