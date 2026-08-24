import type {
  BlueprintExecutionContract,
  BlueprintSection,
} from "./workBlueprintService.js";
import type { EvidencePack } from "./knowledgeResolutionService.js";
import {
  validateClaimBatch,
  type RawClaim,
} from "./claimValidationService.js";
import {
  parseDeliverableContract,
  parseEvidenceContract,
} from "./blueprintContractService.js";
import {
  canonicaliseSourceType,
  isTrustedProviderSource,
} from "../utils/sourceTypeNormalisation.js";

export type BlueprintRuntimeGateState =
  | "validation"
  | "awaiting_clarification"
  | "artifact_generation"
  | "artifact_generation_failed"
  | "completed";

export interface BlueprintRuntimeGateFailure {
  gate:
    | "required_section"
    | "section_evidence"
    | "missing_evidence"
    | "claim_integrity"
    | "prohibited_deliverable"
    | "template_required"
    | "artifact_required"
    | "approval_required";
  state: BlueprintRuntimeGateState;
  message: string;
  details?: string[];
}

export interface BlueprintRuntimeValidationInput {
  contract: BlueprintExecutionContract | null;
  contentMarkdown: string;
  rawClaims: RawClaim[];
  evidencePack?: EvidencePack | null;
  artifactId?: string | null;
  approvalStates?: Record<string, boolean> | null;
  deferApprovalGate?: boolean;
  standardTemplateEvidence?: StandardTemplateEvidenceContext | null;
}

export interface BlueprintRuntimeValidationResult {
  passed: boolean;
  failures: BlueprintRuntimeGateFailure[];
}

export interface StandardTemplateEvidenceContext {
  /** A standard/reusable/template deliverable was requested, not a participant-specific completion. */
  standardTemplateRequested: boolean;
  /** The user asked to match an existing organisation/customer format or example. */
  existingTemplateRequested: boolean;
  /** The user asked NeedsOps to complete/review a named participant/client-specific matter. */
  participantSpecificRequested: boolean;
  /** The user asked for organisation-specific factual content or branding, not just a generic professional template. */
  organisationSpecificRequested: boolean;
  /** Customer examples/templates are optional for this request. */
  customerExampleOptional: boolean;
}

export function classifyStandardTemplateEvidenceContext(
  requestText: string,
): StandardTemplateEvidenceContext {
  const raw = requestText.trim();
  const lower = raw.toLowerCase();

  const templateIntent = /\b(template|form|checklist|framework|standard\s+(?:document|agreement|assessment)|reusable|generic|general|standard|comprehensive|all\s+(?:relevant|areas)|everything)\b/i.test(raw);
  const creationIntent = /\b(create|design|develop|draft|build|prepare|make|generate)\b/i.test(raw);
  const existingTemplateRequested = /\b(match|mirror|use|follow|based\s+on|same\s+as)\s+(?:our|my|existing|current|uploaded|attached|organisation(?:al)?|company|customer)\s+(?:template|format|example|document|agreement|style)\b/i.test(raw)
    || /\b(existing|current|uploaded|attached)\s+(?:template|format|example|agreement|risk\s+assessment)\b/i.test(raw);

  const specificParticipantReference = /\b(?:participant|client)\s+(?:[A-Z][A-Za-z0-9'_-]+|#[A-Za-z0-9_-]+|\d{2,})\b/.test(raw);
  const participantCompletionIntent = /\b(?:complete|fill\s*(?:in|out)|assess|review|evaluate|finalise|update|revise)\s+(?:an?\s+)?(?:risk\s+assessment|service\s+agreement|agreement|assessment)\s+(?:for|about|regarding)\s+(?:participant|client)\b/i.test(raw);
  const participantSpecificRequested = !templateIntent && (specificParticipantReference || participantCompletionIntent)
    || (participantCompletionIntent && specificParticipantReference);

  const organisationSpecificRequested = existingTemplateRequested
    || /\b(?:for|using)\s+(?:our|my)\s+(?:organisation|organization|company|provider|business|service)\s+(?:details|branding|format|terms|rates|prices|policies|procedures)\b/i.test(lower);

  const standardTemplateRequested = templateIntent
    && creationIntent
    && !participantSpecificRequested;

  return {
    standardTemplateRequested,
    existingTemplateRequested,
    participantSpecificRequested,
    organisationSpecificRequested,
    customerExampleOptional:
      standardTemplateRequested &&
      !existingTemplateRequested &&
      !participantSpecificRequested &&
      !organisationSpecificRequested,
  };
}

export function validateBlueprintRuntimeCompletion(
  input: BlueprintRuntimeValidationInput,
): BlueprintRuntimeValidationResult {
  const { contract } = input;
  if (!contract?.blueprint) return { passed: true, failures: [] };

  const failures: BlueprintRuntimeGateFailure[] = [];
  const { blueprint } = contract;
  const evidenceContract = parseEvidenceContract(blueprint.evidenceContract as Record<string, unknown> | null);
  const deliverableContract = parseDeliverableContract(blueprint.deliverableContract as Record<string, unknown> | null);

  const standardTemplateEvidence = input.standardTemplateEvidence ?? null;

  failures.push(...validateSections(
    contract.sections,
    input.contentMarkdown,
    input.evidencePack,
    standardTemplateEvidence,
  ));

  if (deliverableContract) {
    const prohibited = deliverableContract.prohibitedDeliverables ?? [];
    const prohibitedFound = prohibited.filter((deliverable) =>
      containsDeliverableHeading(input.contentMarkdown, deliverable),
    );
    if (prohibitedFound.length > 0) {
      failures.push({
        gate: "prohibited_deliverable",
        state: "validation",
        message: "Blueprint prohibits one or more standalone deliverables produced by the draft.",
        details: prohibitedFound,
      });
    }

    const templateRequired = blueprint.templateRequired || deliverableContract.templateRequired === true;
    if (templateRequired && !contract.template) {
      if (!isCustomerTemplateOptional(standardTemplateEvidence)) {
        failures.push({
          gate: "template_required",
          state: "awaiting_clarification",
          message: "Blueprint requires a template, but no applicable platform or organisation template was resolved.",
        });
      }
    }

    if (deliverableContract.artifactRequired === true && !input.artifactId) {
      failures.push({
        gate: "artifact_required",
        state: "artifact_generation",
        message: "Blueprint requires an artifact. Text-only completion is blocked until an artifact is generated and linked.",
      });
    }
  }

  if (input.deferApprovalGate !== true) {
    const requiredApprovals = Object.keys(blueprint.requiredApprovals ?? {});
    const missingApprovals = requiredApprovals.filter((approval) =>
      input.approvalStates?.[approval] !== true,
    );
    if (missingApprovals.length > 0) {
      failures.push({
        gate: "approval_required",
        state: "awaiting_clarification",
        message: "Blueprint requires approval before completion.",
        details: missingApprovals,
      });
    }
  }

  if (evidenceContract) {
    const minimumEvidenceCount = effectiveMinimumEvidenceCount(
      evidenceContract.minimumEvidenceCount ?? 0,
      evidenceContract.requiredEvidenceCategories ?? [],
      standardTemplateEvidence,
    );
    const evidenceCount = countEvidenceItems(input.evidencePack);
    if (minimumEvidenceCount > 0 && evidenceCount < minimumEvidenceCount) {
      failures.push({
        gate: "missing_evidence",
        state: evidenceContract.missingEvidenceBehaviour === "clarification_required"
          ? "awaiting_clarification"
          : "validation",
        message: `Blueprint requires at least ${minimumEvidenceCount} evidence item(s); ${evidenceCount} available.`,
        details: evidenceContract.requiredEvidenceCategories ?? [],
      });
    }

    const requiredCategories = filterRequiredEvidenceCategories(
      evidenceContract.requiredEvidenceCategories ?? [],
      standardTemplateEvidence,
    );
    const missingCategories = requiredCategories.filter((category) =>
      !hasEvidenceCategory(input.evidencePack, category, standardTemplateEvidence),
    );
    if (missingCategories.length > 0) {
      const behaviour = evidenceContract.missingEvidenceBehaviour ?? "continue_with_flagged_gaps";
      if (behaviour === "block_completion" || behaviour === "clarification_required") {
        failures.push({
          gate: "missing_evidence",
          state: behaviour === "clarification_required" ? "awaiting_clarification" : "validation",
          message: "Blueprint required evidence categories are missing.",
          details: missingCategories,
        });
      }
    }

    if (evidenceContract.claimIntegrityRequired === true && input.rawClaims.length > 0) {
      if (!input.evidencePack) {
        failures.push({
          gate: "claim_integrity",
          state: "validation",
          message: "Blueprint requires claim integrity, but no evidence pack is available for claim validation.",
        });
      } else {
        const validation = validateClaimBatch(input.rawClaims, input.evidencePack);
        const unsupported = validation.claims.filter((claim) =>
          claim.provenanceStatus !== "grounded",
        );
        if (unsupported.length > 0 || validation.bindingsRejected > 0) {
          failures.push({
            gate: "claim_integrity",
            state: "validation",
            message: "Blueprint requires evidence-backed claims; unsupported or invalid claims block completion.",
            details: unsupported.map((claim) => `${claim.clientClaimId}: ${claim.provenanceStatus}`),
          });
        }
      }
    }
  }

  return { passed: failures.length === 0, failures };
}

function validateSections(
  sections: BlueprintSection[],
  contentMarkdown: string,
  evidencePack?: EvidencePack | null,
  standardTemplateEvidence?: StandardTemplateEvidenceContext | null,
): BlueprintRuntimeGateFailure[] {
  const failures: BlueprintRuntimeGateFailure[] = [];
  const sectionHeadingsAreAdvisory = isCustomerTemplateOptional(standardTemplateEvidence);
  for (const section of sections.filter((s) => s.required)) {
    const content = extractSectionContent(contentMarkdown, section);
    if (!content) {
      if (!sectionHeadingsAreAdvisory) {
        failures.push({
          gate: "required_section",
          state: "validation",
          message: `Required blueprint section is missing: ${section.sectionCode}`,
        });
      }
    } else if (!sectionHeadingsAreAdvisory && !isMateriallyPopulated(content, section)) {
      failures.push({
        gate: "required_section",
        state: "validation",
        message: `Required blueprint section is materially incomplete: ${section.sectionCode}`,
      });
    }

    const requirements = section.evidenceRequirements ?? {};
    const requiredCategories = Array.isArray(requirements.requiredEvidenceCategories)
      ? requirements.requiredEvidenceCategories.map(String)
      : [];
    const effectiveCategories = filterRequiredEvidenceCategories(requiredCategories, standardTemplateEvidence);
    const minimumEvidenceCount = effectiveMinimumEvidenceCount(
      Number(requirements.minimumEvidenceCount ?? 0),
      requiredCategories,
      standardTemplateEvidence,
    );
    if (minimumEvidenceCount > 0 && countEvidenceItems(evidencePack) < minimumEvidenceCount) {
      failures.push({
        gate: "section_evidence",
        state: "validation",
        message: `Section ${section.sectionCode} requires ${minimumEvidenceCount} evidence item(s).`,
      });
    }

    const missing = effectiveCategories.filter((category) =>
      !hasEvidenceCategory(evidencePack, category, standardTemplateEvidence),
    );
    if (missing.length > 0) {
      failures.push({
        gate: "section_evidence",
        state: "validation",
        message: `Section ${section.sectionCode} required evidence categories are missing.`,
        details: missing,
      });
    }
  }
  return failures;
}

function isCustomerTemplateOptional(context?: StandardTemplateEvidenceContext | null): boolean {
  return context?.customerExampleOptional === true;
}

function effectiveMinimumEvidenceCount(
  minimumEvidenceCount: number,
  requiredCategories: string[],
  context?: StandardTemplateEvidenceContext | null,
): number {
  if (!isCustomerTemplateOptional(context)) return minimumEvidenceCount;
  const authoritativeCategoryCount = requiredCategories.filter(isAuthoritativeEvidenceCategory).length;
  return authoritativeCategoryCount > 0
    ? Math.min(minimumEvidenceCount, authoritativeCategoryCount)
    : 0;
}

function filterRequiredEvidenceCategories(
  categories: string[],
  context?: StandardTemplateEvidenceContext | null,
): string[] {
  if (!isCustomerTemplateOptional(context)) return categories;
  return categories.filter(isAuthoritativeEvidenceCategory);
}

function isAuthoritativeEvidenceCategory(category: string): boolean {
  const canonical = canonicaliseSourceType(category);
  if (isTrustedProviderSource(canonical)) return true;
  if (/_record$/i.test(canonical) && !/\b(?:authority|legislation|legislative|regulat|commission|practice_standard|pricing|price_guide|current_authority)\b/i.test(canonical)) {
    return false;
  }
  return /\b(?:authority|authoritative|legislation|legislative|regulat|commission|practice_standard|ndis_practice|pricing|price_guide|tax|gst|schads|award|fair_work|privacy_act|current_authority)\b/i.test(canonical);
}

function extractSectionContent(contentMarkdown: string, section: BlueprintSection): string | null {
  const markers = [section.sectionCode, section.title].filter(Boolean);
  for (const marker of markers) {
    const escaped = escapeRegExp(marker);
    const match = contentMarkdown.match(
      new RegExp(`(?:^|\\n)#{1,6}\\s*${escaped}\\s*\\n([\\s\\S]*?)(?=\\n#{1,6}\\s+|$)`, "i"),
    );
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

function isMateriallyPopulated(content: string, section: BlueprintSection): boolean {
  const text = content.replace(/\[[^\]]*INCOMPLETE[^\]]*\]/gi, "").trim();
  const minLengthRule = section.validationRules.find((rule) => /^min_length_\d+$/i.test(rule.rule));
  const minLength = minLengthRule ? Number(minLengthRule.rule.match(/\d+$/)?.[0] ?? 20) : 20;
  return text.length >= minLength;
}

function countEvidenceItems(evidencePack?: EvidencePack | null): number {
  return evidencePack?.totalChunks ?? evidencePack?.chunks?.length ?? 0;
}

function hasEvidenceCategory(
  evidencePack: EvidencePack | null | undefined,
  category: string,
  context?: StandardTemplateEvidenceContext | null,
): boolean {
  if (!evidencePack) return false;
  const lower = category.toLowerCase();
  return evidencePack.chunks.some((chunk) => {
    const sourceType = chunk.sourceType?.toLowerCase?.() ?? "";
    const sourceTitle = chunk.sourceTitle?.toLowerCase?.() ?? "";
    const currentAuthorityEvidence = isCustomerTemplateOptional(context) &&
      isAuthoritativeEvidenceCategory(category) &&
      (
        sourceType.includes("current_authority") ||
        sourceTitle.includes("current_authority") ||
        chunk.provenance?.sourceOrigin === "external_authority"
      );
    if (currentAuthorityEvidence) return true;
    return sourceType === lower || sourceType.includes(lower) || sourceTitle.includes(lower);
  });
}

function containsDeliverableHeading(contentMarkdown: string, deliverable: string): boolean {
  const label = deliverable.replace(/[_-]+/g, " ").trim();
  if (!label) return false;
  const escaped = escapeRegExp(label);
  return new RegExp(`(?:^|\\n)#{1,3}\\s*(?:standalone\\s+)?${escaped}\\b`, "i").test(contentMarkdown);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
