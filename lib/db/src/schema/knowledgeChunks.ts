/**
 * knowledge_chunks — Task #15 schema, Task #16 implementation
 *
 * Stores extracted text chunks from knowledge source documents.
 * Each chunk is a retrievable unit of the Organisation Library (Knowledge Hub).
 *
 * CITATION SUPPORT:
 *   (knowledgeSourceId, sourceVersionId, chunkIndex, pageNumber, headingPath)
 *   provides the citation key for the future Completed Work module.
 *   Retrieval audit events reference specific chunk IDs for attribution.
 *
 * VECTOR SEARCH:
 *   embedding: vector(1536) — enabled in Task #16 via pgvector migration
 *   lexicalSearchVector: generated tsvector stored column (auto-updated by Postgres)
 *
 * CHUNKING STRATEGY:
 *   chunkingStrategy + chunkingStrategyVersion enable re-chunking when the
 *   strategy changes; only chunks with matching versions are used for retrieval.
 *
 * Tenant isolation enforced by RLS on organization_id.
 */
import { pgTable, text, timestamp, integer, customType } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { knowledgeSourcesTable } from "./knowledgeSources.js";
import { knowledgeSourceVersionsTable } from "./knowledgeSourceVersions.js";

// ─── Custom pgvector type ─────────────────────────────────────────────────────

/**
 * pgVector — Drizzle custom type wrapping PostgreSQL vector(N).
 *
 * Requires pgvector extension (enabled in Task #16 migration).
 * TypeScript: number[] | null
 * Driver format: "[0.1,0.2,...]"
 */
const pgVector = customType<{
  data: number[] | null;
  driverData: string | null;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1536})`;
  },
  toDriver(value: number[] | null): string | null {
    if (value === null || value === undefined) return null;
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string | null): number[] | null {
    if (!value) return null;
    // Postgres returns "[0.1,0.2,...]"
    return value.slice(1, -1).split(",").map(Number);
  },
});

// ─── Table definition ─────────────────────────────────────────────────────────

export const knowledgeChunksTable = pgTable("knowledge_chunks", {
  id: text("id").primaryKey(),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  knowledgeSourceId: text("knowledge_source_id")
    .notNull()
    .references(() => knowledgeSourcesTable.id, { onDelete: "cascade" }),

  sourceVersionId: text("source_version_id")
    .notNull()
    .references(() => knowledgeSourceVersionsTable.id, { onDelete: "cascade" }),

  /** Zero-based position of this chunk within the document */
  chunkIndex: integer("chunk_index").notNull(),

  /** Section heading this chunk falls under (for citation display) */
  sectionTitle: text("section_title"),

  /** Page number (1-based) in the source document */
  pageNumber: integer("page_number"),

  /**
   * Breadcrumb heading path for citation display.
   * e.g. "Policy > Security > Access Control > Remote Access"
   */
  headingPath: text("heading_path"),

  /** The raw extracted text content of this chunk */
  text: text("text").notNull(),

  /** Approximate token count for context budget management */
  tokenCount: integer("token_count"),

  /**
   * Lexical (full-text) search vector.
   * DB type: tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
   * Defined as text here for Drizzle compatibility; never write from application.
   * Task #17 uses this column for lexical retrieval via GIN index.
   */
  lexicalSearchVector: text("lexical_search_vector"),

  /**
   * Embedding vector — vector(1536) in the database (pgvector).
   * Enabled by Task #16 migration. TypeScript type: number[] | null.
   * Model: typically "text-embedding-3-small" (1536 dims).
   * NULL when embedding was skipped (sensitivity restriction, provider disabled).
   */
  embedding: pgVector("embedding", { dimensions: 1536 }),

  /** Embedding model used e.g. "text-embedding-3-small", "text-embedding-ada-002" */
  embeddingModel: text("embedding_model"),

  /** Embedding vector dimensionality e.g. 1536, 3072 */
  embeddingDimensions: integer("embedding_dimensions"),

  /** SHA-256 hex of this chunk's text — for change detection on re-ingestion */
  contentHash: text("content_hash"),

  /**
   * Chunking strategy identifier.
   * e.g. "heading_aware_v1"
   * Allows re-chunking when the strategy changes without invalidating other chunks.
   */
  chunkingStrategy: text("chunking_strategy").notNull().default("heading_aware_v1"),

  /**
   * Semver version of the chunking strategy implementation.
   * Bump when chunk boundaries change to trigger re-embedding.
   */
  chunkingStrategyVersion: text("chunking_strategy_version").notNull().default("1.0.0"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  /** Soft delete — chunk may be tombstoned without removing the source */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type KnowledgeChunk       = typeof knowledgeChunksTable.$inferSelect;
export type InsertKnowledgeChunk = typeof knowledgeChunksTable.$inferInsert;
