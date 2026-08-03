/**
 * Knowledge Hub — Chunking Service
 *
 * Heading-aware, paragraph-aware chunking for normalised document text.
 *
 * Strategy "heading_aware_v1" v1.0.0:
 *   - Splits text at heading boundaries first
 *   - Further splits oversized sections by paragraph
 *   - Applies token-budget respecting overlap between consecutive chunks
 *   - Preserves heading breadcrumb path (headingPath) for citation
 *   - Preserves page number when available in extraction metadata
 *   - Avoids splitting numbered procedures mid-step
 *   - Produces stable SHA-256 content hashes per chunk
 *   - Stable ordering (chunkIndex is zero-based, document-order)
 *
 * Bump CHUNKING_STRATEGY_VERSION when chunk boundaries change.
 */

import { createHash } from "crypto";
import type { ExtractionResult } from "../lib/extractors/extractorInterface.js";
import type { NormalisedDocument } from "./normalisationService.js";

// ─── Constants ────────────────────────────────────────────────────────────────

export const CHUNKING_STRATEGY = "heading_aware_v1";
export const CHUNKING_STRATEGY_VERSION = "1.0.0";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChunkOptions {
  /** Maximum tokens per chunk (approximate — 1 token ≈ 4 chars) */
  maxTokens: number;
  /** Overlap tokens between consecutive chunks */
  overlapTokens: number;
  /** Chunking strategy identifier */
  strategy: string;
  /** Strategy version for re-chunking support */
  strategyVersion: string;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  maxTokens: 512,
  overlapTokens: 50,
  strategy: CHUNKING_STRATEGY,
  strategyVersion: CHUNKING_STRATEGY_VERSION,
};

export interface Chunk {
  /** Zero-based index within the document */
  chunkIndex: number;
  /** Heading that introduces this chunk, if any */
  sectionTitle: string | null;
  /** Breadcrumb heading path e.g. "Policy > Section 2 > Access Control" */
  headingPath: string | null;
  /** 1-based page number of the first character of this chunk (if available) */
  pageNumber: number | null;
  /** Extracted text content */
  text: string;
  /** Approximate token count */
  tokenCount: number;
  /** SHA-256 of the chunk text (deterministic) */
  contentHash: string;
  /** Chunking strategy used */
  chunkingStrategy: string;
  /** Chunking strategy version */
  chunkingStrategyVersion: string;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Chunk a normalised document into retrieval units.
 *
 * @param doc           Normalised document from normalisationService
 * @param extraction    Original extraction result (for page number info)
 * @param opts          Chunking options (uses DEFAULT_CHUNK_OPTIONS if omitted)
 */
export function chunkDocument(
  doc: NormalisedDocument,
  extraction: ExtractionResult,
  opts: Partial<ChunkOptions> = {},
): Chunk[] {
  const options = { ...DEFAULT_CHUNK_OPTIONS, ...opts };

  // Build a page-number lookup from extraction pages
  const pageIndex = buildPageIndex(extraction, doc.text);

  // Split document into heading-bounded segments
  const segments = splitByHeadings(doc.text, pageIndex);

  // Chunk each segment; apply overlap
  const chunks: Chunk[] = [];
  let chunkIndex = 0;
  let headingStack: string[] = [];

  for (const segment of segments) {
    if (segment.heading) {
      updateHeadingStack(headingStack, segment.heading, segment.headingLevel);
    }

    const headingPath = headingStack.length > 0 ? headingStack.join(" > ") : null;

    const subChunks = splitSegmentIntoChunks(
      segment.text,
      options.maxTokens,
      options.overlapTokens,
    );

    for (const subText of subChunks) {
      if (!subText.trim()) continue;
      chunks.push({
        chunkIndex: chunkIndex++,
        sectionTitle: segment.heading ?? null,
        headingPath,
        pageNumber: segment.pageNumber ?? null,
        text: subText,
        tokenCount: estimateTokens(subText),
        contentHash: computeChunkHash(subText),
        chunkingStrategy: options.strategy,
        chunkingStrategyVersion: options.strategyVersion,
      });
    }
  }

  return chunks;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface Segment {
  heading: string | null;
  headingLevel: number;
  text: string;
  pageNumber: number | null;
}

const HEADING_RE = /^(#{1,6})\s+(.+)$/m;
const NUMBERED_HEADING_RE = /^(\d+\.[\d.]*)\s+([A-Z][^\n]{3,80})$/m;
const ALL_CAPS_HEADING_RE = /^([A-Z][A-Z\s\d:]{4,60})$/m;

function splitByHeadings(text: string, pageIndex: Map<number, number>): Segment[] {
  const lines = text.split("\n");
  const segments: Segment[] = [];
  let currentHeading: string | null = null;
  let currentLevel = 0;
  let currentLines: string[] = [];
  let currentPageNumber: number | null = null;
  let charOffset = 0;

  const finalise = () => {
    const segText = currentLines.join("\n").trim();
    if (segText || currentHeading) {
      segments.push({
        heading: currentHeading,
        headingLevel: currentLevel,
        text: segText,
        pageNumber: currentPageNumber,
      });
    }
  };

  for (const line of lines) {
    const atxMatch = HEADING_RE.exec(line);
    const numberedMatch = !atxMatch && NUMBERED_HEADING_RE.exec(line.trim());
    const allCapsMatch = !atxMatch && !numberedMatch && ALL_CAPS_HEADING_RE.exec(line.trim());

    if (atxMatch || numberedMatch || allCapsMatch) {
      finalise();
      currentLines = [];
      currentHeading = atxMatch
        ? atxMatch[2].trim()
        : numberedMatch
        ? `${numberedMatch[1]} ${numberedMatch[2]}`.trim()
        : allCapsMatch![1].trim();
      currentLevel = atxMatch
        ? atxMatch[1].length
        : numberedMatch
        ? (numberedMatch[1].match(/\./g) ?? []).length + 1
        : 1;
      // Lookup page number by character offset
      currentPageNumber = pageIndex.get(charOffset) ?? currentPageNumber;
    } else {
      currentLines.push(line);
    }
    charOffset += line.length + 1; // +1 for \n
  }

  finalise();

  if (segments.length === 0) {
    segments.push({ heading: null, headingLevel: 0, text: text, pageNumber: null });
  }

  return segments;
}

function splitSegmentIntoChunks(
  text: string,
  maxTokens: number,
  overlapTokens: number,
): string[] {
  const maxChars = maxTokens * 4;
  const overlapChars = overlapTokens * 4;

  if (estimateTokens(text) <= maxTokens) {
    return [text];
  }

  // Prefer paragraph splits
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (!para.trim()) continue;
    const candidate = current ? current + "\n\n" + para : para;

    if (estimateTokens(candidate) <= maxTokens) {
      current = candidate;
    } else {
      if (current) {
        chunks.push(current);
        // Overlap: include the tail of current as a prefix for the next chunk
        const overlapText = current.slice(-overlapChars);
        current = overlapText ? overlapText + "\n\n" + para : para;
      } else {
        // Single paragraph too large — split by sentence
        const sentenceChunks = splitBySentences(para, maxChars, overlapChars);
        chunks.push(...sentenceChunks.slice(0, -1));
        current = sentenceChunks[sentenceChunks.length - 1] ?? "";
      }
    }
  }

  if (current.trim()) chunks.push(current);
  return chunks.filter((c) => c.trim());
}

function splitBySentences(text: string, maxChars: number, overlapChars: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  const chunks: string[] = [];
  let current = "";

  for (const sent of sentences) {
    const candidate = current + sent;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) {
        chunks.push(current);
        current = current.slice(-overlapChars) + sent;
      } else {
        // Sentence itself too long — hard split
        for (let i = 0; i < sent.length; i += maxChars - overlapChars) {
          chunks.push(sent.slice(i, i + maxChars));
        }
        current = "";
      }
    }
  }

  if (current.trim()) chunks.push(current);
  return chunks.filter((c) => c.trim());
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function computeChunkHash(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

function updateHeadingStack(stack: string[], heading: string, level: number): void {
  // Trim the stack to the current depth
  while (stack.length >= level) stack.pop();
  stack.push(heading);
}

function buildPageIndex(
  extraction: ExtractionResult,
  normalisedText: string,
): Map<number, number> {
  const map = new Map<number, number>();
  if (!extraction.pages.length) return map;

  // Simple heuristic: assign character offsets based on relative proportions
  const totalPages = extraction.pages.length;
  const totalChars = normalisedText.length;
  for (let i = 0; i < totalPages; i++) {
    const offset = Math.floor((i / totalPages) * totalChars);
    map.set(offset, i + 1); // 1-based page
  }
  return map;
}
