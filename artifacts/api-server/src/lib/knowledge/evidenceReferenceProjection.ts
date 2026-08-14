import type { KnowledgeCitation } from "../../services/knowledgeOrchestrationEngine.js";

export interface LegacyEvidenceReference {
  referenceType: "conversation_message" | "task_memory" | "organisation_memory" | "document" | "message_attachment";
  referenceId: string;
  excerpt: string;
  relevance: string;
  sourceId?: string;
  sourceVersionId?: string | null;
  sourceTitle?: string;
  authorityLevel?: string;
  authorityName?: string;
  authorityClass?: string;
  jurisdiction?: string;
  transport?: string;
  currentness?: string;
  sourceOrigin?: string;
  originalUrl?: string;
  recordIdentifier?: string;
  documentIdentifier?: string;
  retrievedAt?: string;
}

export function projectKnowledgeCitationsToEvidenceReferences(
  citations: KnowledgeCitation[] | null | undefined,
): LegacyEvidenceReference[] {
  return (citations ?? []).map(citation => ({
    referenceType: "document",
    referenceId: citation.chunkId ?? citation.sourceId,
    excerpt: citation.sourceTitle,
    relevance: citation.reasonSelected,
    sourceId: citation.sourceId,
    sourceVersionId: citation.versionId,
    sourceTitle: citation.sourceTitle,
    authorityLevel: citation.authorityLevel,
    authorityName: citation.provenance?.authorityName,
    authorityClass: citation.provenance?.authorityClass,
    jurisdiction: citation.provenance?.jurisdiction,
    transport: citation.provenance?.transport,
    currentness: citation.currentness?.status ?? "UNKNOWN",
    sourceOrigin: citation.provenance?.sourceOrigin,
    originalUrl: citation.provenance?.originalUrl,
    recordIdentifier: citation.provenance?.recordIdentifier,
    documentIdentifier: citation.provenance?.documentIdentifier,
    retrievedAt: citation.provenance?.retrievedAt,
  }));
}
