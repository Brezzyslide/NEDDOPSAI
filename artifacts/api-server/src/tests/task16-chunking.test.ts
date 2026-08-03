/**
 * Task #16 — Document Ingestion & Embedding Pipeline
 * Test suite: Chunking Service
 */
import { describe, it, expect } from "vitest";
import {
  chunkDocument,
  DEFAULT_CHUNK_OPTIONS,
  CHUNKING_STRATEGY,
  CHUNKING_STRATEGY_VERSION,
} from "../services/chunkingService.js";
import type { NormalisedDocument } from "../services/normalisationService.js";
import type { ExtractionResult }   from "../lib/extractors/extractorInterface.js";

function makeNormalised(text: string): NormalisedDocument {
  return {
    text,
    normalisedHash: "abc",
    characterCount: text.length,
    tokenEstimate: Math.ceil(text.length / 4),
    sectionCount: 0,
    headerFooterReduced: false,
  };
}

function makeExtraction(rawText = "", pages: { pageNumber: number; text: string }[] = []): ExtractionResult {
  return {
    rawText,
    pages,
    sections: [],
    headings: [],
    warnings: [],
    detectedLanguage: null,
    extractionMethod: "text-native@1.0.0",
    isScanned: false,
    requiresOcr: false,
    characterCount: rawText.length,
    tokenEstimate: Math.ceil(rawText.length / 4),
  };
}

describe("chunkDocument", () => {
  it("returns at least one chunk for a non-empty document", () => {
    const text = "This is a simple document with some content.";
    const chunks = chunkDocument(makeNormalised(text), makeExtraction(text));
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("assigns sequential chunkIndex starting at 0", () => {
    const text = "# Heading 1\n\nContent of section 1.\n\n# Heading 2\n\nContent of section 2.";
    const chunks = chunkDocument(makeNormalised(text), makeExtraction(text));
    chunks.forEach((chunk, i) => {
      expect(chunk.chunkIndex).toBe(i);
    });
  });

  it("preserves section titles from headings", () => {
    const text = "# Policy Overview\n\nThis policy applies to all staff.\n\n# Access Control\n\nAccess is restricted.";
    const chunks = chunkDocument(makeNormalised(text), makeExtraction(text));
    const titles = chunks.map((c) => c.sectionTitle).filter(Boolean);
    expect(titles.some((t) => t?.includes("Policy Overview") || t?.includes("Access Control"))).toBe(true);
  });

  it("builds headingPath breadcrumbs for nested headings", () => {
    const text = "# Policy\n\nIntro.\n\n## Section 1\n\nSub content.\n\n### Sub-section 1.1\n\nDeep content.";
    const chunks = chunkDocument(makeNormalised(text), makeExtraction(text));
    const deepChunk = chunks.find((c) =>
      c.headingPath?.includes("Policy") &&
      c.headingPath?.includes("Section 1") &&
      c.headingPath?.includes("Sub-section 1.1"),
    );
    expect(deepChunk).toBeTruthy();
  });

  it("does not produce chunks with empty text", () => {
    const text = "# Section A\n\nMeaningful content here.\n\n# Section B\n\nMore meaningful content.";
    const chunks = chunkDocument(makeNormalised(text), makeExtraction(text));
    for (const chunk of chunks) {
      expect(chunk.text.trim().length).toBeGreaterThan(0);
    }
  });

  it("respects maxTokens option — chunks should not grossly exceed the limit", () => {
    // Generate a long paragraph that will need splitting
    const para = "This sentence contains about ten words each time. ".repeat(100);
    const text = para; // ~4800 chars / ~1200 tokens
    const chunks = chunkDocument(makeNormalised(text), makeExtraction(text), { maxTokens: 100 });
    for (const chunk of chunks) {
      // Allow some tolerance for overlap
      expect(chunk.tokenCount).toBeLessThanOrEqual(200);
    }
  });

  it("each chunk has a content hash", () => {
    const text = "# Section\n\nContent to hash.";
    const chunks = chunkDocument(makeNormalised(text), makeExtraction(text));
    for (const chunk of chunks) {
      expect(chunk.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("produces stable hashes (deterministic for same input)", () => {
    const text = "# Heading\n\nDeterministic content.";
    const chunks1 = chunkDocument(makeNormalised(text), makeExtraction(text));
    const chunks2 = chunkDocument(makeNormalised(text), makeExtraction(text));
    expect(chunks1.map((c) => c.contentHash)).toEqual(chunks2.map((c) => c.contentHash));
  });

  it("records the chunking strategy and version", () => {
    const text = "Simple text for strategy recording.";
    const chunks = chunkDocument(makeNormalised(text), makeExtraction(text));
    for (const chunk of chunks) {
      expect(chunk.chunkingStrategy).toBe(CHUNKING_STRATEGY);
      expect(chunk.chunkingStrategyVersion).toBe(CHUNKING_STRATEGY_VERSION);
    }
  });

  it("uses custom strategy in options", () => {
    const text = "Content.";
    const chunks = chunkDocument(makeNormalised(text), makeExtraction(text), {
      strategy: "custom_v1",
      strategyVersion: "2.0.0",
    });
    expect(chunks[0]?.chunkingStrategy).toBe("custom_v1");
    expect(chunks[0]?.chunkingStrategyVersion).toBe("2.0.0");
  });

  it("handles documents with no headings", () => {
    const text = "Paragraph one. Paragraph two. Paragraph three.";
    const chunks = chunkDocument(makeNormalised(text), makeExtraction(text));
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0]?.sectionTitle).toBeNull();
  });
});

describe("DEFAULT_CHUNK_OPTIONS", () => {
  it("has maxTokens and overlapTokens", () => {
    expect(DEFAULT_CHUNK_OPTIONS.maxTokens).toBeGreaterThan(0);
    expect(DEFAULT_CHUNK_OPTIONS.overlapTokens).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_CHUNK_OPTIONS.strategy).toBe(CHUNKING_STRATEGY);
    expect(DEFAULT_CHUNK_OPTIONS.strategyVersion).toBe(CHUNKING_STRATEGY_VERSION);
  });
});
