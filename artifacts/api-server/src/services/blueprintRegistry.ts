/**
 * Blueprint Registry — Production Blueprint Architecture
 *
 * Canonical registry of professional work-type identities for the NeedsOps platform.
 * Contains canonical platform Blueprint identity, classification and, where a
 * Blueprint has been professionally authored, its production work-product
 * contract. Tenant templates/configuration may extend this at runtime but must
 * not silently rewrite professional ownership or safety boundaries.
 *
 * Rules:
 *  - All registry entries are platform_owned.
 *  - Placeholder entries remain identity/classification only.
 *  - Professionally authored entries may include sections, evidence and
 *    deliverable contracts for runtime validation.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type BlueprintMaturityState =
  | "placeholder"
  | "draft"
  | "professional_review"
  | "production_ready"
  | "superseded";

export type BlueprintOwnerType = "platform_owned" | "organisation_owned";

export const BLUEPRINT_UNRESOLVED_OWNER = "owner_unresolved";
export const BLUEPRINT_COORDINATOR_ROLE = "chief_of_staff";

export type BlueprintReadinessState =
  | "placeholder"
  | "professionally_authored"
  | "legacy"
  | "test_only"
  | "deprecated"
  | "not_ready";

/** Fields safe to expose publicly (any authenticated user). */
export interface BlueprintDescriptor {
  id: string;
  code: string;
  title: string;
  purpose: string;
  blueprintFamily: string;
  supportedModes: string[];
  version: string;
  status: string;
  maturityState: BlueprintMaturityState;
  ownerType: BlueprintOwnerType;
  primaryDeliverable: string;
  organizationId: string | null;
  isBuiltIn: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Private specification fields — platform admin only for platform blueprints. */
export const BLUEPRINT_SPEC_FIELDS = [
  "objective",
  "primarySpecialist",
  "supportingSpecialists",
  "requiredLibraryKnowledge",
  "requiredEntityKnowledge",
  "requiredMemories",
  "requiredApprovals",
  "validationRules",
  "qualityRules",
  "successCriteria",
  "outputTypes",
  "escalationRules",
  "mandatoryCitations",
  "deliverableContract",
  "evidenceContract",
  "internalExecutionInstructions",
] as const;

/** Organisation-configurable settings (owner/admin of the org can see). */
export const BLUEPRINT_ORG_CONFIG_FIELDS = [
  "permittedOrgOverrides",
] as const;

// ─── Registry entry shape (for seeding) ───────────────────────────────────────

export interface RegistryEntry {
  code: string;
  blueprintFamily: string;
  title: string;
  purpose: string;
  category: string;
  supportedModes: string[];
  primaryDeliverable: string;
  maturityState: BlueprintMaturityState;
  ownerType: BlueprintOwnerType;
  /** Old code this replaces (for backwards-compat). Null if code is new. */
  legacyCode?: string;
  /** Professional ownership boundary for placeholder routing and admin review. */
  professionalAuthority?: "needsops_ai" | "external_or_credentialed" | "mixed";
  /** Work that must remain with an external or appropriately credentialed authority. */
  externalAuthorityRequiredFor?: string[];
  /** Future NeedsOps role intended to own this work once professionally authored. */
  futureOwnerRoleCode?: string;
  /** Optional coordination role. Professional owner remains separate. */
  coordinatorRoleCode?: string;
  deliverableContract?: {
    primaryDeliverable: string;
    secondaryDeliverables?: string[];
    allowedInternalAnalysis?: string[];
    prohibitedDeliverables?: string[];
    artifactRequired?: boolean;
    primaryFormat?: string;
    secondaryFormats?: string[];
    namingConvention?: string;
    templateRequired?: boolean;
    completionRequirements?: string[];
  };
  evidenceContract?: {
    requiredEvidenceCategories?: string[];
    optionalEvidenceCategories?: string[];
    allowedSourceTypes?: string[];
    restrictedSourceTypes?: string[];
    requiredEntityTypes?: string[];
    minimumEvidenceCount?: number;
    freshnessRules?: Record<string, unknown>;
    claimIntegrityRequired?: boolean;
    missingEvidenceBehaviour?: "clarification_required" | "continue_with_flagged_gaps" | "block_completion" | "not_applicable_allowed";
  };
  permittedOrgOverrides?: {
    templateSubstitution?: boolean;
    outputFormatPreferences?: boolean;
    namingConvention?: boolean;
    approvalWorkflow?: boolean;
  };
  defaultTemplateId?: string | null;
  templateRequired?: boolean;
  allowedOrgTemplateOverride?: boolean;
  templateVersionPolicy?: "pin_at_execution" | "use_latest";
  supportingSpecialists?: string[];
  requiredLibraryKnowledge?: string[];
  requiredEntityKnowledge?: Record<string, unknown>;
  requiredApprovals?: Record<string, unknown>;
  validationRules?: Array<{ rule: string; required: boolean; description: string }>;
  qualityRules?: Array<{ dimension: string; weight: number; description: string }>;
  successCriteria?: string[];
  outputTypes?: string[];
  escalationRules?: Array<{ trigger: string; action: string }>;
  mandatoryCitations?: string[];
  sections?: Array<{
    sectionCode: string;
    title: string;
    description: string;
    instructions: string;
    required: boolean;
    minimumContentExpectation: string | null;
    evidenceRequirements?: Record<string, unknown>;
    allowedSourceTypes?: string[];
    prohibitedAssumptions?: string[];
    validationRules?: Array<{ rule: string; required: boolean; description: string }>;
    qualityCriteria?: Array<{ criterion: string; description: string }>;
    sortOrder: number;
  }>;
}

const SDC_OWNER = "service_delivery_coordinator";
const SDC_SUPPORT = [
  "operations_manager",
  "behaviour_support_implementation_specialist",
  "authorised_program_officer",
  "incident_safeguarding_specialist",
  "compliance_quality_manager",
  "knowledge_documentation_specialist",
];

function docxDeliverable(
  primaryDeliverable: string,
  namingConvention: string,
  allowedInternalAnalysis: string[] = [],
  prohibitedDeliverables: string[] = [],
) {
  return {
    primaryDeliverable,
    secondaryDeliverables: ["pdf"],
    allowedInternalAnalysis,
    prohibitedDeliverables,
    artifactRequired: true,
    primaryFormat: "docx",
    secondaryFormats: ["pdf"],
    namingConvention,
    templateRequired: true,
    completionRequirements: [
      "all_required_sections",
      "material_evidence_reviewed",
      "unresolved_gaps_flagged",
      "artifact_generated",
    ],
  };
}

function structuredAnalysisDeliverable(
  primaryDeliverable: string,
  allowedInternalAnalysis: string[] = [],
  prohibitedDeliverables: string[] = [],
) {
  return {
    primaryDeliverable,
    secondaryDeliverables: [],
    allowedInternalAnalysis,
    prohibitedDeliverables,
    artifactRequired: false,
    primaryFormat: "structured_analysis",
    secondaryFormats: [],
    namingConvention: null,
    templateRequired: false,
    completionRequirements: [
      "all_required_sections",
      "material_evidence_reviewed",
      "unresolved_gaps_flagged",
    ],
  };
}

function participantEvidence(
  requiredEvidenceCategories: string[],
  optionalEvidenceCategories: string[] = [],
  minimumEvidenceCount = 2,
  missingEvidenceBehaviour: "clarification_required" | "continue_with_flagged_gaps" | "block_completion" = "block_completion",
) {
  return {
    requiredEvidenceCategories,
    optionalEvidenceCategories,
    allowedSourceTypes: [
      "controlled_document",
      "participant_record",
      "service_agreement",
      "service_delivery_record",
      "case_note",
      "risk_assessment",
      "clinical_professional_document",
      "behaviour_support_plan",
      "restrictive_practice_record",
      "task_upload",
    ],
    restrictedSourceTypes: ["memory_only", "user_assertion_only", "uncontrolled_copy"],
    requiredEntityTypes: ["participant"],
    minimumEvidenceCount,
    freshnessRules: {
      currentnessRequired: true,
      memoryCannotProveCurrentness: true,
      historicalPlansRemainHistorical: true,
      conflictingVersionsRequireResolution: true,
    },
    claimIntegrityRequired: true,
    missingEvidenceBehaviour,
  };
}

function section(
  sectionCode: string,
  title: string,
  description: string,
  instructions: string,
  sortOrder: number,
  requiredEvidenceCategories: string[] = [],
  minimumContentExpectation: string | null = "Material section content must be present or the evidence gap must be explicitly stated.",
) {
  return {
    sectionCode,
    title,
    description,
    instructions,
    required: true,
    minimumContentExpectation,
    evidenceRequirements: requiredEvidenceCategories.length > 0
      ? { requiredEvidenceCategories, minimumEvidenceCount: 1 }
      : {},
    allowedSourceTypes: [
      "controlled_document",
      "participant_record",
      "service_delivery_record",
      "clinical_professional_document",
      "task_upload",
    ],
    prohibitedAssumptions: [
      "Do not invent participant facts.",
      "Do not treat memory or user assertion as current approved evidence.",
      "Do not change clinical, BSP, RP or safeguarding meaning.",
    ],
    validationRules: [],
    qualityCriteria: [{ criterion: "participant_centred_traceable", description: "Content is participant-centred and traceable to evidence." }],
    sortOrder,
  };
}

const CARE_PLAN_SECTIONS = [
  section("PARTICIPANT_CONTEXT", "Participant Context", "Participant identity, communication context, service setting and relevant preferences.", "Summarise verified participant context and state gaps rather than inventing missing detail.", 10, ["participant_context"]),
  section("PURPOSE_AND_SCOPE", "Purpose and Scope", "Why the plan exists and what it does and does not cover.", "Define operational/service-delivery scope and external professional dependencies.", 20),
  section("GOALS_AND_PREFERENCES", "Goals and Preferences", "Participant goals, preferences, strengths and choice/decision-making considerations.", "Distinguish activity, participation, progress, outcomes and goal achievement.", 30, ["participant_goals"]),
  section("SUPPORT_REQUIREMENTS", "Support Requirements", "Daily living, community participation, routines and implementation responsibilities.", "Translate approved support requirements into operational support instructions without changing professional meaning.", 40, ["current_support_requirements"]),
  section("RISKS_SAFEGUARDS_ESCALATION", "Risks, Safeguards and Escalation", "Known support risks, safeguards, emergency/escalation pathways and dependencies.", "Surface risk, BSP, RP, incident, clinical and mealtime dependencies for the correct authority.", 50, ["risk_context"]),
  section("MONITORING_REVIEW_GAPS", "Monitoring, Review and Evidence Gaps", "Review date, monitoring responsibilities, unresolved conflicts and missing evidence.", "Record currentness, source provenance, review requirements and unresolved evidence gaps.", 60),
];

const SUPPORT_PLAN_SECTIONS = [
  section("APPROVED_SUPPORT_BASIS", "Approved Support Basis", "Current approved requirements that govern support implementation.", "Use current approved support evidence; historical arrangements do not silently remain active.", 10, ["current_support_requirements"]),
  section("IMPLEMENTATION_REQUIREMENTS", "Implementation Requirements", "How approved supports should be implemented day to day.", "Define service-delivery implementation without roster construction or clinical/BSP/RP judgement.", 20),
  section("ROLES_HANDOFFS_ESCALATION", "Roles, Handoffs and Escalation", "Implementation responsibilities, handoffs and escalation paths.", "Route capacity, rostering, BSP, RP, incident and clinical issues to the correct owner.", 30),
  section("MONITORING_REVIEW_GAPS", "Monitoring, Review and Gaps", "Monitoring method, review triggers and missing information.", "Surface gaps and unresolved conflicts.", 40),
];

const SERVICE_REVIEW_SECTIONS = [
  section("PLANNED_SUPPORT", "Planned Support", "Approved or required support for the review period.", "Identify the current approved service requirement and its source.", 10, ["current_support_requirements"]),
  section("ACTUAL_DELIVERY", "Actual Delivery", "Evidence of supports actually delivered.", "Use actual service records, case notes and attendance evidence. Scheduled support is not proof of delivery.", 20, ["actual_service_delivery"]),
  section("VARIANCE_IMPACT", "Variance and Impact", "Variance between planned and actual support, evidence, impact and uncertainty.", "Distinguish service not delivered from delivery not evidenced.", 30),
  section("ACTION_ESCALATION", "Action and Escalation", "Required follow-up, owner, escalation and review.", "Route operational, incident, clinical, BSP, RP, rostering or quality issues to the correct owner.", 40),
];

const RISK_SECTIONS = [
  section("RISK_CONTEXT", "Risk Context", "Scope, participant context and risk domain.", "Identify whether this is service, clinical, behaviour, RP, safeguarding, WHS or environmental risk.", 10, ["participant_context"]),
  section("RISK_ANALYSIS", "Risk Analysis", "Hazard/concern, exposure, likelihood, consequence, current controls and residual risk.", "Do not collapse professional risk domains; state uncertainty and evidence basis.", 20, ["risk_context"]),
  section("CONTROLS_AND_ESCALATION", "Controls and Escalation", "Existing controls, control effectiveness, additional controls, owner and review date.", "Escalate clinical, BSP, RP, safeguarding, WHS or external authority matters.", 30),
];

const EMERGENCY_SECTIONS = [
  section("PARTICIPANT_EMERGENCY_CONTEXT", "Participant Emergency Context", "Participant-specific emergency support context.", "Identify communication, mobility, health-support and assistance needs from verified evidence.", 10, ["participant_context"]),
  section("SUPPORT_ACTIONS", "Support Actions", "Participant-specific preparedness, evacuation or emergency support actions.", "Define support actions without impersonating emergency services, fire engineer, WHS certifier or clinician.", 20),
  section("ESCALATION_AND_GAPS", "Escalation and Gaps", "Contacts, escalation triggers, evidence gaps and review requirements.", "Surface missing emergency-contact, clinical or access evidence.", 30),
];

const MEALTIME_SECTIONS = [
  section("CLINICAL_SOURCE_INSTRUCTIONS", "Clinical Source Instructions", "Current credentialed mealtime, dysphagia or swallowing instructions.", "Use only verified current credentialed professional instructions; do not diagnose or prescribe.", 10, ["credentialed_clinical_instruction"]),
  section("IMPLEMENTATION_SUPPORTS", "Implementation Supports", "Support actions staff must follow during mealtime.", "Translate approved professional instructions into support implementation without changing them.", 20),
  section("RISK_ESCALATION_GAPS", "Risk, Escalation and Gaps", "Known risks, escalation triggers, missing/expired/conflicting clinical evidence.", "Expired, missing or conflicting clinical input must block or escalate completion.", 30),
];

// ─── Blueprint Action Taxonomy ────────────────────────────────────────────────
// These are AGENT ACTIONS, not professional work blueprints.
// They may be governed by a relevant blueprint (e.g. roster planning),
// but they do not become blueprints simply because an agent can perform them.

export const BLUEPRINT_ACTIONS = [
  { code: "shift.assign",       label: "Assign Shift",              governedBy: "roster_planning" },
  { code: "message.send",       label: "Send Message",              governedBy: null },
  { code: "file.upload",        label: "Upload File",               governedBy: null },
  { code: "crm.update",         label: "Update CRM Record",         governedBy: null },
  { code: "invoice.generate",   label: "Generate Invoice",          governedBy: "business_financial_analysis" },
  { code: "calendar.book",      label: "Make Calendar Booking",     governedBy: null },
  { code: "form.submit",        label: "Submit Approved Form",      governedBy: null },
  { code: "social.post",        label: "Post Approved Content",     governedBy: null },
] as const;

export type BlueprintActionCode = (typeof BLUEPRINT_ACTIONS)[number]["code"];

// ─── The Registry ─────────────────────────────────────────────────────────────

export const BLUEPRINT_REGISTRY: RegistryEntry[] = [
  // ── Clinical: Care & Support Plans ──────────────────────────────────────────
  {
    code: "care_plan",
    blueprintFamily: "care_plan",
    title: "Care Plan",
    purpose: "Document operational/service-delivery supports for a participant. Clinical, medication, dysphagia, mealtime or other credentialed health judgements require external or appropriately credentialed professional authority.",
    category: "clinical",
    supportedModes: ["create", "review", "revise"],
    primaryDeliverable: "Care Plan document",
    maturityState: "production_ready",
    ownerType: "platform_owned",
    professionalAuthority: "mixed",
    externalAuthorityRequiredFor: [
      "clinical assessment",
      "medication judgement",
      "dysphagia or mealtime professional judgement",
      "credentialed health-support planning",
    ],
    futureOwnerRoleCode: "service_delivery_coordinator",
    supportingSpecialists: SDC_SUPPORT,
    deliverableContract: docxDeliverable("care_plan", "CARE_PLAN_{participant}_{date}", ["risk_context_review"], ["standalone_risk_assessment"]),
    evidenceContract: participantEvidence([
      "participant_context",
      "current_support_requirements",
      "participant_goals",
    ], ["risk_context", "current_bsp", "current_rp_evidence", "credentialed_clinical_instruction"], 3),
    permittedOrgOverrides: { templateSubstitution: true, outputFormatPreferences: true, namingConvention: true, approvalWorkflow: true },
    templateRequired: true,
    allowedOrgTemplateOverride: true,
    templateVersionPolicy: "pin_at_execution",
    requiredLibraryKnowledge: ["care_plan", "policy", "legislation"],
    requiredEntityKnowledge: { participant: true },
    requiredApprovals: { participant_support_content_owner: true },
    validationRules: [
      { rule: "participant_context_present", required: true, description: "Participant context must be present." },
      { rule: "current_support_requirements_present", required: true, description: "Current approved support requirements must be present or flagged as a blocker." },
      { rule: "clinical_bsp_rp_boundaries_checked", required: true, description: "Clinical, BSP and RP dependencies must be routed to the correct authority." },
    ],
    qualityRules: [
      { dimension: "participant_centred", weight: 30, description: "Participant goals, preferences and support context are represented respectfully." },
      { dimension: "evidence_traceability", weight: 30, description: "Material claims are traceable to current evidence." },
      { dimension: "boundary_integrity", weight: 25, description: "Credentialed/professional boundaries are preserved." },
      { dimension: "artifact_quality", weight: 15, description: "Document is structured, readable and complete." },
    ],
    successCriteria: ["Required sections complete", "Current evidence used", "DOCX artifact generated", "Unresolved gaps surfaced"],
    outputTypes: ["care_plan"],
    escalationRules: [
      { trigger: "clinical_judgement_required", action: "defer_to_external_or_credentialed_health_professional" },
      { trigger: "bsp_implementation_required", action: "defer_to_behaviour_support_implementation_specialist" },
      { trigger: "restrictive_practice_governance_required", action: "defer_to_authorised_program_officer" },
      { trigger: "safeguarding_or_incident_risk", action: "defer_to_incident_safeguarding_specialist" },
    ],
    mandatoryCitations: ["participant_context", "current_support_requirements"],
    sections: CARE_PLAN_SECTIONS,
  },
  {
    code: "individual_support_plan",
    blueprintFamily: "support_plan",
    title: "Individual Support / Implementation Plan",
    purpose: "Define how approved supports are coordinated and implemented for an individual participant, including service goals, delivery requirements, monitoring and escalation. Clinical, BSP, RP, legal or practitioner-level judgements require the relevant professional authority.",
    category: "clinical",
    supportedModes: ["create", "review", "revise"],
    primaryDeliverable: "Individual Support Plan document",
    maturityState: "production_ready",
    ownerType: "platform_owned",
    professionalAuthority: "mixed",
    externalAuthorityRequiredFor: [
      "clinical assessment or care planning",
      "formal Behaviour Support Plan strategy, authorship or amendment",
      "restrictive-practice authorisation or governance",
      "legal determination",
    ],
    futureOwnerRoleCode: "service_delivery_coordinator",
    supportingSpecialists: SDC_SUPPORT,
    deliverableContract: docxDeliverable("individual_support_plan", "INDIVIDUAL_SUPPORT_PLAN_{participant}_{date}", ["service_delivery_risk_review"], ["standalone_risk_assessment"]),
    evidenceContract: participantEvidence(["participant_context", "current_support_requirements"], ["participant_goals", "risk_context", "current_bsp", "current_rp_evidence"], 2),
    permittedOrgOverrides: { templateSubstitution: true, outputFormatPreferences: true, namingConvention: true, approvalWorkflow: true },
    templateRequired: true,
    allowedOrgTemplateOverride: true,
    templateVersionPolicy: "pin_at_execution",
    requiredLibraryKnowledge: ["care_plan", "policy", "service_agreement"],
    requiredEntityKnowledge: { participant: true },
    requiredApprovals: { participant_support_content_owner: true },
    validationRules: [
      { rule: "current_support_basis_present", required: true, description: "Current approved support basis must be present." },
      { rule: "implementation_boundary_checked", required: true, description: "Implementation must not replace clinical, BSP, RP, roster or legal authority." },
    ],
    qualityRules: [
      { dimension: "implementation_clarity", weight: 35, description: "Approved supports are translated into practical implementation requirements." },
      { dimension: "evidence_traceability", weight: 30, description: "Implementation instructions are traceable to current evidence." },
      { dimension: "boundary_integrity", weight: 25, description: "External/professional boundaries are preserved." },
      { dimension: "readability", weight: 10, description: "Plan is clear for service delivery teams." },
    ],
    successCriteria: ["Support basis identified", "Implementation requirements documented", "Gaps and escalations surfaced"],
    outputTypes: ["individual_support_plan"],
    escalationRules: [
      { trigger: "roster_construction_required", action: "defer_to_workforce_rostering_coordinator" },
      { trigger: "clinical_or_bsp_rp_authority_required", action: "defer_to_correct_professional_authority" },
    ],
    mandatoryCitations: ["current_support_requirements"],
    sections: SUPPORT_PLAN_SECTIONS,
  },
  {
    code: "sil_support_plan",
    blueprintFamily: "support_plan",
    title: "SIL Support & Implementation Plan",
    purpose: "Define Supported Independent Living service-delivery arrangements, required supports, support-ratio requirements, goals, implementation coordination and escalation boundaries. Roster construction, clinical decisions, BSP strategy and RP governance remain outside this work-product authority.",
    category: "clinical",
    supportedModes: ["create", "review", "revise"],
    primaryDeliverable: "SIL Support & Implementation Plan document",
    maturityState: "production_ready",
    ownerType: "platform_owned",
    professionalAuthority: "mixed",
    externalAuthorityRequiredFor: [
      "clinical assessment or care planning",
      "formal Behaviour Support Plan strategy, authorship or amendment",
      "restrictive-practice authorisation or governance",
      "roster construction and individual staff allocation",
      "legal determination",
    ],
    futureOwnerRoleCode: "service_delivery_coordinator",
    supportingSpecialists: SDC_SUPPORT,
    deliverableContract: docxDeliverable("sil_support_plan", "SIL_SUPPORT_PLAN_{participant}_{date}", ["capacity_dependency_review"], ["roster"]),
    evidenceContract: participantEvidence(["participant_context", "current_support_requirements"], ["sil_quote", "service_agreement", "risk_context", "current_bsp"], 2),
    permittedOrgOverrides: { templateSubstitution: true, outputFormatPreferences: true, namingConvention: true, approvalWorkflow: true },
    templateRequired: true,
    allowedOrgTemplateOverride: true,
    templateVersionPolicy: "pin_at_execution",
    requiredLibraryKnowledge: ["care_plan", "policy", "service_agreement"],
    requiredEntityKnowledge: { participant: true },
    requiredApprovals: { participant_support_content_owner: true },
    validationRules: [
      { rule: "sil_support_requirements_present", required: true, description: "SIL support requirements must be present." },
      { rule: "roster_boundary_checked", required: true, description: "SIL support planning must not become individual roster construction." },
    ],
    qualityRules: [
      { dimension: "support_requirement_clarity", weight: 35, description: "Support requirements and handoffs are clear." },
      { dimension: "capacity_boundary", weight: 25, description: "Capacity/roster dependencies are surfaced without constructing rosters." },
      { dimension: "evidence_traceability", weight: 25, description: "Claims are grounded in current approved evidence." },
      { dimension: "readability", weight: 15, description: "Document is usable by SIL service teams." },
    ],
    successCriteria: ["SIL support needs documented", "Roster/capacity dependencies surfaced", "Professional boundaries preserved"],
    outputTypes: ["sil_support_plan"],
    escalationRules: [
      { trigger: "individual_roster_allocation_required", action: "defer_to_workforce_rostering_coordinator" },
      { trigger: "capacity_constraint", action: "defer_to_operations_manager" },
    ],
    mandatoryCitations: ["current_support_requirements"],
    sections: SUPPORT_PLAN_SECTIONS,
  },
  {
    code: "service_delivery_review",
    blueprintFamily: "service_delivery",
    title: "Service Delivery Review",
    purpose: "Review whether approved/required participant supports were delivered as planned, what variance occurred, what evidence supports the conclusion and what action or escalation is required.",
    category: "clinical",
    supportedModes: ["review"],
    primaryDeliverable: "Service Delivery Review",
    maturityState: "production_ready",
    ownerType: "platform_owned",
    professionalAuthority: "mixed",
    externalAuthorityRequiredFor: [
      "clinical judgement",
      "formal Behaviour Support Plan amendment",
      "restrictive-practice authorisation",
      "safeguarding determination",
    ],
    futureOwnerRoleCode: SDC_OWNER,
    supportingSpecialists: ["operations_manager", "workforce_rostering_coordinator", "process_asset_coordinator", "incident_safeguarding_specialist", "compliance_quality_manager"],
    deliverableContract: structuredAnalysisDeliverable("service_delivery_review", ["variance_analysis", "risk_context_review"], ["standalone_risk_assessment"]),
    evidenceContract: participantEvidence(["current_support_requirements", "actual_service_delivery"], ["roster_schedule", "case_notes", "incident_context", "participant_goal_evidence"], 2),
    requiredLibraryKnowledge: ["care_plan", "service_agreement", "policy"],
    requiredEntityKnowledge: { participant: true },
    validationRules: [
      { rule: "planned_support_identified", required: true, description: "Current planned/approved support must be identified." },
      { rule: "actual_delivery_evidence_reviewed", required: true, description: "Actual delivery evidence must be reviewed." },
      { rule: "planned_actual_variance_model_used", required: true, description: "Review must distinguish planned, actual, variance, evidence, impact and action." },
    ],
    qualityRules: [
      { dimension: "planned_actual_reasoning", weight: 35, description: "Planned versus actual support reasoning is explicit." },
      { dimension: "evidence_traceability", weight: 30, description: "Delivery and variance conclusions are evidence-backed." },
      { dimension: "gap_discipline", weight: 20, description: "Missing evidence is not treated as proof of non-delivery." },
      { dimension: "action_clarity", weight: 15, description: "Follow-up owners and escalations are clear." },
    ],
    successCriteria: ["Planned and actual evidence reviewed", "Variance and impact stated", "Actions/escalations assigned"],
    outputTypes: ["service_delivery_review"],
    escalationRules: [
      { trigger: "delivery_not_evidenced", action: "surface_as_evidence_gap_not_automatic_non_delivery" },
      { trigger: "service_not_delivered", action: "escalate_to_service_delivery_and_operations" },
      { trigger: "incident_or_safeguarding_concern", action: "defer_to_incident_safeguarding_specialist" },
    ],
    mandatoryCitations: ["current_support_requirements", "actual_service_delivery"],
    sections: SERVICE_REVIEW_SECTIONS,
  },
  {
    code: "participant_transition_plan",
    blueprintFamily: "transition_plan",
    title: "Participant Transition & Onboarding Plan",
    purpose: "Plan the safe transition of a participant into a new service, living arrangement or provider.",
    category: "clinical",
    supportedModes: ["create", "review"],
    primaryDeliverable: "Transition & Onboarding Plan document",
    maturityState: "production_ready",
    ownerType: "platform_owned",
    professionalAuthority: "mixed",
    externalAuthorityRequiredFor: ["clinical judgement", "BSP/RP change", "legal determination"],
    futureOwnerRoleCode: SDC_OWNER,
    supportingSpecialists: SDC_SUPPORT,
    deliverableContract: docxDeliverable("participant_transition_plan", "PARTICIPANT_TRANSITION_PLAN_{participant}_{date}", ["risk_context_review"], ["standalone_risk_assessment"]),
    evidenceContract: participantEvidence(["participant_context", "current_support_requirements"], ["service_agreement", "risk_context", "transition_context"], 2),
    templateRequired: true,
    allowedOrgTemplateOverride: true,
    templateVersionPolicy: "pin_at_execution",
    requiredEntityKnowledge: { participant: true },
    requiredApprovals: { participant_support_content_owner: true },
    validationRules: [{ rule: "transition_context_present", required: true, description: "Transition context and current support basis must be present." }],
    successCriteria: ["Transition support basis identified", "Handoffs and risks surfaced", "Review responsibilities assigned"],
    outputTypes: ["participant_transition_plan"],
    mandatoryCitations: ["participant_context", "current_support_requirements"],
    sections: SUPPORT_PLAN_SECTIONS,
  },
  {
    code: "participant_goals_review",
    blueprintFamily: "goals_review",
    title: "Participant Goals & Outcomes Review",
    purpose: "Review progress against NDIS plan goals and participant outcomes, informing future planning.",
    category: "clinical",
    supportedModes: ["review", "update"],
    primaryDeliverable: "Goals & Outcomes Review report",
    maturityState: "production_ready",
    ownerType: "platform_owned",
    professionalAuthority: "mixed",
    externalAuthorityRequiredFor: ["clinical outcome determination", "BSP/RP determination", "funding or plan-management decision"],
    futureOwnerRoleCode: SDC_OWNER,
    supportingSpecialists: ["operations_manager", "compliance_quality_manager", "knowledge_documentation_specialist"],
    deliverableContract: structuredAnalysisDeliverable("participant_goals_review", ["service_delivery_review"], ["care_plan"]),
    evidenceContract: participantEvidence(["participant_goals", "actual_service_delivery"], ["participant_feedback", "case_notes", "outcome_evidence"], 2, "continue_with_flagged_gaps"),
    requiredEntityKnowledge: { participant: true },
    validationRules: [{ rule: "activity_outcome_boundary_checked", required: true, description: "Activity, participation, progress, outcome and goal achievement must be distinguished." }],
    successCriteria: ["Goals reviewed with evidence", "Activity not overstated as goal achievement", "Gaps surfaced"],
    outputTypes: ["participant_goals_review"],
    mandatoryCitations: ["participant_goals", "actual_service_delivery"],
    sections: [
      section("GOAL_CONTEXT", "Goal Context", "Current goals and review period.", "Identify current goals and evidence source.", 10, ["participant_goals"]),
      section("ACTIVITY_PARTICIPATION_PROGRESS", "Activity, Participation and Progress", "Evidence of activities, participation and progress.", "Do not claim achievement from activity alone.", 20, ["actual_service_delivery"]),
      section("OUTCOME_AND_GAPS", "Outcome and Gaps", "Outcome evidence, uncertainty, gaps and next actions.", "State whether goal achievement is evidenced, partly evidenced, not evidenced or unresolved.", 30),
    ],
  },
  {
    code: "participant_periodic_summary",
    blueprintFamily: "periodic_summary",
    title: "Participant Periodic / Weekly Summary",
    purpose: "Summarise participant progress, activities and support delivered over a defined period.",
    category: "clinical",
    supportedModes: ["weekly", "periodic"],
    primaryDeliverable: "Periodic Summary report",
    maturityState: "production_ready",
    ownerType: "platform_owned",
    professionalAuthority: "mixed",
    externalAuthorityRequiredFor: ["clinical judgement", "BSP/RP amendment", "safeguarding determination"],
    futureOwnerRoleCode: SDC_OWNER,
    supportingSpecialists: ["operations_manager", "incident_safeguarding_specialist", "knowledge_documentation_specialist"],
    deliverableContract: structuredAnalysisDeliverable("participant_periodic_summary", ["service_delivery_review"], ["care_plan", "risk_assessment"]),
    evidenceContract: participantEvidence(["actual_service_delivery"], ["participant_goals", "case_notes", "incident_context"], 1, "continue_with_flagged_gaps"),
    requiredEntityKnowledge: { participant: true },
    validationRules: [{ rule: "summary_does_not_overclaim_outcomes", required: true, description: "Summary must distinguish activity from progress/outcome." }],
    successCriteria: ["Activity and support evidence summarised", "Outcome claims limited to evidence", "Gaps surfaced"],
    outputTypes: ["participant_periodic_summary"],
    mandatoryCitations: ["actual_service_delivery"],
    sections: [
      section("PERIOD_SCOPE", "Period and Scope", "Reporting period and participant context.", "Define period and available evidence.", 10),
      section("SUPPORT_ACTIVITY_SUMMARY", "Support and Activity Summary", "Supports delivered, activities and participation evidence.", "Summarise without overstating outcomes.", 20, ["actual_service_delivery"]),
      section("PROGRESS_RISKS_GAPS", "Progress, Risks and Gaps", "Progress evidence, risks, incidents/escalations and missing information.", "Flag uncertainty and route high-risk issues.", 30),
    ],
  },
  {
    code: "support_strategy_analysis",
    blueprintFamily: "support_strategy",
    title: "Support Strategy Analysis",
    purpose: "Analyse and document the support strategies required for a participant, informed by their profile and context.",
    category: "clinical",
    supportedModes: ["proactive", "reactive", "protective", "combined"],
    primaryDeliverable: "Support Strategy Analysis report",
    maturityState: "production_ready",
    ownerType: "platform_owned",
    professionalAuthority: "mixed",
    externalAuthorityRequiredFor: ["clinical strategy", "formal Behaviour Support Plan strategy", "restrictive-practice strategy"],
    futureOwnerRoleCode: SDC_OWNER,
    supportingSpecialists: ["behaviour_support_implementation_specialist", "authorised_program_officer", "operations_manager"],
    deliverableContract: structuredAnalysisDeliverable("support_strategy_analysis", ["risk_context_review"], ["behaviour_support_plan", "restrictive_practice_authorisation"]),
    evidenceContract: participantEvidence(["participant_context", "current_support_requirements"], ["risk_context", "current_bsp", "current_rp_evidence"], 2),
    requiredEntityKnowledge: { participant: true },
    validationRules: [{ rule: "strategy_authority_boundary_checked", required: true, description: "Support strategy must not become BSP/RP/clinical professional strategy." }],
    successCriteria: ["Support strategy evidence reviewed", "BSP/RP/clinical boundaries preserved", "Actions/escalations clear"],
    outputTypes: ["support_strategy_analysis"],
    mandatoryCitations: ["participant_context", "current_support_requirements"],
    sections: SUPPORT_PLAN_SECTIONS,
  },
  {
    code: "funding_utilisation_review",
    blueprintFamily: "funding_review",
    title: "Funding / Support Utilisation Review",
    purpose: "Analyse how NDIS funding and supports have been utilised against the participant's plan budget.",
    category: "clinical",
    supportedModes: ["review"],
    primaryDeliverable: "Funding Utilisation Review report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },

  // ── Clinical: Mealtime ───────────────────────────────────────────────────────
  {
    code: "mealtime_risk_assessment",
    blueprintFamily: "mealtime",
    title: "Mealtime Risk Assessment",
    purpose: "Assess risks associated with a participant's mealtime, including swallowing, positioning and texture requirements.",
    category: "clinical",
    supportedModes: ["risk_assessment"],
    primaryDeliverable: "Mealtime Risk Assessment document",
    maturityState: "production_ready",
    ownerType: "platform_owned",
    professionalAuthority: "external_or_credentialed",
    externalAuthorityRequiredFor: ["dysphagia diagnosis", "texture/fluid modification", "swallowing recommendation", "clinical mealtime prescription"],
    futureOwnerRoleCode: SDC_OWNER,
    supportingSpecialists: ["behaviour_support_implementation_specialist", "incident_safeguarding_specialist", "compliance_quality_manager"],
    deliverableContract: docxDeliverable("mealtime_risk_assessment", "MEALTIME_RISK_ASSESSMENT_{participant}_{date}", ["implementation_gap_review"], ["clinical_mealtime_plan"]),
    evidenceContract: participantEvidence(["credentialed_clinical_instruction", "participant_context"], ["incident_context", "current_support_requirements"], 2),
    templateRequired: true,
    allowedOrgTemplateOverride: true,
    templateVersionPolicy: "pin_at_execution",
    requiredEntityKnowledge: { participant: true },
    requiredApprovals: { clinical_instruction_confirmed: true },
    validationRules: [{ rule: "credentialed_clinical_input_present", required: true, description: "Current credentialed mealtime/swallowing instructions must be present." }],
    successCriteria: ["Clinical source identified", "Implementation risks and gaps surfaced", "No clinical recommendation invented"],
    outputTypes: ["mealtime_risk_assessment"],
    escalationRules: [{ trigger: "missing_or_expired_clinical_instruction", action: "seek_credentialed_clinical_input" }],
    mandatoryCitations: ["credentialed_clinical_instruction"],
    sections: MEALTIME_SECTIONS,
  },
  {
    code: "mealtime_management_plan_review",
    blueprintFamily: "mealtime",
    title: "Mealtime Management Plan Review",
    purpose: "Review and update a participant's mealtime management plan in line with current clinical guidance.",
    category: "clinical",
    supportedModes: ["review"],
    primaryDeliverable: "Mealtime Management Plan document",
    maturityState: "production_ready",
    ownerType: "platform_owned",
    professionalAuthority: "external_or_credentialed",
    externalAuthorityRequiredFor: ["dysphagia diagnosis", "texture/fluid modification", "swallowing recommendation", "clinical mealtime prescription"],
    futureOwnerRoleCode: SDC_OWNER,
    supportingSpecialists: ["behaviour_support_implementation_specialist", "incident_safeguarding_specialist", "knowledge_documentation_specialist"],
    deliverableContract: docxDeliverable("mealtime_management_plan_review", "MEALTIME_MANAGEMENT_REVIEW_{participant}_{date}", ["implementation_gap_review"], ["clinical_mealtime_plan"]),
    evidenceContract: participantEvidence(["credentialed_clinical_instruction", "participant_context"], ["current_support_requirements", "incident_context"], 2),
    templateRequired: true,
    allowedOrgTemplateOverride: true,
    templateVersionPolicy: "pin_at_execution",
    requiredEntityKnowledge: { participant: true },
    requiredApprovals: { clinical_instruction_confirmed: true },
    validationRules: [{ rule: "current_mealtime_instruction_present", required: true, description: "Current credentialed mealtime plan/instruction must be present." }],
    successCriteria: ["Current instructions reviewed", "Implementation gaps surfaced", "No clinical recommendations invented"],
    outputTypes: ["mealtime_management_plan_review"],
    escalationRules: [{ trigger: "clinical_instruction_missing_expired_or_conflicting", action: "seek_credentialed_clinical_input" }],
    mandatoryCitations: ["credentialed_clinical_instruction"],
    sections: MEALTIME_SECTIONS,
  },
  {
    code: "dysphagia_mealtime_safety_review",
    blueprintFamily: "mealtime",
    title: "Dysphagia & Mealtime Safety Review",
    purpose: "Review dysphagia risk factors and mealtime safety practices for participants with swallowing difficulties.",
    category: "clinical",
    supportedModes: ["dysphagia"],
    primaryDeliverable: "Dysphagia & Mealtime Safety Review report",
    maturityState: "production_ready",
    ownerType: "platform_owned",
    professionalAuthority: "external_or_credentialed",
    externalAuthorityRequiredFor: ["dysphagia diagnosis", "texture/fluid modification", "swallowing recommendation", "clinical mealtime prescription"],
    futureOwnerRoleCode: SDC_OWNER,
    supportingSpecialists: ["incident_safeguarding_specialist", "compliance_quality_manager"],
    deliverableContract: structuredAnalysisDeliverable("dysphagia_mealtime_safety_review", ["implementation_gap_review"], ["clinical_recommendation"]),
    evidenceContract: participantEvidence(["credentialed_clinical_instruction", "participant_context"], ["incident_context", "current_support_requirements"], 2),
    requiredEntityKnowledge: { participant: true },
    requiredApprovals: { clinical_instruction_confirmed: true },
    validationRules: [{ rule: "dysphagia_authority_boundary_checked", required: true, description: "Review must not diagnose dysphagia or prescribe texture/fluid modifications." }],
    successCriteria: ["Credentialed source checked", "Safety implementation gaps surfaced", "Clinical authority preserved"],
    outputTypes: ["dysphagia_mealtime_safety_review"],
    escalationRules: [{ trigger: "missing_or_conflicting_speech_pathology_input", action: "seek_credentialed_clinical_input" }],
    mandatoryCitations: ["credentialed_clinical_instruction"],
    sections: MEALTIME_SECTIONS,
  },
  {
    code: "mealtime_support_strategy",
    blueprintFamily: "mealtime",
    title: "Mealtime Support Strategy",
    purpose: "Define the strategies staff must use to safely support a participant during meals.",
    category: "clinical",
    supportedModes: ["strategy"],
    primaryDeliverable: "Mealtime Support Strategy document",
    maturityState: "production_ready",
    ownerType: "platform_owned",
    professionalAuthority: "external_or_credentialed",
    externalAuthorityRequiredFor: ["dysphagia diagnosis", "texture/fluid modification", "swallowing recommendation", "clinical mealtime prescription"],
    futureOwnerRoleCode: SDC_OWNER,
    supportingSpecialists: ["behaviour_support_implementation_specialist", "knowledge_documentation_specialist"],
    deliverableContract: docxDeliverable("mealtime_support_strategy", "MEALTIME_SUPPORT_STRATEGY_{participant}_{date}", ["implementation_gap_review"], ["clinical_mealtime_plan"]),
    evidenceContract: participantEvidence(["credentialed_clinical_instruction", "participant_context"], ["current_support_requirements"], 2),
    templateRequired: true,
    allowedOrgTemplateOverride: true,
    templateVersionPolicy: "pin_at_execution",
    requiredEntityKnowledge: { participant: true },
    requiredApprovals: { clinical_instruction_confirmed: true },
    validationRules: [{ rule: "clinical_instruction_preserved", required: true, description: "Support strategy must preserve credentialed clinical instructions." }],
    successCriteria: ["Support actions reflect credentialed instruction", "Gaps surfaced", "No clinical changes invented"],
    outputTypes: ["mealtime_support_strategy"],
    escalationRules: [{ trigger: "clinical_instruction_missing_expired_or_conflicting", action: "seek_credentialed_clinical_input" }],
    mandatoryCitations: ["credentialed_clinical_instruction"],
    sections: MEALTIME_SECTIONS,
  },

  // ── Clinical: Health & Medication ───────────────────────────────────────────
  {
    code: "medication_management_review",
    blueprintFamily: "clinical_management",
    title: "Medication Management Review",
    purpose: "Review a participant's medication management practices for safety, accuracy and compliance.",
    category: "clinical",
    supportedModes: ["medication_management"],
    primaryDeliverable: "Medication Management Review report",
    maturityState: "production_ready",
    ownerType: "platform_owned",
    professionalAuthority: "external_or_credentialed",
    externalAuthorityRequiredFor: ["prescribing decision", "medication change", "clinical medication judgement"],
    futureOwnerRoleCode: SDC_OWNER,
    supportingSpecialists: ["compliance_quality_manager", "incident_safeguarding_specialist"],
    deliverableContract: structuredAnalysisDeliverable("medication_management_review", ["implementation_gap_review"], ["medication_order", "clinical_recommendation"]),
    evidenceContract: participantEvidence(["credentialed_clinical_instruction", "participant_context"], ["medication_record", "incident_context"], 2),
    requiredEntityKnowledge: { participant: true },
    requiredApprovals: { clinical_instruction_confirmed: true },
    validationRules: [{ rule: "prescribing_boundary_checked", required: true, description: "Medication review must not prescribe, change or clinically interpret medication." }],
    successCriteria: ["Medication support evidence reviewed", "Implementation gaps surfaced", "Clinical authority preserved"],
    outputTypes: ["medication_management_review"],
    escalationRules: [{ trigger: "missing_or_conflicting_medication_instruction", action: "seek_credentialed_clinical_input" }],
    mandatoryCitations: ["credentialed_clinical_instruction"],
    sections: [
      section("CURRENT_MEDICATION_SUPPORT_BASIS", "Current Medication Support Basis", "Current authorised medication support instructions.", "Use only verified current authorised medication support evidence.", 10, ["credentialed_clinical_instruction"]),
      section("IMPLEMENTATION_GAPS", "Implementation Gaps", "Support-process gaps, documentation issues and escalation needs.", "Do not prescribe or change medication; escalate clinical questions.", 20),
      section("ESCALATION_AND_REVIEW", "Escalation and Review", "Escalation, review and missing/conflicting evidence.", "Surface gaps and unresolved conflict.", 30),
    ],
  },
  {
    code: "health_support_plan",
    blueprintFamily: "clinical_management",
    title: "Health Support Plan",
    purpose: "Document a participant's health conditions, clinical needs and the health supports required.",
    category: "clinical",
    supportedModes: ["health_support"],
    primaryDeliverable: "Health Support Plan document",
    maturityState: "production_ready",
    ownerType: "platform_owned",
    professionalAuthority: "external_or_credentialed",
    externalAuthorityRequiredFor: ["clinical assessment", "diagnosis", "prescribing decision", "health-treatment recommendation"],
    futureOwnerRoleCode: SDC_OWNER,
    supportingSpecialists: ["compliance_quality_manager", "incident_safeguarding_specialist", "knowledge_documentation_specialist"],
    deliverableContract: docxDeliverable("health_support_plan", "HEALTH_SUPPORT_PLAN_{participant}_{date}", ["implementation_gap_review"], ["clinical_treatment_plan"]),
    evidenceContract: participantEvidence(["credentialed_clinical_instruction", "participant_context"], ["current_support_requirements", "risk_context"], 2),
    templateRequired: true,
    allowedOrgTemplateOverride: true,
    templateVersionPolicy: "pin_at_execution",
    requiredEntityKnowledge: { participant: true },
    requiredApprovals: { clinical_instruction_confirmed: true },
    validationRules: [{ rule: "clinical_authority_source_present", required: true, description: "Health-support plan must be based on current credentialed professional input." }],
    successCriteria: ["Clinical source preserved", "Support implementation documented", "Gaps/escalations surfaced"],
    outputTypes: ["health_support_plan"],
    escalationRules: [{ trigger: "missing_or_conflicting_clinical_input", action: "seek_credentialed_clinical_input" }],
    mandatoryCitations: ["credentialed_clinical_instruction"],
    sections: [
      section("CLINICAL_SOURCE_BASIS", "Clinical Source Basis", "Current credentialed health instructions and source provenance.", "Summarise verified instructions without changing clinical meaning.", 10, ["credentialed_clinical_instruction"]),
      section("SUPPORT_IMPLEMENTATION", "Support Implementation", "Approved health-support actions staff must implement.", "Translate approved instructions into support actions.", 20),
      section("ESCALATION_REVIEW_GAPS", "Escalation, Review and Gaps", "Escalation triggers, review date and missing/conflicting evidence.", "Surface gaps and preserve uncertainty.", 30),
    ],
  },
  {
    code: "health_clinical_escalation_plan",
    blueprintFamily: "clinical_management",
    title: "Health / Clinical Escalation Plan",
    purpose: "Define escalation pathways for a participant's health conditions, including triggers and emergency contacts.",
    category: "clinical",
    supportedModes: ["escalation"],
    primaryDeliverable: "Clinical Escalation Plan document",
    maturityState: "production_ready",
    ownerType: "platform_owned",
    professionalAuthority: "external_or_credentialed",
    externalAuthorityRequiredFor: ["clinical triage", "diagnosis", "treatment decision"],
    futureOwnerRoleCode: SDC_OWNER,
    supportingSpecialists: ["incident_safeguarding_specialist", "compliance_quality_manager"],
    deliverableContract: docxDeliverable("health_clinical_escalation_plan", "HEALTH_ESCALATION_PLAN_{participant}_{date}", ["implementation_gap_review"], ["clinical_treatment_plan"]),
    evidenceContract: participantEvidence(["credentialed_clinical_instruction", "participant_context"], ["emergency_contact", "risk_context"], 2),
    templateRequired: true,
    allowedOrgTemplateOverride: true,
    templateVersionPolicy: "pin_at_execution",
    requiredEntityKnowledge: { participant: true },
    requiredApprovals: { clinical_instruction_confirmed: true },
    validationRules: [{ rule: "clinical_escalation_source_present", required: true, description: "Escalation triggers must be based on authorised clinical/emergency instructions." }],
    successCriteria: ["Escalation source identified", "Support actions clear", "Clinical authority preserved"],
    outputTypes: ["health_clinical_escalation_plan"],
    escalationRules: [{ trigger: "urgent_or_unclear_clinical_escalation", action: "seek_credentialed_clinical_input_or_emergency_services" }],
    mandatoryCitations: ["credentialed_clinical_instruction"],
    sections: [
      section("ESCALATION_CONTEXT", "Escalation Context", "Participant health context and escalation source.", "Use verified clinical/emergency instruction.", 10, ["credentialed_clinical_instruction"]),
      section("SUPPORT_ACTIONS_AND_CONTACTS", "Support Actions and Contacts", "Required support actions, contacts and escalation pathway.", "Document actions without triage or diagnosis.", 20),
      section("REVIEW_AND_GAPS", "Review and Gaps", "Review requirements and unresolved evidence gaps.", "Surface missing or conflicting instruction.", 30),
    ],
  },

  // ── Risk: Participant & Environmental ─────────────────────────────────────────
  {
    code: "participant_risk_assessment",
    blueprintFamily: "risk_assessment",
    title: "Participant Risk Assessment",
    purpose: "Assess risks to a participant's safety and wellbeing, including physical, behavioural and environmental factors.",
    category: "risk",
    supportedModes: ["general", "health", "behavioural", "home"],
    primaryDeliverable: "Risk Assessment document",
    maturityState: "production_ready",
    ownerType: "platform_owned",
    legacyCode: "risk_assessment",
    professionalAuthority: "mixed",
    externalAuthorityRequiredFor: ["clinical risk determination", "BSP/RP risk determination", "safeguarding determination", "WHS or site technical certification"],
    futureOwnerRoleCode: SDC_OWNER,
    supportingSpecialists: ["operations_manager", "behaviour_support_implementation_specialist", "authorised_program_officer", "incident_safeguarding_specialist", "compliance_quality_manager"],
    deliverableContract: docxDeliverable("participant_risk_assessment", "PARTICIPANT_RISK_ASSESSMENT_{participant}_{date}", ["control_review"], ["clinical_risk_assessment", "behaviour_support_plan", "restrictive_practice_authorisation"]),
    evidenceContract: participantEvidence(["participant_context", "risk_context"], ["current_support_requirements", "current_bsp", "current_rp_evidence", "incident_context", "credentialed_clinical_instruction"], 2),
    templateRequired: true,
    allowedOrgTemplateOverride: true,
    templateVersionPolicy: "pin_at_execution",
    requiredEntityKnowledge: { participant: true },
    requiredApprovals: { participant_support_content_owner: true },
    validationRules: [{ rule: "risk_domain_boundary_checked", required: true, description: "Risk domain and professional owner boundaries must be identified." }],
    successCriteria: ["Hazard/exposure/likelihood/consequence/control model used", "Residual risk and review owner documented", "Domain boundaries preserved"],
    outputTypes: ["participant_risk_assessment"],
    escalationRules: [
      { trigger: "clinical_risk_authority_required", action: "seek_credentialed_clinical_input" },
      { trigger: "behaviour_or_rp_risk_required", action: "defer_to_bsi_or_apo" },
      { trigger: "safeguarding_risk_required", action: "defer_to_incident_safeguarding_specialist" },
    ],
    mandatoryCitations: ["participant_context", "risk_context"],
    sections: RISK_SECTIONS,
  },
  {
    code: "community_access_risk_assessment",
    blueprintFamily: "risk_assessment",
    title: "Community Access Risk Assessment",
    purpose: "Assess risks for a participant engaging in activities outside the home or service environment.",
    category: "risk",
    supportedModes: ["community_access"],
    primaryDeliverable: "Community Access Risk Assessment document",
    maturityState: "production_ready",
    ownerType: "platform_owned",
    professionalAuthority: "mixed",
    externalAuthorityRequiredFor: ["clinical risk determination", "BSP/RP risk determination", "WHS/site technical certification"],
    futureOwnerRoleCode: SDC_OWNER,
    supportingSpecialists: ["operations_manager", "behaviour_support_implementation_specialist", "authorised_program_officer", "incident_safeguarding_specialist"],
    deliverableContract: docxDeliverable("community_access_risk_assessment", "COMMUNITY_ACCESS_RISK_{participant}_{date}", ["control_review"], ["clinical_risk_assessment"]),
    evidenceContract: participantEvidence(["participant_context", "risk_context"], ["current_support_requirements", "current_bsp", "incident_context"], 2),
    templateRequired: true,
    allowedOrgTemplateOverride: true,
    templateVersionPolicy: "pin_at_execution",
    requiredEntityKnowledge: { participant: true },
    requiredApprovals: { participant_support_content_owner: true },
    validationRules: [{ rule: "community_access_scope_present", required: true, description: "Community access context and risk scope must be present." }],
    successCriteria: ["Community access risks identified", "Controls and owner documented", "External/professional boundaries preserved"],
    outputTypes: ["community_access_risk_assessment"],
    escalationRules: [{ trigger: "safeguarding_or_behaviour_risk", action: "defer_to_correct_professional_owner" }],
    mandatoryCitations: ["participant_context", "risk_context"],
    sections: RISK_SECTIONS,
  },
  {
    code: "site_environmental_risk_assessment",
    blueprintFamily: "risk_assessment",
    title: "Site & Environmental Risk Assessment",
    purpose: "Assess physical and environmental risks at a service site or participant residence.",
    category: "risk",
    supportedModes: ["site", "environmental"],
    primaryDeliverable: "Site & Environmental Risk Assessment document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "fire_risk_assessment",
    blueprintFamily: "risk_assessment",
    title: "Fire Risk Assessment",
    purpose: "Assess fire safety risks at a service site and document controls and evacuation arrangements.",
    category: "risk",
    supportedModes: ["fire"],
    primaryDeliverable: "Fire Risk Assessment document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },

  // ── Emergency & Business Continuity ──────────────────────────────────────────
  {
    code: "evacuation_emergency_assessment",
    blueprintFamily: "emergency_assessment",
    title: "Evacuation & Emergency Readiness Assessment",
    purpose: "Assess the organisation's readiness to safely evacuate participants and staff in an emergency.",
    category: "emergency",
    supportedModes: ["evacuation"],
    primaryDeliverable: "Evacuation & Emergency Readiness Assessment document",
    maturityState: "production_ready",
    ownerType: "platform_owned",
    professionalAuthority: "mixed",
    externalAuthorityRequiredFor: ["fire engineering", "emergency-services authority", "WHS technical certification", "clinical authority"],
    futureOwnerRoleCode: "operations_manager",
    supportingSpecialists: [SDC_OWNER, "process_asset_coordinator", "compliance_quality_manager", "incident_safeguarding_specialist"],
    deliverableContract: structuredAnalysisDeliverable("evacuation_emergency_assessment", ["participant_support_dependency_review"], ["fire_safety_certification"]),
    evidenceContract: participantEvidence(["participant_context", "risk_context"], ["site_emergency_plan", "mobility_support_evidence", "credentialed_clinical_instruction"], 2),
    requiredEntityKnowledge: { participant: true },
    validationRules: [{ rule: "technical_authority_boundary_checked", required: true, description: "Assessment must not impersonate fire, WHS, emergency-services or clinical authority." }],
    successCriteria: ["Participant evacuation support dependencies identified", "Technical authority boundaries preserved", "Gaps/escalations surfaced"],
    outputTypes: ["evacuation_emergency_assessment"],
    escalationRules: [{ trigger: "technical_fire_or_whs_certification_required", action: "seek_external_or_authorised_technical_authority" }],
    mandatoryCitations: ["participant_context", "risk_context"],
    sections: EMERGENCY_SECTIONS,
  },
  {
    code: "participant_disaster_risk_assessment",
    blueprintFamily: "emergency_assessment",
    title: "Participant Disaster & Emergency Risk Assessment",
    purpose: "Assess risks to an individual participant during disaster or emergency events.",
    category: "emergency",
    supportedModes: ["participant"],
    primaryDeliverable: "Participant Disaster & Emergency Risk Assessment document",
    maturityState: "production_ready",
    ownerType: "platform_owned",
    professionalAuthority: "mixed",
    externalAuthorityRequiredFor: ["clinical authority", "fire/WHS technical certification", "emergency-services authority"],
    futureOwnerRoleCode: SDC_OWNER,
    supportingSpecialists: ["operations_manager", "process_asset_coordinator", "incident_safeguarding_specialist", "compliance_quality_manager"],
    deliverableContract: docxDeliverable("participant_disaster_risk_assessment", "PARTICIPANT_DISASTER_RISK_{participant}_{date}", ["emergency_support_review"], ["fire_safety_certification"]),
    evidenceContract: participantEvidence(["participant_context", "risk_context"], ["mobility_support_evidence", "emergency_contact", "credentialed_clinical_instruction"], 2),
    templateRequired: true,
    allowedOrgTemplateOverride: true,
    templateVersionPolicy: "pin_at_execution",
    requiredEntityKnowledge: { participant: true },
    requiredApprovals: { participant_support_content_owner: true },
    validationRules: [{ rule: "participant_emergency_support_scope_present", required: true, description: "Participant-specific disaster/emergency support scope must be present." }],
    successCriteria: ["Participant emergency risks documented", "Support actions and gaps identified", "Technical/clinical authority preserved"],
    outputTypes: ["participant_disaster_risk_assessment"],
    escalationRules: [{ trigger: "technical_or_clinical_authority_required", action: "seek_correct_external_or_internal_authority" }],
    mandatoryCitations: ["participant_context", "risk_context"],
    sections: EMERGENCY_SECTIONS,
  },
  {
    code: "disaster_emergency_management_plan",
    blueprintFamily: "emergency_plan",
    title: "Disaster & Emergency Management Plan",
    purpose: "Document organisational arrangements for managing disaster and emergency events.",
    category: "emergency",
    supportedModes: ["organisational"],
    primaryDeliverable: "Disaster & Emergency Management Plan document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "business_continuity_plan",
    blueprintFamily: "emergency_plan",
    title: "Business Continuity Plan / Assessment",
    purpose: "Define how the organisation will maintain critical service delivery during and after a disruptive event.",
    category: "emergency",
    supportedModes: ["business_continuity"],
    primaryDeliverable: "Business Continuity Plan document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "individual_emergency_preparedness_plan",
    blueprintFamily: "emergency_plan",
    title: "Individual Emergency Preparedness Plan",
    purpose: "Document personalised emergency preparedness arrangements for an individual participant.",
    category: "emergency",
    supportedModes: ["participant"],
    primaryDeliverable: "Individual Emergency Preparedness Plan document",
    maturityState: "production_ready",
    ownerType: "platform_owned",
    professionalAuthority: "mixed",
    externalAuthorityRequiredFor: ["clinical authority", "fire/WHS technical certification", "emergency-services authority"],
    futureOwnerRoleCode: SDC_OWNER,
    supportingSpecialists: ["operations_manager", "process_asset_coordinator", "incident_safeguarding_specialist", "knowledge_documentation_specialist"],
    deliverableContract: docxDeliverable("individual_emergency_preparedness_plan", "INDIVIDUAL_EMERGENCY_PLAN_{participant}_{date}", ["emergency_support_review"], ["fire_safety_certification"]),
    evidenceContract: participantEvidence(["participant_context", "risk_context"], ["mobility_support_evidence", "emergency_contact", "credentialed_clinical_instruction"], 2),
    templateRequired: true,
    allowedOrgTemplateOverride: true,
    templateVersionPolicy: "pin_at_execution",
    requiredEntityKnowledge: { participant: true },
    requiredApprovals: { participant_support_content_owner: true },
    validationRules: [{ rule: "individual_emergency_support_needs_present", required: true, description: "Individual emergency support needs must be present or flagged." }],
    successCriteria: ["Participant-specific emergency support actions documented", "Contacts and escalation captured", "Gaps surfaced"],
    outputTypes: ["individual_emergency_preparedness_plan"],
    escalationRules: [{ trigger: "missing_emergency_or_clinical_source", action: "seek_correct_authority_or_clarification" }],
    mandatoryCitations: ["participant_context", "risk_context"],
    sections: EMERGENCY_SECTIONS,
  },

  // ── Behaviour Support ─────────────────────────────────────────────────────────
  {
    code: "behaviour_support_plan_review",
    blueprintFamily: "behaviour_support",
    title: "Behaviour Support Implementation Review",
    purpose: "Review approved BSP implementation evidence and prepare a practitioner-review brief. Formal BSP authorship, amendment and practitioner-level strategy decisions require Behaviour Support Practitioner authority.",
    category: "behaviour",
    supportedModes: ["review", "revise", "implementation"],
    primaryDeliverable: "Behaviour Support Implementation Review report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    legacyCode: "behaviour_support_plan",
    professionalAuthority: "mixed",
    externalAuthorityRequiredFor: [
      "formal Behaviour Support Plan authorship",
      "formal Behaviour Support Plan amendment",
      "practitioner-level functional behaviour assessment",
      "practitioner-level behaviour strategy development",
    ],
    futureOwnerRoleCode: "behaviour_support_implementation_specialist",
  },
  {
    code: "behaviour_trigger_analysis",
    blueprintFamily: "behaviour_support",
    title: "Behaviour and Context Data Analysis",
    purpose: "Analyse behaviour data, antecedents and consequences to support implementation monitoring and practitioner escalation. Practitioner-level functional behaviour assessment remains external or credentialed authority.",
    category: "behaviour",
    supportedModes: ["analysis"],
    primaryDeliverable: "Behaviour Trigger Analysis report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    professionalAuthority: "mixed",
    externalAuthorityRequiredFor: ["practitioner-level functional behaviour assessment"],
    futureOwnerRoleCode: "behaviour_support_implementation_specialist",
  },

  // ── Restrictive Practices ─────────────────────────────────────────────────────
  {
    code: "restrictive_practice_risk_assessment",
    blueprintFamily: "restrictive_practice",
    title: "Restrictive Practice Risk Assessment",
    purpose: "Prepare restrictive-practice governance/risk information for APO and credentialed review. Clinical suitability, prescribing and formal authorisation remain outside normal AI authority.",
    category: "behaviour",
    supportedModes: ["risk_assessment"],
    primaryDeliverable: "Restrictive Practice Risk Assessment document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    professionalAuthority: "mixed",
    externalAuthorityRequiredFor: ["clinical suitability", "prescribing or medication decisions", "formal external authorisation"],
    futureOwnerRoleCode: "authorised_program_officer",
  },
  {
    code: "restrictive_practice_comparison",
    blueprintFamily: "restrictive_practice",
    title: "Restrictive Practice Comparison / Least Restrictive Alternatives",
    purpose: "Compare RP usage patterns, approved requirements and least-restrictive implementation options for governance and practitioner review.",
    category: "behaviour",
    supportedModes: ["comparison"],
    primaryDeliverable: "Least Restrictive Alternatives analysis document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    professionalAuthority: "mixed",
    externalAuthorityRequiredFor: ["practitioner-level behaviour strategy amendment"],
    futureOwnerRoleCode: "authorised_program_officer",
  },
  {
    code: "restrictive_practice_authorisation",
    blueprintFamily: "restrictive_practice",
    title: "Restrictive Practice Governance and Monthly Reporting",
    purpose: "Prepare restrictive-practice governance, authority/consent checking, usage reconciliation and monthly reporting evidence for internal approval workflow. This does not grant authorisation or replace external/credentialed approval.",
    category: "behaviour",
    supportedModes: ["authorisation", "governance", "monthly_reporting"],
    primaryDeliverable: "Restrictive Practice Authorisation package",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    professionalAuthority: "mixed",
    externalAuthorityRequiredFor: ["formal authorisation", "legal determination", "clinical or prescribing decision"],
    futureOwnerRoleCode: "authorised_program_officer",
  },
  {
    code: "unauthorised_restrictive_practice_review",
    blueprintFamily: "restrictive_practice",
    title: "Unauthorised Restrictive Practice Review",
    purpose: "Review incident and safeguarding implications of an identified unauthorised restrictive practice, while deferring RP governance ownership to the Authorised Program Officer.",
    category: "behaviour",
    supportedModes: ["review"],
    primaryDeliverable: "Unauthorised Restrictive Practice Review report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    professionalAuthority: "mixed",
    externalAuthorityRequiredFor: ["formal reportability/legal determination", "formal external regulatory submission"],
    futureOwnerRoleCode: "incident_safeguarding_specialist",
  },

  // ── Incidents & Safeguarding ──────────────────────────────────────────────────
  {
    code: "incident_investigation",
    blueprintFamily: "incident",
    title: "Incident Investigation",
    purpose: "Conduct a structured investigation of an incident to identify contributing factors and corrective actions.",
    category: "incident",
    supportedModes: ["investigation"],
    primaryDeliverable: "Incident Investigation report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "incident_review_improvement",
    blueprintFamily: "incident",
    title: "Incident Review & Improvement Plan",
    purpose: "Review an incident or group of incidents and produce a structured improvement plan.",
    category: "incident",
    supportedModes: ["review"],
    primaryDeliverable: "Incident Review & Improvement Plan document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "reportable_incident_assessment",
    blueprintFamily: "incident",
    title: "Reportable Incident Assessment",
    purpose: "Assess whether an incident meets the NDIS reportable incident threshold and prepare the required documentation.",
    category: "incident",
    supportedModes: ["reportable"],
    primaryDeliverable: "Reportable Incident Assessment document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "safeguarding_assessment",
    blueprintFamily: "safeguarding",
    title: "Safeguarding Assessment",
    purpose: "Assess safeguarding concerns for a participant and document protective actions.",
    category: "incident",
    supportedModes: ["assessment"],
    primaryDeliverable: "Safeguarding Assessment report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },

  // ── Quality Improvement ───────────────────────────────────────────────────────
  {
    code: "corrective_action_improvement",
    blueprintFamily: "quality_improvement",
    title: "Corrective Action & Continuous Improvement",
    purpose: "Document corrective actions arising from incidents, audits or complaints and track improvement outcomes.",
    category: "quality",
    supportedModes: ["corrective_action"],
    primaryDeliverable: "Corrective Action & Improvement Plan document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    legacyCode: "action_plan",
  },

  // ── Governance & Clinical Governance ─────────────────────────────────────────
  {
    code: "clinical_governance_review",
    blueprintFamily: "governance",
    title: "Clinical Governance Review",
    purpose: "Review clinical governance arrangements to ensure safe, quality and accountable service delivery.",
    category: "governance",
    supportedModes: ["clinical"],
    primaryDeliverable: "Clinical Governance Review report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "governance_executive_review",
    blueprintFamily: "governance",
    title: "Governance / Executive Review",
    purpose: "Prepare governance and executive review materials for leadership and board oversight.",
    category: "governance",
    supportedModes: ["executive"],
    primaryDeliverable: "Governance Review report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    legacyCode: "executive_brief",
  },

  // ── Workforce ─────────────────────────────────────────────────────────────────
  {
    code: "rostering_fatigue_review",
    blueprintFamily: "workforce_ops",
    title: "Rostering & Fatigue Review",
    purpose: "Review roster patterns for fatigue, rest, working-time and workforce wellbeing concerns using verified roster and availability evidence. Final industrial/legal interpretation remains external or Payroll & Workforce Cost authority where required.",
    category: "workforce",
    supportedModes: ["fatigue_review"],
    primaryDeliverable: "Rostering & Fatigue Review report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    professionalAuthority: "mixed",
    externalAuthorityRequiredFor: [
      "final SCHADS or industrial determination",
      "legal opinion",
      "payroll entitlement calculation",
      "employment or disciplinary decision",
    ],
    futureOwnerRoleCode: "workforce_rostering_coordinator",
  },
  {
    code: "roster_planning",
    blueprintFamily: "workforce_ops",
    title: "Roster Planning & Workforce Allocation",
    purpose: "Plan and document draft roster coverage, shift allocation, vacancies, conflicts and roster optimisation from verified service requirements, worker availability and worker eligibility. This does not authorise changing service requirements or bypassing hard constraints.",
    category: "workforce",
    supportedModes: ["planning"],
    primaryDeliverable: "Roster Plan document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    professionalAuthority: "mixed",
    externalAuthorityRequiredFor: [
      "service requirement determination",
      "credential or qualification certification",
      "final SCHADS, payroll or industrial determination",
      "employment or disciplinary decision",
      "clinical, BSP or restrictive-practice professional decision",
    ],
    futureOwnerRoleCode: "workforce_rostering_coordinator",
  },
  {
    code: "workforce_performance_review",
    blueprintFamily: "workforce_ops",
    title: "Workforce Performance & Competency Review",
    purpose: "Review employee performance and development against role expectations using current evidence, employee response and procedural fairness, with workforce compliance limited to credential and mandatory requirement evidence.",
    category: "workforce",
    supportedModes: ["performance_review"],
    primaryDeliverable: "Performance & Competency Review document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    legacyCode: "performance_review",
    professionalAuthority: "needsops_ai",
    futureOwnerRoleCode: "people_culture_manager",
  },
  {
    code: "people_management_review",
    blueprintFamily: "people_culture",
    title: "People Management Review",
    purpose: "Prepare evidence-led employee relations, probation, grievance, conduct, workplace adjustment, supervision, retention, onboarding or offboarding analysis with procedural fairness and specialist-boundary controls.",
    category: "workforce",
    supportedModes: [
      "performance_management",
      "probation_review",
      "employee_relations",
      "grievance_review",
      "conduct_review",
      "recruitment_support",
      "onboarding",
      "workplace_adjustment",
      "supervision_framework",
      "retention_review",
      "offboarding",
    ],
    primaryDeliverable: "People Management Review report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    professionalAuthority: "needsops_ai",
    externalAuthorityRequiredFor: [
      "legal advice or industrial advocacy",
      "termination, suspension or severe disciplinary decision",
      "credential or deployment eligibility certification",
      "final payroll, award, overtime, allowance or workforce-cost determination",
      "roster publication or shift allocation",
      "clinical, BSP or restrictive-practice professional decision",
    ],
    futureOwnerRoleCode: "people_culture_manager",
  },
  {
    code: "learning_capability_development_plan",
    blueprintFamily: "talent_learning",
    title: "Learning & Capability Development Plan",
    purpose: "Prepare evidence-led learning needs, competency gap, induction, onboarding learning, refresher, mandatory training, development pathway, remediation or effectiveness-review work products with root-cause and specialist-boundary controls.",
    category: "workforce",
    supportedModes: [
      "needs_analysis",
      "competency_gap_analysis",
      "training_gap_analysis",
      "induction",
      "onboarding",
      "mandatory_training",
      "refresher_training",
      "development_plan",
      "training_plan",
      "effectiveness_review",
      "capability_review",
      "remediation",
      "professional_development",
    ],
    primaryDeliverable: "Learning & Capability Development report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    professionalAuthority: "needsops_ai",
    externalAuthorityRequiredFor: [
      "competency certification or deployment eligibility",
      "disciplinary, performance-management or employment consequence",
      "policy architecture or regulatory-meaning change",
      "operational capacity, roster or payroll decision",
      "clinical, BSP or restrictive-practice professional decision",
      "legal or industrial-relations advice",
    ],
    futureOwnerRoleCode: "talent_learning_specialist",
  },
  {
    code: "workforce_compliance_assessment",
    blueprintFamily: "workforce_compliance",
    title: "Workforce Compliance & Eligibility Assessment",
    purpose: "Assess worker-level compliance and deployment eligibility using current verified credential, screening/check, training, competency, expiry and service-specific workforce evidence. This does not publish rosters, decide HR discipline, calculate pay/SCHADS, make clinical/BSP/RP/legal decisions or waive mandatory requirements.",
    category: "workforce",
    supportedModes: ["eligibility_review", "credential_review", "expiry_monitoring", "exception_review", "onboarding_readiness"],
    primaryDeliverable: "Workforce Compliance Assessment report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    professionalAuthority: "needsops_ai",
    externalAuthorityRequiredFor: [
      "legal opinion",
      "clinical or practitioner competency certification",
      "BSP decision or restrictive-practice authorisation",
      "final employment, disciplinary or recruitment decision",
      "final SCHADS, payroll or industrial determination",
      "roster publication or shift allocation",
    ],
    futureOwnerRoleCode: "workforce_compliance_specialist",
  },
  {
    code: "payroll_workforce_cost_review",
    blueprintFamily: "payroll_workforce_cost",
    title: "Payroll & Workforce Cost Review",
    purpose: "Review payroll, roster, timesheet, classification, award/rate, allowance, overtime, penalty and workforce-cost evidence to determine payroll treatment, discrepancy risk or cost implications. This does not construct rosters, certify worker eligibility, make HR decisions, execute payroll, provide legal/tax-agent advice or certify accounting/audit outcomes.",
    category: "financial",
    supportedModes: ["payroll_review", "reconciliation", "exception_review", "cost_review", "cost_calculation", "award_pay_review", "classification_pay_review", "allowance_review", "overtime_review", "penalty_rate_review", "historical_reconstruction"],
    primaryDeliverable: "Payroll & Workforce Cost Review report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    professionalAuthority: "needsops_ai",
    externalAuthorityRequiredFor: [
      "legal or industrial-relations advice",
      "registered tax-agent or accounting certification",
      "payroll-system mutation, payrun approval or fund transfer",
      "roster publication or shift allocation",
      "worker eligibility or credential certification",
      "employment, disciplinary or performance decision",
      "clinical, BSP or restrictive-practice professional decision",
    ],
    futureOwnerRoleCode: "payroll_workforce_cost_officer",
  },

  // ── Operations ────────────────────────────────────────────────────────────────
  {
    code: "operational_readiness_assessment",
    blueprintFamily: "operations",
    title: "Operational Readiness Assessment",
    purpose: "Assess organisational readiness to deliver a new or changed service, including systems, staff and resources.",
    category: "operations",
    supportedModes: ["readiness"],
    primaryDeliverable: "Operational Readiness Assessment report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "standard_operating_procedure",
    blueprintFamily: "operations",
    title: "Standard Operating Procedure",
    purpose: "Document a step-by-step procedure, work instruction or operational checklist for a recurring approved organisational process or task. This implements approved requirements and must not change policy or governance meaning.",
    category: "operations",
    supportedModes: ["create", "review", "revise", "work_instruction"],
    primaryDeliverable: "Standard Operating Procedure document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    legacyCode: "operational_procedure",
    professionalAuthority: "needsops_ai",
    externalAuthorityRequiredFor: [
      "policy approval or governance requirement change",
      "material operating-model or resource-allocation decision",
      "compliance certification or corrective-action effectiveness assurance",
      "participant service-delivery, clinical, BSP or restrictive-practice decision",
      "asset procurement, disposal, write-off or safety/technical certification",
    ],
    futureOwnerRoleCode: "process_asset_coordinator",
  },
  {
    code: "business_process_analysis",
    blueprintFamily: "operations",
    title: "Business Process Analysis",
    purpose: "Analyse an approved or current business process to identify triggers, inputs, actors, sequence, decisions, handoffs, systems, evidence, approvals, controls, exceptions, dependencies, failure points and improvement options.",
    category: "operations",
    supportedModes: ["process_analysis", "map", "review", "improvement", "workflow", "control_review", "handoff_review"],
    primaryDeliverable: "Business Process Analysis report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    professionalAuthority: "needsops_ai",
    externalAuthorityRequiredFor: [
      "policy interpretation, policy approval or governance requirement change",
      "material operating-model, priority, capacity or resource-allocation decision",
      "compliance audit certification or corrective-action effectiveness assurance",
      "participant service-delivery decision",
      "automation that bypasses approval, control or professional ownership",
    ],
    futureOwnerRoleCode: "process_asset_coordinator",
  },
  {
    code: "asset_lifecycle_review",
    blueprintFamily: "process_asset",
    title: "Asset Lifecycle & Control Review",
    purpose: "Review asset identity, register evidence, custody, location, condition, lifecycle, maintenance, inspection, defects, restrictions, warranty, replacement inputs and disposal status without certifying safety/technical status or approving procurement/disposal.",
    category: "operations",
    supportedModes: [
      "register_review",
      "lifecycle_review",
      "maintenance_review",
      "inspection_review",
      "condition_review",
      "exception_review",
      "replacement_review",
    ],
    primaryDeliverable: "Asset Lifecycle & Control Review report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    professionalAuthority: "needsops_ai",
    externalAuthorityRequiredFor: [
      "material procurement, purchase, disposal or write-off decision",
      "financial approval or accounting treatment",
      "safety-critical, technical, engineering, fire-safety, clinical or licensed certification",
      "WHS/OHS professional determination",
      "vendor instruction that creates external obligation",
    ],
    futureOwnerRoleCode: "process_asset_coordinator",
  },

  // ── Knowledge & Documentation ───────────────────────────────────────────────
  {
    code: "document_control_review",
    blueprintFamily: "knowledge_documentation",
    title: "Document Control Review",
    purpose: "Review controlled document identity, type, owner, status, version, approval/publication state, source/provenance, currentness, template requirements, access class, unresolved conflicts and artifact readiness without changing substantive professional meaning.",
    category: "documentation",
    supportedModes: ["control_review", "lifecycle_review", "version_review", "metadata_review", "review_due", "archive_review"],
    primaryDeliverable: "Document Control Review report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    professionalAuthority: "needsops_ai",
    futureOwnerRoleCode: "knowledge_documentation_specialist",
    externalAuthorityRequiredFor: [
      "policy meaning, policy approval or governance requirement change",
      "compliance assurance or systemic quality certification",
      "professional domain conclusion inside the controlled document",
      "legal retention period determination",
      "access-control override or deletion of controlled evidence",
    ],
  },
  {
    code: "knowledge_base_review",
    blueprintFamily: "knowledge_documentation",
    title: "Knowledge Base Review",
    purpose: "Assess knowledge-base hygiene, taxonomy, metadata, discoverability, retrieval quality, duplicate/superseded sources, missing ownership, knowledge gaps and review-date risks through existing KRS/provenance architecture.",
    category: "documentation",
    supportedModes: ["knowledge_base_review", "taxonomy", "retrieval_quality", "duplication_review", "gap_review", "metadata_quality"],
    primaryDeliverable: "Knowledge Base Hygiene Review report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    professionalAuthority: "needsops_ai",
    futureOwnerRoleCode: "knowledge_documentation_specialist",
    externalAuthorityRequiredFor: [
      "creating another retrieval or memory system",
      "substantive professional interpretation of retrieved knowledge",
      "broadening access permissions to improve discoverability",
    ],
  },
  {
    code: "controlled_document_assembly",
    blueprintFamily: "knowledge_documentation",
    title: "Controlled Document Assembly",
    purpose: "Assemble approved specialist content into a controlled document or artifact package using approved template structure, metadata, provenance, source/version references and task/artifact linkage. Missing professional content remains a visible gap.",
    category: "documentation",
    supportedModes: ["assembly", "template_application", "artifact_packaging", "docx_pdf_package", "controlled_publication_package"],
    primaryDeliverable: "Controlled Document Package",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    professionalAuthority: "needsops_ai",
    futureOwnerRoleCode: "knowledge_documentation_specialist",
    externalAuthorityRequiredFor: [
      "substantive professional content change",
      "controlled publication",
      "approved template publication",
      "document owner change",
      "superseding or archiving a controlled document",
    ],
  },

  // ── Policy & Governance Documents ────────────────────────────────────────────
  {
    code: "policy",
    blueprintFamily: "policy",
    title: "Policy",
    purpose: "Create, review or revise organisational policy architecture under Policy & Governance ownership. Compliance supports assurance, Knowledge & Documentation supports document control, and domain specialists own domain-specific professional conclusions.",
    category: "governance",
    supportedModes: ["create", "review", "revise"],
    primaryDeliverable: "Policy document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    legacyCode: "policy_draft",
    professionalAuthority: "needsops_ai",
    futureOwnerRoleCode: "policy_governance_specialist",
    requiredApproval: "administrator_approval",
    externalAuthorityRequiredFor: [
      "formal legal opinion",
      "domain professional conclusion",
      "clinical or practitioner decision",
      "policy approval or publication",
      "controlled-document status change",
    ],
  },
  {
    code: "governance_framework",
    blueprintFamily: "policy",
    title: "Governance Framework",
    purpose: "Design organisational governance structures, responsibilities, controls, delegations, oversight, escalation and review lifecycle requirements.",
    category: "governance",
    supportedModes: ["create", "review", "revise"],
    primaryDeliverable: "Governance Framework document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    professionalAuthority: "needsops_ai",
    futureOwnerRoleCode: "policy_governance_specialist",
    requiredApproval: "administrator_approval",
    externalAuthorityRequiredFor: [
      "formal legal opinion",
      "domain professional conclusion",
      "board or executive approval",
    ],
  },
  {
    code: "regulatory_change_impact_assessment",
    blueprintFamily: "policy",
    title: "Regulatory Change Impact Assessment",
    purpose: "Assess a verified legislative or regulatory change against current organisational policies, procedures, controls, responsibilities and implementation requirements.",
    category: "governance",
    supportedModes: ["impact_assessment", "review"],
    primaryDeliverable: "Regulatory Change Impact Assessment",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    professionalAuthority: "mixed",
    futureOwnerRoleCode: "policy_governance_specialist",
    requiredApproval: "administrator_approval",
    externalAuthorityRequiredFor: [
      "formal legal interpretation",
      "external regulator advice",
      "domain professional conclusion",
    ],
  },
  {
    code: "governance_gap_analysis",
    blueprintFamily: "policy",
    title: "Governance Gap Analysis",
    purpose: "Compare current authority, organisational context and existing governance instruments to identify gaps, conflicts, obsolete requirements and lifecycle risks.",
    category: "governance",
    supportedModes: ["gap_analysis", "review"],
    primaryDeliverable: "Governance Gap Analysis",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    professionalAuthority: "needsops_ai",
    futureOwnerRoleCode: "policy_governance_specialist",
    requiredApproval: "administrator_approval",
  },
  {
    code: "delegation_framework",
    blueprintFamily: "policy",
    title: "Delegation and Accountability Framework",
    purpose: "Define decision rights, approval boundaries, accountabilities, escalation pathways and governance controls.",
    category: "governance",
    supportedModes: ["create", "review", "revise"],
    primaryDeliverable: "Delegation and Accountability Framework",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    professionalAuthority: "needsops_ai",
    futureOwnerRoleCode: "policy_governance_specialist",
    requiredApproval: "administrator_approval",
  },

  // ── Compliance & Regulatory ───────────────────────────────────────────────────
  {
    code: "compliance_audit_readiness",
    blueprintFamily: "compliance",
    title: "Compliance & Audit Readiness Review",
    purpose: "Assess organisational readiness for an NDIS Quality & Safeguards Commission audit or review.",
    category: "compliance",
    supportedModes: ["audit_readiness"],
    primaryDeliverable: "Compliance & Audit Readiness Review report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "legislation_regulatory_review",
    blueprintFamily: "compliance",
    title: "Legislation & Regulatory Requirements Review",
    purpose: "Review relevant legislation and regulatory requirements applicable to the organisation's services.",
    category: "compliance",
    supportedModes: ["legislation_review"],
    primaryDeliverable: "Legislation & Regulatory Requirements Review report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "regulatory_change_impact",
    blueprintFamily: "compliance",
    title: "Regulatory Change Impact Assessment",
    purpose: "Assess the impact of a regulatory change on the organisation's operations and compliance obligations.",
    category: "compliance",
    supportedModes: ["impact_assessment"],
    primaryDeliverable: "Regulatory Change Impact Assessment report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "regulator_response_submission",
    blueprintFamily: "compliance",
    title: "Regulator Response / Submission Preparation",
    purpose: "Prepare a formal response or submission to a regulator, including regulatory queries and show-cause notices.",
    category: "compliance",
    supportedModes: ["response"],
    primaryDeliverable: "Regulator Response / Submission document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },

  // ── Employment & SCHADS ───────────────────────────────────────────────────────
  {
    code: "schads_award_analysis",
    blueprintFamily: "employment",
    title: "SCHADS Award Analysis",
    purpose: "Analyse Social, Community, Home Care and Disability Services Industry Award obligations and entitlements.",
    category: "compliance",
    supportedModes: ["schads_analysis"],
    primaryDeliverable: "SCHADS Award Analysis report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "employment_compliance_review",
    blueprintFamily: "employment",
    title: "Employment Compliance Review",
    purpose: "Review employment practices for compliance with applicable awards, legislation and Fair Work obligations.",
    category: "compliance",
    supportedModes: ["review"],
    primaryDeliverable: "Employment Compliance Review report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },

  // ── Financial ─────────────────────────────────────────────────────────────────
  {
    code: "business_financial_analysis",
    blueprintFamily: "financial",
    title: "Business & Financial Analysis",
    purpose: "Analyse the financial health, performance and viability of the organisation or a business unit.",
    category: "financial",
    supportedModes: ["analysis"],
    primaryDeliverable: "Business & Financial Analysis report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "financial_planning_reporting_review",
    blueprintFamily: "financial_planning",
    title: "Financial Planning & Management Reporting Review",
    purpose:
      "Develop or review budgets, forecasts, cashflow outlooks, variance analysis, management reporting, financial performance, scenarios, sensitivity analysis, profitability, workforce-cost outlook and business-case financial models using verified actuals and explicit assumptions while preserving Finance, Payroll, OM, governance, tax/legal/audit and approval boundaries.",
    category: "financial",
    supportedModes: [
      "budget",
      "forecast",
      "cashflow",
      "scenario",
      "sensitivity",
      "management_reporting",
      "variance",
      "performance",
      "profitability",
      "business_case",
    ],
    primaryDeliverable: "Financial Planning & Management Reporting Review",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    futureOwnerRoleCode: "financial_planning_reporting_manager",
  },
  {
    code: "tax_financial_obligation_review",
    blueprintFamily: "financial",
    title: "Tax & Financial Obligation Review",
    purpose: "Review tax and financial obligations applicable to the organisation.",
    category: "financial",
    supportedModes: ["tax_review"],
    primaryDeliverable: "Tax & Financial Obligation Review report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "operational_finance_reconciliation_review",
    blueprintFamily: "operational_finance",
    title: "Operational Finance & Reconciliation Review",
    purpose:
      "Review accounts payable, accounts receivable, invoices, payments, receipts, expenses, reimbursements, bank/account/supplier/customer reconciliation, duplicate risks, credit/refund evidence, financial records and finance exceptions without approving payments, fabricating entries, making payroll determinations, owning budgets/forecasts or providing tax/legal/audit advice.",
    category: "financial",
    supportedModes: [
      "reconciliation",
      "bank_reconciliation",
      "accounts_payable",
      "accounts_receivable",
      "invoice_review",
      "payment_review",
      "receipt_review",
      "expense_review",
      "transaction_review",
      "exception_review",
    ],
    primaryDeliverable: "Operational Finance & Reconciliation Review report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    futureOwnerRoleCode: "finance_officer",
  },

  // ── Strategic ─────────────────────────────────────────────────────────────────
  {
    code: "business_growth_analysis",
    blueprintFamily: "strategic",
    title: "Business Growth / Expansion Analysis",
    purpose: "Analyse opportunities and requirements for business growth or service expansion.",
    category: "strategic",
    supportedModes: ["growth_analysis"],
    primaryDeliverable: "Business Growth Analysis report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "ndis_marketing_strategy",
    blueprintFamily: "strategic",
    title: "NDIS Marketing Strategy",
    purpose: "Develop or review an NDIS marketing strategy to attract and retain participants.",
    category: "strategic",
    supportedModes: ["marketing"],
    primaryDeliverable: "NDIS Marketing Strategy document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    futureOwnerRoleCode: "marketing_communications_manager",
  },
  {
    code: "marketing_communications_review",
    blueprintFamily: "marketing_communications",
    title: "Marketing & Communications Review",
    purpose: "Develop or review marketing strategy, campaign plans, communications plans, content strategy, stakeholder messaging, public-facing copy and campaign performance from verified facts and claim-safe evidence.",
    category: "marketing",
    supportedModes: ["strategy", "campaign", "communications_plan", "content_strategy", "social_media", "website_content", "email_campaign", "stakeholder_communication", "crisis", "media", "performance"],
    primaryDeliverable: "Marketing & Communications work product",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    futureOwnerRoleCode: "marketing_communications_manager",
  },
  {
    code: "ndis_market_analysis",
    blueprintFamily: "strategic",
    title: "NDIS Market Analysis",
    purpose: "Analyse the NDIS market, including local demand, competitor landscape and pricing environment.",
    category: "strategic",
    supportedModes: ["market_analysis"],
    primaryDeliverable: "NDIS Market Analysis report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "business_proposal",
    blueprintFamily: "strategic",
    title: "Business Proposal / Business Case",
    purpose: "Prepare a formal business proposal or business case for an investment, service or initiative.",
    category: "strategic",
    supportedModes: ["create", "review"],
    primaryDeliverable: "Business Proposal / Business Case document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },

  // ── Correspondence & Complaints ───────────────────────────────────────────────
  {
    code: "formal_stakeholder_correspondence",
    blueprintFamily: "correspondence",
    title: "Formal Stakeholder Correspondence",
    purpose: "Prepare formal written correspondence to stakeholders, including participants, families, regulators and funders.",
    category: "correspondence",
    supportedModes: ["create", "review"],
    primaryDeliverable: "Formal correspondence document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    legacyCode: "customer_response",
  },
  {
    code: "complaints_review_response",
    blueprintFamily: "complaints",
    title: "Complaints Review & Response",
    purpose: "Review a participant or stakeholder complaint and prepare a formal response and corrective action plan.",
    category: "correspondence",
    supportedModes: ["review", "response"],
    primaryDeliverable: "Complaints Review & Response document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "service_agreement_review",
    blueprintFamily: "agreements",
    title: "Service Agreement Review",
    purpose: "Review a participant service agreement for currency, accuracy and compliance.",
    category: "governance",
    supportedModes: ["review", "revise"],
    primaryDeliverable: "Service Agreement Review document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the registry entry for a given blueprint code, or undefined. */
export function getRegistryEntry(code: string): RegistryEntry | undefined {
  return BLUEPRINT_REGISTRY.find(e => e.code === code);
}

/** Returns the professional owner encoded by registry metadata, if one is known. */
export function resolveRegistryProfessionalOwner(entry: RegistryEntry): string | null {
  return entry.futureOwnerRoleCode ?? null;
}

/**
 * Returns the DB-safe primarySpecialist value for registry placeholder seeding.
 *
 * This deliberately never falls back to Chief of Staff. CoS may coordinate work,
 * but unresolved professional ownership must remain visible and non-executable.
 */
export function getRegistryBlueprintSeedOwner(entry: RegistryEntry): string {
  return resolveRegistryProfessionalOwner(entry) ?? BLUEPRINT_UNRESOLVED_OWNER;
}

/**
 * Registry entries are identity/routing placeholders until domain sprints add
 * authoritative professional contracts. A known owner is necessary but not
 * sufficient for production readiness.
 */
export function getRegistryBlueprintReadinessState(entry: RegistryEntry): BlueprintReadinessState {
  if (!resolveRegistryProfessionalOwner(entry)) return "not_ready";
  if (entry.maturityState === "production_ready") return "professionally_authored";
  return entry.maturityState;
}

/** Returns all registry entries for a given family. */
export function getRegistryByFamily(family: string): RegistryEntry[] {
  return BLUEPRINT_REGISTRY.filter(e => e.blueprintFamily === family);
}

/** Returns true if the given code is a registered action, not a blueprint. */
export function isAction(code: string): boolean {
  return BLUEPRINT_ACTIONS.some(a => a.code === code);
}

/** Map of old legacy codes → new registry entry. Used during migration. */
export const LEGACY_CODE_MAP: Record<string, string> = Object.fromEntries(
  BLUEPRINT_REGISTRY
    .filter(e => e.legacyCode)
    .map(e => [e.legacyCode!, e.code]),
);
