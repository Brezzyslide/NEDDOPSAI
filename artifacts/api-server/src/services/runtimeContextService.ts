/**
 * Runtime Context Service — Sprint XX
 *
 * Assembles the complete organisational context for an AI Employee execution.
 * Employees receive ONE context object. They do not query individual services.
 *
 * The Runtime Context is the single source of organisational knowledge during execution.
 */

import { eq, and, sql, inArray } from "drizzle-orm";
import {
  db,
  organizationsTable,
  organisationMemoryTable,
  executionIntentsTable,
  membershipsTable,
} from "@workspace/db";
import {
  listResources,
  buildDescriptor,
} from "./organisationResourceRegistryService.js";
import {
  getConfiguration,
  getDefaultConfiguration,
  type OrgConfigurationData,
} from "./organisationConfigurationService.js";
import {
  getOrgStructureSummary,
  getEscalationPaths,
} from "./organisationStructureService.js";
import { getCurrentSpecialists } from "../lib/workforceRegistry.js";
import {
  tenantHasWorkforcePack,
  tenantCanUseFeature,
} from "./entitlementService.js";
import { logOrgEvent } from "./auditService.js";
import type { WorkforcePackCode } from "@workspace/shared";

// ─── Context Types ────────────────────────────────────────────────────────────

export interface OrgIdentityContext {
  organisationId: string;
  name: string;
  displayName: string;
  type: string;
  industry: string;
  country: string;
  state: string;
  timezone: string;
  ndisRegistrationNumber?: string;
  subscriptionTier: string;
  status: string;
}

export interface ResourceContext {
  resourceId: string;
  displayName: string;
  resourceType: string;
  connectorType: string;
  availableOperations: string[];
}

export interface ConnectorContext {
  connectorType: string;
  available: boolean;
  operationMode: 'live' | 'mock' | 'unavailable';
}

export interface OrganisationRuntimeContext {
  // Assembled for a specific employee execution
  organisationId: string;
  employeeRoleCode: string;
  assembledAt: string;

  // Organisation identity
  identity: OrgIdentityContext;

  // Organisation configuration (structured)
  configuration: OrgConfigurationData | null;

  // Organisation memory (recent relevant entries)
  memoryEntries: Array<{ type: string; title: string; content: string; approvedAt?: string }>;

  // Organisation structure summary
  structure: {
    departmentCount: number;
    teamCount: number;
    positionCount: number;
    reportingLineCount: number;
    activeDelegationCount: number;
    escalationPaths: Array<{ name: string; triggerType: string }>;
  };

  // Available resources (sanitised — no physical locations)
  availableResources: ResourceContext[];

  // Permissions for this employee
  permissions: {
    capabilityCodes: string[];
    resourcePermissions: Record<string, string[]>;
    canBrowse: boolean;
    canExecuteConnectors: boolean;
    /** Maximum sensitivity level of knowledge sources this specialist may access */
    sensitivityClearance: 'public' | 'internal' | 'confidential' | 'restricted';
    /** Whether the specialist's workforce pack is granted for this org */
    packGranted: boolean;
  };

  // Available connectors
  connectors: ConnectorContext[];

  // Enabled workforce (other AI Employees available to this org)
  enabledWorkforce: Array<{ roleCode: string; displayName: string; packCode: string | null }>;

  // Runtime state
  runtimeState: {
    executionFrozen: boolean;
    activeGraphCount: number;
    pendingIntentCount: number;
  };

  // Operational preferences
  operationalPreferences: {
    businessHoursStart: string;
    businessHoursEnd: string;
    timezone: string;
    notificationPreference: string;
  };
}

// OrgConfigurationData is imported from organisationConfigurationService.js above.
// Re-export it so callers that import from this module continue to work.
export type { OrgConfigurationData };

// ─── Assembly ─────────────────────────────────────────────────────────────────

/**
 * Assembles the complete OrganisationRuntimeContext for an AI Employee.
 * This is the single entry point — employees do not call individual services.
 */
export async function assembleRuntimeContext(
  organisationId: string,
  employeeRoleCode: string,
  options?: {
    includeMemory?: boolean;
    maxMemoryEntries?: number;
    /**
     * When provided, an active-membership cross-tenant check is performed.
     * Throws CROSS_TENANT_ACCESS if the user is not an active member of this org.
     */
    requestingUserId?: string;
  },
): Promise<OrganisationRuntimeContext> {
  const assembledAt = new Date().toISOString();
  const includeMemory = options?.includeMemory ?? true;
  const maxMemoryEntries = options?.maxMemoryEntries ?? 20;

  // ── 0. Cross-tenant guard ──────────────────────────────────────────────────
  // If a requesting user ID is provided, verify they are an active member of
  // this org before assembling any context. This prevents cross-tenant leakage
  // when the caller forwards an unverified org ID.
  if (options?.requestingUserId) {
    const [membership] = await db
      .select({ id: membershipsTable.id })
      .from(membershipsTable)
      .where(
        and(
          eq(membershipsTable.organizationId, organisationId),
          eq(membershipsTable.userId, options.requestingUserId),
          eq(membershipsTable.status, 'active'),
        ),
      )
      .limit(1);

    if (!membership) {
      const err = new Error(
        `User ${options.requestingUserId} does not have active membership in organisation ${organisationId}.`,
      );
      (err as NodeJS.ErrnoException).code = 'CROSS_TENANT_ACCESS';
      throw err;
    }
  }

  // ── 1. Organisation Identity ───────────────────────────────────────────────
  const [org] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.id, organisationId))
    .limit(1);

  if (!org) {
    throw new Error(`Organisation not found: ${organisationId}`);
  }

  const identity: OrgIdentityContext = {
    organisationId: org.id,
    name: org.name,
    displayName: org.displayName ?? org.name,
    type: org.type ?? 'unknown',
    industry: org.industry ?? 'unknown',
    country: org.country ?? 'AU',
    state: org.state ?? '',
    timezone: org.timezone ?? 'Australia/Sydney',
    ndisRegistrationNumber: org.ndisRegistrationNumber ?? undefined,
    subscriptionTier: org.subscriptionTier,
    status: org.status,
  };

  // ── 2. Organisation Configuration ─────────────────────────────────────────
  let configuration: OrgConfigurationData | null = null;
  try {
    configuration = await getConfiguration(organisationId) ?? getDefaultConfiguration();
  } catch {
    // Configuration unavailable — fall back to NDIS defaults
    try {
      configuration = getDefaultConfiguration();
    } catch {
      configuration = null;
    }
  }

  // ── 3. Organisation Memory ─────────────────────────────────────────────────
  let memoryEntries: Array<{ type: string; title: string; content: string; approvedAt?: string }> = [];

  if (includeMemory) {
    try {
      const memoryRows = await db
        .select()
        .from(organisationMemoryTable)
        .where(
          and(
            eq(organisationMemoryTable.organizationId, organisationId),
            eq(organisationMemoryTable.status, 'approved'),
          ),
        )
        .limit(maxMemoryEntries);

      memoryEntries = memoryRows.map((m) => ({
        type: m.memoryType,
        title: m.title,
        content: m.content,
        approvedAt: m.approvedAt?.toISOString(),
      }));
    } catch {
      // Memory table access failed — return empty
      memoryEntries = [];
    }
  }

  // ── 4. Organisation Structure ──────────────────────────────────────────────
  const structure = {
    departmentCount: 0,
    teamCount: 0,
    positionCount: 0,
    reportingLineCount: 0,
    activeDelegationCount: 0,
    escalationPaths: [] as Array<{ name: string; triggerType: string }>,
  };

  try {
    const [summary, escalationPathList] = await Promise.all([
      getOrgStructureSummary(organisationId),
      getEscalationPaths(organisationId),
    ]);
    structure.departmentCount = summary.departmentCount;
    structure.teamCount = summary.teamCount;
    structure.positionCount = summary.positionCount;
    structure.reportingLineCount = summary.reportingLineCount;
    structure.activeDelegationCount = summary.activeDelegationCount;
    structure.escalationPaths = escalationPathList.map((ep) => ({
      name: ep.name,
      triggerType: ep.triggerType,
    }));
  } catch {
    // Structure queries failed — leave zero defaults
  }

  // ── 5. Available Resources ─────────────────────────────────────────────────
  const allResources = await listResources(organisationId);
  const availableResources: ResourceContext[] = allResources
    .filter(
      (r) =>
        r.permittedEmployees.includes(employeeRoleCode) ||
        r.readPermissions.includes(employeeRoleCode),
    )
    .map((r) => {
      const descriptor = buildDescriptor(r, employeeRoleCode);
      return {
        resourceId: descriptor.resourceId,
        displayName: descriptor.displayName,
        resourceType: descriptor.resourceType,
        connectorType: descriptor.connectorType,
        availableOperations: descriptor.availableOperations,
      };
    });

  // ── 6. Permissions (deny-by-default) ─────────────────────────────────────
  //
  // Resolution order:
  //  a) Find this specialist's pack from the workforce registry
  //  b) Check if the org's subscription grants the specialist's pack
  //  c) Check execution channel entitlements (browse, connectors)
  //  d) Derive capability codes and sensitivity clearance
  //  e) Build resource permission map from already-filtered available resources
  //  f) Audit the permission decision (fire-and-forget)

  // 6a. Locate specialist definition to find its pack
  const specialistDef = getCurrentSpecialists().find(s => s.code === employeeRoleCode);
  const specialistPackCode = specialistDef?.packCode as WorkforcePackCode | undefined;

  // 6b. Pack entitlement — denied if specialist is not in registry or pack not granted
  const packEntitlement = specialistPackCode
    ? await tenantHasWorkforcePack(organisationId, specialistPackCode)
    : {
        allowed: false as const,
        reason: 'Specialist not found in workforce registry — pack cannot be determined.',
        source: undefined,
        effectiveUntil: undefined,
      };

  // 6c. Execution channel entitlements (parallel — do not wait on each other)
  const [browseEntitlement, connectorEntitlement] = await Promise.all([
    tenantCanUseFeature(organisationId, 'execution.browser_session'),
    tenantCanUseFeature(organisationId, 'execution.api_connectors'),
  ]);

  // 6d. Capability codes — only granted capabilities are included
  const capabilityCodes: string[] = [];
  if (packEntitlement.allowed && specialistPackCode) {
    capabilityCodes.push(`workforce_pack.${specialistPackCode}`);
  }
  if (browseEntitlement.allowed) capabilityCodes.push('execution.browser_session');
  if (connectorEntitlement.allowed) capabilityCodes.push('execution.api_connectors');

  // Sensitivity clearance — derived from pack type (deny-by-default: public only)
  // compliance/hr/finance handle sensitive operational data → confidential clearance
  // core/operations/marketing → internal clearance
  // no pack granted → public sources only
  const PACK_SENSITIVITY: Record<string, 'internal' | 'confidential'> = {
    compliance: 'confidential',
    hr:         'confidential',
    finance:    'confidential',
    core:       'internal',
    operations: 'internal',
    marketing:  'internal',
  };
  const sensitivityClearance = (
    packEntitlement.allowed && specialistPackCode
      ? PACK_SENSITIVITY[specialistPackCode] ?? 'internal'
      : 'public'
  ) as 'public' | 'internal' | 'confidential' | 'restricted';

  // 6e. Resource permissions — map each accessible resource to its granted operations
  const resourcePermissions: Record<string, string[]> = {};
  for (const r of availableResources) {
    resourcePermissions[r.resourceId] = r.availableOperations;
  }

  const permissions = {
    capabilityCodes,
    resourcePermissions,
    canBrowse:             browseEntitlement.allowed,
    canExecuteConnectors:  connectorEntitlement.allowed,
    sensitivityClearance,
    packGranted:           packEntitlement.allowed,
  };

  // 6f. Audit the permission decision — fire-and-forget, never block execution
  void logOrgEvent({
    eventType:    packEntitlement.allowed ? 'specialist.run_queued' : 'specialist.run_blocked',
    organizationId: organisationId,
    actorType:    'system',
    resourceType: 'runtime_context',
    metadata: {
      specialistCode:      employeeRoleCode,
      packCode:            specialistPackCode ?? null,
      packGranted:         packEntitlement.allowed,
      packDeniedReason:    packEntitlement.allowed ? null : packEntitlement.reason,
      canBrowse:           browseEntitlement.allowed,
      canExecuteConnectors: connectorEntitlement.allowed,
      sensitivityClearance,
    },
  }).catch(() => { /* swallow — audit write failure must not block execution */ });

  // ── 7. Connectors ──────────────────────────────────────────────────────────
  const connectorTypes = new Set(allResources.map((r) => r.connectorType));
  const connectors: ConnectorContext[] = [];

  const fileConnectorTypes = [
    'sharepoint_file_connector', 'onedrive_file_connector',
    'google_drive_connector', 'dropbox_connector',
    'local_file_connector', 'network_drive_connector',
    'file_connector',
  ];
  const apiConnectorTypes = [
    'microsoft_graph_connector', 'google_workspace_connector',
    'xero_connector', 'deputy_connector', 'employment_hero_connector',
    'lumary_connector', 'shiftcare_connector', 'generic_api_connector',
    'api_connector',
  ];

  // File connector availability
  const hasFileConnector = fileConnectorTypes.some((ct) => connectorTypes.has(ct));
  connectors.push({
    connectorType: 'file_connector',
    available: hasFileConnector,
    operationMode: hasFileConnector ? 'mock' : 'unavailable',
  });

  // Browser connector — requires OpenClaw
  connectors.push({
    connectorType: 'browser_connector',
    available: false,
    operationMode: 'unavailable',
  });

  // API connectors
  for (const ct of apiConnectorTypes) {
    if (connectorTypes.has(ct)) {
      connectors.push({
        connectorType: ct,
        available: true,
        operationMode: 'mock',
      });
    }
  }

  // ── 8. Enabled Workforce ───────────────────────────────────────────────────
  let enabledWorkforce: Array<{ roleCode: string; displayName: string; packCode: string | null }> = [];
  try {
    const allSpecialists = getCurrentSpecialists();
    enabledWorkforce = allSpecialists
      .filter((s) => s.executionStatus === 'available' || s.executionStatus === 'beta')
      .map((s) => ({
        roleCode: s.code,
        displayName: s.displayName,
        packCode: s.packCode ?? null,
      }));
  } catch {
    enabledWorkforce = [];
  }

  // ── 9. Runtime State ───────────────────────────────────────────────────────
  // Count active (approved/dispatched) and pending-approval intents from DB.
  // Both queries are scoped to organisationId — cross-tenant safety guaranteed.
  let activeGraphCount = 0;
  let pendingIntentCount = 0;
  try {
    const [activeRow, pendingRow] = await Promise.all([
      db
        .select({ n: sql<number>`cast(count(*) as int)` })
        .from(executionIntentsTable)
        .where(
          and(
            eq(executionIntentsTable.organizationId, organisationId),
            inArray(executionIntentsTable.status, ['approved', 'dispatched']),
          ),
        ),
      db
        .select({ n: sql<number>`cast(count(*) as int)` })
        .from(executionIntentsTable)
        .where(
          and(
            eq(executionIntentsTable.organizationId, organisationId),
            eq(executionIntentsTable.status, 'pending_approval'),
          ),
        ),
    ]);
    activeGraphCount   = activeRow[0]?.n ?? 0;
    pendingIntentCount = pendingRow[0]?.n ?? 0;
  } catch {
    // Count queries failed — leave zero defaults; do not block context assembly
  }

  const runtimeState = {
    executionFrozen: org.executionFrozen ?? false,
    activeGraphCount,
    pendingIntentCount,
  };

  // ── 10. Operational Preferences ───────────────────────────────────────────
  const operationalPreferences = {
    businessHoursStart: configuration?.businessHoursStart ?? '09:00',
    businessHoursEnd: configuration?.businessHoursEnd ?? '17:00',
    timezone: org.timezone ?? 'Australia/Sydney',
    notificationPreference: configuration?.notificationPreference ?? 'email',
  };

  return {
    organisationId,
    employeeRoleCode,
    assembledAt,
    identity,
    configuration,
    memoryEntries,
    structure,
    availableResources,
    permissions,
    connectors,
    enabledWorkforce,
    runtimeState,
    operationalPreferences,
  };
}

// ─── Prompt Block Formatter ───────────────────────────────────────────────────

/**
 * Formats an OrganisationRuntimeContext into structured text blocks for system prompt injection.
 * Does NOT include memory entries (those are assembled separately).
 */
export function runtimeContextToPromptBlocks(context: OrganisationRuntimeContext): string {
  const blocks: string[] = [];

  // ── ORG IDENTITY ──
  blocks.push([
    '=== ORG IDENTITY ===',
    `Name: ${context.identity.name}`,
    `Display Name: ${context.identity.displayName}`,
    `Type: ${context.identity.type}`,
    `Industry: ${context.identity.industry}`,
    `Country: ${context.identity.country}`,
    `State: ${context.identity.state}`,
    `Timezone: ${context.identity.timezone}`,
    ...(context.identity.ndisRegistrationNumber
      ? [`NDIS Registration: ${context.identity.ndisRegistrationNumber}`]
      : []),
    `Subscription Tier: ${context.identity.subscriptionTier}`,
    `Status: ${context.identity.status}`,
  ].join('\n'));

  // ── ORG CONFIGURATION ──
  if (context.configuration) {
    const configLines = ['=== ORG CONFIGURATION ==='];
    for (const [key, value] of Object.entries(context.configuration)) {
      if (value !== null && value !== undefined) {
        configLines.push(`${key}: ${value}`);
      }
    }
    blocks.push(configLines.join('\n'));
  }

  // ── ORG STRUCTURE ──
  blocks.push([
    '=== ORG STRUCTURE ===',
    `Departments: ${context.structure.departmentCount}`,
    `Teams: ${context.structure.teamCount}`,
    `Positions: ${context.structure.positionCount}`,
    `Reporting Lines: ${context.structure.reportingLineCount}`,
    `Active Delegations: ${context.structure.activeDelegationCount}`,
    ...(context.structure.escalationPaths.length > 0
      ? [
          'Escalation Paths:',
          ...context.structure.escalationPaths.map(
            (ep) => `  - ${ep.name} (trigger: ${ep.triggerType})`,
          ),
        ]
      : ['Escalation Paths: (none configured)']),
  ].join('\n'));

  // ── AVAILABLE RESOURCES ──
  if (context.availableResources.length > 0) {
    const resourceLines = ['=== AVAILABLE RESOURCES ==='];
    for (const r of context.availableResources) {
      resourceLines.push(
        `- ${r.displayName} [${r.resourceType}] via ${r.connectorType}`,
        `  Operations: ${r.availableOperations.join(', ')}`,
      );
    }
    blocks.push(resourceLines.join('\n'));
  } else {
    blocks.push('=== AVAILABLE RESOURCES ===\n(no resources registered for this organisation)');
  }

  // ── AVAILABLE CONNECTORS ──
  const availableConnectors = context.connectors.filter((c) => c.available);
  if (availableConnectors.length > 0) {
    const connectorLines = ['=== AVAILABLE CONNECTORS ==='];
    for (const c of availableConnectors) {
      connectorLines.push(`- ${c.connectorType} [mode: ${c.operationMode}]`);
    }
    blocks.push(connectorLines.join('\n'));
  }

  // ── RUNTIME STATE ──
  blocks.push([
    '=== RUNTIME STATE ===',
    `Execution Frozen: ${context.runtimeState.executionFrozen ? 'YES — no new executions permitted' : 'no'}`,
    `Active Graphs: ${context.runtimeState.activeGraphCount}`,
    `Pending Intents: ${context.runtimeState.pendingIntentCount}`,
    `Business Hours: ${context.operationalPreferences.businessHoursStart} – ${context.operationalPreferences.businessHoursEnd} (${context.operationalPreferences.timezone})`,
    `Notification Preference: ${context.operationalPreferences.notificationPreference}`,
  ].join('\n'));

  return blocks.join('\n\n');
}

// ─── Sensitivity Gate Helpers ─────────────────────────────────────────────────

/**
 * Ordered sensitivity levels — higher index = more sensitive.
 * A clearance of level N grants access to all sources at index ≤ N.
 */
const SENSITIVITY_ORDER = ['public', 'internal', 'confidential', 'restricted'] as const;
export type SensitivityLevel = (typeof SENSITIVITY_ORDER)[number];

/**
 * Returns true when a source at `sourceLevel` is within the specialist's
 * `clearanceLevel`. Deny-by-default: unknown levels are denied.
 */
export function isSensitivityPermitted(
  sourceLevel: string,
  clearanceLevel: string,
): boolean {
  const srcIdx      = SENSITIVITY_ORDER.indexOf(sourceLevel as SensitivityLevel);
  const clearanceIdx = SENSITIVITY_ORDER.indexOf(clearanceLevel as SensitivityLevel);
  if (srcIdx === -1 || clearanceIdx === -1) return false;
  return srcIdx <= clearanceIdx;
}

/**
 * Filters an array of items that have a `sensitivityClassification` field,
 * keeping only those the specialist is cleared to access.
 *
 * Usage:
 *   const permittedSources = filterBySensitivity(allSources, context.permissions.sensitivityClearance);
 */
export function filterBySensitivity<T extends { sensitivityClassification: string }>(
  sources: T[],
  clearanceLevel: string,
): T[] {
  return sources.filter(s => isSensitivityPermitted(s.sensitivityClassification, clearanceLevel));
}
