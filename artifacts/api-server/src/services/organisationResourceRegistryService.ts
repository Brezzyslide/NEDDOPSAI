/**
 * Organisation Resource Registry Service
 *
 * Runtime service wrapper for the Organisation Resource Registry.
 * Maintains a per-organisation resource registry (in-memory).
 *
 * Source of Truth Rule:
 * Customer systems remain the source of truth. NeedsOps stores organisational
 * understanding, not duplicate document repositories.
 *
 * Employees access resources through this registry. Physical storage locations,
 * connector implementations, and vendor-specific details are never exposed to
 * AI Employees — only abstract resource descriptors are returned.
 */

// ─── Resource Entry (internal) ────────────────────────────────────────────────

/**
 * Full resource entry stored in the registry.
 * Contains physical location and credentials — NEVER sent to AI Employees.
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

// ─── In-memory store ──────────────────────────────────────────────────────────

/**
 * Per-organisation resource registry.
 * Map<organisationId, Map<resourceId, ResourceEntry>>
 */
const registryStore = new Map<string, Map<string, ResourceEntry>>();

// ─── Internal helpers ─────────────────────────────────────────────────────────

function getOrgRegistry(organisationId: string): Map<string, ResourceEntry> {
  let org = registryStore.get(organisationId);
  if (!org) {
    org = new Map<string, ResourceEntry>();
    registryStore.set(organisationId, org);
  }
  return org;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Register a resource in the organisation's registry.
 * Replaces any existing entry with the same resourceId.
 */
export function registerResource(
  organisationId: string,
  resource: ResourceEntry,
): void {
  const org = getOrgRegistry(organisationId);
  org.set(resource.resourceId, resource);
}

/**
 * Retrieve a resource entry by ID.
 * Returns null if not found.
 */
export function getResource(
  organisationId: string,
  resourceId: string,
): ResourceEntry | null {
  const org = registryStore.get(organisationId);
  if (!org) return null;
  return org.get(resourceId) ?? null;
}

/**
 * Get all resources an employee role is permitted to access.
 * Filtered by permittedEmployees or by read/write permission arrays.
 */
export function getResourcesForEmployee(
  organisationId: string,
  employeeRoleCode: string,
): ResourceEntry[] {
  const org = registryStore.get(organisationId);
  if (!org) return [];

  const results: ResourceEntry[] = [];
  for (const resource of org.values()) {
    if (
      resource.permittedEmployees.includes(employeeRoleCode) ||
      resource.readPermissions.includes(employeeRoleCode) ||
      resource.writePermissions.includes(employeeRoleCode)
    ) {
      results.push(resource);
    }
  }
  return results;
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
  if (resource.readPermissions.includes(employeeRoleCode) || resource.permittedEmployees.includes(employeeRoleCode)) {
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
export function listResources(organisationId: string): ResourceEntry[] {
  const org = registryStore.get(organisationId);
  if (!org) return [];
  return Array.from(org.values());
}
