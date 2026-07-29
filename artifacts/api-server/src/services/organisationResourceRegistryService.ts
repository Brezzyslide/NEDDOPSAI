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
 * NOTE: ResourceDescriptor is also defined in @workspace/organisation-resource.
 * TODO: Consolidate with the canonical type once import resolution is stable
 *       across the full monorepo build graph.
 */

import { randomUUID } from "crypto";
import { db, orgResourcesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

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

// ─── Resource Descriptor (employee-facing) ────────────────────────────────────

/**
 * Abstract resource descriptor returned to AI Employees.
 *
 * NOTE: Never includes physicalLocation, URLs, credentials, or implementation
 * details. Employees receive only what they need to request access — not how
 * to reach the underlying system directly.
 *
 * NOTE: ResourceDescriptor is also defined in resourceManagerService.ts.
 * TODO: Consolidate both into a single import from @workspace/organisation-resource
 *       once that package is fully wired into the api-server dependency graph.
 */
export interface ResourceDescriptor {
  resourceId: string;
  displayName: string;
  resourceType: string;
  connectorType: string;
  sourceOfTruth: string;
  classification: string;
  availableOperations: string[];
  employeePermissions: string[];
}

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
  // Check if record exists
  const [existing] = await db
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
    await db
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
    await db.insert(orgResourcesTable).values({
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
}

/**
 * Retrieve a resource entry by ID.
 * Returns null if not found or inactive.
 */
export async function getResource(
  organisationId: string,
  resourceId: string,
): Promise<ResourceEntry | null> {
  const [row] = await db
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
}

/**
 * Get all resources an employee role is permitted to access.
 * Filtered by permittedEmployees or by read/write permission arrays.
 */
export async function getResourcesForEmployee(
  organisationId: string,
  employeeRoleCode: string,
): Promise<ResourceEntry[]> {
  const rows = await db
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
}

/**
 * Build a ResourceDescriptor for an employee.
 *
 * CRITICAL: physicalLocation is NEVER included in the descriptor.
 * Only abstract identifiers and permission summaries are returned.
 */
export function buildDescriptor(
  resource: ResourceEntry,
  employeeRoleCode: string,
): ResourceDescriptor {
  const availableOperations: string[] = [];
  if (
    resource.readPermissions.includes(employeeRoleCode) ||
    resource.permittedEmployees.includes(employeeRoleCode)
  ) {
    availableOperations.push("read", "search");
  }
  if (resource.writePermissions.includes(employeeRoleCode)) {
    availableOperations.push("write");
  }

  const employeePermissions: string[] = [];
  if (resource.readPermissions.includes(employeeRoleCode)) employeePermissions.push("read");
  if (resource.writePermissions.includes(employeeRoleCode)) employeePermissions.push("write");
  if (resource.permittedEmployees.includes(employeeRoleCode)) employeePermissions.push("access");

  return {
    resourceId: resource.resourceId,
    displayName: resource.displayName,
    resourceType: resource.resourceType,
    connectorType: resource.connectorType,
    sourceOfTruth: resource.sourceOfTruth,
    classification: resource.sensitivityClassification,
    availableOperations,
    employeePermissions,
    // physicalLocation is intentionally omitted
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
  const rows = await db
    .select()
    .from(orgResourcesTable)
    .where(
      and(
        eq(orgResourcesTable.organizationId, organisationId),
        eq(orgResourcesTable.isActive, true),
      ),
    );
  return rows.map(mapRow);
}
