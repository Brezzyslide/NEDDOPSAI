/**
 * Knowledge Hub — OpenAI Embedding Provider
 *
 * Uses the AI gateway's callOpenAIEmbeddings function (the only place where
 * the OpenAI SDK is used — lib/ai-gateway/src/providers/openai.ts).
 *
 * Model: text-embedding-3-small (1536 dimensions)
 * Batch: up to 96 texts per API call (handled internally)
 *
 * Never used for restricted-sensitivity sources — the NullEmbeddingProvider
 * is selected instead by the provider registry.
 */

import type { EmbeddingProvider, EmbeddingResult, BatchEmbeddingResult } from "./embeddingInterface.js";
import { EmbeddingError } from "./embeddingInterface.js";
import {
  callOpenAIEmbeddings,
  isOpenAIConfigured,
  getEmbeddingDimensions,
  OpenAIProviderError,
} from "@workspace/ai-gateway";

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    const result = await this.generateEmbeddings([text]);
    const first = result.embeddings[0];
    if (!first) {
      throw new EmbeddingError("No embedding returned for single text.", "API_ERROR");
    }
    return { embedding: first.embedding, inputTokens: result.totalInputTokens };
  }

  async generateEmbeddings(texts: string[]): Promise<BatchEmbeddingResult> {
    if (!isOpenAIConfigured()) {
      throw new EmbeddingError(
        "OpenAI API key is not configured. Set OPENAI_API_KEY to enable embeddings.",
        "PROVIDER_NOT_CONFIGURED",
      );
    }

    try {
      const res = await callOpenAIEmbeddings(texts);
      return {
        embeddings: res.embeddings.map((vec, i) => ({
          embedding: vec,
          inputTokens: 0, // per-item token count not available from batch API
        })),
        totalInputTokens: res.totalInputTokens,
        model: res.model,
        provider: "openai",
        dimensions: res.dimensions,
      };
    } catch (err) {
      if (err instanceof OpenAIProviderError) {
        switch (err.kind) {
          case "rate_limit":
            throw new EmbeddingError(err.message, "RATE_LIMITED");
          case "timeout":
            throw new EmbeddingError(err.message, "TIMEOUT");
          case "not_configured":
            throw new EmbeddingError(err.message, "PROVIDER_NOT_CONFIGURED");
          default:
            throw new EmbeddingError(err.message, "API_ERROR");
        }
      }
      throw new EmbeddingError(
        `Embedding failed: ${err instanceof Error ? err.message : String(err)}`,
        "API_ERROR",
      );
    }
  }

  getModelName(): string { return "text-embedding-3-small"; }
  getDimensions(): number { return getEmbeddingDimensions(); }
  getProviderName(): string { return "openai"; }
  isActive(): boolean { return isOpenAIConfigured(); }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    if (!isOpenAIConfigured()) {
      return { ok: false, latencyMs: 0, error: "OPENAI_API_KEY not set" };
    }
    const start = Date.now();
    try {
      await callOpenAIEmbeddings(["ping"]);
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message.slice(0, 200) : "Unknown error",
      };
    }
  }
}
