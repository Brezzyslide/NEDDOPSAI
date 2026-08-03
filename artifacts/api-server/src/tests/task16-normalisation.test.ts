/**
 * Task #16 — Document Ingestion & Embedding Pipeline
 * Test suite: Normalisation Service
 */
import { describe, it, expect } from "vitest";
import { normaliseDocument, computeNormalisedHash } from "../services/normalisationService.js";
import type { ExtractionResult } from "../lib/extractors/extractorInterface.js";

function makeExtraction(rawText: string): ExtractionResult {
  return {
    rawText,
    pages: [],
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

describe("normaliseDocument", () => {
  it("returns the normalised text with a stable hash", () => {
    const text = "Hello world.\n\nThis is a paragraph.";
    const result = normaliseDocument(makeExtraction(text));
    expect(result.text).toBe(text);
    expect(result.normalisedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.characterCount).toBe(result.text.length);
  });

  it("normalises to NFC unicode", () => {
    // NFD form of 'café' — e + combining acute accent
    const nfd = "cafe\u0301";
    const nfc = "café"; // NFC form
    const result = normaliseDocument(makeExtraction(nfd));
    expect(result.text).toBe(nfc);
  });

  it("removes null bytes and control characters", () => {
    const text = "Hello\x00World\x01\x02";
    const result = normaliseDocument(makeExtraction(text));
    expect(result.text).not.toContain("\x00");
    expect(result.text).not.toContain("\x01");
    expect(result.text).toBe("HelloWorld");
  });

  it("normalises CRLF and CR line endings to LF", () => {
    const text = "Line 1\r\nLine 2\rLine 3";
    const result = normaliseDocument(makeExtraction(text));
    expect(result.text).not.toContain("\r");
    expect(result.text).toBe("Line 1\nLine 2\nLine 3");
  });

  it("removes trailing whitespace from lines", () => {
    const text = "Hello   \nWorld   \nDone   ";
    const result = normaliseDocument(makeExtraction(text));
    for (const line of result.text.split("\n")) {
      expect(line).not.toMatch(/\s+$/);
    }
  });

  it("collapses runs of 3+ blank lines into 2", () => {
    const text = "Para 1.\n\n\n\n\nPara 2.";
    const result = normaliseDocument(makeExtraction(text));
    expect(result.text).not.toMatch(/\n{3,}/);
    expect(result.text).toContain("Para 1.\n\nPara 2.");
  });

  it("detects and reduces repeated page headers/footers", () => {
    // Repeat a line 4 times to trigger header reduction (MIN_OCCURRENCES = 3)
    // Use a plain string for counting — avoid regex special chars
    const repeated = "CONFIDENTIAL PAGE HEADER";
    const text = [
      repeated, "Content on page 1.",
      repeated, "Content on page 2.",
      repeated, "Content on page 3.",
      repeated, "Content on page 4.",
    ].join("\n");
    const result = normaliseDocument(makeExtraction(text));
    // Count occurrences using split instead of regex to avoid | / other special chars
    const matches = result.text.split(repeated).length - 1;
    expect(result.headerFooterReduced).toBe(true);
    expect(matches).toBe(1); // only first occurrence kept
  });

  it("does not reduce lines that appear fewer than 3 times", () => {
    const text = "SECTION HEADER\nContent.\nSECTION HEADER\nMore content.";
    const result = normaliseDocument(makeExtraction(text));
    expect(result.headerFooterReduced).toBe(false);
  });

  it("provides accurate section count for markdown headings", () => {
    const text = "# Heading 1\n\nContent.\n\n## Heading 2\n\nMore.";
    const result = normaliseDocument(makeExtraction(text));
    expect(result.sectionCount).toBeGreaterThanOrEqual(2);
  });

  it("produces a stable hash (deterministic)", () => {
    const text = "Identical text for hashing.";
    const r1 = normaliseDocument(makeExtraction(text));
    const r2 = normaliseDocument(makeExtraction(text));
    expect(r1.normalisedHash).toBe(r2.normalisedHash);
  });

  it("produces different hashes for different text", () => {
    const r1 = normaliseDocument(makeExtraction("Text one."));
    const r2 = normaliseDocument(makeExtraction("Text two."));
    expect(r1.normalisedHash).not.toBe(r2.normalisedHash);
  });
});

describe("computeNormalisedHash", () => {
  it("returns a 64-char hex SHA-256 hash", () => {
    const hash = computeNormalisedHash("test content");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
