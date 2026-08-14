/**
 * SpecialistKnowledgeProvider — P4 Knowledge Provider
 *
 * Retrieves knowledge explicitly assigned to this specialist role.
 * Never retrieved by unrelated specialists unless explicitly shared.
 *
 * Scope: knowledge_source_scopes where scope_type = 'specialist'
 *        AND scope_id = context.specialistId
 *
 * Examples:
 *   - Incident management playbooks → scoped to 'incident_management'
 *   - Finance SOPs → scoped to 'financial_operations'
 *   - HR onboarding guides → scoped to 'hr_specialist'
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

export class SpecialistKnowledgeProvider implements IKnowledgeProvider {
  readonly providerId    = "specialist_knowledge";
  readonly displayName   = "Specialist Knowledge Provider (P4)";
  readonly priorityLayer = "specialist" as const;
  readonly isImplemented = true;

  async retrieve(context: RetrievalContext): Promise<KnowledgeProviderResult> {
    const start = Date.now();

    const chunks = await retrieveChunks({
      organisationId:    context.organisationId,
      query:             context.query,
      queryEmbedding:    context.queryEmbedding ?? null,
      scopeMode:         "specialist_scoped",
      specialistId:      context.specialistId,
      allowedSensitivity: context.allowedSensitivity,
      excludeSourceIds:  context.excludeSourceIds ?? [],
      limit:             context.maxItems ?? 20,
    });

    const items: KnowledgeItem[] = chunks.map(chunk => {
      const retrievedAt = new Date().toISOString();
      return {
        itemId:                   randomUUID(),
        provider:                 this.providerId,
        priorityLayer:            "specialist",
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
          sourceOrigin:       "specialist_knowledge",
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
