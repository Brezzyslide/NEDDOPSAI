/**
 * Worker Profile Registry — Sprint 2 Architecture Correction
 *
 * A Worker Profile defines what a future OpenClaw runtime may access and do
 * when executing on behalf of a Workforce Role (AI Specialist).
 *
 * Worker Profiles are pure metadata — no live permissions, no credentials,
 * no connector secrets. They define intent boundaries for future enforcement.
 *
 * Conceptual chain:
 *   Chief of Staff → Workforce Role → Worker Profile → Future OpenClaw Runtime
 *
 * Rules:
 * - One Workforce Role may reference one or more Worker Profiles.
 * - OpenClaw (future) selects the appropriate profile at execution time.
 * - No browser domains, local paths, or connector credentials are live yet.
 * - Marketing pack profiles are status: "coming_soon".
 */

import type {
  WorkerProfileStatus,
  ExecutionChannel,
  ToolCategory,
  ConnectorCategory,
  RiskLevel,
} from "@workspace/shared";

// ─── Interface ────────────────────────────────────────────────────────────────

export interface WorkerProfile {
  /** Unique ID, e.g. "wp_chief_of_staff" */
  id: string;
  /** Machine-readable code, e.g. "chief_of_staff_profile" */
  code: string;
  /** Human-readable name */
  displayName: string;
  /** What this profile permits and why */
  description: string;
  /** Execution surfaces this profile may use (intentional, not yet enforced) */
  allowedExecutionChannels: ExecutionChannel[];
  /** Logical tool groupings this profile may invoke */
  allowedToolCategories: ToolCategory[];
  /** External connector families this profile may connect to */
  allowedConnectorCategories: ConnectorCategory[];
  /**
   * Permitted web domains for browser channel (empty = none).
   * Populated in a future sprint when web browsing is live.
   */
  allowedBrowserDomains: string[];
  /**
   * Permitted local file path categories (empty = none).
   * Populated in a future sprint when local file access is live.
   */
  allowedLocalPathCategories: string[];
  /**
   * Permitted host application categories (empty = none).
   * Populated in a future sprint when desktop automation is live.
   */
  allowedApplicationCategories: string[];
  /** Actions this profile may never perform, regardless of other permissions */
  prohibitedActions: string[];
  /** Actions requiring an additional approval before OpenClaw may execute */
  approvalRequiredActions: string[];
  /** Risk classification — governs oversight, logging requirements, and audit trail depth */
  riskLevel: RiskLevel;
  status: WorkerProfileStatus;
  version: string;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const WORKER_PROFILES: WorkerProfile[] = [

  // ── Core Workforce ──────────────────────────────────────────────────────────

  {
    id: "wp_chief_of_staff",
    code: "chief_of_staff_profile",
    displayName: "Chief of Staff — Worker Profile",
    description: "Orchestration-only profile. Routes tasks and summarises output. No direct data access, no external connectors.",
    allowedExecutionChannels: ["internal_api"],
    allowedToolCategories: ["search_tools", "reporting_tools"],
    allowedConnectorCategories: [],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["modify_data", "delete_data", "send_external_communication"],
    approvalRequiredActions: [],
    riskLevel: "low",
    status: "active",
    version: "1.0.0",
  },
  {
    id: "wp_executive_assistant",
    code: "executive_assistant_profile",
    displayName: "Executive Assistant — Worker Profile",
    description: "Calendar and communication profile. May read and write calendar events, draft emails. Cannot send emails without approval.",
    allowedExecutionChannels: ["internal_api", "calendar_system", "email_system"],
    allowedToolCategories: ["calendar_tools", "communication_tools"],
    allowedConnectorCategories: ["calendar_system", "email_system"],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["delete_calendar_events_for_others", "access_private_correspondence"],
    approvalRequiredActions: ["send_email_on_behalf_of_user", "book_meeting_with_external_parties"],
    riskLevel: "low",
    status: "active",
    version: "1.0.0",
  },
  {
    id: "wp_research_specialist",
    code: "research_specialist_profile",
    displayName: "Research Specialist — Worker Profile",
    description: "Read-only research profile. May search the web (approved domains) and read internal documents. Cannot write or send.",
    allowedExecutionChannels: ["internal_api", "web_browser", "document_store"],
    allowedToolCategories: ["search_tools", "document_tools"],
    allowedConnectorCategories: ["document_management"],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["submit_forms", "authenticate_to_external_systems", "download_files"],
    approvalRequiredActions: ["access_paywalled_content"],
    riskLevel: "low",
    status: "active",
    version: "1.0.0",
  },
  {
    id: "wp_document_specialist",
    code: "document_specialist_profile",
    displayName: "Document Specialist — Worker Profile",
    description: "Document creation and review profile. May read and write to the organisation document store.",
    allowedExecutionChannels: ["internal_api", "document_store"],
    allowedToolCategories: ["document_tools"],
    allowedConnectorCategories: ["document_management"],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["delete_documents_permanently", "publish_externally"],
    approvalRequiredActions: ["share_document_with_external_party"],
    riskLevel: "low",
    status: "active",
    version: "1.0.0",
  },
  {
    id: "wp_calendar_specialist",
    code: "calendar_specialist_profile",
    displayName: "Calendar Specialist — Worker Profile",
    description: "Calendar management profile. May manage all calendar events within the organisation calendar system.",
    allowedExecutionChannels: ["internal_api", "calendar_system"],
    allowedToolCategories: ["calendar_tools"],
    allowedConnectorCategories: ["calendar_system"],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["delete_past_events", "access_private_calendars_without_delegation"],
    approvalRequiredActions: ["book_external_venue", "modify_leadership_calendar"],
    riskLevel: "low",
    status: "active",
    version: "1.0.0",
  },
  {
    id: "wp_communication_specialist",
    code: "communication_specialist_profile",
    displayName: "Communication Specialist — Worker Profile",
    description: "Outbound communication profile. May draft communications and stage them for approval before sending.",
    allowedExecutionChannels: ["internal_api", "email_system"],
    allowedToolCategories: ["communication_tools"],
    allowedConnectorCategories: ["email_system"],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["send_unsolicited_bulk_communication", "impersonate_executive"],
    approvalRequiredActions: ["send_email", "publish_announcement"],
    riskLevel: "low",
    status: "active",
    version: "1.0.0",
  },

  // ── Compliance Workforce ────────────────────────────────────────────────────

  {
    id: "wp_compliance_officer",
    code: "compliance_officer_profile",
    displayName: "Compliance Officer — Worker Profile",
    description: "Compliance review profile. May read NDIS portal data, review internal documents, and complete compliance forms.",
    allowedExecutionChannels: ["internal_api", "document_store", "database_query"],
    allowedToolCategories: ["document_tools", "search_tools", "form_tools"],
    allowedConnectorCategories: ["ndis_portal", "document_management"],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["submit_ndis_claims", "modify_participant_records", "delete_compliance_records"],
    approvalRequiredActions: ["submit_reportable_event", "generate_external_compliance_report"],
    riskLevel: "medium",
    status: "active",
    version: "1.0.0",
  },
  {
    id: "wp_compliance_quality_manager",
    code: "compliance_quality_manager_profile",
    displayName: "Compliance & Quality Manager — Worker Profile",
    description: "Compliance assurance and quality-management profile. May read approved compliance/quality knowledge, query internal assurance data, and draft reports or corrective-action recommendations. External/regulatory actions require approval; record mutation outside assurance tracking is prohibited.",
    allowedExecutionChannels: ["internal_api", "document_store", "database_query"],
    allowedToolCategories: ["document_tools", "search_tools", "data_tools", "reporting_tools", "form_tools"],
    allowedConnectorCategories: ["document_management"],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: [
      "submit_regulatory_notification",
      "modify_participant_records",
      "modify_staff_records",
      "publish_policy_without_approval",
      "close_serious_incident",
      "certify_compliance_without_evidence",
      "delete_compliance_records",
    ],
    approvalRequiredActions: [
      "generate_external_compliance_report",
      "submit_regulator_communication",
      "close_high_risk_corrective_action",
      "update_compliance_register_status",
      "escalate_serious_non_conformance",
    ],
    riskLevel: "high",
    status: "active",
    version: "1.0.0",
  },
  {
    id: "wp_quality_officer",
    code: "quality_officer_profile",
    displayName: "Quality Officer — Worker Profile",
    description: "Quality assessment profile. Read-only access to service records; may create quality review documents.",
    allowedExecutionChannels: ["internal_api", "document_store"],
    allowedToolCategories: ["document_tools", "reporting_tools"],
    allowedConnectorCategories: ["document_management"],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["modify_service_records", "delete_quality_reports"],
    approvalRequiredActions: ["issue_quality_alert", "escalate_to_regulator"],
    riskLevel: "low",
    status: "active",
    version: "1.0.0",
  },
  {
    id: "wp_policy_officer",
    code: "policy_officer_profile",
    displayName: "Policy Officer — Worker Profile",
    description: "Policy management profile. May draft and update policies in the document store. Publishing requires approval.",
    allowedExecutionChannels: ["internal_api", "document_store"],
    allowedToolCategories: ["document_tools", "search_tools"],
    allowedConnectorCategories: ["document_management"],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["publish_policy_without_approval", "delete_policy_version"],
    approvalRequiredActions: ["publish_policy", "archive_policy"],
    riskLevel: "low",
    status: "active",
    version: "1.0.0",
  },
  {
    id: "wp_incident_review_officer",
    code: "incident_review_officer_profile",
    displayName: "Incident Review Officer — Worker Profile",
    description: "Incident investigation profile. May query incident records, access related participant data (read-only), and draft reports.",
    allowedExecutionChannels: ["internal_api", "document_store", "database_query"],
    allowedToolCategories: ["document_tools", "form_tools", "data_tools"],
    allowedConnectorCategories: ["ndis_portal", "document_management"],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["modify_incident_records_after_submission", "identify_reporter_anonymously"],
    approvalRequiredActions: ["submit_reportable_incident_to_ndis", "notify_police", "notify_regulator"],
    riskLevel: "high",
    status: "active",
    version: "1.0.0",
  },
  {
    id: "wp_corrective_action_officer",
    code: "corrective_action_officer_profile",
    displayName: "Corrective Action Officer — Worker Profile",
    description: "Corrective action management profile. May create and update action plans linked to audits and incidents.",
    allowedExecutionChannels: ["internal_api", "document_store"],
    allowedToolCategories: ["document_tools", "form_tools"],
    allowedConnectorCategories: ["document_management"],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["close_action_without_evidence", "delete_corrective_action_record"],
    approvalRequiredActions: ["close_corrective_action", "escalate_overdue_action"],
    riskLevel: "medium",
    status: "active",
    version: "1.0.0",
  },
  {
    id: "wp_restrictive_practice_officer",
    code: "restrictive_practice_officer_profile",
    displayName: "Restrictive Practice Officer — Worker Profile",
    description: "Restrictive practice oversight profile. Highest-sensitivity compliance profile; all external submissions require explicit approval.",
    allowedExecutionChannels: ["internal_api", "document_store", "database_query"],
    allowedToolCategories: ["document_tools", "form_tools", "data_tools"],
    allowedConnectorCategories: ["ndis_portal", "document_management"],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["authorise_restrictive_practice", "modify_behavioural_support_plan_without_approval"],
    approvalRequiredActions: ["submit_rp_report_to_ndis", "document_rp_use", "generate_rp_summary_report"],
    riskLevel: "high",
    status: "active",
    version: "1.0.0",
  },

  // ── Operations Workforce ────────────────────────────────────────────────────

  {
    id: "wp_operations_manager",
    code: "operations_manager_profile",
    displayName: "Operations Manager — Worker Profile",
    description: "Operations oversight profile. May query operational data and generate capacity and workflow reports.",
    allowedExecutionChannels: ["internal_api", "database_query"],
    allowedToolCategories: ["data_tools", "reporting_tools"],
    allowedConnectorCategories: [],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["modify_staff_records", "adjust_service_agreements_unilaterally"],
    approvalRequiredActions: ["generate_executive_operations_report", "trigger_capacity_review"],
    riskLevel: "medium",
    status: "active",
    version: "1.0.0",
  },
  {
    id: "wp_service_delivery_coordinator",
    code: "service_delivery_coordinator_profile",
    displayName: "Service Delivery Coordinator — Worker Profile",
    description: "Service delivery monitoring profile. Read access to participant service records for review and reporting.",
    allowedExecutionChannels: ["internal_api", "document_store"],
    allowedToolCategories: ["data_tools", "reporting_tools"],
    allowedConnectorCategories: ["document_management"],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["modify_participant_service_records", "cancel_service_delivery"],
    approvalRequiredActions: ["generate_participant_outcome_report"],
    riskLevel: "low",
    status: "active",
    version: "1.0.0",
  },
  {
    id: "wp_roster_coordinator",
    code: "roster_coordinator_profile",
    displayName: "Roster Coordinator — Worker Profile",
    description: "Roster management profile. May query and analyse rosters; write access to roster data requires approval.",
    allowedExecutionChannels: ["internal_api", "database_query", "calendar_system"],
    allowedToolCategories: ["calendar_tools", "data_tools"],
    allowedConnectorCategories: ["calendar_system"],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["publish_roster_without_review", "modify_award_interpretation"],
    approvalRequiredActions: ["publish_roster", "override_shift_allocation"],
    riskLevel: "low",
    status: "active",
    version: "1.0.0",
  },
  {
    id: "wp_asset_coordinator",
    code: "asset_coordinator_profile",
    displayName: "Asset Coordinator — Worker Profile",
    description: "Asset management profile. May query, update, and report on organisational assets.",
    allowedExecutionChannels: ["internal_api", "database_query"],
    allowedToolCategories: ["data_tools", "form_tools"],
    allowedConnectorCategories: [],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["write_off_asset_without_approval", "dispose_of_asset"],
    approvalRequiredActions: ["record_asset_disposal", "initiate_procurement"],
    riskLevel: "low",
    status: "active",
    version: "1.0.0",
  },
  {
    id: "wp_workflow_coordinator",
    code: "workflow_coordinator_profile",
    displayName: "Workflow Coordinator — Worker Profile",
    description: "Business process design profile. May create and document operational workflows in the document store.",
    allowedExecutionChannels: ["internal_api", "document_store"],
    allowedToolCategories: ["document_tools", "data_tools"],
    allowedConnectorCategories: ["document_management"],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["activate_automated_workflow_without_approval"],
    approvalRequiredActions: ["activate_new_operational_workflow", "deprecate_existing_workflow"],
    riskLevel: "low",
    status: "active",
    version: "1.0.0",
  },

  // ── Finance Workforce ───────────────────────────────────────────────────────

  {
    id: "wp_accounts_officer",
    code: "accounts_officer_profile",
    displayName: "Accounts Officer — Worker Profile",
    description: "Accounts management profile. May query and report on accounts payable/receivable. Financial writes require approval.",
    allowedExecutionChannels: ["internal_api", "database_query"],
    allowedToolCategories: ["data_tools", "reporting_tools", "form_tools"],
    allowedConnectorCategories: ["finance_system"],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["initiate_payment", "modify_bank_account_details", "override_reconciliation"],
    approvalRequiredActions: ["submit_reconciliation_report", "flag_discrepancy_for_payment"],
    riskLevel: "high",
    status: "active",
    version: "1.0.0",
  },
  {
    id: "wp_payroll_officer",
    code: "payroll_officer_profile",
    displayName: "Payroll Officer — Worker Profile",
    description: "Payroll review profile. Highest-sensitivity finance profile. All payment actions are explicitly prohibited; review and reporting only.",
    allowedExecutionChannels: ["internal_api", "database_query"],
    allowedToolCategories: ["data_tools", "form_tools"],
    allowedConnectorCategories: ["payroll_system", "finance_system"],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: [
      "process_payment",
      "modify_bank_account_details",
      "approve_payrun",
      "access_tax_file_numbers",
      "modify_salary_without_approval",
    ],
    approvalRequiredActions: ["submit_payrun_for_approval", "generate_payslips", "reconcile_super"],
    riskLevel: "high",
    status: "active",
    version: "1.0.0",
  },
  {
    id: "wp_invoice_specialist",
    code: "invoice_specialist_profile",
    displayName: "Invoice Specialist — Worker Profile",
    description: "Invoice review profile. May query NDIS claim data, validate invoices, and draft invoice reports.",
    allowedExecutionChannels: ["internal_api", "database_query", "document_store"],
    allowedToolCategories: ["data_tools", "document_tools", "form_tools"],
    allowedConnectorCategories: ["finance_system", "ndis_portal"],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["submit_ndis_claim_without_approval", "modify_approved_invoice"],
    approvalRequiredActions: ["submit_claim_to_ndis_portal", "reject_invoice"],
    riskLevel: "medium",
    status: "active",
    version: "1.0.0",
  },
  {
    id: "wp_budget_analyst",
    code: "budget_analyst_profile",
    displayName: "Budget Analyst — Worker Profile",
    description: "Budget analysis profile. Read-only financial data access for variance analysis and budget summaries.",
    allowedExecutionChannels: ["internal_api", "database_query"],
    allowedToolCategories: ["data_tools", "reporting_tools"],
    allowedConnectorCategories: ["finance_system"],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["modify_budget_allocations", "approve_budget_variance"],
    approvalRequiredActions: ["publish_budget_report", "share_budget_data_externally"],
    riskLevel: "medium",
    status: "active",
    version: "1.0.0",
  },
  {
    id: "wp_financial_reporting_officer",
    code: "financial_reporting_officer_profile",
    displayName: "Financial Reporting Officer — Worker Profile",
    description: "Financial reporting profile. May prepare financial statements and board-level reports. Distribution requires approval.",
    allowedExecutionChannels: ["internal_api", "database_query", "document_store"],
    allowedToolCategories: ["data_tools", "reporting_tools", "document_tools"],
    allowedConnectorCategories: ["finance_system"],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["publish_financials_externally_without_approval", "modify_audited_records"],
    approvalRequiredActions: ["distribute_financial_report", "share_with_board", "submit_to_regulator"],
    riskLevel: "high",
    status: "active",
    version: "1.0.0",
  },

  // ── HR Workforce ────────────────────────────────────────────────────────────

  {
    id: "wp_hr_officer",
    code: "hr_officer_profile",
    displayName: "HR Officer — Worker Profile",
    description: "HR administration profile. May access HR documents and draft employment-related communications.",
    allowedExecutionChannels: ["internal_api", "document_store"],
    allowedToolCategories: ["document_tools", "communication_tools"],
    allowedConnectorCategories: ["hr_system", "document_management"],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["modify_employment_contracts_without_approval", "access_sensitive_medical_records"],
    approvalRequiredActions: ["issue_formal_hr_notice", "initiate_termination_process"],
    riskLevel: "medium",
    status: "active",
    version: "1.0.0",
  },
  {
    id: "wp_recruitment_officer",
    code: "recruitment_officer_profile",
    displayName: "Recruitment Officer — Worker Profile",
    description: "Recruitment profile. May draft job adverts, screen applications (read-only), and send invitation communications.",
    allowedExecutionChannels: ["internal_api", "document_store", "email_system"],
    allowedToolCategories: ["document_tools", "communication_tools", "search_tools"],
    allowedConnectorCategories: ["hr_system", "email_system"],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["make_employment_offer_without_approval", "access_referee_contact_details_without_consent"],
    approvalRequiredActions: ["send_job_offer", "reject_candidate_formally"],
    riskLevel: "low",
    status: "active",
    version: "1.0.0",
  },
  {
    id: "wp_learning_coordinator",
    code: "learning_coordinator_profile",
    displayName: "Learning Coordinator — Worker Profile",
    description: "Learning and development profile. May enrol staff in training, track completions, and schedule learning events.",
    allowedExecutionChannels: ["internal_api", "document_store", "calendar_system"],
    allowedToolCategories: ["document_tools", "calendar_tools", "data_tools"],
    allowedConnectorCategories: ["hr_system", "calendar_system"],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["mark_mandatory_training_complete_without_evidence"],
    approvalRequiredActions: ["enrol_mandatory_compliance_training", "waive_training_requirement"],
    riskLevel: "low",
    status: "active",
    version: "1.0.0",
  },
  {
    id: "wp_performance_officer",
    code: "performance_officer_profile",
    displayName: "Performance Officer — Worker Profile",
    description: "Performance review profile. May access performance data and draft review documentation; escalation requires approval.",
    allowedExecutionChannels: ["internal_api", "document_store"],
    allowedToolCategories: ["document_tools", "data_tools"],
    allowedConnectorCategories: ["hr_system"],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["issue_performance_improvement_plan_without_approval", "access_psychological_assessments"],
    approvalRequiredActions: ["initiate_pip", "escalate_performance_concern_to_leadership"],
    riskLevel: "medium",
    status: "active",
    version: "1.0.0",
  },
  {
    id: "wp_staff_compliance_officer",
    code: "staff_compliance_officer_profile",
    displayName: "Staff Compliance Officer — Worker Profile",
    description: "Staff compliance profile. May verify NDIS Worker Screening, credentials, and certifications. All external submissions require approval.",
    allowedExecutionChannels: ["internal_api", "database_query", "document_store"],
    allowedToolCategories: ["data_tools", "form_tools", "document_tools"],
    allowedConnectorCategories: ["hr_system", "ndis_portal"],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: ["access_worker_screening_raw_results", "suspend_worker_access_unilaterally"],
    approvalRequiredActions: ["flag_worker_screening_risk", "initiate_worker_suspension"],
    riskLevel: "medium",
    status: "active",
    version: "1.0.0",
  },

  // ── Marketing Workforce (coming_soon) ───────────────────────────────────────

  {
    id: "wp_marketing_director",
    code: "marketing_director_profile",
    displayName: "Marketing Director — Worker Profile",
    description: "Marketing strategy profile. Not yet active; permissions will be defined when the Marketing Workforce is released.",
    allowedExecutionChannels: ["internal_api", "document_store", "web_browser"],
    allowedToolCategories: ["document_tools", "communication_tools", "search_tools"],
    allowedConnectorCategories: [],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: [],
    approvalRequiredActions: ["publish_external_campaign"],
    riskLevel: "low",
    status: "coming_soon",
    version: "1.0.0",
  },
  {
    id: "wp_content_strategist",
    code: "content_strategist_profile",
    displayName: "Content Strategist — Worker Profile",
    description: "Content planning profile. Not yet active.",
    allowedExecutionChannels: ["internal_api", "document_store"],
    allowedToolCategories: ["document_tools", "search_tools"],
    allowedConnectorCategories: [],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: [],
    approvalRequiredActions: ["publish_content"],
    riskLevel: "low",
    status: "coming_soon",
    version: "1.0.0",
  },
  {
    id: "wp_campaign_manager",
    code: "campaign_manager_profile",
    displayName: "Campaign Manager — Worker Profile",
    description: "Campaign management profile. Not yet active.",
    allowedExecutionChannels: ["internal_api", "document_store", "email_system"],
    allowedToolCategories: ["communication_tools", "reporting_tools", "calendar_tools"],
    allowedConnectorCategories: [],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: [],
    approvalRequiredActions: ["launch_campaign", "send_campaign_email"],
    riskLevel: "low",
    status: "coming_soon",
    version: "1.0.0",
  },
  {
    id: "wp_brand_manager",
    code: "brand_manager_profile",
    displayName: "Brand Manager — Worker Profile",
    description: "Brand identity profile. Not yet active.",
    allowedExecutionChannels: ["internal_api", "document_store"],
    allowedToolCategories: ["document_tools"],
    allowedConnectorCategories: [],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: [],
    approvalRequiredActions: ["update_brand_guidelines"],
    riskLevel: "low",
    status: "coming_soon",
    version: "1.0.0",
  },
  {
    id: "wp_social_media_specialist",
    code: "social_media_specialist_profile",
    displayName: "Social Media Specialist — Worker Profile",
    description: "Social media management profile. Not yet active.",
    allowedExecutionChannels: ["internal_api", "web_browser", "document_store"],
    allowedToolCategories: ["communication_tools", "search_tools"],
    allowedConnectorCategories: [],
    allowedBrowserDomains: [],
    allowedLocalPathCategories: [],
    allowedApplicationCategories: [],
    prohibitedActions: [],
    approvalRequiredActions: ["post_to_social_media"],
    riskLevel: "low",
    status: "coming_soon",
    version: "1.0.0",
  },
];

// ─── Mapping: Workforce Role code → Worker Profile code(s) ───────────────────
// Each Workforce Role (AI Specialist) is mapped to one or more Worker Profiles.
// This is the metadata relationship the spec requires.

export const ROLE_TO_PROFILES: Record<string, string[]> = {
  chief_of_staff:               ["chief_of_staff_profile"],
  executive_assistant:          ["executive_assistant_profile"],
  research_specialist:          ["research_specialist_profile"],
  document_specialist:          ["document_specialist_profile"],
  calendar_specialist:          ["calendar_specialist_profile"],
  communication_specialist:     ["communication_specialist_profile"],
  compliance_officer:           ["compliance_officer_profile"],
  compliance_quality_manager:   ["compliance_quality_manager_profile"],
  quality_officer:              ["quality_officer_profile"],
  policy_officer:               ["policy_officer_profile"],
  incident_review_officer:      ["incident_review_officer_profile"],
  corrective_action_officer:    ["corrective_action_officer_profile"],
  restrictive_practice_officer: ["restrictive_practice_officer_profile"],
  operations_manager:           ["operations_manager_profile"],
  service_delivery_coordinator: ["service_delivery_coordinator_profile"],
  roster_coordinator:           ["roster_coordinator_profile"],
  asset_coordinator:            ["asset_coordinator_profile"],
  workflow_coordinator:         ["workflow_coordinator_profile"],
  accounts_officer:             ["accounts_officer_profile"],
  payroll_officer:              ["payroll_officer_profile"],
  invoice_specialist:           ["invoice_specialist_profile"],
  budget_analyst:               ["budget_analyst_profile"],
  financial_reporting_officer:  ["financial_reporting_officer_profile"],
  hr_officer:                   ["hr_officer_profile"],
  recruitment_officer:          ["recruitment_officer_profile"],
  learning_coordinator:         ["learning_coordinator_profile"],
  performance_officer:          ["performance_officer_profile"],
  staff_compliance_officer:     ["staff_compliance_officer_profile"],
  marketing_director:           ["marketing_director_profile"],
  content_strategist:           ["content_strategist_profile"],
  campaign_manager:             ["campaign_manager_profile"],
  brand_manager:                ["brand_manager_profile"],
  social_media_specialist:      ["social_media_specialist_profile"],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getWorkerProfileByCode(code: string): WorkerProfile | undefined {
  return WORKER_PROFILES.find(p => p.code === code);
}

export function getWorkerProfilesForRole(workforceRoleCode: string): WorkerProfile[] {
  const codes = ROLE_TO_PROFILES[workforceRoleCode] ?? [];
  return codes
    .map(code => getWorkerProfileByCode(code))
    .filter((p): p is WorkerProfile => !!p);
}

export function getActiveWorkerProfilesForRole(workforceRoleCode: string): WorkerProfile[] {
  return getWorkerProfilesForRole(workforceRoleCode).filter(
    p => p.status === "active" || p.status === "beta"
  );
}

export function getRoleCodesForProfile(workerProfileCode: string): string[] {
  return Object.entries(ROLE_TO_PROFILES)
    .filter(([, profiles]) => profiles.includes(workerProfileCode))
    .map(([roleCode]) => roleCode);
}
