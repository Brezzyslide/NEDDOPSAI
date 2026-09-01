/**
 * Blueprint Intent Map — Production Blueprint Architecture
 *
 * Deterministic mapping from structured intent keys (family.mode) to
 * blueprint family, mode, and canonical registry code.
 *
 * Usage:
 *   const result = resolveIntent("care_plan.create");
 *   // → { family: "care_plan", mode: "create", code: "care_plan", isAction: false }
 *
 * Rules:
 *  - Intent keys take precedence over keyword matching.
 *  - Keyword matching remains as a backwards-compatible fallback.
 *  - Action intents return { isAction: true } and must NOT trigger a blueprint.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IntentResolution {
  family: string;
  mode: string;
  /** Canonical blueprint code from the registry. */
  code: string;
  isAction: false;
}

export interface ActionResolution {
  actionCode: string;
  label: string;
  isAction: true;
  /** Blueprint that governs this action (if any). */
  governedByCode: string | null;
}

export type IntentResult = IntentResolution | ActionResolution;

// ─── Intent Map ───────────────────────────────────────────────────────────────
// Format: "intentKey" → IntentResolution or ActionResolution

const INTENT_MAP: Record<string, IntentResult> = {
  // ── Care Plans ──────────────────────────────────────────────────────────────
  "care_plan.create":  { family: "care_plan", mode: "create",  code: "care_plan", isAction: false },
  "care_plan.review":  { family: "care_plan", mode: "review",  code: "care_plan", isAction: false },
  "care_plan.revise":  { family: "care_plan", mode: "revise",  code: "care_plan", isAction: false },

  // ── Support Plans ──────────────────────────────────────────────────────────
  "individual_support_plan.create":  { family: "support_plan", mode: "create", code: "individual_support_plan", isAction: false },
  "individual_support_plan.review":  { family: "support_plan", mode: "review", code: "individual_support_plan", isAction: false },
  "individual_support_plan.revise":  { family: "support_plan", mode: "revise", code: "individual_support_plan", isAction: false },
  "support_plan.create":         { family: "care_plan", mode: "create", code: "care_plan",                    isAction: false },
  "support_plan.review":         { family: "care_plan", mode: "review", code: "care_plan",                    isAction: false },
  "support_plan.revise":         { family: "care_plan", mode: "revise", code: "care_plan",                    isAction: false },
  "support_plan.sil.create":     { family: "support_plan", mode: "create", code: "sil_support_plan",           isAction: false },
  "support_plan.sil.review":     { family: "support_plan", mode: "review", code: "sil_support_plan",           isAction: false },
  "support_plan.sil.revise":     { family: "support_plan", mode: "revise", code: "sil_support_plan",           isAction: false },

  // ── Transition & Goals ─────────────────────────────────────────────────────
  "transition_plan.create":  { family: "transition_plan", mode: "create", code: "participant_transition_plan",  isAction: false },
  "transition_plan.review":  { family: "transition_plan", mode: "review", code: "participant_transition_plan",  isAction: false },
  "goals_review.review":     { family: "goals_review",    mode: "review", code: "participant_goals_review",     isAction: false },
  "goals_review.update":     { family: "goals_review",    mode: "update", code: "participant_goals_review",     isAction: false },
  "periodic_summary.weekly":   { family: "periodic_summary", mode: "weekly",   code: "participant_periodic_summary", isAction: false },
  "periodic_summary.periodic": { family: "periodic_summary", mode: "periodic", code: "participant_periodic_summary", isAction: false },
  "service_delivery.review":   { family: "service_delivery", mode: "review",   code: "service_delivery_review", isAction: false },

  // ── Support Strategy ───────────────────────────────────────────────────────
  "support_strategy.proactive":  { family: "support_strategy", mode: "proactive",  code: "support_strategy_analysis", isAction: false },
  "support_strategy.reactive":   { family: "support_strategy", mode: "reactive",   code: "support_strategy_analysis", isAction: false },
  "support_strategy.protective": { family: "support_strategy", mode: "protective", code: "support_strategy_analysis", isAction: false },
  "support_strategy.combined":   { family: "support_strategy", mode: "combined",   code: "support_strategy_analysis", isAction: false },

  // ── Risk Assessments ───────────────────────────────────────────────────────
  "risk.create":                      { family: "risk_assessment", mode: "general",          code: "participant_risk_assessment",     isAction: false },
  "risk.review":                      { family: "risk_assessment", mode: "general",          code: "participant_risk_assessment",     isAction: false },
  "risk.assessment":                  { family: "risk_assessment", mode: "general",          code: "participant_risk_assessment",     isAction: false },
  "risk_assessment.general":          { family: "risk_assessment", mode: "general",          code: "participant_risk_assessment",     isAction: false },
  "risk_assessment.health":           { family: "risk_assessment", mode: "health",            code: "participant_risk_assessment",     isAction: false },
  "risk_assessment.behavioural":      { family: "risk_assessment", mode: "behavioural",       code: "participant_risk_assessment",     isAction: false },
  "risk_assessment.home":             { family: "risk_assessment", mode: "home",              code: "participant_risk_assessment",     isAction: false },
  "risk_assessment.community_access": { family: "risk_assessment", mode: "community_access",  code: "community_access_risk_assessment",isAction: false },
  "participant_risk.community_access":{ family: "risk_assessment", mode: "community_access",  code: "community_access_risk_assessment",isAction: false },
  "risk_assessment.site":             { family: "risk_assessment", mode: "site",              code: "site_environmental_risk_assessment",isAction: false },
  "risk_assessment.environmental":    { family: "risk_assessment", mode: "environmental",     code: "site_environmental_risk_assessment",isAction: false },
  "risk_assessment.fire":             { family: "risk_assessment", mode: "fire",              code: "fire_risk_assessment",            isAction: false },

  // ── Emergency & Business Continuity ───────────────────────────────────────
  "disaster.organisational":     { family: "emergency_plan",     mode: "organisational",    code: "disaster_emergency_management_plan",      isAction: false },
  "disaster.participant":        { family: "emergency_plan",     mode: "participant",       code: "individual_emergency_preparedness_plan",   isAction: false },
  "disaster.evacuation":         { family: "emergency_assessment", mode: "evacuation",      code: "evacuation_emergency_assessment",          isAction: false },
  "disaster.business_continuity":{ family: "emergency_plan",     mode: "business_continuity", code: "business_continuity_plan",              isAction: false },
  "emergency_assessment.evacuation": { family: "emergency_assessment", mode: "evacuation",  code: "evacuation_emergency_assessment",          isAction: false },
  "emergency_assessment.participant":{ family: "emergency_assessment", mode: "participant", code: "participant_disaster_risk_assessment",     isAction: false },

  // ── Behaviour Support ─────────────────────────────────────────────────────
  "behaviour_support.review":   { family: "behaviour_support", mode: "review",   code: "behaviour_support_plan_review", isAction: false },
  "behaviour_support.revise":   { family: "behaviour_support", mode: "revise",   code: "behaviour_support_plan_review", isAction: false },
  "behaviour_support.analysis": { family: "behaviour_support", mode: "analysis", code: "behaviour_trigger_analysis",    isAction: false },
  "behaviour_support.implementation": { family: "behaviour_support", mode: "implementation", code: "behaviour_support_plan_review", isAction: false },
  "bsp.implementation": { family: "behaviour_support", mode: "implementation", code: "behaviour_support_plan_review", isAction: false },

  // ── Restrictive Practices ─────────────────────────────────────────────────
  "restrictive_practice.risk_assessment": { family: "restrictive_practice", mode: "risk_assessment", code: "restrictive_practice_risk_assessment",    isAction: false },
  "restrictive_practice.comparison":      { family: "restrictive_practice", mode: "comparison",      code: "restrictive_practice_comparison",          isAction: false },
  "restrictive_practice.authorisation":   { family: "restrictive_practice", mode: "authorisation",   code: "restrictive_practice_authorisation",        isAction: false },
  "restrictive_practice.review":          { family: "restrictive_practice", mode: "review",          code: "unauthorised_restrictive_practice_review",  isAction: false },
  "restrictive_practice.governance":      { family: "restrictive_practice", mode: "governance",      code: "restrictive_practice_authorisation",        isAction: false },
  "restrictive_practice.monthly_reporting": { family: "restrictive_practice", mode: "monthly_reporting", code: "restrictive_practice_authorisation",     isAction: false },

  // ── Incidents & Safeguarding ──────────────────────────────────────────────
  "incident.investigation": { family: "incident",     mode: "investigation", code: "incident_investigation",    isAction: false },
  "incident.review":        { family: "incident",     mode: "review",        code: "incident_review_improvement",isAction: false },
  "incident.reportable":    { family: "incident",     mode: "reportable",    code: "reportable_incident_assessment",isAction: false },
  "safeguarding.assessment":{ family: "safeguarding", mode: "assessment",    code: "safeguarding_assessment",   isAction: false },

  // ── Quality Improvement ───────────────────────────────────────────────────
  "quality.corrective_action": { family: "quality_improvement", mode: "corrective_action", code: "corrective_action_improvement", isAction: false },

  // ── Mealtime ──────────────────────────────────────────────────────────────
  "mealtime.risk_assessment": { family: "mealtime", mode: "risk_assessment", code: "mealtime_risk_assessment",        isAction: false },
  "mealtime.review":          { family: "mealtime", mode: "review",          code: "mealtime_management_plan_review",  isAction: false },
  "mealtime.dysphagia":       { family: "mealtime", mode: "dysphagia",       code: "dysphagia_mealtime_safety_review", isAction: false },
  "mealtime.strategy":        { family: "mealtime", mode: "strategy",        code: "mealtime_support_strategy",        isAction: false },

  // ── Clinical Management ───────────────────────────────────────────────────
  "clinical.medication_management": { family: "clinical_management", mode: "medication_management", code: "medication_management_review",     isAction: false },
  "clinical.health_support":        { family: "clinical_management", mode: "health_support",        code: "health_support_plan",               isAction: false },
  "clinical.escalation":            { family: "clinical_management", mode: "escalation",            code: "health_clinical_escalation_plan",   isAction: false },

  // ── Funding ───────────────────────────────────────────────────────────────
  "funding.review": { family: "funding_review", mode: "review", code: "funding_utilisation_review", isAction: false },

  // ── Governance ────────────────────────────────────────────────────────────
  "governance.clinical":  { family: "governance", mode: "clinical",  code: "clinical_governance_review",  isAction: false },
  "governance.executive": { family: "governance", mode: "executive", code: "governance_executive_review",  isAction: false },

  // ── Workforce ─────────────────────────────────────────────────────────────
  "roster.plan":           { family: "workforce_ops", mode: "planning",          code: "roster_planning",             isAction: false },
  "roster.fatigue_review": { family: "workforce_ops", mode: "fatigue_review",    code: "rostering_fatigue_review",    isAction: false },
  "workforce.performance_review": { family: "workforce_ops", mode: "performance_review", code: "workforce_performance_review", isAction: false },
  "people.performance_review": { family: "workforce_ops", mode: "performance_review", code: "workforce_performance_review", isAction: false },
  "people.performance_management": { family: "people_culture", mode: "performance_management", code: "people_management_review", isAction: false },
  "people.probation_review": { family: "people_culture", mode: "probation_review", code: "people_management_review", isAction: false },
  "people.employee_relations": { family: "people_culture", mode: "employee_relations", code: "people_management_review", isAction: false },
  "people.grievance_review": { family: "people_culture", mode: "grievance_review", code: "people_management_review", isAction: false },
  "people.conduct_review": { family: "people_culture", mode: "conduct_review", code: "people_management_review", isAction: false },
  "people.recruitment_support": { family: "people_culture", mode: "recruitment_support", code: "people_management_review", isAction: false },
  "hr.onboarding": { family: "people_culture", mode: "onboarding", code: "people_management_review", isAction: false },
  "people.onboarding": { family: "people_culture", mode: "onboarding", code: "people_management_review", isAction: false },
  "people.workplace_adjustment": { family: "people_culture", mode: "workplace_adjustment", code: "people_management_review", isAction: false },
  "people.supervision_framework": { family: "people_culture", mode: "supervision_framework", code: "people_management_review", isAction: false },
  "people.retention_review": { family: "people_culture", mode: "retention_review", code: "people_management_review", isAction: false },
  "people.offboarding": { family: "people_culture", mode: "offboarding", code: "people_management_review", isAction: false },
  "learning.needs_analysis": { family: "talent_learning", mode: "needs_analysis", code: "learning_capability_development_plan", isAction: false },
  "learning.competency_gap_analysis": { family: "talent_learning", mode: "competency_gap_analysis", code: "learning_capability_development_plan", isAction: false },
  "learning.training_gap_analysis": { family: "talent_learning", mode: "training_gap_analysis", code: "learning_capability_development_plan", isAction: false },
  "learning.induction": { family: "talent_learning", mode: "induction", code: "learning_capability_development_plan", isAction: false },
  "learning.onboarding": { family: "talent_learning", mode: "onboarding", code: "learning_capability_development_plan", isAction: false },
  "learning.mandatory_training": { family: "talent_learning", mode: "mandatory_training", code: "learning_capability_development_plan", isAction: false },
  "learning.refresher_training": { family: "talent_learning", mode: "refresher_training", code: "learning_capability_development_plan", isAction: false },
  "learning.development_plan": { family: "talent_learning", mode: "development_plan", code: "learning_capability_development_plan", isAction: false },
  "learning.training_plan": { family: "talent_learning", mode: "training_plan", code: "learning_capability_development_plan", isAction: false },
  "learning.effectiveness_review": { family: "talent_learning", mode: "effectiveness_review", code: "learning_capability_development_plan", isAction: false },
  "learning.capability_review": { family: "talent_learning", mode: "capability_review", code: "learning_capability_development_plan", isAction: false },
  "learning.remediation": { family: "talent_learning", mode: "remediation", code: "learning_capability_development_plan", isAction: false },
  "learning.professional_development": { family: "talent_learning", mode: "professional_development", code: "learning_capability_development_plan", isAction: false },
  "workforce_compliance.eligibility_review": { family: "workforce_compliance", mode: "eligibility_review", code: "workforce_compliance_assessment", isAction: false },
  "workforce_compliance.credential_review": { family: "workforce_compliance", mode: "credential_review", code: "workforce_compliance_assessment", isAction: false },
  "workforce_compliance.expiry_monitoring": { family: "workforce_compliance", mode: "expiry_monitoring", code: "workforce_compliance_assessment", isAction: false },
  "workforce_compliance.exception_review": { family: "workforce_compliance", mode: "exception_review", code: "workforce_compliance_assessment", isAction: false },
  "workforce_compliance.onboarding_readiness": { family: "workforce_compliance", mode: "onboarding_readiness", code: "workforce_compliance_assessment", isAction: false },
  "payroll.review": { family: "payroll_workforce_cost", mode: "payroll_review", code: "payroll_workforce_cost_review", isAction: false },
  "payroll.reconciliation": { family: "payroll_workforce_cost", mode: "reconciliation", code: "payroll_workforce_cost_review", isAction: false },
  "payroll.exception_review": { family: "payroll_workforce_cost", mode: "exception_review", code: "payroll_workforce_cost_review", isAction: false },
  "workforce_cost.review": { family: "payroll_workforce_cost", mode: "cost_review", code: "payroll_workforce_cost_review", isAction: false },
  "workforce_cost.calculate": { family: "payroll_workforce_cost", mode: "cost_calculation", code: "payroll_workforce_cost_review", isAction: false },
  "award_pay.review": { family: "payroll_workforce_cost", mode: "award_pay_review", code: "payroll_workforce_cost_review", isAction: false },
  "classification_pay.review": { family: "payroll_workforce_cost", mode: "classification_pay_review", code: "payroll_workforce_cost_review", isAction: false },
  "allowance.review": { family: "payroll_workforce_cost", mode: "allowance_review", code: "payroll_workforce_cost_review", isAction: false },
  "overtime.review": { family: "payroll_workforce_cost", mode: "overtime_review", code: "payroll_workforce_cost_review", isAction: false },
  "penalty_rate.review": { family: "payroll_workforce_cost", mode: "penalty_rate_review", code: "payroll_workforce_cost_review", isAction: false },

  // ── Operations ────────────────────────────────────────────────────────────
  "operations.readiness":        { family: "operations", mode: "readiness",       code: "operational_readiness_assessment", isAction: false },
  "operations.sop.create":       { family: "operations", mode: "create",          code: "standard_operating_procedure",     isAction: false },
  "operations.sop.review":       { family: "operations", mode: "review",          code: "standard_operating_procedure",     isAction: false },
  "operations.sop.revise":       { family: "operations", mode: "revise",          code: "standard_operating_procedure",     isAction: false },
  "operations.process_analysis": { family: "operations", mode: "process_analysis",code: "business_process_analysis",        isAction: false },
  "process.map": { family: "operations", mode: "map", code: "business_process_analysis", isAction: false },
  "process.review": { family: "operations", mode: "review", code: "business_process_analysis", isAction: false },
  "process.improvement": { family: "operations", mode: "improvement", code: "business_process_analysis", isAction: false },
  "process.sop": { family: "operations", mode: "create", code: "standard_operating_procedure", isAction: false },
  "process.work_instruction": { family: "operations", mode: "work_instruction", code: "standard_operating_procedure", isAction: false },
  "process.workflow": { family: "operations", mode: "workflow", code: "business_process_analysis", isAction: false },
  "process.control_review": { family: "operations", mode: "control_review", code: "business_process_analysis", isAction: false },
  "process.handoff_review": { family: "operations", mode: "handoff_review", code: "business_process_analysis", isAction: false },
  "asset.register_review": { family: "process_asset", mode: "register_review", code: "asset_lifecycle_review", isAction: false },
  "asset.lifecycle_review": { family: "process_asset", mode: "lifecycle_review", code: "asset_lifecycle_review", isAction: false },
  "asset.maintenance_review": { family: "process_asset", mode: "maintenance_review", code: "asset_lifecycle_review", isAction: false },
  "asset.inspection_review": { family: "process_asset", mode: "inspection_review", code: "asset_lifecycle_review", isAction: false },
  "asset.condition_review": { family: "process_asset", mode: "condition_review", code: "asset_lifecycle_review", isAction: false },
  "asset.exception_review": { family: "process_asset", mode: "exception_review", code: "asset_lifecycle_review", isAction: false },
  "asset.replacement_review": { family: "process_asset", mode: "replacement_review", code: "asset_lifecycle_review", isAction: false },

  // ── Policy ────────────────────────────────────────────────────────────────
  "policy.create": { family: "policy", mode: "create", code: "policy", isAction: false },
  "policy.review": { family: "policy", mode: "review", code: "policy", isAction: false },
  "policy.revise": { family: "policy", mode: "revise", code: "policy", isAction: false },
  "governance.framework": { family: "policy", mode: "framework", code: "governance_framework", isAction: false },
  "governance.regulatory_change_impact": { family: "policy", mode: "impact_assessment", code: "regulatory_change_impact_assessment", isAction: false },
  "governance.gap_analysis": { family: "policy", mode: "gap_analysis", code: "governance_gap_analysis", isAction: false },
  "governance.delegation_framework": { family: "policy", mode: "delegation_framework", code: "delegation_framework", isAction: false },

  // ── Compliance & Regulatory ───────────────────────────────────────────────
  "compliance.audit_readiness":    { family: "compliance", mode: "audit_readiness",    code: "compliance_audit_readiness",    isAction: false },
  "compliance.legislation_review": { family: "compliance", mode: "legislation_review", code: "legislation_regulatory_review", isAction: false },
  "compliance.impact_assessment":  { family: "policy",     mode: "impact_assessment",  code: "regulatory_change_impact_assessment", isAction: false },
  "compliance.response":           { family: "compliance", mode: "response",           code: "regulator_response_submission", isAction: false },
  "regulatory_change_impact.impact_assessment": { family: "compliance", mode: "impact_assessment", code: "regulatory_change_impact", isAction: false },

  // ── Employment & SCHADS ───────────────────────────────────────────────────
  "employment.schads_analysis": { family: "employment", mode: "schads_analysis", code: "schads_award_analysis",       isAction: false },
  "employment.review":          { family: "employment", mode: "review",          code: "employment_compliance_review", isAction: false },

  // ── Financial ─────────────────────────────────────────────────────────────
  "financial.analysis":   { family: "financial_planning", mode: "performance", code: "financial_planning_reporting_review", isAction: false },
  "financial.tax_review": { family: "financial", mode: "tax_review", code: "tax_financial_obligation_review",isAction: false },
  "business_financial_analysis.analysis": { family: "financial", mode: "analysis", code: "business_financial_analysis", isAction: false },
  "financial_planning.budget":              { family: "financial_planning", mode: "budget",               code: "financial_planning_reporting_review", isAction: false },
  "financial_planning.forecast":            { family: "financial_planning", mode: "forecast",             code: "financial_planning_reporting_review", isAction: false },
  "financial_planning.cashflow":            { family: "financial_planning", mode: "cashflow",             code: "financial_planning_reporting_review", isAction: false },
  "financial_planning.scenario":            { family: "financial_planning", mode: "scenario",             code: "financial_planning_reporting_review", isAction: false },
  "financial_planning.sensitivity":         { family: "financial_planning", mode: "sensitivity",          code: "financial_planning_reporting_review", isAction: false },
  "financial_reporting.management":         { family: "financial_planning", mode: "management_reporting", code: "financial_planning_reporting_review", isAction: false },
  "financial_reporting.variance":           { family: "financial_planning", mode: "variance",             code: "financial_planning_reporting_review", isAction: false },
  "financial_reporting.performance":        { family: "financial_planning", mode: "performance",          code: "financial_planning_reporting_review", isAction: false },
  "financial_reporting.cost_centre":        { family: "financial_planning", mode: "performance",          code: "financial_planning_reporting_review", isAction: false },
  "financial_reporting.profitability":      { family: "financial_planning", mode: "profitability",        code: "financial_planning_reporting_review", isAction: false },
  "financial_reporting.workforce_cost_outlook": { family: "financial_planning", mode: "forecast",         code: "financial_planning_reporting_review", isAction: false },
  "financial_reporting.forecast_accuracy":  { family: "financial_planning", mode: "forecast",             code: "financial_planning_reporting_review", isAction: false },
  "financial_analysis.business_case":       { family: "financial_planning", mode: "business_case",        code: "financial_planning_reporting_review", isAction: false },
  "financial_analysis.break_even":          { family: "financial_planning", mode: "business_case",        code: "financial_planning_reporting_review", isAction: false },
  "finance.budget_analysis":                { family: "financial_planning", mode: "budget",               code: "financial_planning_reporting_review", isAction: false },
  "finance.cost_impact_analysis":           { family: "financial_planning", mode: "business_case",        code: "financial_planning_reporting_review", isAction: false },
  "finance.financial_reporting":            { family: "financial_planning", mode: "management_reporting", code: "financial_planning_reporting_review", isAction: false },
  "finance.reconciliation":             { family: "operational_finance", mode: "reconciliation",             code: "operational_finance_reconciliation_review", isAction: false },
  "finance.bank_reconciliation":        { family: "operational_finance", mode: "bank_reconciliation",        code: "operational_finance_reconciliation_review", isAction: false },
  "finance.accounts_payable":           { family: "operational_finance", mode: "accounts_payable",           code: "operational_finance_reconciliation_review", isAction: false },
  "finance.accounts_receivable":        { family: "operational_finance", mode: "accounts_receivable",        code: "operational_finance_reconciliation_review", isAction: false },
  "finance.invoice_review":             { family: "operational_finance", mode: "invoice_review",             code: "operational_finance_reconciliation_review", isAction: false },
  "finance.payment_review":             { family: "operational_finance", mode: "payment_review",             code: "operational_finance_reconciliation_review", isAction: false },
  "finance.receipt_review":             { family: "operational_finance", mode: "receipt_review",             code: "operational_finance_reconciliation_review", isAction: false },
  "finance.expense_review":             { family: "operational_finance", mode: "expense_review",             code: "operational_finance_reconciliation_review", isAction: false },
  "finance.reimbursement_review":       { family: "operational_finance", mode: "expense_review",             code: "operational_finance_reconciliation_review", isAction: false },
  "finance.transaction_review":         { family: "operational_finance", mode: "transaction_review",         code: "operational_finance_reconciliation_review", isAction: false },
  "finance.duplicate_review":           { family: "operational_finance", mode: "exception_review",           code: "operational_finance_reconciliation_review", isAction: false },
  "finance.supplier_reconciliation":    { family: "operational_finance", mode: "reconciliation",             code: "operational_finance_reconciliation_review", isAction: false },
  "finance.customer_reconciliation":    { family: "operational_finance", mode: "reconciliation",             code: "operational_finance_reconciliation_review", isAction: false },
  "finance.credit_refund_review":       { family: "operational_finance", mode: "exception_review",           code: "operational_finance_reconciliation_review", isAction: false },
  "finance.financial_record_review":    { family: "operational_finance", mode: "transaction_review",         code: "operational_finance_reconciliation_review", isAction: false },
  "finance.finance_exception_review":   { family: "operational_finance", mode: "exception_review",           code: "operational_finance_reconciliation_review", isAction: false },
  "accounting.reconciliation":          { family: "operational_finance", mode: "reconciliation",             code: "operational_finance_reconciliation_review", isAction: false },
  "accounting.bas_analysis":            { family: "operational_finance", mode: "transaction_review",         code: "operational_finance_reconciliation_review", isAction: false },
  "invoicing.create_draft":             { family: "operational_finance", mode: "invoice_review",             code: "operational_finance_reconciliation_review", isAction: false },

  // ── Knowledge & Documentation ────────────────────────────────────────────
  "knowledge.document_control":          { family: "knowledge_documentation", mode: "control_review",          code: "document_control_review",        isAction: false },
  "knowledge.document_lifecycle":        { family: "knowledge_documentation", mode: "lifecycle_review",        code: "document_control_review",        isAction: false },
  "knowledge.version_review":            { family: "knowledge_documentation", mode: "version_review",          code: "document_control_review",        isAction: false },
  "knowledge.supersession_review":       { family: "knowledge_documentation", mode: "supersession_review",     code: "document_control_review",        isAction: false },
  "knowledge.metadata_review":           { family: "knowledge_documentation", mode: "metadata_review",         code: "document_control_review",        isAction: false },
  "knowledge.review_due_monitoring":     { family: "knowledge_documentation", mode: "review_due",              code: "document_control_review",        isAction: false },
  "knowledge.archive_review":            { family: "knowledge_documentation", mode: "archive_review",          code: "document_control_review",        isAction: false },
  "knowledge.taxonomy":                  { family: "knowledge_documentation", mode: "taxonomy",                code: "knowledge_base_review",          isAction: false },
  "knowledge.classification":            { family: "knowledge_documentation", mode: "classification",          code: "knowledge_base_review",          isAction: false },
  "knowledge.retrieval_quality":         { family: "knowledge_documentation", mode: "retrieval_quality",       code: "knowledge_base_review",          isAction: false },
  "knowledge.duplication_review":        { family: "knowledge_documentation", mode: "duplication_review",      code: "knowledge_base_review",          isAction: false },
  "knowledge.knowledge_gap_review":      { family: "knowledge_documentation", mode: "gap_review",              code: "knowledge_base_review",          isAction: false },
  "knowledge.template_control":          { family: "knowledge_documentation", mode: "template_control",        code: "controlled_document_assembly",   isAction: false },
  "knowledge.document_quality":          { family: "knowledge_documentation", mode: "document_quality",        code: "controlled_document_assembly",   isAction: false },
  "knowledge.artifact_packaging":        { family: "knowledge_documentation", mode: "artifact_packaging",      code: "controlled_document_assembly",   isAction: false },
  "knowledge.controlled_publication":    { family: "knowledge_documentation", mode: "publication_package",     code: "controlled_document_assembly",   isAction: false },
  "documentation.control_review":        { family: "knowledge_documentation", mode: "control_review",          code: "document_control_review",        isAction: false },
  "documentation.template_application":  { family: "knowledge_documentation", mode: "template_application",    code: "controlled_document_assembly",   isAction: false },
  "documentation.controlled_assembly":   { family: "knowledge_documentation", mode: "assembly",                code: "controlled_document_assembly",   isAction: false },
  "documentation.docx_pdf_package":      { family: "knowledge_documentation", mode: "docx_pdf_package",        code: "controlled_document_assembly",   isAction: false },

  // ── Strategic ─────────────────────────────────────────────────────────────
  "strategic.growth_analysis": { family: "strategic", mode: "growth_analysis", code: "business_growth_analysis",  isAction: false },
  "strategic.marketing":       { family: "strategic", mode: "marketing",       code: "ndis_marketing_strategy",   isAction: false },
  "marketing.strategy":                    { family: "marketing_communications", mode: "strategy",                  code: "marketing_communications_review", isAction: false },
  "marketing.campaign":                    { family: "marketing_communications", mode: "campaign",                  code: "marketing_communications_review", isAction: false },
  "marketing.campaign_planning":           { family: "marketing_communications", mode: "campaign",                  code: "marketing_communications_review", isAction: false },
  "marketing.content_strategy":            { family: "marketing_communications", mode: "content_strategy",          code: "marketing_communications_review", isAction: false },
  "marketing.content_calendar":            { family: "marketing_communications", mode: "content_strategy",          code: "marketing_communications_review", isAction: false },
  "marketing.audience_analysis":           { family: "marketing_communications", mode: "strategy",                  code: "marketing_communications_review", isAction: false },
  "marketing.brand":                       { family: "marketing_communications", mode: "strategy",                  code: "marketing_communications_review", isAction: false },
  "marketing.brand_management":            { family: "marketing_communications", mode: "strategy",                  code: "marketing_communications_review", isAction: false },
  "marketing.messaging":                   { family: "marketing_communications", mode: "communications_plan",       code: "marketing_communications_review", isAction: false },
  "marketing.social_media":                { family: "marketing_communications", mode: "social_media",              code: "marketing_communications_review", isAction: false },
  "marketing.website_content":             { family: "marketing_communications", mode: "website_content",           code: "marketing_communications_review", isAction: false },
  "marketing.email_campaign":              { family: "marketing_communications", mode: "email_campaign",            code: "marketing_communications_review", isAction: false },
  "marketing.stakeholder_communication":   { family: "marketing_communications", mode: "stakeholder_communication", code: "marketing_communications_review", isAction: false },
  "marketing.referral_campaign":           { family: "marketing_communications", mode: "campaign",                  code: "marketing_communications_review", isAction: false },
  "marketing.event_promotion":             { family: "marketing_communications", mode: "campaign",                  code: "marketing_communications_review", isAction: false },
  "marketing.performance_review":          { family: "marketing_communications", mode: "performance",               code: "marketing_communications_review", isAction: false },
  "communications.plan":                   { family: "marketing_communications", mode: "communications_plan",       code: "marketing_communications_review", isAction: false },
  "communications.external":               { family: "marketing_communications", mode: "stakeholder_communication", code: "marketing_communications_review", isAction: false },
  "communications.internal":               { family: "marketing_communications", mode: "communications_plan",       code: "marketing_communications_review", isAction: false },
  "communications.crisis":                 { family: "marketing_communications", mode: "crisis",                    code: "marketing_communications_review", isAction: false },
  "communications.media":                  { family: "marketing_communications", mode: "media",                     code: "marketing_communications_review", isAction: false },
  "reporting.marketing":                   { family: "marketing_communications", mode: "performance",               code: "marketing_communications_review", isAction: false },
  "strategic.market_analysis": { family: "strategic", mode: "market_analysis", code: "ndis_market_analysis",      isAction: false },
  "business_proposal.create":  { family: "strategic", mode: "create",          code: "business_proposal",         isAction: false },
  "business_proposal.review":  { family: "strategic", mode: "review",          code: "business_proposal",         isAction: false },

  // ── Correspondence & Complaints ───────────────────────────────────────────
  "correspondence.create": { family: "correspondence", mode: "create", code: "formal_stakeholder_correspondence", isAction: false },
  "correspondence.review": { family: "correspondence", mode: "review", code: "formal_stakeholder_correspondence", isAction: false },
  "complaints.review":     { family: "complaints",     mode: "review",  code: "complaints_review_response",        isAction: false },
  "complaints.response":   { family: "complaints",     mode: "response",code: "complaints_review_response",        isAction: false },
  "agreements.create":     { family: "agreements",     mode: "create",  code: "service_agreement_review",          isAction: false },
  "agreements.review":     { family: "agreements",     mode: "review",  code: "service_agreement_review",          isAction: false },
  "agreements.revise":     { family: "agreements",     mode: "revise",  code: "service_agreement_review",          isAction: false },

  // ── Actions (NOT blueprints) ──────────────────────────────────────────────
  // These intents map to AGENT ACTIONS, not professional work products.
  "shift.assign":    { actionCode: "shift.assign",    label: "Assign Shift",          isAction: true, governedByCode: "roster_planning" },
  "message.send":    { actionCode: "message.send",    label: "Send Message",          isAction: true, governedByCode: null },
  "file.upload":     { actionCode: "file.upload",     label: "Upload File",           isAction: true, governedByCode: null },
  "crm.update":      { actionCode: "crm.update",      label: "Update CRM Record",     isAction: true, governedByCode: null },
  "invoice.generate":{ actionCode: "invoice.generate",label: "Generate Invoice",      isAction: true, governedByCode: "operational_finance_reconciliation_review" },
  "calendar.book":   { actionCode: "calendar.book",   label: "Make Calendar Booking", isAction: true, governedByCode: null },
  "form.submit":     { actionCode: "form.submit",     label: "Submit Approved Form",  isAction: true, governedByCode: null },
  "social.post":     { actionCode: "social.post",     label: "Post Approved Content", isAction: true, governedByCode: null },
};

// ─── Resolve ──────────────────────────────────────────────────────────────────

/**
 * Resolve a structured intent key to a blueprint or action.
 *
 * @param intentKey - e.g. "care_plan.create", "shift.assign"
 * @returns IntentResolution or ActionResolution, or null if no match.
 *
 * This is the PRIMARY selection mechanism. Keyword-based fallback is secondary.
 */
export function resolveIntent(intentKey: string): IntentResult | null {
  return INTENT_MAP[intentKey] ?? null;
}

/**
 * Returns all intent keys that map to a given blueprint code.
 * Useful for surfacing aliases/shortcuts to users.
 */
export function getIntentsForCode(blueprintCode: string): string[] {
  return Object.entries(INTENT_MAP)
    .filter(([, v]) => !v.isAction && (v as IntentResolution).code === blueprintCode)
    .map(([key]) => key);
}

/**
 * Returns true if the intent key maps to an agent ACTION rather than a blueprint.
 * An action must not trigger blueprint execution.
 */
export function intentIsAction(intentKey: string): boolean {
  const result = INTENT_MAP[intentKey];
  return result?.isAction === true;
}

/**
 * Returns all registered intent keys (for documentation / debugging).
 */
export function getAllIntentKeys(): string[] {
  return Object.keys(INTENT_MAP);
}
