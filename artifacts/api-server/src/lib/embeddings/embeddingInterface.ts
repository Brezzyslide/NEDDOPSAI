/**
 * Knowledge Hub — Embedding Provider Interface
 *
 * Provider-neutral interface for generating text embeddings.
 * The OpenAI implementation is the first provider; the interface must remain
 * swappable for self-hosted or alternative models.
 *
 * Sensitive document controls:
 *   - The caller (ingestion pipeline) checks canEmbedExternally() before calling.
 *   - Providers never log raw text content or participant data.
 *   - Every batch triggers an audit event (written by the pipeline, not here).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmbeddingResult {
  /** The embedding vector as a float array */
  embedding: number[];
  /** Number of tokens consumed */
  inputTokens: number;
}

export interface BatchEmbeddingResult {
  embeddings: EmbeddingResult[];
  /** Total tokens across the batch */
  totalInputTokens: number;
  /** Model that produced these embeddings */
  model: string;
  /** Provider that produced these embeddings */
  provider: string;
  /** Dimensionality of each embedding */
  dimensions: number;
}

export interface EmbeddingCostMetadata {
  /** Estimated cost in USD (may be null if unavailable) */
  estimatedCostUsd: number | null;
  inputTokens: number;
  pricePerThousandTokens: number | null;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export type EmbeddingErrorCode =
  | "PROVIDER_NOT_CONFIGURED"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "API_ERROR"
  | "MODEL_MISMATCH"
  | "EMBEDDING_DISABLED"
  | "BATCH_TOO_LARGE"
  | "TEXT_TOO_LONG";

export class EmbeddingError extends Error {
  readonly code: EmbeddingErrorCode;
  constructor(message: string, code: EmbeddingErrorCode) {
    super(message);
    this.name = "EmbeddingError";
    this.code = code;
    Object.setPrototypeOf(this, EmbeddingError.prototype);
  }
}

// ─── Provider interface ───────────────────────────────────────────────────────

export interface EmbeddingProvider {
  /**
   * Generate an embedding for a single text string.
   * Throws EmbeddingError on failure.
   */
  generateEmbedding(text: string): Promise<EmbeddingResult>;

  /**
   * Generate embeddings for a batch of texts.
   * Implementations should chunk batches to stay within API limits.
   * Throws EmbeddingError on unrecoverable failure.
   */
  generateEmbeddings(texts: string[]): Promise<BatchEmbeddingResult>;

  /** e.g. "text-embedding-3-small", "text-embedding-ada-002" */
  getModelName(): string;

  /** Dimensionality of this model's output (e.g. 1536, 3072) */
  getDimensions(): number;

  /** e.g. "openai", "null", "local" */
  getProviderName(): string;

  /** Returns true when the provider can produce real embeddings */
  isActive(): boolean;

  /** Probe provider availability */
  healthCheck(): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
}
