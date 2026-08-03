/**
 * Knowledge Hub — Normalisation Service
 *
 * Deterministic text normalisation for ingested documents.
 *
 * Rules:
 *   - Unicode NFC normalisation
 *   - Line-ending normalisation (\r\n and \r → \n)
 *   - Excessive whitespace removal (3+ blank lines → 2)
 *   - Trailing whitespace removal per line
 *   - Repeated page-header/footer reduction (heuristic)
 *   - Preservation of headings, numbered procedures, bullet lists
 *   - Preservation of section boundaries
 *   - Safe removal of known binary artefacts (null bytes, control chars)
 *   - Stable text hashing (SHA-256 of normalised output)
 *
 * Does NOT:
 *   - Rewrite the meaning of policies or care documents
 *   - Use an LLM to "improve" source text
 *   - Remove meaningful punctuation
 */

import { createHash } from "crypto";
import type { ExtractionResult } from "../lib/extractors/extractorInterface.js";

// ─── Output types ─────────────────────────────────────────────────────────────

export interface NormalisedDocument {
  /** Fully normalised text — ready for chunking */
  text: string;
  /** SHA-256 hex of the normalised text — for dedup / change detection */
  normalisedHash: string;
  /** Character count after normalisation */
  characterCount: number;
  /** Rough token estimate */
  tokenEstimate: number;
  /** Number of sections detected */
  sectionCount: number;
  /** Whether a repeated header/footer was detected and reduced */
  headerFooterReduced: boolean;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Normalise an extracted document for chunking and embedding.
 * Accepts the raw text from an ExtractionResult.
 */
export function normaliseDocument(extraction: ExtractionResult): NormalisedDocument {
  let text = extraction.rawText;

  // 1. Unicode NFC normalisation
  text = text.normalize("NFC");

  // 2. Remove null bytes and dangerous control characters
  //    (keep \n, \t which are meaningful structure)
  text = text.replace(/\x00/g, "").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // 3. Normalise line endings
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // 4. Remove trailing whitespace from each line
  text = text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");

  // 5. Collapse runs of 3+ blank lines into 2
  text = text.replace(/\n{3,}/g, "\n\n");

  // 6. Detect and reduce repeated page headers/footers
  const { cleanText, headerFooterReduced } = reduceRepeatedHeaderFooters(text);
  text = cleanText;

  // 7. Trim leading/trailing whitespace from the full document
  text = text.trim();

  const normalisedHash = computeNormalisedHash(text);
  const sectionCount = (text.match(/^#{1,6}\s/gm) ?? []).length +
    (text.match(/^[A-Z][A-Z\s\d:]{4,60}$/gm) ?? []).length;

  return {
    text,
    normalisedHash,
    characterCount: text.length,
    tokenEstimate: Math.ceil(text.length / 4),
    sectionCount,
    headerFooterReduced,
  };
}

/** Compute SHA-256 of normalised text. Stable across runs. */
export function computeNormalisedHash(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

// ─── Header/footer reduction ──────────────────────────────────────────────────

/**
 * Heuristic: if a short line (≤120 chars) appears 3+ times in the document,
 * it is likely a repeated page header or footer. Keep the first occurrence;
 * replace subsequent ones with a single marker.
 */
function reduceRepeatedHeaderFooters(
  text: string,
): { cleanText: string; headerFooterReduced: boolean } {
  const lines = text.split("\n");
  const MIN_OCCURRENCES = 3;
  const MAX_HEADER_LEN  = 120;

  // Count line occurrences
  const lineCounts = new Map<string, number>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && trimmed.length <= MAX_HEADER_LEN) {
      lineCounts.set(trimmed, (lineCounts.get(trimmed) ?? 0) + 1);
    }
  }

  const repeatedLines = new Set<string>(
    [...lineCounts.entries()]
      .filter(([, count]) => count >= MIN_OCCURRENCES)
      .map(([line]) => line),
  );

  if (repeatedLines.size === 0) {
    return { cleanText: text, headerFooterReduced: false };
  }

  // Keep the first occurrence; drop subsequent occurrences
  const seenOnce = new Set<string>();
  const cleanedLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (repeatedLines.has(trimmed)) {
      if (!seenOnce.has(trimmed)) {
        seenOnce.add(trimmed);
        cleanedLines.push(line);
      }
      // else: silently drop the repeated line
    } else {
      cleanedLines.push(line);
    }
  }

  return { cleanText: cleanedLines.join("\n"), headerFooterReduced: true };
}
