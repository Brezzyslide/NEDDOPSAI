/**
 * claimPersistenceService — Sprint 29K.3 (Claim Emission & Claim-to-Evidence Binding)
 *
 * Persists validated claims and their evidence bindings in the order required
 * by Sprint 29K.3 Part I:
 *
 *   persistExecutionEvidence()   ← Sprint 29K.2 (already wired)
 *   ↓
 *   persistClaims()              ← this service
 *   ↓
 *   bind claims → evidence links
 *   ↓
 *   update version provenance_status
 *
 * Tenant isolation:
 *   All writes include organizationId.
 *   Evidence link resolution uses (executionId, versionId, chunkId, organizationId)
 *   to prevent cross-tenant binding.
 *
 * Provenance failure:
 *   This service updates completed_work_versions.provenance_status to a durable
 *   value. Completed Work itself is never affected by provenance failure.
 *
 * Audit:
 *   Provenance failure emits a structured org_audit_log event containing
 *   organizationId, executionId, completedWorkId, versionId, failureStage,
 *   errorCode, timestamp. No source passage text is included in audit logs.
 */

import { randomUUID } from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  completedWorkClaimsTable,
  completedWorkClaimEvidenceTable,
  completedWorkVersionsTable,
  completedWorkEvidenceLinksTable,
} from "@workspace/db";
import { logOrgEvent } from "./auditService.js";
import type { EvidencePack } from "./knowledgeResolutionService.js";
import type { ValidatedClaim } from "./claimValidationService.js";
import type { ClaimProvenanceStatus } from "@workspace/db";

// ─── Version provenance status values ─────────────────────────────────────────

export type VersionProvenanceStatus =
  | "pending"
  | "complete"
  | "partial"
  | "failed"
  | "not_available_legacy";

// ─── Persist result ────────────────────────────────────────────────────────────

export interface ClaimPersistenceResult {
  claimsPersisted: number;
  bindingsPersisted: number;
  invalidBindings: number;
  versionProvenanceStatus: VersionProvenanceStatus;
}

// ─── Evidence link resolver ────────────────────────────────────────────────────

/**
 * Resolves the completed_work_evidence_links.id for a given
 * (executionId, versionId, chunkId, organizationId).
 *
 * Returns null if no matching row exists — this prevents orphan claim-evidence
 * links and is the correct response when evidence persistence failed or when
 * a cross-tenant chunk is supplied.
 */
async function resolveEvidenceLinkId(
  executionId: string,
  versionId: string,
  chunkId: string,
  organizationId: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: completedWorkEvidenceLinksTable.id })
    .from(completedWorkEvidenceLinksTable)
    .where(
      and(
        eq(completedWorkEvidenceLinksTable.executionId, executionId),
        eq(completedWorkEvidenceLinksTable.versionId, versionId),
        eq(completedWorkEvidenceLinksTable.chunkId, chunkId),
        eq(completedWorkEvidenceLinksTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

// ─── Version provenance status setter ─────────────────────────────────────────

export async function setVersionProvenanceStatus(
  versionId: string,
  organizationId: string,
  status: VersionProvenanceStatus,
): Promise<void> {
  await db
    .update(completedWorkVersionsTable)
    .set({ provenanceStatus: status })
    .where(
      and(
        eq(completedWorkVersionsTable.id, versionId),
        eq(completedWorkVersionsTable.organizationId, organizationId),
      ),
    );
}

// ─── Provenance audit event ────────────────────────────────────────────────────

async function emitProvenanceFailureAudit(params: {
  organizationId: string;
  executionId: string;
  completedWorkId: string;
  versionId: string;
  failureStage: string;
  errorCode: string;
  errorMessage: string;
}): Promise<void> {
  try {
    await logOrgEvent({
      eventType: "provenance_persistence_failed",
      organizationId: params.organizationId,
      actorType: "agent",
      resourceType: "completed_work_version",
      resourceId: params.versionId,
      metadata: {
        executionId: params.executionId,
        completedWorkId: params.completedWorkId,
        versionId: params.versionId,
        failureStage: params.failureStage,
        errorCode: params.errorCode,
        // NOTE: errorMessage must never contain source passage text
        errorMessage: params.errorMessage.slice(0, 500),
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    // Audit is non-fatal
  }
}

// ─── Main persistence entry point ─────────────────────────────────────────────

export interface PersistClaimsInput {
  executionId: string;
  completedWorkId: string;
  versionId: string;
  organisationId: string;
  validatedClaims: ValidatedClaim[];
  evidencePack: EvidencePack;
}

/**
 * Persists all validated claims and their evidence bindings.
 *
 * Resolution order (Part I):
 *   1. For each claim: INSERT into completed_work_claims
 *   2. For each valid evidence binding: resolve evidence_link_id, INSERT into
 *      completed_work_claim_evidence
 *   3. Resolve relatedClaimIds from clientClaimId → persisted UUID
 *   4. Update relatedClaimIds in DB
 *
 * Idempotent: ON CONFLICT DO NOTHING on both tables.
 *
 * Returns a result describing claim/binding counts and final provenance status.
 * Throws only on unrecoverable errors (e.g. DB connection failure).
 */
export async function persistClaims(
  input: PersistClaimsInput,
): Promise<ClaimPersistenceResult> {
  const {
    executionId,
    completedWorkId,
    versionId,
    organisationId,
    validatedClaims,
    evidencePack,
  } = input;

  if (validatedClaims.length === 0) {
    return {
      claimsPersisted: 0,
      bindingsPersisted: 0,
      invalidBindings: 0,
      versionProvenanceStatus: "complete",
    };
  }

  // ── Step 1: Insert claim rows and build clientClaimId → UUID map ──────────
  const clientIdToUuid = new Map<string, string>();
  let claimsPersisted = 0;

  for (const claim of validatedClaims) {
    const claimId = randomUUID();
    clientIdToUuid.set(claim.clientClaimId, claimId);

    await db
      .insert(completedWorkClaimsTable)
      .values({
        id: claimId,
        executionId,
        completedWorkId,
        versionId,
        organizationId: organisationId,
        claimText: claim.claimText,
        claimType: claim.claimType,
        sectionRef: claim.sectionRef ?? null,
        confidence: claim.confidence ?? null,
        reasoningSummary: claim.reasoningSummary ?? null,
        relatedClaimIds: [], // populated in step 3
        absenceRecord: claim.absenceRecord ?? null,
        provenanceStatus: claim.provenanceStatus,
      })
      .onConflictDoNothing();

    claimsPersisted++;
  }

  // ── Step 2: Insert evidence bindings ─────────────────────────────────────
  let bindingsPersisted = 0;
  let invalidBindings = 0;

  for (const claim of validatedClaims) {
    const claimUuid = clientIdToUuid.get(claim.clientClaimId);
    if (!claimUuid) continue;

    for (const binding of claim.validEvidenceBindings) {
      // Resolve the evidence link row for this (executionId, versionId, chunkId, orgId)
      const evidenceLinkId = await resolveEvidenceLinkId(
        executionId,
        versionId,
        binding.chunkId,
        organisationId,
      );

      if (!evidenceLinkId) {
        // Evidence link not found — evidence persistence may have failed for this chunk
        // or this is a cross-tenant binding. Record as invalid_binding.
        invalidBindings++;
        console.warn(
          "[ClaimPersistenceService] No evidence link row for binding —",
          "claimId:", claimUuid,
          "chunkId:", binding.chunkId,
          "executionId:", executionId,
          "versionId:", versionId,
          "Binding skipped. No orphan rows created.",
        );
        continue;
      }

      try {
        await db
          .insert(completedWorkClaimEvidenceTable)
          .values({
            id: randomUUID(),
            claimId: claimUuid,
            evidenceLinkId,
            organizationId: organisationId,
            relationship: binding.relationship,
            supportingSpan: binding.supportingSpan ?? null,
            spanVerified: binding.spanVerified ? "true" : "false",
          })
          .onConflictDoNothing();

        bindingsPersisted++;
      } catch (err) {
        invalidBindings++;
        console.warn(
          "[ClaimPersistenceService] Failed to insert evidence binding:",
          "claimId:", claimUuid,
          "evidenceLinkId:", evidenceLinkId,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  // ── Step 3: Back-fill relatedClaimIds with resolved UUIDs ─────────────────
  for (const claim of validatedClaims) {
    const claimUuid = clientIdToUuid.get(claim.clientClaimId);
    if (!claimUuid) continue;
    if (claim.relatedClaimIds.length === 0) continue;

    const resolvedIds = claim.relatedClaimIds
      .map((cid) => clientIdToUuid.get(cid))
      .filter((uuid): uuid is string => Boolean(uuid));

    if (resolvedIds.length > 0) {
      await db
        .update(completedWorkClaimsTable)
        .set({ relatedClaimIds: resolvedIds })
        .where(eq(completedWorkClaimsTable.id, claimUuid));
    }
  }

  // ── Determine version-level provenance status ─────────────────────────────
  const hasInvalidBindings = invalidBindings > 0;
  const hasInvalidClaimBindings = validatedClaims.some(
    (c) => c.provenanceStatus === "invalid_binding",
  );

  const versionProvenanceStatus: VersionProvenanceStatus =
    hasInvalidBindings || hasInvalidClaimBindings ? "partial" : "complete";

  return {
    claimsPersisted,
    bindingsPersisted,
    invalidBindings,
    versionProvenanceStatus,
  };
}

// ─── Full provenance chain (evidence + claims) ────────────────────────────────

export interface ProvenanceChainInput {
  executionId: string;
  completedWorkId: string;
  versionId: string;
  organisationId: string;
  evidencePack: EvidencePack;
  validatedClaims: ValidatedClaim[];
  /** persistExecutionEvidence function injected to avoid circular imports */
  persistEvidence: () => Promise<void>;
}

/**
 * Executes the full provenance persistence chain in the required order:
 *
 *   1. persistExecutionEvidence  (Sprint 29K.2)
 *   2. persistClaims             (Sprint 29K.3)
 *   3. bind claims → evidence links
 *   4. setVersionProvenanceStatus → complete | partial | failed
 *
 * Emits a structured audit event on failure.
 * Throws on unrecoverable failure so the fire-and-forget caller can log it.
 */
export async function persistProvenanceChain(
  input: ProvenanceChainInput,
): Promise<void> {
  const { executionId, completedWorkId, versionId, organisationId, evidencePack, validatedClaims, persistEvidence } = input;

  try {
    // ── Stage 1: Evidence persistence (Sprint 29K.2 service) ─────────────
    await persistEvidence();
  } catch (err) {
    await setVersionProvenanceStatus(versionId, organisationId, "failed");
    await emitProvenanceFailureAudit({
      organizationId: organisationId,
      executionId,
      completedWorkId,
      versionId,
      failureStage: "evidence_persistence",
      errorCode: "EVIDENCE_PERSISTENCE_ERROR",
      errorMessage: err instanceof Error ? err.message : "Unknown error",
    });
    throw err;
  }

  try {
    // ── Stage 2 + 3: Claim persistence + evidence binding ────────────────
    const result = await persistClaims({
      executionId,
      completedWorkId,
      versionId,
      organisationId,
      validatedClaims,
      evidencePack,
    });

    await setVersionProvenanceStatus(versionId, organisationId, result.versionProvenanceStatus);
  } catch (err) {
    // Evidence persisted but claims failed — mark as partial
    await setVersionProvenanceStatus(versionId, organisationId, "partial");
    await emitProvenanceFailureAudit({
      organizationId: organisationId,
      executionId,
      completedWorkId,
      versionId,
      failureStage: "claim_persistence",
      errorCode: "CLAIM_PERSISTENCE_ERROR",
      errorMessage: err instanceof Error ? err.message : "Unknown error",
    });
    throw err;
  }
}
