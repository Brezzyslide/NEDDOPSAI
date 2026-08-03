/**
 * Knowledge Hub — PDF Extractor
 *
 * Extracts text from PDF buffers using pdf-parse.
 * Detects scanned PDFs (images with no selectable text).
 * Does NOT perform OCR — flags documents that require it.
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

const PROVIDER_NAME = "pdf-parse";
const PROVIDER_VERSION = "3.1.4"; // matches installed version
const MAX_EXTRACTED_CHARS = 2_000_000; // 2MB of text — safety guard

// Heading patterns in extracted PDF text
const HEADING_PATTERNS = [
  /^#{1,6}\s+(.+)$/m,                   // markdown-style headings
  /^([A-Z][A-Z\s\d]{2,60})$/m,         // ALL CAPS lines (common in PDFs)
  /^(\d+\.[\d.]*\s+[A-Z].{5,80})$/m,  // numbered sections "1.2 Something"
];

export class PdfExtractor implements ExtractionProvider {
  canHandle(mimeType: string, extension: string): boolean {
    return (
      mimeType === "application/pdf" ||
      extension.toLowerCase() === ".pdf"
    );
  }

  async extract(buffer: Buffer, metadata: ExtractionMetadata): Promise<ExtractionResult> {
    // Dynamic import — pdf-parse is CJS; works in ESM via interop
    let pdfParse: (data: Buffer, options?: Record<string, unknown>) => Promise<{
      text: string;
      numpages: number;
      info: Record<string, unknown>;
      metadata: Record<string, unknown>;
    }>;

    try {
      const mod = await import("pdf-parse");
      pdfParse = (mod.default ?? mod) as typeof pdfParse;
    } catch {
      throw new ExtractionError(
        "pdf-parse library unavailable",
        "EXTRACTION_FAILED",
      );
    }

    // ── Per-page extraction ──────────────────────────────────────────────────
    const pages: ExtractedPage[] = [];
    let pageCount = 0;

    const pageExtractor = {
      render_page: (pageData: { getTextContent: () => Promise<{ items: { str: string }[] }> }) => {
        return async () => {
          pageCount++;
          const content = await pageData.getTextContent();
          const pageText = content.items.map((item) => item.str).join(" ");
          pages.push({ pageNumber: pageCount, text: pageText });
          return pageText;
        };
      },
    };

    let parsed: { text: string; numpages: number };
    try {
      parsed = await pdfParse(buffer, {
        pagerender: pageExtractor.render_page,
        max: 0, // all pages
      });
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
    }

    const rawText = parsed.text ?? "";

    // ── Scanned / empty detection ────────────────────────────────────────────
    const isScanned = rawText.trim().length < 50 && parsed.numpages > 0;
    const requiresOcr = isScanned;

    if (rawText.trim().length === 0 && parsed.numpages === 0) {
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
    const headings = sections.filter((s) => s.title !== null).map((s) => s.title!);

    return {
      rawText,
      pages,
      sections,
      headings,
      warnings: isScanned
        ? [{ code: "SCANNED_PDF", message: "PDF appears to be a scanned image — OCR not performed." }]
        : [],
      detectedLanguage: null, // language detection in Task #17
      extractionMethod: `${PROVIDER_NAME}@${PROVIDER_VERSION}`,
      isScanned,
      requiresOcr,
      characterCount: rawText.length,
      tokenEstimate: Math.ceil(rawText.length / 4),
    };
  }

  getProviderName(): string { return PROVIDER_NAME; }
  getProviderVersion(): string { return PROVIDER_VERSION; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractSectionsFromText(text: string): ExtractedSection[] {
  const lines = text.split("\n");
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
      bodyLines = [];
      currentSection = {
        title: trimmed,
        level: (numberedMatch[1].match(/\./g) ?? []).length + 1,
        text: "",
        pageNumber: null,
      };
      continue;
    }

    // ALL CAPS line as a heading (common in PDF policy documents)
    if (/^[A-Z][A-Z\s\d:]{4,60}$/.test(trimmed) && trimmed.length < 80) {
      finaliseSection();
      bodyLines = [];
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
