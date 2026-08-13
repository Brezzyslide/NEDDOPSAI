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
    purpose: "Define how NDIS supports are delivered to an individual participant, including goals and implementation strategies.",
    category: "clinical",
    supportedModes: ["create", "review", "revise"],
    primaryDeliverable: "Individual Support Plan document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "sil_support_plan",
    blueprintFamily: "support_plan",
    title: "SIL Support & Implementation Plan",
    purpose: "Define Supported Independent Living arrangements, staffing ratios, goals and implementation strategies.",
    category: "clinical",
    supportedModes: ["create", "review", "revise"],
    primaryDeliverable: "SIL Support & Implementation Plan document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
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
    title: "Behaviour Support Plan Review",
    purpose: "Review approved BSP implementation evidence and prepare a practitioner-review brief. Formal BSP authorship, amendment and practitioner-level strategy decisions require Behaviour Support Practitioner authority.",
    category: "behaviour",
    supportedModes: ["review", "revise", "implementation"],
    primaryDeliverable: "Behaviour Support Plan Review report",
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
    title: "Behaviour / Trigger Analysis",
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
    title: "Restrictive Practice Authorisation Preparation",
    purpose: "Prepare supporting evidence for restrictive-practice authority pathway review. This does not grant authorisation or replace external/credentialed approval.",
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
    purpose: "Review incident and safeguarding implications of an identified unauthorised restrictive practice, while deferring RP governance ownership to the future APO.",
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
    purpose: "Review rostering patterns for compliance with fatigue management requirements and workforce wellbeing.",
    category: "workforce",
    supportedModes: ["fatigue_review"],
    primaryDeliverable: "Rostering & Fatigue Review report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "roster_planning",
    blueprintFamily: "workforce_ops",
    title: "Roster Planning & Workforce Allocation",
    purpose: "Plan and document workforce rostering and allocation to meet participant support requirements.",
    category: "workforce",
    supportedModes: ["planning"],
    primaryDeliverable: "Roster Plan document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },
  {
    code: "workforce_performance_review",
    blueprintFamily: "workforce_ops",
    title: "Workforce Performance & Competency Review",
    purpose: "Review staff performance and development against role requirements, with workforce compliance limited to credential and mandatory requirement evidence.",
    category: "workforce",
    supportedModes: ["performance_review"],
    primaryDeliverable: "Performance & Competency Review document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    legacyCode: "performance_review",
    professionalAuthority: "needsops_ai",
    futureOwnerRoleCode: "people_culture_manager",
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
    purpose: "Document a step-by-step procedure for a recurring organisational process or task.",
    category: "operations",
    supportedModes: ["create", "review", "revise"],
    primaryDeliverable: "Standard Operating Procedure document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    legacyCode: "operational_procedure",
  },
  {
    code: "business_process_analysis",
    blueprintFamily: "operations",
    title: "Business Process Analysis",
    purpose: "Analyse an existing business process to identify inefficiencies and improvement opportunities.",
    category: "operations",
    supportedModes: ["process_analysis"],
    primaryDeliverable: "Business Process Analysis report",
    maturityState: "placeholder",
    ownerType: "platform_owned",
  },

  // ── Policy & Governance Documents ────────────────────────────────────────────
  {
    code: "policy",
    blueprintFamily: "policy",
    title: "Policy",
    purpose: "Create, review or revise organisational policy architecture. Future professional ownership belongs to Policy & Governance; compliance and documentation roles support assurance and document-control only until that DNA is authored.",
    category: "governance",
    supportedModes: ["create", "review", "revise"],
    primaryDeliverable: "Policy document",
    maturityState: "placeholder",
    ownerType: "platform_owned",
    legacyCode: "policy_draft",
    professionalAuthority: "needsops_ai",
    futureOwnerRoleCode: "policy_governance_specialist",
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
