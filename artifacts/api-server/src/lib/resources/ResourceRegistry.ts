/**
 * Resource Registry — Sprint 29B (foundation) / Sprint 29E (P6 upgrade)
 *
 * Architecture rule (non-negotiable, Sprint 29E):
 *
 *   The Unified Execution Engine never selects providers.
 *   The ResourceRegistry never interprets user intent.
 *   The Chief of Staff determines provider preference through Capability Planning
 *   and Resource Planning (EvidenceRequest.preferredProviders[]).
 *   The ResourceRegistry simply executes the approved provider plan, while each
 *   provider encapsulates its own connection lifecycle (isAvailable → resolve → close).
 *
 * Three-stage resolution model (Sprint 29E):
 *
 *   Stage 1 — Organisation knowledge (KnowledgeResolutionService, P1–P5):
 *     KRS is not refactored into an IResourceProvider — it owns org knowledge
 *     retrieval and its interface is stable. It runs unconditionally on every
 *     evidence request.
 *
 *   Stage 2 — External providers (IResourceProvider implementations, P6+):
 *     Registered providers run after KRS in priority order. A provider runs
 *     when: (a) isImplemented=true, (b) isAvailable() returns true, and
 *     (c) the provider code is in preferredProviders[] OR preferredProviders is empty.
 *     If a provider is in preferredProviders[] but isAvailable() returns false,
 *     ConnectorCapabilityError is thrown (no AI execution starts).
 *
 *   Stage 3 — Merge:
 *     All ResourceHandle[] from external providers are converted to EvidenceChunk[]
 *     via the private adapter (Deliverable B). The resulting chunks are merged into
 *     the KRS EvidencePack and re-ranked by confidence DESC.
 *
 * Design principle: the execution engine must remain unaware of which provider
 * supplied each chunk. Specialists reason over a unified EvidencePack only.
 */

import {
  resolveEvidence,
  resolveConversationEvidence,
  type EvidencePack,
  type EvidenceChunk,
} from "../../services/knowledgeResolutionService.js";
import type { WorkPackageManifest } from "../../services/workPackageService.js";
import type { WorkBlueprint } from "../../services/workBlueprintService.js";
import type {
  IResourceProvider,
  ResourceHandle,
  ResourceContentType,
  EvidenceRequest,
} from "./types.js";
import { ConnectorCapabilityError } from "./types.js";
import { logger } from "../../lib/logger.js";
import { createConnectorEvidenceResolver } from "../../services/connectorEvidenceResolverService.js";

// ─── Registry ─────────────────────────────────────────────────────────────────

export class ResourceRegistry {
  private readonly providers = new Map<string, IResourceProvider>();

  /**
   * Register an external provider. Returns `this` for chaining.
   * Later registrations overwrite earlier ones for the same providerCode.
   */
  register(provider: IResourceProvider): this {
    this.providers.set(provider.providerCode, provider);
    return this;
  }

  getProvider(code: string): IResourceProvider | undefined {
    return this.providers.get(code);
  }

  /**
   * Stage 1 + 2 + 3: Resolve evidence for task-driven execution.
   *
   * Stage 1: KnowledgeResolutionService handles P1 (task uploads),
   *           P4 (specialist knowledge), and P5 (org library).
   * Stage 2: Registered external providers (P6+) run in priority order.
   * Stage 3: External handles are converted via the private adapter and
   *           merged into the KRS pack.
   *
   * The execution engine is unaware of which provider supplied each chunk.
   */
  async resolveEvidenceForTask(params: {
    organisationId: string;
    specialistCode: string;
    blueprint: WorkBlueprint | null;
    workPackage: WorkPackageManifest;
    userRequest: string;
    preferredProviders?: string[];
  }): Promise<EvidencePack> {
    // Stage 1: KRS (P1–P5)
    const krspack = await resolveEvidence(params);

    // Stage 2 + 3: External providers
    const request: EvidenceRequest = {
      executionId:        params.workPackage.executionId,
      organisationId:     params.organisationId,
      userRequest:        params.userRequest,
      preferredProviders: params.preferredProviders ?? [],
    };
    const externalChunks = await this.resolveFromExternalProviders(request);

    return this.mergeEvidencePacks(krspack, externalChunks, params.workPackage.executionId);
  }

  /**
   * Stage 1 + 2 + 3: Resolve evidence for conversation-driven execution.
   *
   * Sprint 29C: both paths use identical evidence quality. Sprint 29E: external
   * providers (P6+) now supplement the org library for both paths.
   */
  async resolveEvidenceForConversation(params: {
    organisationId: string;
    specialistRunId: string;
    specialistCode: string;
    userRequest: string;
    preferredProviders?: string[];
  }): Promise<EvidencePack | null> {
    // Stage 1: KRS
    let krspack: EvidencePack | null = null;
    try {
      krspack = await resolveConversationEvidence({
        organisationId: params.organisationId,
        specialistCode: params.specialistCode,
        query:          params.userRequest,
        conversationId: params.specialistRunId,
      });
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        "[ResourceRegistry] resolveConversationEvidence failed (non-fatal)",
      );
    }

    // Stage 2 + 3: External providers
    const request: EvidenceRequest = {
      executionId:        params.specialistRunId,
      organisationId:     params.organisationId,
      userRequest:        params.userRequest,
      preferredProviders: params.preferredProviders ?? [],
    };

    let externalChunks: EvidenceChunk[] = [];
    try {
      externalChunks = await this.resolveFromExternalProviders(request);
    } catch (err) {
      if (err instanceof ConnectorCapabilityError) {
        // Required connector is unavailable — propagate
        throw err;
      }
      logger.warn(
        { err: (err as Error).message },
        "[ResourceRegistry] External provider resolution failed (non-fatal)",
      );
    }

    if (!krspack && externalChunks.length === 0) return null;

    // Build a minimal EvidencePack from connector-only chunks if KRS returned nothing
    const basePack = krspack ?? buildEmptyPack(params.specialistRunId, params.organisationId);
    return this.mergeEvidencePacks(basePack, externalChunks, params.specialistRunId);
  }

  // ─── Stage 2: External provider resolution ──────────────────────────────────

  /**
   * Run each registered external provider in priority order.
   *
   * Provider lifecycle: isAvailable() → resolve() → close()
   *
   * If a provider is in preferredProviders and unavailable:
   *   → throw ConnectorCapabilityError (execution blocked, no AI starts)
   * If a provider is available but NOT in preferredProviders (when set):
   *   → skip it (registry executes the plan, never adds unpanned providers)
   * If preferredProviders is empty:
   *   → all available providers run as supplements
   */
  private async resolveFromExternalProviders(
    request: EvidenceRequest,
  ): Promise<EvidenceChunk[]> {
    const providers = Array.from(this.providers.values())
      .filter(p => p.isImplemented)
      .sort((a, b) => a.priority - b.priority);

    if (providers.length === 0) return [];

    const preferred = request.preferredProviders ?? [];
    const hasPreferred = preferred.length > 0;
    const allChunks: EvidenceChunk[] = [];

    for (const provider of providers) {
      const code = provider.providerCode;

      // When preferredProviders is set, only run listed providers
      if (hasPreferred && !preferred.includes(code)) {
        continue;
      }

      let available = false;
      try {
        available = await provider.isAvailable(request.organisationId);
      } catch {
        available = false;
      }

      if (!available) {
        if (hasPreferred && preferred.includes(code)) {
          // Required provider unavailable — throw structured capability error
          throw new ConnectorCapabilityError(
            "REQUIRED_PROVIDER_UNAVAILABLE",
            `The provider "${code}" is required for this execution but is currently unavailable. ` +
            `Please ensure the NeedsOps Connector is running and connected.`,
          );
        }
        // Supplementary provider unavailable — silently skip
        continue;
      }

      let handles: ResourceHandle[] = [];
      try {
        handles = await provider.resolve(request);
      } catch (err) {
        if (err instanceof ConnectorCapabilityError) throw err;
        logger.warn(
          { providerCode: code, err: (err as Error).message },
          "[ResourceRegistry] Provider resolve() failed (non-fatal)",
        );
      } finally {
        try {
          await provider.close();
        } catch {
          // close() failures are never fatal
        }
      }

      if (handles.length > 0) {
        const chunks = this.evidenceChunksFromHandles(handles, request.executionId);
        allChunks.push(...chunks);

        logger.info(
          { providerCode: code, handleCount: handles.length, chunkCount: chunks.length },
          "[ResourceRegistry] External provider contributed evidence",
        );
      }
    }

    return allChunks;
  }

  // ─── Deliverable B: ResourceHandle → EvidenceChunk adapter ─────────────────

  /**
   * Private adapter: converts ResourceHandle[] from external providers into
   * EvidenceChunk[] compatible with the existing EvidencePack schema.
   *
   * Architecture rule: only this registry method may construct EvidenceChunk
   * from external provider handles. No provider constructs EvidenceChunk directly.
   * This adapter is the permanent bridge for all future providers
   * (Connector, SharePoint, Google Drive, OneDrive, Notion, Confluence,
   * trusted public sources).
   *
   * Mapping:
   *   handle.id                → chunkId
   *   handle.uri               → sourceId
   *   handle.metadata.title    → sourceTitle
   *   handle.metadata.version  → versionLabel
   *   handle.contentType       → sourceType (mapped)
   *   handle.resolvedContent   → text
   *   handle.confidence        → confidence
   *   "supporting"             → authorityLevel (external files are supporting evidence)
   *   "Desktop File: {title}"  → citation
   *   "desktop_file"           → selectionReason
   */
  private evidenceChunksFromHandles(
    handles: ResourceHandle[],
    executionId: string,
  ): EvidenceChunk[] {
    return handles
      .filter(h => h.resolvedContent && h.resolvedContent.length > 0)
      .map(handle => {
        const title = handle.metadata.title ? String(handle.metadata.title) : handle.uri;
        const version = handle.metadata.version ? String(handle.metadata.version) : null;
        const section = handle.metadata.section ? String(handle.metadata.section) : null;
        const pageNumber = typeof handle.metadata.pageNumber === "number"
          ? handle.metadata.pageNumber
          : null;

        return {
          chunkId:       handle.id,
          sourceId:      handle.uri,
          sourceTitle:   title,
          versionLabel:  version,
          sourceType:    this.mapContentTypeToSourceType(handle.contentType),
          authorityLevel: "supporting",
          sectionTitle:  section,
          pageNumber,
          text:          handle.resolvedContent ?? "",
          confidence:    handle.confidence,
          citation:      `Desktop File: ${title}`,
          selectionReason: "desktop_file",
        } satisfies EvidenceChunk;
      });
  }

  /**
   * Maps ResourceContentType to the source type strings used throughout
   * KnowledgeResolutionService and the specialist prompt builder.
   */
  private mapContentTypeToSourceType(ct: ResourceContentType): string {
    const mapping: Record<ResourceContentType, string> = {
      policy_document:    "policy",
      procedure_document: "procedure",
      legislation:        "legislation",
      standard:           "standards",
      template:           "template",
      memory_item:        "reference",
      task_upload:        "task_upload",
      email:              "reference",
      spreadsheet:        "reference",
      presentation:       "reference",
      file:               "reference",
      unknown:            "reference",
    };
    return mapping[ct] ?? "reference";
  }

  // ─── Stage 3: Merge ─────────────────────────────────────────────────────────

  /**
   * Merge external EvidenceChunk[] into an existing KRS EvidencePack.
   *
   * When external chunks are present, they are interleaved with KRS chunks
   * and the full set is re-sorted by confidence DESC — specialists receive
   * a single unified pack with no provider distinction visible.
   */
  private mergeEvidencePacks(
    base: EvidencePack,
    externalChunks: EvidenceChunk[],
    executionId: string,
  ): EvidencePack {
    if (externalChunks.length === 0) return base;

    const merged = [...base.chunks, ...externalChunks];
    // Deduplicate by chunkId (unlikely collision but defensive)
    const seen = new Set<string>();
    const deduped = merged.filter(c => {
      if (seen.has(c.chunkId)) return false;
      seen.add(c.chunkId);
      return true;
    });

    // Sort by confidence DESC — unified ranking regardless of provider
    deduped.sort((a, b) => b.confidence - a.confidence);

    // Rebuild source IDs — include all external sources
    const externalSourceIds = [...new Set(externalChunks.map(c => c.sourceId))];
    const newSourceIds = [...new Set([...base.sourceIds, ...externalSourceIds])];

    // Rebuild citationsByType — include external source types
    const citationsByType: Record<string, EvidenceChunk[]> = { ...base.citationsByType };
    for (const chunk of externalChunks) {
      if (!citationsByType[chunk.sourceType]) {
        citationsByType[chunk.sourceType] = [];
      }
      citationsByType[chunk.sourceType]!.push(chunk);
    }

    const avgConfidence = deduped.length > 0
      ? Math.round((deduped.reduce((s, c) => s + c.confidence, 0) / deduped.length) * 1000) / 1000
      : 0;

    return {
      executionId,
      organisationId: base.organisationId,
      resolvedAt:     base.resolvedAt,
      chunks:         deduped,
      sourceIds:      newSourceIds,
      citationsByType,
      totalChunks:    deduped.length,
      avgConfidence,
      retrievalMetrics: {
        ...base.retrievalMetrics,
        selectedChunks: deduped.length,
        totalCandidates: (base.retrievalMetrics?.totalCandidates ?? 0) + externalChunks.length,
      },
    };
  }
}

// ─── Internal helper ──────────────────────────────────────────────────────────

function buildEmptyPack(executionId: string, organisationId: string): EvidencePack {
  return {
    executionId,
    organisationId,
    resolvedAt:       new Date(),
    chunks:           [],
    sourceIds:        [],
    citationsByType:  {},
    totalChunks:      0,
    avgConfidence:    0,
    retrievalMetrics: {
      queryCount:      0,
      totalCandidates: 0,
      selectedChunks:  0,
      cacheHit:        false,
      retrievalMs:     0,
    },
  };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a ResourceRegistry pre-loaded with active providers.
 *
 * Sprint 29E: ConnectorEvidenceResolver (P6) is registered here.
 * Future providers (P7 cloud, P8 trusted public) register here without
 * touching the execution engine.
 */
export function createResourceRegistry(): ResourceRegistry {
  const registry = new ResourceRegistry();

  // Register P6 — NeedsOps Connector evidence provider.
  // The engine is unaware which providers are registered here.
  // Future providers (P7 cloud, P8 trusted public) register here too.
  registry.register(createConnectorEvidenceResolver());

  return registry;
}
