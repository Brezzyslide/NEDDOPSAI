/**
 * Runtime Context Service — Sprint XX
 *
 * Assembles the complete organisational context for an AI Employee execution.
 * Employees receive ONE context object. They do not query individual services.
 *
 * The Runtime Context is the single source of organisational knowledge during execution.
 */

import { eq, and } from "drizzle-orm";
import { db, organizationsTable, organisationMemoryTable } from "@workspace/db";
import {
  listResources,
  buildDescriptor,
} from "./organisationResourceRegistryService.js";
import { getCurrentSpecialists } from "../lib/workforceRegistry.js";

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

// ─── OrgConfigurationData stub ────────────────────────────────────────────────
// Defined here as a minimal stub. When organisationConfigurationService exists,
// this should be replaced with: import type { OrgConfigurationData } from './organisationConfigurationService.js';

export interface OrgConfigurationData {
  businessHoursStart?: string;
  businessHoursEnd?: string;
  notificationPreference?: string;
  [key: string]: unknown;
}

// ─── Assembly ─────────────────────────────────────────────────────────────────

/**
 * Assembles the complete OrganisationRuntimeContext for an AI Employee.
 * This is the single entry point — employees do not call individual services.
 */
export async function assembleRuntimeContext(
  organisationId: string,
  employeeRoleCode: string,
  options?: { includeMemory?: boolean; maxMemoryEntries?: number },
): Promise<OrganisationRuntimeContext> {
  const assembledAt = new Date().toISOString();
  const includeMemory = options?.includeMemory ?? true;
  const maxMemoryEntries = options?.maxMemoryEntries ?? 20;

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

  // ── 2. Configuration (stub — organisationConfigurationService pending) ─────
  let configuration: OrgConfigurationData | null = null;
  try {
    // When organisationConfigurationService is available:
    // const { getConfiguration, getDefaultConfiguration } = await import('./organisationConfigurationService.js');
    // configuration = await getConfiguration(organisationId) ?? await getDefaultConfiguration();
    configuration = {
      businessHoursStart: '09:00',
      businessHoursEnd: '17:00',
      notificationPreference: 'email',
    };
  } catch {
    configuration = null;
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

  // ── 4. Organisation Structure (stub — organisationStructureService pending) ─
  const structure = {
    departmentCount: 0,
    teamCount: 0,
    positionCount: 0,
    escalationPaths: [] as Array<{ name: string; triggerType: string }>,
  };

  try {
    // When organisationStructureService is available:
    // const { getOrgStructureSummary, getEscalationPaths } = await import('./organisationStructureService.js');
    // const summary = await getOrgStructureSummary(organisationId);
    // structure.departmentCount = summary.departmentCount;
    // structure.teamCount = summary.teamCount;
    // structure.positionCount = summary.positionCount;
    // structure.escalationPaths = await getEscalationPaths(organisationId);
  } catch {
    // Service not yet available
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

  // ── 6. Permissions (stub — will be wired in subsequent task) ──────────────
  const permissions = {
    capabilityCodes: [] as string[],
    resourcePermissions: {} as Record<string, string[]>,
    canBrowse: false,
    canExecuteConnectors: false,
  };

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
  const runtimeState = {
    executionFrozen: org.executionFrozen ?? false,
    activeGraphCount: 0,
    pendingIntentCount: 0,
  };

  // ── 10. Operational Preferences ───────────────────────────────────────────
  const operationalPreferences = {
    businessHoursStart: configuration?.businessHoursStart ?? '09:00',
    businessHoursEnd: configuration?.businessHoursEnd ?? '17:00',
    timezone: org.timezone ?? 'Australia/Sydney',
    notificationPreference: (configuration?.notificationPreference as string) ?? 'email',
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


