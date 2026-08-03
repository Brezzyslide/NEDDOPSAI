/**
 * Knowledge Hub — Extraction Provider Interface
 *
 * Provider-neutral interface for extracting structured text from document buffers.
 * Each extractor handles one or more file types and returns a standardised result.
 *
 * Naming: "Organisation Library" (customer-facing), "Knowledge Hub" (internal).
 */

// ─── Extraction result types ──────────────────────────────────────────────────

export interface ExtractedPage {
  /** 1-based page number */
  pageNumber: number;
  /** Raw text content of the page */
  text: string;
}

export interface ExtractedSection {
  /** Heading text, or null for body content before the first heading */
  title: string | null;
  /** Nesting level of the heading (1 = h1, 2 = h2, etc.) */
  level: number;
  /** Full text under this heading (excluding sub-sections) */
  text: string;
  /** 1-based page number where this section starts (if available) */
  pageNumber: number | null;
}

export interface ExtractionWarning {
  /** Machine-readable warning code */
  code: string;
  /** Human-readable description (no PII / raw content) */
  message: string;
}

export interface ExtractionResult {
  /** Concatenated full text from all pages */
  rawText: string;
  /** Per-page breakdown (may be empty for formats without page concept) */
  pages: ExtractedPage[];
  /** Detected sections / headings */
  sections: ExtractedSection[];
  /** All headings in document order */
  headings: string[];
  /** Non-fatal extraction warnings */
  warnings: ExtractionWarning[];
  /** BCP 47 language tag if detectable, otherwise null */
  detectedLanguage: string | null;
  /** e.g. "pdf-parse@3.1.4", "mammoth@1.9.0", "text-native" */
  extractionMethod: string;
  /** True when the PDF appears to be a scanned image with no selectable text */
  isScanned: boolean;
  /** True when OCR would be needed to improve extraction quality */
  requiresOcr: boolean;
  /** Total character count of extracted text */
  characterCount: number;
  /** Rough token estimate (characterCount / 4) */
  tokenEstimate: number;
}

// ─── Extraction errors ────────────────────────────────────────────────────────

export type ExtractionErrorCode =
  | "UNSUPPORTED_FORMAT"
  | "CORRUPTED_FILE"
  | "ENCRYPTED_FILE"
  | "EMPTY_DOCUMENT"
  | "OVERSIZED_CONTENT"
  | "EXTRACTION_FAILED"
  | "EXECUTABLE_CONTENT";

export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode;
  constructor(message: string, code: ExtractionErrorCode) {
    super(message);
    this.name = "ExtractionError";
    this.code = code;
    Object.setPrototypeOf(this, ExtractionError.prototype);
  }
}

// ─── Extraction metadata ──────────────────────────────────────────────────────

export interface ExtractionMetadata {
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  /** SHA-256 checksum hex string */
  checksum: string;
}

// ─── Provider interface ───────────────────────────────────────────────────────

export interface ExtractionProvider {
  /**
   * Returns true if this provider can handle the given MIME type and extension.
   * Called by the registry to select the correct provider.
   */
  canHandle(mimeType: string, extension: string): boolean;

  /**
   * Extract structured text from a document buffer.
   * Throws ExtractionError for unrecoverable failures.
   */
  extract(buffer: Buffer, metadata: ExtractionMetadata): Promise<ExtractionResult>;

  /** e.g. "pdf-parse", "mammoth", "text-native" */
  getProviderName(): string;

  /** Semver version string */
  getProviderVersion(): string;
}
