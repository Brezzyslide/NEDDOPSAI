/**
 * Knowledge Hub — PDF Extractor
 *
 * Extracts text from PDF buffers using pdf-parse v2 (class-based API).
 * Detects scanned PDFs (images with no selectable text).
 * Does NOT perform OCR — flags documents that require it.
 *
 * pdf-parse v2 API:
 *   const parser = new PDFParse({ data: Uint8Array });
 *   const result = await parser.getText();   // result.text, result.pages, result.total
 *   await parser.destroy();
 *
 * Security: never logs raw document content or participant data.
 */

import type {
  ExtractionProvider,
  ExtractionResult,
  ExtractionMetadata,
  ExtractedPage,
  ExtractedSection,
} from "./extractorInterface.js";
import { ExtractionError } from "./extractorInterface.js";

const PROVIDER_NAME    = "pdf-parse";
const PROVIDER_VERSION = "2.4.5"; // installed version
const MAX_EXTRACTED_CHARS = 2_000_000; // 2MB of text — safety guard

export class PdfExtractor implements ExtractionProvider {
  canHandle(mimeType: string, extension: string): boolean {
    return (
      mimeType === "application/pdf" ||
      extension.toLowerCase() === ".pdf"
    );
  }

  async extract(buffer: Buffer, _metadata: ExtractionMetadata): Promise<ExtractionResult> {
    // pdf-parse v2 is ESM-first. Marked external in build.mjs so Node.js
    // loads it natively. It exports { PDFParse } as a named export.
    let PDFParse: new (opts: { data: Uint8Array; verbosity?: number }) => {
      getText(): Promise<{ text: string; pages: { num: number; text: string }[]; total: number }>;
      destroy(): Promise<void>;
    };

    try {
      const mod = await import("pdf-parse");
      PDFParse = (mod as any).PDFParse;
      if (typeof PDFParse !== "function") {
        throw new Error(
          `PDFParse class not found in pdf-parse exports. Keys: ${Object.keys(mod as object).join(", ")}`,
        );
      }
    } catch (importErr) {
      throw new ExtractionError(
        `pdf-parse library unavailable: ${importErr instanceof Error ? importErr.message : String(importErr)}`,
        "EXTRACTION_FAILED",
      );
    }

    // Convert Buffer → Uint8Array (v2 prefers typed arrays)
    const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    let parsed: { text: string; pages: { num: number; text: string }[]; total: number };
    let parser: { destroy(): Promise<void> } | null = null;
    try {
      parser = new PDFParse({ data: uint8, verbosity: 0 });
      parsed = await parser.getText();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg.toLowerCase().includes("encrypt") || msg.toLowerCase().includes("password")) {
        throw new ExtractionError(
          "PDF is encrypted and cannot be opened without a password.",
          "ENCRYPTED_FILE",
        );
      }
      throw new ExtractionError(
        `PDF extraction failed: ${msg.slice(0, 200)}`,
        "EXTRACTION_FAILED",
      );
    } finally {
      await parser?.destroy().catch(() => {});
    }

    const rawText   = parsed.text ?? "";
    const pageCount = parsed.total ?? parsed.pages?.length ?? 0;

    // ── Per-page extraction ──────────────────────────────────────────────────
    const pages: ExtractedPage[] = (parsed.pages ?? []).map((p) => ({
      pageNumber: p.num,
      text:       p.text ?? "",
    }));

    // ── Scanned / empty detection ────────────────────────────────────────────
    const isScanned   = rawText.trim().length < 50 && pageCount > 0;
    const requiresOcr = isScanned;

    if (rawText.trim().length === 0 && pageCount === 0) {
      throw new ExtractionError(
        "PDF contains no pages or text.",
        "EMPTY_DOCUMENT",
      );
    }

    if (rawText.length > MAX_EXTRACTED_CHARS) {
      throw new ExtractionError(
        `Extracted text exceeds ${MAX_EXTRACTED_CHARS.toLocaleString()} characters. ` +
          "Split the document or increase the limit.",
        "OVERSIZED_CONTENT",
      );
    }

    // ── Section detection ─────────────────────────────────────────────────────
    const sections = extractSectionsFromText(rawText);
    const headings  = sections.filter((s) => s.title !== null).map((s) => s.title!);

    return {
      rawText,
      pages,
      sections,
      headings,
      warnings: isScanned
        ? [{ code: "SCANNED_PDF", message: "PDF appears to be a scanned image — OCR not performed." }]
        : [],
      detectedLanguage:  null,
      extractionMethod:  `${PROVIDER_NAME}@${PROVIDER_VERSION}`,
      isScanned,
      requiresOcr,
      characterCount: rawText.length,
      tokenEstimate:  Math.ceil(rawText.length / 4),
    };
  }

  getProviderName():    string { return PROVIDER_NAME; }
  getProviderVersion(): string { return PROVIDER_VERSION; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractSectionsFromText(text: string): ExtractedSection[] {
  const lines    = text.split("\n");
  const sections: ExtractedSection[] = [];
  let currentSection: ExtractedSection | null = null;
  let bodyLines: string[] = [];

  const finaliseSection = () => {
    if (currentSection) {
      currentSection.text = bodyLines.join("\n").trim();
      sections.push(currentSection);
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for numbered section headings like "1.2.3 Title"
    const numberedMatch = /^(\d+\.[\d.]*)\s+([A-Z][^\n]{5,80})$/.exec(trimmed);
    if (numberedMatch) {
      finaliseSection();
      bodyLines     = [];
      currentSection = {
        title:      trimmed,
        level:      (numberedMatch[1].match(/\./g) ?? []).length + 1,
        text:       "",
        pageNumber: null,
      };
      continue;
    }

    // ALL CAPS line as a heading (common in PDF policy documents)
    if (/^[A-Z][A-Z\s\d:]{4,60}$/.test(trimmed) && trimmed.length < 80) {
      finaliseSection();
      bodyLines     = [];
      currentSection = { title: trimmed, level: 1, text: "", pageNumber: null };
      continue;
    }

    bodyLines.push(line);
  }

  finaliseSection();

  if (sections.length === 0) {
    sections.push({ title: null, level: 0, text: text.trim(), pageNumber: null });
  }

  return sections;
}
