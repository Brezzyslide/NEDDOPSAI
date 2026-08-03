/**
 * Knowledge Hub — Text / Markdown Extractor
 *
 * Handles plain text (.txt) and Markdown (.md) files.
 * Preserves headings, paragraph structure, numbered lists, and bullet lists.
 * Normalises line endings on ingestion.
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

const PROVIDER_NAME = "text-native";
const PROVIDER_VERSION = "1.0.0";
const MAX_EXTRACTED_CHARS = 2_000_000;

export class TextExtractor implements ExtractionProvider {
  canHandle(mimeType: string, extension: string): boolean {
    const ext = extension.toLowerCase();
    return (
      mimeType === "text/plain" ||
      mimeType === "text/markdown" ||
      mimeType === "text/x-markdown" ||
      ext === ".txt" ||
      ext === ".md" ||
      ext === ".markdown"
    );
  }

  async extract(buffer: Buffer, _metadata: ExtractionMetadata): Promise<ExtractionResult> {
    // Decode — try UTF-8, fall back gracefully
    let rawText: string;
    try {
      rawText = buffer.toString("utf-8");
    } catch {
      throw new ExtractionError("Cannot decode file as UTF-8 text.", "CORRUPTED_FILE");
    }

    // Normalise line endings
    rawText = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    if (rawText.trim().length === 0) {
      throw new ExtractionError("Text document is empty.", "EMPTY_DOCUMENT");
    }

    if (rawText.length > MAX_EXTRACTED_CHARS) {
      throw new ExtractionError(
        `Extracted text exceeds ${MAX_EXTRACTED_CHARS.toLocaleString()} characters.`,
        "OVERSIZED_CONTENT",
      );
    }

    const sections = extractSectionsFromText(rawText);
    const headings = sections.filter((s) => s.title !== null).map((s) => s.title!);

    return {
      rawText,
      pages: [], // no page concept for plain text
      sections,
      headings,
      warnings: [],
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

function extractSectionsFromText(text: string): ExtractedSection[] {
  const lines = text.split("\n");
  const sections: ExtractedSection[] = [];
  let currentSection: ExtractedSection | null = null;
  let bodyLines: string[] = [];

  const finalise = () => {
    if (currentSection !== null || bodyLines.length > 0) {
      const body = bodyLines.join("\n").trim();
      if (currentSection) {
        currentSection.text = body;
        if (body || currentSection.title) sections.push(currentSection);
      } else if (body) {
        sections.push({ title: null, level: 0, text: body, pageNumber: null });
      }
    }
  };

  for (const line of lines) {
    // ATX-style Markdown headings
    const atxMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (atxMatch) {
      finalise();
      bodyLines = [];
      currentSection = {
        title: atxMatch[2].trim(),
        level: atxMatch[1].length,
        text: "",
        pageNumber: null,
      };
      continue;
    }

    bodyLines.push(line);
  }

  finalise();

  if (sections.length === 0) {
    sections.push({ title: null, level: 0, text: text.trim(), pageNumber: null });
  }

  return sections;
}
