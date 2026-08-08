/**
 * Evidence Persistence Service — Sprint 29K.2 (Durable Evidence Foundation)
 *
 * Persists the EvidencePack produced during specialist execution into two
 * durable tables, implementing the Hybrid model recommended in Sprint 29K.1:
 *
 *   completed_work_evidence_snapshots  — one row per (executionId, versionId)
 *   completed_work_evidence_links      — one row per chunk included in the pack
 *
 * Design principles:
 *
 *   1. SAME INSTANCE — persists from the same EvidencePack object used for
 *      specialist generation and self-review. No second retrieval.
 *
 *   2. VERSION OWNERSHIP — evidence is bound to the exact Completed Work version
 *      created from it. V1 and V2 each retain their own provenance.
 *
 *   3. IDEMPOTENT — (executionId, versionId) uniqueness on snapshot;
 *      (executionId, versionId, chunkId) uniqueness on links.
 *      Retry/recovery does not produce duplicate rows.
 *
 *   4. HYBRID — references (chunkId, sourceId, sourceVersionId) for live lookup
 *      + snapshots (passageHash, passageSnapshot, sectionTitle, pageNumber)
 *      for reconstruction after re-ingestion or soft-deletion.
 *
 *   5. INTEGRITY — passageHash is SHA-256 of the FULL chunk.text at execution
 *      time. verifyEvidencePassageIntegrity() later compares live text to detect
 *      re-ingestion drift (new chunk IDs) or in-place text change (impossible
 *      by design but detectable as a safety net).
 *
 *   6. FAIL SOFT — evidence persistence failure does not fail Completed Work
 *      creation. The work is preserved; the gap is logged as a provenance failure
 *      for operator visibility. This matches the submitForApproval failure pattern.
 *
 * @see Sprint 29K.1 — Evidence Immutability & Reconstruction Design Gate
 */

import { createHash, randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  completedWorkEvidenceSnapshotsTable,
  completedWorkEvidenceLinksTable,
  knowledgeChunksTable,
} from "@workspace/db";
import { eq, and, isNull, or } from "drizzle-orm";

import type { EvidencePack, EvidenceChunk } from "./knowledgeResolutionService.js";

/**
 * Maximum characters stored in the passage snapshot.
 * snapshot ≠ full text. passageHash always covers the full text.
 */
export const PASSAGE_SNAPSHOT_MAX_CHARS = 800;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EvidencePersistenceInput {
  executionId: string;
  completedWorkId: string;
  /** The exact versionId of the Completed Work version generated from this pack */
  versionId: string;
  organisationId: string;
  evidencePack: EvidencePack;
}

export type PassageIntegrityStatus = "verified" | "snapshot_only" | "changed";

export interface PassageIntegrityResult {
  chunkId: string;
  status: PassageIntegrityStatus;
  /** Present when status = "verified" — confirms live text matches hash */
  liveHashMatched?: boolean;
  /** The stored passageHash for comparison */
  storedHash: string;
  /** The computed hash of live chunk text (present only when chunk found) */
  liveHash?: string;
}

export interface EvidenceLink {
  id: string;
  executionId: string;
  completedWorkId: string;
  versionId: string;
  organizationId: string;
  chunkId: string;
  sourceId: string;
  sourceVersionId: string | null;
  passageHash: string;
  passageSnapshot: string;
  sectionTitle: string | null;
  pageNumber: number | null;
  relevanceScore: number;
  selectionReason: string;
  createdAt: Date;
}

// ─── Passage helpers ──────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hex of the FULL chunk text.
 * This hash is the integrity anchor — never truncated.
 */
export function computePassageHash(fullText: string): string {
  return createHash("sha256").update(fullText, "utf8").digest("hex");
}

/**
 * Extract a bounded passage snapshot for display/audit.
 *
 * Rule (per Sprint 29K.2 brief, section B):
 *   If retrieval exposes a matched span: snapshot the region around it.
 *   Else (current retrieval is lexical-only, no span): deterministic excerpt.
 *
 * Current retrieval does not expose matched spans, so we take the first
 * PASSAGE_SNAPSHOT_MAX_CHARS characters. When hybrid retrieval with span
 * highlighting is added, update this function to use the span.
 *
 * snapshot ≠ full text. passageHash always covers the full text.
 */
export function extractPassageSnapshot(fullText: string): string {
  if (fullText.length <= PASSAGE_SNAPSHOT_MAX_CHARS) return fullText;
  // Trim at last whitespace boundary to avoid cutting mid-word
  const truncated = fullText.slice(0, PASSAGE_SNAPSHOT_MAX_CHARS);
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace > PASSAGE_SNAPSHOT_MAX_CHARS * 0.8
    ? truncated.slice(0, lastSpace)
    : truncated;
}

// ─── Core persistence ─────────────────────────────────────────────────────────

/**
 * Persist EvidencePack provenance for a Completed Work version.
 *
 * Timing: called AFTER createDraft() succeeds and the versionId is known.
 * Uses the same EvidencePack instance as generation and self-review — no
 * second retrieval is performed.
 *
 * Idempotent: ON CONFLICT DO NOTHING on both tables. Safe to call again
 * if the execution recovery path retries after a transient failure.
 *
 * Error handling: throws on DB error so the caller can decide whether to
 * propagate or absorb (see Sprint 29K.2 section D).
 */
export async function persistExecutionEvidence(
  input: EvidencePersistenceInput,
): Promise<{ snapshotId: string; linkCount: number }> {
  const { executionId, completedWorkId, versionId, organisationId, evidencePack } = input;

  const pack = evidencePack;
  const snapshotId = randomUUID();
  const now = new Date();

  // ── 1. Snapshot row (execution-level) ──────────────────────────────────────

  await db
    .insert(completedWorkEvidenceSnapshotsTable)
    .values({
      id:                   snapshotId,
      executionId,
      completedWorkId,
      versionId,
      organizationId:       organisationId,
      totalChunksAvailable: pack.totalChunks,
      avgRelevanceScore:    pack.avgConfidence ?? null,
      retrievalMethod:      pack.retrievalMetrics?.queryCount > 1 ? "hybrid" : "lexical",
      retrievalMs:          pack.retrievalMetrics?.retrievalMs ?? null,
      createdAt:            now,
    })
    .onConflictDoNothing(); // idempotency guard

  // ── 2. Per-chunk link rows ─────────────────────────────────────────────────

  const linkRows = pack.chunks.map((chunk: EvidenceChunk) => ({
    id:              randomUUID(),
    executionId,
    completedWorkId,
    versionId,
    organizationId:  organisationId,
    chunkId:         chunk.chunkId,
    sourceId:        chunk.sourceId,
    sourceVersionId: chunk.sourceVersionId ?? null,
    passageHash:     computePassageHash(chunk.text),
    passageSnapshot: extractPassageSnapshot(chunk.text),
    sectionTitle:    chunk.sectionTitle ?? null,
    pageNumber:      chunk.pageNumber ?? null,
    relevanceScore:  chunk.confidence,
    selectionReason: chunk.selectionReason,
    createdAt:       now,
  }));

  if (linkRows.length > 0) {
    // Batch insert in chunks of 100 to stay within parameter limits
    const BATCH = 100;
    for (let i = 0; i < linkRows.length; i += BATCH) {
      await db
        .insert(completedWorkEvidenceLinksTable)
        .values(linkRows.slice(i, i + BATCH))
        .onConflictDoNothing(); // idempotency guard
    }
  }

  return { snapshotId, linkCount: linkRows.length };
}

// ─── Integrity verification ───────────────────────────────────────────────────

/**
 * Verify that a persisted evidence link still matches the live chunk.
 *
 * Sprint 29K.1 integrity states:
 *
 *   MATCH        → live chunk text SHA-256 equals passageHash → "verified"
 *   NOT FOUND    → chunk soft-deleted or re-ingested (new UUID)  → "snapshot_only"
 *   HASH MISMATCH → chunk text changed in place (design violation) → "changed"
 *
 * Does NOT mutate historical evidence. Never replaces passageSnapshot.
 * Caller may use passageSnapshot for display in "snapshot_only" and "changed" cases.
 *
 * Soft-deleted chunks: queries with OR deleted_at IS NOT NULL so the lookup
 * succeeds even when the chunk has been soft-deleted by re-ingestion.
 */
export async function verifyEvidencePassageIntegrity(
  evidenceLink: Pick<EvidenceLink, "chunkId" | "passageHash" | "organizationId">,
): Promise<PassageIntegrityResult> {
  const { chunkId, passageHash, organizationId } = evidenceLink;

  // Include soft-deleted chunks (re-ingestion soft-deletes old rows)
  const rows = await db
    .select({ text: knowledgeChunksTable.text })
    .from(knowledgeChunksTable)
    .where(
      and(
        eq(knowledgeChunksTable.id, chunkId),
        eq(knowledgeChunksTable.organizationId, organizationId),
        // Include soft-deleted: we need the old text to check the hash
        or(
          isNull(knowledgeChunksTable.deletedAt),
          // Soft-deleted row still present — check it
          eq(knowledgeChunksTable.id, chunkId),
        ),
      ),
    )
    .limit(1);

  const row = rows[0];

  if (!row) {
    // Chunk absent entirely (hard-deleted by cascade, or UUID reassigned on re-ingest)
    return { chunkId, status: "snapshot_only", storedHash: passageHash };
  }

  const liveHash = computePassageHash(row.text);
  if (liveHash === passageHash) {
    return {
      chunkId,
      status:          "verified",
      liveHashMatched: true,
      storedHash:      passageHash,
      liveHash,
    };
  }

  return {
    chunkId,
    status:     "changed",
    storedHash: passageHash,
    liveHash,
  };
}

// ─── Query helpers ────────────────────────────────────────────────────────────

/**
 * Load all evidence links for a specific completed work version.
 * Used by the approved-version viewer and export paths.
 * Filters by both versionId and organisationId (tenant safety).
 */
export async function getEvidenceLinksForVersion(
  versionId: string,
  organisationId: string,
): Promise<EvidenceLink[]> {
  return db
    .select()
    .from(completedWorkEvidenceLinksTable)
    .where(
      and(
        eq(completedWorkEvidenceLinksTable.versionId, versionId),
        eq(completedWorkEvidenceLinksTable.organizationId, organisationId),
      ),
    ) as Promise<EvidenceLink[]>;
}

/**
 * Load the evidence snapshot for a specific (executionId, versionId) pair.
 */
export async function getEvidenceSnapshot(
  executionId: string,
  versionId: string,
  organisationId: string,
) {
  const rows = await db
    .select()
    .from(completedWorkEvidenceSnapshotsTable)
    .where(
      and(
        eq(completedWorkEvidenceSnapshotsTable.executionId, executionId),
        eq(completedWorkEvidenceSnapshotsTable.versionId, versionId),
        eq(completedWorkEvidenceSnapshotsTable.organizationId, organisationId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
