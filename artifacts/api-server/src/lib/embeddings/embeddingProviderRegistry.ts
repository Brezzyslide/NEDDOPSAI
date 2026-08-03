/**
 * Knowledge Hub — Embedding Provider Registry
 *
 * Selects the active embedding provider based on environment configuration
 * and the sensitivity classification of the source being processed.
 *
 * Selection rules:
 *   - "restricted" sensitivity → NullEmbeddingProvider (never sent externally)
 *   - OPENAI_API_KEY configured → OpenAIEmbeddingProvider
 *   - Otherwise → NullEmbeddingProvider (semantic search reported as disabled)
 *
 * Extend this registry to add self-hosted or alternative providers.
 */

import type { EmbeddingProvider } from "./embeddingInterface.js";
import { OpenAIEmbeddingProvider } from "./openaiEmbeddingProvider.js";
import { NullEmbeddingProvider  } from "./nullEmbeddingProvider.js";

// Singleton instances
let _openai: OpenAIEmbeddingProvider | null = null;
let _null:   NullEmbeddingProvider   | null = null;

function openaiProvider(): OpenAIEmbeddingProvider {
  if (!_openai) _openai = new OpenAIEmbeddingProvider();
  return _openai;
}

function nullProvider(): NullEmbeddingProvider {
  if (!_null) _null = new NullEmbeddingProvider();
  return _null;
}

/**
 * Return the appropriate embedding provider for a given sensitivity level.
 *
 * @param sensitivityClassification  From knowledgeSources.sensitivityClassification
 *        ("public" | "internal" | "confidential" | "restricted")
 */
export function getEmbeddingProvider(
  sensitivityClassification: string = "internal",
): EmbeddingProvider {
  // Restricted documents never leave the platform
  if (sensitivityClassification === "restricted") {
    return nullProvider();
  }

  // Use OpenAI if configured
  if (process.env.OPENAI_API_KEY) {
    return openaiProvider();
  }

  // Graceful degradation — lexical search only
  return nullProvider();
}

/**
 * True when semantic (vector) search is available for the given sensitivity level.
 * Used by the pipeline to report capabilities to callers.
 */
export function isSemanticSearchAvailable(
  sensitivityClassification: string = "internal",
): boolean {
  return getEmbeddingProvider(sensitivityClassification).isActive();
}
