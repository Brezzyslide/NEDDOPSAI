/**
 * Task #16 — Document Ingestion & Embedding Pipeline
 * Test suite: Extraction (PDF, DOCX, TXT, registry)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExtractionError } from "../lib/extractors/extractorInterface.js";
import { TextExtractor }   from "../lib/extractors/textExtractor.js";
import { getExtractor, listExtractors } from "../lib/extractors/extractorRegistry.js";

// ─── Text Extractor ───────────────────────────────────────────────────────────

const makeTextMeta = () => ({
  originalFileName: "test.txt",
  mimeType: "text/plain",
  fileSize: 100,
  checksum: "abc123",
});

describe("TextExtractor", () => {
  const extractor = new TextExtractor();

  it("identifies text/plain as supported", () => {
    expect(extractor.canHandle("text/plain", ".txt")).toBe(true);
    expect(extractor.canHandle("text/markdown", ".md")).toBe(true);
    expect(extractor.canHandle("application/pdf", ".pdf")).toBe(false);
  });

  it("extracts raw text from a plain buffer", async () => {
    const text = "Hello world.\nThis is a test document.";
    const buf = Buffer.from(text, "utf-8");
    const result = await extractor.extract(buf, makeTextMeta());

    expect(result.rawText).toBe(text);
    expect(result.characterCount).toBe(text.length);
    expect(result.isScanned).toBe(false);
    expect(result.extractionMethod).toMatch(/text-native/);
  });

  it("normalises CRLF line endings", async () => {
    const buf = Buffer.from("Line 1\r\nLine 2\r\nLine 3", "utf-8");
    const result = await extractor.extract(buf, makeTextMeta());
    expect(result.rawText).not.toContain("\r");
  });

  it("detects markdown headings as sections", async () => {
    const md = `# Title\n\nSome intro text.\n\n## Section One\n\nContent here.\n\n## Section Two\n\nMore content.`;
    const buf = Buffer.from(md, "utf-8");
    const result = await extractor.extract(buf, makeTextMeta());

    expect(result.headings).toContain("Title");
    expect(result.headings).toContain("Section One");
    expect(result.headings).toContain("Section Two");
    expect(result.sections.length).toBeGreaterThanOrEqual(3);
  });

  it("throws ExtractionError for an empty document", async () => {
    const buf = Buffer.from("   \n\n   ", "utf-8");
    await expect(extractor.extract(buf, makeTextMeta())).rejects.toThrow(ExtractionError);
    await expect(extractor.extract(buf, makeTextMeta())).rejects.toMatchObject({
      code: "EMPTY_DOCUMENT",
    });
  });

  it("throws OVERSIZED_CONTENT for buffers over 2MB of text", async () => {
    const huge = Buffer.alloc(2_100_000, 65); // 2.1MB of 'A'
    await expect(extractor.extract(huge, makeTextMeta())).rejects.toMatchObject({
      code: "OVERSIZED_CONTENT",
    });
  });

  it("provides a token estimate", async () => {
    const text = "a".repeat(400);
    const buf = Buffer.from(text, "utf-8");
    const result = await extractor.extract(buf, makeTextMeta());
    // tokenEstimate = ceil(400 / 4) = 100
    expect(result.tokenEstimate).toBe(100);
  });
});

// ─── Extractor Registry ───────────────────────────────────────────────────────

describe("extractorRegistry", () => {
  it("returns PdfExtractor for application/pdf", () => {
    const provider = getExtractor("application/pdf", ".pdf");
    expect(provider.getProviderName()).toBe("pdf-parse");
  });

  it("returns DocxExtractor for docx MIME type", () => {
    const provider = getExtractor(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".docx",
    );
    expect(provider.getProviderName()).toBe("mammoth");
  });

  it("returns TextExtractor for text/plain", () => {
    const provider = getExtractor("text/plain", ".txt");
    expect(provider.getProviderName()).toBe("text-native");
  });

  it("returns TextExtractor for text/markdown", () => {
    const provider = getExtractor("text/markdown", ".md");
    expect(provider.getProviderName()).toBe("text-native");
  });

  it("throws UNSUPPORTED_FORMAT for unknown MIME types", () => {
    expect(() => getExtractor("application/exe", ".exe")).toThrow(ExtractionError);
    expect(() => getExtractor("application/exe", ".exe")).toThrow("No extraction provider");
  });

  it("lists all registered extractors", () => {
    const list = listExtractors();
    expect(list.length).toBeGreaterThanOrEqual(3);
    const names = list.map((e) => e.name);
    expect(names).toContain("pdf-parse");
    expect(names).toContain("mammoth");
    expect(names).toContain("text-native");
  });
});

// ─── ExtractionError ─────────────────────────────────────────────────────────

describe("ExtractionError", () => {
  it("carries correct code and name", () => {
    const err = new ExtractionError("test message", "CORRUPTED_FILE");
    expect(err.code).toBe("CORRUPTED_FILE");
    expect(err.name).toBe("ExtractionError");
    expect(err instanceof Error).toBe(true);
    expect(err instanceof ExtractionError).toBe(true);
  });
});
