/**
 * Sprint PCS — Platform Completion Sprint Tests
 *
 * Tests cover:
 *  - Organisation Structure Service
 *  - Organisation Configuration Service
 *  - Specialist Output Contract Service
 *  - Mock Connector — File Connector
 *  - Mock Connector — Browser and API Connectors
 *  - Organisation Runtime Service
 *  - Runtime Context Service
 *  - End-to-End Mocked Workflow
 *  - Regression checks
 *
 * All tests are deterministic. No real DB calls, no LLM calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock @workspace/db ───────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  const mockInsert = vi.fn();
  const mockSelect = vi.fn();
  const mockUpdate = vi.fn();
  const mockWhere = vi.fn();
  const mockReturning = vi.fn();
  const mockValues = vi.fn();
  const mockFrom = vi.fn();
  const mockLimit = vi.fn();
  const mockSet = vi.fn();
  const mockOrderBy = vi.fn();

  const chainable: any = {
    insert: mockInsert,
    select: mockSelect,
    update: mockUpdate,
  };

  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockReturnValue({
    returning: mockReturning,
    onConflictDoNothing: vi.fn().mockResolvedValue([]),
  });
  mockReturning.mockResolvedValue([
    {
      id: "mock-id",
      organizationId: "org-001",
      name: "Mock Item",
      code: "MOCK",
      description: null,
      parentDepartmentId: null,
      managerUserId: null,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
      // Teams
      departmentId: null,
      teamLeadUserId: null,
      // Positions
      teamId: null,
      title: "Mock Position",
      reportsToPositionId: null,
      authorityLevel: 1,
      isManager: false,
      canApproveUpToAmount: null,
      // Reporting lines
      userId: "user-001",
      reportsToUserId: "user-002",
      positionId: null,
      relationshipType: "direct",
      effectiveFrom: new Date(),
      effectiveTo: null,
      // Delegated authority
      delegatingUserId: "user-001",
      delegateUserId: "user-002",
      authorityScope: "operations",
      maxApprovalAmount: null,
      delegatedFrom: new Date(),
      delegatedUntil: null,
      reason: null,
      // Escalation paths
      triggerType: "budget_exceeded",
      stepOrder: 1,
      escalateToRole: null,
      escalateToUserId: null,
      notificationMethod: "in_app",
      timeLimitHours: null,
      isActive: true,
    },
  ]);

  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({
    limit: mockLimit,
    returning: mockReturning,
    orderBy: mockOrderBy,
  });
  mockLimit.mockResolvedValue([]);
  mockOrderBy.mockResolvedValue([]);

  // Make mockWhere resolve directly (for Promise.all patterns)
  mockWhere.mockResolvedValue = vi.fn().mockResolvedValue([]);
  // Allow .where() to be called and return [] when awaited directly
  const whereResult: any = {
    limit: mockLimit,
    returning: mockReturning,
    orderBy: mockOrderBy,
    then: (resolve: any) => Promise.resolve([]).then(resolve),
  };
  mockWhere.mockReturnValue(whereResult);

  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: mockWhere });

  return {
    db: chainable,
    orgDepartmentsTable: {
      id: "dept.id",
      organizationId: "dept.organization_id",
      name: "dept.name",
      code: "dept.code",
      description: "dept.description",
      parentDepartmentId: "dept.parent_department_id",
      managerUserId: "dept.manager_user_id",
      status: "dept.status",
      createdAt: "dept.created_at",
      updatedAt: "dept.updated_at",
      $inferSelect: {} as any,
    },
    orgTeamsTable: {
      id: "teams.id",
      organizationId: "teams.organization_id",
      departmentId: "teams.department_id",
      name: "teams.name",
      code: "teams.code",
      description: "teams.description",
      teamLeadUserId: "teams.team_lead_user_id",
      status: "teams.status",
      $inferSelect: {} as any,
    },
    orgPositionsTable: {
      id: "pos.id",
      organizationId: "pos.organization_id",
      departmentId: "pos.department_id",
      teamId: "pos.team_id",
      title: "pos.title",
      code: "pos.code",
      reportsToPositionId: "pos.reports_to_position_id",
      authorityLevel: "pos.authority_level",
      isManager: "pos.is_manager",
      canApproveUpToAmount: "pos.can_approve_up_to_amount",
      status: "pos.status",
      $inferSelect: {} as any,
    },
    orgReportingLinesTable: {
      id: "rl.id",
      organizationId: "rl.organization_id",
      userId: "rl.user_id",
      reportsToUserId: "rl.reports_to_user_id",
      positionId: "rl.position_id",
      relationshipType: "rl.relationship_type",
      effectiveFrom: "rl.effective_from",
      effectiveTo: "rl.effective_to",
      $inferSelect: {} as any,
    },
    orgDelegatedAuthorityTable: {
      id: "da.id",
      organizationId: "da.organization_id",
      delegatingUserId: "da.delegating_user_id",
      delegateUserId: "da.delegate_user_id",
      authorityScope: "da.authority_scope",
      maxApprovalAmount: "da.max_approval_amount",
      delegatedFrom: "da.delegated_from",
      delegatedUntil: "da.delegated_until",
      reason: "da.reason",
      status: "da.status",
      $inferSelect: {} as any,
    },
    orgEscalationPathsTable: {
      id: "ep.id",
      organizationId: "ep.organization_id",
      name: "ep.name",
      triggerType: "ep.trigger_type",
      stepOrder: "ep.step_order",
      escalateToRole: "ep.escalate_to_role",
      escalateToUserId: "ep.escalate_to_user_id",
      notificationMethod: "ep.notification_method",
      timeLimitHours: "ep.time_limit_hours",
      isActive: "ep.is_active",
      $inferSelect: {} as any,
    },
    orgConfigurationTable: {
      id: "cfg.id",
      organizationId: "cfg.organization_id",
      writingStyle: "cfg.writing_style",
      tone: "cfg.tone",
      usePlainEnglish: "cfg.use_plain_english",
      useAustralianEnglish: "cfg.use_australian_english",
      communicationFormality: "cfg.communication_formality",
      participantTerminology: "cfg.participant_terminology",
      workerTerminology: "cfg.worker_terminology",
      organisationTypeLabel: "cfg.organisation_type_label",
      customTerminology: "cfg.custom_terminology",
      dateFormat: "cfg.date_format",
      documentNamingConvention: "cfg.document_naming_convention",
      reportHeader: "cfg.report_header",
      reportFooter: "cfg.report_footer",
      brandPrimaryColour: "cfg.brand_primary_colour",
      businessHoursStart: "cfg.business_hours_start",
      businessHoursEnd: "cfg.business_hours_end",
      notificationPreference: "cfg.notification_preference",
      preferredCommunicationChannel: "cfg.preferred_communication_channel",
      approvalThresholdLow: "cfg.approval_threshold_low",
      approvalThresholdHigh: "cfg.approval_threshold_high",
      escalationContactRole: "cfg.escalation_contact_role",
      reportSchedule: "cfg.report_schedule",
      isConfigured: "cfg.is_configured",
      $inferSelect: {} as any,
    },
    orgResourcesTable: {
      id: "res.id",
      organizationId: "res.organization_id",
      resourceId: "res.resource_id",
      displayName: "res.display_name",
      resourceType: "res.resource_type",
      connectorType: "res.connector_type",
      sourceOfTruth: "res.source_of_truth",
      physicalLocation: "res.physical_location",
      owner: "res.owner",
      permittedEmployees: "res.permitted_employees",
      readPermissions: "res.read_permissions",
      writePermissions: "res.write_permissions",
      sensitivityClassification: "res.sensitivity_classification",
      indexingStatus: "res.indexing_status",
      lastVerified: "res.last_verified",
      auditEnabled: "res.audit_enabled",
      isActive: "res.is_active",
      createdAt: "res.created_at",
      updatedAt: "res.updated_at",
      $inferSelect: {} as any,
    },
    executionGraphNodesTable: {
      id: "egn.id",
      graphId: "egn.graph_id",
      organisationId: "egn.organisation_id",
      taskId: "egn.task_id",
      nodeId: "egn.node_id",
      nodeType: "egn.node_type",
      status: "egn.status",
      dependsOnNodeIds: "egn.depends_on_node_ids",
      startedAt: "egn.started_at",
      completedAt: "egn.completed_at",
      resultSummary: "egn.result_summary",
      errorMessage: "egn.error_message",
      createdAt: "egn.created_at",
      $inferSelect: {} as any,
    },
    executionHistoryTable: {
      id: "eh.id",
      graphId: "eh.graph_id",
      organisationId: "eh.organisation_id",
      taskId: "eh.task_id",
      specialistRunId: "eh.specialist_run_id",
      eventType: "eh.event_type",
      actorType: "eh.actor_type",
      actorId: "eh.actor_id",
      payload: "eh.payload",
      createdAt: "eh.created_at",
      $inferSelect: {} as any,
    },
    organisationMemoryTable: {
      organizationId: "om.organization_id",
      status: "om.status",
      memoryType: "om.memory_type",
      title: "om.title",
      content: "om.content",
      approvedAt: "om.approved_at",
      $inferSelect: {} as any,
    },
    organizations: {},
    organizationsTable: {
      id: "org.id",
      name: "org.name",
      displayName: "org.display_name",
      type: "org.type",
      industry: "org.industry",
      country: "org.country",
      state: "org.state",
      timezone: "org.timezone",
      ndisRegistrationNumber: "org.ndis_registration_number",
      subscriptionTier: "org.subscription_tier",
      status: "org.status",
      executionFrozen: "org.execution_frozen",
      $inferSelect: {} as any,
    },
    tasksTable: {},
    specialistRunsTable: {},
    specialistQueueTable: {},
    specialistConflictsTable: {},
    taskExecutionPlansTable: {},
    taskSpecialistsTable: {},
    eq: vi.fn((a, b) => ({ _type: "eq", a, b })),
    and: vi.fn((...args) => ({ _type: "and", args })),
  };
});

// ─── Mock drizzle-orm (used directly by some services) ───────────────────────

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ _type: "eq", a, b })),
  and: vi.fn((...args) => ({ _type: "and", args })),
  isNull: vi.fn((a) => ({ _type: "isNull", a })),
}));

// ─── Mock workforce registry ──────────────────────────────────────────────────

vi.mock("../lib/workforceRegistry.js", () => ({
  getCurrentSpecialists: vi.fn().mockReturnValue([
    { code: "chief_of_staff", displayName: "Chief of Staff", packCode: null, executionStatus: "available" },
    { code: "operations_manager", displayName: "Operations Manager", packCode: "core", executionStatus: "available" },
  ]),
  getSpecialistByCode: vi.fn((code: string) => {
    const registry: Record<string, any> = {
      chief_of_staff: { code: "chief_of_staff", displayName: "Chief of Staff", executionStatus: "available", dnaStatus: "approved" },
      operations_manager: { code: "operations_manager", displayName: "Operations Manager", executionStatus: "available", dnaStatus: "approved" },
    };
    return registry[code];
  }),
}));

// ─── Mock organisationResourceRegistryService ─────────────────────────────────

vi.mock("../services/organisationResourceRegistryService.js", () => ({
  listResources: vi.fn().mockResolvedValue([]),
  buildDescriptor: vi.fn().mockReturnValue({
    resourceId: "mock-resource",
    displayName: "Mock Resource",
    resourceType: "document",
    connectorType: "file_connector",
    availableOperations: ["read", "search"],
  }),
  getResource: vi.fn().mockResolvedValue(null),
  registerResource: vi.fn().mockResolvedValue(undefined),
  getResourcesForEmployee: vi.fn().mockResolvedValue([]),
}));

// ─── Mock runtimeContextService ───────────────────────────────────────────────

vi.mock("../services/runtimeContextService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/runtimeContextService.js")>();
  return {
    ...actual,
    assembleRuntimeContext: vi.fn().mockResolvedValue({
      organisationId: "org-001",
      employeeRoleCode: "chief_of_staff",
      assembledAt: new Date().toISOString(),
      identity: {
        organisationId: "org-001",
        name: "NeedsOps Demo Org",
        displayName: "NeedsOps Demo Organisation",
        type: "ndis_provider",
        industry: "disability_services",
        country: "AU",
        state: "VIC",
        timezone: "Australia/Melbourne",
        subscriptionTier: "professional",
        status: "active",
      },
      configuration: {
        businessHoursStart: "09:00",
        businessHoursEnd: "17:00",
        notificationPreference: "email",
      },
      memoryEntries: [],
      structure: { departmentCount: 0, teamCount: 0, positionCount: 0, escalationPaths: [] },
      availableResources: [],
      permissions: { capabilityCodes: [], resourcePermissions: {}, canBrowse: false, canExecuteConnectors: false },
      connectors: [{ connectorType: "file_connector", available: true, operationMode: "mock" }],
      enabledWorkforce: [],
      runtimeState: { executionFrozen: false, activeGraphCount: 0, pendingIntentCount: 0 },
      operationalPreferences: { businessHoursStart: "09:00", businessHoursEnd: "17:00", timezone: "Australia/Melbourne", notificationPreference: "email" },
    }),
  };
});

// ─── Mock auditService ────────────────────────────────────────────────────────

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock entitlementService ──────────────────────────────────────────────────

vi.mock("../services/entitlementService.js", () => ({
  tenantHasWorkforcePack: vi.fn().mockResolvedValue({ allowed: true, source: "plan", reasonCode: "included" }),
  tenantCanUseFeature: vi.fn().mockResolvedValue(true),
  checkUsage: vi.fn().mockResolvedValue({ allowed: true }),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import * as OrgStructureService from "../services/organisationStructureService.js";
import {
  getDefaultConfiguration,
  buildConfigurationContextString,
} from "../services/organisationConfigurationService.js";
import {
  createEmptyContract,
  validateContract,
  contractToCoSPromptBlock,
} from "../services/specialistOutputContractService.js";
import {
  MockFileConnector,
  MockBrowserConnector,
  MockApiConnector,
  MOCK_CONNECTOR_REGISTRY,
} from "../services/connectorMockService.js";
import {
  createExecutionGraph,
  addGraphNode,
  updateNodeStatus,
  prepareRetryMetadata,
  prepareRecoveryMetadata,
  MockIntentDispatcher,
} from "../services/organisationRuntimeService.js";
import {
  runtimeContextToPromptBlocks,
} from "../services/runtimeContextService.js";
import type {
  OrganisationRuntimeContext,
} from "../services/runtimeContextService.js";
// endToEndWorkflowService (runMockedWorkflow) was deleted — legacy disconnected pipeline.
// Group 8 tests that exercised it are removed below.

// ─── Regression imports ───────────────────────────────────────────────────────

import {
  CHIEF_OF_STAFF_EMPLOYEE_FILE,
} from "../../../../lib/workforce-dna/src/employees/chief-of-staff/index.js";
import {
  EXECUTIVE_ASSISTANT_EMPLOYEE_FILE,
} from "../../../../lib/workforce-dna/src/employees/executive-assistant/index.js";
import {
  BUSINESS_CAPABILITIES,
} from "../lib/capabilityRegistry.js";
import {
  validateEmployeeFile,
} from "../../../../lib/workforce-dna/src/employee/index.js";
import {
  NEEDSOPS_CONSTITUTION,
} from "../../../../lib/workforce-dna/src/constitution.js";
import {
  CHIEF_OF_STAFF_DNA,
} from "@workspace/workforce-dna";

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 1: Organisation Structure Service — types and structure
// ─────────────────────────────────────────────────────────────────────────────

describe("Group 1: Organisation Structure Service — types and structure", () => {
  it("1. Service exports createDepartment function", () => {
    expect(typeof OrgStructureService.createDepartment).toBe("function");
  });

  it("2. Service exports getDepartments function", () => {
    expect(typeof OrgStructureService.getDepartments).toBe("function");
  });

  it("3. Service exports createTeam function", () => {
    expect(typeof OrgStructureService.createTeam).toBe("function");
  });

  it("4. Service exports createPosition function", () => {
    expect(typeof OrgStructureService.createPosition).toBe("function");
  });

  it("5. Service exports setReportingLine function", () => {
    expect(typeof OrgStructureService.setReportingLine).toBe("function");
  });

  it("6. Service exports grantDelegatedAuthority function", () => {
    expect(typeof OrgStructureService.grantDelegatedAuthority).toBe("function");
  });

  it("7. Service exports createEscalationPath function", () => {
    expect(typeof OrgStructureService.createEscalationPath).toBe("function");
  });

  it("8. Service exports getEscalationPaths function", () => {
    expect(typeof OrgStructureService.getEscalationPaths).toBe("function");
  });

  it("9. Service exports getOrgStructureSummary function", () => {
    expect(typeof OrgStructureService.getOrgStructureSummary).toBe("function");
  });

  it("10. getOrgStructureSummary returns object with departmentCount, teamCount, positionCount, escalationPathCount", async () => {
    const result = await OrgStructureService.getOrgStructureSummary("org-001");
    expect(result).toHaveProperty("departmentCount");
    expect(result).toHaveProperty("teamCount");
    expect(result).toHaveProperty("positionCount");
    expect(result).toHaveProperty("escalationPathCount");
    expect(typeof result.departmentCount).toBe("number");
    expect(typeof result.teamCount).toBe("number");
    expect(typeof result.positionCount).toBe("number");
    expect(typeof result.escalationPathCount).toBe("number");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 2: Organisation Configuration Service — defaults and context string
// ─────────────────────────────────────────────────────────────────────────────

describe("Group 2: Organisation Configuration Service — defaults and context string", () => {
  it("11. getDefaultConfiguration returns an object", () => {
    const config = getDefaultConfiguration();
    expect(config).toBeDefined();
    expect(typeof config).toBe("object");
  });

  it("12. getDefaultConfiguration().useAustralianEnglish is true", () => {
    expect(getDefaultConfiguration().useAustralianEnglish).toBe(true);
  });

  it("13. getDefaultConfiguration().writingStyle is 'professional'", () => {
    expect(getDefaultConfiguration().writingStyle).toBe("professional");
  });

  it("14. getDefaultConfiguration().participantTerminology is 'Participant'", () => {
    expect(getDefaultConfiguration().participantTerminology).toBe("Participant");
  });

  it("15. getDefaultConfiguration().workerTerminology is 'Support Worker'", () => {
    expect(getDefaultConfiguration().workerTerminology).toBe("Support Worker");
  });

  it("16. getDefaultConfiguration().approvalThresholdLow is a positive number", () => {
    const threshold = getDefaultConfiguration().approvalThresholdLow;
    expect(typeof threshold).toBe("number");
    expect(threshold).toBeGreaterThan(0);
  });

  it("17. buildConfigurationContextString(defaults) returns a non-empty string", () => {
    const result = buildConfigurationContextString(getDefaultConfiguration());
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("18. buildConfigurationContextString(defaults) mentions 'participant' (the terminology)", () => {
    const result = buildConfigurationContextString(getDefaultConfiguration());
    expect(result.toLowerCase()).toContain("participant");
  });

  it("19. buildConfigurationContextString(defaults) mentions 'Australian' or 'DD/MM/YYYY'", () => {
    const result = buildConfigurationContextString(getDefaultConfiguration());
    expect(result.toLowerCase().includes("australian") || result.includes("DD/MM/YYYY")).toBe(true);
  });

  it("20. buildConfigurationContextString with custom terminology includes custom terms", () => {
    const customConfig = {
      ...getDefaultConfiguration(),
      participantTerminology: "Client",
      workerTerminology: "Care Professional",
    };
    const result = buildConfigurationContextString(customConfig);
    expect(result).toContain("Client");
    expect(result).toContain("Care Professional");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 3: Specialist Output Contract — structure and validation
// ─────────────────────────────────────────────────────────────────────────────

describe("Group 3: Specialist Output Contract — structure and validation", () => {
  it("21. createEmptyContract returns an object with contractVersion '1.0'", () => {
    const contract = createEmptyContract("operations_manager", "task-001", "run-001", "org-001");
    expect(contract.contractVersion).toBe("1.0");
  });

  it("22. createEmptyContract populates specialistRoleCode, taskId, specialistRunId, organisationId", () => {
    const contract = createEmptyContract("operations_manager", "task-001", "run-001", "org-001");
    expect(contract.specialistRoleCode).toBe("operations_manager");
    expect(contract.taskId).toBe("task-001");
    expect(contract.specialistRunId).toBe("run-001");
    expect(contract.organisationId).toBe("org-001");
  });

  it("23. createEmptyContract.findings is an empty array", () => {
    const contract = createEmptyContract("operations_manager", "task-001", "run-001", "org-001");
    expect(Array.isArray(contract.findings)).toBe(true);
    expect(contract.findings).toHaveLength(0);
  });

  it("24. createEmptyContract.recommendations is an empty array", () => {
    const contract = createEmptyContract("operations_manager", "task-001", "run-001", "org-001");
    expect(Array.isArray(contract.recommendations)).toBe(true);
    expect(contract.recommendations).toHaveLength(0);
  });

  it("25. createEmptyContract.confidence defaults to 0.0 or similar", () => {
    const contract = createEmptyContract("operations_manager", "task-001", "run-001", "org-001");
    expect(typeof contract.confidence).toBe("number");
    expect(contract.confidence).toBeGreaterThanOrEqual(0);
    expect(contract.confidence).toBeLessThanOrEqual(0.1);
  });

  it("26. validateContract with empty findings returns valid: false (incomplete contract)", () => {
    const contract = createEmptyContract("operations_manager", "task-001", "run-001", "org-001");
    // Empty contract has no summary and no confidence > 0 → invalid
    const result = validateContract(contract);
    expect(result.valid).toBe(false);
  });

  it("27. validateContract with valid contract (summary + findings + confidence > 0.5) returns valid: true", () => {
    const contract = createEmptyContract("operations_manager", "task-001", "run-001", "org-001");
    contract.summary = "Task has been completed successfully with full analysis.";
    contract.findings = ["Finding A", "Finding B"];
    contract.confidence = 0.8;
    contract.completeness = "complete";
    const result = validateContract(contract);
    expect(result.valid).toBe(true);
  });

  it("28. validateContract missing summary returns errors containing 'summary'", () => {
    const contract = createEmptyContract("operations_manager", "task-001", "run-001", "org-001");
    // summary is empty string by default
    const result = validateContract(contract);
    const hasSummaryError = result.errors.some((e) => e.toLowerCase().includes("summary"));
    expect(hasSummaryError).toBe(true);
  });

  it("29. contractToCoSPromptBlock returns a non-empty string", () => {
    const contract = createEmptyContract("operations_manager", "task-001", "run-001", "org-001");
    const block = contractToCoSPromptBlock(contract);
    expect(typeof block).toBe("string");
    expect(block.length).toBeGreaterThan(0);
  });

  it("30. contractToCoSPromptBlock includes the specialistRoleCode", () => {
    const contract = createEmptyContract("operations_manager", "task-001", "run-001", "org-001");
    const block = contractToCoSPromptBlock(contract);
    expect(block.toUpperCase()).toContain("OPERATIONS_MANAGER");
  });

  it("31. contractToCoSPromptBlock includes 'Summary' heading", () => {
    const contract = createEmptyContract("operations_manager", "task-001", "run-001", "org-001");
    const block = contractToCoSPromptBlock(contract);
    expect(block).toContain("Summary");
  });

  it("32. contractToCoSPromptBlock includes 'Findings' heading", () => {
    const contract = createEmptyContract("operations_manager", "task-001", "run-001", "org-001");
    const block = contractToCoSPromptBlock(contract);
    expect(block).toContain("Findings");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 4: Mock Connector — File Connector
// ─────────────────────────────────────────────────────────────────────────────

describe("Group 4: Mock Connector — File Connector", () => {
  const fileConnector = new MockFileConnector();
  const baseOp = {
    operationId: "op-001",
    resourceId: "res-001",
    employeeRoleCode: "operations_manager",
    organisationId: "org-001",
    connectorType: "file_connector" as const,
    operation: "search" as const,
  };

  it("33. MockFileConnector implements search() and returns success: true", async () => {
    const result = await fileConnector.search({ ...baseOp, operation: "search" });
    expect(result.success).toBe(true);
  });

  it("34. MockFileConnector implements read() and returns success: true", async () => {
    const result = await fileConnector.read({ ...baseOp, operation: "read" });
    expect(result.success).toBe(true);
  });

  it("35. MockFileConnector implements write() and returns success: true", async () => {
    const result = await fileConnector.write({ ...baseOp, operation: "write", content: "test content" });
    expect(result.success).toBe(true);
  });

  it("36. MockFileConnector implements metadata() and returns success: true", async () => {
    const result = await fileConnector.metadata({ ...baseOp, operation: "metadata" });
    expect(result.success).toBe(true);
  });

  it("37. MockFileConnector.search() result has executedAt field", async () => {
    const result = await fileConnector.search({ ...baseOp, operation: "search" });
    expect(result.executedAt).toBeDefined();
    expect(typeof result.executedAt).toBe("string");
  });

  it("38. MockFileConnector.read() result.data is defined", async () => {
    const result = await fileConnector.read({ ...baseOp, operation: "read" });
    expect(result.data).toBeDefined();
  });

  it("39. MockFileConnector.locate() returns success: true", async () => {
    const result = await fileConnector.locate({ ...baseOp, operation: "locate" });
    expect(result.success).toBe(true);
  });

  it("40. MockFileConnector.metadata() result.data contains metadata fields", async () => {
    const result = await fileConnector.metadata({ ...baseOp, operation: "metadata" });
    expect(result.data).toBeDefined();
    const data = result.data as Record<string, unknown>;
    expect(data).toHaveProperty("resourceId");
    expect(data).toHaveProperty("mimeType");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 5: Mock Connector — Browser and API Connectors
// ─────────────────────────────────────────────────────────────────────────────

describe("Group 5: Mock Connector — Browser and API Connectors", () => {
  const browserConnector = new MockBrowserConnector();
  const browserOp = {
    operationId: "op-browser-001",
    resourceId: "res-001",
    employeeRoleCode: "operations_manager",
    organisationId: "org-001",
    connectorType: "browser_connector" as const,
    operation: "openBrowser" as const,
    executionRuntime: "OpenClaw" as const,
  };

  it("41. MockBrowserConnector implements openBrowser() returning success: true", async () => {
    const result = await browserConnector.openBrowser({ ...browserOp, operation: "openBrowser" });
    expect(result.success).toBe(true);
  });

  it("42. MockBrowserConnector implements login() returning success with sessionId", async () => {
    const result = await browserConnector.login({ ...browserOp, operation: "login" });
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data).toHaveProperty("sessionId");
  });

  it("43. MockBrowserConnector implements extractContent() returning data with content", async () => {
    const result = await browserConnector.extractContent({ ...browserOp, operation: "extractContent" });
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data).toHaveProperty("content");
  });

  it("44. MockBrowserConnector implements captureScreenshot() returning success: true", async () => {
    const result = await browserConnector.captureScreenshot({ ...browserOp, operation: "captureScreenshot" });
    expect(result.success).toBe(true);
  });

  it("45. MockApiConnector implements execute() returning success: true", async () => {
    const apiConnector = new MockApiConnector("generic_api_connector");
    const result = await apiConnector.execute({
      operationId: "op-api-001",
      resourceId: "res-api-001",
      employeeRoleCode: "operations_manager",
      organisationId: "org-001",
      connectorType: "generic_api_connector",
      operation: "get",
      payload: {},
    });
    expect(result.success).toBe(true);
  });

  it("46. MockApiConnector.getCapabilities() returns a non-empty array", () => {
    const apiConnector = new MockApiConnector("xero_connector");
    const caps = apiConnector.getCapabilities();
    expect(Array.isArray(caps)).toBe(true);
    expect(caps.length).toBeGreaterThan(0);
  });

  it("47. MockApiConnector.getSupportedOperations() returns a non-empty array", () => {
    const apiConnector = new MockApiConnector("xero_connector");
    const ops = apiConnector.getSupportedOperations();
    expect(Array.isArray(ops)).toBe(true);
    expect(ops.length).toBeGreaterThan(0);
  });

  it("48. MOCK_CONNECTOR_REGISTRY has file, browser, api properties", () => {
    expect(MOCK_CONNECTOR_REGISTRY).toHaveProperty("file");
    expect(MOCK_CONNECTOR_REGISTRY).toHaveProperty("browser");
    expect(MOCK_CONNECTOR_REGISTRY).toHaveProperty("api");
    expect(MOCK_CONNECTOR_REGISTRY.file).toBeInstanceOf(MockFileConnector);
    expect(MOCK_CONNECTOR_REGISTRY.browser).toBeInstanceOf(MockBrowserConnector);
    expect(typeof MOCK_CONNECTOR_REGISTRY.api).toBe("object");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 6: Organisation Runtime Service — graph and events
// ─────────────────────────────────────────────────────────────────────────────

describe("Group 6: Organisation Runtime Service — graph and events", () => {
  it("49. createExecutionGraph returns object with graphId, organisationId, status", async () => {
    const graph = await createExecutionGraph("org-001", "task-test-49");
    expect(graph).toHaveProperty("graphId");
    expect(graph).toHaveProperty("organisationId");
    expect(graph).toHaveProperty("status");
  });

  it("50. createExecutionGraph graphId equals the taskId passed", async () => {
    const graph = await createExecutionGraph("org-001", "task-test-50");
    expect(graph.graphId).toBe("task-test-50");
  });

  it("51. createExecutionGraph initial status is 'initialising' or 'running'", async () => {
    const graph = await createExecutionGraph("org-001", "task-test-51");
    expect(["initialising", "running"]).toContain(graph.status);
  });

  it("52. addGraphNode returns a node with nodeId", async () => {
    const graph = await createExecutionGraph("org-001", "task-test-52");
    const node = await addGraphNode(graph.graphId, {
      nodeType: "specialist_run",
      status: "pending",
      dependsOnNodeIds: [],
    });
    expect(node).toHaveProperty("nodeId");
    expect(typeof node.nodeId).toBe("string");
    expect(node.nodeId.length).toBeGreaterThan(0);
  });

  it("53. addGraphNode returns node with provided nodeType", async () => {
    const graph = await createExecutionGraph("org-001", "task-test-53");
    const node = await addGraphNode(graph.graphId, {
      nodeType: "connector_call",
      status: "pending",
      dependsOnNodeIds: [],
    });
    expect(node.nodeType).toBe("connector_call");
  });

  it("54. updateNodeStatus does not throw", async () => {
    const graph = await createExecutionGraph("org-001", "task-test-54");
    const node = await addGraphNode(graph.graphId, {
      nodeType: "specialist_run",
      status: "pending",
      dependsOnNodeIds: [],
    });
    await expect(updateNodeStatus(graph.graphId, node.nodeId, "active")).resolves.not.toThrow();
  });

  it("55. prepareRetryMetadata(node, 1) returns { shouldRetry: boolean, delayMs: number, reason: string }", () => {
    const node = {
      nodeId: "node-001",
      nodeType: "specialist_run" as const,
      status: "failed" as const,
      dependsOnNodeIds: [],
    };
    const meta = prepareRetryMetadata(node, 1);
    expect(typeof meta.shouldRetry).toBe("boolean");
    expect(typeof meta.delayMs).toBe("number");
    expect(typeof meta.reason).toBe("string");
  });

  it("56. prepareRetryMetadata on attempt > max returns shouldRetry: false", () => {
    const node = {
      nodeId: "node-001",
      nodeType: "specialist_run" as const,
      status: "failed" as const,
      dependsOnNodeIds: [],
    };
    const meta = prepareRetryMetadata(node, 10);
    expect(meta.shouldRetry).toBe(false);
  });

  it("57. prepareRecoveryMetadata returns { recoverable, recoveryStrategy, affectedNodes }", async () => {
    const graph = await createExecutionGraph("org-001", "task-test-57");
    const meta = prepareRecoveryMetadata(graph);
    expect(meta).toHaveProperty("recoverable");
    expect(meta).toHaveProperty("recoveryStrategy");
    expect(meta).toHaveProperty("affectedNodes");
    expect(typeof meta.recoverable).toBe("boolean");
    expect(typeof meta.recoveryStrategy).toBe("string");
    expect(Array.isArray(meta.affectedNodes)).toBe(true);
  });

  it("58. MockIntentDispatcher.dispatch() resolves with dispatched: true", async () => {
    const dispatcher = new MockIntentDispatcher();
    const graph = await createExecutionGraph("org-001", "task-test-58");
    const intent = {
      intentId: "intent-001",
      intentType: "connector_query",
      description: "Query data",
      priority: "normal" as const,
      requiresApproval: false,
    };
    const result = await dispatcher.dispatch(intent, graph);
    expect(result.dispatched).toBe(true);
  });

  it("59. MockIntentDispatcher.dispatch() returns method: 'mock'", async () => {
    const dispatcher = new MockIntentDispatcher();
    const graph = await createExecutionGraph("org-001", "task-test-59");
    const intent = {
      intentId: "intent-001",
      intentType: "connector_query",
      description: "Query data",
      priority: "normal" as const,
      requiresApproval: false,
    };
    const result = await dispatcher.dispatch(intent, graph);
    expect(result.method).toBe("mock");
  });

  it("60. MockIntentDispatcher.canDispatch() returns true for any type", () => {
    const dispatcher = new MockIntentDispatcher();
    expect(dispatcher.canDispatch("any_type")).toBe(true);
    expect(dispatcher.canDispatch("connector_query")).toBe(true);
    expect(dispatcher.canDispatch("file_operation")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 7: Runtime Context Service — prompt blocks
// ─────────────────────────────────────────────────────────────────────────────

describe("Group 7: Runtime Context Service — prompt blocks", () => {
  // Build a mock OrganisationRuntimeContext directly — no DB calls needed
  const mockContext: OrganisationRuntimeContext = {
    organisationId: "org-001",
    employeeRoleCode: "chief_of_staff",
    assembledAt: new Date().toISOString(),
    identity: {
      organisationId: "org-001",
      name: "NeedsOps Demo Org",
      displayName: "NeedsOps Demo Organisation",
      type: "ndis_provider",
      industry: "disability_services",
      country: "AU",
      state: "VIC",
      timezone: "Australia/Melbourne",
      ndisRegistrationNumber: "4050012345",
      subscriptionTier: "professional",
      status: "active",
    },
    configuration: {
      writingStyle: "professional",
      tone: "professional",
      usePlainEnglish: true,
      useAustralianEnglish: true,
      communicationFormality: "professional",
      participantTerminology: "Participant",
      workerTerminology: "Support Worker",
      organisationTypeLabel: "NDIS Provider",
      customTerminology: {},
      dateFormat: "DD/MM/YYYY",
      documentNamingConvention: "{type}_{participant}_{date}",
      businessHoursStart: "09:00",
      businessHoursEnd: "17:00",
      notificationPreference: "both",
      preferredCommunicationChannel: "email",
      approvalThresholdLow: 50000,
      approvalThresholdHigh: 500000,
      reportSchedule: "weekly",
      isConfigured: false,
    },
    memoryEntries: [],
    structure: {
      departmentCount: 3,
      teamCount: 7,
      positionCount: 15,
      reportingLineCount: 0,
      activeDelegationCount: 0,
      escalationPaths: [{ name: "Budget Escalation", triggerType: "budget_exceeded" }],
    },
    availableResources: [
      {
        resourceId: "res-001",
        displayName: "Policy Documents",
        resourceType: "document_library",
        connectorType: "sharepoint_file_connector",
        availableOperations: ["read", "search"],
      },
    ],
    permissions: {
      capabilityCodes: ["operations.review", "operations.analysis"],
      resourcePermissions: { "res-001": ["read", "search"] },
      canBrowse: false,
      canExecuteConnectors: true,
    },
    connectors: [
      { connectorType: "file_connector", available: true, operationMode: "mock" },
      { connectorType: "browser_connector", available: false, operationMode: "unavailable" },
    ],
    enabledWorkforce: [
      { roleCode: "chief_of_staff", displayName: "Chief of Staff", packCode: null },
      { roleCode: "operations_manager", displayName: "Operations Manager", packCode: "core" },
    ],
    runtimeState: {
      executionFrozen: false,
      activeGraphCount: 0,
      pendingIntentCount: 0,
    },
    operationalPreferences: {
      businessHoursStart: "09:00",
      businessHoursEnd: "17:00",
      timezone: "Australia/Melbourne",
      notificationPreference: "email",
    },
  };

  it("61. runtimeContextToPromptBlocks returns a non-empty string given a valid context", () => {
    const output = runtimeContextToPromptBlocks(mockContext);
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });

  it("62. runtimeContextToPromptBlocks output contains 'ORG IDENTITY' or 'Organisation'", () => {
    const output = runtimeContextToPromptBlocks(mockContext);
    expect(output.includes("ORG IDENTITY") || output.toLowerCase().includes("organisation")).toBe(true);
  });

  it("63. runtimeContextToPromptBlocks output contains 'CONFIGURATION' or configuration data", () => {
    const output = runtimeContextToPromptBlocks(mockContext);
    expect(
      output.includes("CONFIGURATION") || output.includes("businessHoursStart") || output.includes("09:00")
    ).toBe(true);
  });

  it("64. runtimeContextToPromptBlocks output contains 'RESOURCES' or 'resources'", () => {
    const output = runtimeContextToPromptBlocks(mockContext);
    expect(output.toUpperCase()).toContain("RESOURCES");
  });

  it("65. runtimeContextToPromptBlocks output does not contain 'physicalLocation'", () => {
    const output = runtimeContextToPromptBlocks(mockContext);
    expect(output).not.toContain("physicalLocation");
  });

  it("66. runtimeContextToPromptBlocks output does not contain 'http://' (no raw URLs)", () => {
    const output = runtimeContextToPromptBlocks(mockContext);
    expect(output).not.toContain("http://");
  });

  it("67. runtimeContextToPromptBlocks includes runtime state (executionFrozen or similar)", () => {
    const output = runtimeContextToPromptBlocks(mockContext);
    expect(
      output.includes("RUNTIME STATE") || output.toLowerCase().includes("frozen") || output.toLowerCase().includes("execution")
    ).toBe(true);
  });

  it("68. runtimeContextToPromptBlocks with frozen execution includes 'frozen' in output", () => {
    const frozenContext: OrganisationRuntimeContext = {
      ...mockContext,
      runtimeState: { executionFrozen: true, activeGraphCount: 0, pendingIntentCount: 0 },
    };
    const output = runtimeContextToPromptBlocks(frozenContext);
    expect(output.toLowerCase()).toContain("frozen");
  });
});

// GROUP 8 (tests 69-80) exercised endToEndWorkflowService.runMockedWorkflow —
// that service was the legacy disconnected pipeline and has been deleted.
// Tests removed; the Group 9 regression suite below still covers CoS / EA / DNA integrity.

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 9: Regression — existing tests unaffected
// ─────────────────────────────────────────────────────────────────────────────

describe("Group 9: Regression — existing tests unaffected", () => {
  it("81. CHIEF_OF_STAFF_EMPLOYEE_FILE.resourceRequirements is defined (ORA sprint)", () => {
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE.resourceRequirements).toBeDefined();
  });

  it("82. EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.resourceRequirements is defined (ORA sprint)", () => {
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.resourceRequirements).toBeDefined();
  });

  it("83. BUSINESS_CAPABILITIES includes resource.locate", () => {
    const codes = BUSINESS_CAPABILITIES.map((c) => c.code);
    expect(codes).toContain("resource.locate");
  });

  it("84. BUSINESS_CAPABILITIES includes at least 50 capabilities (regression check)", () => {
    expect(BUSINESS_CAPABILITIES.length).toBeGreaterThanOrEqual(50);
  });

  it("85. validateEmployeeFile(CHIEF_OF_STAFF_EMPLOYEE_FILE) returns no errors", () => {
    const errors = validateEmployeeFile(CHIEF_OF_STAFF_EMPLOYEE_FILE);
    expect(errors).toEqual([]);
  });

  it("86. validateEmployeeFile(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE) returns no errors", () => {
    const errors = validateEmployeeFile(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE);
    expect(errors).toEqual([]);
  });

  it("87. CHIEF_OF_STAFF_DNA.currentVersion.isActive is true", () => {
    expect(CHIEF_OF_STAFF_DNA.currentVersion.isActive).toBe(true);
  });

  it("88. NEEDSOPS_CONSTITUTION has 10 principles", () => {
    expect(NEEDSOPS_CONSTITUTION).toHaveLength(10);
  });

  it("89. getDefaultConfiguration().isConfigured is false (fresh orgs start unconfigured)", () => {
    expect(getDefaultConfiguration().isConfigured).toBe(false);
  });

  it("90. contractToCoSPromptBlock on an empty contract still returns a string (graceful)", () => {
    const contract = createEmptyContract("operations_manager", "task-001", "run-001", "org-001");
    const block = contractToCoSPromptBlock(contract);
    expect(typeof block).toBe("string");
    expect(block.length).toBeGreaterThan(0);
  });
});
