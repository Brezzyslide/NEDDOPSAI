/**
 * Blueprint Contract Service — Production Blueprint Foundation
 *
 * Runtime enforcement of structured blueprint contracts.
 * Integrated into the UEE at two gates:
 *
 *   1. Evidence gate   (before generation) — enforceEvidenceContract
 *   2. Completion gate (before createDraft) — enforceDeliverableContract
 *                                           — enforceSectionRequirements
 *                                           — enforceClaimIntegrityGate
 *                                           — enforceArtifactRequirement
 *                                           — enforceTemplateRequirement
 *
 * All functions are pure/deterministic — no DB side-effects.
 * Callers decide what to do with ContractEnforcementResult.
 *
 * ENFORCEMENT MATRIX
 * ─────────────────────────────────────────────────────────────────────────────
 * Gate                        | Behaviour on failure
 * ─────────────────────────────────────────────────────────────────────────────
 * Prohibited deliverable      | block_completion
 * Artifact required + absent  | block_completion
 * Template required + absent  | controlled_failure (not block — UEE can warn)
 * Missing required evidence   | per missingEvidenceBehaviour in contract
 * Missing required sections   | block_completion
 * Claim integrity failure     | block_completion (when claimIntegrityRequired)
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Structured deliverable contract stored in work_blueprints.deliverable_contract */
export interface DeliverableContract {
  /** The primary work product e.g. "Care Plan document" */
  primaryDeliverable: string;
  /** Additional permitted deliverables (secondary outputs) */
  secondaryDeliverables: string[];
  /** Types of internal analysis the specialist may produce alongside the deliverable */
  allowedInternalAnalysis: string[];
  /**
   * Outputs the specialist must NEVER produce as part of this work.
   * Presence of a prohibited deliverable in the draft blocks completion.
   */
  prohibitedDeliverables: string[];
  /**
   * When true, a physical artifact (rendered from a template) must exist
   * before the work item may be marked complete.
   * Text-only content does NOT satisfy this requirement.
   */
  artifactRequired: boolean;
  /** Expected output format e.g. "docx" | "pdf" | "markdown" */
  primaryFormat: string;
  secondaryFormats: string[];
  /** File-naming pattern e.g. "CarePlan_{participant}_{date}" */
  namingConvention: string | null;
  /**
   * When true, a matching work_template must exist and be resolvable.
   * If no template is found the UEE surfaces a controlled failure.
   */
  templateRequired: boolean;
  /** Prose completion requirements injected into the execution context */
  completionRequirements: string[];
}

/** Behaviour when required evidence is absent */
export type MissingEvidenceBehaviour =
  | "clarification_required"
  | "continue_with_flagged_gaps"
  | "block_completion"
  | "not_applicable_allowed";

/** Structured evidence contract stored in work_blueprints.evidence_contract */
export interface EvidenceContract {
  /** Evidence types that must be present before the specialist starts */
  requiredEvidenceCategories: string[];
  /** Evidence types that are beneficial but not mandatory */
  optionalEvidenceCategories: string[];
  /** Knowledge source types that are permitted */
  allowedSourceTypes: string[];
  /** Knowledge source types that are explicitly excluded */
  restrictedSourceTypes: string[];
  /** Entity context types that must be resolvable e.g. ["participant"] */
  requiredEntityTypes: string[];
  /** Minimum number of evidence chunks required */
  minimumEvidenceCount: number;
  /** Freshness rules per evidence category */
  freshnessRules: Array<{ category: string; maxAgeDays: number }>;
  /**
   * When true, all evidence-bearing claims in the draft must be
   * verifiable against retrieved evidence.
   * Completion is blocked when an unsupported required claim exists.
   */
  claimIntegrityRequired: boolean;
  /** What the UEE does when required evidence cannot be found */
  missingEvidenceBehaviour: MissingEvidenceBehaviour;
}

/** A single contract violation */
export interface ContractViolation {
  type:
    | "MISSING_REQUIRED_SECTION"
    | "MISSING_REQUIRED_EVIDENCE"
    | "PROHIBITED_DELIVERABLE"
    | "ARTIFACT_REQUIRED_NOT_MET"
    | "TEMPLATE_REQUIRED_NOT_MET"
    | "CLAIM_INTEGRITY_FAILED";
  /** Machine code for the violated rule */
  code: string;
  /** Human-readable message for logs / clarification response */
  message: string;
  /** True = execution must stop. False = flagged but may continue. */
  blocking: boolean;
}

/** Result of running one or more contract enforcement checks */
export interface ContractEnforcementResult {
  passed: boolean;
  violations: ContractViolation[];
  /**
   * When an evidence violation is present, the configured behaviour
   * from the evidence contract is propagated here so the UEE can
   * route to the correct outcome.
   */
  missingEvidenceBehaviour: MissingEvidenceBehaviour | null;
  outcome:
    | "passed"
    | "block_completion"
    | "awaiting_clarification"
    | "continue_with_flagged_gaps"
    | "template_missing";
}

// ─── Evidence contract enforcement ────────────────────────────────────────────

/**
 * Checks the evidence contract against the retrieved evidence pack.
 * Called BEFORE generation so the UEE can request clarification or block early.
 *
 * @param contract - The blueprint's evidence contract (null = no enforcement)
 * @param evidencePack - The evidence retrieved by the parallel discovery pipeline
 */
export function enforceEvidenceContract(
  contract: EvidenceContract | null | undefined,
  evidencePack: { chunks: Array<{ sourceType?: string; category?: string }> } | null | undefined,
): ContractEnforcementResult {
  if (!contract) return passed();

  const violations: ContractViolation[] = [];
  const chunks = evidencePack?.chunks ?? [];

  // 1. Minimum evidence count
  if (chunks.length < contract.minimumEvidenceCount) {
    violations.push({
      type: "MISSING_REQUIRED_EVIDENCE",
      code: "MINIMUM_EVIDENCE_COUNT_NOT_MET",
      message: `Evidence contract requires at least ${contract.minimumEvidenceCount} evidence chunk(s); ${chunks.length} retrieved.`,
      blocking: contract.missingEvidenceBehaviour === "block_completion",
    });
  }

  // 2. Restricted source types must not be present
  for (const chunk of chunks) {
    if (chunk.sourceType && contract.restrictedSourceTypes.includes(chunk.sourceType)) {
      violations.push({
        type: "MISSING_REQUIRED_EVIDENCE",
        code: "RESTRICTED_SOURCE_TYPE_PRESENT",
        message: `Evidence from restricted source type "${chunk.sourceType}" is present but not permitted by the evidence contract.`,
        blocking: true,
      });
    }
  }

  // 3. Required entity types (checked against chunk categories as a proxy)
  for (const entityType of contract.requiredEntityTypes) {
    const present = chunks.some(c => c.category === entityType);
    if (!present && chunks.length > 0) {
      violations.push({
        type: "MISSING_REQUIRED_EVIDENCE",
        code: `REQUIRED_ENTITY_TYPE_ABSENT:${entityType}`,
        message: `Required entity context "${entityType}" was not found in evidence.`,
        blocking: contract.missingEvidenceBehaviour === "block_completion",
      });
    }
  }

  if (violations.length === 0) return passed();

  const hasBlocking = violations.some(v => v.blocking);
  const behaviour = contract.missingEvidenceBehaviour;

  return {
    passed: false,
    violations,
    missingEvidenceBehaviour: behaviour,
    outcome: hasBlocking
      ? (behaviour === "clarification_required" ? "awaiting_clarification" : "block_completion")
      : "continue_with_flagged_gaps",
  };
}

// ─── Deliverable contract enforcement ─────────────────────────────────────────

/**
 * Checks the deliverable contract against the generated draft content.
 * Called AFTER generation but BEFORE createDraft.
 *
 * @param contract - The blueprint's deliverable contract (null = no enforcement)
 * @param draftContent - The generated markdown content
 * @param hasArtifact - True if a physical artifact (DOCX/PDF) was rendered
 * @param hasTemplate - True if a matching template was resolved for this execution
 */
export function enforceDeliverableContract(
  contract: DeliverableContract | null | undefined,
  draftContent: string,
  hasArtifact: boolean,
  hasTemplate: boolean,
): ContractEnforcementResult {
  if (!contract) return passed();

  const violations: ContractViolation[] = [];

  // 1. Prohibited deliverables must not appear in the draft
  for (const prohibited of contract.prohibitedDeliverables) {
    const normalised = prohibited.toLowerCase();
    if (draftContent.toLowerCase().includes(normalised)) {
      violations.push({
        type: "PROHIBITED_DELIVERABLE",
        code: `PROHIBITED_DELIVERABLE:${prohibited}`,
        message: `Draft contains a prohibited deliverable: "${prohibited}". This deliverable is not permitted by the blueprint contract.`,
        blocking: true,
      });
    }
  }

  // 2. Artifact required but not produced
  if (contract.artifactRequired && !hasArtifact) {
    violations.push({
      type: "ARTIFACT_REQUIRED_NOT_MET",
      code: "ARTIFACT_REQUIRED_NOT_GENERATED",
      message: `This blueprint requires a physical artifact (${contract.primaryFormat ?? "document"}) to be generated. Text-only content cannot complete this work.`,
      blocking: true,
    });
  }

  // 3. Template required but not resolved
  if (contract.templateRequired && !hasTemplate) {
    violations.push({
      type: "TEMPLATE_REQUIRED_NOT_MET",
      code: "TEMPLATE_REQUIRED_NOT_FOUND",
      message: `This blueprint requires a template (${contract.primaryFormat ?? "document"}) but no matching template was found. Work cannot proceed without a template.`,
      blocking: false, // controlled failure — surfaced but does not block draft creation
    });
  }

  if (violations.length === 0) return passed();

  const hasBlocking = violations.some(v => v.blocking);
  const hasTemplateOnly = violations.every(v => v.type === "TEMPLATE_REQUIRED_NOT_MET");

  return {
    passed: false,
    violations,
    missingEvidenceBehaviour: null,
    outcome: hasBlocking
      ? "block_completion"
      : hasTemplateOnly
      ? "template_missing"
      : "continue_with_flagged_gaps",
  };
}

// ─── Section requirement enforcement ──────────────────────────────────────────

export interface BlueprintSection {
  sectionCode: string;
  title: string;
  required: boolean;
  minimumContentExpectation?: string | null;
  instructions?: string | null;
}

/**
 * Checks that all required sections appear in the generated draft.
 * "Presence" is determined by searching for the section title or code
 * in the draft content (case-insensitive).
 *
 * Called AFTER generation but BEFORE createDraft.
 *
 * @param sections - Blueprint sections (from blueprint_sections table)
 * @param draftContent - Generated markdown content
 */
export function enforceSectionRequirements(
  sections: BlueprintSection[] | null | undefined,
  draftContent: string,
): ContractEnforcementResult {
  if (!sections || sections.length === 0) return passed();

  const violations: ContractViolation[] = [];
  const lower = draftContent.toLowerCase();

  for (const section of sections) {
    if (!section.required) continue;

    const titlePresent = lower.includes(section.title.toLowerCase());
    const codePresent = lower.includes(section.sectionCode.toLowerCase());

    if (!titlePresent && !codePresent) {
      violations.push({
        type: "MISSING_REQUIRED_SECTION",
        code: `REQUIRED_SECTION_ABSENT:${section.sectionCode}`,
        message: `Required section "${section.title}" (${section.sectionCode}) is absent from the draft. All required sections must be present and materially populated.`,
        blocking: true,
      });
      continue;
    }

    // Minimum content expectation: if section title is present, check that
    // substantial content follows it (more than just a heading).
    if (section.minimumContentExpectation && (titlePresent || codePresent)) {
      const titleIdx = lower.indexOf(section.title.toLowerCase());
      const sectionBody = draftContent.slice(titleIdx + section.title.length, titleIdx + section.title.length + 500);
      const wordCount = sectionBody.trim().split(/\s+/).filter(Boolean).length;
      if (wordCount < 10) {
        violations.push({
          type: "MISSING_REQUIRED_SECTION",
          code: `SECTION_INSUFFICIENT_CONTENT:${section.sectionCode}`,
          message: `Section "${section.title}" is present but contains insufficient content. Expected: ${section.minimumContentExpectation}`,
          blocking: true,
        });
      }
    }
  }

  if (violations.length === 0) return passed();

  return {
    passed: false,
    violations,
    missingEvidenceBehaviour: null,
    outcome: "block_completion",
  };
}

// ─── Claim integrity gate ──────────────────────────────────────────────────────

export interface ValidatedClaim {
  /** Whether this claim was verified against retrieved evidence */
  supported: boolean;
  /** The claim type e.g. "factual", "causal", "temporal" */
  claimType?: string;
  /** True if the claim is required to be evidence-backed */
  isEvidenceBearing?: boolean;
}

/**
 * When the blueprint's evidence contract has claimIntegrityRequired = true,
 * all evidence-bearing claims in the draft must be verified.
 * Completion is blocked when any required claim is unsupported.
 *
 * @param contract - The blueprint's evidence contract (null = no enforcement)
 * @param validatedClaims - Claims extracted and validated by the provenance pipeline
 */
export function enforceClaimIntegrityGate(
  contract: EvidenceContract | null | undefined,
  validatedClaims: ValidatedClaim[],
): ContractEnforcementResult {
  if (!contract?.claimIntegrityRequired) return passed();
  if (validatedClaims.length === 0) return passed();

  const violations: ContractViolation[] = [];

  const unsupportedRequired = validatedClaims.filter(
    c => c.isEvidenceBearing && !c.supported,
  );

  if (unsupportedRequired.length > 0) {
    violations.push({
      type: "CLAIM_INTEGRITY_FAILED",
      code: "UNSUPPORTED_REQUIRED_CLAIMS",
      message: `${unsupportedRequired.length} required evidence-bearing claim(s) could not be verified against retrieved evidence. Completion is blocked when claimIntegrityRequired = true.`,
      blocking: true,
    });
  }

  if (violations.length === 0) return passed();

  return {
    passed: false,
    violations,
    missingEvidenceBehaviour: null,
    outcome: "block_completion",
  };
}

// ─── Composite gate ────────────────────────────────────────────────────────────

/**
 * Run all completion-gate checks in one call.
 * Used by the UEE immediately before createDraft.
 */
export function enforceAllCompletionGates(input: {
  deliverableContract: DeliverableContract | null | undefined;
  evidenceContract: EvidenceContract | null | undefined;
  sections: BlueprintSection[] | null | undefined;
  draftContent: string;
  validatedClaims: ValidatedClaim[];
  hasArtifact: boolean;
  hasTemplate: boolean;
}): ContractEnforcementResult {
  const deliverableResult = enforceDeliverableContract(
    input.deliverableContract,
    input.draftContent,
    input.hasArtifact,
    input.hasTemplate,
  );
  const sectionResult = enforceSectionRequirements(input.sections, input.draftContent);
  const claimResult = enforceClaimIntegrityGate(input.evidenceContract, input.validatedClaims);

  const allViolations = [
    ...deliverableResult.violations,
    ...sectionResult.violations,
    ...claimResult.violations,
  ];

  if (allViolations.length === 0) return passed();

  const hasBlocking = allViolations.some(v => v.blocking);

  return {
    passed: false,
    violations: allViolations,
    missingEvidenceBehaviour: null,
    outcome: hasBlocking ? "block_completion" : "continue_with_flagged_gaps",
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function passed(): ContractEnforcementResult {
  return {
    passed: true,
    violations: [],
    missingEvidenceBehaviour: null,
    outcome: "passed",
  };
}

/**
 * Parse a raw JSONB deliverable_contract value into a typed DeliverableContract.
 * Returns null if the value is empty or not a valid contract.
 */
export function parseDeliverableContract(
  raw: Record<string, unknown> | null | undefined,
): DeliverableContract | null {
  if (!raw || typeof raw !== "object") return null;
  return {
    primaryDeliverable: String(raw.primaryDeliverable ?? ""),
    secondaryDeliverables: Array.isArray(raw.secondaryDeliverables) ? raw.secondaryDeliverables as string[] : [],
    allowedInternalAnalysis: Array.isArray(raw.allowedInternalAnalysis) ? raw.allowedInternalAnalysis as string[] : [],
    prohibitedDeliverables: Array.isArray(raw.prohibitedDeliverables) ? raw.prohibitedDeliverables as string[] : [],
    artifactRequired: Boolean(raw.artifactRequired),
    primaryFormat: String(raw.primaryFormat ?? "markdown"),
    secondaryFormats: Array.isArray(raw.secondaryFormats) ? raw.secondaryFormats as string[] : [],
    namingConvention: raw.namingConvention ? String(raw.namingConvention) : null,
    templateRequired: Boolean(raw.templateRequired),
    completionRequirements: Array.isArray(raw.completionRequirements) ? raw.completionRequirements as string[] : [],
  };
}

/**
 * Parse a raw JSONB evidence_contract value into a typed EvidenceContract.
 * Returns null if the value is empty or not a valid contract.
 */
export function parseEvidenceContract(
  raw: Record<string, unknown> | null | undefined,
): EvidenceContract | null {
  if (!raw || typeof raw !== "object") return null;
  return {
    requiredEvidenceCategories: Array.isArray(raw.requiredEvidenceCategories) ? raw.requiredEvidenceCategories as string[] : [],
    optionalEvidenceCategories: Array.isArray(raw.optionalEvidenceCategories) ? raw.optionalEvidenceCategories as string[] : [],
    allowedSourceTypes: Array.isArray(raw.allowedSourceTypes) ? raw.allowedSourceTypes as string[] : [],
    restrictedSourceTypes: Array.isArray(raw.restrictedSourceTypes) ? raw.restrictedSourceTypes as string[] : [],
    requiredEntityTypes: Array.isArray(raw.requiredEntityTypes) ? raw.requiredEntityTypes as string[] : [],
    minimumEvidenceCount: Number(raw.minimumEvidenceCount ?? 0),
    freshnessRules: Array.isArray(raw.freshnessRules) ? raw.freshnessRules as EvidenceContract["freshnessRules"] : [],
    claimIntegrityRequired: Boolean(raw.claimIntegrityRequired),
    missingEvidenceBehaviour: (raw.missingEvidenceBehaviour as MissingEvidenceBehaviour) ?? "continue_with_flagged_gaps",
  };
}
