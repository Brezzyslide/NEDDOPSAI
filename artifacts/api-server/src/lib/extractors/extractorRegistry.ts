/**
 * Knowledge Hub — Extractor Registry
 *
 * Selects the correct ExtractionProvider based on MIME type and file extension.
 * Returns the first provider that reports canHandle() = true.
 *
 * Provider order matters: more specific providers should appear before fallbacks.
 */

import type { ExtractionProvider } from "./extractorInterface.js";
import { ExtractionError } from "./extractorInterface.js";
import { PdfExtractor }  from "./pdfExtractor.js";
import { DocxExtractor } from "./docxExtractor.js";
import { TextExtractor } from "./textExtractor.js";

// Registry — ordered most-specific to most-general
const PROVIDERS: ExtractionProvider[] = [
  new PdfExtractor(),
  new DocxExtractor(),
  new TextExtractor(),
];

/**
 * Look up the extraction provider for a given MIME type + extension.
 * Throws ExtractionError(UNSUPPORTED_FORMAT) if no provider matches.
 */
export function getExtractor(mimeType: string, extension: string): ExtractionProvider {
  const provider = PROVIDERS.find((p) => p.canHandle(mimeType, extension));
  if (!provider) {
    throw new ExtractionError(
      `No extraction provider for mimeType="${mimeType}" extension="${extension}". ` +
        "Supported formats: PDF, DOCX, TXT, Markdown.",
      "UNSUPPORTED_FORMAT",
    );
  }
  return provider;
}

/** List all registered providers (for diagnostics / API reporting). */
export function listExtractors(): Array<{ name: string; version: string }> {
  return PROVIDERS.map((p) => ({
    name: p.getProviderName(),
    version: p.getProviderVersion(),
  }));
}
