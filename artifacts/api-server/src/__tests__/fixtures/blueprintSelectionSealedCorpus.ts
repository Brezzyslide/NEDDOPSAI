import type { ProfessionalOperation } from "../../services/professionalExecutionContextService.js";

export type BlueprintSelectionSealedCase = {
  request: string;
  expectedIntent: string | null;
  expectedBlueprintCode: string | null;
  expectedOperation: ProfessionalOperation;
  ambiguity?: string;
};

export const BLUEPRINT_SELECTION_SEALED_CORPUS: BlueprintSelectionSealedCase[] = [
  {
    request: "Can you pull together a clean NDIS agreement we can reuse for new participants",
    expectedIntent: "agreements.create",
    expectedBlueprintCode: "service_agreement_review",
    expectedOperation: "CREATE",
  },
  {
    request: "Please read this participant agreement and tell me what clauses are missing",
    expectedIntent: "agreements.review",
    expectedBlueprintCode: "service_agreement_review",
    expectedOperation: "REVIEW",
  },
  {
    request: "We need the community outing risk form ready before Saturday's activity",
    expectedIntent: "risk_assessment.community_access",
    expectedBlueprintCode: "community_access_risk_assessment",
    expectedOperation: "CREATE",
    ambiguity: "event preparation vs reusable community access risk assessment",
  },
  {
    request: "Have a look at the weekend outing risk assessment and check if it stacks up",
    expectedIntent: "risk_assessment.community_access",
    expectedBlueprintCode: "community_access_risk_assessment",
    expectedOperation: "REVIEW",
  },
  {
    request: "A medication incident happened on shift, draft the investigation notes and actions",
    expectedIntent: "incident.investigation",
    expectedBlueprintCode: "incident_investigation",
    expectedOperation: "INVESTIGATE",
  },
  {
    request: "Does this behaviour support incident need to be reported to the Commission",
    expectedIntent: "incident.reportable",
    expectedBlueprintCode: "reportable_incident_assessment",
    expectedOperation: "ASSESS",
  },
  {
    request: "Create a participant support plan template for daily living and routines",
    expectedIntent: "support_plan.create",
    expectedBlueprintCode: "individual_support_plan",
    expectedOperation: "CREATE",
  },
  {
    request: "The uploaded support plan feels thin, review it for practice gaps",
    expectedIntent: "support_plan.review",
    expectedBlueprintCode: "individual_support_plan",
    expectedOperation: "REVIEW",
  },
  {
    request: "Make us a restrictive practice comparison table for the options on the table",
    expectedIntent: "restrictive_practice.comparison",
    expectedBlueprintCode: "restrictive_practice_comparison",
    expectedOperation: "COMPARE",
  },
  {
    request: "Check this restrictive practice plan before the team meeting",
    expectedIntent: "restrictive_practice.review",
    expectedBlueprintCode: "restrictive_practice_review",
    expectedOperation: "REVIEW",
  },
  {
    request: "Write an onboarding checklist for a new support coordinator joining next week",
    expectedIntent: "people.onboarding",
    expectedBlueprintCode: "people_management_review",
    expectedOperation: "CREATE",
  },
  {
    request: "Can you assess whether our induction pack covers mandatory worker training",
    expectedIntent: "learning.training_gap_analysis",
    expectedBlueprintCode: "learning_capability_development_plan",
    expectedOperation: "ASSESS",
    ambiguity: "people onboarding vs learning/training gap analysis",
  },
  {
    request: "Review the staff file and tell me if the worker clearance and credentials are current",
    expectedIntent: "workforce_compliance.credential_review",
    expectedBlueprintCode: "workforce_compliance_assessment",
    expectedOperation: "REVIEW",
  },
  {
    request: "Put together a policy for handling complaints and feedback",
    expectedIntent: "policy.create",
    expectedBlueprintCode: "policy",
    expectedOperation: "CREATE",
  },
  {
    request: "Look over the complaints policy and mark what needs changing",
    expectedIntent: "policy.review",
    expectedBlueprintCode: "policy",
    expectedOperation: "REVIEW",
  },
  {
    request: "Draft the response to a participant complaint about missed supports",
    expectedIntent: "complaints.response",
    expectedBlueprintCode: "complaints_review_response",
    expectedOperation: "CREATE",
  },
  {
    request: "Before I send this complaint reply, review it for tone and compliance",
    expectedIntent: "complaints.response",
    expectedBlueprintCode: "complaints_review_response",
    expectedOperation: "REVIEW",
  },
  {
    request: "Build a shift handover SOP for overnight staff",
    expectedIntent: "operations.sop.create",
    expectedBlueprintCode: "standard_operating_procedure",
    expectedOperation: "CREATE",
  },
  {
    request: "Can you check the overnight handover procedure for missing steps",
    expectedIntent: "operations.sop.review",
    expectedBlueprintCode: "standard_operating_procedure",
    expectedOperation: "REVIEW",
  },
  {
    request: "We need a board-ready governance framework summary for delegations",
    expectedIntent: "governance.framework",
    expectedBlueprintCode: "governance_framework",
    expectedOperation: "CREATE",
  },
  {
    request: "Tell me where our governance documents are weak against NDIS expectations",
    expectedIntent: "governance.gap_analysis",
    expectedBlueprintCode: "governance_gap_analysis",
    expectedOperation: "ASSESS",
  },
  {
    request: "Prepare a simple monthly variance report template for the finance meeting",
    expectedIntent: "financial_reporting.variance",
    expectedBlueprintCode: "financial_planning_reporting_review",
    expectedOperation: "CREATE",
  },
  {
    request: "Look at this quarter's cash position and assess whether we can hire",
    expectedIntent: "financial_planning.cashflow",
    expectedBlueprintCode: "financial_planning_reporting_review",
    expectedOperation: "ASSESS",
  },
  {
    request: "Check whether this roster is creating SCHADS overtime exposure",
    expectedIntent: "employment.schads_analysis",
    expectedBlueprintCode: "schads_award_analysis",
    expectedOperation: "REVIEW",
  },
  {
    request: "Draft a family update letter about changed support times",
    expectedIntent: "correspondence.create",
    expectedBlueprintCode: "formal_stakeholder_correspondence",
    expectedOperation: "CREATE",
  },
  {
    request: "Review this letter to the plan manager before we send it",
    expectedIntent: "correspondence.review",
    expectedBlueprintCode: "formal_stakeholder_correspondence",
    expectedOperation: "REVIEW",
  },
  {
    request: "Can you make a flyer for our new respite program",
    expectedIntent: "marketing.campaign",
    expectedBlueprintCode: "marketing_communications_review",
    expectedOperation: "CREATE",
  },
  {
    request: "My laptop will not connect to the office wifi",
    expectedIntent: null,
    expectedBlueprintCode: null,
    expectedOperation: "CREATE",
  },
  {
    request: "Book a table for dinner tonight",
    expectedIntent: null,
    expectedBlueprintCode: null,
    expectedOperation: "CREATE",
  },
  {
    request: "Can you calculate 17 percent of 4500",
    expectedIntent: null,
    expectedBlueprintCode: null,
    expectedOperation: "CREATE",
  },
];
