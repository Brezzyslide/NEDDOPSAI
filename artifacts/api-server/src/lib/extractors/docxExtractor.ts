/**
 * Knowledge Hub — DOCX Extractor
 *
 * Extracts structured text from .docx buffers using mammoth.
 * Preserves headings, paragraphs, and numbered procedures.
 * Tables are noted as metadata but not extracted as structured data.
 *
 * Security: never logs raw document content or participant data.
 */

import type {
  ExtractionProvider,
  ExtractionResult,
  ExtractionMetadata,
  ExtractedSection,
} from "./extractorInterface.js";
import { ExtractionError } from "./extractorInterface.js";

const PROVIDER_NAME = "mammoth";
const PROVIDER_VERSION = "1.9.0";
const MAX_EXTRACTED_CHARS = 2_000_000;

export class DocxExtractor implements ExtractionProvider {
  canHandle(mimeType: string, extension: string): boolean {
    return (
      mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      extension.toLowerCase() === ".docx"
    );
  }

  async extract(buffer: Buffer, _metadata: ExtractionMetadata): Promise<ExtractionResult> {
    let mammoth: {
      extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string; messages: { type: string; message: string }[] }>;
      convertToMarkdown: (opts: { buffer: Buffer }) => Promise<{ value: string; messages: { type: string; message: string }[] }>;
    };

    try {
      const mod = await import("mammoth");
      mammoth = (mod.default ?? mod) as typeof mammoth;
    } catch {
      throw new ExtractionError("mammoth library unavailable", "EXTRACTION_FAILED");
    }

    let markdownResult: { value: string; messages: { type: string; message: string }[] };
    let rawResult: { value: string; messages: { type: string; message: string }[] };

    try {
      [markdownResult, rawResult] = await Promise.all([
        mammoth.convertToMarkdown({ buffer }),
        mammoth.extractRawText({ buffer }),
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg.toLowerCase().includes("corrupt") || msg.toLowerCase().includes("invalid")) {
        throw new ExtractionError(
          "DOCX file is corrupted or invalid.",
          "CORRUPTED_FILE",
        );
      }
      throw new ExtractionError(
        `DOCX extraction failed: ${msg.slice(0, 200)}`,
        "EXTRACTION_FAILED",
      );
    }

    // Prefer markdown output for structure; fall back to raw text
    const markdownText = markdownResult.value ?? "";
    const rawText = rawResult.value ?? markdownText;

    if (rawText.trim().length === 0) {
      throw new ExtractionError("DOCX document is empty.", "EMPTY_DOCUMENT");
    }

    if (rawText.length > MAX_EXTRACTED_CHARS) {
      throw new ExtractionError(
        `Extracted text exceeds ${MAX_EXTRACTED_CHARS.toLocaleString()} characters.`,
        "OVERSIZED_CONTENT",
      );
    }

    // Extract sections from markdown output (headings are preserved)
    const sections = extractSectionsFromMarkdown(markdownText);
    const headings = sections.filter((s) => s.title !== null).map((s) => s.title!);

    // Non-fatal warnings from mammoth
    const mammothWarnings = markdownResult.messages
      .filter((m) => m.type === "warning")
      .slice(0, 10)
      .map((m) => ({ code: "DOCX_WARNING", message: m.message.slice(0, 300) }));

    const tableCount = (markdownText.match(/^\|/gm) ?? []).length;
    const tableWarning =
      tableCount > 0
        ? [{ code: "TABLES_NOTED", message: `Document contains approximately ${tableCount} table rows; table structure is preserved as text.` }]
        : [];

    return {
      rawText: markdownText || rawText,
      pages: [], // DOCX has no inherent page concept; pages determined by renderer
      sections,
      headings,
      warnings: [...mammothWarnings, ...tableWarning],
      detectedLanguage: null,
      extractionMethod: `${PROVIDER_NAME}@${PROVIDER_VERSION}`,
      isScanned: false,
      requiresOcr: false,
      characterCount: rawText.length,
      tokenEstimate: Math.ceil(rawText.length / 4),
    };
  }

  getProviderName(): string { return PROVIDER_NAME; }
  getProviderVersion(): string { return PROVIDER_VERSION; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractSectionsFromMarkdown(markdown: string): ExtractedSection[] {
  const lines = markdown.split("\n");
  const sections: ExtractedSection[] = [];
  let currentSection: ExtractedSection | null = null;
  let bodyLines: string[] = [];

  const finalise = () => {
    if (currentSection) {
      currentSection.text = bodyLines.join("\n").trim();
      sections.push(currentSection);
    }
  };

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      finalise();
      bodyLines = [];
      currentSection = {
        title: headingMatch[2].trim(),
        level: headingMatch[1].length,
        text: "",
        pageNumber: null,
      };
      continue;
    }
    bodyLines.push(line);
  }

  finalise();

  if (sections.length === 0) {
    sections.push({ title: null, level: 0, text: markdown.trim(), pageNumber: null });
  }

  return sections;
}
