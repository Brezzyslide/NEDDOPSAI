/**
 * OrganisationLibraryProvider — P5 Knowledge Provider
 *
 * Retrieves from the approved Organisation Library:
 *   - Policies
 *   - Procedures
 *   - Templates
 *   - Guides
 *   - Reference manuals
 *
 * Scope: knowledge_source_scopes with scope_type IN ('organisation','workforce')
 *        OR sources with no scope assignments (implicitly org-wide).
 *
 * This is the broadest retrieval layer — specialist and entity scoped sources
 * have already been claimed by P2/P4 and are excluded via excludeSourceIds.
 */
import { randomUUID } from "crypto";
import type {
  IKnowledgeProvider,
  RetrievalContext,
  KnowledgeProviderResult,
  KnowledgeItem,
} from "../IKnowledgeProvider.js";
import { retrieveChunks } from "../../../services/hybridRetrievalService.js";

export class OrganisationLibraryProvider implements IKnowledgeProvider {
  readonly providerId    = "organisation_library";
  readonly displayName   = "Organisation Library Provider (P5)";
  readonly priorityLayer = "library" as const;
  readonly isImplemented = true;

  async retrieve(context: RetrievalContext): Promise<KnowledgeProviderResult> {
    const start = Date.now();

    const chunks = await retrieveChunks({
      organisationId:    context.organisationId,
      query:             context.query,
      queryEmbedding:    context.queryEmbedding ?? null,
      scopeMode:         "org_library",
      allowedSensitivity: context.allowedSensitivity,
      excludeSourceIds:  context.excludeSourceIds ?? [],
      limit:             context.maxItems ?? 30,
    });

    const items: KnowledgeItem[] = chunks.map(chunk => ({
      itemId:                   randomUUID(),
      provider:                 this.providerId,
      priorityLayer:            "library",
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
        retrievedAt:        new Date().toISOString(),
        effectiveFrom:      chunk.effectiveFrom?.toISOString(),
        effectiveTo:        chunk.effectiveTo?.toISOString(),
      },
      currentness: {
        status:           chunk.isCurrent ? "CURRENT" : "SUPERSEDED",
        checkedAt:        new Date().toISOString(),
        version:          chunk.sourceVersionLabel ?? chunk.sourceVersionId,
        supersededStatus: chunk.isCurrent ? null : (chunk.sourceVersionStatus ?? "not_current"),
      },
      semanticScore:            chunk.semanticScore,
      lexicalScore:             chunk.lexicalScore,
    }));

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
