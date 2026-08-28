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
import type { ProfessionalExecutionContext } from "./professionalExecutionContextService.js";
import {
  deriveDeliverableRequirementCoverageProfile,
  evaluateDeliverableRequirementCoverage,
} from "./deliverableRequirementCoverageService.js";

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
    | "professional_placeholder"
    | "methodology_leak"
    | "mandatory_deliverable_coverage"
    | "final_synthesis"
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
  rawClaims?: RawClaim[];
  evidencePack?: EvidencePack | null;
  artifactId?: string | null;
  approvalStates?: Record<string, boolean> | null;
  deferApprovalGate?: boolean;
  standardTemplateEvidence?: StandardTemplateEvidenceContext | null;
  professionalContext?: ProfessionalExecutionContext | null;
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
  const creationIntent = /\b(create|design|develop|draft|build|prepare|make|generate|produce|provide|give\s+me|i\s+need|can\s+you\s+give\s+me)\b/i.test(raw);
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

  const unresolvedProfessionalPlaceholders = detectUnresolvedProfessionalPlaceholders(
    input.contentMarkdown,
    standardTemplateEvidence,
    input.professionalContext,
  );
  if (unresolvedProfessionalPlaceholders.length > 0) {
    failures.push({
      gate: "professional_placeholder",
      state: "validation",
      message: "Draft contains unresolved professional-content placeholders. User/organisation data placeholders may remain for reusable templates, but professional clauses, obligations, rights, terms, conclusions and incomplete markers must be drafted before Completed Work is created.",
      details: unresolvedProfessionalPlaceholders,
    });
  }

  const leakedMethodologyHeadings = [
    ...detectLeakedBlueprintMethodologyHeadings(
      input.contentMarkdown,
      contract.sections,
      standardTemplateEvidence,
    ),
    ...detectInstructionalProfessionalText(input.contentMarkdown, standardTemplateEvidence),
    ...detectIncompleteProfessionalSections(input.contentMarkdown, standardTemplateEvidence),
    ...detectPlaceholderDominatedProfessionalSections(input.contentMarkdown, standardTemplateEvidence),
  ].sort();
  if (leakedMethodologyHeadings.length > 0) {
    failures.push({
      gate: "methodology_leak",
      state: "validation",
      message: "Draft exposes internal Blueprint methodology headings in a customer-facing standard template. Blueprint sections must remain internal working method unless the final deliverable contract explicitly maps them into user-facing content.",
      details: leakedMethodologyHeadings,
    });
  }

  if (input.professionalContext) {
    const coverageProfile = deriveDeliverableRequirementCoverageProfile(input.professionalContext, contract);
    const coverageReport = evaluateDeliverableRequirementCoverage(input.contentMarkdown, coverageProfile);
    if (coverageReport.missing.length > 0) {
      failures.push({
        gate: "mandatory_deliverable_coverage",
        state: "validation",
        message: "Draft does not represent all applicable mandatory professional deliverable requirements. Professional completion requires 100% mandatory deliverable coverage before artifacts or task completion.",
        details: [
          `coverage=${coverageReport.satisfiedCount}/${coverageReport.mandatoryRequirementCount} (${coverageReport.coveragePercentage}%)`,
          ...coverageReport.missing.slice(0, 20).map((failure) =>
            `${failure.requirementId}: ${failure.requiredDeliverableRepresentation} (${failure.classification})`,
          ),
        ],
      });
    }
  }

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

    const rawClaims = input.rawClaims ?? [];
    if (evidenceContract.claimIntegrityRequired === true && rawClaims.length > 0) {
      if (!input.evidencePack) {
        failures.push({
          gate: "claim_integrity",
          state: "validation",
          message: "Blueprint requires claim integrity, but no evidence pack is available for claim validation.",
        });
      } else {
        const validation = validateClaimBatch(rawClaims, input.evidencePack);
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

const INCOMPLETE_MARKER_PATTERN = /\[(?:INCOMPLETE|MISSING|TODO|UNKNOWN|REQUIRED)(?::[^\]]+)?\]/gi;
const BRACKET_TOKEN_PATTERN = /\[([^\]\r\n]{2,160})\](?!\()/g;
const MARKDOWN_HEADING_PATTERN = /^#{1,6}\s+(.+?)\s*#*\s*$/gm;
const INSTRUCTIONAL_PLACEHOLDER_PATTERN =
  /^(?:INSERT|ADD|DESCRIBE|TBD|TODO|COMPLETE|SPECIFY|DETAIL)\b/;
const INTERNAL_METHOD_HEADING_PATTERN =
  /\b(?:extraction|validation|governance\s+decision\s+trail|decision\s+trail|evidence\s+doctrine|completeness\s+gate|authority\s+package|preservation\s+inventory|readiness\s+findings|change\s+history|professional\s+boundaries|handoffs|reconciliation)\b/i;
const PROFESSIONAL_PLACEHOLDER_TERMS = [
  "CLAUSE",
  "CLAUSES",
  "OBLIGATION",
  "OBLIGATIONS",
  "RESPONSIBILITY",
  "RESPONSIBILITIES",
  "RIGHT",
  "RIGHTS",
  "TERM",
  "TERMS",
  "CONDITION",
  "CONDITIONS",
  "PROVISION",
  "PROVISIONS",
  "FRAMEWORK",
  "POLICY",
  "PROCEDURE",
  "PROCESS",
  "COMPLAINT",
  "COMPLAINTS",
  "PRIVACY",
  "CONFIDENTIALITY",
  "CANCELLATION",
  "VARIATION",
  "CHANGE",
  "TERMINATION",
  "EXIT",
  "DELIVERY",
  "PROVIDER",
  "PARTICIPANT",
  "PAYMENT",
  "PRICING",
  "GST_CLAUSE",
  "CONCLUSION",
  "RECOMMENDATION",
  "FINDING",
  "ANALYSIS",
  "ASSESSMENT",
  "REVIEW",
  "SUMMARY",
  "REQUIREMENT",
  "REQUIREMENTS",
  "SCREENING",
  "CLEARANCE",
  "CLEARANCES",
  "CREDENTIAL",
  "CREDENTIALS",
  "TRAINING",
  "INDUCTION",
  "ONBOARDING",
  "ACKNOWLEDGEMENT",
  "ACKNOWLEDGEMENTS",
  "HANDOVER",
  "EQUIPMENT",
  "ACCESS",
  "SUPERVISION",
] as const;

const USER_DATA_PLACEHOLDER_TERMS = [
  "NAME",
  "ABN",
  "ACN",
  "NUMBER",
  "ID",
  "IDENTIFIER",
  "DATE",
  "ADDRESS",
  "EMAIL",
  "PHONE",
  "CONTACT",
  "SIGNATURE",
  "INITIAL",
  "PERIOD",
  "PRICE",
  "RATE",
  "AMOUNT",
  "TOTAL",
  "SCHEDULE",
  "PLAN",
  "SUPPORT_ITEM",
  "SUPPORT",
  "DETAILS",
  "ROLE",
  "TITLE",
  "REPRESENTATIVE",
  "NOMINEE",
  "GUARDIAN",
  "PARTICIPANT_NAME",
  "PROVIDER_NAME",
  "PROVIDER_ABN",
  "NDIS_NUMBER",
  "AGREEMENT_PERIOD",
  "SUPPORT_SCHEDULE",
  "STAFF_NAME",
  "START_DATE",
  "MANAGER",
  "EMPLOYMENT_TYPE",
  "REQUIRED_CLEARANCES",
  "INDUCTION_DATE",
  "SIGN_OFF",
  "GOALS",
  "SUPPORT_NEEDS",
  "PREFERENCES",
  "REVIEW_DATE",
  "ORGANISATION_NAME",
  "POLICY_OWNER",
  "APPROVAL_DATE",
  "RESPONSIBLE_ROLE",
] as const;

export function detectUnresolvedProfessionalPlaceholders(
  contentMarkdown: string,
  standardTemplateEvidence?: StandardTemplateEvidenceContext | null,
  professionalContext?: ProfessionalExecutionContext | null,
): string[] {
  const findings = new Set<string>();
  for (const marker of contentMarkdown.match(INCOMPLETE_MARKER_PATTERN) ?? []) {
    findings.add(marker);
  }

  for (const match of contentMarkdown.matchAll(BRACKET_TOKEN_PATTERN)) {
    const raw = match[0];
    const classification = classifyBracketedPlaceholderToken(
      match[1] ?? "",
      standardTemplateEvidence,
      professionalContext,
    );
    if (classification === "unresolved_professional_content") findings.add(raw);
  }
  return [...findings].sort();
}

export type BracketedPlaceholderClassification =
  | "legitimate_factual_field"
  | "unresolved_professional_content"
  | "ignored";

export function classifyBracketedPlaceholderToken(
  rawToken: string,
  standardTemplateEvidence?: StandardTemplateEvidenceContext | null,
  professionalContext?: ProfessionalExecutionContext | null,
): BracketedPlaceholderClassification {
  const token = normalisePlaceholderToken(rawToken);
  if (!token || isIgnorableBracketToken(rawToken, token)) return "ignored";
  if (INSTRUCTIONAL_PLACEHOLDER_PATTERN.test(token)) return "unresolved_professional_content";
  if (isAllowedUserDataPlaceholder(token, standardTemplateEvidence, professionalContext)) {
    return "legitimate_factual_field";
  }
  if (isProfessionalPlaceholderToken(token)) return "unresolved_professional_content";
  if (looksLikeUndeclaredPlaceholderToken(token)) return "unresolved_professional_content";
  return "ignored";
}

function normalisePlaceholderToken(token: string): string {
  return token
    .trim()
    .replace(/[\s-]+/g, "_")
    .replace(/__+/g, "_")
    .toUpperCase();
}

function isAllowedUserDataPlaceholder(
  token: string,
  standardTemplateEvidence?: StandardTemplateEvidenceContext | null,
  professionalContext?: ProfessionalExecutionContext | null,
): boolean {
  if (!isCustomerTemplateOptional(standardTemplateEvidence)) return false;
  const declared = normalisedDeclaredFactualPlaceholders(professionalContext);
  if (declared.size > 0) return declared.has(token);
  return USER_DATA_PLACEHOLDER_TERMS.some(term => token === term);
}

function isProfessionalPlaceholderToken(token: string): boolean {
  return PROFESSIONAL_PLACEHOLDER_TERMS.some(term =>
    token === term || token.endsWith(`_${term}`) || token.includes(`${term}_`) || token.includes(`_${term}_`),
  );
}

function normalisedDeclaredFactualPlaceholders(
  professionalContext?: ProfessionalExecutionContext | null,
): Set<string> {
  return new Set(
    (professionalContext?.deliverable.allowedFactualPlaceholders ?? [])
      .map((placeholder) => placeholder.replace(/^\[/, "").replace(/\]$/, ""))
      .map(normalisePlaceholderToken)
      .filter(Boolean),
  );
}

function isIgnorableBracketToken(rawToken: string, token: string): boolean {
  const trimmed = rawToken.trim();
  if (trimmed === "" || trimmed === " " || /^[xX]$/.test(trimmed)) return true;
  if (/^\d{1,3}$/.test(trimmed)) return true;
  if (/^(?:https?|mailto):/i.test(trimmed)) return true;
  if (token.length < 3) return true;
  return false;
}

function looksLikeUndeclaredPlaceholderToken(token: string): boolean {
  if (token.includes("_")) return true;
  if (/\b(?:DESCRIPTION|REQUIREMENTS?|OBLIGATIONS?|RISKS?|SAFEGUARDS?|PATHWAYS?|PREFERENCES?|STRENGTHS?|SUPPORTS?|ACTIVITIES|RESPONSIBILITIES?|CONTENT|SECTION|TEXT|DETAILS)\b/.test(token)) {
    return true;
  }
  return false;
}

export function detectLeakedBlueprintMethodologyHeadings(
  contentMarkdown: string,
  sections: BlueprintSection[],
  standardTemplateEvidence?: StandardTemplateEvidenceContext | null,
): string[] {
  if (!isCustomerTemplateOptional(standardTemplateEvidence)) return [];

  const sectionLabels = new Set(
    sections.flatMap((section) => [section.sectionCode, section.title])
      .filter(Boolean)
      .map(normaliseHeadingLabel),
  );
  const findings = new Set<string>();

  for (const match of contentMarkdown.matchAll(MARKDOWN_HEADING_PATTERN)) {
    const rawHeading = (match[1] ?? "").trim();
    if (!rawHeading) continue;
    if (isAllowedUserFacingTemplateHeading(rawHeading, standardTemplateEvidence)) continue;
    const normalised = normaliseHeadingLabel(rawHeading);
    if (sectionLabels.has(normalised) || INTERNAL_METHOD_HEADING_PATTERN.test(rawHeading)) {
      findings.add(rawHeading);
    }
  }

  return [...findings].sort();
}

function isAllowedUserFacingTemplateHeading(
  heading: string,
  standardTemplateEvidence?: StandardTemplateEvidenceContext | null,
): boolean {
  if (!isCustomerTemplateOptional(standardTemplateEvidence)) return false;
  return /\b(?:purpose|scope|goals?|preferences?|communication|support requirements?|support schedule|responsibilit(?:y|ies)|rights?|privacy|confidentiality|complaints?|feedback|payment|pricing|cancellation|variation|termination|review|updates?|consent|sign[- ]off|risk|safety|incident|escalation|health|medication|behaviour|community participation|coordination)\b/i.test(heading) &&
    !INTERNAL_METHOD_HEADING_PATTERN.test(heading) &&
    !/\b(?:gate|inventory|authority package|readiness assessment|completeness review|validation review|methodology|checklist|control)\b/i.test(heading);
}

export function detectInstructionalProfessionalText(
  contentMarkdown: string,
  standardTemplateEvidence?: StandardTemplateEvidenceContext | null,
): string[] {
  if (!isCustomerTemplateOptional(standardTemplateEvidence)) return [];

  const findings = new Set<string>();
  const paragraphs = contentMarkdown
    .split(/\r?\n/)
    .filter((line) => !/^#{1,6}\s+/.test(line.trim()))
    .join("\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (const paragraph of paragraphs) {
    const withoutHeading = paragraph;
    if (
      /\b(?:review|validate|assess|identify|map|check|determine|insert|draft|configure|complete)\b/i.test(withoutHeading) &&
      /\b(?:clause|clauses|provision|provisions|obligation|obligations|responsibilit(?:y|ies)|right|rights|term|terms|cancellation|variation|termination|privacy|complaints?|payment|pricing|conclusion)\b/i.test(withoutHeading) &&
      !/\b(?:must|will|should|agrees?|may|is responsible for|has the right to|is entitled to|assist|document|record|support(?:ed|s|ing)?|ensure)\b/i.test(withoutHeading)
    ) {
      findings.add(`instructional_text:${withoutHeading.slice(0, 140)}`);
    }
  }

  return [...findings].sort();
}

export function detectIncompleteProfessionalSections(
  contentMarkdown: string,
  standardTemplateEvidence?: StandardTemplateEvidenceContext | null,
): string[] {
  if (!isCustomerTemplateOptional(standardTemplateEvidence)) return [];

  const findings = new Set<string>();
  for (const section of extractMarkdownSections(contentMarkdown)) {
    const heading = section.heading;
    const body = section.body;
    if (!isProfessionalSectionHeading(heading)) continue;
    const bodyWithoutPlaceholders = body
      .replace(INCOMPLETE_MARKER_PATTERN, "")
      .replace(BRACKET_TOKEN_PATTERN, "")
      .replace(/\s+/g, " ")
      .trim();
    if (bodyWithoutPlaceholders.length < 80) {
      findings.add(`incomplete_section:${heading}`);
    }
  }
  return [...findings].sort();
}

export function detectPlaceholderDominatedProfessionalSections(
  contentMarkdown: string,
  standardTemplateEvidence?: StandardTemplateEvidenceContext | null,
): string[] {
  if (!isCustomerTemplateOptional(standardTemplateEvidence)) return [];

  const findings = new Set<string>();
  for (const section of extractMarkdownSections(contentMarkdown)) {
    const heading = section.heading;
    const body = section.body;
    if (!isProfessionalSectionHeading(heading)) continue;

    const bracketTokens = [...body.matchAll(BRACKET_TOKEN_PATTERN)].length;
    if (bracketTokens === 0) continue;

    const substantiveLines = body
      .split(/\n+/)
      .map((line) => line
        .replace(BRACKET_TOKEN_PATTERN, "")
        .replace(/^[\s>*-]+/, "")
        .replace(/\*\*/g, "")
        .trim())
      .filter(Boolean)
      .filter((line) => !/^[A-Z][A-Za-z0-9 /&(),-]{2,64}:\s*$/.test(line))
      .filter((line) => !/^[A-Z][A-Za-z0-9 /&(),-]{2,64}:\s*(?:TBC|TBD|N\/A)?$/i.test(line));

    const substantiveText = substantiveLines.join(" ").replace(/\s+/g, " ").trim();
    const substantiveWords = substantiveText
      .split(/\s+/)
      .filter((word) => /[A-Za-z]/.test(word)).length;
    const hasOperativeProfessionalText =
      /\b(?:must|will|should|agrees?|responsib(?:le|ility|ilities)|right|rights|consent|review(?:ed)?|escalat(?:e|ion)|monitor(?:ed|ing)|support(?:s|ed|ing)?|provide(?:r|s|d)?|record(?:s|ed)?|notify|protect|maintain|update(?:d)?)\b/i.test(substantiveText);

    if (bracketTokens >= 2 && (substantiveWords < 45 || !hasOperativeProfessionalText)) {
      findings.add(`placeholder_dominated_section:${heading}`);
    }
  }

  return [...findings].sort();
}

function extractMarkdownSections(contentMarkdown: string): Array<{ heading: string; body: string }> {
  const sections: Array<{ heading: string; body: string[] }> = [];
  let current: { heading: string; body: string[] } | null = null;

  for (const line of contentMarkdown.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      current = { heading: (heading[1] ?? "").trim(), body: [] };
      sections.push(current);
      continue;
    }
    current?.body.push(line);
  }

  return sections.map((section) => ({
    heading: section.heading,
    body: section.body.join("\n").trim(),
  }));
}

function isProfessionalSectionHeading(heading: string): boolean {
  if (/\b(?:template|document|agreement|plan)\s*$/i.test(heading) && !/\b(?:schedule|support|review|risk|responsibilit|provision|clause|term|consent|sign[- ]off)\b/i.test(heading)) {
    return false;
  }
  return /\b(?:clause|clauses|obligations?|responsibilit(?:y|ies)|rights?|terms?|provisions?|privacy|confidentiality|complaints?|cancellation|variation|termination|payment|pricing|conclusion|review|updates?|consent|sign[- ]off|support|goals?|preferences?|communication|health|medication|behaviour|restrictive[- ]practice|risk|safety|incident|escalation|community|participation|coordination)\b/i.test(heading);
}

function normaliseHeadingLabel(value: string): string {
  return value
    .trim()
    .replace(/[`*_~[\]()]/g, "")
    .replace(/&/g, "and")
    .replace(/[/_-]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
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
