import { lookupAuthorityById, normaliseDomain } from "./index.js";
import type { AcceptedEvidence } from "../../types/candidateEvidence.js";
import type { EvidenceChunk } from "../../services/knowledgeResolutionService.js";

export function buildAcceptedEvidenceChunk(
  accepted: AcceptedEvidence,
  selectionReason: string,
  externalPrefix = "ext",
): EvidenceChunk {
  const registryEntry = accepted.authorityRegistryId ? lookupAuthorityById(accepted.authorityRegistryId) : null;
  const cand = accepted.candidate;
  const sourceOrigin = cand.isExternal ? "external_authority" : "internal_krs";

  return {
    chunkId:         cand.discoveryId,
    sourceId:        accepted.canonicalSourceId ?? `${externalPrefix}-${cand.discoveryId}`,
    sourceVersionId: accepted.canonicalVersionId ?? null,
    sourceTitle:     cand.sourceTitle,
    versionLabel:    cand.publicationDate ?? null,
    sourceType:      cand.contentType,
    authorityLevel:  accepted.authorityClass,
    sectionTitle:    null,
    pageNumber:      null,
    text:            cand.supportingPassage,
    confidence:      cand.relevanceScore,
    citation:        `${cand.sourceTitle}${cand.sourceUrl ? ` (${cand.sourceUrl})` : ""}`,
    selectionReason,
    provenance: {
      sourceOrigin,
      authorityRegistryId: accepted.authorityRegistryId,
      authorityName:       registryEntry?.name,
      authorityClass:      registryEntry?.sourceClass,
      jurisdiction:        cand.jurisdiction ?? registryEntry?.jurisdictions[0],
      professionalDomains: registryEntry?.professionalDomains,
      transport:           registryEntry?.currentTransport ?? (cand.isExternal ? "GOVERNED_WEB" : "INTERNAL_KRS"),
      originalUrl:         cand.sourceUrl,
      recordIdentifier:    accepted.canonicalSourceId ?? cand.sourceUrl ?? cand.discoveryId,
      documentIdentifier:  accepted.canonicalVersionId ?? cand.sourceUrl ?? cand.discoveryId,
      publisherDomain:     cand.publisherDomain ?? (cand.sourceUrl ? normaliseDomain(cand.sourceUrl) : undefined),
      claimedPublisher:    cand.claimedPublisher,
      retrievedAt:         cand.retrievalTimestamp,
      publishedAt:         cand.publicationDate,
      effectiveFrom:       cand.effectiveDate,
    },
    currentness: {
      status: "UNKNOWN",
      checkedAt: cand.retrievalTimestamp,
      version: cand.publicationDate ?? null,
      supersededStatus: null,
    },
  };
}
