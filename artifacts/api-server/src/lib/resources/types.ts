/**
 * Resource Layer Types — Sprint 29B (Unified Execution Architecture)
 *
 * Establishes the foundational resource abstraction with three strictly
 * separated concepts:
 *
 *   Evidence         — read-only content a specialist consumes to produce output
 *   Resources        — live objects outside NeedsOps (files, mailboxes, tabs)
 *   Execution Actions — side effects produced after output (write, send, automate)
 *
 * ResourceHandle is the uniform currency. Every resolved resource — whether from
 * the org library, a connector, or a cloud provider — becomes a handle.
 * Providers know how to open handles; execution never works with raw paths.
 */

// ─── Provider codes ───────────────────────────────────────────────────────────

export type ResourceProviderCode =
  | "task_uploads"      // P1 — task-scoped uploaded files
  | "entity_knowledge"  // P2 — entity-scoped knowledge
  | "org_memory"        // P3 — approved organisation memory
  | "specialist"        // P4 — specialist-scoped knowledge
  | "org_library"       // P5 — organisation knowledge library
  | "connector"         // P6 — NeedsOps Connector (desktop files/apps) — future
  | "cloud"             // P7 — cloud providers (SharePoint, Drive, etc.) — future
  | "trusted_public";   // P8 — trusted public sources (legislation, standards) — future

export type ResourcePermission = "read" | "write" | "execute";

export type ResourceContentType =
  | "policy_document"
  | "procedure_document"
  | "legislation"
  | "standard"
  | "template"
  | "memory_item"
  | "task_upload"
  | "email"
  | "spreadsheet"
  | "presentation"
  | "file"
  | "unknown";

// ─── ResourceHandle ───────────────────────────────────────────────────────────

/**
 * A ResourceHandle is a typed, provider-attributed reference to any resolved
 * resource. It is the canonical unit of exchange between the ResourceRegistry,
 * the execution engine, and specialist prompts.
 *
 * Invariants:
 * - isTransient=true handles are never persisted beyond the execution.
 * - resolvedContent is populated for evidence handles (read before execution).
 * - resolvedContent is absent for live resource handles (opened at action time).
 */
export interface ResourceHandle {
  /** Unique identifier for this handle within the execution */
  id: string;
  /** Which provider produced this handle */
  provider: ResourceProviderCode;
  /** Provider-specific URI (org-library source ID, GCS path, local file path, etc.) */
  uri: string;
  /** Operations this handle permits */
  permissions: ResourcePermission[];
  /** Type of content represented */
  contentType: ResourceContentType;
  /** Provider-supplied metadata (title, version, author, etc.) */
  metadata: Record<string, unknown>;
  /** How confident the provider is that this resource matches the request (0–1) */
  confidence: number;
  /** True for connector/cloud resources not stored in the NeedsOps database */
  isTransient: boolean;
  /** Resolved content — populated for evidence handles; absent for live resource handles */
  resolvedContent?: string;
}

// ─── Evidence request ─────────────────────────────────────────────────────────

/**
 * Parameters passed to the ResourceRegistry when requesting evidence.
 * The registry routes to the appropriate providers based on priority and plan.
 */
export interface EvidenceRequest {
  executionId: string;
  organisationId: string;
  userRequest: string;
  searchTerms?: string[];
}

// ─── Provider contract ────────────────────────────────────────────────────────

/**
 * Contract for all resource providers registered with the ResourceRegistry.
 *
 * Providers are stateless. State lives in the registry and in handles.
 * Future providers (connector, cloud, trusted public) implement this interface
 * and register with the registry — the execution engine requires no changes.
 */
export interface IResourceProvider {
  readonly providerCode: ResourceProviderCode;
  /** Lower number = higher priority */
  readonly priority: number;
  /** False for placeholder/stub providers (FutureProviders) */
  readonly isImplemented: boolean;
  isAvailable(organisationId: string): Promise<boolean>;
  resolve(request: EvidenceRequest): Promise<ResourceHandle[]>;
  /** Optional — only write-capable providers implement this */
  write?(handle: ResourceHandle, content: string): Promise<void>;
}
