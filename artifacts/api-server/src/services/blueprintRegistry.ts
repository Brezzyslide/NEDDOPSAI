/**
 * Blueprint Registry — Production Blueprint Architecture
 *
 * Canonical registry of 59 professional work types for the NeedsOps platform.
 * Contains IDENTITY AND CLASSIFICATION METADATA ONLY.
 *
 * Professional content (sections, evidence requirements, validation rules, etc.)
 * is NOT populated here. It will be added separately from real organisational
 * source documents once this architecture is accepted.
 *
 * Rules:
 *  - All registry entries are platform_owned.
 *  - All entries start at maturityState = "placeholder".
 *  - No section content, no evidence rules, no internal instructions.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type BlueprintMaturityState =
  | "placeholder"
  | "draft"
  | "professional_review"
  | "production_ready"
  | "superseded";

export type BlueprintOwnerType = "platform_owned" | "organisation_owned";

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
}

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
    maturityState: "placeholder",
    ownerType: "platform_owned",
    professionalAuthority: "mixed",
    externalAuthorityRequiredFor: [
      "clinical assessment",
      "medication judgement",
      "dysphagia or mealtime professional judgement",
      "credentialed health-support planning",
    ],
    futureOwnerRoleCode: "service_delivery_coordinator",
  },
  {
    code: "individual_support_plan",
    blueprintFamily: "support_plan",
    title: "Individual Support / Implementation Plan",
    purpose: "Define how approved supports are coordinated and implemented for an individual participant, including service goals, delivery requirements, monitoring and escalation. Clinical, BSP, RP, legal or practitioner-level judgements require the relevant professional authority.",
    category: "clinical",
    supportedModes: ["create", "review", "revise"],
    primaryDeliverable: "Individual Support Plan document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    professionalAuthority: "mixed",
    externalAuthorityRequiredFor: [
      "clinical assessment or care planning",
      "formal Behaviour Support Plan strategy, authorship or amendment",
      "restrictive-practice authorisation or governance",
      "legal determination",
    ],
    futureOwnerRoleCode: "service_delivery_coordinator",
  },
  {
    code: "sil_support_plan",
    blueprintFamily: "support_plan",
    title: "SIL Support & Implementation Plan",
    purpose: "Define Supported Independent Living service-delivery arrangements, required supports, support-ratio requirements, goals, implementation coordination and escalation boundaries. Roster construction, clinical decisions, BSP strategy and RP governance remain outside this work-product authority.",
    category: "clinical",
    supportedModes: ["create", "review", "revise"],
    primaryDeliverable: "SIL Support & Implementation Plan document",
    maturityState: "placeholder",
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
  },
  {
    code: "participant_transition_plan",
    blueprintFamily: "transition_plan",
    title: "Participant Transition & Onboarding Plan",
    purpose: "Plan the safe transition of a participant into a new service, living arrangement or provider.",
    category: "clinical",
    supportedModes: ["create", "review"],
    primaryDeliverable: "Transition & Onboarding Plan document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "participant_goals_review",
    blueprintFamily: "goals_review",
    title: "Participant Goals & Outcomes Review",
    purpose: "Review progress against NDIS plan goals and participant outcomes, informing future planning.",
    category: "clinical",
    supportedModes: ["review", "update"],
    primaryDeliverable: "Goals & Outcomes Review report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "participant_periodic_summary",
    blueprintFamily: "periodic_summary",
    title: "Participant Periodic / Weekly Summary",
    purpose: "Summarise participant progress, activities and support delivered over a defined period.",
    category: "clinical",
    supportedModes: ["weekly", "periodic"],
    primaryDeliverable: "Periodic Summary report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "support_strategy_analysis",
    blueprintFamily: "support_strategy",
    title: "Support Strategy Analysis",
    purpose: "Analyse and document the support strategies required for a participant, informed by their profile and context.",
    category: "clinical",
    supportedModes: ["proactive", "reactive", "protective", "combined"],
    primaryDeliverable: "Support Strategy Analysis report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
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
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "mealtime_management_plan_review",
    blueprintFamily: "mealtime",
    title: "Mealtime Management Plan Review",
    purpose: "Review and update a participant's mealtime management plan in line with current clinical guidance.",
    category: "clinical",
    supportedModes: ["review"],
    primaryDeliverable: "Mealtime Management Plan document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "dysphagia_mealtime_safety_review",
    blueprintFamily: "mealtime",
    title: "Dysphagia & Mealtime Safety Review",
    purpose: "Review dysphagia risk factors and mealtime safety practices for participants with swallowing difficulties.",
    category: "clinical",
    supportedModes: ["dysphagia"],
    primaryDeliverable: "Dysphagia & Mealtime Safety Review report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "mealtime_support_strategy",
    blueprintFamily: "mealtime",
    title: "Mealtime Support Strategy",
    purpose: "Define the strategies staff must use to safely support a participant during meals.",
    category: "clinical",
    supportedModes: ["strategy"],
    primaryDeliverable: "Mealtime Support Strategy document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
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
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "health_support_plan",
    blueprintFamily: "clinical_management",
    title: "Health Support Plan",
    purpose: "Document a participant's health conditions, clinical needs and the health supports required.",
    category: "clinical",
    supportedModes: ["health_support"],
    primaryDeliverable: "Health Support Plan document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "health_clinical_escalation_plan",
    blueprintFamily: "clinical_management",
    title: "Health / Clinical Escalation Plan",
    purpose: "Define escalation pathways for a participant's health conditions, including triggers and emergency contacts.",
    category: "clinical",
    supportedModes: ["escalation"],
    primaryDeliverable: "Clinical Escalation Plan document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
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
    maturityState: "placeholder",
    ownerType: "platform_owned",
    legacyCode: "risk_assessment",
  },
  {
    code: "community_access_risk_assessment",
    blueprintFamily: "risk_assessment",
    title: "Community Access Risk Assessment",
    purpose: "Assess risks for a participant engaging in activities outside the home or service environment.",
    category: "risk",
    supportedModes: ["community_access"],
    primaryDeliverable: "Community Access Risk Assessment document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
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
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "participant_disaster_risk_assessment",
    blueprintFamily: "emergency_assessment",
    title: "Participant Disaster & Emergency Risk Assessment",
    purpose: "Assess risks to an individual participant during disaster or emergency events.",
    category: "emergency",
    supportedModes: ["participant"],
    primaryDeliverable: "Participant Disaster & Emergency Risk Assessment document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
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
    maturityState: "placeholder",
    ownerType: "platform_owned",
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
