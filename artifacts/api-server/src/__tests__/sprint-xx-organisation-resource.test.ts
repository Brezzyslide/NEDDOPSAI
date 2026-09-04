/**
 * Sprint XX — Organisation Resource Architecture Tests
 *
 * Tests cover:
 *  - OrganisationResourceRegistryImpl registration and discovery
 *  - ResourceManagerImpl resolution and descriptor building
 *  - Connector interface shape verification
 *  - Employee File resource reference validation
 *  - Organisation Resource Registry service
 *  - Resource Manager service
 *  - resource.locate capability
 *  - CoS and EA resourceRequirements
 *  - Platform standard rule constants
 *  - Runtime Manifest abstraction
 *
 * All tests are deterministic. No real file system, no real network, no LLM calls.
 */

import { describe, it, expect, beforeEach } from "vitest";

// ─── Mock @workspace/db ───────────────────────────────────────────────────────
// Uses a stateful in-memory store for orgResourcesTable so that
// Groups 5 & 6 (which test the DB-backed registry service) work without a
// real database. All other tables use the simple passthrough mock.

import { vi } from "vitest";

// Mock drizzle-orm so eq/and return custom objects that filterStore can parse.
// The service imports eq/and directly from drizzle-orm, not from @workspace/db.
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ __eq__: true, col, val }),
  and: (...conditions: unknown[]) => ({ __and__: true, conditions }),
  isNull: (col: unknown) => ({ __isNull__: true, col }),
  sql: (strings: TemplateStringsArray) => ({ __sql__: true, strings }),
}));

vi.mock("@workspace/db", () => {
  // ── Stateful store: org_resources rows keyed by "orgId::resourceId" ───────
  const orgResourcesStore = new Map<string, Map<string, Record<string, unknown>>>();

  function getOrgStore(orgId: string): Map<string, Record<string, unknown>> {
    if (!orgResourcesStore.has(orgId)) orgResourcesStore.set(orgId, new Map());
    return orgResourcesStore.get(orgId)!;
  }

  // ── Column tokens — encode the field name into the column reference so
  //    eq() can recover which field is being compared. ───────────────────────
  const ORG_RES_PREFIX = "__ORG_RES__";
  const orgResourcesTable: Record<string, string> = {
    __tableName__: "org_resources",
    id: `${ORG_RES_PREFIX}id`,
    organizationId: `${ORG_RES_PREFIX}organizationId`,
    resourceId: `${ORG_RES_PREFIX}resourceId`,
    isActive: `${ORG_RES_PREFIX}isActive`,
    displayName: `${ORG_RES_PREFIX}displayName`,
    resourceType: `${ORG_RES_PREFIX}resourceType`,
    connectorType: `${ORG_RES_PREFIX}connectorType`,
    sourceOfTruth: `${ORG_RES_PREFIX}sourceOfTruth`,
    physicalLocation: `${ORG_RES_PREFIX}physicalLocation`,
    owner: `${ORG_RES_PREFIX}owner`,
    permittedEmployees: `${ORG_RES_PREFIX}permittedEmployees`,
    readPermissions: `${ORG_RES_PREFIX}readPermissions`,
    writePermissions: `${ORG_RES_PREFIX}writePermissions`,
    sensitivityClassification: `${ORG_RES_PREFIX}sensitivityClassification`,
    indexingStatus: `${ORG_RES_PREFIX}indexingStatus`,
    lastVerified: `${ORG_RES_PREFIX}lastVerified`,
    auditEnabled: `${ORG_RES_PREFIX}auditEnabled`,
    healthStatus: `${ORG_RES_PREFIX}healthStatus`,
    connectorMetadata: `${ORG_RES_PREFIX}connectorMetadata`,
    updatedAt: `${ORG_RES_PREFIX}updatedAt`,
    createdAt: `${ORG_RES_PREFIX}createdAt`,
  };

  function isOrgResourcesTable(t: unknown): boolean {
    return typeof t === "object" && t !== null && (t as any).__tableName__ === "org_resources";
  }

  // ── Condition helpers ─────────────────────────────────────────────────────
  function eq(col: unknown, val: unknown) {
    return { __eq__: true, col, val };
  }
  function and(...conditions: unknown[]) {
    return { __and__: true, conditions };
  }

  function extractConditions(cond: unknown): Record<string, unknown> {
    if (!cond || typeof cond !== "object") return {};
    const c = cond as Record<string, unknown>;
    if (c.__eq__) {
      const token = String(c.col);
      const field = token.startsWith(ORG_RES_PREFIX) ? token.slice(ORG_RES_PREFIX.length) : null;
      return field ? { [field]: c.val } : {};
    }
    if (c.__and__) {
      const result: Record<string, unknown> = {};
      for (const sub of (c.conditions as unknown[])) Object.assign(result, extractConditions(sub));
      return result;
    }
    return {};
  }

  function filterStore(cond: unknown): Record<string, unknown>[] {
    const conditions = extractConditions(cond);
    const orgId = conditions.organizationId as string | undefined;
    const resourceId = conditions.resourceId as string | undefined;
    const isActiveFilter = conditions.isActive;

    let candidates: Record<string, unknown>[] = [];
    if (orgId) {
      const orgStore = orgResourcesStore.get(orgId);
      if (!orgStore) return [];
      candidates = resourceId
        ? (orgStore.has(resourceId) ? [orgStore.get(resourceId)!] : [])
        : Array.from(orgStore.values());
    } else {
      for (const os of orgResourcesStore.values()) candidates.push(...os.values());
    }

    if (isActiveFilter === true) candidates = candidates.filter(r => r.isActive !== false);
    return candidates;
  }

  // ── Stateful DB object ────────────────────────────────────────────────────
  const db = {
    select: (_projection?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => ({
          limit: (_n: number): Promise<Record<string, unknown>[]> => {
            if (isOrgResourcesTable(table)) return Promise.resolve(filterStore(cond).slice(0, _n));
            return Promise.resolve([]);
          },
          then: (resolve: (v: Record<string, unknown>[]) => void, reject: (e: unknown) => void) => {
            // select without explicit .limit() — awaited directly
            if (isOrgResourcesTable(table)) return Promise.resolve(filterStore(cond)).then(resolve, reject);
            return Promise.resolve([]).then(resolve, reject);
          },
        }),
      }),
    }),

    insert: (table: unknown) => ({
      values: (data: Record<string, unknown>) => {
        if (isOrgResourcesTable(table)) {
          const orgId = data.organizationId as string;
          const resId = data.resourceId as string;
          if (orgId && resId) getOrgStore(orgId).set(resId, { isActive: true, ...data });
        }
        return {
          returning: (): Promise<Record<string, unknown>[]> =>
            Promise.resolve([{ id: "mock-uuid", ...data }]),
          then: (resolve: (v: void) => void) => Promise.resolve().then(resolve),
        };
      },
    }),

    update: (table: unknown) => ({
      set: (data: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          if (isOrgResourcesTable(table)) {
            const conditions = extractConditions(cond);
            const orgId = conditions.organizationId as string | undefined;
            const resId = conditions.resourceId as string | undefined;
            if (orgId && resId) {
              const existing = orgResourcesStore.get(orgId)?.get(resId);
              if (existing) {
                const updated = { ...existing, ...data };
                getOrgStore(orgId).set(resId, updated);
              }
            }
          }
          return {
            returning: (): Promise<Record<string, unknown>[]> => Promise.resolve([]),
            then: (resolve: (v: void) => void) => Promise.resolve().then(resolve),
          };
        },
      }),
    }),
  };

  // ── Simple passthrough mocks for other tables ─────────────────────────────
  return {
    db,
    withSystemTenantContext: async (_ctx: unknown, fn: (client: unknown) => Promise<unknown>) => fn(db),
    eq,
    and,
    orgResourcesTable,
    tasksTable: { id: "tasks.id", organizationId: "tasks.organization_id", currentState: "tasks.current_state" },
    specialistRunsTable: { id: "runs.id", organizationId: "runs.organization_id" },
    specialistQueueTable: {
      id: "queue.id",
      organizationId: "queue.organization_id",
      specialistRunId: "queue.specialist_run_id",
      status: "queue.status",
      availableAt: "queue.available_at",
      leaseExpiresAt: "queue.lease_expires_at",
      attempts: "queue.attempts",
      priority: "queue.priority",
    },
    specialistConflictsTable: {},
    taskExecutionPlansTable: {},
    taskSpecialistsTable: {},
    organizationsTable: {},
    executionGraphNodesTable: {},
    executionHistoryTable: {},
    organisationMemoryTable: {},
    orgConfigurationTable: {},
    orgDepartmentsTable: {},
    orgTeamsTable: {},
    orgPositionsTable: {},
    orgReportingLinesTable: {},
    orgDelegatedAuthorityTable: {},
    orgEscalationPathsTable: {},
    organizations: {},
  };
});

// ─── Imports: lib/organisation-resource ───────────────────────────────────────

import { OrganisationResourceRegistryImpl } from "../../../../lib/organisation-resource/src/registry.js";
import { ResourceManagerImpl } from "../../../../lib/organisation-resource/src/resourceManager.js";
import {
  PROHIBITED_EMPLOYEE_FILE_REFERENCES,
  SOURCE_OF_TRUTH_RULE,
  PLATFORM_RESOURCE_RULE,
} from "../../../../lib/organisation-resource/src/types.js";
import type {
  OrganisationResource,
  ResourceRequest,
  FileConnectorOperation,
  BrowserConnectorOperation,
  ApiConnectorOperation,
  ConnectorResult,
} from "../../../../lib/organisation-resource/src/types.js";
import { validateNoDirectResourceReferences } from "../../../../lib/organisation-resource/src/validation.js";

// ─── Imports: api-server services ─────────────────────────────────────────────

import {
  registerResource,
  getResource,
  getResourcesForEmployee,
  buildDescriptor,
  hasPermission,
  listResources,
} from "../services/organisationResourceRegistryService.js";
import type { ResourceEntry } from "../services/organisationResourceRegistryService.js";

import { resolveResourceRequest } from "../services/resourceManagerService.js";
import type { ResourceRequest as ServiceResourceRequest } from "../services/resourceManagerService.js";

// ─── Imports: capability registry ─────────────────────────────────────────────

import { BUSINESS_CAPABILITIES } from "../lib/capabilityRegistry.js";

// ─── Imports: workforce-dna ───────────────────────────────────────────────────

import { COS_RESOURCE_REQUIREMENTS } from "../../../../lib/workforce-dna/src/employees/chief-of-staff/resource-requirements.js";
import { EA_RESOURCE_REQUIREMENTS } from "../../../../lib/workforce-dna/src/employees/executive-assistant/resource-requirements.js";
import { CHIEF_OF_STAFF_EMPLOYEE_FILE } from "../../../../lib/workforce-dna/src/employees/chief-of-staff/index.js";
import { EXECUTIVE_ASSISTANT_EMPLOYEE_FILE } from "../../../../lib/workforce-dna/src/employees/executive-assistant/index.js";
import { validateEmployeeFile } from "../../../../lib/workforce-dna/src/employee/index.js";
import { buildSystemInstructionForEmployee } from "../../../../lib/workforce-dna/src/registry.js";

// ─── Shared test data ─────────────────────────────────────────────────────────

function makeResource(overrides: Partial<OrganisationResource> = {}): OrganisationResource {
  return {
    resourceId: "policies",
    displayName: "Organisation Policies",
    resourceType: "document_library",
    connectorType: "sharepoint_file_connector",
    sourceOfTruth: "SharePoint",
    physicalLocation: "https://company.sharepoint.com/sites/policies",
    owner: "chief_of_staff",
    permittedEmployees: ["chief_of_staff", "executive_assistant"],
    readPermissions: ["chief_of_staff", "executive_assistant"],
    writePermissions: ["chief_of_staff"],
    sensitivityClassification: "organisational",
    indexingStatus: "indexed",
    lastVerified: "2026-07-01T00:00:00.000Z",
    auditEnabled: true,
    ...overrides,
  };
}

function makeServiceResourceEntry(overrides: Partial<ResourceEntry> = {}): ResourceEntry {
  return {
    resourceId: "policies",
    displayName: "Organisation Policies",
    resourceType: "document_library",
    connectorType: "sharepoint_file_connector",
    sourceOfTruth: "SharePoint",
    physicalLocation: "https://company.sharepoint.com/sites/policies",
    owner: "chief_of_staff",
    permittedEmployees: ["chief_of_staff", "executive_assistant"],
    readPermissions: ["chief_of_staff", "executive_assistant"],
    writePermissions: ["chief_of_staff"],
    sensitivityClassification: "organisational",
    indexingStatus: "indexed",
    lastVerified: "2026-07-01T00:00:00.000Z",
    auditEnabled: true,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 1: OrganisationResourceRegistryImpl — registration and discovery
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 1: OrganisationResourceRegistryImpl — registration and discovery", () => {
  let registry: OrganisationResourceRegistryImpl;

  const policiesResource = makeResource({
    resourceId: "policies",
    resourceType: "document_library",
    connectorType: "sharepoint_file_connector",
    permittedEmployees: ["chief_of_staff"],
    readPermissions: ["chief_of_staff"],
    writePermissions: [],
  });

  const calendarResource = makeResource({
    resourceId: "calendar",
    displayName: "Organisation Calendar",
    resourceType: "calendar",
    connectorType: "microsoft_graph_connector",
    permittedEmployees: ["executive_assistant"],
    readPermissions: ["executive_assistant"],
    writePermissions: ["executive_assistant"],
  });

  const emailResource = makeResource({
    resourceId: "email",
    displayName: "Organisation Email",
    resourceType: "email",
    connectorType: "microsoft_graph_connector",
    permittedEmployees: ["executive_assistant"],
    readPermissions: ["executive_assistant"],
    writePermissions: ["executive_assistant"],
  });

  const tasksResource = makeResource({
    resourceId: "tasks",
    displayName: "Task Management",
    resourceType: "task_management",
    connectorType: "generic_api_connector",
    permittedEmployees: ["executive_assistant", "chief_of_staff"],
    readPermissions: ["executive_assistant", "chief_of_staff"],
    writePermissions: ["executive_assistant"],
  });

  const participantRecordsResource = makeResource({
    resourceId: "participant-records",
    displayName: "Participant Records",
    resourceType: "database_view",
    connectorType: "lumary_connector",
    permittedEmployees: ["chief_of_staff"],
    readPermissions: ["chief_of_staff"],
    writePermissions: [],
    sensitivityClassification: "restricted",
  });

  beforeEach(() => {
    registry = new OrganisationResourceRegistryImpl();
  });

  it("test 1: register + getById — registered resource is retrievable by id", () => {
    registry.register(policiesResource);
    const retrieved = registry.getById("policies");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.resourceId).toBe("policies");
    expect(retrieved?.resourceType).toBe("document_library");
  });

  it("test 2: register duplicate — registering same resourceId overwrites the previous entry", () => {
    registry.register(policiesResource);
    const updated = { ...policiesResource, displayName: "Updated Policies" };
    registry.register(updated);
    const retrieved = registry.getById("policies");
    expect(retrieved?.displayName).toBe("Updated Policies");
    expect(registry.count()).toBe(1);
  });

  it("test 3: getByType — returns only resources of the specified type", () => {
    registry.register(policiesResource);
    registry.register(calendarResource);
    registry.register(emailResource);
    const documentLibraries = registry.getByType("document_library");
    expect(documentLibraries).toHaveLength(1);
    expect(documentLibraries[0].resourceId).toBe("policies");
  });

  it("test 4: getPermittedForEmployee — chief_of_staff can access policies, executive_assistant can access calendar", () => {
    registry.register(policiesResource);
    registry.register(calendarResource);
    registry.register(emailResource);

    const cosResources = registry.getPermittedForEmployee("chief_of_staff");
    const eaResources = registry.getPermittedForEmployee("executive_assistant");

    expect(cosResources.map(r => r.resourceId)).toContain("policies");
    expect(eaResources.map(r => r.resourceId)).toContain("calendar");
  });

  it("test 5: getPermittedForEmployee — excludes resources where employee is not in permittedEmployees", () => {
    registry.register(policiesResource);   // only chief_of_staff
    registry.register(calendarResource);   // only executive_assistant

    const cosResources = registry.getPermittedForEmployee("chief_of_staff");
    const eaResources = registry.getPermittedForEmployee("executive_assistant");

    expect(cosResources.map(r => r.resourceId)).not.toContain("calendar");
    expect(eaResources.map(r => r.resourceId)).not.toContain("policies");
  });

  it("test 6: hasPermission (read) — returns true for employee in readPermissions", () => {
    registry.register(policiesResource);
    expect(registry.hasPermission("policies", "chief_of_staff", "read")).toBe(true);
  });

  it("test 7: hasPermission (write) — returns false for employee not in writePermissions", () => {
    registry.register(calendarResource);
    // chief_of_staff is not in writePermissions for calendar
    expect(registry.hasPermission("calendar", "chief_of_staff", "write")).toBe(false);
  });

  it("test 8: validate — valid resource passes validation with no errors", () => {
    const result = registry.validate(policiesResource);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("test 9: validate — missing required fields produces errors", () => {
    const partial: Partial<OrganisationResource> = {
      resourceId: "incomplete",
      // missing displayName, resourceType, connectorType, etc.
    };
    const result = registry.validate(partial);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    // Check that it mentions missing fields
    const errorText = result.errors.join(" ");
    expect(errorText).toContain("displayName");
  });

  it("test 10: count — list().length and count() match registered resources", () => {
    registry.register(policiesResource);
    registry.register(calendarResource);
    registry.register(emailResource);
    registry.register(tasksResource);
    registry.register(participantRecordsResource);

    expect(registry.count()).toBe(5);
    expect(registry.list()).toHaveLength(5);
    expect(registry.list().length).toBe(registry.count());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 2: ResourceManagerImpl — resolution and descriptor
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 2: ResourceManagerImpl — resolution and descriptor", () => {
  let registry: OrganisationResourceRegistryImpl;
  let manager: ResourceManagerImpl;

  const permittedResource = makeResource({
    resourceId: "policies",
    resourceType: "document_library",
    connectorType: "sharepoint_file_connector",
    permittedEmployees: ["chief_of_staff"],
    readPermissions: ["chief_of_staff"],
    writePermissions: ["chief_of_staff"],
  });

  const restrictedResource = makeResource({
    resourceId: "participant-records",
    displayName: "Participant Records",
    resourceType: "database_view",
    connectorType: "lumary_connector",
    permittedEmployees: ["chief_of_staff"],
    readPermissions: ["chief_of_staff"],
    writePermissions: [],
    sensitivityClassification: "restricted",
  });

  const baseRequest: ResourceRequest = {
    requestId: "req-001",
    requestingEmployee: "chief_of_staff",
    requestingUser: "user-001",
    organisationId: "org-001",
    resourceId: "policies",
    purpose: "Review organisation policies",
    requiredPermissions: ["read"],
  };

  beforeEach(() => {
    registry = new OrganisationResourceRegistryImpl();
    manager = new ResourceManagerImpl();
    registry.register(permittedResource);
    registry.register(restrictedResource);
  });

  it("test 11: resolveRequest (granted) — returns status 'granted' and a ResourceDescriptor", async () => {
    const response = await manager.resolveRequest(baseRequest, registry);
    expect(response.status).toBe("granted");
    expect(response.descriptor).toBeDefined();
    expect(response.descriptor.resourceId).toBe("policies");
  });

  it("test 12: resolveRequest — descriptor never includes physicalLocation", async () => {
    const response = await manager.resolveRequest(baseRequest, registry);
    expect(response.status).toBe("granted");
    const descriptorKeys = Object.keys(response.descriptor);
    expect(descriptorKeys).not.toContain("physicalLocation");
    // Also verify no physical location value leaked in
    const descriptorStr = JSON.stringify(response.descriptor);
    expect(descriptorStr).not.toContain("sharepoint.com");
  });

  it("test 13: resolveRequest — descriptor never includes credentials or implementation metadata", async () => {
    const response = await manager.resolveRequest(baseRequest, registry);
    expect(response.status).toBe("granted");
    const descriptorKeys = Object.keys(response.descriptor);
    expect(descriptorKeys).not.toContain("credentials");
    expect(descriptorKeys).not.toContain("password");
    expect(descriptorKeys).not.toContain("apiKey");
    expect(descriptorKeys).not.toContain("secret");
    expect(descriptorKeys).not.toContain("physicalLocation");
  });

  it("test 14: resolveRequest (not_found) — unknown resourceId returns status 'not_found'", async () => {
    const request: ResourceRequest = {
      ...baseRequest,
      requestId: "req-002",
      resourceId: "nonexistent-resource",
    };
    const response = await manager.resolveRequest(request, registry);
    expect(response.status).toBe("not_found");
  });

  it("test 15: resolveRequest (denied) — employee not in permittedEmployees returns status 'denied'", async () => {
    const request: ResourceRequest = {
      ...baseRequest,
      requestId: "req-003",
      requestingEmployee: "executive_assistant",
      resourceId: "policies",
    };
    const response = await manager.resolveRequest(request, registry);
    expect(response.status).toBe("denied");
  });

  it("test 16: buildDescriptor — converts OrganisationResource to ResourceDescriptor without physicalLocation", () => {
    const descriptor = manager.buildDescriptor(permittedResource, "chief_of_staff");
    expect(descriptor.resourceId).toBe("policies");
    expect(descriptor.displayName).toBeDefined();
    expect(descriptor.resourceType).toBe("document_library");
    const keys = Object.keys(descriptor);
    expect(keys).not.toContain("physicalLocation");
  });

  it("test 17: buildDescriptor — employeePermissions correctly reflects allowed operations", () => {
    // chief_of_staff has read + write permissions
    const descriptor = manager.buildDescriptor(permittedResource, "chief_of_staff");
    expect(descriptor.employeePermissions).toContain("read");
    expect(descriptor.employeePermissions).toContain("write");
  });

  it("test 18: buildDescriptor — availableOperations correctly reflects the resource operations", () => {
    const descriptor = manager.buildDescriptor(permittedResource, "chief_of_staff");
    // canRead → read, search, metadata, watch; canWrite → write, create, delete
    expect(descriptor.availableOperations).toContain("read");
    expect(descriptor.availableOperations).toContain("write");
    expect(descriptor.availableOperations.length).toBeGreaterThan(0);
  });

  it("test 19: validateEmployeeAccess — permitted employee returns { permitted: true }", () => {
    const result = manager.validateEmployeeAccess(permittedResource, baseRequest);
    expect(result.permitted).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("test 20: validateEmployeeAccess — non-permitted employee returns { permitted: false, reason }", () => {
    const request: ResourceRequest = {
      ...baseRequest,
      requestingEmployee: "executive_assistant",
    };
    const result = manager.validateEmployeeAccess(permittedResource, request);
    expect(result.permitted).toBe(false);
    expect(result.reason).toBeDefined();
    expect(typeof result.reason).toBe("string");
    expect(result.reason!.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 3: Connector interfaces — shape verification
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 3: Connector interface shape verification", () => {
  it("test 21: FileConnectorOperation has operation field with search/read/write/etc options", () => {
    // Type-level check: construct a valid FileConnectorOperation shape
    const op: FileConnectorOperation = {
      operationId: "op-001",
      resourceId: "policies",
      employeeRoleCode: "chief_of_staff",
      organisationId: "org-001",
      connectorType: "sharepoint_file_connector",
      operation: "search",
      query: "annual report",
    };
    expect(op.operation).toBe("search");

    const opRead: FileConnectorOperation = { ...op, operation: "read" };
    expect(opRead.operation).toBe("read");

    const opWrite: FileConnectorOperation = { ...op, operation: "write" };
    expect(opWrite.operation).toBe("write");

    // Verify all expected operations are valid type values
    const validOps = ["search", "locate", "open", "read", "write", "copy", "move", "delete", "metadata", "watch"];
    for (const validOp of validOps) {
      const testOp: FileConnectorOperation = { ...op, operation: validOp as FileConnectorOperation["operation"] };
      expect(testOp.operation).toBe(validOp);
    }
  });

  it("test 22: BrowserConnectorOperation has executionRuntime: 'OpenClaw' constraint", () => {
    const op: BrowserConnectorOperation = {
      operationId: "op-002",
      resourceId: "web-app",
      employeeRoleCode: "chief_of_staff",
      organisationId: "org-001",
      connectorType: "browser_connector",
      operation: "navigate",
      targetUrl: "https://example.com",
      executionRuntime: "OpenClaw",
    };
    expect(op.executionRuntime).toBe("OpenClaw");
    expect(op.connectorType).toBe("browser_connector");
  });

  it("test 23: BrowserConnectorOperation operation includes captureScreenshot and extractContent", () => {
    const baseOp: Omit<BrowserConnectorOperation, "operation"> = {
      operationId: "op-003",
      resourceId: "web-app",
      employeeRoleCode: "chief_of_staff",
      organisationId: "org-001",
      connectorType: "browser_connector",
      executionRuntime: "OpenClaw",
    };

    const screenshotOp: BrowserConnectorOperation = { ...baseOp, operation: "captureScreenshot" };
    expect(screenshotOp.operation).toBe("captureScreenshot");

    const extractOp: BrowserConnectorOperation = { ...baseOp, operation: "extractContent" };
    expect(extractOp.operation).toBe("extractContent");
  });

  it("test 24: ApiConnectorOperation connectorType includes xero_connector and lumary_connector", () => {
    const xeroOp: ApiConnectorOperation = {
      operationId: "op-004",
      resourceId: "accounting",
      employeeRoleCode: "finance_officer",
      organisationId: "org-001",
      connectorType: "xero_connector",
      operation: "getInvoices",
    };
    expect(xeroOp.connectorType).toBe("xero_connector");

    const lumaryOp: ApiConnectorOperation = {
      operationId: "op-005",
      resourceId: "participant-records",
      employeeRoleCode: "chief_of_staff",
      organisationId: "org-001",
      connectorType: "lumary_connector",
      operation: "getParticipantRecords",
    };
    expect(lumaryOp.connectorType).toBe("lumary_connector");
  });

  it("test 25: ConnectorResult has success boolean and executedAt timestamp", () => {
    const result: ConnectorResult = {
      operationId: "op-001",
      success: true,
      data: { files: [] },
      executedAt: new Date().toISOString(),
      auditRecordId: "audit-001",
    };
    expect(typeof result.success).toBe("boolean");
    expect(typeof result.executedAt).toBe("string");
    expect(result.success).toBe(true);

    const failResult: ConnectorResult = {
      operationId: "op-002",
      success: false,
      errorCode: "NOT_FOUND",
      errorMessage: "Resource not found",
      executedAt: new Date().toISOString(),
    };
    expect(failResult.success).toBe(false);
    expect(failResult.errorCode).toBe("NOT_FOUND");
  });

  it("test 26: PROHIBITED_EMPLOYEE_FILE_REFERENCES includes sharepoint, chrome, openclaw, https://", () => {
    const refs = PROHIBITED_EMPLOYEE_FILE_REFERENCES as readonly string[];
    expect(refs).toContain("sharepoint");
    expect(refs).toContain("chrome");
    expect(refs).toContain("openclaw");
    expect(refs).toContain("https://");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 4: Employee File resource reference validation
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 4: Employee File resource reference validation", () => {
  it("test 27: validateNoDirectResourceReferences — 'Uses SharePoint for document storage' → error found", () => {
    const result = validateNoDirectResourceReferences(
      "Uses SharePoint for document storage",
      "responsibilities",
    );
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.prohibitedReferencesFound).toContain("sharepoint");
  });

  it("test 28: validateNoDirectResourceReferences — 'Accesses data via Chrome browser' → error found", () => {
    const result = validateNoDirectResourceReferences(
      "Accesses data via Chrome browser",
      "responsibilities",
    );
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.prohibitedReferencesFound).toContain("chrome");
  });

  it("test 29: validateNoDirectResourceReferences — 'Routes through OpenClaw automation' → error found", () => {
    const result = validateNoDirectResourceReferences(
      "Routes through OpenClaw automation",
      "responsibilities",
    );
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.prohibitedReferencesFound).toContain("openclaw");
  });

  it("test 30: validateNoDirectResourceReferences — 'Requests documents through Resource Manager' → no error", () => {
    const result = validateNoDirectResourceReferences(
      "Requests documents through Resource Manager",
      "responsibilities",
    );
    expect(result.errors).toHaveLength(0);
    expect(result.prohibitedReferencesFound).toHaveLength(0);
  });

  it("test 31: validateNoDirectResourceReferences — 'Connects to https://company.sharepoint.com' → errors for both https:// and sharepoint", () => {
    const result = validateNoDirectResourceReferences(
      "Connects to https://company.sharepoint.com",
      "responsibilities",
    );
    expect(result.prohibitedReferencesFound).toContain("https://");
    expect(result.prohibitedReferencesFound).toContain("sharepoint");
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("test 32: validateNoDirectResourceReferences — clean text → no errors, prohibitedReferencesFound is empty", () => {
    const result = validateNoDirectResourceReferences(
      "Manages resources through the Organisation Resource Registry and Resource Manager",
      "responsibilities",
    );
    expect(result.errors).toHaveLength(0);
    expect(result.prohibitedReferencesFound).toHaveLength(0);
  });

  it("test 33: validateEmployeeFile — Employee File without resourceRequirements returns errors", () => {
    const fileWithoutResourceRequirements = {
      ...CHIEF_OF_STAFF_EMPLOYEE_FILE,
      resourceRequirements: undefined,
    };
    const errors = validateEmployeeFile(fileWithoutResourceRequirements as any);
    const hasResourceError = errors.some(e =>
      e.toLowerCase().includes("resourcerequirements") ||
      e.toLowerCase().includes("resource requirements")
    );
    expect(hasResourceError).toBe(true);
  });

  it("test 34: validateEmployeeFile — Employee File with resourceRequirements passes (no resourceRequirements error)", () => {
    const errors = validateEmployeeFile(CHIEF_OF_STAFF_EMPLOYEE_FILE);
    const hasResourceError = errors.some(e =>
      e.toLowerCase().includes("resourcerequirements") ||
      e.toLowerCase().includes("resource requirements")
    );
    expect(hasResourceError).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 5: Organisation Resource Registry service
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 5: Organisation Resource Registry service", () => {
  const testOrgId = `test-org-group5-${Math.random().toString(36).slice(2)}`;
  const otherOrgId = `other-org-group5-${Math.random().toString(36).slice(2)}`;

  const testEntry = makeServiceResourceEntry({
    resourceId: "policies-g5",
    permittedEmployees: ["chief_of_staff"],
    readPermissions: ["chief_of_staff"],
    writePermissions: [],
  });

  beforeEach(async () => {
    // Register a fresh resource for each test
    await registerResource(testOrgId, testEntry);
  });

  it("test 35: registerResource + getResource — registered resource is retrievable", async () => {
    const retrieved = await getResource(testOrgId, "policies-g5");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.resourceId).toBe("policies-g5");
    expect(retrieved?.displayName).toBe("Organisation Policies");
  });

  it("test 36: getResource — unknown resourceId returns null", async () => {
    const result = await getResource(testOrgId, "nonexistent-resource-g5");
    expect(result).toBeNull();
  });

  it("test 37: buildDescriptor — output never contains physicalLocation field value", async () => {
    const resource = await getResource(testOrgId, "policies-g5");
    expect(resource).not.toBeNull();
    const descriptor = buildDescriptor(resource!, "chief_of_staff");
    const keys = Object.keys(descriptor);
    expect(keys).not.toContain("physicalLocation");
    const descriptorStr = JSON.stringify(descriptor);
    expect(descriptorStr).not.toContain("sharepoint.com");
  });

  it("test 38: buildDescriptor — output matches ResourceDescriptor shape", async () => {
    const resource = await getResource(testOrgId, "policies-g5");
    const descriptor = buildDescriptor(resource!, "chief_of_staff");
    expect(descriptor).toHaveProperty("resourceId");
    expect(descriptor).toHaveProperty("displayName");
    expect(descriptor).toHaveProperty("resourceType");
    expect(descriptor).toHaveProperty("connectorType");
    expect(descriptor).toHaveProperty("sourceOfTruth");
    expect(descriptor).toHaveProperty("classification");
    expect(descriptor).toHaveProperty("availableOperations");
    expect(descriptor).toHaveProperty("employeePermissions");
    expect(Array.isArray(descriptor.availableOperations)).toBe(true);
    expect(Array.isArray(descriptor.employeePermissions)).toBe(true);
  });

  it("test 39: hasPermission — read permission check works", async () => {
    const resource = await getResource(testOrgId, "policies-g5");
    expect(resource).not.toBeNull();
    const canRead = hasPermission(resource!, "chief_of_staff", "read");
    expect(canRead).toBe(true);
    const canWrite = hasPermission(resource!, "executive_assistant", "write");
    expect(canWrite).toBe(false);
  });

  it("test 40: getResourcesForEmployee — filters by permittedEmployees", async () => {
    const cosResources = await getResourcesForEmployee(testOrgId, "chief_of_staff");
    const eaResources = await getResourcesForEmployee(testOrgId, "executive_assistant");
    expect(cosResources.map(r => r.resourceId)).toContain("policies-g5");
    // executive_assistant is not in permittedEmployees for policies-g5
    expect(eaResources.map(r => r.resourceId)).not.toContain("policies-g5");
  });

  it("test 41: listResources — returns all resources for an organisation", async () => {
    const resourceB = makeServiceResourceEntry({
      resourceId: "calendar-g5",
      displayName: "Calendar",
      resourceType: "calendar",
      connectorType: "microsoft_graph_connector",
      permittedEmployees: ["executive_assistant"],
      readPermissions: ["executive_assistant"],
      writePermissions: ["executive_assistant"],
    });
    await registerResource(testOrgId, resourceB);

    const all = await listResources(testOrgId);
    const ids = all.map(r => r.resourceId);
    expect(ids).toContain("policies-g5");
    expect(ids).toContain("calendar-g5");
  });

  it("test 42: getResourcesForEmployee — different organisation returns no results for the other org's resources", async () => {
    // The policies-g5 resource is registered under testOrgId, not otherOrgId
    const otherOrgResources = await getResourcesForEmployee(otherOrgId, "chief_of_staff");
    const ids = otherOrgResources.map(r => r.resourceId);
    expect(ids).not.toContain("policies-g5");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 6: Resource Manager service
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 6: Resource Manager service", () => {
  const testOrgId = `test-org-group6-${Math.random().toString(36).slice(2)}`;

  const testEntry = makeServiceResourceEntry({
    resourceId: "policies-g6",
    permittedEmployees: ["chief_of_staff"],
    readPermissions: ["chief_of_staff"],
    writePermissions: [],
    sensitivityClassification: "organisational",
  });

  const highlyConfidentialEntry = makeServiceResourceEntry({
    resourceId: "confidential-g6",
    displayName: "Highly Confidential Records",
    resourceType: "database_view",
    connectorType: "lumary_connector",
    permittedEmployees: ["chief_of_staff"],
    readPermissions: ["chief_of_staff"],
    writePermissions: [],
    sensitivityClassification: "highly_confidential",
  });

  beforeEach(async () => {
    await registerResource(testOrgId, testEntry);
    await registerResource(testOrgId, highlyConfidentialEntry);
  });

  it("test 43: resolveResourceRequest — granted for valid employee and resource", async () => {
    const request: ServiceResourceRequest = {
      requestId: "req-g6-001",
      requestingEmployee: "chief_of_staff",
      requestingUser: "user-001",
      organisationId: testOrgId,
      resourceId: "policies-g6",
      purpose: "Review policies",
      requiredPermissions: ["read"],
    };
    const result = await resolveResourceRequest(request);
    expect(result.status).toBe("granted");
    expect(result.descriptor).toBeDefined();
  });

  it("test 44: resolveResourceRequest — denied for employee not in permittedEmployees", async () => {
    const request: ServiceResourceRequest = {
      requestId: "req-g6-002",
      requestingEmployee: "executive_assistant",
      requestingUser: "user-001",
      organisationId: testOrgId,
      resourceId: "policies-g6",
      purpose: "Review policies",
      requiredPermissions: ["read"],
    };
    const result = await resolveResourceRequest(request);
    expect(result.status).toBe("denied");
  });

  it("test 45: resolveResourceRequest — not_found for unknown resource", async () => {
    const request: ServiceResourceRequest = {
      requestId: "req-g6-003",
      requestingEmployee: "chief_of_staff",
      requestingUser: "user-001",
      organisationId: testOrgId,
      resourceId: "nonexistent-g6",
      purpose: "Review policies",
      requiredPermissions: ["read"],
    };
    const result = await resolveResourceRequest(request);
    expect(result.status).toBe("not_found");
  });

  it("test 46: resolveResourceRequest — descriptor never includes physicalLocation", async () => {
    const request: ServiceResourceRequest = {
      requestId: "req-g6-004",
      requestingEmployee: "chief_of_staff",
      requestingUser: "user-001",
      organisationId: testOrgId,
      resourceId: "policies-g6",
      purpose: "Review policies",
      requiredPermissions: ["read"],
    };
    const result = await resolveResourceRequest(request);
    expect(result.status).toBe("granted");
    const descriptorKeys = Object.keys(result.descriptor!);
    expect(descriptorKeys).not.toContain("physicalLocation");
    expect(JSON.stringify(result.descriptor)).not.toContain("sharepoint.com");
  });

  it("test 47: resolveResourceRequest — highly_confidential resource sets approvalRequired: true", async () => {
    const request: ServiceResourceRequest = {
      requestId: "req-g6-005",
      requestingEmployee: "chief_of_staff",
      requestingUser: "user-001",
      organisationId: testOrgId,
      resourceId: "confidential-g6",
      purpose: "Access confidential records",
      requiredPermissions: ["read"],
    };
    const result = await resolveResourceRequest(request);
    expect(result.approvalRequired).toBe(true);
    expect(result.status).toBe("pending_approval");
  });

  it("test 48: resolveResourceRequest — resolvedAt is a valid ISO timestamp", async () => {
    const request: ServiceResourceRequest = {
      requestId: "req-g6-006",
      requestingEmployee: "chief_of_staff",
      requestingUser: "user-001",
      organisationId: testOrgId,
      resourceId: "policies-g6",
      purpose: "Review policies",
      requiredPermissions: ["read"],
    };
    const result = await resolveResourceRequest(request);
    expect(result.resolvedAt).toBeDefined();
    const parsed = new Date(result.resolvedAt);
    expect(parsed.toString()).not.toBe("Invalid Date");
    expect(result.resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 7: resource.locate capability
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 7: resource.locate capability", () => {
  const resourceLocateCapability = BUSINESS_CAPABILITIES.find(
    (c) => c.code === "resource.locate"
  );

  it("test 49: resource.locate capability exists in BUSINESS_CAPABILITIES", () => {
    expect(resourceLocateCapability).toBeDefined();
    expect(resourceLocateCapability?.code).toBe("resource.locate");
  });

  it("test 50: resource.locate has category 'resource'", () => {
    expect(resourceLocateCapability?.category).toBe("resource");
  });

  it("test 51: resource.locate has packCode null (core capability)", () => {
    expect(resourceLocateCapability?.packCode).toBeNull();
  });

  it("test 52: resource.locate eligibleRoles includes chief_of_staff and executive_assistant", () => {
    expect(resourceLocateCapability?.eligibleRoles).toContain("chief_of_staff");
    expect(resourceLocateCapability?.eligibleRoles).toContain("executive_assistant");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 8: CoS and EA resourceRequirements
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 8: CoS and EA resourceRequirements", () => {
  it("test 53: COS_RESOURCE_REQUIREMENTS.requiredResources has at least 5 entries", () => {
    expect(COS_RESOURCE_REQUIREMENTS.requiredResources.length).toBeGreaterThanOrEqual(5);
  });

  it("test 54: COS_RESOURCE_REQUIREMENTS.browserAutomationPermitted is false", () => {
    expect(COS_RESOURCE_REQUIREMENTS.browserAutomationPermitted).toBe(false);
  });

  it("test 55: EA_RESOURCE_REQUIREMENTS.requiredResources has at least 7 entries", () => {
    expect(EA_RESOURCE_REQUIREMENTS.requiredResources.length).toBeGreaterThanOrEqual(7);
  });

  it("test 56: EA_RESOURCE_REQUIREMENTS.permittedResourceTypes includes 'calendar' and 'email'", () => {
    expect(EA_RESOURCE_REQUIREMENTS.permittedResourceTypes).toContain("calendar");
    expect(EA_RESOURCE_REQUIREMENTS.permittedResourceTypes).toContain("email");
  });

  it("test 57: CHIEF_OF_STAFF_EMPLOYEE_FILE.resourceRequirements equals COS_RESOURCE_REQUIREMENTS", () => {
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE.resourceRequirements).toBeDefined();
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE.resourceRequirements).toEqual(COS_RESOURCE_REQUIREMENTS);
  });

  it("test 58: EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.resourceRequirements equals EA_RESOURCE_REQUIREMENTS", () => {
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.resourceRequirements).toBeDefined();
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.resourceRequirements).toEqual(EA_RESOURCE_REQUIREMENTS);
  });

  it("test 59: EA resource requirements resourceDiscoveryRule mentions 'Resource Manager' (not physical locations)", () => {
    const rule = EA_RESOURCE_REQUIREMENTS.resourceDiscoveryRule ?? "";
    expect(rule).toContain("Resource Manager");
    // Should NOT mention physical locations
    expect(rule.toLowerCase()).not.toContain("sharepoint");
    expect(rule.toLowerCase()).not.toContain("https://");
  });

  it("test 60: COS resource requirements sourceOfTruthBehaviour mentions 'source of truth'", () => {
    const behaviour = COS_RESOURCE_REQUIREMENTS.sourceOfTruthBehaviour ?? "";
    expect(behaviour.toLowerCase()).toContain("source of truth");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 9: Platform standard rule constants
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 9: Platform standard rule constants", () => {
  it("test 61: SOURCE_OF_TRUTH_RULE mentions 'source of truth' and 'NeedsOps'", () => {
    expect(SOURCE_OF_TRUTH_RULE.toLowerCase()).toContain("source of truth");
    expect(SOURCE_OF_TRUTH_RULE).toContain("NeedsOps");
  });

  it("test 62: PLATFORM_RESOURCE_RULE mentions 'Organisation Resource Registry' and 'Resource Manager'", () => {
    expect(PLATFORM_RESOURCE_RULE).toContain("Organisation Resource Registry");
    expect(PLATFORM_RESOURCE_RULE).toContain("Resource Manager");
  });

  it("test 63: PLATFORM_RESOURCE_RULE mentions 'Connectors'", () => {
    expect(PLATFORM_RESOURCE_RULE).toContain("Connectors");
  });

  it("test 64: PROHIBITED_EMPLOYEE_FILE_REFERENCES has at least 10 entries", () => {
    expect(PROHIBITED_EMPLOYEE_FILE_REFERENCES.length).toBeGreaterThanOrEqual(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 10: Runtime Manifest abstraction
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 10: Runtime Manifest abstraction", () => {
  it("test 65: buildSystemInstructionForEmployee('chief_of_staff') includes 'resource' (via authority mayNot constraint)", () => {
    const instruction = buildSystemInstructionForEmployee("chief_of_staff");
    // CoS authority.mayNot includes "our resources" — confirms resource abstraction enforced
    const lower = instruction.toLowerCase();
    expect(lower.includes("resource")).toBe(true);
  });

  it("test 66: buildSystemInstructionForEmployee('chief_of_staff') does not include 'sharepoint' (case-insensitive)", () => {
    const instruction = buildSystemInstructionForEmployee("chief_of_staff");
    expect(instruction.toLowerCase()).not.toContain("sharepoint");
  });

  it("test 67: buildSystemInstructionForEmployee('chief_of_staff') does not include 'openclaw' (case-insensitive)", () => {
    const instruction = buildSystemInstructionForEmployee("chief_of_staff");
    expect(instruction.toLowerCase()).not.toContain("openclaw");
  });

  it("test 68: buildSystemInstructionForEmployee('chief_of_staff') does not include physicalLocation or physical_location", () => {
    const instruction = buildSystemInstructionForEmployee("chief_of_staff");
    expect(instruction).not.toContain("physicalLocation");
    expect(instruction).not.toContain("physical_location");
  });

  it("test 69: buildSystemInstructionForEmployee('executive_assistant') includes 'calendar' (EA core domain)", () => {
    // EA authority.may includes "coordinate calendars", "use approved calendar, email, contact and document connectors"
    const instruction = buildSystemInstructionForEmployee("executive_assistant");
    const lower = instruction.toLowerCase();
    expect(lower.includes("calendar")).toBe(true);
  });

  it("test 70: buildSystemInstructionForEmployee('executive_assistant') does not include 'sharepoint'", () => {
    const instruction = buildSystemInstructionForEmployee("executive_assistant");
    expect(instruction.toLowerCase()).not.toContain("sharepoint");
  });
});
