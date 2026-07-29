/**
 * Resource Manager Service
 *
 * Resolves resource requests from AI Employees.
 * Uses the Organisation Resource Registry to locate resources and validate access.
 *
 * AI Employees never receive physical storage locations, URLs, or connector
 * implementation details — only abstract ResourceDescriptors.
 */

import type { ResourceDescriptor } from "./organisationResourceRegistryService.js";
import {
  getResource,
  getResourcesForEmployee,
  buildDescriptor,
  hasPermission,
} from "./organisationResourceRegistryService.js";

// ─── Request / Result types ───────────────────────────────────────────────────

export interface ResourceRequest {
  requestId: string;
  requestingEmployee: string;
  requestingUser: string;
  organisationId: string;
  /** Specific resource ID to locate (optional if resourceType provided) */
  resourceId?: string;
  /** Resource type to search by (used when resourceId is not specified) */
  resourceType?: string;
  purpose: string;
  requiredPermissions: Array<"read" | "write" | "search">;
  taskId?: string;
}

export interface ResourceResolutionResult {
  requestId: string;
  status: "granted" | "denied" | "pending_approval" | "not_found";
  descriptor?: ResourceDescriptor;
  denialReason?: string;
  approvalRequired: boolean;
  resolvedAt: string;
}

// ─── Resolution logic ─────────────────────────────────────────────────────────

/**
 * Resolve a resource request from an AI Employee.
 *
 * Flow:
 * 1. Look up resource by resourceId (or by type if resourceId not specified)
 * 2. Validate employee has all required permissions
 * 3. Check sensitivity — highly_confidential resources require approval
 * 4. Build ResourceDescriptor (no physical location)
 * 5. Return ResourceResolutionResult
 */
export async function resolveResourceRequest(
  request: ResourceRequest,
): Promise<ResourceResolutionResult> {
  const resolvedAt = new Date().toISOString();

  console.info("[ResourceManager] Resolving resource request", {
    requestId: request.requestId,
    requestingEmployee: request.requestingEmployee,
    organisationId: request.organisationId,
    resourceId: request.resourceId,
    resourceType: request.resourceType,
    requiredPermissions: request.requiredPermissions,
    taskId: request.taskId,
  });

  // ── Step 1: Locate the resource ──────────────────────────────────────────

  let resource = null;

  if (request.resourceId) {
    resource = getResource(request.organisationId, request.resourceId);
  } else if (request.resourceType) {
    // Search by type — return the first matching resource the employee can access
    const candidateResources = getResourcesForEmployee(
      request.organisationId,
      request.requestingEmployee,
    );
    resource = candidateResources.find(
      (r) => r.resourceType === request.resourceType,
    ) ?? null;
  }

  if (!resource) {
    const result: ResourceResolutionResult = {
      requestId: request.requestId,
      status: "not_found",
      denialReason: request.resourceId
        ? `Resource "${request.resourceId}" is not registered for organisation "${request.organisationId}"`
        : `No registered resource of type "${request.resourceType}" found for organisation "${request.organisationId}"`,
      approvalRequired: false,
      resolvedAt,
    };

    console.info("[ResourceManager] Resource not found", {
      requestId: request.requestId,
      status: result.status,
    });

    return result;
  }

  // ── Step 2: Validate permissions ─────────────────────────────────────────

  for (const permission of request.requiredPermissions) {
    if (!hasPermission(resource, request.requestingEmployee, permission)) {
      const result: ResourceResolutionResult = {
        requestId: request.requestId,
        status: "denied",
        denialReason: `Employee "${request.requestingEmployee}" does not have "${permission}" permission on resource "${resource.resourceId}"`,
        approvalRequired: false,
        resolvedAt,
      };

      console.info("[ResourceManager] Permission denied", {
        requestId: request.requestId,
        employee: request.requestingEmployee,
        missingPermission: permission,
        resourceId: resource.resourceId,
      });

      return result;
    }
  }

  // ── Step 3: Check sensitivity for approval requirement ───────────────────

  const requiresApproval =
    resource.sensitivityClassification === "highly_confidential";

  if (requiresApproval) {
    const result: ResourceResolutionResult = {
      requestId: request.requestId,
      status: "pending_approval",
      denialReason: `Resource "${resource.resourceId}" is classified as highly_confidential and requires explicit approval before access is granted`,
      approvalRequired: true,
      resolvedAt,
    };

    console.info("[ResourceManager] Approval required for highly_confidential resource", {
      requestId: request.requestId,
      resourceId: resource.resourceId,
      classification: resource.sensitivityClassification,
    });

    return result;
  }

  // ── Step 4: Build descriptor (no physical location) ──────────────────────

  const descriptor = buildDescriptor(resource, request.requestingEmployee);

  // ── Step 5: Return granted result ────────────────────────────────────────

  const result: ResourceResolutionResult = {
    requestId: request.requestId,
    status: "granted",
    descriptor,
    approvalRequired: false,
    resolvedAt,
  };

  console.info("[ResourceManager] Resource access granted", {
    requestId: request.requestId,
    resourceId: resource.resourceId,
    employee: request.requestingEmployee,
    resolvedAt,
  });

  return result;
}
