import type { ProfessionalOperation } from "../../services/professionalExecutionContextService.js";

export type BlueprintSelectionSealedV2Case = {
  request: string;
  expectedIntent: string | null;
  expectedBlueprintCode: string | null;
  expectedOperation: ProfessionalOperation;
  ambiguity?: string;
};

export const BLUEPRINT_SELECTION_SEALED_CORPUS_V2: BlueprintSelectionSealedV2Case[] = [
  {
    request: "Can you draft the agreement pack we give every new NDIS participant before services start",
    expectedIntent: "agreements.create",
    expectedBlueprintCode: "service_agreement_review",
    expectedOperation: "CREATE",
  },
  {
    request: "This agreement has been signed but I need to know if the schedule and cancellation clauses are safe",
    expectedIntent: "agreements.review",
    expectedBlueprintCode: "service_agreement_review",
    expectedOperation: "REVIEW",
  },
  {
    request: "Put together a reusable support plan template for daily routines, goals and escalation notes",
    expectedIntent: "support_plan.create",
    expectedBlueprintCode: "individual_support_plan",
    expectedOperation: "CREATE",
  },
  {
    request: "Look over the participant's support plan and tell me what the team still needs to fix",
    expectedIntent: "support_plan.review",
    expectedBlueprintCode: "individual_support_plan",
    expectedOperation: "REVIEW",
  },
  {
    request: "Build a standard care planning document that workers can use before onboarding a new participant",
    expectedIntent: "care_plan.create",
    expectedBlueprintCode: "care_plan",
    expectedOperation: "CREATE",
    ambiguity: "care plan vs individual support plan",
  },
  {
    request: "The uploaded care plan has gaps around medication, behaviour and incident escalation, please assess it",
    expectedIntent: "care_plan.review",
    expectedBlueprintCode: "care_plan",
    expectedOperation: "REVIEW",
  },
  {
    request: "We need the shopping trip risk paperwork ready for community access next week",
    expectedIntent: "risk_assessment.community_access",
    expectedBlueprintCode: "community_access_risk_assessment",
    expectedOperation: "CREATE",
  },
  {
    request: "Can you check if the house fire evacuation risk assessment still covers the current layout",
    expectedIntent: "risk_assessment.fire",
    expectedBlueprintCode: "fire_risk_assessment",
    expectedOperation: "REVIEW",
    ambiguity: "fire risk assessment vs emergency preparedness planning",
  },
  {
    request: "Assess the backyard and driveway hazards at the service site before we open the program",
    expectedIntent: "risk_assessment.site",
    expectedBlueprintCode: "site_environmental_risk_assessment",
    expectedOperation: "ASSESS",
  },
  {
    request: "Compare the proposed restrictive practice options and tell me which is least restrictive",
    expectedIntent: "restrictive_practice.comparison",
    expectedBlueprintCode: "restrictive_practice_comparison",
    expectedOperation: "COMPARE",
  },
  {
    request: "The team used a restriction that might not be authorised, review what happened",
    expectedIntent: "restrictive_practice.review",
    expectedBlueprintCode: "unauthorised_restrictive_practice_review",
    expectedOperation: "REVIEW",
  },
  {
    request: "Prepare the monthly restrictive practice evidence pack for governance sign off",
    expectedIntent: "restrictive_practice.authorisation",
    expectedBlueprintCode: "restrictive_practice_authorisation",
    expectedOperation: "CREATE",
  },
  {
    request: "Participant choked during lunch yesterday, draft the investigation report and immediate actions",
    expectedIntent: "incident.investigation",
    expectedBlueprintCode: "incident_investigation",
    expectedOperation: "INVESTIGATE",
  },
  {
    request: "Does this medication error meet reportable incident thresholds or can it stay internal",
    expectedIntent: "incident.reportable",
    expectedBlueprintCode: "reportable_incident_assessment",
    expectedOperation: "ASSESS",
  },
  {
    request: "Review our response to the family complaint before I approve the wording",
    expectedIntent: "complaints.response",
    expectedBlueprintCode: "complaints_review_response",
    expectedOperation: "REVIEW",
  },
  {
    request: "Write a complaints handling policy for participants, families and advocates",
    expectedIntent: "policy.create",
    expectedBlueprintCode: "policy",
    expectedOperation: "CREATE",
  },
  {
    request: "The privacy policy is old, check it against current NDIS provider expectations",
    expectedIntent: "policy.review",
    expectedBlueprintCode: "policy",
    expectedOperation: "REVIEW",
  },
  {
    request: "Create an SOP for medication handover between morning and evening staff",
    expectedIntent: "operations.sop.create",
    expectedBlueprintCode: "standard_operating_procedure",
    expectedOperation: "CREATE",
  },
  {
    request: "Map the referral intake process and show where responsibilities hand over",
    expectedIntent: "process.map",
    expectedBlueprintCode: "business_process_analysis",
    expectedOperation: "CREATE",
  },
  {
    request: "Check whether our delegation framework leaves any approval gaps",
    expectedIntent: "governance.gap_analysis",
    expectedBlueprintCode: "governance_gap_analysis",
    expectedOperation: "ASSESS",
    ambiguity: "governance gap analysis vs delegation framework",
  },
  {
    request: "Draft a short board paper explaining the new governance framework",
    expectedIntent: "governance.framework",
    expectedBlueprintCode: "governance_framework",
    expectedOperation: "CREATE",
  },
  {
    request: "New support worker starts Monday, give me the onboarding checklist and evidence record",
    expectedIntent: "people.onboarding",
    expectedBlueprintCode: "people_management_review",
    expectedOperation: "CREATE",
  },
  {
    request: "Look at these staff credentials and tell me who is out of date",
    expectedIntent: "workforce_compliance.credential_review",
    expectedBlueprintCode: "workforce_compliance_assessment",
    expectedOperation: "REVIEW",
  },
  {
    request: "Can you identify training gaps for workers supporting participants with swallowing risks",
    expectedIntent: "learning.training_gap_analysis",
    expectedBlueprintCode: "learning_capability_development_plan",
    expectedOperation: "ASSESS",
  },
  {
    request: "Check the roster against SCHADS rules for broken shifts and overtime",
    expectedIntent: "employment.schads_analysis",
    expectedBlueprintCode: "schads_award_analysis",
    expectedOperation: "REVIEW",
  },
  {
    request: "Build a monthly cash flow view for the next quarter and highlight hiring risk",
    expectedIntent: "financial_planning.cashflow",
    expectedBlueprintCode: "financial_planning_reporting_review",
    expectedOperation: "CREATE",
  },
  {
    request: "Review this invoice batch and find NDIS claiming reconciliation issues",
    expectedIntent: "finance.accounts_payable",
    expectedBlueprintCode: "operational_finance_reconciliation_review",
    expectedOperation: "REVIEW",
  },
  {
    request: "Draft a letter to the guardian explaining the change in Saturday support times",
    expectedIntent: "correspondence.create",
    expectedBlueprintCode: "formal_stakeholder_correspondence",
    expectedOperation: "CREATE",
  },
  {
    request: "Can you help me reset the printer password",
    expectedIntent: null,
    expectedBlueprintCode: null,
    expectedOperation: "CREATE",
  },
  {
    request: "Please remind me tomorrow morning to call the plumber",
    expectedIntent: null,
    expectedBlueprintCode: null,
    expectedOperation: "CREATE",
  },
];
