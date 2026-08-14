/**
 * TaskUploadProvider — P1 Knowledge Provider
 *
 * Retrieves documents uploaded specifically for the current task.
 * Highest priority — always included before any library document.
 * Never automatically promoted into the Organisation Library.
 *
 * Scope: sourceScope = 'task' AND task_id = context.taskId
 */
import { randomUUID } from "crypto";
import type {
  IKnowledgeProvider,
  RetrievalContext,
  KnowledgeProviderResult,
  KnowledgeItem,
} from "../IKnowledgeProvider.js";
import {
  retrieveChunks,
  computeFreshnessBonus,
  computeAuthorityBonus,
} from "../../../services/hybridRetrievalService.js";

export class TaskUploadProvider implements IKnowledgeProvider {
  readonly providerId   = "task_upload";
  readonly displayName  = "Task Upload Provider (P1)";
  readonly priorityLayer = "task_upload" as const;
  readonly isImplemented = true;

  async retrieve(context: RetrievalContext): Promise<KnowledgeProviderResult> {
    const start = Date.now();

    if (!context.taskId) {
      return {
        provider: this.providerId,
        priorityLayer: this.priorityLayer,
        items: [],
        durationMs: Date.now() - start,
      };
    }

    const chunks = await retrieveChunks({
      organisationId:    context.organisationId,
      query:             context.query,
      queryEmbedding:    context.queryEmbedding ?? null,
      scopeMode:         "task_upload",
      taskId:            context.taskId,
      allowedSensitivity: context.allowedSensitivity,
      excludeSourceIds:  context.excludeSourceIds ?? [],
      limit:             context.maxItems ?? 20,
    });

    const items: KnowledgeItem[] = chunks.map(chunk => ({
      itemId:                   randomUUID(),
      provider:                 this.providerId,
      priorityLayer:            "task_upload",
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
        sourceOrigin:       "task_upload",
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
