/**
 * claimValidationService — Sprint 29K.3 (Claim Emission & Claim-to-Evidence Binding)
 *
 * Server-side validation for claims emitted by the specialist LLM.
 *
 * Core principle: do NOT trust the LLM blindly.
 *
 * Responsibilities:
 *   1. Taxonomy validation — claim type, confidence range, reasoningSummary length
 *   2. Supporting-span verification — exact substring check against EvidenceChunk.text
 *   3. Evidence-link validation — every referenced chunkId MUST be in the EvidencePack
 *   4. Type-specific rules:
 *        observation       — requires at least one valid direct_support binding
 *        inference         — requires relatedClaimIds pointing to supported findings
 *        recommendation    — requires relatedClaimIds pointing to findings
 *        external_requirement — requires external_authority binding from approved source
 *        absence_finding   — unverified_absence unless proven by structured retrieval evidence
 *   5. Contradiction rules — both sides must have verified spans
 *   6. Provenance status calculation — grounded / unsupported / unverified_absence / invalid_binding
 *
 * KRS ABSENCE FINDING LIMITATION (Sprint 29K.3):
 *   The current KRS architecture performs a single bulk retrieval per execution.
 *   There is no per-claim targeted search, no claim-specific absence-search record,
 *   and no dedicated empty-result query for specific terms. Therefore:
 *   - absence_finding claims cannot be marked "grounded" in this sprint.
 *   - They must be classified as "unverified_absence" pending the KRS extension
 *     described in the Sprint 29K.4 scope.
 *   - This is honest. Do not fabricate absence proof.
 */

import type { EvidencePack, EvidenceChunk } from "./knowledgeResolutionService.js";
import type {
  ClaimType,
  ClaimProvenanceStatus,
  AbsenceEvidenceRecord,
} from "@workspace/db";
import type { ClaimRelationship } from "@workspace/db";
import {
  classifySpanSupport,
  detectClaimTypeRisk,
  type SupportClassification,
  type ConflictSignal,
} from "./semanticSupportValidator.js";
import {
  CARE_PLAN_ADL_CANONICAL_ROWS,
  type CarePlanAdlMappingMode,
  isCanonicalCarePlanAdlActivity,
  normaliseCarePlanAdlActivity,
} from "./carePlanAdlModel.js";

// ─── Raw claim shape as emitted by the specialist LLM ─────────────────────────

export interface RawClaimEvidence {
  chunkId: string;
  relationship: ClaimRelationship;
  supportingSpan?: string;
}

export interface RawClaim {
  /** Temporary execution-local identity (e.g. "F1", "C1", "R1"). */
  clientClaimId: string;
  claimText: string;
  claimType: ClaimType;
  sectionRef?: string;
  confidence?: number;
  reasoningSummary?: string;
  evidence: RawClaimEvidence[];
  /** clientClaimId references to other claims in the same batch. */
  relatedClaimIds: string[];
  absenceRecord?: AbsenceEvidenceRecord;
}

// ─── Validated claim shape (after server-side validation) ─────────────────────

export interface ValidatedEvidenceBinding {
  chunkId: string;
  relationship: ClaimRelationship;
  /** Verified exact substring — null if absent or failed verification. */
  supportingSpan: string | null;
  spanVerified: boolean;
  /**
   * True when the model provided a span but it failed exact-substring verification.
   * Used to classify the binding as invalid_binding even though supportingSpan is null.
   */
  spanRejected: boolean;
  /** Rejection reason if span failed verification. */
  spanRejectionReason?: string;
  /**
   * Sprint 29K.4: semantic support classification for the verified span.
   * null when no span was provided or span failed verification.
   */
  semanticSupport: SupportClassification | null;
  /**
   * Sprint 29K.4: material fact conflict signals detected by the deterministic checker.
   * Empty when semanticSupport = "supporting" or no span was verified.
   */
  semanticConflicts: ConflictSignal[];
}

export interface ValidatedClaim {
  clientClaimId: string;
  claimText: string;
  claimType: ClaimType;
  sectionRef?: string;
  confidence: number | null;
  /** Clamped to max 200 chars. */
  reasoningSummary: string | null;
  /** clientClaimId references — resolved to UUIDs at persistence time. */
  relatedClaimIds: string[];
  absenceRecord: AbsenceEvidenceRecord | null;
  provenanceStatus: ClaimProvenanceStatus;
  validEvidenceBindings: ValidatedEvidenceBinding[];
  /** Validation failure reasons for audit/diagnostics. */
  validationFailures: string[];
}

/**
 * Sprint 29K.4.1: clientClaimIds that appeared more than once in the submitted batch.
 * Duplicates (all but the first occurrence) are dropped and counted in malformedDropped.
 */
export interface ClaimBatchValidationResult {
  /** clientClaimIds with more than one occurrence in the batch. */
  duplicateClientClaimIds?: string[];
  claims: ValidatedClaim[];
  /** Number of claims that were structurally malformed (not ClaimType etc). */
  malformedDropped: number;
  /** Number of evidence bindings rejected (invented chunkId, failed span, etc). */
  bindingsRejected: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_CLAIM_TYPES: ClaimType[] = [
  "observation",
  "absence_finding",
  "inference",
  "external_requirement",
  "recommendation",
];

const VALID_RELATIONSHIPS: ClaimRelationship[] = [
  "direct_support",
  "context",
  "contradiction",
  "external_authority",
  "searched_for_absence",
];

const REASONING_SUMMARY_MAX_CHARS = 200;

/** Source types that qualify as approved external authority. */
const APPROVED_EXTERNAL_SOURCE_TYPES = new Set([
  "legislation",
  "legislation_reference",
  "regulation",
  "standard",
  "standards",          // plural form used by the enrichment pipeline
  "regulator_guidance",
  "external_authority",
]);

// ─── Supporting-span verification ─────────────────────────────────────────────

export interface SpanVerificationResult {
  verified: boolean;
  byteExact: boolean;
  normalised: boolean;
  normalisedSpan: string;
  normalisedChunkExcerpt: string | null;
  normalisationApplied: string[];
}

const SPAN_NORMALISATION_STEPS = [
  "NFKC unicode normalisation",
  "case folded",
  "soft hyphens removed",
  "hyphenated line breaks joined",
  "line breaks/whitespace collapsed",
  "trimmed",
];

function normaliseEvidenceSpanText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\u00AD/g, "")
    .replace(/([A-Za-z])-\s*[\r\n]+\s*([A-Za-z])/g, "$1$2")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Verifies that `span` exists inside `chunkText` after PDF-safe normalisation.
 * A positive result means the supporting passage is real; semantic support for
 * the assertion is still classified separately.
 */
export function verifySpanDetailed(span: string, chunkText: string): SpanVerificationResult {
  if (!span || !chunkText) {
    return {
      verified: false,
      byteExact: false,
      normalised: true,
      normalisedSpan: "",
      normalisedChunkExcerpt: null,
      normalisationApplied: SPAN_NORMALISATION_STEPS,
    };
  }
  const byteExact = chunkText.includes(span);
  const normalisedSpan = normaliseEvidenceSpanText(span);
  const normalisedChunk = normaliseEvidenceSpanText(chunkText);
  const verified = byteExact || (Boolean(normalisedSpan) && normalisedChunk.includes(normalisedSpan));
  const index = normalisedSpan ? normalisedChunk.indexOf(normalisedSpan) : -1;
  return {
    verified,
    byteExact,
    normalised: !byteExact,
    normalisedSpan,
    normalisedChunkExcerpt: index >= 0
      ? normalisedChunk.slice(Math.max(0, index - 80), index + normalisedSpan.length + 80)
      : null,
    normalisationApplied: SPAN_NORMALISATION_STEPS,
  };
}

export function normaliseEvidenceTextForComparison(value: string): string {
  return normaliseEvidenceSpanText(value);
}

export function verifySpan(span: string, chunkText: string): boolean {
  return verifySpanDetailed(span, chunkText).verified;
}

// ─── External authority check ──────────────────────────────────────────────────

/**
 * Returns true if the chunk comes from an approved external-authority source.
 * Until an explicit approved external provider is configured, internal org
 * policy documents do NOT qualify — only recognised external types do.
 */
export function isApprovedExternalSource(chunk: EvidenceChunk): boolean {
  return APPROVED_EXTERNAL_SOURCE_TYPES.has(chunk.sourceType.toLowerCase());
}

// ─── Taxonomy validation ──────────────────────────────────────────────────────

/**
 * Validates and normalises the raw claim shape.
 * Returns null if the claim is structurally malformed (missing required fields).
 */
function normaliseRawClaim(raw: unknown): RawClaim | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  if (typeof r.clientClaimId !== "string" || !r.clientClaimId) return null;
  if (typeof r.claimText !== "string" || !r.claimText.trim()) return null;
  if (!VALID_CLAIM_TYPES.includes(r.claimType as ClaimType)) return null;

  return {
    clientClaimId: r.clientClaimId,
    claimText: r.claimText.trim(),
    claimType: r.claimType as ClaimType,
    sectionRef: typeof r.sectionRef === "string" ? r.sectionRef : undefined,
    confidence:
      typeof r.confidence === "number"
        ? Math.min(1, Math.max(0, r.confidence))
        : undefined,
    reasoningSummary:
      typeof r.reasoningSummary === "string"
        ? r.reasoningSummary.slice(0, REASONING_SUMMARY_MAX_CHARS)
        : undefined,
    evidence: Array.isArray(r.evidence) ? (r.evidence as RawClaimEvidence[]) : [],
    relatedClaimIds: Array.isArray(r.relatedClaimIds)
      ? (r.relatedClaimIds as string[]).filter((x) => typeof x === "string")
      : [],
    absenceRecord:
      r.absenceRecord && typeof r.absenceRecord === "object"
        ? (r.absenceRecord as AbsenceEvidenceRecord)
        : undefined,
  };
}

// ─── Per-claim validation ──────────────────────────────────────────────────────

function validateSingleClaim(
  claim: RawClaim,
  evidencePack: EvidencePack,
  /** clientClaimIds of all validated claims in this batch (for relation checking). */
  allClientIds: Set<string>,
): ValidatedClaim {
  const chunkIndex = new Map<string, EvidenceChunk>(
    evidencePack.chunks.map((c) => [c.chunkId, c]),
  );

  const failures: string[] = [];
  const validBindings: ValidatedEvidenceBinding[] = [];

  // ── Validate and verify each evidence binding ────────────────────────────
  for (const ev of claim.evidence) {
    // 1. Relationship must be a known value
    if (!VALID_RELATIONSHIPS.includes(ev.relationship)) {
      failures.push(
        `Evidence binding for chunkId "${ev.chunkId}" has unknown relationship "${ev.relationship}" — rejected`,
      );
      continue;
    }

    // 2. ChunkId must exist in this execution's EvidencePack (Part E / adversarial test 1)
    const chunk = chunkIndex.get(ev.chunkId);
    if (!chunk) {
      failures.push(
        `Evidence binding references chunkId "${ev.chunkId}" which is NOT in this execution's EvidencePack — rejected`,
      );
      continue;
    }

    // 3. Span verification (Part D)
    let supportingSpan: string | null = null;
    let spanVerified = false;
    let spanRejectionReason: string | undefined;

    let spanRejected = false;

    // Sprint 29K.4: semantic support classification for verified spans
    let semanticSupport: SupportClassification | null = null;
    let semanticConflicts: ConflictSignal[] = [];

    if (ev.supportingSpan) {
      const spanVerification = verifySpanDetailed(ev.supportingSpan, chunk.text);
      if (spanVerification.verified) {
        supportingSpan = ev.supportingSpan;
        spanVerified = true;
        // Sprint 29K.4: classify semantic support — does the span actually support the claim?
        const spanResult = classifySpanSupport(ev.supportingSpan, chunk.text, claim.claimText);
        semanticSupport = spanResult.classification;
        semanticConflicts = spanResult.conflicts;
        if (spanResult.conflicts.length > 0) {
          for (const c of spanResult.conflicts) {
            failures.push(
              `Semantic support conflict [${c.signalType}]: ${c.description}`,
            );
          }
        }
      } else {
        // Do NOT replace with passageSnapshot. Record the failure.
        // supportingSpan stays null (rejected quotation must not be persisted).
        // spanRejected = true so callers can distinguish "no span provided" from
        // "span was provided but failed verification".
        spanRejected = true;
        spanRejectionReason =
          `supportingSpan "${ev.supportingSpan.slice(0, 60)}..." is NOT present in chunkId "${ev.chunkId}" after normalisation (${spanVerification.normalisationApplied.join(", ")}) — span rejected, binding retained without span`;
        failures.push(spanRejectionReason);
      }
    }

    validBindings.push({
      chunkId: ev.chunkId,
      relationship: ev.relationship,
      supportingSpan,
      spanVerified,
      spanRejected,
      spanRejectionReason,
      semanticSupport,
      semanticConflicts,
    });
  }

  // ── Type-specific provenance rules (Part E) ──────────────────────────────
  let provenanceStatus: ClaimProvenanceStatus;

  switch (claim.claimType) {
    case "observation": {
      // Requires at least one valid direct_support OR contradiction binding.
      // Contradiction observations (Part F) use the "contradiction" relationship
      // for both sides; they still require a supporting binding to be present.
      const hasSupportingBinding = validBindings.some(
        (b) => (b.relationship === "direct_support" || b.relationship === "contradiction") &&
               chunkIndex.has(b.chunkId),
      );
      if (!hasSupportingBinding) {
        failures.push(
          "observation requires at least one direct_support or contradiction evidence binding — none found",
        );
        provenanceStatus = "unsupported";
      } else {
        // If the model provided a span that failed verification, the binding is invalid.
        // Check spanRejected (not supportingSpan !== null) since rejected spans are nulled.
        const hasRejectedSpans = validBindings.some((b) => b.spanRejected);
        provenanceStatus = hasRejectedSpans ? "invalid_binding" : "grounded";
      }
      break;
    }

    case "absence_finding": {
      /**
       * HONEST ABSENCE FINDING CLASSIFICATION:
       *
       * Absence findings start as "unverified_absence" after basic validation.
       * The absenceVerificationService (Sprint 29K.4) then performs targeted
       * per-claim searches and upgrades the status to:
       *   - "verified_absence"    when targeted search finds nothing in fully-ingested sources
       *   - "contradicted_absence" when targeted search finds the supposedly absent requirement
       *   - "unverified_absence"  (unchanged) when coverage or retrieval is insufficient
       *
       * This default status is correct and must not be changed here.
       * "No result from bulk retrieval" does NOT prove absence.
       */
      provenanceStatus = "unverified_absence";
      break;
    }

    case "inference": {
      // Requires at least one relatedClaimId pointing to a supported finding
      const hasRelatedClaim = claim.relatedClaimIds.some((id) => allClientIds.has(id));
      if (!hasRelatedClaim) {
        failures.push("inference requires at least one relatedClaimId linking to a supported finding — none found");
        provenanceStatus = "unsupported";
      } else {
        const hasRejectedSpans = validBindings.some((b) => b.spanRejected);
        provenanceStatus = hasRejectedSpans ? "invalid_binding" : "grounded";
      }
      break;
    }

    case "recommendation": {
      // Requires at least one relatedClaimId pointing to a finding
      const hasFindingLink = claim.relatedClaimIds.some((id) => allClientIds.has(id));
      if (!hasFindingLink) {
        failures.push("recommendation requires at least one relatedClaimId linking to a finding — none found");
        provenanceStatus = "unsupported";
      } else {
        provenanceStatus = "grounded";
      }
      break;
    }

    case "external_requirement": {
      // Requires an external_authority binding from an approved source type (Part E)
      const externalBinding = validBindings.find(
        (b) => b.relationship === "external_authority",
      );
      if (!externalBinding) {
        failures.push(
          "external_requirement requires relationship=external_authority from an approved external source — " +
          "no such binding found. Model training knowledge cannot satisfy this requirement.",
        );
        provenanceStatus = "unsupported_external";
        break;
      }
      const extChunk = chunkIndex.get(externalBinding.chunkId);
      if (!extChunk || !isApprovedExternalSource(extChunk)) {
        failures.push(
          `external_requirement: source type "${extChunk?.sourceType ?? "unknown"}" is not an approved external authority ` +
          "(requires: legislation, regulation, standards, legislation_reference, regulator_guidance, or external_authority). " +
          "Model training knowledge does not qualify. Status: unsupported_external.",
        );
        provenanceStatus = "unsupported_external";
        break;
      }
      const hasRejectedSpans = validBindings.some((b) => b.spanRejected);
      provenanceStatus = hasRejectedSpans ? "invalid_binding" : "grounded";
      break;
    }

    default:
      failures.push(`Unknown claimType "${(claim as RawClaim).claimType}" — unsupported`);
      provenanceStatus = "unsupported";
  }

  // ── Contradiction completeness check (Part F) ────────────────────────────
  // Applies to observation claims that use contradiction bindings.
  // Both sides of the contradiction must be present (≥2 contradiction bindings).
  if (claim.claimType === "observation") {
    const contradictions = validBindings.filter((b) => b.relationship === "contradiction");
    if (contradictions.length === 1) {
      // Only one side supplied — not a valid grounded contradiction
      failures.push(
        "Contradiction claim has only one contradiction binding — both sides must be present. " +
        "provenanceStatus degraded to invalid_binding.",
      );
      if (provenanceStatus === "grounded") provenanceStatus = "invalid_binding";
    }
    // 0 contradictions: falls through to normal observation rule (may be grounded via direct_support)
    // ≥2 contradictions: grounded (subject to span checks above)
  }

  // ── Sprint 29K.4: Semantic support downgrade ─────────────────────────────
  // If any verified span has a material conflict detected by the deterministic
  // checker, downgrade grounded → support_uncertain.
  // This fires AFTER type-specific rules so invalid_binding still takes priority.
  if (provenanceStatus === "grounded") {
    const hasSemanticConflict = validBindings.some(
      (b) => b.semanticSupport === "uncertain" || b.semanticSupport === "contradictory",
    );
    if (hasSemanticConflict) {
      const allConflicts = validBindings.flatMap((b) => b.semanticConflicts);
      failures.push(
        `Semantic support check: ${allConflicts.length} material conflict(s) detected — ` +
        allConflicts.map((c) => c.description).join("; ") +
        ". Span exists but may not support the claim. Status: support_uncertain.",
      );
      provenanceStatus = "support_uncertain";
    }
  }

  // ── Sprint 29K.4: Claim-type integrity gate ───────────────────────────────
  // If the specialist labelled a claim as "observation" but the claim text
  // contains inference or absence language, downgrade grounded → support_uncertain.
  // We do NOT alter claimType (the stored model output); only the provenanceStatus
  // is downgraded to prevent inference from appearing as documentary fact.
  if (provenanceStatus === "grounded" && claim.claimType === "observation") {
    const typeRisk = detectClaimTypeRisk(claim.claimText, claim.claimType);
    if (typeRisk.risk !== "none") {
      failures.push(
        `Claim-type integrity check [${typeRisk.risk}]: ` +
        typeRisk.signals.join("; ") +
        " — provenanceStatus downgraded from grounded to support_uncertain.",
      );
      provenanceStatus = "support_uncertain";
    }
  }

  return {
    clientClaimId: claim.clientClaimId,
    claimText: claim.claimText,
    claimType: claim.claimType,
    sectionRef: claim.sectionRef,
    confidence: claim.confidence ?? null,
    reasoningSummary: claim.reasoningSummary ?? null,
    relatedClaimIds: claim.relatedClaimIds,
    absenceRecord: claim.absenceRecord ?? null,
    provenanceStatus,
    validEvidenceBindings: validBindings,
    validationFailures: failures,
  };
}

// ─── Batch validation entry point ─────────────────────────────────────────────

/**
 * Validates an array of raw claims emitted by the specialist.
 *
 * Steps:
 *   1. Normalise (drop malformed claims)
 *   2. Build clientClaimId set for relation checking
 *   3. Validate each claim independently
 *   4. Count rejections for observability
 */
export function validateClaimBatch(
  rawClaims: unknown[],
  evidencePack: EvidencePack,
): ClaimBatchValidationResult {
  let malformedDropped = 0;
  let bindingsRejected = 0;

  const normalisedClaims: RawClaim[] = [];
  for (const raw of rawClaims) {
    const n = normaliseRawClaim(raw);
    if (!n) {
      malformedDropped++;
      console.warn("[ClaimValidation] Dropped malformed claim (missing required fields):", raw);
    } else {
      normalisedClaims.push(n);
    }
  }

  // ── Sprint 29K.4.1: Duplicate clientClaimId detection ─────────────────────
  // Two claims sharing the same clientClaimId can never be safely disambiguated
  // at persistence time. Drop all but the first occurrence and record the IDs
  // for the caller to surface as a validation warning.
  const seenClientIds = new Set<string>();
  const duplicateClientClaimIds: string[] = [];
  const deduplicatedClaims: RawClaim[] = [];

  for (const claim of normalisedClaims) {
    if (seenClientIds.has(claim.clientClaimId)) {
      // Second (or later) occurrence — drop it
      if (!duplicateClientClaimIds.includes(claim.clientClaimId)) {
        duplicateClientClaimIds.push(claim.clientClaimId);
      }
      malformedDropped++;
      console.warn(
        `[ClaimValidation] Duplicate clientClaimId "${claim.clientClaimId}" — ` +
        `second occurrence dropped (would silently overwrite first at persistence).`,
      );
    } else {
      seenClientIds.add(claim.clientClaimId);
      deduplicatedClaims.push(claim);
    }
  }

  const allClientIds = new Set(deduplicatedClaims.map((c) => c.clientClaimId));

  const validated: ValidatedClaim[] = [];
  for (const claim of deduplicatedClaims) {
    const result = validateSingleClaim(claim, evidencePack, allClientIds);
    bindingsRejected += result.validationFailures.filter((f) =>
      f.includes("NOT in this execution's EvidencePack"),
    ).length;
    validated.push(result);
  }

  return {
    claims: validated,
    malformedDropped,
    bindingsRejected,
    duplicateClientClaimIds: duplicateClientClaimIds.length > 0 ? duplicateClientClaimIds : undefined,
  };
}

// ─── Specialist response parsing ───────────────────────────────────────────────

export interface SpecialistJsonOutput {
  content: string;
  claims: RawClaim[];
  professionalWork?: Record<string, unknown>;
  requirementCoverage?: Record<string, unknown>;
  deliverable?: Record<string, unknown>;
  deliverableSections?: ParsedDeliverableSection[];
  completion?: Record<string, unknown>;
}

export interface ParsedDeliverableSection {
  requirementId: string;
  heading: string;
  content: string;
  evidenceSources?: ParsedDeliverableSectionEvidenceSource[];
  structuredRows?: ParsedDeliverableStructuredRow[];
}

export interface ParsedDeliverableSectionEvidenceSource {
  chunkId: string;
  documentTitle: string;
  passage: string;
  location: string;
  evidenceClass?: string;
}

export interface ParsedDeliverableStructuredRow {
  activity: string;
  supportLevel: string;
  workerDescription: string;
  sourceValue: string;
  chunkId: string;
  mappingMode: CarePlanAdlMappingMode;
}

const CARE_PLAN_ADL_GENERATION_FAILED_ROW = {
  supportLevel: "generation_failed",
  workerDescription: "Generation failed - model returned no cells for this canonical ADL activity.",
  sourceValue: "generation_failed",
  chunkId: "generation_failed",
  mappingMode: "CITED_INTERPRETATION" as CarePlanAdlMappingMode,
};

type CarePlanBehaviourFold = "proactive" | "reactive" | "protective";

interface CarePlanBehaviourStrategyRow {
  fold: CarePlanBehaviourFold;
  trigger: string;
  strategy: string;
  workerAction: string;
  bspSource: string;
}

export interface DeterministicTemplateRequirement {
  id: string;
  sourceBlueprintSection?: string;
  targetDeliverableLocation?: string;
  fixedContent?: string[];
  templateFields?: string[];
  completionPrompt?: string | null;
}

export interface DeterministicTemplateBlueprintSection {
  sectionCode: string;
  title: string;
  sortOrder?: number;
  fixedContent?: string[];
  fields?: string[];
  completionPrompt?: string | null;
}

export interface DeterministicTemplateAssemblyResult {
  sections: ParsedDeliverableSection[];
  modelGeneratedSections: ParsedDeliverableSection[];
  deterministicCompleteness: {
    fixedContentComplete: boolean;
    sectionCount: number;
    goalRowCount: number;
  };
}

export function assembleDeterministicTemplateDeliverableSections(input: {
  requirements: DeterministicTemplateRequirement[];
  blueprintSections: DeterministicTemplateBlueprintSection[];
  modelSections: ParsedDeliverableSection[] | undefined;
}): DeterministicTemplateAssemblyResult {
  const modelByRequirement = new Map((input.modelSections ?? []).map((section) => [section.requirementId, section]));
  const blueprintByCode = new Map(input.blueprintSections.map((section) => [section.sectionCode, section]));
  const sections = input.requirements.map((requirement) => {
    const blueprintSection = requirement.sourceBlueprintSection
      ? blueprintByCode.get(requirement.sourceBlueprintSection)
      : undefined;
    const heading = modelByRequirement.get(requirement.id)?.heading?.trim() ||
      blueprintSection?.title ||
      requirement.targetDeliverableLocation ||
      requirement.id;
    const deterministicParts = deterministicTemplateParts(requirement, blueprintSection);
    const modelContent = stripDeterministicTemplateEcho(
      modelByRequirement.get(requirement.id)?.content ?? "",
      deterministicParts,
    );
    return {
      requirementId: requirement.id,
      heading,
      content: [...deterministicParts, modelContent].filter((part) => part.trim()).join("\n\n"),
    };
  });
  const markdown = assembleDeliverableMarkdownFromSections(sections, input.requirements.map((requirement) => requirement.id));
  return {
    sections,
    modelGeneratedSections: input.requirements.map((requirement) => ({
      requirementId: requirement.id,
      heading: modelByRequirement.get(requirement.id)?.heading?.trim() ||
        blueprintByCode.get(requirement.sourceBlueprintSection ?? "")?.title ||
        requirement.targetDeliverableLocation ||
        requirement.id,
      content: stripDeterministicTemplateEcho(modelByRequirement.get(requirement.id)?.content ?? "", deterministicTemplateParts(requirement, blueprintByCode.get(requirement.sourceBlueprintSection ?? ""))),
    })),
    deterministicCompleteness: {
      fixedContentComplete: input.requirements.every((requirement) =>
        (requirement.fixedContent ?? []).every((fixed) => markdown.includes(fixed)),
      ),
      sectionCount: sections.filter((section) => section.content.trim()).length,
      goalRowCount: (markdown.match(/\[CURRENT_SITUATION_\d+\]/g) ?? []).length,
    },
  };
}

export function assembleDeliverableMarkdownFromSections(
  sections: ParsedDeliverableSection[] | undefined,
  requirementOrder: string[] = [],
): string {
  const validSections = (sections ?? [])
    .filter((section) => section.requirementId && section.heading && section.content.trim());
  if (validSections.length === 0) return "";
  const order = new Map(requirementOrder.map((requirementId, index) => [requirementId, index]));
  return [...validSections]
    .sort((left, right) =>
      (order.get(left.requirementId) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.requirementId) ?? Number.MAX_SAFE_INTEGER)
    )
    .map((section) => `## ${section.heading}\n\n${renderDeliverableSectionContent(section)}`)
    .join("\n\n");
}

function renderDeliverableSectionContent(section: ParsedDeliverableSection): string {
  if (isCarePlanAdlDeliverableSection(section) && (section.structuredRows ?? []).length > 0) {
    return renderCarePlanAdlStructuredTable(section.structuredRows ?? []);
  }
  return section.content.trim();
}

export function normaliseDeclaredInstrumentSection(
  section: ParsedDeliverableSection,
): ParsedDeliverableSection {
  if (isCarePlanAdlDeliverableSection(section)) {
    return normaliseCarePlanAdlInstrumentSection(section);
  }
  return section;
}

export function normaliseCarePlanDeclaredInstrumentSection(
  section: ParsedDeliverableSection,
): ParsedDeliverableSection {
  const adlNormalised = normaliseDeclaredInstrumentSection(section);
  if (adlNormalised !== section) return adlNormalised;
  if (section.requirementId === "care-plan-goals") {
    return normaliseMarkdownInstrumentSection(section, renderGenerationFailedGoalsTable());
  }
  if (section.requirementId === "care-plan-mobility-strategy") {
    return normaliseMarkdownInstrumentSection(section, renderGenerationFailedMobilityTable());
  }
  if (section.requirementId === "care-plan-behavioural-management") {
    return normaliseBehaviouralManagementInstrumentSection(section);
  }
  if (section.requirementId === "care-plan-restrictive-practices") {
    return normaliseMarkdownInstrumentSection(section, renderGenerationFailedRestrictivePracticesTable());
  }
  return section;
}

export function buildGenerationFailedDeclaredInstrumentSection(
  requirementId: string,
  heading: string,
  reason: string,
): ParsedDeliverableSection {
  return normaliseCarePlanDeclaredInstrumentSection({
    requirementId,
    heading,
    content: `Generation incomplete - ${reason}`,
    evidenceSources: [],
    structuredRows: [],
  });
}

function normaliseCarePlanAdlInstrumentSection(
  section: ParsedDeliverableSection,
): ParsedDeliverableSection {
  const byActivity = new Map<string, ParsedDeliverableStructuredRow>();
  for (const row of section.structuredRows ?? []) {
    if (!row.activity || !isCanonicalCarePlanAdlActivity(row.activity)) continue;
    const key = normaliseCarePlanAdlActivity(row.activity);
    if (byActivity.has(key)) continue;
    byActivity.set(key, row);
  }

  return {
    ...section,
    structuredRows: CARE_PLAN_ADL_CANONICAL_ROWS.map((activity) => {
      const row = byActivity.get(normaliseCarePlanAdlActivity(activity));
      if (!row) {
        return {
          activity,
          ...CARE_PLAN_ADL_GENERATION_FAILED_ROW,
        };
      }
      return {
        ...row,
        activity,
      };
    }),
  };
}

function normaliseMarkdownInstrumentSection(
  section: ParsedDeliverableSection,
  generationFailedTable: string,
): ParsedDeliverableSection {
  if (containsMarkdownTable(section.content)) return section;
  return {
    ...section,
    content: generationFailedTable,
  };
}

function normaliseBehaviouralManagementInstrumentSection(
  section: ParsedDeliverableSection,
): ParsedDeliverableSection {
  const rows = extractCarePlanBehaviourStrategyRows(section.content);
  if (rows.length === 0) {
    return {
      ...section,
      content: renderGenerationFailedBehaviouralManagementTables(),
    };
  }
  return {
    ...section,
    content: renderCarePlanBehaviouralManagementTables(rows),
  };
}

function containsMarkdownTable(content: string): boolean {
  const rows = content.split(/\r?\n/).map((line) => line.trim());
  return rows.some((line, index) =>
    line.startsWith("|") &&
    line.endsWith("|") &&
    rows[index + 1]?.startsWith("|") === true &&
    /---/.test(rows[index + 1] ?? "")
  );
}

function generationFailedCell(label: string): string {
  return `generation_failed: model returned no cells for ${label}`;
}

function renderGenerationFailedGoalsTable(): string {
  return renderMarkdownRows(
    ["Current situation", "Goal", "Actions", "Person responsible", "Timeframe", "Outcomes"],
    [1, 2, 3].map((index) => [
      generationFailedCell(`goal ${index} current situation`),
      generationFailedCell(`goal ${index}`),
      generationFailedCell(`goal ${index} actions`),
      generationFailedCell(`goal ${index} person responsible`),
      generationFailedCell(`goal ${index} timeframe`),
      generationFailedCell(`goal ${index} outcomes`),
    ]),
  );
}

function renderGenerationFailedMobilityTable(): string {
  return renderMarkdownRows(
    ["Field", "Value", "Source value", "Chunk ID", "Mapping mode"],
    ["Mobility aid required", "Aid or equipment used", "Transfer method", "Number of workers required", "Mobility overview", "Mobility strategy"].map((field) => [
      field,
      generationFailedCell(field),
      "generation_failed",
      "generation_failed",
      "CITED_INTERPRETATION",
    ]),
  );
}

function renderGenerationFailedBehaviouralManagementTables(): string {
  return ["Proactive", "Reactive", "Protective"].map((fold) => [
    `**${fold} strategies**`,
    renderMarkdownRows(
      ["Behaviour or trigger", "Strategy", "What the worker does", "BSP source"],
      [[
        generationFailedCell(`${fold.toLowerCase()} behaviour or trigger`),
        generationFailedCell(`${fold.toLowerCase()} strategy`),
        generationFailedCell(`${fold.toLowerCase()} worker action`),
        "generation_failed",
      ]],
    ),
  ].join("\n\n")).join("\n\n");
}

function renderCarePlanBehaviouralManagementTables(rows: CarePlanBehaviourStrategyRow[]): string {
  return (["proactive", "reactive", "protective"] as CarePlanBehaviourFold[]).map((fold) => {
    const title = `${capitalise(fold)} strategies`;
    const foldRows = rows.filter((row) => row.fold === fold);
    if (foldRows.length === 0) {
      return [
        `**${title}**`,
        `No ${fold} strategies recorded in the BSP.`,
      ].join("\n\n");
    }
    return [
      `**${title}**`,
      renderMarkdownRows(
        ["Behaviour or trigger", "Strategy", "What the worker does", "BSP source"],
        foldRows.map((row) => [row.trigger, row.strategy, row.workerAction, row.bspSource]),
      ),
    ].join("\n\n");
  }).join("\n\n");
}

function extractCarePlanBehaviourStrategyRows(content: string): CarePlanBehaviourStrategyRow[] {
  const rows: CarePlanBehaviourStrategyRow[] = [];
  const used = new Set<string>();
  const foldBlocks = [
    ["proactive", /(?:^|\n)(?:#{1,6}\s+|\*\*)?proactive strategies(?:\*\*)?\s*\n([\s\S]*?)(?=\n(?:#{1,6}\s+|\*\*)?(?:reactive|protective) strategies(?:\*\*)?\s*\n|$)/i],
    ["reactive", /(?:^|\n)(?:#{1,6}\s+|\*\*)?reactive strategies(?:\*\*)?\s*\n([\s\S]*?)(?=\n(?:#{1,6}\s+|\*\*)?protective strategies(?:\*\*)?\s*\n|$)/i],
    ["protective", /(?:^|\n)(?:#{1,6}\s+|\*\*)?protective strategies(?:\*\*)?\s*\n([\s\S]*)$/i],
  ] as const;

  for (const [fold, pattern] of foldBlocks) {
    const body = content.match(pattern)?.[1] ?? "";
    for (const table of extractMarkdownTablesFromText(body)) {
      const indices = behaviouralTableIndices(table.headers);
      if (!indices) continue;
      for (const row of table.rows) {
        const trigger = row[indices.trigger]?.trim() ?? "";
        const strategy = row[indices.strategy]?.trim() ?? "";
        const workerAction = row[indices.workerAction]?.trim() ?? "";
        const bspSource = row[indices.bspSource]?.trim() ?? "";
        if (!trigger || !strategy || !workerAction || !bspSource) continue;
        if (/generation_failed|model returned no cells/i.test(`${trigger} ${strategy} ${workerAction} ${bspSource}`)) continue;
        const key = `${fold}:${trigger}:${strategy}:${workerAction}:${bspSource}`.toLowerCase();
        if (used.has(key)) continue;
        used.add(key);
        rows.push({ fold, trigger, strategy, workerAction, bspSource });
      }
    }
  }

  for (const table of extractMarkdownTablesFromText(content)) {
    const indices = behaviouralTableIndices(table.headers);
    const foldIndex = table.headers.findIndex((header) => normaliseTableHeader(header) === "fold");
    if (!indices || foldIndex < 0) continue;
    for (const row of table.rows) {
      const fold = normaliseBehaviourFold(row[foldIndex] ?? "");
      if (!fold) continue;
      const trigger = row[indices.trigger]?.trim() ?? "";
      const strategy = row[indices.strategy]?.trim() ?? "";
      const workerAction = row[indices.workerAction]?.trim() ?? "";
      const bspSource = row[indices.bspSource]?.trim() ?? "";
      if (!trigger || !strategy || !workerAction || !bspSource) continue;
      const key = `${fold}:${trigger}:${strategy}:${workerAction}:${bspSource}`.toLowerCase();
      if (used.has(key)) continue;
      used.add(key);
      rows.push({ fold, trigger, strategy, workerAction, bspSource });
    }
  }

  return rows;
}

function behaviouralTableIndices(headers: string[]): {
  trigger: number;
  strategy: number;
  workerAction: number;
  bspSource: number;
} | null {
  const normalised = headers.map(normaliseTableHeader);
  const trigger = normalised.findIndex((header) => header.includes("behaviour") || header.includes("trigger"));
  const strategy = normalised.findIndex((header) => header === "strategy" || header.includes("strategy"));
  const workerAction = normalised.findIndex((header) => header.includes("worker does") || header.includes("worker action"));
  const bspSource = normalised.findIndex((header) => header.includes("bsp source") || header.includes("source"));
  if (trigger < 0 || strategy < 0 || workerAction < 0 || bspSource < 0) return null;
  return { trigger, strategy, workerAction, bspSource };
}

function extractMarkdownTablesFromText(markdown: string): Array<{ headers: string[]; rows: string[][] }> {
  const lines = markdown.split(/\r?\n/);
  const tables: Array<{ headers: string[]; rows: string[][] }> = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = lines[index] ?? "";
    const separator = lines[index + 1] ?? "";
    if (!header.includes("|") || !/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(separator)) continue;
    const headers = splitMarkdownTableRow(header);
    const rows: string[][] = [];
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const row = lines[rowIndex] ?? "";
      if (!row.includes("|") || !row.trim()) break;
      rows.push(splitMarkdownTableRow(row));
      index = rowIndex;
    }
    tables.push({ headers, rows });
  }
  return tables;
}

function splitMarkdownTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function normaliseTableHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function normaliseBehaviourFold(value: string): CarePlanBehaviourFold | null {
  const normalised = normaliseTableHeader(value);
  if (normalised.includes("proactive")) return "proactive";
  if (normalised.includes("reactive")) return "reactive";
  if (normalised.includes("protective")) return "protective";
  return null;
}

function renderGenerationFailedRestrictivePracticesTable(): string {
  return renderMarkdownRows(
    [
      "Practice type",
      "What it is in plain language",
      "What the worker does",
      "What the worker must not do",
      "Authorisation status and reference",
      "Recording requirement",
    ],
    [[
      generationFailedCell("practice type"),
      generationFailedCell("plain language description"),
      generationFailedCell("worker action"),
      generationFailedCell("prohibited action"),
      generationFailedCell("authorisation status and reference"),
      generationFailedCell("recording requirement"),
    ]],
  );
}

function deterministicTemplateParts(
  requirement: DeterministicTemplateRequirement,
  blueprintSection?: DeterministicTemplateBlueprintSection,
): string[] {
  const fixedContent = requirement.fixedContent ?? blueprintSection?.fixedContent ?? [];
  const fields = requirement.templateFields ?? blueprintSection?.fields ?? [];
  const completionPrompt = requirement.completionPrompt ?? blueprintSection?.completionPrompt ?? null;
  const scalarFields = fields.filter((field) => !isStructuredTemplateField(field));
  const structuredFields = fields.filter(isStructuredTemplateField);
  return [
    ...fixedContent,
    renderScalarTemplateFields(scalarFields),
    ...structuredFields.map(renderStructuredTemplateField).filter(Boolean),
    renderCompletionPrompt(completionPrompt),
  ].filter((part) => part.trim());
}

function renderScalarTemplateFields(fields: string[]): string {
  if (fields.length === 0) return "";
  return fields.map((field) => `${field}: [${placeholderToken(field)}]`).join("\n");
}

function renderStructuredTemplateField(field: string): string {
  if (/table with columns\s+activity\s*\|\s*support level\s*\|\s*what the worker does/i.test(field)) {
    return renderMarkdownRows(["Activity", "Support level", "What the worker does"], CARE_PLAN_ADL_CANONICAL_ROWS.map((activity) => [
      activity,
      `[SUPPORT_LEVEL_${placeholderToken(activity)}]`,
      `[WHAT_THE_WORKER_DOES_${placeholderToken(activity)}]`,
    ]));
  }

  if (/table with columns\s+practice type\s*\|\s*what it is in plain language\s*\|\s*what the worker does\s*\|\s*what the worker must not do\s*\|\s*authorisation status and reference\s*\|\s*recording requirement/i.test(field)) {
    return renderMarkdownRows([
      "Practice type",
      "What it is in plain language",
      "What the worker does",
      "What the worker must not do",
      "Authorisation status and reference",
      "Recording requirement",
    ], [[
      "[PRACTICE_TYPE]",
      "[RESTRICTIVE_PRACTICE_PLAIN_LANGUAGE]",
      "[RESTRICTIVE_PRACTICE_WORKER_ACTIONS]",
      "[RESTRICTIVE_PRACTICE_WORKER_MUST_NOT_DO]",
      "[RESTRICTIVE_PRACTICE_AUTHORISATION_STATUS_AND_REFERENCE]",
      "[RESTRICTIVE_PRACTICE_RECORDING_REQUIREMENT]",
    ]]);
  }

  const behaviourFold = field.match(/\b(proactive|reactive|protective)\s+strategies\s+table with columns\s+behaviour or trigger\s*\|\s*strategy\s*\|\s*what the worker does\s*\|\s*bsp source/i);
  if (behaviourFold) {
    const fold = behaviourFold[1]!.toLowerCase();
    const prefix = fold.toUpperCase();
    const title = `${capitalise(fold)} strategies`;
    return [
      `### ${title}`,
      renderMarkdownRows([
        "Behaviour or trigger",
        "Strategy",
        "What the worker does",
        "BSP source",
      ], [[
        `[${prefix}_BEHAVIOUR_OR_TRIGGER]`,
        fold === "protective"
          ? `[${prefix}_STRATEGY] (UNCONFIRMED - APO review required before approval)`
          : `[${prefix}_STRATEGY]`,
        `[${prefix}_WORKER_ACTIONS]`,
        `[${prefix}_BSP_SOURCE]`,
      ]]),
    ].join("\n\n");
  }

  const table = field.match(/table with columns\s+(.+)/i);
  if (table) {
    const columns = (table[1] ?? "").split(",")[0]!
      .split("|")
      .map((column) => column.trim())
      .filter(Boolean);
    const rowCount = columns.map((column) => column.toLowerCase()).includes("current situation") ? 3 : 1;
    return renderMarkdownTable(columns, rowCount);
  }

  if (/minimum three personal goal rows/i.test(field) || /description per selected type/i.test(field)) {
    return "";
  }

  const supportTypes = field.match(/support types selected from\s+[—-]\s+(.+)/i);
  if (supportTypes) {
    const types = supportTypes[1]!.split(",").map((item) => item.trim()).filter(Boolean);
    return renderMarkdownRows(["Support type", "Description"], types.map((type) => [
      type,
      `[DESCRIPTION_${placeholderToken(type)}]`,
    ]));
  }

  if (field.includes(":")) {
    const [prefix, values] = field.split(/:\s+/, 2);
    const labels = (values ?? "").split(",").map((label) => label.trim()).filter(Boolean);
    if (labels.length > 1) {
      return [`${prefix}:`, ...labels.map((label) => `${label}: [${placeholderToken(label)}]`)].join("\n");
    }
  }

  return `${field}: [${placeholderToken(field)}]`;
}

function renderCompletionPrompt(completionPrompt: string | null): string {
  if (!completionPrompt?.trim()) return "";
  return `> *Guidance: ${completionPrompt.trim()}*`;
}

function isStructuredTemplateField(field: string): boolean {
  return /table with columns|minimum three personal goal rows|support types selected from|description per selected type|:\s*[^:]+,\s*[^:]+/i.test(field);
}

function renderMarkdownTable(columns: string[], rowCount: number): string {
  const rows = Array.from({ length: rowCount }, (_, rowIndex) =>
    columns.map((column) => `[${placeholderToken(column)}${rowCount > 1 ? `_${rowIndex + 1}` : ""}]`),
  );
  return renderMarkdownRows(columns, rows);
}

function renderCarePlanAdlStructuredTable(rows: ParsedDeliverableStructuredRow[]): string {
  const byActivity = new Map(rows.map((row) => [normaliseCarePlanAdlActivity(row.activity), row]));
  return renderMarkdownRows([
    "Activity",
    "Support level",
    "What the worker does",
    "Source value",
    "Chunk ID",
    "Mapping mode",
  ], CARE_PLAN_ADL_CANONICAL_ROWS.map((activity) => {
    const row = byActivity.get(normaliseCarePlanAdlActivity(activity));
    if (!row) {
      return [
        activity,
        CARE_PLAN_ADL_GENERATION_FAILED_ROW.supportLevel,
        CARE_PLAN_ADL_GENERATION_FAILED_ROW.workerDescription,
        CARE_PLAN_ADL_GENERATION_FAILED_ROW.sourceValue,
        CARE_PLAN_ADL_GENERATION_FAILED_ROW.chunkId,
        CARE_PLAN_ADL_GENERATION_FAILED_ROW.mappingMode,
      ];
    }
    return [
      activity,
      escapeMarkdownTableCell(row.supportLevel),
      escapeMarkdownTableCell(row.workerDescription),
      escapeMarkdownTableCell(row.sourceValue),
      escapeMarkdownTableCell(row.chunkId),
      row.mappingMode,
    ];
  }));
}

function isCarePlanAdlDeliverableSection(section: ParsedDeliverableSection): boolean {
  const id = normaliseCarePlanAdlActivity(section.requirementId);
  const heading = normaliseCarePlanAdlActivity(section.heading);
  return id === "care plan undertaking adl" || heading.includes("undertaking adl");
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n+/g, " ").trim();
}

function renderMarkdownRows(columns: string[], rows: string[][]): string {
  return [
    `| ${columns.join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function placeholderToken(label: string): string {
  return label
    .replace(/["']/g, "")
    .replace(/&/g, " and ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function stripDeterministicTemplateEcho(content: string, deterministicParts: string[]): string {
  let result = content.trim();
  const deterministicSentences = deterministicParts.flatMap(splitTemplateSentences);
  for (const part of deterministicParts) {
    if (!part.trim()) continue;
    result = result.split(part).join("");
    for (const sentence of deterministicSentences) {
      if (sentence.length >= 12) {
        result = result.split(sentence).join("");
      }
    }
  }
  return result
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && isLoadBearingGeneratedTemplateLine(line, deterministicSentences))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitTemplateSentences(content: string): string[] {
  return content
    .split(/(?<=[.!?])\s+|\r?\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isLoadBearingGeneratedTemplateLine(line: string, deterministicSentences: string[]): boolean {
  if (/^\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?$/.test(line)) return false;
  if (/^\|.*\[[A-Z0-9_]+\].*\|?$/.test(line)) return false;
  if (/^\|.*\|$/.test(line) && !/[.!?]/.test(line)) return false;
  if (/^[-*]\s*\[[A-Z0-9_]+\]:\s*\[[A-Z0-9_]+\]$/.test(line)) return false;
  if (/^[A-Z][A-Za-z0-9 /&()'-]{2,40}:$/.test(line)) return false;
  if (/^[A-Z][A-Za-z0-9 /&()'-]+:\s*\[[A-Z0-9_]+\]$/.test(line)) return false;
  if (/^support types selected from\b/i.test(line)) return false;
  if (/^description per selected type\b/i.test(line)) return false;
  const withoutPlaceholders = line.replace(/\[[A-Z0-9_]+\]/g, " ").trim();
  if (!/[a-z0-9]/i.test(withoutPlaceholders)) return false;
  if (!withoutPlaceholders) return false;
  if (isNearDeterministicEcho(withoutPlaceholders, deterministicSentences)) return false;
  return true;
}

function isNearDeterministicEcho(line: string, deterministicSentences: string[]): boolean {
  const lineWords = contentWordSet(line);
  if (lineWords.size === 0) return false;
  const deterministicWords = contentWordSet(deterministicSentences.join(" "));
  if (lineWords.size <= 6 && [...lineWords].every((word) => deterministicWords.has(word))) return true;
  return deterministicSentences.some((sentence) => {
    const sentenceWords = contentWordSet(sentence);
    if (sentenceWords.size === 0) return false;
    const overlap = [...lineWords].filter((word) => sentenceWords.has(word)).length;
    return overlap / Math.max(lineWords.size, 1) >= 0.7;
  });
}

function contentWordSet(value: string): Set<string> {
  return new Set(value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .filter((word) => !["the", "and", "for", "with", "from", "this", "that", "are", "but", "not"].includes(word)));
}

export function mergeDeliverableSectionDeltas(input: {
  currentSections: ParsedDeliverableSection[] | undefined;
  repairSections: ParsedDeliverableSection[] | undefined;
  allowedRequirementIds: string[];
  knownRequirementIds?: string[];
}): ParsedDeliverableSection[] {
  const currentSections = input.currentSections ?? [];
  const repairSections = input.repairSections ?? [];
  if (currentSections.length === 0) {
    throw new Error("Cannot merge repair sections because the current deliverable has no sections.");
  }
  if (repairSections.length === 0) {
    throw new Error("Targeted repair returned no deliverable.sections[] deltas.");
  }

  const currentIds = new Set(currentSections.map((section) => section.requirementId));
  const allowedIds = new Set(input.allowedRequirementIds);
  const knownIds = new Set(input.knownRequirementIds ?? [...currentIds]);
  const replacements = new Map<string, ParsedDeliverableSection>();

  for (const section of repairSections) {
    if (!knownIds.has(section.requirementId)) {
      throw new Error(`Targeted repair returned unknown requirementId "${section.requirementId}".`);
    }
    if (!allowedIds.has(section.requirementId)) {
      continue;
    }
    if (replacements.has(section.requirementId)) {
      throw new Error(`Targeted repair returned duplicate requirementId "${section.requirementId}".`);
    }
    replacements.set(section.requirementId, section);
  }

  const merged = currentSections.map((section) => replacements.get(section.requirementId) ?? section);
  for (const [requirementId, section] of replacements) {
    if (!currentIds.has(requirementId)) {
      merged.push(section);
    }
  }
  return merged;
}

/**
 * Parses the specialist JSON response into content + raw claims.
 * If parsing fails or content is missing, returns content as-is with empty claims.
 * Never throws — claim emission failure must not degrade Completed Work.
 */
export function parseSpecialistJsonOutput(rawContent: string): SpecialistJsonOutput {
  try {
    const cleaned = rawContent
      .replace(/^```json\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    const parsed = JSON.parse(cleaned);

    const deliverableSections = parseDeliverableSections(parsed.deliverable, parsed);
    const modelAssembledMarkdown = typeof parsed.deliverable?.assembledMarkdown === "string"
      ? parsed.deliverable.assembledMarkdown.trim()
      : "";
    const legacyDeliverableContent = typeof parsed.deliverable?.content === "string"
      ? parsed.deliverable.content.trim()
      : "";
    const sectionMarkdown = deliverableSections.length > 0
      ? assembleDeliverableMarkdownFromSections(deliverableSections)
      : "";
    const content = sectionMarkdown || modelAssembledMarkdown || legacyDeliverableContent || (typeof parsed.content === "string" ? parsed.content.trim() : rawContent.trim());
    const claims = Array.isArray(parsed.claims) ? (parsed.claims as RawClaim[]) : [];

    return {
      content,
      claims,
      professionalWork: isRecord(parsed.professional_work) ? parsed.professional_work : undefined,
      requirementCoverage: isRecord(parsed.requirement_coverage) ? parsed.requirement_coverage : undefined,
      deliverable: isRecord(parsed.deliverable) ? parsed.deliverable : undefined,
      deliverableSections: deliverableSections.length > 0 ? deliverableSections : undefined,
      completion: isRecord(parsed.completion) ? parsed.completion : undefined,
    };
  } catch {
    // Model produced plain text instead of JSON — treat as content with no claims
    return { content: rawContent.trim(), claims: [] };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseDeliverableSections(deliverable: unknown, parsed?: Record<string, unknown>): ParsedDeliverableSection[] {
  const sections = firstArray(
    Array.isArray(deliverable) ? deliverable : undefined,
    isRecord(deliverable) ? deliverable.sections : undefined,
    isRecord(deliverable) ? deliverable.sectionDeltas : undefined,
    isRecord(deliverable) ? deliverable.section_deltas : undefined,
    isRecord(deliverable) ? deliverable.changedSections : undefined,
    isRecord(deliverable) ? deliverable.changed_sections : undefined,
    parsed?.sections,
    parsed?.deliverableSections,
    parsed?.deliverable_sections,
    parsed?.sectionDeltas,
    parsed?.section_deltas,
    parsed?.changedSections,
    parsed?.changed_sections,
  );
  if (!sections.length) return [];
  return sections.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const requirementId = stringField(raw, "requirementId", "requirementID", "requirement_id", "requirement", "sectionCode", "section_code", "id");
    const heading = stringField(raw, "heading", "title", "sectionTitle", "section_title", "name");
    const content = stringField(raw, "content", "markdown", "markdownContent", "markdown_content", "body", "text", "sectionContent", "section_content");
    const evidenceSources = parseSectionEvidenceSources(raw.evidenceSources ?? raw.evidence_sources);
    const structuredRows = parseDeliverableStructuredRows(
      raw.structuredRows ??
      raw.structured_rows ??
      raw.adlRows ??
      raw.adl_rows ??
      raw.rows,
    );
    if (!requirementId || !heading) return [];
    const safeContent = content || "Not assessed - no generated section content supplied.";
    return [normaliseDeclaredInstrumentSection({
      requirementId,
      heading,
      content: safeContent,
      ...(evidenceSources.length > 0 ? { evidenceSources } : {}),
      ...(structuredRows.length > 0 ? { structuredRows } : {}),
    })];
  });
}

function firstArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function parseSectionEvidenceSources(value: unknown): ParsedDeliverableSectionEvidenceSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const chunkId = typeof raw.chunkId === "string" ? raw.chunkId.trim() : "";
    const documentTitle = typeof raw.documentTitle === "string" ? raw.documentTitle.trim() : "";
    const passage = typeof raw.passage === "string" ? raw.passage.trim() : "";
    const location = typeof raw.location === "string" ? raw.location.trim() : "";
    const evidenceClass = typeof raw.evidenceClass === "string" ? raw.evidenceClass.trim() : undefined;
    if (!chunkId || !documentTitle || !passage || !location) return [];
    return [{ chunkId, documentTitle, passage, location, evidenceClass }];
  });
}

function parseDeliverableStructuredRows(value: unknown): ParsedDeliverableStructuredRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const activity = stringField(raw, "activity", "row", "canonicalRow", "canonical_row", "label");
    const supportLevel = stringField(raw, "supportLevel", "support_level", "level");
    const workerDescription = stringField(raw, "workerDescription", "worker_description", "whatTheWorkerDoes", "what_the_worker_does", "description");
    const sourceValue = stringField(raw, "sourceValue", "source_value", "checklistValue", "checklist_value", "value");
    const chunkId = stringField(raw, "chunkId", "chunk_id", "sourceChunkId", "source_chunk_id");
    const mappingMode = stringField(raw, "mappingMode", "mapping_mode", "mode") as CarePlanAdlMappingMode | "";
    if (!activity || !supportLevel || !workerDescription || !sourceValue || !chunkId) return [];
    if (mappingMode !== "VERIFIED_MAPPING" && mappingMode !== "CITED_INTERPRETATION" && mappingMode !== "NOT_ASSESSED") return [];
    return [{
      activity,
      supportLevel,
      workerDescription,
      sourceValue,
      chunkId,
      mappingMode,
    }];
  });
}

// ─── Cross-tenant chunk guard ─────────────────────────────────────────────────

/**
 * Ensures all chunk IDs in the claims reference only chunks from the correct
 * organisation's EvidencePack. Called before any DB write.
 * Returns the list of cross-tenant chunk IDs rejected.
 */
export function rejectCrossTenantChunks(
  claims: ValidatedClaim[],
  evidencePack: EvidencePack,
): string[] {
  const packChunkIds = new Set(evidencePack.chunks.map((c) => c.chunkId));
  const rejected: string[] = [];
  for (const claim of claims) {
    for (const binding of claim.validEvidenceBindings) {
      if (!packChunkIds.has(binding.chunkId)) {
        rejected.push(binding.chunkId);
      }
    }
  }
  return rejected;
}
