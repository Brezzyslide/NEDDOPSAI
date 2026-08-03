/**
 * knowledge_chunks — Task #15 (Knowledge Schema, Scopes & Secure Upload)
 *
 * PLACEHOLDER TABLE — Task #16 populates this; Task #15 only defines the schema.
 *
 * Stores extracted text chunks from knowledge source documents.
 * Each chunk is a retrievable unit of the Organisation Library.
 *
 * Extraction, chunking, and embedding are NOT implemented until Task #16.
 * All rows in this table will have:
 *   - NULL embedding (to be populated by Task #16 with a pgvector float[])
 *   - NULL lexicalSearchVector (to be converted to tsvector by Task #16)
 *
 * CITATION SUPPORT:
 *   (knowledgeSourceId, sourceVersionId, chunkIndex, pageNumber, headingPath)
 *   provides the citation key for the future Completed Work module.
 *   Retrieval audit events reference specific chunk IDs for attribution.
 *
 * EMBEDDING COMPATIBILITY:
 *   The embedding column stores a JSON array of floats as a placeholder.
 *   Task #16 will ALTER the column to vector(N) when pgvector is enabled,
 *   or keep jsonb if using a separate embeddings table pattern.
 *
 * Tenant isolation enforced by RLS on organization_id.
 */
import { pgTable, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { knowledgeSourcesTable } from "./knowledgeSources.js";
import { knowledgeSourceVersionsTable } from "./knowledgeSourceVersions.js";

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
   * Lexical search vector placeholder.
   * Task #16 will populate as tsvector for full-text search.
   * Column type will be changed to tsvector in the Task #16 migration.
   */
  lexicalSearchVector: text("lexical_search_vector"),

  /**
   * Embedding vector placeholder — compatible with pgvector.
   * Task #16 will populate with float[] from the configured embedding model.
   * Stored as jsonb until pgvector extension is enabled.
   * Column type: ALTER to vector(dimensions) in Task #16 migration.
   */
  embedding: jsonb("embedding"),

  /** Embedding model used e.g. "text-embedding-3-small", "text-embedding-ada-002" */
  embeddingModel: text("embedding_model"),

  /** Embedding vector dimensionality e.g. 1536, 3072 */
  embeddingDimensions: integer("embedding_dimensions"),

  /** SHA-256 hex of this chunk's text — for change detection on re-ingestion */
  contentHash: text("content_hash"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  /** Soft delete — chunk may be tombstoned without removing the source */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type KnowledgeChunk       = typeof knowledgeChunksTable.$inferSelect;
export type InsertKnowledgeChunk = typeof knowledgeChunksTable.$inferInsert;
