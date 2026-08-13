/**
 * Sprint 33A — Unified WorkerProfile Authority Enforcement
 *
 * These tests prove the deterministic authority layer used by UEE action
 * validation. WorkforceDNA may request an action, and Blueprint may require or
 * prohibit one, but WorkerProfile remains the technical authority boundary.
 */

import { describe, expect, it } from "vitest";
import {
  evaluateWorkerProfileAuthority,
  parseExecutionActions,
  validateExecutionActions,
} from "../services/executionActionService.js";
import { getWorkerProfileByCode } from "../lib/workerProfileRegistry.js";
import type { ResourcePlan } from "../types/canonicalExecutionContext.js";

const emptyPlan: ResourcePlan = {
  evidenceProviders:      [],
  preferredProviders:     [],
  evidenceSources:        [],
  connectorSessionOpened: false,
  writeTargets:           [],
  requiredCapabilities:   [],
  connectorRequirements:  [],
  approvalRequirements:   [],
};

function profile(code: string) {
  const workerProfile = getWorkerProfileByCode(code);
  if (!workerProfile) throw new Error(`Missing profile fixture: ${code}`);
  return workerProfile;
}

describe("Sprint 33A — Operations Manager authority", () => {
  const operationsManager = profile("operations_manager_profile");

  it("permits a read/report action within allowed channel and tool category", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "operations_manager",
      workerProfile: operationsManager,
      actionIdentifier: "prepare_capacity_summary",
      actionType: "create_file",
      executionChannel: "internal_api",
      toolCategory: "reporting_tools",
    });

    expect(decision.decision).toBe("PERMITTED");
    expect(decision.workerProfileCode).toBe("operations_manager_profile");
  });

  it("blocks modify_staff_records structurally", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "operations_manager",
      workerProfile: operationsManager,
      actionIdentifier: "modify_staff_records",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "data_tools",
      approvalGranted: true,
    });

    expect(decision.decision).toBe("PROHIBITED");
    expect(decision.reason).toContain("prohibits");
  });

  it("blocks adjust_service_agreements_unilaterally structurally", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "operations_manager",
      workerProfile: operationsManager,
      actionIdentifier: "adjust_service_agreements_unilaterally",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "data_tools",
    });

    expect(decision.decision).toBe("PROHIBITED");
  });

  it("holds generate_executive_operations_report for approval", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "operations_manager",
      workerProfile: operationsManager,
      actionIdentifier: "generate_executive_operations_report",
      actionType: "create_file",
      executionChannel: "internal_api",
      toolCategory: "reporting_tools",
    });

    expect(decision.decision).toBe("APPROVAL_REQUIRED");
    expect(decision.approvalRequired).toBe(true);
  });

  it("holds trigger_capacity_review for approval", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "operations_manager",
      workerProfile: operationsManager,
      actionIdentifier: "trigger_capacity_review",
      actionType: "create_file",
      executionChannel: "internal_api",
      toolCategory: "data_tools",
    });

    expect(decision.decision).toBe("APPROVAL_REQUIRED");
  });

  it("allows an approval-required action to continue after approval is present", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "operations_manager",
      workerProfile: operationsManager,
      actionIdentifier: "trigger_capacity_review",
      actionType: "create_file",
      executionChannel: "internal_api",
      toolCategory: "data_tools",
      approvalGranted: true,
    });

    expect(decision.decision).toBe("PERMITTED");
    expect(decision.approved).toBe(true);
  });

  it("does not allow approval to bypass explicit prohibition", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "operations_manager",
      workerProfile: operationsManager,
      actionIdentifier: "modify_staff_records",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "data_tools",
      approvalGranted: true,
    });

    expect(decision.decision).toBe("PROHIBITED");
  });

  it("denies browser execution for Operations Manager", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "operations_manager",
      workerProfile: operationsManager,
      actionIdentifier: "browse_external_roster_system",
      actionType: "browser_interaction",
      executionChannel: "web_browser",
      toolCategory: "data_tools",
      browserDomain: "example.com",
    });

    expect(decision.decision).toBe("PROHIBITED");
  });

  it("denies connector categories not present in the profile", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "operations_manager",
      workerProfile: operationsManager,
      actionIdentifier: "sync_to_finance_system",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "data_tools",
      connectorCategory: "finance_system",
    });

    expect(decision.decision).toBe("PROHIBITED");
  });

  it("denies unapproved execution channels", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "operations_manager",
      workerProfile: operationsManager,
      actionIdentifier: "write_document_store_record",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "reporting_tools",
    });

    expect(decision.decision).toBe("PROHIBITED");
  });

  it("denies unapproved tool categories", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "operations_manager",
      workerProfile: operationsManager,
      actionIdentifier: "draft_external_message",
      actionType: "draft_email",
      executionChannel: "internal_api",
      toolCategory: "communication_tools",
    });

    expect(decision.decision).toBe("PROHIBITED");
  });

  it("fails closed when authority cannot be mapped", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "operations_manager",
      workerProfile: operationsManager,
      actionIdentifier: "",
      actionType: "",
      executionChannel: "internal_api",
      toolCategory: "data_tools",
    });

    expect(decision.decision).toBe("UNMAPPED_AUTHORITY");
  });
});

describe("Sprint 33A — UEE action validation with WorkerProfile", () => {
  it("fails closed when an executable action is validated without a WorkerProfile", () => {
    const actions = parseExecutionActions([
      {
        actionIdentifier: "prepare_capacity_summary",
        actionType: "create_file",
        executionChannel: "internal_api",
        toolCategory: "reporting_tools",
        approvalRequired: false,
        riskLevel: "low",
      },
    ], "run-missing-profile");

    const result = validateExecutionActions(actions, emptyPlan, {
      specialistCode: "operations_manager",
      workerProfile: null,
      workerProfileCode: null,
      executionId: "exec-missing-profile",
      taskId: "task-missing-profile",
    });

    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
    expect(result.authorityDecisions[0]?.decision).toBe("UNMAPPED_AUTHORITY");
    expect(result.authorityDecisions[0]?.workerProfileCode).toBeNull();
  });

  it("fails closed when the WorkerProfile code is unresolved", () => {
    const actions = parseExecutionActions([
      {
        actionIdentifier: "prepare_capacity_summary",
        actionType: "create_file",
        executionChannel: "internal_api",
        toolCategory: "reporting_tools",
        approvalRequired: false,
        riskLevel: "low",
      },
    ], "run-unresolved-profile");

    const result = validateExecutionActions(actions, emptyPlan, {
      specialistCode: "operations_manager",
      workerProfile: undefined,
      workerProfileCode: "missing_operations_manager_profile",
    });

    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0]?.reason).toContain("WorkerProfile authority is missing");
    expect(result.authorityDecisions[0]).toMatchObject({
      decision: "UNMAPPED_AUTHORITY",
      workerProfileCode: "missing_operations_manager_profile",
    });
  });

  it("keeps unknown executable action types unmapped instead of normalising to write_file", () => {
    const operationsManager = profile("operations_manager_profile");
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "operations_manager",
      workerProfile: operationsManager,
      actionIdentifier: "approve_roster_allocation",
      actionType: "approve_roster_allocation",
      executionChannel: "internal_api",
      toolCategory: "data_tools",
    });

    expect(decision.decision).toBe("UNMAPPED_AUTHORITY");

    const actions = parseExecutionActions([
      {
        actionIdentifier: "approve_roster_allocation",
        actionType: "approve_roster_allocation",
        executionChannel: "internal_api",
        toolCategory: "data_tools",
        approvalRequired: false,
        riskLevel: "low",
      },
    ], "run-unknown-action");

    expect(actions).toHaveLength(0);
  });

  it("still parses and permits known legitimate action aliases", () => {
    const operationsManager = profile("operations_manager_profile");
    const actions = parseExecutionActions([
      {
        actionIdentifier: "prepare_capacity_summary",
        actionType: "create",
        executionChannel: "internal_api",
        toolCategory: "reporting_tools",
        approvalRequired: false,
        riskLevel: "low",
      },
    ], "run-known-alias");

    const result = validateExecutionActions(actions, emptyPlan, {
      specialistCode: "operations_manager",
      workerProfile: operationsManager,
    });

    expect(actions[0]?.actionType).toBe("create_file");
    expect(result.valid).toHaveLength(1);
    expect(result.authorityDecisions[0]?.decision).toBe("PERMITTED");
  });

  it("model-generated prohibited intent cannot bypass WorkerProfile", () => {
    const operationsManager = profile("operations_manager_profile");
    const actions = parseExecutionActions([
      {
        actionIdentifier: "modify_staff_records",
        actionType: "update_file",
        executionChannel: "internal_api",
        toolCategory: "data_tools",
        approvalRequired: false,
        riskLevel: "low",
      },
    ], "run-1");

    const result = validateExecutionActions(actions, emptyPlan, {
      specialistCode: "operations_manager",
      workerProfile: operationsManager,
      executionId: "exec-1",
      taskId: "task-1",
    });

    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
    expect(result.authorityDecisions[0]?.decision).toBe("PROHIBITED");
  });

  it("Blueprint cannot grant an otherwise prohibited WorkerProfile action", () => {
    const operationsManager = profile("operations_manager_profile");
    const actions = parseExecutionActions([
      {
        actionIdentifier: "adjust_service_agreements_unilaterally",
        actionType: "update_file",
        executionChannel: "internal_api",
        toolCategory: "data_tools",
        approvalRequired: false,
        riskLevel: "low",
      },
    ], "run-2");

    const result = validateExecutionActions(actions, emptyPlan, {
      specialistCode: "operations_manager",
      workerProfile: operationsManager,
      blueprintProhibitedActions: [],
    });

    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0]?.reason).toContain("prohibits");
  });

  it("Blueprint prohibition also blocks an otherwise permitted action", () => {
    const operationsManager = profile("operations_manager_profile");
    const actions = parseExecutionActions([
      {
        actionIdentifier: "prepare_capacity_summary",
        actionType: "create_file",
        executionChannel: "internal_api",
        toolCategory: "reporting_tools",
        approvalRequired: false,
        riskLevel: "low",
      },
    ], "run-3");

    const result = validateExecutionActions(actions, emptyPlan, {
      specialistCode: "operations_manager",
      workerProfile: operationsManager,
      blueprintProhibitedActions: ["prepare_capacity_summary"],
    });

    expect(result.valid).toHaveLength(0);
    expect(result.authorityDecisions[0]?.decision).toBe("PROHIBITED");
  });

  it("unapproved approval-required action is held for approval instead of executed", () => {
    const operationsManager = profile("operations_manager_profile");
    const actions = parseExecutionActions([
      {
        actionIdentifier: "generate_executive_operations_report",
        actionType: "create_file",
        executionChannel: "internal_api",
        toolCategory: "reporting_tools",
        approvalRequired: false,
        riskLevel: "low",
      },
    ], "run-4");

    const result = validateExecutionActions(actions, emptyPlan, {
      specialistCode: "operations_manager",
      workerProfile: operationsManager,
    });

    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]?.requiresApproval).toBe(true);
    expect(result.approvalRequirements).toHaveLength(1);
    expect(result.authorityDecisions[0]?.decision).toBe("APPROVAL_REQUIRED");
  });

  it("permits an approval-required action after approval round-trip status is present", () => {
    const operationsManager = profile("operations_manager_profile");
    const [approvedAction] = parseExecutionActions([
      {
        actionIdentifier: "generate_executive_operations_report",
        actionType: "create_file",
        executionChannel: "internal_api",
        toolCategory: "reporting_tools",
        approvalRequired: false,
        riskLevel: "low",
      },
    ], "run-approved");
    if (!approvedAction) throw new Error("Expected action fixture");

    approvedAction.status = "approved";
    approvedAction.approvedAt = "2026-08-13T00:00:00.000Z";
    approvedAction.approvedByUserId = "user-approver";

    const result = validateExecutionActions([approvedAction], emptyPlan, {
      specialistCode: "operations_manager",
      workerProfile: operationsManager,
      approvedActionIdentifiers: ["generate_executive_operations_report"],
    });

    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]?.requiresApproval).toBe(false);
    expect(result.approvalRequirements).toHaveLength(0);
    expect(result.authorityDecisions[0]?.decision).toBe("PERMITTED");
    expect(result.authorityDecisions[0]?.approved).toBe(true);
  });

  it("keeps a prohibited action prohibited after approval status is present", () => {
    const operationsManager = profile("operations_manager_profile");
    const [approvedAction] = parseExecutionActions([
      {
        actionIdentifier: "modify_staff_records",
        actionType: "update_file",
        executionChannel: "internal_api",
        toolCategory: "data_tools",
        approvalRequired: false,
        riskLevel: "low",
      },
    ], "run-prohibited-approved");
    if (!approvedAction) throw new Error("Expected action fixture");

    approvedAction.status = "approved";
    approvedAction.approvedAt = "2026-08-13T00:00:00.000Z";
    approvedAction.approvedByUserId = "user-approver";

    const result = validateExecutionActions([approvedAction], emptyPlan, {
      specialistCode: "operations_manager",
      workerProfile: operationsManager,
      approvedActionIdentifiers: ["modify_staff_records"],
    });

    expect(result.valid).toHaveLength(0);
    expect(result.authorityDecisions[0]?.decision).toBe("PROHIBITED");
    expect(result.authorityDecisions[0]?.approved).toBe(true);
  });

  it("Blueprint cannot bypass missing WorkerProfile authority", () => {
    const actions = parseExecutionActions([
      {
        actionIdentifier: "prepare_capacity_summary",
        actionType: "create_file",
        executionChannel: "internal_api",
        toolCategory: "reporting_tools",
        approvalRequired: false,
        riskLevel: "low",
      },
    ], "run-blueprint-missing-profile");

    const result = validateExecutionActions(actions, emptyPlan, {
      specialistCode: "operations_manager",
      workerProfile: null,
      workerProfileCode: "operations_manager_profile",
      blueprintProhibitedActions: [],
    });

    expect(result.valid).toHaveLength(0);
    expect(result.authorityDecisions[0]?.decision).toBe("UNMAPPED_AUTHORITY");
  });

  it("model-generated executable action cannot bypass missing WorkerProfile authority", () => {
    const actions = parseExecutionActions([
      {
        actionIdentifier: "generate_executive_operations_report",
        actionType: "create_file",
        executionChannel: "internal_api",
        toolCategory: "reporting_tools",
        approvalRequired: false,
        riskLevel: "low",
      },
    ], "run-model-missing-profile");

    const result = validateExecutionActions(actions, emptyPlan, {
      specialistCode: "operations_manager",
      workerProfile: undefined,
      workerProfileCode: "operations_manager_profile",
    });

    expect(result.valid).toHaveLength(0);
    expect(result.approvalRequirements).toHaveLength(0);
    expect(result.authorityDecisions[0]?.decision).toBe("UNMAPPED_AUTHORITY");
  });

  it("records enforcement provenance/audit data on decisions", () => {
    const operationsManager = profile("operations_manager_profile");
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "operations_manager",
      workerProfile: operationsManager,
      actionIdentifier: "prepare_capacity_summary",
      actionType: "create_file",
      executionChannel: "internal_api",
      toolCategory: "reporting_tools",
      executionId: "exec-audit",
      taskId: "task-audit",
    });

    expect(decision.workerProfileCode).toBe("operations_manager_profile");
    expect(decision.workerProfileVersion).toBe("1.0.0");
    expect(decision.executionId).toBe("exec-audit");
    expect(decision.taskId).toBe("task-audit");
    expect(Date.parse(decision.decidedAt)).not.toBeNaN();
  });
});

describe("Sprint 33A — Executive Assistant authority", () => {
  const executiveAssistant = profile("executive_assistant_profile");

  it("permits an internal calendar draft/action-preparation request within EA authority", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "executive_assistant",
      workerProfile: executiveAssistant,
      actionIdentifier: "prepare_meeting_agenda",
      actionType: "create_file",
      executionChannel: "internal_api",
      toolCategory: "communication_tools",
    });

    expect(decision.decision).toBe("PERMITTED");
    expect(decision.workerProfileCode).toBe("executive_assistant_profile");
  });

  it("holds send_email_on_behalf_of_user for approval", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "executive_assistant",
      workerProfile: executiveAssistant,
      actionIdentifier: "send_email_on_behalf_of_user",
      actionType: "send_email",
      executionChannel: "email_system",
      toolCategory: "communication_tools",
      connectorCategory: "email_system",
    });

    expect(decision.decision).toBe("APPROVAL_REQUIRED");
  });

  it("permits send_email_on_behalf_of_user only after approval is present", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "executive_assistant",
      workerProfile: executiveAssistant,
      actionIdentifier: "send_email_on_behalf_of_user",
      actionType: "send_email",
      executionChannel: "email_system",
      toolCategory: "communication_tools",
      connectorCategory: "email_system",
      approvalGranted: true,
    });

    expect(decision.decision).toBe("PERMITTED");
    expect(decision.approved).toBe(true);
  });

  it("blocks prohibited private correspondence access even with approval", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "executive_assistant",
      workerProfile: executiveAssistant,
      actionIdentifier: "access_private_correspondence",
      actionType: "draft_email",
      executionChannel: "email_system",
      toolCategory: "communication_tools",
      connectorCategory: "email_system",
      approvalGranted: true,
    });

    expect(decision.decision).toBe("PROHIBITED");
  });

  it("fails closed for unknown EA executable action types", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "executive_assistant",
      workerProfile: executiveAssistant,
      actionIdentifier: "externally_commit_contract",
      actionType: "externally_commit_contract",
      executionChannel: "email_system",
      toolCategory: "communication_tools",
      connectorCategory: "email_system",
    });

    expect(decision.decision).toBe("UNMAPPED_AUTHORITY");
  });
});

describe("Sprint 33A — Compliance & Quality Manager authority", () => {
  const complianceQualityManager = profile("compliance_quality_manager_profile");

  it("permits internal compliance analysis and reporting within CQM authority", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "compliance_quality_manager",
      workerProfile: complianceQualityManager,
      actionIdentifier: "prepare_compliance_gap_report",
      actionType: "create_file",
      executionChannel: "internal_api",
      toolCategory: "reporting_tools",
    });

    expect(decision.decision).toBe("PERMITTED");
    expect(decision.workerProfileCode).toBe("compliance_quality_manager_profile");
  });

  it("holds external compliance reports for approval", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "compliance_quality_manager",
      workerProfile: complianceQualityManager,
      actionIdentifier: "generate_external_compliance_report",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "reporting_tools",
      connectorCategory: "document_management",
    });

    expect(decision.decision).toBe("APPROVAL_REQUIRED");
  });

  it("permits an approval-required CQM action only after approval", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "compliance_quality_manager",
      workerProfile: complianceQualityManager,
      actionIdentifier: "update_compliance_register_status",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      approvalGranted: true,
    });

    expect(decision.decision).toBe("PERMITTED");
    expect(decision.approved).toBe(true);
  });

  it("blocks regulatory submission even when approval is present", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "compliance_quality_manager",
      workerProfile: complianceQualityManager,
      actionIdentifier: "submit_regulatory_notification",
      actionType: "send_email",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      approvalGranted: true,
    });

    expect(decision.decision).toBe("PROHIBITED");
  });

  it("blocks participant and staff record mutation", () => {
    const participantDecision = evaluateWorkerProfileAuthority({
      specialistCode: "compliance_quality_manager",
      workerProfile: complianceQualityManager,
      actionIdentifier: "modify_participant_records",
      actionType: "update_file",
      executionChannel: "database_query",
      toolCategory: "data_tools",
    });
    const staffDecision = evaluateWorkerProfileAuthority({
      specialistCode: "compliance_quality_manager",
      workerProfile: complianceQualityManager,
      actionIdentifier: "modify_staff_records",
      actionType: "update_file",
      executionChannel: "database_query",
      toolCategory: "data_tools",
    });

    expect(participantDecision.decision).toBe("PROHIBITED");
    expect(staffDecision.decision).toBe("PROHIBITED");
  });

  it("denies browser and NDIS portal connector execution for CQM", () => {
    const browserDecision = evaluateWorkerProfileAuthority({
      specialistCode: "compliance_quality_manager",
      workerProfile: complianceQualityManager,
      actionIdentifier: "browse_ndis_portal",
      actionType: "browser_interaction",
      executionChannel: "web_browser",
      toolCategory: "search_tools",
      browserDomain: "ndiscommission.gov.au",
    });
    const connectorDecision = evaluateWorkerProfileAuthority({
      specialistCode: "compliance_quality_manager",
      workerProfile: complianceQualityManager,
      actionIdentifier: "submit_to_ndis_portal",
      actionType: "send_email",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      connectorCategory: "ndis_portal",
    });

    expect(browserDecision.decision).toBe("PROHIBITED");
    expect(connectorDecision.decision).toBe("PROHIBITED");
  });

  it("fails closed for unknown CQM executable action types", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "compliance_quality_manager",
      workerProfile: complianceQualityManager,
      actionIdentifier: "certify_provider_registration",
      actionType: "certify_provider_registration",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
    });

    expect(decision.decision).toBe("UNMAPPED_AUTHORITY");
  });
});

describe("Sprint 33A — Incident & Safeguarding Specialist authority", () => {
  const incidentSafeguarding = profile("incident_safeguarding_specialist_profile");

  it("permits internal incident review drafting within ISS authority", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "incident_safeguarding_specialist",
      workerProfile: incidentSafeguarding,
      actionIdentifier: "prepare_incident_review_draft",
      actionType: "create_file",
      executionChannel: "internal_api",
      toolCategory: "reporting_tools",
    });

    expect(decision.decision).toBe("PERMITTED");
    expect(decision.workerProfileCode).toBe("incident_safeguarding_specialist_profile");
  });

  it("holds external incident reports for approval", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "incident_safeguarding_specialist",
      workerProfile: incidentSafeguarding,
      actionIdentifier: "generate_external_incident_report",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "reporting_tools",
      connectorCategory: "document_management",
    });

    expect(decision.decision).toBe("APPROVAL_REQUIRED");
  });

  it("permits an approval-required ISS action only after approval", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "incident_safeguarding_specialist",
      workerProfile: incidentSafeguarding,
      actionIdentifier: "update_incident_review_status",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      approvalGranted: true,
    });

    expect(decision.decision).toBe("PERMITTED");
    expect(decision.approved).toBe(true);
  });

  it("blocks regulatory notification and serious incident closure even with approval", () => {
    const notificationDecision = evaluateWorkerProfileAuthority({
      specialistCode: "incident_safeguarding_specialist",
      workerProfile: incidentSafeguarding,
      actionIdentifier: "submit_reportable_incident_to_ndis",
      actionType: "send_email",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      approvalGranted: true,
    });
    const closureDecision = evaluateWorkerProfileAuthority({
      specialistCode: "incident_safeguarding_specialist",
      workerProfile: incidentSafeguarding,
      actionIdentifier: "close_serious_incident",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      approvalGranted: true,
    });

    expect(notificationDecision.decision).toBe("PROHIBITED");
    expect(closureDecision.decision).toBe("PROHIBITED");
  });

  it("blocks participant/staff mutation and restrictive-practice authorisation", () => {
    const participantDecision = evaluateWorkerProfileAuthority({
      specialistCode: "incident_safeguarding_specialist",
      workerProfile: incidentSafeguarding,
      actionIdentifier: "modify_participant_records",
      actionType: "update_file",
      executionChannel: "database_query",
      toolCategory: "data_tools",
    });
    const rpDecision = evaluateWorkerProfileAuthority({
      specialistCode: "incident_safeguarding_specialist",
      workerProfile: incidentSafeguarding,
      actionIdentifier: "authorise_restrictive_practice",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
    });

    expect(participantDecision.decision).toBe("PROHIBITED");
    expect(rpDecision.decision).toBe("PROHIBITED");
  });

  it("denies browser and NDIS portal connector execution for ISS", () => {
    const browserDecision = evaluateWorkerProfileAuthority({
      specialistCode: "incident_safeguarding_specialist",
      workerProfile: incidentSafeguarding,
      actionIdentifier: "browse_ndis_portal",
      actionType: "browser_interaction",
      executionChannel: "web_browser",
      toolCategory: "search_tools",
      browserDomain: "ndiscommission.gov.au",
    });
    const connectorDecision = evaluateWorkerProfileAuthority({
      specialistCode: "incident_safeguarding_specialist",
      workerProfile: incidentSafeguarding,
      actionIdentifier: "submit_to_ndis_portal",
      actionType: "send_email",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      connectorCategory: "ndis_portal",
    });

    expect(browserDecision.decision).toBe("PROHIBITED");
    expect(connectorDecision.decision).toBe("PROHIBITED");
  });

  it("fails closed for unknown ISS executable action types", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "incident_safeguarding_specialist",
      workerProfile: incidentSafeguarding,
      actionIdentifier: "certify_incident_reportability",
      actionType: "certify_incident_reportability",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
    });

    expect(decision.decision).toBe("UNMAPPED_AUTHORITY");
  });
});

describe("Sprint 33A — generic cross-specialist enforcement", () => {
  it("works for a second specialist profile without Operations Manager hardcoding", () => {
    const communication = profile("communication_specialist_profile");
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "communication_specialist",
      workerProfile: communication,
      actionIdentifier: "send_email",
      actionType: "send_email",
      executionChannel: "email_system",
      toolCategory: "communication_tools",
    });

    expect(decision.decision).toBe("APPROVAL_REQUIRED");
    expect(decision.workerProfileCode).toBe("communication_specialist_profile");
  });

  it("does not treat Chief of Staff as a superuser", () => {
    const chiefOfStaff = profile("chief_of_staff_profile");
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "chief_of_staff",
      workerProfile: chiefOfStaff,
      actionIdentifier: "send_external_communication",
      actionType: "send_email",
      executionChannel: "email_system",
      toolCategory: "communication_tools",
      approvalGranted: true,
    });

    expect(decision.decision).toBe("PROHIBITED");
  });
});
