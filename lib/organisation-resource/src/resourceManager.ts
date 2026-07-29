import type {
  OrganisationResource,
  ResourceRequest,
  ResourceResponse,
  ResourceDescriptor,
  ResourcePermission,
} from "./types.js";
import type { IOrganisationResourceRegistry } from "./registry.js";

// ─── IResourceManager ─────────────────────────────────────────────────────────

export interface IResourceManager {
  resolveRequest(
    request: ResourceRequest,
    registry: IOrganisationResourceRegistry
  ): Promise<ResourceResponse>;
  buildDescriptor(
    resource: OrganisationResource,
    employeeRoleCode: string
  ): ResourceDescriptor;
  validateEmployeeAccess(
    resource: OrganisationResource,
    request: ResourceRequest
  ): { permitted: boolean; reason?: string };
}

// ─── ResourceManagerImpl ──────────────────────────────────────────────────────

export class ResourceManagerImpl implements IResourceManager {
  async resolveRequest(
    request: ResourceRequest,
    registry: IOrganisationResourceRegistry
  ): Promise<ResourceResponse> {
    const resolvedAt = new Date().toISOString();

    // Attempt to locate the resource
    let resource: OrganisationResource | null = null;

    if (request.resourceId) {
      resource = registry.getById(request.resourceId);
    } else if (request.resourceType) {
      const matches = registry.getByType(request.resourceType);
      // Pick the first permitted match
      resource =
        matches.find((r) =>
          r.permittedEmployees.includes(request.requestingEmployee)
        ) ?? null;
    }

    if (!resource) {
      return {
        requestId: request.requestId,
        resourceId: request.resourceId ?? "",
        descriptor: this._emptyDescriptor(request.resourceId ?? ""),
        status: "not_found",
        denialReason: request.resourceId
          ? `Resource "${request.resourceId}" not found in the registry`
          : `No resource of type "${request.resourceType}" found for the requesting employee`,
        approvalRequired: false,
        resolvedAt,
      };
    }

    // Validate access
    const accessResult = this.validateEmployeeAccess(resource, request);

    if (!accessResult.permitted) {
      return {
        requestId: request.requestId,
        resourceId: resource.resourceId,
        descriptor: this._emptyDescriptor(resource.resourceId),
        status: "denied",
        denialReason: accessResult.reason,
        approvalRequired: false,
        resolvedAt,
      };
    }

    const descriptor = this.buildDescriptor(resource, request.requestingEmployee);

    return {
      requestId: request.requestId,
      resourceId: resource.resourceId,
      descriptor,
      status: "granted",
      approvalRequired: false,
      resolvedAt,
    };
  }

  buildDescriptor(
    resource: OrganisationResource,
    employeeRoleCode: string
  ): ResourceDescriptor {
    // Determine which permissions this employee actually holds
    const allPermissions: ResourcePermission[] = [
      "read",
      "write",
      "search",
      "create",
      "delete",
      "metadata",
      "watch",
    ];

    const readOps: ResourcePermission[] = ["read", "search", "metadata", "watch"];
    const writeOps: ResourcePermission[] = ["write", "create", "delete"];

    const canRead = resource.readPermissions.includes(employeeRoleCode);
    const canWrite = resource.writePermissions.includes(employeeRoleCode);

    const employeePermissions: ResourcePermission[] = allPermissions.filter((p) => {
      if (readOps.includes(p)) return canRead;
      if (writeOps.includes(p)) return canWrite;
      return false;
    });

    // availableOperations = union of read + write ops if the employee has either
    const availableOperations: ResourcePermission[] = allPermissions.filter((p) => {
      if (readOps.includes(p)) return canRead;
      if (writeOps.includes(p)) return canWrite;
      return false;
    });

    // NEVER include physicalLocation in the descriptor
    return {
      resourceId: resource.resourceId,
      displayName: resource.displayName,
      resourceType: resource.resourceType,
      connectorType: resource.connectorType,
      sourceOfTruth: resource.sourceOfTruth,
      classification: resource.sensitivityClassification,
      availableOperations,
      employeePermissions,
    };
  }

  validateEmployeeAccess(
    resource: OrganisationResource,
    request: ResourceRequest
  ): { permitted: boolean; reason?: string } {
    const { requestingEmployee, requiredPermissions } = request;

    // Check the employee is in the permitted list
    if (!resource.permittedEmployees.includes(requestingEmployee)) {
      return {
        permitted: false,
        reason: `Employee role "${requestingEmployee}" is not permitted to access resource "${resource.resourceId}"`,
      };
    }

    const readOps: ResourcePermission[] = ["read", "search", "metadata", "watch"];
    const writeOps: ResourcePermission[] = ["write", "create", "delete"];

    for (const permission of requiredPermissions) {
      if (readOps.includes(permission) && !resource.readPermissions.includes(requestingEmployee)) {
        return {
          permitted: false,
          reason: `Employee role "${requestingEmployee}" does not have "${permission}" permission on resource "${resource.resourceId}"`,
        };
      }
      if (writeOps.includes(permission) && !resource.writePermissions.includes(requestingEmployee)) {
        return {
          permitted: false,
          reason: `Employee role "${requestingEmployee}" does not have "${permission}" permission on resource "${resource.resourceId}"`,
        };
      }
    }

    return { permitted: true };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private _emptyDescriptor(resourceId: string): ResourceDescriptor {
    return {
      resourceId,
      displayName: "",
      resourceType: "document_file",
      connectorType: "file_connector",
      sourceOfTruth: "",
      classification: "organisational",
      availableOperations: [],
      employeePermissions: [],
    };
  }
}
