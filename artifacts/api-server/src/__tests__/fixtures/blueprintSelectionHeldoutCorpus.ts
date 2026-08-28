import type { ProfessionalOperation } from "../../services/professionalExecutionContextService.js";

export type BlueprintSelectionHeldoutCase = {
  request: string;
  expectedIntent: string | null;
  expectedBlueprintCode: string | null;
  expectedOperation: ProfessionalOperation;
  ambiguity?: string;
};

export const BLUEPRINT_SELECTION_HELDOUT_CORPUS: BlueprintSelectionHeldoutCase[] = [
  {
    request: "Need someone to look at the comm access risk stuff from yesterday and tell me if we are compliant",
    expectedIntent: "risk_assessment.community_access",
    expectedBlueprintCode: "community_access_risk_assessment",
    expectedOperation: "REVIEW",
    ambiguity: "risk assessment vs compliance review",
  },
  {
    request: "Can you make me a quick staff starter pack checklist for the next support worker",
    expectedIntent: "people.onboarding",
    expectedBlueprintCode: "people_management_review",
    expectedOperation: "CREATE",
    ambiguity: "people onboarding vs learning induction",
  },
  {
    request: "Before we send it out, check the service agreement template please",
    expectedIntent: "agreements.review",
    expectedBlueprintCode: "service_agreement_review",
    expectedOperation: "REVIEW",
  },
  {
    request: "I need a fresh agreement for NDIS services, standard one, not client specific",
    expectedIntent: "agreements.create",
    expectedBlueprintCode: "service_agreement_review",
    expectedOperation: "CREATE",
  },
  {
    request: "Could you sort out a care planning template that covers the main support areas",
    expectedIntent: "care_plan.create",
    expectedBlueprintCode: "care_plan",
    expectedOperation: "CREATE",
  },
  {
    request: "Please look over the care plan we uploaded and flag gaps",
    expectedIntent: "care_plan.review",
    expectedBlueprintCode: "care_plan",
    expectedOperation: "REVIEW",
  },
  {
    request: "The current support plan is old, can you refresh it for the team",
    expectedIntent: "support_plan.revise",
    expectedBlueprintCode: "individual_support_plan",
    expectedOperation: "UPDATE",
  },
  {
    request: "Make a form for risks when people go shopping or out in the community",
    expectedIntent: "risk_assessment.community_access",
    expectedBlueprintCode: "community_access_risk_assessment",
    expectedOperation: "CREATE",
    ambiguity: "community access risk vs generic risk template",
  },
  {
    request: "Do a check on the fire evacuation risk docs",
    expectedIntent: "risk_assessment.fire",
    expectedBlueprintCode: "fire_risk_assessment",
    expectedOperation: "REVIEW",
    ambiguity: "fire risk vs evacuation emergency assessment",
  },
  {
    request: "We had an injury last night, need the investigation paperwork drafted",
    expectedIntent: "incident.investigation",
    expectedBlueprintCode: "incident_investigation",
    expectedOperation: "INVESTIGATE",
  },
  {
    request: "Is this incident reportable under NDIS rules, can you assess it",
    expectedIntent: "incident.reportable",
    expectedBlueprintCode: "reportable_incident_assessment",
    expectedOperation: "REVIEW",
    ambiguity: "incident review vs reportable incident assessment",
  },
  {
    request: "Please review the complaint response before we send it",
    expectedIntent: "complaints.response",
    expectedBlueprintCode: "complaints_review_response",
    expectedOperation: "REVIEW",
    ambiguity: "complaints response vs correspondence review",
  },
  {
    request: "Write a medication management policy for the house",
    expectedIntent: "policy.create",
    expectedBlueprintCode: "policy",
    expectedOperation: "CREATE",
  },
  {
    request: "Look at our medication policy and tell me what needs fixing",
    expectedIntent: "policy.review",
    expectedBlueprintCode: "policy",
    expectedOperation: "REVIEW",
  },
  {
    request: "Can you build an SOP for shift handover",
    expectedIntent: "operations.sop.create",
    expectedBlueprintCode: "standard_operating_procedure",
    expectedOperation: "CREATE",
  },
  {
    request: "Can you review the shift handover SOP",
    expectedIntent: "operations.sop.review",
    expectedBlueprintCode: "standard_operating_procedure",
    expectedOperation: "REVIEW",
  },
  {
    request: "We need a governance pack for delegations and decision making",
    expectedIntent: "governance.framework",
    expectedBlueprintCode: "governance_framework",
    expectedOperation: "CREATE",
    ambiguity: "governance framework vs delegation framework",
  },
  {
    request: "Can you find gaps in our governance setup",
    expectedIntent: "governance.gap_analysis",
    expectedBlueprintCode: "governance_gap_analysis",
    expectedOperation: "REVIEW",
  },
  {
    request: "New worker has expired checks maybe, do a credential review",
    expectedIntent: "workforce_compliance.credential_review",
    expectedBlueprintCode: "workforce_compliance_assessment",
    expectedOperation: "REVIEW",
    ambiguity: "credential review vs expiry monitoring",
  },
  {
    request: "Need the training gaps for the support team mapped out",
    expectedIntent: "learning.training_gap_analysis",
    expectedBlueprintCode: "learning_capability_development_plan",
    expectedOperation: "REVIEW",
    ambiguity: "learning gap analysis vs workforce compliance",
  },
  {
    request: "Can you pull together a cash flow view for the next quarter",
    expectedIntent: "financial_planning.cashflow",
    expectedBlueprintCode: "financial_planning_reporting_review",
    expectedOperation: "CREATE",
  },
  {
    request: "Please check the SCHADS rates against this roster",
    expectedIntent: "employment.schads_analysis",
    expectedBlueprintCode: "schads_award_analysis",
    expectedOperation: "REVIEW",
    ambiguity: "employment compliance vs rostering fatigue/workforce cost",
  },
  {
    request: "Make a spreadsheet for monthly budget variance tracking",
    expectedIntent: "financial_reporting.variance",
    expectedBlueprintCode: "financial_planning_reporting_review",
    expectedOperation: "CREATE",
  },
  {
    request: "Review the business case for the new SIL house",
    expectedIntent: "business_proposal.review",
    expectedBlueprintCode: "business_proposal",
    expectedOperation: "REVIEW",
    ambiguity: "business proposal review vs market/growth analysis",
  },
  {
    request: "Draft a letter to a participant family about service changes",
    expectedIntent: "correspondence.create",
    expectedBlueprintCode: "formal_stakeholder_correspondence",
    expectedOperation: "CREATE",
  },
  {
    request: "Can you compare the restrictive practice options and risks",
    expectedIntent: "restrictive_practice.comparison",
    expectedBlueprintCode: "restrictive_practice_comparison",
    expectedOperation: "COMPARE",
  },
  {
    request: "I need help with the printer in the office",
    expectedIntent: null,
    expectedBlueprintCode: null,
    expectedOperation: "CREATE",
  },
  {
    request: "What time is it in Melbourne",
    expectedIntent: null,
    expectedBlueprintCode: null,
    expectedOperation: "CREATE",
  },
  {
    request: "Can you remind me tomorrow to call Sarah",
    expectedIntent: null,
    expectedBlueprintCode: null,
    expectedOperation: "CREATE",
  },
  {
    request: "Order more stationery for reception",
    expectedIntent: null,
    expectedBlueprintCode: null,
    expectedOperation: "CREATE",
  },
];
