/**
 * Resource Registry — Sprint 29B
 *
 * Decouples the execution engine from provider implementations.
 * The engine requests evidence; the registry decides which provider resolves it.
 *
 * Design rule: the execution engine must never know which provider is active.
 * Provider selection is the registry's responsibility, driven by ResourcePlan
 * priority and availability — not by execution logic.
 *
 * Sprint 29B: KnowledgeResolutionService (P1–P5) is the sole active provider.
 * Future sprints register ConnectorProvider (P6), CloudProvider (P7), and
 * TrustedSourceProvider (P8) without touching the engine.
 */

import {
  resolveEvidence,
  type EvidencePack,
} from "../../services/knowledgeResolutionService.js";
import type { WorkPackageManifest } from "../../services/workPackageService.js";
import type { WorkBlueprint } from "../../services/workBlueprintService.js";
import type { IResourceProvider, ResourceProviderCode } from "./types.js";

// ─── Registry ─────────────────────────────────────────────────────────────────

export class ResourceRegistry {
  private readonly providers = new Map<ResourceProviderCode, IResourceProvider>();

  /**
   * Register a provider. Returns `this` for chaining.
   * Later registrations overwrite earlier ones for the same providerCode.
   */
  register(provider: IResourceProvider): this {
    this.providers.set(provider.providerCode, provider);
    return this;
  }

  getProvider(code: ResourceProviderCode): IResourceProvider | undefined {
    return this.providers.get(code);
  }

  /**
   * Resolve evidence for task-driven execution (blueprint + manifest).
   *
   * Routes to KnowledgeResolutionService which handles P1 (task uploads),
   * P4 (specialist knowledge), and P5 (org library) in priority order.
   * P3 (org memory) is assembled separately via WorkPackageManifest.cosMemories.
   *
   * Future: when ConnectorProvider (P6) is implemented, the registry will
   * consult it here when the ResourcePlan specifies connector sources, or when
   * the org library returns insufficient evidence.
   */
  async resolveEvidenceForTask(params: {
    organisationId: string;
    specialistCode: string;
    blueprint: WorkBlueprint | null;
    workPackage: WorkPackageManifest;
    userRequest: string;
  }): Promise<EvidencePack> {
    return resolveEvidence(params);
  }

  /**
   * Resolve evidence for conversation-driven execution.
   *
   * Conversation steps currently do not consume the evidence pipeline —
   * the specialist receives org memory and conversation context instead.
   * Sprint 29C will wire org library retrieval into conversation context
   * so both execution paths share the same evidence quality.
   */
  async resolveEvidenceForConversation(_params: {
    organisationId: string;
    specialistRunId: string;
    userRequest?: string;
  }): Promise<null> {
    // Future: retrieve P5 org library evidence for conversation context
    return null;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a ResourceRegistry pre-loaded with the active providers.
 *
 * Sprint 29B: no explicit provider instances are registered — the registry
 * delegates to KnowledgeResolutionService directly in its task evidence method.
 * Once ConnectorProvider and CloudProvider are implemented, they register here.
 */
export function createResourceRegistry(): ResourceRegistry {
  return new ResourceRegistry();
}
