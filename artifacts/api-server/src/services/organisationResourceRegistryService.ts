/**
 * Organisation Resource Registry Service — Platform Completion Sprint
 *
 * Persistent storage via org_resources table. Replaces Sprint XX in-memory Map.
 *
 * Runtime service wrapper for the Organisation Resource Registry.
 * All resource entries are persisted in the platform DB via the org_resources
 * table — no in-memory state is maintained between requests.
 *
 * Source of Truth Rule:
 * Customer systems remain the source of truth. NeedsOps stores organisational
 * understanding, not duplicate document repositories.
 *
 * Employees access resources through this registry. Physical storage locations,
 * connector implementations, and vendor-specific details are never exposed to
 * AI Employees — only abstract resource descriptors are returned.
 *
 * ResourceDescriptor is the canonical type from @workspace/organisation-resource.
 * There is ONE definition across the platform — do not redeclare it locally.
 */

import { randomUUID } from "crypto";
import { db, orgResourcesTable, withSystemTenantContext } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { ResourceDescriptor } from "@workspace/organisation-resource";

// ─── Resource Entry (internal) ────────────────────────────────────────────────

/**
 * Full resource entry stored in the registry.
 * Contains physical location and credentials — NEVER sent to AI Employees.
 *
 * Maps to OrganisationResource from @workspace/organisation-resource.
 * Kept as a local type to avoid breaking the service layer before the
 * package is fully wired into the api-server dependency graph.
 * TODO: Replace with `import type { OrganisationResource } from '@workspace/organisation-resource'`
 */
export interface ResourceEntry {
  resourceId: string;
  displayName: string;
  resourceType: string;
  connectorType: string;
  /** Human-readable source of truth label, e.g. "SharePoint Online" */
  sourceOfTruth: string;
  /** Internal only — never sent to employees */
  physicalLocation: string;
  owner: string;
  permittedEmployees: string[];
  readPermissions: string[];
  writePermissions: string[];
  sensitivityClassification: string;
  indexingStatus: string;
  lastVerified: string;
  auditEnabled: boolean;
}

type DbClient = typeof db;

function withResourceRegistryTenant<T>(
  organisationId: string,
  purpose: string,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  return withSystemTenantContext(
    { tenantId: organisationId, serviceIdentity: "organisation_resource_registry_service", purpose },
    fn,
  );
}

// ResourceDescriptor is imported from @workspace/organisation-resource above.
// It is the canonical, platform-wide definition. Do not redeclare it here.

// ─── Row mapper ───────────────────────────────────────────────────────────────

function mapRow(r: typeof orgResourcesTable.$inferSelect): ResourceEntry {
  return {
    resourceId: r.resourceId,
    displayName: r.displayName,
    resourceType: r.resourceType,
    connectorType: r.connectorType,
    sourceOfTruth: r.sourceOfTruth,
    physicalLocation: r.physicalLocation,
    owner: r.owner,
    permittedEmployees: (r.permittedEmployees as string[]) ?? [],
    readPermissions: (r.readPermissions as string[]) ?? [],
    writePermissions: (r.writePermissions as string[]) ?? [],
    sensitivityClassification: r.sensitivityClassification,
    indexingStatus: r.indexingStatus,
    lastVerified: r.lastVerified,
    auditEnabled: r.auditEnabled,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Register a resource in the organisation's registry.
 * Upserts on (organization_id, resource_id) — replaces any existing entry.
 */
export async function registerResource(
  organisationId: string,
  resource: ResourceEntry,
): Promise<void> {
  await withResourceRegistryTenant(organisationId, "org_resource.register", async (client) => {
  // Check if record exists
  const [existing] = await client
    .select({ id: orgResourcesTable.id })
    .from(orgResourcesTable)
    .where(
      and(
        eq(orgResourcesTable.organizationId, organisationId),
        eq(orgResourcesTable.resourceId, resource.resourceId),
      ),
    )
    .limit(1);

  if (existing) {
    await client
      .update(orgResourcesTable)
      .set({
        displayName: resource.displayName,
        resourceType: resource.resourceType,
        connectorType: resource.connectorType,
        sourceOfTruth: resource.sourceOfTruth,
        physicalLocation: resource.physicalLocation,
        owner: resource.owner,
        permittedEmployees: resource.permittedEmployees,
        readPermissions: resource.readPermissions,
        writePermissions: resource.writePermissions,
        sensitivityClassification: resource.sensitivityClassification,
        indexingStatus: resource.indexingStatus,
        lastVerified: resource.lastVerified,
        auditEnabled: resource.auditEnabled,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(orgResourcesTable.organizationId, organisationId),
          eq(orgResourcesTable.resourceId, resource.resourceId),
        ),
      );
  } else {
    await client.insert(orgResourcesTable).values({
      id: randomUUID(),
      organizationId: organisationId,
      resourceId: resource.resourceId,
      displayName: resource.displayName,
      resourceType: resource.resourceType,
      connectorType: resource.connectorType,
      sourceOfTruth: resource.sourceOfTruth,
      physicalLocation: resource.physicalLocation,
      owner: resource.owner,
      permittedEmployees: resource.permittedEmployees,
      readPermissions: resource.readPermissions,
      writePermissions: resource.writePermissions,
      sensitivityClassification: resource.sensitivityClassification,
      indexingStatus: resource.indexingStatus,
      lastVerified: resource.lastVerified,
      auditEnabled: resource.auditEnabled,
      isActive: true,
    });
  }
  });
}

/**
 * Retrieve a resource entry by ID.
 * Returns null if not found or inactive.
 */
export async function getResource(
  organisationId: string,
  resourceId: string,
): Promise<ResourceEntry | null> {
  return withResourceRegistryTenant(organisationId, "org_resource.get", async (client) => {
  const [row] = await client
    .select()
    .from(orgResourcesTable)
    .where(
      and(
        eq(orgResourcesTable.organizationId, organisationId),
        eq(orgResourcesTable.resourceId, resourceId),
        eq(orgResourcesTable.isActive, true),
      ),
    )
    .limit(1);
  return row ? mapRow(row) : null;
  });
}

/**
 * Get all resources an employee role is permitted to access.
 * Filtered by permittedEmployees or by read/write permission arrays.
 */
export async function getResourcesForEmployee(
  organisationId: string,
  employeeRoleCode: string,
): Promise<ResourceEntry[]> {
  return withResourceRegistryTenant(organisationId, "org_resource.list_for_employee", async (client) => {
  const rows = await client
    .select()
    .from(orgResourcesTable)
    .where(
      and(
        eq(orgResourcesTable.organizationId, organisationId),
        eq(orgResourcesTable.isActive, true),
      ),
    );

  // Filter in JS by JSONB arrays — the arrays are already parsed by Drizzle
  return rows
    .map(mapRow)
    .filter(
      (r) =>
        r.permittedEmployees.includes(employeeRoleCode) ||
        r.readPermissions.includes(employeeRoleCode) ||
        r.writePermissions.includes(employeeRoleCode),
    );
  });
}

/**
 * Build a ResourceDescriptor for an employee.
 *
 * CRITICAL: physicalLocation is NEVER included in the descriptor.
 * Only abstract identifiers and permission summaries are returned.
 *
 * Casts resourceType, connectorType, classification, and permission arrays
 * to their canonical string-literal-union types from @workspace/organisation-resource.
 * Values are stored as valid string literals in the DB so casts are safe.
 */
export function buildDescriptor(
  resource: ResourceEntry,
  employeeRoleCode: string,
): ResourceDescriptor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type P = ResourceDescriptor["availableOperations"][number];

  const availableOperations: P[] = [];
  if (
    resource.readPermissions.includes(employeeRoleCode) ||
    resource.permittedEmployees.includes(employeeRoleCode)
  ) {
    availableOperations.push("read", "search");
  }
  if (resource.writePermissions.includes(employeeRoleCode)) {
    availableOperations.push("write");
  }

  const employeePermissions: P[] = [];
  if (resource.readPermissions.includes(employeeRoleCode)) employeePermissions.push("read");
  if (resource.writePermissions.includes(employeeRoleCode)) employeePermissions.push("write");

  return {
    resourceId: resource.resourceId,
    displayName: resource.displayName,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resourceType: resource.resourceType as ResourceDescriptor["resourceType"],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connectorType: resource.connectorType as ResourceDescriptor["connectorType"],
    sourceOfTruth: resource.sourceOfTruth,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    classification: resource.sensitivityClassification as ResourceDescriptor["classification"],
    availableOperations,
    employeePermissions,
    // physicalLocation is intentionally omitted — NEVER sent to employees
  };
}

/**
 * Check whether an employee role has a specific permission on a resource.
 */
export function hasPermission(
  resource: ResourceEntry,
  employeeRoleCode: string,
  permission: "read" | "write" | "search",
): boolean {
  switch (permission) {
    case "read":
      return (
        resource.readPermissions.includes(employeeRoleCode) ||
        resource.permittedEmployees.includes(employeeRoleCode)
      );
    case "write":
      return resource.writePermissions.includes(employeeRoleCode);
    case "search":
      // Search is permitted when read is permitted
      return (
        resource.readPermissions.includes(employeeRoleCode) ||
        resource.permittedEmployees.includes(employeeRoleCode)
      );
    default:
      return false;
  }
}

/**
 * List all resources registered for an organisation.
 * Returns the full ResourceEntry array (internal use only).
 */
export async function listResources(organisationId: string): Promise<ResourceEntry[]> {
  return withResourceRegistryTenant(organisationId, "org_resource.list", async (client) => {
  const rows = await client
    .select()
    .from(orgResourcesTable)
    .where(
      and(
        eq(orgResourcesTable.organizationId, organisationId),
        eq(orgResourcesTable.isActive, true),
      ),
    );
  return rows.map(mapRow);
  });
}
