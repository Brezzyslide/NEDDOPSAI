import type { EvidencePack } from "./knowledgeResolutionService.js";
import type { BlueprintExecutionContract, WorkBlueprint } from "./workBlueprintService.js";
import type { WorkPackageManifest } from "./workPackageService.js";

export type ProfessionalOperation = "CREATE" | "REVIEW" | "UPDATE" | "COMPARE" | "TAILOR" | "COMPLETE" | "INVESTIGATE";
export type ContextSufficiency = "FULL_ORGANISATIONAL_CONTEXT" | "PARTIAL_ORGANISATIONAL_CONTEXT" | "MINIMAL_ORGANISATIONAL_CONTEXT";

export interface ProfessionalDeliverableContract {
  requestedDeliverableType: string;
  audience: string;
  standardisation: "standard_reusable" | "organisation_tailored" | "participant_specific" | "general";
  outputFormat: string;
  userFacingPurpose: string;
  allowedFactualPlaceholders: string[];
  mandatoryProfessionalContent: string[];
  completionStandard: string[];
}

export interface PromptTokenBudgetTelemetry {
  totalInputTokens: number;
  dnaTokens: number;
  workerProfileTokens: number;
  blueprintTokens: number;
  userRequestTokens: number;
  evidenceTokens: number;
  organisationContextTokens: number;
  templateTokens: number;
  exampleTokens: number;
  memoryTokens: number;
  supportingSpecialistTokens: number;
  runnerTokens: number;
  deliverableContractTokens: number;
  truncation: "none" | "not_measured";
}

export interface ProfessionalExecutionContext {
  userRequest: string;
  operation: ProfessionalOperation;
  deliverable: ProfessionalDeliverableContract;
  primarySpecialist: string;
  supportingSpecialists: string[];
  professionalMethodRole: "internal_method_only" | "requested_deliverable_structure";
  contextSufficiency: ContextSufficiency;
  authorityHierarchy: string[];
  conflictResolution: string[];
  qualityContract: string[];
  canonicalIntent: string | null;
  blueprintCode: string | null;
  professionalDomain: string;
  specificity: "STANDARD_NON_PARTICIPANT_SPECIFIC" | "ORGANISATION_SPECIFIC" | "PARTICIPANT_SPECIFIC" | "GENERAL";
  outputDepth: {
    configuredOutputBudget: number;
    expectedMinimumSections: number;
    expectedDepth: "concise" | "standard" | "comprehensive";
    depthInstruction: string;
  };
  telemetry: PromptTokenBudgetTelemetry;
}

const SERVICE_AGREEMENT_FACTUAL_PLACEHOLDERS = [
  "[PARTICIPANT_NAME]",
  "[PROVIDER_NAME]",
  "[PROVIDER_ABN]",
  "[NDIS_NUMBER]",
  "[AGREEMENT_PERIOD]",
  "[SUPPORT_SCHEDULE]",
  "[PRICE]",
  "[SIGNATURE]",
];

const WORKFORCE_ONBOARDING_FACTUAL_PLACEHOLDERS = [
  "[STAFF_NAME]",
  "[ROLE]",
  "[START_DATE]",
  "[MANAGER]",
  "[EMPLOYMENT_TYPE]",
  "[REQUIRED_CLEARANCES]",
  "[INDUCTION_DATE]",
  "[SIGN_OFF]",
];

const POLICY_FACTUAL_PLACEHOLDERS = [
  "[ORGANISATION_NAME]",
  "[POLICY_OWNER]",
  "[APPROVAL_DATE]",
  "[REVIEW_DATE]",
];

const GENERIC_FACTUAL_PLACEHOLDERS = [
  "[ORGANISATION_NAME]",
  "[DATE]",
  "[RESPONSIBLE_ROLE]",
];

const SERVICE_AGREEMENT_CONTENT = [
  "Agreement parties and representative authority",
  "NDIS service agreement purpose and scope",
  "Supports and support schedule framework",
  "Provider responsibilities",
  "Participant and representative responsibilities",
  "Participant rights, choice, control and supported decision-making",
  "Privacy and confidentiality",
  "Feedback, complaints and disputes",
  "Payment, pricing, GST and non-NDIS cost framework",
  "Cancellations, notice and no-show terms",
  "Changes, variation and agreement review",
  "Continuity of support, emergency and disaster arrangements",
  "Termination, exit and transition provisions",
  "Signatures and acceptance",
];

const CARE_PLAN_TEMPLATE_CONTENT = [
  "Support Plan Meeting",
  "Goals",
  "About Me",
  "History and Background",
  "Undertaking ADL",
  "Communication and Communication Strategy",
  "Mobility and Mobility Strategy",
  "Support Delivery and Client Safety",
  "Behavioural Management",
  "Restrictive Practices",
  "Mealtime Management Strategy",
  "Disaster Management Strategy",
  "Client Endorsement",
  "Document Control",
];

export function deriveProfessionalOperation(userRequest: string, canonicalIntent?: string | null): ProfessionalOperation {
  const requestText = userRequest.toLowerCase();
  if (/\b(update|revise|amend|refresh|change)\b/.test(requestText)) return "UPDATE";
  if (/\b(complete|fill|populate|finish)\b/.test(requestText)) return "COMPLETE";
  if (isReviewWorkProductRequest(requestText)) return "REVIEW";
  if (/\b(compare|contrast|difference|versus|vs)\b/.test(requestText)) return "COMPARE";
  if (/\b(investigate|investigation|root cause|incident investigation)\b/.test(requestText)) return "INVESTIGATE";
  if (/\b(tailor|customise|customize|adapt|personalise|personalize)\b/.test(requestText)) return "TAILOR";
  if (isCreateWorkProductRequest(requestText)) return "CREATE";
  if (/\b(create|draft|write|develop|design|prepare|build|template|standard)\b/.test(requestText)) return "CREATE";
  const intentMode = canonicalIntent?.split(".").pop()?.toLowerCase();
  if (intentMode === "review") return "REVIEW";
  if (intentMode === "revise" || intentMode === "update") return "UPDATE";
  if (intentMode === "investigation") return "INVESTIGATE";
  if (intentMode === "create") return "CREATE";
  return "CREATE";
}

export function deriveProfessionalIntentKey(userRequest: string, canonicalIntent?: string | null): string | null {
  const operation = deriveProfessionalOperation(userRequest, canonicalIntent).toLowerCase();
  const text = userRequest.toLowerCase();
  const mode = operation === "review" ? "review" : operation === "update" ? "revise" : "create";
  if (/\bservice agreement\b/.test(text)) return `agreements.${operation === "create" ? "create" : operation === "update" ? "revise" : operation}`;
  if (/\b(care plan|care planning)\b/.test(text)) return `care_plan.${mode}`;
  if (/\b(individual support plan|support plan|support planning)\b/.test(text)) return `support_plan.${mode}`;
  if (/\bpolic(?:y|ies)\b/.test(text)) return `policy.${operation === "create" ? "create" : operation === "update" ? "revise" : "review"}`;
  if (/\brisk\b/.test(text)) {
    if (operation === "complete") return "risk.assessment";
    return `risk.${operation === "create" ? "create" : "review"}`;
  }
  if (/\bincident\b/.test(text)) return operation === "investigate" ? "incident.investigation" : "incident.review";
  if (/\b(onboard|onboarding|induction|new staff|new employee|staff checklist|employee checklist)\b/.test(text)) return "people.onboarding";
  return canonicalIntent ?? null;
}

export function compileProfessionalExecutionContext(input: {
  userRequest: string;
  manifest: WorkPackageManifest;
  blueprint: WorkBlueprint | null;
  blueprintContract?: BlueprintExecutionContract | null;
  evidencePack?: EvidencePack | null;
}): ProfessionalExecutionContext {
  const operation = deriveProfessionalOperation(input.userRequest, input.manifest.canonicalIntent);
  const standardisation = classifyStandardisation(input.userRequest, operation);
  const requestedDeliverableType = deriveDeliverableType(input.userRequest, operation, input.blueprint);
  const mandatoryProfessionalContent = deriveMandatoryProfessionalContent(input.userRequest, requestedDeliverableType, operation, input.blueprintContract);
  const allowedFactualPlaceholders = deriveAllowedFactualPlaceholders(input.userRequest, requestedDeliverableType, operation, input.blueprint);
  const deliverable: ProfessionalDeliverableContract = {
    requestedDeliverableType,
    audience: deriveAudience(input.userRequest, requestedDeliverableType, operation),
    standardisation,
    outputFormat: String(input.blueprint?.deliverableContract?.primaryFormat ?? "docx"),
    userFacingPurpose: deriveUserFacingPurpose(requestedDeliverableType, operation),
    allowedFactualPlaceholders,
    mandatoryProfessionalContent,
    completionStandard: [
      "The deliverable is user-facing and matches the requested operation.",
      "Internal methodology, control codes and Blueprint section titles are not copied as document structure unless the user requested a review/assessment.",
      "Every applicable mandatory, conditional and factual-field deliverable requirement is represented in the final user-facing payload.",
      "Professional-content placeholders and incomplete markers are absent.",
      "Factual placeholders remain only for unknown customer-specific values.",
    ],
  };

  return {
    userRequest: input.userRequest,
    operation,
    deliverable,
    primarySpecialist: input.manifest.primarySpecialist,
    supportingSpecialists: input.manifest.supportingSpecialists ?? [],
    professionalMethodRole: operation === "REVIEW" || operation === "INVESTIGATE"
      ? "requested_deliverable_structure"
      : "internal_method_only",
    contextSufficiency: deriveContextSufficiency(input),
    authorityHierarchy: [
      "Safety, WorkerProfile boundaries and external professional authority limits",
      "Current binding external requirements and authoritative regulator guidance",
      "User requested operation and deliverable",
      "Blueprint professional methodology as internal process authority",
      "Organisation templates for house structure, terminology, style and approved organisation-specific provisions",
      "Organisation context, memory and KRS evidence",
      "Approved examples as style and quality references only",
    ],
    conflictResolution: [
      "Do not let an incomplete organisation template override current binding requirements.",
      "If a template omits professionally required content, supplement it from Blueprint method and authoritative evidence.",
      "If organisation facts are missing, reduce tailoring and use factual placeholders rather than inventing facts.",
      "Do not expose internal professional method unless the requested operation is REVIEW or INVESTIGATE.",
    ],
    qualityContract: [
      "No unresolved professional-content placeholders.",
      "No leaked internal methodology headings in CREATE, TAILOR, UPDATE or COMPLETE deliverables.",
      "No empty substantive sections or instruction-only clauses.",
      "No mandatory user-facing section is placeholder-only or dominated by labels and factual variables.",
      "Mandatory professional deliverable requirement coverage is 100% before Completed Work/artifacts are finalised.",
      "Completed Work/artifacts consume only the final deliverable payload.",
    ],
    canonicalIntent: input.manifest.canonicalIntent ?? null,
    blueprintCode: input.blueprint?.code ?? null,
    professionalDomain: input.blueprint?.blueprintFamily ?? deriveProfessionalDomain(input.userRequest, requestedDeliverableType),
    specificity: deriveSpecificity(standardisation),
    outputDepth: deriveOutputDepth(requestedDeliverableType, operation, mandatoryProfessionalContent),
    telemetry: estimateProfessionalContextTokens(input, mandatoryProfessionalContent, allowedFactualPlaceholders),
  };
}

function isCreateWorkProductRequest(requestText: string): boolean {
  return /\b(create|draft|write|develop|design|prepare|build|generate|produce|make|give me|provide)\b[\s\S]{0,80}\b(checklist|template|form|policy|procedure|plan|assessment|report|framework|agreement)\b/.test(requestText) ||
    /\b(checklist|template|form|policy|procedure|plan|assessment|report|framework|agreement)\b[\s\S]{0,50}\b(for|covering|about)\b/.test(requestText);
}

function isReviewWorkProductRequest(requestText: string): boolean {
  return /\b(review|assess|audit|check|validate|evaluate)\b\s+(this|the|our|existing|current|uploaded|attached)\b/.test(requestText) ||
    /\b(readiness|ready for use|compliant and ready|compliance check)\b/.test(requestText);
}

export function buildProfessionalExecutionContextBlock(
  context: ProfessionalExecutionContext,
  options: { includeUserRequest?: boolean } = {},
): string {
  return [
    "## PROFESSIONAL EXECUTION CONTEXT",
    options.includeUserRequest === false ? "" : `USER_REQUEST: ${context.userRequest}`,
    `OPERATION: ${context.operation}`,
    `DELIVERABLE_TYPE: ${context.deliverable.requestedDeliverableType}`,
    `PROFESSIONAL_DOMAIN: ${context.professionalDomain}`,
    `SPECIFICITY: ${context.specificity}`,
    `AUDIENCE: ${context.deliverable.audience}`,
    `CONTEXT_SUFFICIENCY: ${context.contextSufficiency}`,
    `PRIMARY_SPECIALIST: ${context.primarySpecialist}`,
    `SUPPORTING_SPECIALISTS: ${context.supportingSpecialists.join(", ") || "none"}`,
    `PROFESSIONAL_METHOD_ROLE: ${context.professionalMethodRole}`,
    "",
    "AUTHORITY_HIERARCHY:",
    context.authorityHierarchy.map((item, index) => `${index + 1}. ${item}`).join("\n"),
    "",
    "REQUIRED_PROFESSIONAL_CONTENT:",
    context.deliverable.mandatoryProfessionalContent.map((item) => `- ${item}`).join("\n"),
    "",
    "ALLOWED_FACTUAL_PLACEHOLDERS:",
    context.deliverable.allowedFactualPlaceholders.join(", "),
    "",
    "OUTPUT_CONTRACT:",
    `Produce ${context.deliverable.userFacingPurpose}. Internal professional work is not the artifact payload.`,
    `OUTPUT_DEPTH: ${context.outputDepth.expectedDepth}; minimum sections: ${context.outputDepth.expectedMinimumSections}; configured output budget: ${context.outputDepth.configuredOutputBudget}.`,
    context.outputDepth.depthInstruction,
    "",
    "QUALITY_CONTRACT:",
    context.qualityContract.map((item) => `- ${item}`).join("\n"),
  ].join("\n");
}

function deriveDeliverableType(userRequest: string, operation: ProfessionalOperation, blueprint: WorkBlueprint | null): string {
  const text = userRequest.toLowerCase();
  if (/\bndis\b/.test(text) && /\bservice agreement\b/.test(text) && operation === "CREATE") {
    return "STANDARD_REUSABLE_NDIS_SERVICE_AGREEMENT";
  }
  if (/\bservice agreement\b/.test(text) && operation === "REVIEW") {
    return "PARTICIPANT_SERVICE_AGREEMENT_CONTRACT_READINESS_ASSESSMENT";
  }
  if (/\b(care plan|care planning)\b/.test(text) && isStandardReusableRequest(text)) {
    return "STANDARD_REUSABLE_NDIS_CARE_PLAN_TEMPLATE";
  }
  if (/\b(care plan|care planning)\b/.test(text)) return "PARTICIPANT_NDIS_CARE_PLAN";
  if (/\b(individual support plan|support plan|support planning)\b/.test(text) && isStandardReusableRequest(text)) {
    return "STANDARD_REUSABLE_NDIS_SUPPORT_PLAN_TEMPLATE";
  }
  if (/\b(individual support plan|support plan|support planning)\b/.test(text)) return "PARTICIPANT_NDIS_SUPPORT_PLAN";
  if (/\b(onboard|onboarding|induction|new staff|new employee|staff checklist|employee checklist)\b/.test(text) && /\b(checklist|template|induction|onboarding)\b/.test(text)) {
    return "WORKFORCE_ONBOARDING_CHECKLIST";
  }
  if (/\bpolic(?:y|ies)\b/.test(text) && operation === "CREATE") return "POLICY_DOCUMENT";
  if (/\bpolic(?:y|ies)\b/.test(text) && operation === "REVIEW") return "POLICY_REVIEW";
  if (/\brisk\b/.test(text) && /\btemplate\b/.test(text)) return "STANDARD_RISK_TEMPLATE";
  if (/\brisk assessment\b/.test(text) && operation === "COMPLETE") return "PARTICIPANT_RISK_ASSESSMENT";
  if (/\bincident\b/.test(text) && operation === "INVESTIGATE") return "INCIDENT_INVESTIGATION_REPORT";
  if (/\bincident\b/.test(text) && operation === "REVIEW") return "INCIDENT_REVIEW_REPORT";
  return normaliseDeliverableName(blueprint?.primaryDeliverable ?? blueprint?.deliverableContract?.primaryDeliverable ?? "PROFESSIONAL_DELIVERABLE");
}

function deriveMandatoryProfessionalContent(
  userRequest: string,
  deliverableType: string,
  operation: ProfessionalOperation,
  contract?: BlueprintExecutionContract | null,
): string[] {
  if (deliverableType === "STANDARD_REUSABLE_NDIS_SERVICE_AGREEMENT") return SERVICE_AGREEMENT_CONTENT;
  if (deliverableType === "STANDARD_REUSABLE_NDIS_CARE_PLAN_TEMPLATE") return CARE_PLAN_TEMPLATE_CONTENT;
  if (deliverableType === "STANDARD_REUSABLE_NDIS_SUPPORT_PLAN_TEMPLATE") return CARE_PLAN_TEMPLATE_CONTENT;
  if (deliverableType === "WORKFORCE_ONBOARDING_CHECKLIST") {
    return [
      "Role, employment and start-date details",
      "Pre-start employment documentation and onboarding responsibilities",
      "Required screening, clearances, credentials and role prerequisites",
      "System, equipment, workplace access and supervision handover",
      "Induction, mandatory learning and role-specific training checklist",
      "Manager, buddy or supervisor check-ins and completion sign-off",
    ];
  }
  if (operation === "REVIEW" || operation === "INVESTIGATE") {
    return (contract?.sections ?? [])
      .filter((section) => section.required)
      .map((section) => section.title)
      .slice(0, 20);
  }
  if (/\bpolicy\b/i.test(userRequest)) return ["Purpose", "Scope", "Policy statement", "Responsibilities", "Procedure or implementation requirements", "Review and approval"];
  if (/\brisk\b/i.test(userRequest)) return ["Risk context", "Hazards or risk domains", "Controls", "Risk rating framework", "Review triggers", "Responsibilities"];
  return ["Purpose", "Scope", "Substantive professional content", "Responsibilities", "Completion or review requirements"];
}

function deriveAudience(userRequest: string, deliverableType: string, operation: ProfessionalOperation): string {
  if (deliverableType === "STANDARD_REUSABLE_NDIS_SERVICE_AGREEMENT") return "NDIS provider and participant or participant representative";
  if (deliverableType === "STANDARD_REUSABLE_NDIS_CARE_PLAN_TEMPLATE") return "NDIS provider staff, participant and participant representative";
  if (deliverableType === "STANDARD_REUSABLE_NDIS_SUPPORT_PLAN_TEMPLATE") return "NDIS provider staff, participant and participant representative";
  if (deliverableType === "WORKFORCE_ONBOARDING_CHECKLIST") return "People & Culture, hiring manager, supervisor and onboarding coordinator";
  if (operation === "REVIEW") return "Internal governance reviewer and authorised decision-maker";
  if (/\bparticipant\b/i.test(userRequest)) return "Provider staff and participant-specific stakeholders";
  return "Organisation users responsible for adopting the deliverable";
}

function deriveProfessionalDomain(userRequest: string, deliverableType: string): string {
  const text = `${userRequest} ${deliverableType}`.toLowerCase();
  if (/\bservice agreement|agreement\b/.test(text)) return "NDIS Service Agreements";
  if (/\bcare plan|support plan\b/.test(text)) return "NDIS care and support planning";
  if (/\bonboard|onboarding|induction|new staff|new employee|staff checklist|employee checklist\b/.test(text)) return "Workforce onboarding";
  if (/\brisk\b/.test(text)) return "Risk management";
  if (/\bincident\b/.test(text)) return "Incident management";
  if (/\bpolicy|procedure|sop\b/.test(text)) return "Policy and governance";
  return "Professional operations";
}

function deriveSpecificity(
  standardisation: ProfessionalDeliverableContract["standardisation"],
): ProfessionalExecutionContext["specificity"] {
  if (standardisation === "standard_reusable") return "STANDARD_NON_PARTICIPANT_SPECIFIC";
  if (standardisation === "organisation_tailored") return "ORGANISATION_SPECIFIC";
  if (standardisation === "participant_specific") return "PARTICIPANT_SPECIFIC";
  return "GENERAL";
}

function deriveOutputDepth(
  deliverableType: string,
  operation: ProfessionalOperation,
  mandatoryContent: string[],
): ProfessionalExecutionContext["outputDepth"] {
  const comprehensive = operation === "CREATE" &&
    /(?:AGREEMENT|POLICY|PROCEDURE|FRAMEWORK|PLAN|ASSESSMENT|INVESTIGATION)/.test(deliverableType);
  const expectedDepth = comprehensive ? "comprehensive" : mandatoryContent.length > 6 ? "standard" : "concise";
  return {
    configuredOutputBudget: comprehensive ? 6000 : 4000,
    expectedMinimumSections: Math.max(4, Math.min(24, mandatoryContent.length)),
    expectedDepth,
    depthInstruction: comprehensive
      ? "Draft substantive clauses/fields for every mandatory requirement; do not compress a full professional document into a short outline."
      : "Use enough detail to satisfy all mandatory requirements without adding irrelevant filler.",
  };
}

function deriveUserFacingPurpose(deliverableType: string, operation: ProfessionalOperation): string {
  if (deliverableType === "STANDARD_REUSABLE_NDIS_SERVICE_AGREEMENT") {
    return "an actual reusable NDIS Service Agreement template containing drafted operative clauses";
  }
  if (deliverableType === "STANDARD_REUSABLE_NDIS_CARE_PLAN_TEMPLATE") {
    return "an actual reusable NDIS Care Plan template containing drafted professional support-planning content";
  }
  if (deliverableType === "STANDARD_REUSABLE_NDIS_SUPPORT_PLAN_TEMPLATE") {
    return "an actual reusable NDIS Support Plan template containing drafted service-delivery planning content";
  }
  if (deliverableType === "WORKFORCE_ONBOARDING_CHECKLIST") {
    return "an actual staff onboarding checklist containing workforce-domain sections, fields and sign-off controls";
  }
  if (operation === "REVIEW") return "a professional review or readiness assessment";
  if (operation === "INVESTIGATE") return "an investigation report with findings and next actions";
  return "the requested professional deliverable";
}

function classifyStandardisation(userRequest: string, operation: ProfessionalOperation): ProfessionalDeliverableContract["standardisation"] {
  const text = userRequest.toLowerCase();
  if (isStandardReusableRequest(text) && !isExplicitParticipantSpecificRequest(text)) return "standard_reusable";
  if (isExplicitParticipantSpecificRequest(text)) return "participant_specific";
  if (/\b(our organisation|tailor|customise|customize|adapt|company|blaze)\b/.test(text) || operation === "TAILOR") return "organisation_tailored";
  if (operation === "CREATE" && isReusableWorkProductRequest(text)) return "standard_reusable";
  if (isStandardReusableRequest(text)) return "standard_reusable";
  return "general";
}

export function deriveDeliverableStandardisation(
  userRequest: string,
  operation: ProfessionalOperation = deriveProfessionalOperation(userRequest),
): ProfessionalDeliverableContract["standardisation"] {
  return classifyStandardisation(userRequest, operation);
}

export function deriveRequestedDeliverableType(
  userRequest: string,
  operation: ProfessionalOperation = deriveProfessionalOperation(userRequest),
  blueprint: WorkBlueprint | null = null,
): string {
  return deriveDeliverableType(userRequest, operation, blueprint);
}

function isStandardReusableRequest(text: string): boolean {
  return /\b(standard|template|reusable|generic)\b/.test(text);
}

function isReusableWorkProductRequest(text: string): boolean {
  return /\b(checklist|template|form|policy|procedure|plan|assessment|report|framework|agreement)\b/.test(text) &&
    !/\b(this|the|our|existing|current|uploaded|attached)\s+(checklist|template|form|policy|procedure|plan|assessment|report|framework|agreement)\b/.test(text);
}

function isExplicitParticipantSpecificRequest(text: string): boolean {
  return /\b(participant-specific|specific participant|participant x|client x|complete this|fill this|populate this)\b/.test(text) ||
    /\b(for|about)\s+(participant|client)\s+[a-z0-9_-]+\b/.test(text);
}

function deriveAllowedFactualPlaceholders(
  userRequest: string,
  deliverableType: string,
  operation: ProfessionalOperation,
  blueprint: WorkBlueprint | null,
): string[] {
  const domainText = `${userRequest} ${deliverableType} ${blueprint?.blueprintFamily ?? ""} ${blueprint?.code ?? ""}`.toLowerCase();
  if (deliverableType.includes("SERVICE_AGREEMENT") || /\bservice agreement\b/.test(domainText)) {
    return SERVICE_AGREEMENT_FACTUAL_PLACEHOLDERS;
  }
  if (deliverableType.includes("CARE_PLAN") || deliverableType.includes("SUPPORT_PLAN")) {
    return deriveTemplateFieldPlaceholders(blueprint);
  }
  if (deliverableType === "WORKFORCE_ONBOARDING_CHECKLIST" || /\b(onboard|onboarding|induction|new staff|new employee|people_culture|talent_learning|workforce_compliance)\b/.test(domainText)) {
    return WORKFORCE_ONBOARDING_FACTUAL_PLACEHOLDERS;
  }
  if (/\b(policy|procedure|governance|sop)\b/.test(domainText) || operation === "REVIEW") {
    return POLICY_FACTUAL_PLACEHOLDERS;
  }
  return GENERIC_FACTUAL_PLACEHOLDERS;
}

function deriveTemplateFieldPlaceholders(blueprint: WorkBlueprint | null): string[] {
  return (blueprint?.sections ?? [])
    .flatMap((section) => section.fields ?? [])
    .flatMap(derivePlaceholderTokensFromTemplateField);
}

export function derivePlaceholderTokensFromTemplateField(field: string): string[] {
  if (/table with columns\s+activity\s*\|\s*support level\s*\|\s*what the worker does/i.test(field)) {
    return uniquePlaceholders([
      "[ACTIVITY]",
      "[SUPPORT_LEVEL]",
      "[WHAT_THE_WORKER_DOES]",
      ...CARE_PLAN_ADL_ACTIVITY_ROWS.flatMap((activity) => {
        const activityToken = placeholderTokenFromLabel(activity);
        return [
          `[SUPPORT_LEVEL_${activityToken}]`,
          `[WHAT_THE_WORKER_DOES_${activityToken}]`,
        ];
      }),
    ]);
  }

  const supportTypes = field.match(/support types selected from\s+[—-]\s+(.+)/i);
  if (supportTypes) {
    const types = supportTypes[1]!.split(",").map((item) => item.trim()).filter(Boolean);
    return uniquePlaceholders([
      "[SUPPORT_TYPE]",
      "[SUPPORT_DESCRIPTION]",
      ...types.map((type) => `[DESCRIPTION_${placeholderTokenFromLabel(type)}]`),
    ]);
  }

  const source = field.includes(":") ? field.split(":").slice(1).join(":") : field;
  const labels = source.split(/,|\||—/);
  return uniquePlaceholders(labels.flatMap((label) => {
    const cleaned = label
      .trim()
      .replace(/\([^)]*\)/g, "")
      .replace(/\b(?:table with columns|minimum three personal goal rows|plus one row per ndis plan goal|selected from|sourced from|fields)\b/gi, "")
      .trim();
    const token = placeholderTokenFromLabel(cleaned);
    const generic = placeholderTokenFromLabel(cleaned.replace(/\b(?:per|for|of|and)\b.*$/i, ""));
    const aliases = deriveTemplateFieldPlaceholderAliases(cleaned);
    return [token, generic, ...aliases]
      .filter((candidate) => candidate.length > 1)
      .map((candidate) => `[${candidate}]`);
  }));
}

function deriveTemplateFieldPlaceholderAliases(label: string): string[] {
  const lower = label.toLowerCase();
  const aliases: string[] = [];
  if (/\bgoal\b/.test(lower)) aliases.push("GOALS");
  if (/\bdate\s+for\s+review\b/.test(lower) || /\bnext\s+review\s+date\b/.test(lower)) aliases.push("REVIEW_DATE");
  if (/\bwhat\s+matters\s+to\s+me\b/.test(lower)) aliases.push("WHAT_MATTERS");
  if (/\bhow\s+i\s+prefer\s+to\s+communicate\b/.test(lower)) aliases.push("COMMUNICATION_PREFERENCES");
  if (/\bmobility\b/.test(lower) && /\baid\b/.test(lower)) aliases.push("MOBILITY_AID");
  if (/\bsupport\s+types?\b/.test(lower)) aliases.push("SUPPORT_TYPE");
  if (/\bdescription\b/.test(lower) && (/\bsupport\b/.test(lower) || /\bselected\s+type\b/.test(lower))) {
    aliases.push("SUPPORT_DESCRIPTION");
  }
  return aliases;
}

const CARE_PLAN_ADL_ACTIVITY_ROWS = [
  "Personal hygiene and grooming",
  "Showering and bathing",
  "Dressing and undressing",
  "Toileting and continence",
  "Oral hygiene",
  "Eating and drinking",
  "Meal preparation",
  "Medication management",
  "Mobility within the home",
  "Transfers and positioning",
  "Bedtime and morning routines",
  "Household cleaning",
  "Laundry and clothing care",
  "Making and changing bedding",
  "Shopping for essential items",
  "Managing personal belongings",
  "Using household appliances",
  "Maintaining a safe home environment",
  "Managing daily routines",
  "Time awareness and task initiation",
  "Attending appointments",
  "Community access",
  "Transport and travel",
  "Money handling and everyday purchases",
  "Communication of daily needs",
  "Decision-making relating to daily activities",
] as const;

function uniquePlaceholders(placeholders: string[]): string[] {
  return Array.from(new Set(placeholders));
}

function placeholderTokenFromLabel(label: string): string {
  return label
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/__+/g, "_")
    .toUpperCase();
}

function deriveContextSufficiency(input: {
  manifest: WorkPackageManifest;
  evidencePack?: EvidencePack | null;
}): ContextSufficiency {
  const hasOrgContext = input.manifest.cosMemories.length > 0 || Object.keys(input.manifest.entityKnowledge ?? {}).length > 0;
  const hasEvidence = (input.evidencePack?.totalChunks ?? 0) > 0 || input.manifest.organisationLibrarySources.length > 0;
  if (hasOrgContext && hasEvidence) return "FULL_ORGANISATIONAL_CONTEXT";
  if (hasOrgContext || hasEvidence) return "PARTIAL_ORGANISATIONAL_CONTEXT";
  return "MINIMAL_ORGANISATIONAL_CONTEXT";
}

function estimateProfessionalContextTokens(input: {
  userRequest: string;
  manifest: WorkPackageManifest;
  blueprint: WorkBlueprint | null;
  blueprintContract?: BlueprintExecutionContract | null;
  evidencePack?: EvidencePack | null;
}, mandatoryProfessionalContent: string[], allowedFactualPlaceholders: string[]): PromptTokenBudgetTelemetry {
  const userRequestTokens = estimateTokens(input.userRequest);
  const blueprintTokens = estimateTokens([
    input.blueprint?.title,
    input.blueprint?.objective,
    input.blueprint?.purpose,
    JSON.stringify(input.blueprint?.deliverableContract ?? {}),
    JSON.stringify(input.blueprintContract?.sections ?? []),
  ].filter(Boolean).join("\n"));
  const evidenceTokens = estimateTokens((input.evidencePack?.chunks ?? []).map((chunk) => chunk.text).join("\n"));
  const memoryTokens = estimateTokens(input.manifest.cosMemories.map((memory) => memory.content ?? memory.title).join("\n"));
  const organisationContextTokens = estimateTokens([
    JSON.stringify(input.manifest.entityKnowledge ?? {}),
    input.manifest.organisationLibrarySources.map((source) => source.title).join("\n"),
  ].join("\n"));
  const deliverableContractTokens = estimateTokens(mandatoryProfessionalContent.join("\n") + allowedFactualPlaceholders.join(", "));
  const runnerTokens = 900;

  return {
    userRequestTokens,
    blueprintTokens,
    evidenceTokens,
    memoryTokens,
    organisationContextTokens,
    deliverableContractTokens,
    runnerTokens,
    dnaTokens: 0,
    workerProfileTokens: 0,
    templateTokens: 0,
    exampleTokens: 0,
    supportingSpecialistTokens: 0,
    totalInputTokens: userRequestTokens + blueprintTokens + evidenceTokens + memoryTokens + organisationContextTokens + deliverableContractTokens + runnerTokens,
    truncation: "not_measured",
  };
}

function estimateTokens(text: string): number {
  return Math.ceil((text || "").length / 4);
}

function normaliseDeliverableName(value: string): string {
  return value
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase() || "PROFESSIONAL_DELIVERABLE";
}
