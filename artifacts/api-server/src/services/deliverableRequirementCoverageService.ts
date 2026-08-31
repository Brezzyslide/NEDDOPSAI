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
  origin: "AUTHORED" | "DERIVED";
  sourceBlueprintSection?: string;
  professionalRationale: string;
  evidenceAuthority: string[];
  requiredDeliverableRepresentation: string;
  targetDeliverableLocation?: string;
  adequacyCriteria: string[];
  templateCriteria: string[];
  fixedContent: string[];
  templateFields: string[];
  completionPrompt: string | null;
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
  expectedRepresentation?: string;
  actualLocation?: string | null;
  structuralResult?: RequirementStructuralResult;
  substantiveResult?: RequirementSubstantiveResult;
  finalResult?: RequirementFinalResult;
  substantiveValidationMode?: RequirementSubstantiveValidationMode;
  substantiveBreakdown?: DeliverableSubstantiveBreakdown;
  reason: string;
}

export type RequirementStructuralResult =
  | "STRUCTURE_PASS"
  | "STRUCTURE_PARTIAL"
  | "STRUCTURE_FAIL"
  | "NOT_APPLICABLE";

export type RequirementSubstantiveResult =
  | "SUBSTANTIVE_PASS"
  | "SUBSTANTIVE_PARTIAL"
  | "SUBSTANTIVE_FAIL"
  | "NOT_APPLICABLE";

export type RequirementFinalResult =
  | "SATISFIED"
  | "PARTIAL"
  | "NOT_SATISFIED"
  | "NOT_APPLICABLE";

export type RequirementSubstantiveValidationMode =
  | "TEMPLATE_CRITERIA"
  | "ADEQUACY_CRITERIA"
  | "FALLBACK_HEURISTIC"
  | "NOT_APPLICABLE";

export interface DeliverableRequirementCoverageItem {
  requirementId: string;
  requirement: string;
  classification: DeliverableRequirementClassification;
  origin: DeliverableRequirement["origin"];
  sourceBlueprintSection?: string;
  expectedRepresentation: string;
  adequacyCriteria: string[];
  templateCriteria: string[];
  actualLocation: string | null;
  structuralResult: RequirementStructuralResult;
  substantiveResult: RequirementSubstantiveResult;
  substantiveValidationMode: RequirementSubstantiveValidationMode;
  substantiveBreakdown?: DeliverableSubstantiveBreakdown;
  finalResult: RequirementFinalResult;
  failureReason: string | null;
}

export interface DeliverableSubstantiveBreakdown {
  countedWordCount: number;
  fixedContentWordCount: number;
  proseWordCount: number;
  completionPromptWordCount: number;
  fieldLabelCount: number;
  placeholderCount: number;
  fieldAndPlaceholderWordCount: number;
  strippedSelfDescription: string[];
  countedContent: string;
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
  origin: DeliverableRequirement["origin"];
  sourceBlueprintSection?: string;
  classification: DeliverableRequirementClassification;
  authority: string[];
  adequacyCriteria: string[];
  templateCriteria: string[];
  applicability: "applicable" | "internal_only" | "evidence_only" | "quality_control" | "optional";
  expectedUserFacingRepresentation: string;
  targetDeliverableLocation: string;
  status: RequirementCoverageStatus;
}

export interface DeliverableOutputSchemaField {
  requirementId: string;
  classification: DeliverableRequirementClassification;
  origin: DeliverableRequirement["origin"];
  requiredRepresentation: string;
  targetSection: string;
  fieldLabel: string;
  representationKind: DeliverableRepresentationKind;
  adequacyCriteria: string[];
  templateCriteria: string[];
  minimumSubstance: string[];
}

export interface DeliverableOutputSchemaGroup {
  groupKey: string;
  targetSection: string;
  sectionType: DeliverableRepresentationKind;
  generationInstruction: string;
  fields: DeliverableOutputSchemaField[];
}

export interface DeliverableOutputSchema {
  deliverableType: string;
  operation: DeliverableRequirementCoverageProfile["operation"];
  groups: DeliverableOutputSchemaGroup[];
}

export type DeliverableRepresentationKind =
  | "document_section"
  | "clause"
  | "table"
  | "table_column"
  | "field"
  | "calculation_total"
  | "signature_block"
  | "conditional_section";

export interface DeliverableRequirementCoverageReport {
  deliverableType: string;
  operation: DeliverableRequirementCoverageProfile["operation"];
  requirementPlanStatus: "RESOLVED" | "UNRESOLVED";
  totalApplicableRequirements: number;
  mandatoryRequirementCount: number;
  satisfiedCount: number;
  missingCount: number;
  coveragePercentage: number;
  classificationCounts: Record<DeliverableRequirementClassification, number>;
  plan: RequirementToDeliverablePlanItem[];
  requirementResults: DeliverableRequirementCoverageItem[];
  missing: DeliverableRequirementCoverageFailure[];
}

export interface PerRequirementDeliverableSection {
  requirementId: string;
  heading: string;
  content: string;
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
  options: { deliverableSections?: PerRequirementDeliverableSection[] } = {},
): DeliverableRequirementCoverageFailure[] {
  return evaluateDeliverableRequirementCoverage(contentMarkdown, profile, options).missing;
}

export function buildRequirementToDeliverablePlan(
  profile: DeliverableRequirementCoverageProfile,
): RequirementToDeliverablePlanItem[] {
  return profile.requirements.map((requirement) => {
    const applicability = requirementApplicability(requirement.classification);
    return {
      requirementId: requirement.id,
      professionalRequirement: requirement.description,
      origin: requirement.origin ?? "DERIVED",
      sourceBlueprintSection: requirement.sourceBlueprintSection,
      classification: requirement.classification,
      authority: requirement.evidenceAuthority.length > 0
        ? requirement.evidenceAuthority
        : ["Blueprint professional method", "Professional deliverable contract"],
      adequacyCriteria: requirement.adequacyCriteria ?? [],
      templateCriteria: requirement.templateCriteria ?? [],
      applicability,
      expectedUserFacingRepresentation: requirement.requiredDeliverableRepresentation,
      targetDeliverableLocation: requirement.targetDeliverableLocation ?? inferTargetDeliverableLocation(requirement),
      status: isBlockingRequirement(requirement.classification) ? "missing" : nonBlockingStatus(requirement.classification),
    };
  });
}

export function buildDeliverableOutputSchema(
  profile: DeliverableRequirementCoverageProfile,
): DeliverableOutputSchema {
  const fields = buildRequirementToDeliverablePlan(profile)
    .filter((item) => item.applicability === "applicable")
    .filter((item) => isBlockingRequirement(item.classification))
    .map((item): DeliverableOutputSchemaField => ({
      requirementId: item.requirementId,
      classification: item.classification,
      origin: item.origin,
      requiredRepresentation: item.expectedUserFacingRepresentation,
      targetSection: item.targetDeliverableLocation,
      fieldLabel: deriveFieldLabel(item),
      representationKind: inferRepresentationKind(item),
      adequacyCriteria: item.adequacyCriteria,
      templateCriteria: item.templateCriteria,
      minimumSubstance: deriveMinimumSubstance(item),
    }));

  const groups = new Map<string, { targetSection: string; fields: DeliverableOutputSchemaField[] }>();
  for (const field of fields) {
    const groupKey = inferSchemaGroupKey(field);
    const existing = groups.get(groupKey) ?? { targetSection: inferGroupTitle(groupKey, field), fields: [] };
    existing.fields.push(field);
    groups.set(groupKey, existing);
  }

  return {
    deliverableType: profile.deliverableType,
    operation: profile.operation,
    groups: Array.from(groups.entries()).map(([groupKey, grouped]) => ({
      groupKey,
      targetSection: grouped.targetSection,
      sectionType: inferGroupSectionType(grouped.fields),
      generationInstruction: buildGroupGenerationInstruction(grouped.targetSection, grouped.fields),
      fields: grouped.fields,
    })),
  };
}

export function groupRequirementFailuresForRepair(
  profile: DeliverableRequirementCoverageProfile,
  failures: DeliverableRequirementCoverageFailure[],
): DeliverableRequirementCoverageFailure[][] {
  const schema = buildDeliverableOutputSchema(profile);
  const groupOrder = new Map(schema.groups.map((group, index) => [group.groupKey, index]));
  const grouped = new Map<string, DeliverableRequirementCoverageFailure[]>();
  for (const failure of failures) {
    const field = findSchemaField(schema, failure.requirementId);
    const key = field ? inferSchemaGroupKey(field) : normaliseContent(failure.requiredDeliverableRepresentation).replace(/[^a-z0-9]+/g, "-");
    const existing = grouped.get(key) ?? [];
    existing.push(failure);
    grouped.set(key, existing);
  }
  return Array.from(grouped.entries())
    .sort(([left], [right]) => (groupOrder.get(left) ?? 999) - (groupOrder.get(right) ?? 999))
    .map(([, items]) => items);
}

export function evaluateDeliverableRequirementCoverage(
  contentMarkdown: string,
  profile: DeliverableRequirementCoverageProfile,
  options: { deliverableSections?: PerRequirementDeliverableSection[] } = {},
): DeliverableRequirementCoverageReport {
  const normalisedContent = normaliseContent(contentMarkdown);
  const structure = parseMarkdownStructure(contentMarkdown);
  const structuredSections = normaliseDeliverableSections(options.deliverableSections);
  const failures: DeliverableRequirementCoverageFailure[] = buildDeliverableSectionIntegrityFailures(
    profile,
    structure,
    structuredSections,
  );
  const plan = buildRequirementToDeliverablePlan(profile);
  const schema = buildDeliverableOutputSchema(profile);
  const classificationCounts = Object.fromEntries(
    COVERAGE_CLASSIFICATIONS.map((classification) => [classification, 0]),
  ) as Record<DeliverableRequirementClassification, number>;
  const requirementResults: DeliverableRequirementCoverageItem[] = [];
  let satisfiedCount = 0;

  for (const requirement of profile.requirements) {
    classificationCounts[requirement.classification] += 1;
    const planItem = plan.find((item) => item.requirementId === requirement.id);
    if (!isBlockingRequirement(requirement.classification)) continue;
    const result = validateRequirementAgainstContent({
      requirement,
      standardisation: profile.standardisation,
      normalisedContent,
      structure,
      schema,
      structuredSection: null,
      structuredSectionsProvided: false,
    });
    requirementResults.push(result);
    if (result.finalResult === "SATISFIED") {
      satisfiedCount += 1;
      if (planItem) planItem.status = "satisfied";
      continue;
    }

    if (planItem) planItem.status = "missing";
    failures.push({
      requirementId: requirement.id,
      requirement: requirement.description,
      classification: requirement.classification,
      sourceBlueprintSection: requirement.sourceBlueprintSection,
      requiredDeliverableRepresentation: requirement.requiredDeliverableRepresentation,
      expectedRepresentation: result.expectedRepresentation,
      adequacyCriteria: result.adequacyCriteria,
      templateCriteria: result.templateCriteria,
      actualLocation: result.actualLocation,
      structuralResult: result.structuralResult,
      substantiveResult: result.substantiveResult,
      substantiveValidationMode: result.substantiveValidationMode,
      substantiveBreakdown: result.substantiveBreakdown,
      finalResult: result.finalResult,
      reason: result.failureReason ?? "Required professional substance is not represented in the user-facing deliverable.",
    });
  }

  const mandatoryRequirementCount = profile.requirements.filter((requirement) =>
    isBlockingRequirement(requirement.classification),
  ).length;
  return {
    deliverableType: profile.deliverableType,
    operation: profile.operation,
    requirementPlanStatus: mandatoryRequirementCount === 0 ? "UNRESOLVED" : "RESOLVED",
    totalApplicableRequirements: profile.requirements.filter((requirement) =>
      requirementApplicability(requirement.classification) === "applicable",
    ).length,
    mandatoryRequirementCount,
    satisfiedCount,
    missingCount: failures.length,
    coveragePercentage: mandatoryRequirementCount === 0
      ? 0
      : Math.round((satisfiedCount / mandatoryRequirementCount) * 1000) / 10,
    classificationCounts,
    plan,
    requirementResults,
    missing: failures,
  };
}

function buildDeliverableSectionIntegrityFailures(
  profile: DeliverableRequirementCoverageProfile,
  structure: MarkdownStructure,
  structuredSections: Map<string, PerRequirementDeliverableSection>,
): DeliverableRequirementCoverageFailure[] {
  if (structuredSections.size === 0) return [];

  const markdownSections = structure.sections.filter((section) => section.title !== "Document");
  const failures: DeliverableRequirementCoverageFailure[] = [];
  if (markdownSections.length !== structuredSections.size) {
    failures.push(deliverableSectionIntegrityFailure(
      `Assembled markdown section count (${markdownSections.length}) does not match structured deliverable section count (${structuredSections.size}) for ${profile.deliverableType}. Coverage must validate the persisted artifact markdown.`,
    ));
  }

  const normalisedMarkdown = normaliseContent(markdownSections
    .map((section) => `${section.title}\n${section.content}`)
    .join("\n\n"));
  const missingStructuredSections = Array.from(structuredSections.values())
    .filter((section) => !normalisedMarkdown.includes(normaliseContent(section.heading)) ||
      !normalisedMarkdown.includes(normaliseContent(section.content)));
  if (missingStructuredSections.length > 0) {
    failures.push(deliverableSectionIntegrityFailure(
      `Structured deliverable sections are not represented in the persisted markdown artifact for requirementId(s): ${missingStructuredSections.map((section) => section.requirementId).join(", ")}.`,
    ));
  }

  return failures;
}

function deliverableSectionIntegrityFailure(reason: string): DeliverableRequirementCoverageFailure {
  return {
    requirementId: "__deliverable_section_integrity__",
    requirement: "Persisted deliverable markdown must match the structured deliverable sections used during execution.",
    classification: "QUALITY_CONTROL",
    requiredDeliverableRepresentation: "The shipped markdown artifact contains the same complete section set as the structured deliverable.",
    expectedRepresentation: "Structured deliverable section side-channel may inform parsing but must not substitute for the persisted artifact.",
    actualLocation: null,
    structuralResult: "STRUCTURE_FAIL",
    substantiveResult: "SUBSTANTIVE_FAIL",
    substantiveValidationMode: "FALLBACK_HEURISTIC",
    finalResult: "NOT_SATISFIED",
    reason,
  };
}

export function formatRequirementCoveragePrompt(profile: DeliverableRequirementCoverageProfile): string {
  const plan = buildRequirementToDeliverablePlan(profile);
  const schema = buildDeliverableOutputSchema(profile);
  const lines = plan
    .filter((requirement) => requirement.applicability === "applicable")
    .filter((requirement) => isBlockingRequirement(requirement.classification))
    .map((requirement) => [
      `- ${requirement.requirementId} [${requirement.classification}]`,
      `  Origin: ${requirement.origin}`,
      `  Requirement: ${requirement.professionalRequirement}`,
      requirement.sourceBlueprintSection ? `  Source Blueprint section: ${requirement.sourceBlueprintSection}` : "",
      requirement.templateCriteria.length
        ? `  Template criteria:\n${requirement.templateCriteria.map((criterion) => `    - ${criterion}`).join("\n")}`
        : "  Template criteria: DERIVED_UNAVAILABLE",
      requirement.adequacyCriteria.length
        ? `  Participant criteria:\n${requirement.adequacyCriteria.map((criterion) => `    - ${criterion}`).join("\n")}`
        : "  Participant criteria: DERIVED_FALLBACK_HEURISTIC",
      `  Final deliverable representation: ${requirement.expectedUserFacingRepresentation}`,
      `  Target location: ${requirement.targetDeliverableLocation}`,
    ].filter(Boolean).join("\n"));

  return [
    "## MANDATORY DELIVERABLE REQUIREMENT COVERAGE",
    "Every MUST_BE_REPRESENTED, CONDITIONAL when applicable, and FACTUAL_FIELD requirement below must be represented in the final user-facing deliverable. Do not expose the internal requirement IDs or Blueprint section names as customer-facing headings unless the deliverable naturally requires that exact term.",
    "FACTUAL_FIELD means the field/structure itself must exist in reusable templates even when the value is unknown. Unknown values should become clear factual placeholders or fillable fields; omitting the field is a professional completion failure.",
    "Build an internal requirement-to-deliverable plan before drafting. The plan is professional work product and must not be exposed as the final document.",
    ...lines,
    "",
    "Machine-readable output schema derived from the requirement plan. The final deliverable must account for every requirement_id below:",
    JSON.stringify(schema, null, 2),
  ].join("\n");
}

function normaliseDeliverableSections(
  sections: PerRequirementDeliverableSection[] | undefined,
): Map<string, PerRequirementDeliverableSection> {
  const mapped = new Map<string, PerRequirementDeliverableSection>();
  for (const section of sections ?? []) {
    const requirementId = section.requirementId?.trim();
    const heading = section.heading?.trim();
    const content = section.content?.trim();
    if (!requirementId || !heading || !content) continue;
    mapped.set(requirementId, { requirementId, heading, content });
  }
  return mapped;
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
    req("support-total-field", "Schedule of Supports contains line subtotal and distinct agreement-period total structure.", "FACTUAL_FIELD", section("SCHEDULE_OF_SUPPORTS_RECONCILIATION"), "Schedule line total/subtotal and agreement-period total fields", [["subtotal"], ["estimated", "total"], ["agreement", "total"], ["total", "amount"]]),
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
  const authored = authoredDeliverableRequirements(contract);
  if (authored.length > 0) return authored;

  if (context.deliverable.requestedDeliverableType === "WORKFORCE_ONBOARDING_CHECKLIST") {
    return workforceOnboardingChecklistRequirements(context, contract);
  }

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

function authoredDeliverableRequirements(
  contract?: BlueprintExecutionContract | null,
): DeliverableRequirement[] {
  const source = contract?.blueprint.deliverableContract as Record<string, unknown> | null | undefined;
  const candidate = source?.requirementPlan ?? source?.requirements ?? source?.deliverableRequirements;
  if (!Array.isArray(candidate)) return [];

  return candidate
    .map((raw, index) => parseAuthoredRequirement(raw, index, contract))
    .filter((requirement): requirement is DeliverableRequirement => Boolean(requirement));
}

function parseAuthoredRequirement(raw: unknown, index: number, contract?: BlueprintExecutionContract | null): DeliverableRequirement | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = stringValue(record.id ?? record.requirementId ?? record.code) ?? `authored-${index + 1}`;
  const description = stringValue(record.requirementText ?? record.requirement ?? record.description ?? record.text);
  const representation = stringValue(
    record.targetLocation ??
      record.targetDeliverableLocation ??
      record.requiredDeliverableRepresentation ??
      record.finalDeliverableRepresentation,
  );
  if (!description || !representation) return null;
  const sectionCode = stringValue(record.sourceBlueprintSection ?? record.sectionCode);
  const blueprintSection = sectionCode
    ? contract?.sections.find((section) => section.sectionCode === sectionCode)
    : null;

  return req(
    id,
    description,
    parseRequirementClassification(record.classification),
    sectionCode,
    representation,
    parseCoverageRules(record.coverageRules),
    {
      origin: "AUTHORED",
      professionalRationale: stringValue(record.professionalRationale),
      evidenceAuthority: stringArray(record.evidenceAuthority ?? record.authority),
      adequacyCriteria: stringArray(record.adequacyCriteria),
      templateCriteria: deriveTemplateCriteriaForSection(blueprintSection),
      targetDeliverableLocation: representation,
      fixedContent: blueprintSection?.fixedContent ?? [],
      templateFields: blueprintSection?.fields ?? [],
      completionPrompt: blueprintSection?.completionPrompt ?? null,
    },
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter(Boolean);
}

function deriveTemplateCriteriaForSection(section?: BlueprintSection | null): string[] {
  if (!section) return [];
  const criteria: string[] = [];
  if ((section.fixedContent ?? []).length > 0) {
    criteria.push("All authored fixedContent paragraphs are emitted verbatim.");
  }
  if ((section.fields ?? []).length > 0) {
    criteria.push("All declared template fields are present and labelled.");
  }
  if (section.completionPrompt) {
    criteria.push("The authored completionPrompt is emitted verbatim as template guidance.");
  }
  for (const field of section.fields ?? []) {
    const normalised = field.toLowerCase();
    if (normalised.includes("table with columns")) {
      criteria.push(`Required table structure is present: ${field}.`);
    }
    if (normalised.includes("minimum three personal goal rows")) {
      criteria.push("The goals table includes at least three personal goal rows.");
    }
    if (normalised.includes("support types selected from")) {
      criteria.push("The support type list is present.");
    }
  }
  return criteria;
}

function parseRequirementClassification(value: unknown): DeliverableRequirementClassification {
  if (typeof value === "string" && COVERAGE_CLASSIFICATIONS.includes(value as DeliverableRequirementClassification)) {
    return value as DeliverableRequirementClassification;
  }
  return "MUST_BE_REPRESENTED";
}

function parseCoverageRules(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [[item.trim()]];
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const allOf = stringArray(record.allOf);
    if (allOf.length > 0) return [allOf];
    const anyOf = stringArray(record.anyOf);
    return anyOf.map((term) => [term]);
  });
}

function workforceOnboardingChecklistRequirements(
  context: ProfessionalExecutionContext,
  contract?: BlueprintExecutionContract | null,
): DeliverableRequirement[] {
  const section = (patterns: RegExp[]): string | undefined => {
    const match = (contract?.sections ?? []).find((candidate) => {
      const text = `${candidate.sectionCode} ${candidate.title} ${candidate.description} ${candidate.instructions}`.toLowerCase();
      return patterns.some((pattern) => pattern.test(text));
    });
    return match?.sectionCode;
  };

  const requirements: DeliverableRequirement[] = [
    req(
      "onboarding-staff-details-fields",
      "The checklist contains reusable staff onboarding identification fields for staff member, role, start date, manager/supervisor and employment type where applicable.",
      "FACTUAL_FIELD",
      section([/\bstaff\b|\bemployee\b|\bworker\b/, /\brole\b/, /\bmanager\b|\bsupervisor\b/]),
      "Onboarding intake fields for staff name, role, start date, manager/supervisor and employment type",
      [["staff name", "role", "start date", "manager"], ["employee name", "role", "commencement date", "supervisor"]],
    ),
    req(
      "onboarding-checklist-tracking-fields",
      "The checklist provides structured completion tracking for each onboarding item, including responsible owner, timing/due date, evidence or completion record and status/sign-off.",
      "FACTUAL_FIELD",
      section([/\bsign[- ]?off\b|\bcompletion\b|\bapproval\b|\brecord\b/]),
      "Checklist table columns for item/action, owner, timing/due date, evidence/completion record, status and sign-off",
      [["item", "owner", "due", "evidence", "status", "sign off"], ["action", "responsible", "timing", "completion", "status", "sign off"]],
    ),
    req(
      "onboarding-employment-documentation",
      "Pre-start employment documentation, role details and onboarding responsibilities are represented as concrete checklist items.",
      "MUST_BE_REPRESENTED",
      section([/\bemployment\b|\bpre[- ]?start\b|\bdocumentation\b|\bcontract\b/]),
      "Pre-start employment documentation checklist items",
      [["employment", "documentation"], ["contract", "role"], ["pre start", "responsib"]],
    ),
    req(
      "onboarding-screening-clearances-credentials",
      "Required screening, clearances, credentials and role prerequisites are represented as professional checklist items without inventing staff-specific results.",
      "MUST_BE_REPRESENTED",
      section([/\bscreening\b|\bclearance\b|\bcredential\b|\bqualification\b|\bprerequisite\b/]),
      "Screening, clearance, credential and prerequisite checklist items",
      [["screening", "clearance"], ["credential", "qualification"], ["prerequisite"]],
    ),
    req(
      "onboarding-access-equipment-systems",
      "System access, equipment, workplace access and operational handover requirements are represented as checklist items.",
      "MUST_BE_REPRESENTED",
      section([/\bsystem\b|\baccess\b|\bequipment\b|\bworkplace\b|\bhandover\b/]),
      "Systems, equipment, workplace access and handover checklist items",
      [["system", "access"], ["equipment"], ["handover"]],
    ),
    req(
      "onboarding-induction-training-learning",
      "Induction, mandatory learning, role-specific training and evidence of learning completion are represented as structured checklist items.",
      "MUST_BE_REPRESENTED",
      section([/\binduction\b|\btraining\b|\blearning\b|\bcapability\b/]),
      "Induction, mandatory learning and role-specific training checklist items",
      [["induction", "training"], ["learning", "completion"], ["role specific", "training"]],
    ),
    req(
      "onboarding-supervision-checkins-support",
      "Manager, buddy or supervisor support, early check-ins, feedback and escalation points are represented.",
      "MUST_BE_REPRESENTED",
      section([/\bsupervision\b|\bmanager\b|\bbuddy\b|\bcheck[- ]?in\b|\bfeedback\b|\bescalation\b/]),
      "Manager/supervisor check-ins, support and escalation checklist items",
      [["manager", "check"], ["supervisor", "feedback"], ["support", "escalation"]],
    ),
    req(
      "onboarding-policy-acknowledgement",
      "Relevant policy, procedure and code-of-conduct acknowledgements are represented as checklist items without using unresolved policy placeholders as the content.",
      "MUST_BE_REPRESENTED",
      section([/\bpolicy\b|\bprocedure\b|\bcode of conduct\b|\backnowledg/]),
      "Policy/procedure acknowledgement checklist items",
      [["policy", "acknowledg"], ["procedure", "acknowledg"], ["code", "conduct"]],
    ),
    req(
      "onboarding-ndis-workforce-orientation",
      "Where the organisation operates in an NDIS/disability-services context, the checklist includes configurable NDIS/workforce orientation and safe-practice onboarding items.",
      "CONDITIONAL",
      section([/\bndis\b|\bdisability\b|\bsafe practice\b|\bworker orientation\b/]),
      "Configurable NDIS/disability workforce orientation checklist section",
      [["ndis", "orientation"], ["disability", "safe"], ["worker", "orientation"]],
    ),
    req(
      "onboarding-final-review-signoff",
      "The checklist includes final review, completion sign-off and accountable approval/record-keeping controls.",
      "FACTUAL_FIELD",
      section([/\bfinal\b|\breview\b|\bsign[- ]?off\b|\bapproval\b|\brecord[- ]?keeping\b/]),
      "Final review and sign-off fields for staff member, manager/supervisor, date and completion status",
      [["staff", "manager", "date", "completion"], ["supervisor", "sign off", "date", "status"]],
    ),
  ];

  const blueprintDerived = (contract?.sections ?? [])
    .filter((section) => section.required)
    .filter(isChecklistRelevantBlueprintSection)
    .slice(0, 8)
    .map((section) =>
      req(
        `blueprint-${section.sectionCode.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        section.description || section.title,
        "CONDITIONAL",
        section.sectionCode,
        `Professionally appropriate onboarding checklist item(s) derived from ${section.title}`,
        [keywordCandidates(section.description || section.title).slice(0, 4)],
      ),
    );

  const existingIds = new Set(requirements.map((requirement) => requirement.id));
  return [
    ...requirements,
    ...blueprintDerived.filter((requirement) => !existingIds.has(requirement.id)),
  ];
}

function isChecklistRelevantBlueprintSection(section: BlueprintSection): boolean {
  const text = `${section.sectionCode} ${section.title} ${section.description} ${section.instructions}`.toLowerCase();
  return /\b(onboard|onboarding|induction|new starter|new staff|new employee|employee onboarding|staff onboarding|worker screening|screening clearance|clearance check|credential verification|qualification check|mandatory training|role[- ]specific training|learning pathway|policy acknowledgement|procedure acknowledgement|system access setup|equipment setup|onboarding checklist)\b/.test(text);
}

function req(
  id: string,
  description: string,
  classification: DeliverableRequirementClassification,
  sourceBlueprintSection: string | undefined,
  representation: string,
  allOfAlternatives: string[][],
  options: {
    origin?: DeliverableRequirement["origin"];
    professionalRationale?: string | null;
    evidenceAuthority?: string[];
    targetDeliverableLocation?: string;
    adequacyCriteria?: string[];
    templateCriteria?: string[];
    fixedContent?: string[];
    templateFields?: string[];
    completionPrompt?: string | null;
  } = {},
): DeliverableRequirement {
  return {
    id,
    description,
    classification,
    origin: options.origin ?? "DERIVED",
    sourceBlueprintSection,
    professionalRationale: options.professionalRationale ?? "Blueprint professional substance must be represented without exposing internal methodology.",
    evidenceAuthority: options.evidenceAuthority ?? [],
    requiredDeliverableRepresentation: representation,
    targetDeliverableLocation: options.targetDeliverableLocation,
    adequacyCriteria: options.adequacyCriteria ?? [],
    templateCriteria: options.templateCriteria ?? [],
    fixedContent: options.fixedContent ?? [],
    templateFields: options.templateFields ?? [],
    completionPrompt: options.completionPrompt ?? null,
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
  if (representation.includes("onboarding") || representation.includes("checklist")) return "Onboarding checklist table/sections";
  if (representation.includes("screening") || representation.includes("clearance") || representation.includes("credential")) return "Screening, clearances and prerequisites checklist section";
  if (representation.includes("induction") || representation.includes("training") || representation.includes("learning")) return "Induction, training and learning checklist section";
  if (representation.includes("manager") || representation.includes("supervisor") || representation.includes("sign-off") || representation.includes("sign off")) return "Supervision, check-in and sign-off checklist section";
  if (representation.includes("schedule")) return "Schedule of Supports table/fields";
  if (representation.includes("signature") || representation.includes("acceptance")) return "Execution/sign-off block";
  if (representation.includes("payment") || representation.includes("pricing")) return "Payment and pricing clauses";
  if (representation.includes("termination") || representation.includes("exit")) return "Termination and transition clauses";
  if (representation.includes("rights") || representation.includes("privacy") || representation.includes("complaints")) return "Rights, privacy, complaints and advocacy clauses";
  if (representation.includes("responsibilities")) return "Responsibilities clauses";
  return requirement.requiredDeliverableRepresentation;
}

function deriveFieldLabel(requirement: RequirementToDeliverablePlanItem): string {
  const representation = requirement.expectedUserFacingRepresentation
    .replace(/^Schedule column for\s+/i, "")
    .replace(/\s+field$/i, "")
    .replace(/\s+clause$/i, "")
    .trim();
  if (representation && representation.length <= 80) return titleCase(representation);
  return titleCase(requirement.requirementId.replace(/-/g, " "));
}

function inferRepresentationKind(item: RequirementToDeliverablePlanItem): DeliverableRepresentationKind {
  const text = normaliseContent(`${item.expectedUserFacingRepresentation} ${item.professionalRequirement} ${item.targetDeliverableLocation}`);
  if (/\bsignature\b|\bacceptance\b|\bsign off\b/.test(text)) return "signature_block";
  if (/\bagreement period total\b|\bestimated total\b|\bsubtotal\b|\btotal amount\b/.test(text)) return "calculation_total";
  if (/\btable\b|\bschedule\b|\bworksheet\b|\bspreadsheet\b/.test(text)) {
    return /\bcolumn\b|\bfield\b/.test(text) ? "table_column" : "table";
  }
  if (item.classification === "FACTUAL_FIELD") return "field";
  if (item.classification === "CONDITIONAL") return "conditional_section";
  return "clause";
}

function inferSchemaGroupKey(field: Pick<DeliverableOutputSchemaField, "targetSection" | "requiredRepresentation" | "requirementId" | "representationKind">): string {
  const text = normaliseContent(`${field.targetSection} ${field.requiredRepresentation} ${field.requirementId}`);
  if (field.requirementId === "onboarding-staff-details-fields" || field.requirementId === "onboarding-checklist-tracking-fields") return "onboarding-intake-and-tracking";
  if (field.requirementId === "onboarding-final-review-signoff") return "supervision-checkins-and-signoff";
  if (/\bpre start\b|\bemployment documentation\b|\bcontract\b|\brole details\b/.test(text)) return "pre-start-employment-documentation";
  if (/\bscreening\b|\bclearance\b|\bcredential\b|\bqualification\b|\bprerequisite\b/.test(text)) return "screening-clearances-and-prerequisites";
  if (/\bsystem\b|\baccess\b|\bequipment\b|\bworkplace\b|\bhandover\b/.test(text)) return "systems-equipment-and-handover";
  if (/\binduction\b|\btraining\b|\blearning\b|\bcapability\b/.test(text)) return "induction-training-and-learning";
  if (/\bmanager\b|\bsupervisor\b|\bbuddy\b|\bcheck in\b|\bfeedback\b|\bescalation\b|\bsign off\b/.test(text)) return "supervision-checkins-and-signoff";
  if (/\bpolicy\b|\bprocedure\b|\bcode of conduct\b|\backnowledg/.test(text)) return "policy-procedure-acknowledgement";
  if (/\bndis\b|\bdisability\b|\bsafe practice\b|\bworker orientation\b/.test(text)) return "ndis-workforce-orientation";
  if (/\bonboarding\b|\bstaff details\b|\bemployee details\b|\bstart date\b|\bemployment type\b|\bchecklist tracking\b/.test(text)) return "onboarding-intake-and-tracking";
  if (/\bschedule\b|\bsupport item\b|\bunit price\b|\bquantity\b|\bfrequency\b|\bservice period\b|\bsubtotal\b|\bagreement period total\b/.test(text)) return "support-schedule-and-pricing";
  if (/\bprovider responsib|\bparticipant responsib|\brepresentative responsib|\bdelivery obligation|\boperational responsib/.test(text)) return "responsibilities-and-delivery";
  if (/\bparties\b|\bprovider details\b|\bparticipant details\b|\brepresentative\b|\bagreement period\b/.test(text)) return "parties-and-agreement-details";
  if (/\bright|\bprivacy|\bconfidential|\bcomplaint|\bdispute|\badvocacy/.test(text)) return "rights-privacy-complaints";
  if (/\bpayment|\bpricing|\bgst|\bnon ndis|\bprice change|\badjustment/.test(text)) return "payment-pricing-and-adjustments";
  if (/\bcancellation|\bno show|\breschedul|\bnotice/.test(text)) return "cancellation-and-no-show";
  if (/\bvariation|\bamendment|\bchange|\bconsent/.test(text)) return "variation-amendment-and-review";
  if (/\btermination|\bexit|\btransition/.test(text)) return "termination-exit-and-transition";
  if (/\bcontinuity|\bemergency|\bdisaster/.test(text)) return "continuity-emergency-and-disaster";
  if (/\bsignature|\bacceptance|\bsign off/.test(text)) return "signatures-and-acceptance";
  return normaliseContent(field.targetSection || field.requiredRepresentation || field.requirementId)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || field.requirementId;
}

function inferGroupTitle(groupKey: string, field: DeliverableOutputSchemaField): string {
  const titles: Record<string, string> = {
    "onboarding-intake-and-tracking": "Onboarding Details and Checklist Tracking",
    "pre-start-employment-documentation": "Pre-Start Employment Documentation",
    "screening-clearances-and-prerequisites": "Screening, Clearances and Prerequisites",
    "systems-equipment-and-handover": "Systems, Equipment, Workplace Access and Handover",
    "induction-training-and-learning": "Induction, Training and Learning",
    "supervision-checkins-and-signoff": "Supervision, Check-ins and Sign-off",
    "policy-procedure-acknowledgement": "Policy, Procedure and Conduct Acknowledgements",
    "ndis-workforce-orientation": "NDIS and Disability Workforce Orientation",
    "support-schedule-and-pricing": "Schedule of Supports and Pricing Structure",
    "parties-and-agreement-details": "Parties and Agreement Details",
    "responsibilities-and-delivery": "Delivery, Provider and Participant Responsibilities",
    "rights-privacy-complaints": "Rights, Privacy, Complaints, Disputes and Advocacy",
    "payment-pricing-and-adjustments": "Payment, Pricing, GST and Adjustments",
    "cancellation-and-no-show": "Cancellation, No-Show and Rescheduling",
    "variation-amendment-and-review": "Variation, Amendment and Agreement Review",
    "termination-exit-and-transition": "Termination, Exit and Transition",
    "continuity-emergency-and-disaster": "Continuity, Emergency and Disaster Arrangements",
    "signatures-and-acceptance": "Signatures and Acceptance",
  };
  return titles[groupKey] ?? field.targetSection;
}

function inferGroupSectionType(fields: DeliverableOutputSchemaField[]): DeliverableRepresentationKind {
  if (fields.some((field) => field.representationKind === "table" || field.representationKind === "table_column")) return "table";
  if (fields.some((field) => field.representationKind === "signature_block")) return "signature_block";
  if (fields.some((field) => field.representationKind === "calculation_total")) return "calculation_total";
  if (fields.every((field) => field.representationKind === "field")) return "field";
  if (fields.some((field) => field.representationKind === "conditional_section")) return "conditional_section";
  return "clause";
}

function buildGroupGenerationInstruction(targetSection: string, fields: DeliverableOutputSchemaField[]): string {
  const ids = fields.map((field) => `${field.requirementId} [${field.classification}/${field.representationKind}]`).join(", ");
  const substance = Array.from(new Set(fields.flatMap((field) => field.minimumSubstance))).join("; ");
  return `Draft ${targetSection} so it explicitly satisfies: ${ids}. Minimum professional substance: ${substance || "clear reusable professional wording plus any required fields."}`;
}

function deriveMinimumSubstance(item: RequirementToDeliverablePlanItem): string[] {
  const text = normaliseContent(`${item.requirementId} ${item.professionalRequirement} ${item.expectedUserFacingRepresentation}`);
  if (item.classification === "FACTUAL_FIELD") {
    if (/\bonboarding|checklist|staff|employee|owner|due|status|sign off|completion/.test(text)) return ["provide a checklist table or labelled fields for owner, timing, evidence/completion status and sign-off", "leave unknown staff-specific values as fillable fields, not invented facts"];
    if (/\btotal\b/.test(text)) return ["provide distinct line subtotal and agreement-period or estimated total structures", "leave unknown values as fillable fields, not invented numbers"];
    if (/\bsignature\b|\bacceptance\b/.test(text)) return ["provide provider, participant and representative signature/date fields where applicable", "state that signing records acceptance of the agreement terms"];
    return ["provide a labelled fillable field, table column or equivalent structured input location", "do not rely on prose mentions alone"];
  }
  if (/\bprovider responsib/.test(text)) return ["state provider delivery, safety, privacy, records, billing, complaints, continuity and escalation obligations"];
  if (/\bparticipant responsib|\brepresentative responsib/.test(text)) return ["state participant/representative communication, attendance, information, payment or plan-management cooperation without transferring provider obligations"];
  if (/\bright|\bprivacy|\bcomplaint|\badvocacy|\bdispute/.test(text)) return ["include rights, privacy/confidentiality, complaint/dispute pathway, escalation and advocacy support"];
  if (/\bpayment|\bpricing|\bgst|\bprice change|\badjustment/.test(text)) return ["explain pricing source, payment process, GST/non-NDIS cost treatment, price changes and current-pricing qualification"];
  if (/\bcancellation|\bno show|\breschedul|\bnotice/.test(text)) return ["cover cancellation notice, no-show treatment, rescheduling and communication responsibilities"];
  if (/\bvariation|\bamendment|\bchange|\bconsent/.test(text)) return ["cover documented variations, notification, consent/signature control and review triggers"];
  if (/\btermination|\bexit|\btransition/.test(text)) return ["cover notice, final obligations, participant choice and transition support"];
  if (/\bcontinuity|\bemergency|\bdisaster/.test(text)) return ["provide a configurable continuity/emergency/disaster section with communication and safe support-continuity expectations"];
  if (/\bdelivery\b|\bsupport\b/.test(text)) return ["describe support delivery obligations, operational boundaries and escalation where delivery cannot occur"];
  if (/\bonboarding|pre start|employment documentation/.test(text)) return ["include concrete pre-start checklist actions, responsible owner and completion evidence expectations"];
  if (/\bscreening|clearance|credential|qualification|prerequisite/.test(text)) return ["include verification items for screening, clearances, credentials and role prerequisites without inventing results"];
  if (/\bsystem|access|equipment|workplace|handover/.test(text)) return ["include access, equipment, workspace and operational handover actions with owner and completion record"];
  if (/\binduction|training|learning|capability/.test(text)) return ["include mandatory induction, role-specific learning and evidence-of-completion checklist items"];
  if (/\bmanager|supervisor|buddy|check in|feedback|escalation/.test(text)) return ["include early check-ins, support/escalation pathways and accountable manager/supervisor sign-off"];
  if (/\bpolicy|procedure|code of conduct|acknowledg/.test(text)) return ["include policy/procedure acknowledgement items as actual checklist actions, not unresolved policy placeholders"];
  if (/\bndis|disability|safe practice|worker orientation/.test(text)) return ["include configurable NDIS/disability workforce orientation items where relevant to the provider context"];
  return ["draft substantive reusable clause wording that materially addresses the requirement", "avoid heading-only, keyword-only or self-assertion coverage"];
}

interface MarkdownSection {
  title: string;
  normalisedTitle: string;
  content: string;
  startLine: number;
}

interface MarkdownTable {
  sectionTitle: string | null;
  headers: string[];
  normalisedHeaders: string[];
  startLine: number;
}

interface MarkdownStructure {
  sections: MarkdownSection[];
  tables: MarkdownTable[];
  labelledLines: Array<{ label: string; normalisedLabel: string; line: number }>;
}

function validateRequirementAgainstContent(input: {
  requirement: DeliverableRequirement;
  standardisation: DeliverableRequirementCoverageProfile["standardisation"];
  normalisedContent: string;
  structure: MarkdownStructure;
  schema: DeliverableOutputSchema;
  structuredSection: PerRequirementDeliverableSection | null;
  structuredSectionsProvided: boolean;
}): DeliverableRequirementCoverageItem {
  const { requirement } = input;
  if (input.structuredSectionsProvided && !input.structuredSection && isBlockingRequirement(requirement.classification)) {
    return coverageItem(requirement, {
      actualLocation: null,
      structuralResult: "STRUCTURE_FAIL",
      substantiveResult: requirement.classification === "FACTUAL_FIELD" ? "NOT_APPLICABLE" : "SUBSTANTIVE_FAIL",
      finalResult: "NOT_SATISFIED",
      failureReason: `deliverable.sections is missing an entry for required requirementId "${requirement.id}".`,
    });
  }
  if (requirement.classification === "FACTUAL_FIELD") {
    return validateFactualFieldRequirement(input);
  }
  if (requirement.classification === "MUST_BE_REPRESENTED" || requirement.classification === "CONDITIONAL") {
    return validateRepresentedRequirement(input);
  }

  return coverageItem(requirement, {
    actualLocation: null,
    structuralResult: "NOT_APPLICABLE",
    substantiveResult: "NOT_APPLICABLE",
    finalResult: "NOT_APPLICABLE",
    failureReason: null,
  });
}

function validateFactualFieldRequirement(input: {
  requirement: DeliverableRequirement;
  standardisation?: DeliverableRequirementCoverageProfile["standardisation"];
  normalisedContent: string;
  structure: MarkdownStructure;
  schema: DeliverableOutputSchema;
  structuredSection: PerRequirementDeliverableSection | null;
  structuredSectionsProvided: boolean;
}): DeliverableRequirementCoverageItem {
  const { requirement, schema } = input;
  const structure = input.structuredSection
    ? parseMarkdownStructure(`## ${input.structuredSection.heading}\n\n${input.structuredSection.content}`)
    : input.structure;
  const schemaField = findSchemaField(schema, requirement.id);
  const expected = requirement.requiredDeliverableRepresentation;

  if (requirement.id === "service-agreement-parties") {
    const labels = ["provider", "participant", "representative authority", "agreement period"];
    const missing = labels.filter((label) => !hasLabelledField(structure, label));
    return coverageItem(requirement, missing.length === 0
      ? {
          actualLocation: `labelled fields: ${labels.join(", ")}`,
          structuralResult: "STRUCTURE_PASS",
          substantiveResult: "NOT_APPLICABLE",
          finalResult: "SATISFIED",
          failureReason: null,
        }
      : {
          actualLocation: null,
          structuralResult: missing.length < labels.length ? "STRUCTURE_PARTIAL" : "STRUCTURE_FAIL",
          substantiveResult: "NOT_APPLICABLE",
          finalResult: missing.length < labels.length ? "PARTIAL" : "NOT_SATISFIED",
          failureReason: `Missing structured agreement party field(s): ${missing.join(", ")}.`,
        });
  }

  if (requirement.id === "support-total-field") {
    const table = findScheduleTable(structure);
    const lineTotal = table ? table.normalisedHeaders.some((header) =>
      /\b(subtotal|line total|line item total|item total)\b/.test(header),
    ) : false;
    const agreementTotal = table ? table.normalisedHeaders.some((header) =>
      /\b(agreement period total|agreement total|estimated total cost|total estimated cost|total amount)\b/.test(header),
    ) : false;
    if (lineTotal && agreementTotal && table) {
      return coverageItem(requirement, {
        actualLocation: tableLocation(table, "line total/subtotal + agreement-period total"),
        structuralResult: "STRUCTURE_PASS",
        substantiveResult: "NOT_APPLICABLE",
        finalResult: "SATISFIED",
        failureReason: null,
      });
    }
    return coverageItem(requirement, {
      actualLocation: table ? tableLocation(table, "partial total fields") : null,
      structuralResult: lineTotal || agreementTotal ? "STRUCTURE_PARTIAL" : "STRUCTURE_FAIL",
      substantiveResult: "NOT_APPLICABLE",
      finalResult: lineTotal || agreementTotal ? "PARTIAL" : "NOT_SATISFIED",
      failureReason: "Schedule total structure must distinguish line subtotal from agreement-period or estimated agreement total.",
    });
  }

  if (requirement.id === "onboarding-staff-details-fields") {
    const groups = [
      ["staff", "employee"],
      ["role", "position"],
      ["start", "commencement"],
      ["manager", "supervisor"],
    ];
    return validateStructuredFieldGroups(requirement, structure, groups, "staff onboarding details");
  }

  if (requirement.id === "onboarding-checklist-tracking-fields") {
    const groups = [
      ["item", "action", "task"],
      ["owner", "responsible"],
      ["due", "timing", "date"],
      ["evidence", "completion", "record"],
      ["status"],
      ["sign off", "signoff", "approval"],
    ];
    return validateStructuredFieldGroups(requirement, structure, groups, "checklist tracking");
  }

  if (requirement.id === "onboarding-final-review-signoff") {
    const groups = [
      ["staff", "employee"],
      ["manager", "supervisor"],
      ["date"],
      ["completion", "status", "sign off", "signoff"],
    ];
    return validateStructuredFieldGroups(requirement, structure, groups, "final review/sign-off");
  }

  if (isTableOrColumnRequirement(requirement)) {
    const table = expected.toLowerCase().includes("schedule")
      ? findScheduleTable(structure)
      : isPluralColumnRequirement(requirement)
        ? structure.tables[0] ?? null
      : findTableWithHeader(structure, requirement);
    if (table && isPluralColumnRequirement(requirement)) {
      const missing = requiredColumnTerms(requirement).filter((term) =>
        !table.normalisedHeaders.some((header) => header.includes(normaliseContent(term))),
      );
      return coverageItem(requirement, missing.length === 0
        ? {
            actualLocation: tableLocation(table, `columns: ${table.headers.join(", ")}`),
            structuralResult: "STRUCTURE_PASS",
            substantiveResult: "NOT_APPLICABLE",
            finalResult: "SATISFIED",
            failureReason: null,
          }
        : {
            actualLocation: tableLocation(table, `missing columns: ${missing.join(", ")}`),
            structuralResult: missing.length < requiredColumnTerms(requirement).length ? "STRUCTURE_PARTIAL" : "STRUCTURE_FAIL",
            substantiveResult: "NOT_APPLICABLE",
            finalResult: missing.length < requiredColumnTerms(requirement).length ? "PARTIAL" : "NOT_SATISFIED",
            failureReason: `Required structured column(s) are missing: ${missing.join(", ")}.`,
          });
    }
    const header = table ? findMatchingHeader(table, requirement, schemaField?.fieldLabel) : null;
    if (table && header) {
      return coverageItem(requirement, {
        actualLocation: tableLocation(table, header),
        structuralResult: "STRUCTURE_PASS",
        substantiveResult: "NOT_APPLICABLE",
        finalResult: "SATISFIED",
        failureReason: null,
      });
    }
    return coverageItem(requirement, {
      actualLocation: table ? tableLocation(table, "table present, required column missing") : null,
      structuralResult: table ? "STRUCTURE_PARTIAL" : "STRUCTURE_FAIL",
      substantiveResult: "NOT_APPLICABLE",
      finalResult: table ? "PARTIAL" : "NOT_SATISFIED",
      failureReason: table
        ? `Required structured column is missing from the target table: ${schemaField?.fieldLabel ?? expected}.`
        : `Required target table or structured field is missing: ${expected}.`,
    });
  }

  const label = findLabelledField(structure, requirement, schemaField?.fieldLabel);
  if (label) {
    return coverageItem(requirement, {
      actualLocation: `label "${label.label}" on line ${label.line}`,
      structuralResult: "STRUCTURE_PASS",
      substantiveResult: "NOT_APPLICABLE",
      finalResult: "SATISFIED",
      failureReason: null,
    });
  }

  return coverageItem(requirement, {
    actualLocation: null,
    structuralResult: "STRUCTURE_FAIL",
    substantiveResult: "NOT_APPLICABLE",
    finalResult: "NOT_SATISFIED",
    failureReason: `Required factual field is not present as a table column, labelled field or equivalent structure: ${expected}.`,
  });
}

function validateStructuredFieldGroups(
  requirement: DeliverableRequirement,
  structure: MarkdownStructure,
  groups: string[][],
  label: string,
): DeliverableRequirementCoverageItem {
  const table = structure.tables.find((candidate) =>
    groups.filter((group) => candidate.normalisedHeaders.some((header) =>
      group.some((term) => header.includes(normaliseContent(term))),
    )).length >= Math.min(groups.length, 4),
  ) ?? null;
  const hasInLabels = (group: string[]) => structure.labelledLines.some((line) =>
    group.some((term) => line.normalisedLabel.includes(normaliseContent(term))),
  );
  const missing = groups.filter((group) => {
    const inTable = table?.normalisedHeaders.some((header) =>
      group.some((term) => header.includes(normaliseContent(term))),
    ) ?? false;
    return !inTable && !hasInLabels(group);
  });

  if (missing.length === 0) {
    return coverageItem(requirement, {
      actualLocation: table
        ? tableLocation(table, `${label} structured fields`)
        : `labelled fields for ${label}`,
      structuralResult: "STRUCTURE_PASS",
      substantiveResult: "NOT_APPLICABLE",
      finalResult: "SATISFIED",
      failureReason: null,
    });
  }

  return coverageItem(requirement, {
    actualLocation: table ? tableLocation(table, `${label} partial fields`) : null,
    structuralResult: missing.length < groups.length ? "STRUCTURE_PARTIAL" : "STRUCTURE_FAIL",
    substantiveResult: "NOT_APPLICABLE",
    finalResult: missing.length < groups.length ? "PARTIAL" : "NOT_SATISFIED",
    failureReason: `Required ${label} structured field group(s) are missing: ${missing.map((group) => group.join("/")).join(", ")}.`,
  });
}

function validateRepresentedRequirement(input: {
  requirement: DeliverableRequirement;
  standardisation?: DeliverableRequirementCoverageProfile["standardisation"];
  normalisedContent: string;
  structure: MarkdownStructure;
  schema: DeliverableOutputSchema;
  structuredSection: PerRequirementDeliverableSection | null;
  structuredSectionsProvided: boolean;
}): DeliverableRequirementCoverageItem {
  const { requirement } = input;
  const structure = input.structuredSection
    ? parseMarkdownStructure(`## ${input.structuredSection.heading}\n\n${input.structuredSection.content}`)
    : input.structure;
  const normalisedContent = input.structuredSection
    ? normaliseContent(input.structuredSection.content)
    : input.normalisedContent;
  if (requirement.id === "support-schedule-table") {
    const table = findScheduleTable(structure);
    return coverageItem(requirement, table
      ? {
          actualLocation: tableLocation(table, "Schedule of Supports"),
          structuralResult: "STRUCTURE_PASS",
          substantiveResult: "SUBSTANTIVE_PASS",
          finalResult: "SATISFIED",
          failureReason: null,
        }
      : {
          actualLocation: null,
          structuralResult: "STRUCTURE_FAIL",
          substantiveResult: "SUBSTANTIVE_FAIL",
          finalResult: "NOT_SATISFIED",
          failureReason: "Schedule of Supports is not present as a table or equivalent structured schedule.",
        });
  }

  const relevant = input.structuredSection
    ? {
        content: input.structuredSection.content,
        location: `deliverable.sections[${input.structuredSection.requirementId}] "${input.structuredSection.heading}"`,
      }
    : findRelevantSectionContent(structure, requirement);
  const hasAuthoredAdequacyCriteria = (requirement.adequacyCriteria ?? []).length > 0;
  const keywordMatch = hasAuthoredAdequacyCriteria
    ? true
    : requirement.coverageRules.length > 0
    ? requirement.coverageRules.some((rule) => coverageRuleMatches(normalisedContent, rule))
    : coverageRuleMatches(normalisedContent, { allOf: keywordCandidates(requirement.description) });
  if (!relevant) {
    return coverageItem(requirement, {
      actualLocation: null,
      structuralResult: "STRUCTURE_FAIL",
      substantiveResult: "SUBSTANTIVE_FAIL",
      finalResult: "NOT_SATISFIED",
      failureReason: "No relevant user-facing section or representation was found for the requirement.",
    });
  }

  const substantive = evaluateSubstantiveClauseContent(requirement, relevant.content);
  if (input.standardisation === "standard_reusable" && (requirement.templateCriteria ?? []).length > 0) {
    const template = evaluateTemplateRequirementContent(requirement, relevant.content);
    const finalResult = template.passed
      ? "SATISFIED"
      : template.partial
        ? "PARTIAL"
        : "NOT_SATISFIED";

    return coverageItem(requirement, {
      actualLocation: relevant.location,
      structuralResult: "STRUCTURE_PASS",
      substantiveResult: template.passed
        ? "SUBSTANTIVE_PASS"
        : template.partial
          ? "SUBSTANTIVE_PARTIAL"
          : "SUBSTANTIVE_FAIL",
      substantiveValidationMode: "TEMPLATE_CRITERIA",
      substantiveBreakdown: substantive.breakdown,
      finalResult,
      failureReason: finalResult === "SATISFIED"
        ? null
        : template.reason,
    });
  }

  const finalResult = substantive.passed && keywordMatch
    ? "SATISFIED"
    : substantive.partial || keywordMatch
      ? "PARTIAL"
      : "NOT_SATISFIED";

  return coverageItem(requirement, {
    actualLocation: relevant.location,
    structuralResult: "STRUCTURE_PASS",
    substantiveResult: substantive.passed
      ? "SUBSTANTIVE_PASS"
      : substantive.partial
        ? "SUBSTANTIVE_PARTIAL"
        : "SUBSTANTIVE_FAIL",
    substantiveValidationMode: substantive.mode,
    substantiveBreakdown: substantive.breakdown,
    finalResult,
    failureReason: finalResult === "SATISFIED"
      ? null
      : substantive.reason ?? "Relevant section exists but does not materially address the professional requirement.",
  });
}

function coverageItem(
  requirement: DeliverableRequirement,
  result: Omit<DeliverableRequirementCoverageItem, "requirementId" | "requirement" | "classification" | "origin" | "sourceBlueprintSection" | "expectedRepresentation" | "adequacyCriteria" | "substantiveValidationMode"> & {
    substantiveValidationMode?: RequirementSubstantiveValidationMode;
  },
): DeliverableRequirementCoverageItem {
  return {
    requirementId: requirement.id,
    requirement: requirement.description,
    classification: requirement.classification,
    origin: requirement.origin ?? "DERIVED",
    sourceBlueprintSection: requirement.sourceBlueprintSection,
    expectedRepresentation: requirement.requiredDeliverableRepresentation,
    adequacyCriteria: requirement.adequacyCriteria ?? [],
    templateCriteria: requirement.templateCriteria ?? [],
    substantiveValidationMode: result.substantiveValidationMode ?? (
      result.substantiveResult === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : "FALLBACK_HEURISTIC"
    ),
    ...result,
  };
}

function parseMarkdownStructure(markdown: string): MarkdownStructure {
  const lines = markdown.split(/\r?\n/);
  const sections: MarkdownSection[] = [];
  const tables: MarkdownTable[] = [];
  const labelledLines: MarkdownStructure["labelledLines"] = [];
  let current: MarkdownSection = {
    title: "Document",
    normalisedTitle: "document",
    content: "",
    startLine: 1,
  };

  const commitSection = () => {
    if (current.content.trim() || current.title !== "Document") {
      sections.push({ ...current, content: current.content.trim() });
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      commitSection();
      current = {
        title: heading[2]!.trim(),
        normalisedTitle: normaliseContent(heading[2]!.trim()),
        content: "",
        startLine: index + 1,
      };
      continue;
    }

    current.content += `${line}\n`;

    if (line.includes("|") && !isMarkdownSeparatorLine(line)) {
      const nextNonBlank = lines.slice(index + 1, index + 4).find((candidate) => candidate.trim().length > 0) ?? "";
      const headers = parseTableCells(line);
      const hasSeparator = isMarkdownSeparatorLine(nextNonBlank);
      if (headers.length > 1 && (hasSeparator || looksLikeSchemaHeader(headers))) {
        tables.push({
          sectionTitle: current.title === "Document" ? null : current.title,
          headers,
          normalisedHeaders: headers.map(normaliseContent),
          startLine: index + 1,
        });
      }
    }

    const labelMatch = /^\s*(?:[-*]\s*)?([A-Za-z][A-Za-z0-9 /&()_-]{1,80})\s*[:[]/.exec(line);
    if (labelMatch) {
      const label = labelMatch[1]!.trim();
      labelledLines.push({ label, normalisedLabel: normaliseContent(label), line: index + 1 });
    }
    for (const match of line.matchAll(/(?:^|[.|]\s+|\s{2,})([A-Za-z][A-Za-z0-9 /&()_-]{1,80})\s*:/g)) {
      const label = match[1]?.trim();
      if (!label) continue;
      const normalisedLabel = normaliseContent(label);
      if (labelledLines.some((existing) => existing.line === index + 1 && existing.normalisedLabel === normalisedLabel)) continue;
      labelledLines.push({ label, normalisedLabel, line: index + 1 });
    }
  }
  commitSection();
  return { sections, tables, labelledLines };
}

function isMarkdownSeparatorLine(line: string): boolean {
  return /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(line);
}

function looksLikeSchemaHeader(headers: string[]): boolean {
  if (headers.length < 2) return false;
  return headers.some((header) => /\b(id|code|name|description|unit|price|rate|quantity|frequency|period|total|status|rating|date|owner|action)\b/i.test(header));
}

function parseTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function findScheduleTable(structure: MarkdownStructure): MarkdownTable | null {
  const scheduleTables = structure.tables
    .map((table) => ({
      table,
      score: [
        table.sectionTitle && /schedule.*support|support.*schedule/i.test(table.sectionTitle) ? 4 : 0,
        table.normalisedHeaders.some((header) => /\bsupport\b/.test(header)) ? 2 : 0,
        table.normalisedHeaders.some((header) => /\bitem\b|\bcode\b/.test(header)) ? 2 : 0,
        table.normalisedHeaders.some((header) => /\bquantity\b|\bfrequency\b|\bhours\b|\bweeks\b/.test(header)) ? 2 : 0,
        table.normalisedHeaders.some((header) => /\bunit\b|\bprice\b|\brate\b/.test(header)) ? 2 : 0,
      ].reduce((sum, value) => sum + value, 0),
    }))
    .sort((a, b) => b.score - a.score);
  return scheduleTables[0]?.score && scheduleTables[0].score >= 4 ? scheduleTables[0].table : null;
}

function findTableWithHeader(structure: MarkdownStructure, requirement: DeliverableRequirement): MarkdownTable | null {
  return structure.tables.find((table) => !!findMatchingHeader(table, requirement)) ?? null;
}

function findMatchingHeader(
  table: MarkdownTable,
  requirement: DeliverableRequirement,
  fieldLabel?: string,
): string | null {
  const preferred = preferredHeaderRules(requirement.id);
  if (preferred.length > 0) {
    for (let index = 0; index < table.normalisedHeaders.length; index += 1) {
      const header = table.normalisedHeaders[index]!;
      if (preferred.some((rule) => ruleTermsMatchSameStructure(header, { allOf: rule }))) {
        return table.headers[index]!;
      }
    }
    return null;
  }

  const candidates = [
    ...(fieldLabel ? [fieldLabel] : []),
    ...requirement.coverageRules.flatMap((rule) => [rule.allOf?.join(" "), ...(rule.anyOf ?? [])].filter((value): value is string => Boolean(value))),
    requirement.requiredDeliverableRepresentation.replace(/^Schedule column for\s+/i, ""),
  ].map(normaliseContent).filter(Boolean);

  for (let index = 0; index < table.normalisedHeaders.length; index += 1) {
    const header = table.normalisedHeaders[index]!;
    if (candidates.some((candidate) => header.includes(candidate) || candidate.includes(header))) {
      return table.headers[index]!;
    }
    if (requirement.coverageRules.some((rule) => ruleTermsMatchSameStructure(header, rule))) {
      return table.headers[index]!;
    }
  }
  return null;
}

function preferredHeaderRules(requirementId: string): string[][] {
  const rules: Record<string, string[][]> = {
    "support-item-code-field": [["support", "item", "code"], ["ndis", "code"], ["item", "code"]],
    "support-description-field": [["description"]],
    "support-unit-basis-field": [["unit", "basis"], ["unit"], ["basis"]],
    "support-quantity-frequency-field": [["quantity", "frequency"], ["quantity"], ["frequency"], ["hours"], ["weeks"]],
    "support-unit-price-field": [["unit", "price"], ["unit", "rate"], ["price"], ["rate"]],
    "support-service-period-field": [["service", "period"]],
  };
  return rules[requirementId] ?? [];
}

function findSchemaField(schema: DeliverableOutputSchema, requirementId: string): DeliverableOutputSchemaField | null {
  for (const group of schema.groups) {
    const field = group.fields.find((candidate) => candidate.requirementId === requirementId);
    if (field) return field;
  }
  return null;
}

function isTableOrColumnRequirement(requirement: DeliverableRequirement): boolean {
  const representation = requirement.requiredDeliverableRepresentation.toLowerCase();
  return /\b(table|column|worksheet|spreadsheet|schedule)\b/.test(representation);
}

function isPluralColumnRequirement(requirement: DeliverableRequirement): boolean {
  return /\b(columns|fields)\b/i.test(requirement.requiredDeliverableRepresentation)
    && requiredColumnTerms(requirement).length > 1;
}

function requiredColumnTerms(requirement: DeliverableRequirement): string[] {
  const ruleTerms = requirement.coverageRules.flatMap((rule) => rule.allOf ?? []);
  if (ruleTerms.length > 1) return ruleTerms;
  return keywordCandidates(requirement.description);
}

function hasLabelledField(structure: MarkdownStructure, label: string): boolean {
  const normalisedLabel = normaliseContent(label);
  return structure.labelledLines.some((line) =>
    line.normalisedLabel.includes(normalisedLabel) || normalisedLabel.includes(line.normalisedLabel),
  );
}

function findLabelledField(
  structure: MarkdownStructure,
  requirement: DeliverableRequirement,
  fieldLabel?: string,
): MarkdownStructure["labelledLines"][number] | null {
  const candidates = [
    fieldLabel,
    requirement.requiredDeliverableRepresentation.replace(/\b(field|block|column|worksheet|schedule)\b/gi, ""),
    ...requirement.coverageRules.flatMap((rule) => [rule.allOf?.join(" "), ...(rule.anyOf ?? [])]),
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map(normaliseContent);

  return structure.labelledLines.find((line) =>
    candidates.some((candidate) => line.normalisedLabel.includes(candidate) || candidate.includes(line.normalisedLabel)),
  ) ?? null;
}

function tableLocation(table: MarkdownTable, detail: string): string {
  return `${table.sectionTitle ?? "table"} line ${table.startLine}: ${detail}`;
}

function findRelevantSectionContent(
  structure: MarkdownStructure,
  requirement: DeliverableRequirement,
): { content: string; location: string } | null {
  const candidates = [
    requirement.requiredDeliverableRepresentation,
    requirement.description,
    ...requirement.coverageRules.flatMap((rule) => [...(rule.allOf ?? []), ...(rule.anyOf ?? [])]),
  ].flatMap((value) => keywordCandidates(value).concat([normaliseContent(value)]))
    .map(normaliseContent)
    .filter((value) => value.length > 0);

  const scored = structure.sections
    .map((section) => {
      const normalisedBody = normaliseContent(section.content);
      const titleScore = candidates.filter((candidate) =>
        section.normalisedTitle.includes(candidate) || candidate.includes(section.normalisedTitle),
      ).length * 5;
      const bodyScore = candidates.filter((candidate) => normalisedBody.includes(candidate)).length;
      return { section, score: titleScore + bodyScore };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = scored[0]?.section;
  if (!best) return null;
  return {
    content: best.content,
    location: `${best.title} section line ${best.startLine}`,
  };
}

function evaluateSubstantiveClauseContent(
  requirement: DeliverableRequirement,
  content: string,
): {
  passed: boolean;
  partial: boolean;
  reason: string | null;
  mode: RequirementSubstantiveValidationMode;
  breakdown: DeliverableSubstantiveBreakdown;
} {
  const breakdown = analyseSubstantiveCoverageContent(content, requirement);
  const cleaned = breakdown.countedContent;
  const normalised = normaliseContent(cleaned);

  const adequacyCriteria = requirement.adequacyCriteria ?? [];
  if (requirement.classification === "CONDITIONAL" && explicitlyStatesNonApplicabilityWithSource(cleaned)) {
    return { passed: true, partial: false, reason: null, mode: "ADEQUACY_CRITERIA", breakdown };
  }
  if (adequacyCriteria.length > 0) {
    const criteriaResults = adequacyCriteria.map((criterion) => ({
      criterion,
      passed: adequacyCriterionMatchesContent(criterion, normalised),
    }));
    const missing = criteriaResults.filter((result) => !result.passed).map((result) => result.criterion);
    if (missing.length === 0) {
      return { passed: true, partial: false, reason: null, mode: "ADEQUACY_CRITERIA", breakdown };
    }
    return {
      passed: false,
      partial: missing.length < criteriaResults.length,
      reason: `Relevant section does not satisfy authored adequacy criteria: ${missing.join("; ")}.`,
      mode: "ADEQUACY_CRITERIA",
      breakdown,
    };
  }

  const words = normaliseContent(cleaned).split(/\s+/).filter(Boolean);
  if (words.length < 18) {
    return {
      passed: false,
      partial: words.length >= 8,
      reason: "Relevant section is too thin to prove substantive professional coverage.",
      mode: "FALLBACK_HEURISTIC",
      breakdown,
    };
  }

  const operativeCount = [
    "must",
    "will",
    "may",
    "responsible",
    "notice",
    "consent",
    "review",
    "record",
    "respond",
    "escalat",
    "process",
    "pathway",
    "participant",
    "provider",
    "require",
  ].filter((term) => normalised.includes(term)).length;
  const domain = domainSufficiency(requirement.id, normalised);
  const keywordRulesPass = requirement.coverageRules.length === 0
    ? true
    : requirement.coverageRules.some((rule) => coverageRuleMatches(normalised, rule));

  if (keywordRulesPass && operativeCount >= 2 && domain.passed) {
    return { passed: true, partial: false, reason: null, mode: "FALLBACK_HEURISTIC", breakdown };
  }
  return {
    passed: false,
    partial: keywordRulesPass || domain.partial || operativeCount >= 2,
    reason: domain.reason ?? "Section exists but lacks enough operative professional content for the requirement.",
    mode: "FALLBACK_HEURISTIC",
    breakdown,
  };
}

function explicitlyStatesNonApplicabilityWithSource(content: string): boolean {
  const normalised = normaliseContent(content);
  const nonApplicable = /\b(?:not applicable|non applicable|does not apply|no .* required|no .* recorded|no .* identified|none apply)\b/.test(normalised);
  const sourceNamed = /\b(?:based on|according to|from|as recorded in|source|assessment|plan|bsp|behaviour support plan|risk assessment|intake|service agreement|ndis plan)\b/.test(normalised);
  return nonApplicable && sourceNamed;
}

function evaluateTemplateRequirementContent(
  requirement: DeliverableRequirement,
  content: string,
): { passed: boolean; partial: boolean; reason: string } {
  const normalised = normaliseContent(content);
  const missing: string[] = [];

  const fixedMissing = requirement.fixedContent.filter((fixed) =>
    !normalised.includes(normaliseContent(fixed)),
  );
  if (fixedMissing.length > 0) {
    missing.push(`missing authored fixedContent (${fixedMissing.length}/${requirement.fixedContent.length})`);
  }

  const missingFields = requirement.templateFields.filter((field) =>
    !templateFieldIsRepresented(field, content),
  );
  if (missingFields.length > 0) {
    missing.push(`missing declared template fields/structure: ${missingFields.join("; ")}`);
  }

  if (requirement.completionPrompt && !normalised.includes(normaliseContent(requirement.completionPrompt))) {
    missing.push("missing authored completionPrompt");
  }

  if (missing.length === 0) {
    return { passed: true, partial: false, reason: "" };
  }

  const totalChecks = requirement.fixedContent.length +
    requirement.templateFields.length +
    (requirement.completionPrompt ? 1 : 0);
  const missingChecks = fixedMissing.length + missingFields.length + (requirement.completionPrompt && !normalised.includes(normaliseContent(requirement.completionPrompt)) ? 1 : 0);
  return {
    passed: false,
    partial: totalChecks > missingChecks,
    reason: `Template section does not satisfy derived template criteria: ${missing.join("; ")}.`,
  };
}

function templateFieldIsRepresented(field: string, content: string): boolean {
  const normalisedField = normaliseContent(field);
  const normalisedContent = normaliseContent(content);
  if (!normalisedField) return true;

  const tableColumns = field.match(/table with columns\s+(.+)/i);
  if (tableColumns) {
    const columns = (tableColumns[1] ?? "").split(",")[0]!
      .split("|")
      .map((column) => normaliseContent(column))
      .filter(Boolean);
    if (columns.join("|") === "activity|support level|what the worker does") {
      const activityRows = (content.match(/\|\s*[^|\n]+\s*\|\s*\[SUPPORT_LEVEL_[A-Z0-9_]+\]\s*\|\s*\[WHAT_THE_WORKER_DOES_[A-Z0-9_]+\]\s*\|/g) ?? []).length;
      return activityRows >= 26;
    }
    return columns.every((column) => normalisedContent.includes(column));
  }

  if (/minimum three personal goal rows/i.test(field)) {
    const currentSituationRows = (content.match(/\[CURRENT_SITUATION_\d+\]/g) ?? []).length;
    const tableRowCount = content.split(/\r?\n/).filter((line) =>
      /^\|/.test(line.trim()) && /\[[A-Z0-9_]+\]/.test(line),
    ).length;
    return Math.max(currentSituationRows, tableRowCount) >= 3;
  }

  if (/description per selected type/i.test(field)) {
    return normalisedContent.includes("support type") &&
      normalisedContent.includes("description") &&
      /\[DESCRIPTION_[A-Z0-9_]+\]/.test(content);
  }

  const afterColon = field.includes(":") ? field.split(":").slice(1).join(":") : field;
  const labels = afterColon
    .split(/,|—/)
    .map((label) => normaliseContent(label))
    .filter((label) => label.length > 2)
    .filter((label) => !/^(sourced from|source|fields|sil and supported accommodation|community access)$/.test(label));
  if (labels.length > 1) {
    const minimumMatches = Math.max(1, Math.ceil(labels.length * 0.8));
    return labels.filter((label) => normalisedContent.includes(label)).length >= minimumMatches;
  }

  return normalisedContent.includes(normalisedField);
}

function adequacyCriterionMatchesContent(criterion: string, normalisedContent: string): boolean {
  const terms = criterion
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .filter((word) => ![
      "must",
      "include",
      "includes",
      "included",
      "contain",
      "contains",
      "present",
      "state",
      "states",
      "show",
      "shows",
      "with",
      "where",
      "when",
      "that",
      "this",
      "from",
      "into",
      "relevant",
      "specific",
      "professional",
      "section",
      "requirement",
    ].includes(word));
  if (terms.length === 0) return normalisedContent.includes(normaliseContent(criterion));
  const requiredMatches = Math.min(terms.length, terms.length <= 3 ? terms.length : Math.ceil(terms.length * 0.65));
  return terms.filter((term) => normalisedContent.includes(term)).length >= requiredMatches;
}

function domainSufficiency(requirementId: string, normalised: string): { passed: boolean; partial: boolean; reason: string | null } {
  const includesAny = (terms: string[]) => terms.some((term) => normalised.includes(normaliseContent(term)));
  const countTerms = (terms: string[]) => terms.filter((term) => normalised.includes(normaliseContent(term))).length;
  const checks: Record<string, { core: string[]; support: string[]; minSupport: number; reason: string }> = {
    "service-agreement-basis": {
      core: ["ndis", "agreement"],
      support: ["purpose", "scope", "supports", "service relationship", "participant choice"],
      minSupport: 2,
      reason: "Agreement basis must explain NDIS purpose, scope and service relationship, not only name the agreement.",
    },
    "delivery-obligations": {
      core: ["deliver", "support"],
      support: ["safe", "respect", "operational capability", "interruption", "alternate", "notify"],
      minSupport: 2,
      reason: "Delivery clause must state operational delivery duties and interruption handling.",
    },
    "provider-responsibilities": {
      core: ["provider", "responsib"],
      support: ["records", "billing", "privacy", "complaint", "continuity", "escalat", "safe"],
      minSupport: 3,
      reason: "Provider responsibilities must cover multiple concrete duty areas.",
    },
    "participant-responsibilities": {
      core: ["participant"],
      support: ["representative", "notice", "communicate", "pay", "expenses", "information", "changes"],
      minSupport: 3,
      reason: "Participant responsibilities must state concrete participant or representative duties.",
    },
    "rights-privacy-complaints-advocacy": {
      core: ["privacy", "complaint"],
      support: ["rights", "confidentiality", "advocacy", "dispute", "pathway", "respond", "choice"],
      minSupport: 4,
      reason: "Rights/privacy/complaints clause must include usable complaint, dispute or advocacy treatment.",
    },
    "pricing-payment-adjustments": {
      core: ["payment", "pricing"],
      support: ["gst", "non ndis", "price change", "notice", "billing", "agreement", "authority"],
      minSupport: 3,
      reason: "Pricing clause must cover payment, changes and cost treatment.",
    },
    "cancellation-no-show": {
      core: ["cancellation", "notice"],
      support: ["no show", "rescheduling", "emergency", "provider cancellation", "participant cancellation"],
      minSupport: 2,
      reason: "Cancellation clause must cover notice plus no-show/rescheduling or emergency treatment.",
    },
    "variation-amendment": {
      core: ["variation", "change"],
      support: ["consent", "signature", "effective date", "notice", "record"],
      minSupport: 2,
      reason: "Variation clause must cover controlled change, consent and record/signature handling.",
    },
    "termination-transition": {
      core: ["termination", "transition"],
      support: ["exit", "notice", "participant choice", "final invoice", "handover", "records"],
      minSupport: 3,
      reason: "Termination clause must cover exit, transition and final obligations.",
    },
    "continuity-emergency-disaster": {
      core: ["continuity", "emergency"],
      support: ["disaster", "temporary disruption", "alternate", "communication", "review", "escalation"],
      minSupport: 2,
      reason: "Continuity clause must cover disruption, alternate arrangements and communication/escalation.",
    },
    "onboarding-employment-documentation": {
      core: ["employment", "documentation"],
      support: ["contract", "role", "start", "responsible", "record", "completion"],
      minSupport: 2,
      reason: "Employment documentation coverage must include concrete pre-start actions, ownership or completion evidence.",
    },
    "onboarding-screening-clearances-credentials": {
      core: ["screening", "clearance"],
      support: ["credential", "qualification", "prerequisite", "verify", "record", "before start"],
      minSupport: 2,
      reason: "Screening coverage must include verification of clearances, credentials or prerequisites.",
    },
    "onboarding-access-equipment-systems": {
      core: ["access"],
      support: ["system", "equipment", "workplace", "handover", "responsible", "record"],
      minSupport: 3,
      reason: "Access/equipment coverage must include systems, equipment or handover actions with accountability.",
    },
    "onboarding-induction-training-learning": {
      core: ["induction", "training"],
      support: ["learning", "role specific", "mandatory", "completion", "evidence", "record"],
      minSupport: 2,
      reason: "Induction coverage must include learning/training actions and completion evidence.",
    },
    "onboarding-supervision-checkins-support": {
      core: ["manager", "supervisor"],
      support: ["check in", "buddy", "feedback", "support", "escalation", "review"],
      minSupport: 2,
      reason: "Supervision coverage must include check-ins, support/feedback or escalation.",
    },
    "onboarding-policy-acknowledgement": {
      core: ["policy", "acknowledg"],
      support: ["procedure", "code of conduct", "read", "understand", "record", "sign"],
      minSupport: 2,
      reason: "Policy acknowledgement must be a concrete checklist action, not a placeholder for policy content.",
    },
    "onboarding-ndis-workforce-orientation": {
      core: ["ndis"],
      support: ["disability", "safe", "worker", "orientation", "incident", "rights", "participant"],
      minSupport: 2,
      reason: "NDIS workforce orientation must include configurable disability-provider safe-practice onboarding items when applicable.",
    },
  };
  const check = checks[requirementId];
  if (!check) return { passed: true, partial: false, reason: null };
  const corePass = check.core.every((term) => normalised.includes(normaliseContent(term)));
  const supportCount = countTerms(check.support);
  return {
    passed: corePass && supportCount >= check.minSupport,
    partial: includesAny(check.core) || supportCount > 0,
    reason: corePass && supportCount >= check.minSupport ? null : check.reason,
  };
}

function stripSelfAssertionCoverage(content: string): string {
  return splitCoverageSentences(content)
    .filter((sentence) => {
      const normalised = normaliseContent(sentence);
      if (/^(all|every|each)\b.*\b(covered|addressed|included|represented|compliant)\b/.test(normalised)) return false;
      if (/^(?:this|the)\s+(?:section|plan|document|template|agreement|care plan)\b.*\b(?:outlines?|describes?|details?|serves\s+to|is\s+designed\s+to|covers?|includes?|provides?|sets\s+out|summari[sz]es)\b/.test(normalised) && normalised.split(/\s+/).length <= 24) return false;
      if (/^the following\b.*\b(?:outlines?|describes?|details?|covers?|includes?|sets\s+out|summari[sz]es)\b/.test(normalised) && normalised.split(/\s+/).length <= 24) return false;
      if (/\b(this agreement|this document|the template)\b.*\b(covers|addresses|includes|is compliant|is complete)\b/.test(normalised) && normalised.split(/\s+/).length <= 14) return false;
      if (/\b(privacy|complaints?|pricing|responsibilities|termination|variation|cancellation)\b.*\b(is|are)\b.*\b(addressed|covered|included|represented)\b/.test(normalised) && normalised.split(/\s+/).length <= 12) return false;
      return true;
    })
    .join(" ");
}

function analyseSubstantiveCoverageContent(
  content: string,
  requirement?: Pick<DeliverableRequirement, "fixedContent" | "completionPrompt">,
): DeliverableSubstantiveBreakdown {
  const strippedSelfDescription: string[] = [];
  const countedParts: string[] = [];
  for (const sentence of splitCoverageSentences(content)) {
    const normalised = normaliseContent(sentence);
    if (isAuthoredTemplateContentPart(sentence, requirement?.fixedContent ?? [])) {
      countedParts.push(sentence);
      continue;
    }
    if (/^(all|every|each)\b.*\b(covered|addressed|included|represented|compliant)\b/.test(normalised)) {
      strippedSelfDescription.push(sentence);
      continue;
    }
    if (/^(?:this|the)\s+(?:section|plan|document|template|agreement|care plan)\b.*\b(?:outlines?|describes?|details?|serves\s+to|is\s+designed\s+to|covers?|includes?|provides?|sets\s+out|summari[sz]es)\b/.test(normalised) && normalised.split(/\s+/).length <= 24) {
      strippedSelfDescription.push(sentence);
      continue;
    }
    if (/^the following\b.*\b(?:outlines?|describes?|details?|covers?|includes?|sets\s+out|summari[sz]es)\b/.test(normalised) && normalised.split(/\s+/).length <= 24) {
      strippedSelfDescription.push(sentence);
      continue;
    }
    if (/\b(this agreement|this document|the template)\b.*\b(covers|addresses|includes|is compliant|is complete)\b/.test(normalised) && normalised.split(/\s+/).length <= 14) {
      strippedSelfDescription.push(sentence);
      continue;
    }
    if (/\b(privacy|complaints?|pricing|responsibilities|termination|variation|cancellation)\b.*\b(is|are)\b.*\b(addressed|covered|included|represented)\b/.test(normalised) && normalised.split(/\s+/).length <= 12) {
      strippedSelfDescription.push(sentence);
      continue;
    }
    countedParts.push(sentence);
  }

  const fixedParts = countedParts.filter((part) => isAuthoredTemplateContentPart(part, requirement?.fixedContent ?? []));
  const completionPromptParts = countedParts.filter((part) => isAuthoredCompletionPromptPart(part, requirement?.completionPrompt ?? null));
  const fieldLabelParts = countedParts.filter((part) => isFieldOrStructureLabel(part));
  const proseParts = countedParts.filter((part) =>
    !isFieldOrStructureLabel(part) &&
    !isAuthoredTemplateContentPart(part, requirement?.fixedContent ?? []) &&
    !isAuthoredCompletionPromptPart(part, requirement?.completionPrompt ?? null)
  );
  const countedContent = countedParts.join(" ");
  const placeholderCount = (countedContent.match(/\[[A-Z0-9_]+\]/g) ?? []).length;
  const proseContent = proseParts.join(" ").replace(/\[[A-Z0-9_]+\]/g, " ");
  const fieldContent = fieldLabelParts.join(" ");
  return {
    countedWordCount: wordCountForCoverage(countedContent),
    fixedContentWordCount: wordCountForCoverage(fixedParts.join(" ")),
    proseWordCount: wordCountForCoverage(proseContent),
    completionPromptWordCount: wordCountForCoverage(completionPromptParts.join(" ")),
    fieldLabelCount: fieldLabelParts.length,
    placeholderCount,
    fieldAndPlaceholderWordCount: wordCountForCoverage(fieldContent),
    strippedSelfDescription,
    countedContent,
  };
}

function isAuthoredTemplateContentPart(part: string, fixedContent: string[]): boolean {
  const normalisedPart = normaliseContent(part);
  return fixedContent.some((fixed) => {
    const normalisedFixed = normaliseContent(fixed);
    if (!normalisedFixed) return false;
    return normalisedFixed.includes(normalisedPart) || normalisedPart.includes(normalisedFixed);
  });
}

function isAuthoredCompletionPromptPart(part: string, completionPrompt: string | null): boolean {
  if (!completionPrompt) return false;
  const normalisedPart = normaliseContent(part);
  const normalisedPrompt = normaliseContent(completionPrompt);
  return Boolean(normalisedPrompt) && (normalisedPrompt.includes(normalisedPart) || normalisedPart.includes(normalisedPrompt));
}

function splitCoverageSentences(content: string): string[] {
  return content
    .split(/(?<=[.!?])\s+|\r?\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isFieldOrStructureLabel(value: string): boolean {
  const trimmed = value.trim().replace(/^[-*]\s+/, "");
  return /^[A-Za-z][A-Za-z0-9 /&(),.'-]{1,90}:\s*(?:\[[A-Z0-9_]+\]|$|[-A-Za-z0-9_ /[\],.'()]+$)/.test(trimmed);
}

function wordCountForCoverage(value: string): number {
  return normaliseContent(value).split(/\s+/).filter(Boolean).length;
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function coverageRuleMatches(normalisedContent: string, rule: DeliverableCoverageRule): boolean {
  const allOf = rule.allOf ?? [];
  const anyOf = rule.anyOf ?? [];
  const allPassed = allOf.every((term) => normalisedContent.includes(normaliseContent(term)));
  const anyPassed = anyOf.length === 0 || anyOf.some((term) => normalisedContent.includes(normaliseContent(term)));
  return allPassed && anyPassed;
}

function ruleTermsMatchSameStructure(normalisedStructure: string, rule: DeliverableCoverageRule): boolean {
  const allOf = rule.allOf ?? [];
  const anyOf = rule.anyOf ?? [];
  const allPassed = allOf.every((term) => normalisedStructure.includes(normaliseContent(term)));
  const anyPassed = anyOf.length === 0 || anyOf.some((term) => normalisedStructure.includes(normaliseContent(term)));
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
