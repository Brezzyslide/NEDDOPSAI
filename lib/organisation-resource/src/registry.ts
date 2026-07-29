import type {
  OrganisationResource,
  ResourceType,
  ResourcePermission,
  ResourceValidationResult,
} from "./types.js";

// ─── IOrganisationResourceRegistry ────────────────────────────────────────────

export interface IOrganisationResourceRegistry {
  register(resource: OrganisationResource): void;
  getById(resourceId: string): OrganisationResource | null;
  getByType(resourceType: ResourceType, organisationId?: string): OrganisationResource[];
  getPermittedForEmployee(employeeRoleCode: string): OrganisationResource[];
  hasPermission(resourceId: string, employeeRoleCode: string, permission: ResourcePermission): boolean;
  validate(resource: Partial<OrganisationResource>): ResourceValidationResult;
  list(): OrganisationResource[];
  count(): number;
}

// ─── OrganisationResourceRegistryImpl ─────────────────────────────────────────

export class OrganisationResourceRegistryImpl implements IOrganisationResourceRegistry {
  private readonly store: Map<string, OrganisationResource> = new Map();

  register(resource: OrganisationResource): void {
    const validation = this.validate(resource);
    if (!validation.valid) {
      throw new Error(
        `Cannot register resource "${resource.resourceId}": ${validation.errors.join("; ")}`
      );
    }
    this.store.set(resource.resourceId, resource);
  }

  getById(resourceId: string): OrganisationResource | null {
    return this.store.get(resourceId) ?? null;
  }

  getByType(resourceType: ResourceType, _organisationId?: string): OrganisationResource[] {
    const results: OrganisationResource[] = [];
    for (const resource of this.store.values()) {
      if (resource.resourceType === resourceType) {
        results.push(resource);
      }
    }
    return results;
  }

  getPermittedForEmployee(employeeRoleCode: string): OrganisationResource[] {
    const results: OrganisationResource[] = [];
    for (const resource of this.store.values()) {
      if (resource.permittedEmployees.includes(employeeRoleCode)) {
        results.push(resource);
      }
    }
    return results;
  }

  hasPermission(
    resourceId: string,
    employeeRoleCode: string,
    permission: ResourcePermission
  ): boolean {
    const resource = this.store.get(resourceId);
    if (!resource) return false;

    if (!resource.permittedEmployees.includes(employeeRoleCode)) return false;

    switch (permission) {
      case "read":
      case "search":
      case "metadata":
      case "watch":
        return resource.readPermissions.includes(employeeRoleCode);
      case "write":
      case "create":
      case "delete":
        return resource.writePermissions.includes(employeeRoleCode);
      default:
        return false;
    }
  }

  validate(resource: Partial<OrganisationResource>): ResourceValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const required: (keyof OrganisationResource)[] = [
      "resourceId",
      "displayName",
      "resourceType",
      "connectorType",
      "sourceOfTruth",
      "physicalLocation",
      "owner",
      "sensitivityClassification",
      "indexingStatus",
      "lastVerified",
    ];

    for (const field of required) {
      const value = resource[field];
      if (value === undefined || value === null) {
        errors.push(`Missing required field: "${field}"`);
      } else if (typeof value === "string" && value.trim() === "") {
        errors.push(`Required field "${field}" must not be empty`);
      }
    }

    if (resource.permittedEmployees !== undefined && !Array.isArray(resource.permittedEmployees)) {
      errors.push(`Field "permittedEmployees" must be an array`);
    }
    if (resource.readPermissions !== undefined && !Array.isArray(resource.readPermissions)) {
      errors.push(`Field "readPermissions" must be an array`);
    }
    if (resource.writePermissions !== undefined && !Array.isArray(resource.writePermissions)) {
      errors.push(`Field "writePermissions" must be an array`);
    }

    if (
      resource.permittedEmployees?.length === 0 &&
      resource.readPermissions?.length === 0 &&
      resource.writePermissions?.length === 0
    ) {
      warnings.push(`Resource "${resource.resourceId}" has no permitted employees or permissions assigned`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  list(): OrganisationResource[] {
    return Array.from(this.store.values());
  }

  count(): number {
    return this.store.size;
  }
}
