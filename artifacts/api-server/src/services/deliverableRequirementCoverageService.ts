import type { ProfessionalExecutionContext } from "./professionalExecutionContextService.js";
import type { BlueprintExecutionContract, BlueprintSection } from "./workBlueprintService.js";

export type DeliverableRequirementClassification =
  | "INTERNAL_METHODOLOGY"
  | "EVIDENCE_REQUIREMENT"
  | "QUALITY_CONTROL"
  | "MUST_BE_REPRESENTED"
  | "CONDITIONAL"
  | "FACTUAL_FIELD"
  | "OPTIONAL_ENRICHMENT";

export interface DeliverableCoverageRule {
  anyOf?: string[];
  allOf?: string[];
}

export interface DeliverableRequirement {
  id: string;
  description: string;
  classification: DeliverableRequirementClassification;
  sourceBlueprintSection?: string;
  professionalRationale: string;
  evidenceAuthority: string[];
  requiredDeliverableRepresentation: string;
  coverageRules: DeliverableCoverageRule[];
}

export interface DeliverableRequirementCoverageProfile {
  deliverableType: string;
  operation: ProfessionalExecutionContext["operation"];
  standardisation: ProfessionalExecutionContext["deliverable"]["standardisation"];
  requirements: DeliverableRequirement[];
}

export interface DeliverableRequirementCoverageFailure {
  requirementId: string;
  requirement: string;
  classification: DeliverableRequirementClassification;
  sourceBlueprintSection?: string;
  requiredDeliverableRepresentation: string;
  reason: string;
}

export type RequirementCoverageStatus =
  | "satisfied"
  | "missing"
  | "internal_only"
  | "evidence_only"
  | "quality_control"
  | "optional";

export interface RequirementToDeliverablePlanItem {
  requirementId: string;
  professionalRequirement: string;
  sourceBlueprintSection?: string;
  classification: DeliverableRequirementClassification;
  authority: string[];
  applicability: "applicable" | "internal_only" | "evidence_only" | "quality_control" | "optional";
  expectedUserFacingRepresentation: string;
  targetDeliverableLocation: string;
  status: RequirementCoverageStatus;
}

export interface DeliverableRequirementCoverageReport {
  deliverableType: string;
  operation: DeliverableRequirementCoverageProfile["operation"];
  totalApplicableRequirements: number;
  mandatoryRequirementCount: number;
  satisfiedCount: number;
  missingCount: number;
  coveragePercentage: number;
  classificationCounts: Record<DeliverableRequirementClassification, number>;
  plan: RequirementToDeliverablePlanItem[];
  missing: DeliverableRequirementCoverageFailure[];
}

export interface BlueprintRequirementClassificationSummary {
  blueprintCode: string;
  professionalDomain: string;
  primarySpecialist: string;
  supportedOperations: string[];
  deliverableTypes: string[];
  requirementCount: number;
  classificationCounts: Record<DeliverableRequirementClassification, number>;
  methodologyLeakRisk: "controlled_by_runtime" | "requires_review";
  mandatoryDeliverableCoverageCapability: "derived" | "explicit";
  compatible: boolean;
  exceptions: string[];
}

const COVERAGE_CLASSIFICATIONS: DeliverableRequirementClassification[] = [
  "INTERNAL_METHODOLOGY",
  "EVIDENCE_REQUIREMENT",
  "QUALITY_CONTROL",
  "MUST_BE_REPRESENTED",
  "CONDITIONAL",
  "FACTUAL_FIELD",
  "OPTIONAL_ENRICHMENT",
];

export function deriveDeliverableRequirementCoverageProfile(
  context: ProfessionalExecutionContext,
  contract?: BlueprintExecutionContract | null,
): DeliverableRequirementCoverageProfile {
  if (context.deliverable.requestedDeliverableType === "STANDARD_REUSABLE_NDIS_SERVICE_AGREEMENT") {
    return {
      deliverableType: context.deliverable.requestedDeliverableType,
      operation: context.operation,
      standardisation: context.deliverable.standardisation,
      requirements: serviceAgreementRequirements(contract),
    };
  }

  return {
    deliverableType: context.deliverable.requestedDeliverableType,
    operation: context.operation,
    standardisation: context.deliverable.standardisation,
    requirements: genericDeliverableRequirements(context, contract),
  };
}

export function validateDeliverableRequirementCoverage(
  contentMarkdown: string,
  profile: DeliverableRequirementCoverageProfile,
): DeliverableRequirementCoverageFailure[] {
  return evaluateDeliverableRequirementCoverage(contentMarkdown, profile).missing;
}

export function buildRequirementToDeliverablePlan(
  profile: DeliverableRequirementCoverageProfile,
): RequirementToDeliverablePlanItem[] {
  return profile.requirements.map((requirement) => {
    const applicability = requirementApplicability(requirement.classification);
    return {
      requirementId: requirement.id,
      professionalRequirement: requirement.description,
      sourceBlueprintSection: requirement.sourceBlueprintSection,
      classification: requirement.classification,
      authority: requirement.evidenceAuthority.length > 0
        ? requirement.evidenceAuthority
        : ["Blueprint professional method", "Professional deliverable contract"],
      applicability,
      expectedUserFacingRepresentation: requirement.requiredDeliverableRepresentation,
      targetDeliverableLocation: inferTargetDeliverableLocation(requirement),
      status: isBlockingRequirement(requirement.classification) ? "missing" : nonBlockingStatus(requirement.classification),
    };
  });
}

export function evaluateDeliverableRequirementCoverage(
  contentMarkdown: string,
  profile: DeliverableRequirementCoverageProfile,
): DeliverableRequirementCoverageReport {
  const failures: DeliverableRequirementCoverageFailure[] = [];
  const normalisedContent = normaliseContent(contentMarkdown);
  const plan = buildRequirementToDeliverablePlan(profile);
  const classificationCounts = Object.fromEntries(
    COVERAGE_CLASSIFICATIONS.map((classification) => [classification, 0]),
  ) as Record<DeliverableRequirementClassification, number>;
  let satisfiedCount = 0;

  for (const requirement of profile.requirements) {
    classificationCounts[requirement.classification] += 1;
    const planItem = plan.find((item) => item.requirementId === requirement.id);
    if (!isBlockingRequirement(requirement.classification)) continue;
    const passed = requirement.coverageRules.length > 0
      ? requirement.coverageRules.some((rule) => coverageRuleMatches(normalisedContent, rule))
      : coverageRuleMatches(normalisedContent, { allOf: keywordCandidates(requirement.description) });
    if (passed) {
      satisfiedCount += 1;
      if (planItem) planItem.status = "satisfied";
      continue;
    }

    failures.push({
      requirementId: requirement.id,
      requirement: requirement.description,
      classification: requirement.classification,
      sourceBlueprintSection: requirement.sourceBlueprintSection,
      requiredDeliverableRepresentation: requirement.requiredDeliverableRepresentation,
      reason: "Required professional substance is not represented in the user-facing deliverable.",
    });
  }

  const mandatoryRequirementCount = profile.requirements.filter((requirement) =>
    isBlockingRequirement(requirement.classification),
  ).length;
  return {
    deliverableType: profile.deliverableType,
    operation: profile.operation,
    totalApplicableRequirements: profile.requirements.filter((requirement) =>
      requirementApplicability(requirement.classification) === "applicable",
    ).length,
    mandatoryRequirementCount,
    satisfiedCount,
    missingCount: failures.length,
    coveragePercentage: mandatoryRequirementCount === 0
      ? 100
      : Math.round((satisfiedCount / mandatoryRequirementCount) * 1000) / 10,
    classificationCounts,
    plan,
    missing: failures,
  };
}

export function formatRequirementCoveragePrompt(profile: DeliverableRequirementCoverageProfile): string {
  const plan = buildRequirementToDeliverablePlan(profile);
  const lines = plan
    .filter((requirement) => requirement.applicability === "applicable")
    .filter((requirement) => isBlockingRequirement(requirement.classification))
    .map((requirement) => [
      `- ${requirement.requirementId} [${requirement.classification}]`,
      `  Requirement: ${requirement.professionalRequirement}`,
      requirement.sourceBlueprintSection ? `  Source Blueprint section: ${requirement.sourceBlueprintSection}` : "",
      `  Final deliverable representation: ${requirement.expectedUserFacingRepresentation}`,
      `  Target location: ${requirement.targetDeliverableLocation}`,
    ].filter(Boolean).join("\n"));

  return [
    "## MANDATORY DELIVERABLE REQUIREMENT COVERAGE",
    "Every MUST_BE_REPRESENTED, CONDITIONAL when applicable, and FACTUAL_FIELD requirement below must be represented in the final user-facing deliverable. Do not expose the internal requirement IDs or Blueprint section names as customer-facing headings unless the deliverable naturally requires that exact term.",
    "Build an internal requirement-to-deliverable plan before drafting. The plan is professional work product and must not be exposed as the final document.",
    ...lines,
  ].join("\n");
}

export function classifyBlueprintRequirement(section: BlueprintSection): DeliverableRequirementClassification {
  const text = `${section.sectionCode} ${section.title} ${section.description} ${section.instructions}`.toLowerCase();
  if (/\b(?:boundary|handoff|approval limit|legal review boundary|professional boundaries)\b/.test(text)) return "QUALITY_CONTROL";
  if (/\b(?:evidence|source|authority package|krs|current authority|citation|provenance)\b/.test(text)) return "EVIDENCE_REQUIREMENT";
  if (/\b(?:gate|readiness|quality|validation|inventory|reconciliation|review|assess|validate|compare|investigate|determine|classification)\b/.test(text)) {
    if (/\b(?:clause|support|schedule|pricing|responsibilit|rights?|privacy|complaints?|termination|variation|incident|risk|policy|procedure|plan|framework|register|report|table|field)\b/.test(text)) {
      return "CONDITIONAL";
    }
    return "INTERNAL_METHODOLOGY";
  }
  if (/\b(?:name|number|date|period|amount|price|unit|quantity|frequency|code|signature|abn|identifier|field)\b/.test(text)) return "FACTUAL_FIELD";
  if (section.required) return "MUST_BE_REPRESENTED";
  return "OPTIONAL_ENRICHMENT";
}

export function auditBlueprintRequirementCompatibility(
  contract: BlueprintExecutionContract,
): BlueprintRequirementClassificationSummary {
  const classificationCounts = Object.fromEntries(
    COVERAGE_CLASSIFICATIONS.map((classification) => [classification, 0]),
  ) as Record<DeliverableRequirementClassification, number>;

  for (const section of contract.sections) {
    classificationCounts[classifyBlueprintRequirement(section)] += 1;
  }

  const exceptions: string[] = [];
  if (!contract.blueprint.code) exceptions.push("missing_blueprint_code");
  if (!contract.blueprint.blueprintFamily) exceptions.push("missing_professional_domain");
  if (!contract.blueprint.futureOwnerRoleCode) exceptions.push("missing_primary_specialist");
  if (!contract.blueprint.outputTypes?.length) exceptions.push("missing_deliverable_type");
  if (!contract.sections.length) exceptions.push("missing_professional_method");

  return {
    blueprintCode: contract.blueprint.code,
    professionalDomain: contract.blueprint.blueprintFamily,
    primarySpecialist: contract.blueprint.futureOwnerRoleCode ?? "owner_unresolved",
    supportedOperations: contract.blueprint.supportedModes ?? [],
    deliverableTypes: contract.blueprint.outputTypes ?? [],
    requirementCount: contract.sections.length,
    classificationCounts,
    methodologyLeakRisk: "controlled_by_runtime",
    mandatoryDeliverableCoverageCapability: "derived",
    compatible: exceptions.length === 0,
    exceptions,
  };
}

function serviceAgreementRequirements(contract?: BlueprintExecutionContract | null): DeliverableRequirement[] {
  const section = (code: string): string | undefined =>
    contract?.sections.find((candidate) => candidate.sectionCode === code)?.sectionCode;

  return [
    req("service-agreement-parties", "Agreement parties, provider details, participant details, representative authority and agreement period are present as reusable factual fields.", "FACTUAL_FIELD", section("PARTIES_REPRESENTATIVE_AND_AUTHORITY"), "Parties and agreement details fields", [["provider", "participant"], ["representative", "authority"], ["agreement", "period"]]),
    req("service-agreement-basis", "NDIS agreement basis, purpose, scope of supports and service relationship are represented as drafted clauses.", "MUST_BE_REPRESENTED", section("NDIS_AND_AGREEMENT_BASIS"), "Agreement basis and scope clauses", [["ndis", "agreement"], ["purpose", "scope"]]),
    req("support-schedule-table", "Schedule of Supports is included as a first-class table or structured schedule.", "MUST_BE_REPRESENTED", section("SCHEDULE_OF_SUPPORTS_RECONCILIATION"), "Schedule of Supports table", [["schedule", "support"]]),
    req("support-item-code-field", "Schedule of Supports contains an NDIS support item/code field.", "FACTUAL_FIELD", section("SUPPORT_ITEM_CODE_DESCRIPTION_VALIDATION"), "Schedule column for NDIS support item/code", [["support", "item", "code"]]),
    req("support-description-field", "Schedule of Supports contains a support/service description field.", "FACTUAL_FIELD", section("SCOPE_OF_SUPPORTS_AND_SERVICE_FORMATION"), "Schedule column for support description", [["description"], ["support", "service"]]),
    req("support-unit-basis-field", "Schedule of Supports contains unit or basis of supply.", "FACTUAL_FIELD", section("PRICING_AND_ADJUSTMENTS_REVIEW"), "Schedule column for unit/basis", [["unit"], ["basis"]]),
    req("support-quantity-frequency-field", "Schedule of Supports contains quantity, hours, weeks or frequency.", "FACTUAL_FIELD", section("SCHEDULE_OF_SUPPORTS_RECONCILIATION"), "Schedule column for quantity/frequency", [["quantity"], ["frequency"], ["hours"], ["weeks"]]),
    req("support-unit-price-field", "Schedule of Supports contains unit price or rate.", "FACTUAL_FIELD", section("PRICING_AND_ADJUSTMENTS_REVIEW"), "Schedule column for unit price/rate", [["unit", "price"], ["rate"]]),
    req("support-service-period-field", "Schedule of Supports contains applicable service period.", "FACTUAL_FIELD", section("HISTORICAL_PRICING_AND_EFFECTIVE_PERIOD"), "Schedule column for service period", [["service period"]]),
    req("support-total-field", "Schedule of Supports contains subtotal, estimated total or agreement-period total structure.", "FACTUAL_FIELD", section("SCHEDULE_OF_SUPPORTS_RECONCILIATION"), "Schedule total/subtotal field", [["subtotal"], ["estimated", "total"], ["agreement", "total"], ["total", "amount"]]),
    req("delivery-obligations", "Delivery obligations and operational responsibilities are drafted without overpromising unsupported services.", "MUST_BE_REPRESENTED", section("DELIVERY_OF_SUPPORTS_AND_OPERATIONAL_CAPABILITY"), "Delivery of supports clause", [["delivery", "support"], ["provider", "responsib"]]),
    req("provider-responsibilities", "Provider responsibilities are drafted across service delivery, privacy, records, billing, complaints, continuity and escalation.", "MUST_BE_REPRESENTED", section("PROVIDER_RESPONSIBILITIES_REVIEW"), "Provider responsibilities clause", [["provider", "responsib"]]),
    req("participant-responsibilities", "Participant or representative responsibilities are drafted without transferring provider obligations.", "MUST_BE_REPRESENTED", section("PARTICIPANT_REPRESENTATIVE_RESPONSIBILITIES_REVIEW"), "Participant/representative responsibilities clause", [["participant", "responsib"], ["representative"]]),
    req("rights-privacy-complaints-advocacy", "Participant rights, privacy, confidentiality, complaints, disputes and advocacy are represented.", "MUST_BE_REPRESENTED", section("PARTICIPANT_RIGHTS_PRIVACY_COMPLAINTS_AND_ADVOCACY"), "Rights, privacy, complaints and advocacy clauses", [["rights"], ["privacy"], ["complaint"], ["advocacy"]]),
    req("pricing-payment-adjustments", "Payment, pricing, GST/non-NDIS costs, price changes and authority/current-pricing qualification are represented.", "MUST_BE_REPRESENTED", section("PRICING_AND_ADJUSTMENTS_REVIEW"), "Payment and pricing clauses", [["payment"], ["pricing"], ["gst"], ["price", "change"]]),
    req("cancellation-no-show", "Cancellation, no-show, rescheduling and notice expectations are represented.", "MUST_BE_REPRESENTED", section("CANCELLATION_NO_SHOW_AND_RESCHEDULING"), "Cancellation/no-show clause", [["cancellation"], ["no-show"], ["notice"]]),
    req("variation-amendment", "Variation, change, amendment, notification and consent/signature control are represented.", "MUST_BE_REPRESENTED", section("VARIATION_CHANGE_AND_AMENDMENT_CONTROL"), "Variation/change clause", [["variation"], ["change"], ["consent"]]),
    req("termination-transition", "Termination, exit, transition, final obligations and participant choice are represented.", "MUST_BE_REPRESENTED", section("TERMINATION_EXIT_AND_TRANSITION"), "Termination/exit/transition clause", [["termination"], ["exit"], ["transition"]]),
    req("continuity-emergency-disaster", "Continuity, emergency and disaster arrangements are represented where applicable.", "CONDITIONAL", section("DISASTER_MANAGEMENT_EMERGENCY_PLANNING"), "Continuity/emergency/disaster clause", [["continuity"], ["emergency"], ["disaster"]]),
    req("signatures-acceptance", "Signature and acceptance fields are present for provider, participant and representative where applicable.", "FACTUAL_FIELD", section("DOCUMENT_AUTHORITY_AND_STATUS"), "Signature and acceptance block", [["signature"], ["acceptance"]]),
  ];
}

function genericDeliverableRequirements(
  context: ProfessionalExecutionContext,
  contract?: BlueprintExecutionContract | null,
): DeliverableRequirement[] {
  const userFacing = context.deliverable.mandatoryProfessionalContent.map((item, index) =>
    req(
      `mandatory-${index + 1}`,
      item,
      itemLooksLikeFactualField(item) ? "FACTUAL_FIELD" : "MUST_BE_REPRESENTED",
      undefined,
      `User-facing representation of ${item}`,
      [keywordCandidates(item)],
    ),
  );

  const blueprintDerived = (contract?.sections ?? [])
    .filter((section) => section.required)
    .slice(0, 12)
    .map((section) => {
      const classification = classifyBlueprintRequirement(section);
      return req(
        `blueprint-${section.sectionCode.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        section.description || section.title,
        classification === "INTERNAL_METHODOLOGY" || classification === "QUALITY_CONTROL" || classification === "EVIDENCE_REQUIREMENT"
          ? classification
          : "CONDITIONAL",
        section.sectionCode,
        `Professionally appropriate deliverable representation of ${section.title}`,
        [keywordCandidates(section.description || section.title).slice(0, 4)],
      );
    });

  return [...userFacing, ...blueprintDerived];
}

function req(
  id: string,
  description: string,
  classification: DeliverableRequirementClassification,
  sourceBlueprintSection: string | undefined,
  representation: string,
  allOfAlternatives: string[][],
): DeliverableRequirement {
  return {
    id,
    description,
    classification,
    sourceBlueprintSection,
    professionalRationale: "Blueprint professional substance must be represented without exposing internal methodology.",
    evidenceAuthority: [],
    requiredDeliverableRepresentation: representation,
    coverageRules: allOfAlternatives.map((allOf) => ({ allOf })),
  };
}

function isBlockingRequirement(classification: DeliverableRequirementClassification): boolean {
  return classification === "MUST_BE_REPRESENTED" ||
    classification === "CONDITIONAL" ||
    classification === "FACTUAL_FIELD";
}

function requirementApplicability(
  classification: DeliverableRequirementClassification,
): RequirementToDeliverablePlanItem["applicability"] {
  if (classification === "INTERNAL_METHODOLOGY") return "internal_only";
  if (classification === "EVIDENCE_REQUIREMENT") return "evidence_only";
  if (classification === "QUALITY_CONTROL") return "quality_control";
  if (classification === "OPTIONAL_ENRICHMENT") return "optional";
  return "applicable";
}

function nonBlockingStatus(classification: DeliverableRequirementClassification): RequirementCoverageStatus {
  if (classification === "INTERNAL_METHODOLOGY") return "internal_only";
  if (classification === "EVIDENCE_REQUIREMENT") return "evidence_only";
  if (classification === "QUALITY_CONTROL") return "quality_control";
  return "optional";
}

function inferTargetDeliverableLocation(requirement: DeliverableRequirement): string {
  const representation = requirement.requiredDeliverableRepresentation.toLowerCase();
  if (representation.includes("schedule")) return "Schedule of Supports table/fields";
  if (representation.includes("signature") || representation.includes("acceptance")) return "Execution/sign-off block";
  if (representation.includes("payment") || representation.includes("pricing")) return "Payment and pricing clauses";
  if (representation.includes("termination") || representation.includes("exit")) return "Termination and transition clauses";
  if (representation.includes("rights") || representation.includes("privacy") || representation.includes("complaints")) return "Rights, privacy, complaints and advocacy clauses";
  if (representation.includes("responsibilities")) return "Responsibilities clauses";
  return requirement.requiredDeliverableRepresentation;
}

function coverageRuleMatches(normalisedContent: string, rule: DeliverableCoverageRule): boolean {
  const allOf = rule.allOf ?? [];
  const anyOf = rule.anyOf ?? [];
  const allPassed = allOf.every((term) => normalisedContent.includes(normaliseContent(term)));
  const anyPassed = anyOf.length === 0 || anyOf.some((term) => normalisedContent.includes(normaliseContent(term)));
  return allPassed && anyPassed;
}

function keywordCandidates(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9/& -]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .filter((word) => !["with", "where", "must", "required", "professional", "content", "framework", "review", "requirements"].includes(word))
    .slice(0, 5);
}

function itemLooksLikeFactualField(value: string): boolean {
  return /\b(?:name|number|date|period|price|amount|total|schedule|signature|field|identifier|code|quantity|frequency|unit)\b/i.test(value);
}

function normaliseContent(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
