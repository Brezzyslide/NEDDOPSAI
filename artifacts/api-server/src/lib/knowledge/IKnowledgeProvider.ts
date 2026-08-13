/**
 * IKnowledgeProvider — Task #17 (Knowledge Orchestration Engine)
 *
 * Provider-neutral interface for every knowledge source that can contribute
 * to the orchestrated specialist context.
 *
 * Priority registry:
 *   P1  TaskUploadProvider        — documents uploaded for the current task only
 *   P2  EntityKnowledgeProvider   — participant / client / project / contract / ...
 *   P3  OrgMemoryProvider         — approved Chief of Staff memory
 *   P4  SpecialistKnowledgeProvider — knowledge scoped to this specialist role
 *   P5  OrganisationLibraryProvider — approved org-wide library documents
 *   P6  DesktopConnectorProvider  — local desktop files (interface only)
 *   P7  Cloud providers           — SharePoint, GDrive, OneDrive, Confluence, Notion
 *   P8  WebSearchProvider         — live web search (interface only)
 *
 * Rule: P6-P8 MUST return NotImplementedResult (never throw).
 * Rule: All providers MUST be tenant-isolated (organisationId filter).
 * Rule: All providers MUST honour sensitivity gating.
 */

// ─── Core retrieval types ──────────────────────────────────────────────────────

/** Sensitivity levels in ascending order of restriction */
export type SensitivityLevel =
  | "public"
  | "internal"
  | "confidential"
  | "restricted"
  | "highly_confidential";

/** Authority levels — higher authority wins in conflict resolution */
export type AuthorityLevel =
  | "mandatory"
  | "authoritative"
  | "primary"
  | "supporting"
  | "reference"
  | "reference_only"
  | "example_only";

/** Priority layer for ordering and token budget allocation */
export type PriorityLayer =
  | "task_upload"        // P1
  | "entity"             // P2
  | "org_memory"         // P3
  | "specialist"         // P4
  | "library"            // P5
  | "desktop"            // P6
  | "cloud"              // P7
  | "web_search";        // P8

/**
 * A single retrieved knowledge item.
 * Never contains raw document content in sensitive fields.
 */
export interface KnowledgeItem {
  /** Globally unique ID for this item */
  itemId: string;
  /** Provider that produced this item */
  provider: string;
  /** Priority layer */
  priorityLayer: PriorityLayer;

  // ── Attribution ─────────────────────────────────────────────────────────────
  /** knowledge_sources.id or equivalent external ID */
  sourceId: string;
  /** knowledge_source_versions.id — null for memory / external */
  versionId: string | null;
  /** knowledge_chunks.id — null for memory / structured items */
  chunkId: string | null;

  /** Human-readable source title */
  sourceTitle: string;
  /** Section heading within the source */
  sectionTitle: string | null;
  /** 1-based page number */
  pageNumber: number | null;
  /** Breadcrumb heading path e.g. "Policy > Safety > Remote Access" */
  headingPath: string | null;

  // ── Content ─────────────────────────────────────────────────────────────────
  /** Text content — MUST NOT be filtered or truncated by the provider */
  content: string;
  /** Approximate token count */
  tokenCount: number;

  // ── Governance ──────────────────────────────────────────────────────────────
  authorityLevel: AuthorityLevel;
  sensitivityClassification: SensitivityLevel;
  /** ISO-8601 effective from date */
  effectiveFrom: string | null;
  /** ISO-8601 effective to date */
  effectiveTo: string | null;
  /** Whether this is the current version of the source */
  isCurrent: boolean;

  // ── Retrieval scores ─────────────────────────────────────────────────────────
  semanticScore: number;   // 0–1 cosine similarity (0 if not computed)
  lexicalScore:  number;   // 0–1 ts_rank normalised (0 if not computed)
}

/**
 * Retrieval context passed to every provider.
 */
export interface RetrievalContext {
  organisationId:  string;
  specialistId:    string;
  query:           string;
  queryEmbedding?: number[] | null;
  taskId?:         string | null;
  entityIds?:      string[];
  maxItems?:       number;
  tokenBudget?:    number;
  /** Sensitivity levels the caller is permitted to see */
  allowedSensitivity?: SensitivityLevel[];
  /** Source IDs to skip (already included from higher-priority layer) */
  excludeSourceIds?: string[];
}

/**
 * Result returned by every knowledge provider.
 */
export interface KnowledgeProviderResult {
  provider:         string;
  priorityLayer:    PriorityLayer;
  items:            KnowledgeItem[];
  /** true when this provider returned NotImplemented (P6-P8) */
  notImplemented?:  boolean;
  /** Human-readable reason for not-implemented */
  notImplementedReason?: string;
  /** Retrieval time in ms for this provider */
  durationMs:       number;
  /** Source IDs that were found but excluded due to sensitivity */
  sensitivityBlocked?: string[];
  /** Source IDs excluded because superseded */
  supersededExcluded?: string[];
}

/**
 * Contract every knowledge provider must fulfil.
 */
export interface IKnowledgeProvider {
  /** Unique provider identifier */
  readonly providerId: string;
  /** Human-readable name */
  readonly displayName: string;
  /** Priority layer this provider serves */
  readonly priorityLayer: PriorityLayer;
  /** Whether this provider is implemented */
  readonly isImplemented: boolean;

  /**
   * Retrieve knowledge items for the given context.
   * MUST be tenant-isolated on context.organisationId.
   * MUST respect sensitivity gating.
   * P6-P8 MUST return { items: [], notImplemented: true }.
   */
  retrieve(context: RetrievalContext): Promise<KnowledgeProviderResult>;
}

// ─── Provider registry ────────────────────────────────────────────────────────

const _registry = new Map<string, IKnowledgeProvider>();

export function registerProvider(provider: IKnowledgeProvider): void {
  _registry.set(provider.providerId, provider);
}

export function getProvider(providerId: string): IKnowledgeProvider | undefined {
  return _registry.get(providerId);
}

export function getAllProviders(): IKnowledgeProvider[] {
  return Array.from(_registry.values()).sort((a, b) =>
    PRIORITY_ORDER.indexOf(a.priorityLayer) - PRIORITY_ORDER.indexOf(b.priorityLayer),
  );
}

/**
 * Clear the provider registry.
 * FOR TESTS ONLY — allows test isolation when tests register mock providers.
 */
export function _resetProviderRegistry(): void {
  _registry.clear();
}

export const PRIORITY_ORDER: PriorityLayer[] = [
  "task_upload",
  "entity",
  "org_memory",
  "specialist",
  "library",
  "desktop",
  "cloud",
  "web_search",
];

/** Authority bonus applied during ranking */
export const AUTHORITY_BONUS: Record<AuthorityLevel, number> = {
  mandatory:     0.30,
  authoritative: 0.20,
  primary:       0.20,
  supporting:    0.00,
  reference:    -0.05,
  reference_only:-0.05,
  example_only: -0.12,
};

/** Default sensitivity levels a standard specialist may access */
export const DEFAULT_ALLOWED_SENSITIVITY: SensitivityLevel[] = [
  "public",
  "internal",
  "confidential",
];

/** Sensitivity levels that require elevated clearance */
export const ELEVATED_SENSITIVITY_LEVELS: SensitivityLevel[] = [
  "restricted",
  "highly_confidential",
];
