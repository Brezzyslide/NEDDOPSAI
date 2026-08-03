/**
 * Knowledge Hub — Null Embedding Provider
 *
 * Used when:
 *   - No embedding provider is configured
 *   - The organisation has disabled external embeddings for a sensitivity level
 *   - The document is classified as RESTRICTED
 *
 * Returns zero-vectors. Semantic search is reported as disabled.
 * Never throws — the pipeline gracefully degrades to lexical-only retrieval.
 */

import type {
  EmbeddingProvider,
  EmbeddingResult,
  BatchEmbeddingResult,
} from "./embeddingInterface.js";

const DIMENSIONS = 1536;

export class NullEmbeddingProvider implements EmbeddingProvider {
  async generateEmbedding(_text: string): Promise<EmbeddingResult> {
    return { embedding: new Array(DIMENSIONS).fill(0), inputTokens: 0 };
  }

  async generateEmbeddings(texts: string[]): Promise<BatchEmbeddingResult> {
    return {
      embeddings: texts.map(() => ({
        embedding: new Array(DIMENSIONS).fill(0),
        inputTokens: 0,
      })),
      totalInputTokens: 0,
      model: "null",
      provider: "null",
      dimensions: DIMENSIONS,
    };
  }

  getModelName(): string { return "null"; }
  getDimensions(): number { return DIMENSIONS; }
  getProviderName(): string { return "null"; }
  isActive(): boolean { return false; }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number }> {
    return { ok: true, latencyMs: 0 };
  }
}
