/**
 * @workspace/organisation-resource — Organisation Resource Architecture
 *
 * Sprint XX: Organisation Resource Architecture
 *
 * Provides core types, interfaces, registry, resource manager, connector
 * interfaces, and validation utilities for the Organisation Resource
 * Architecture layer of NeedsOps AI+.
 *
 * Architecture position:
 *   Organisation Resource Registry
 *           ↓
 *   Resource Manager
 *           ↓
 *   Connectors (File / Browser / API)
 *           ↓
 *   Employee Resource Context
 *
 * Usage:
 *   import { OrganisationResourceRegistryImpl } from "@workspace/organisation-resource";
 *   import { ResourceManagerImpl } from "@workspace/organisation-resource";
 *   import { validateNoDirectResourceReferences } from "@workspace/organisation-resource";
 */

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  ResourceType,
  ConnectorType,
  SensitivityClassification,
  ResourcePermission,
  IndexingStatus,
  OrganisationResource,
  ResourceDescriptor,
  ResourceRequest,
  ResourceResponse,
  ResourceValidationResult,
  ConnectorOperation,
  FileConnectorOperation,
  BrowserConnectorOperation,
  ApiConnectorOperation,
  ConnectorResult,
  EmployeeResourceContext,
} from "./types.js";

export {
  SOURCE_OF_TRUTH_RULE,
  PLATFORM_RESOURCE_RULE,
  PROHIBITED_EMPLOYEE_FILE_REFERENCES,
} from "./types.js";

// ─── Registry ─────────────────────────────────────────────────────────────────
export type { IOrganisationResourceRegistry } from "./registry.js";
export { OrganisationResourceRegistryImpl } from "./registry.js";

// ─── Resource Manager ─────────────────────────────────────────────────────────
export type { IResourceManager } from "./resourceManager.js";
export { ResourceManagerImpl } from "./resourceManager.js";

// ─── Connectors ───────────────────────────────────────────────────────────────
export type {
  IFileConnector,
  IBrowserConnector,
  IApiConnector,
  ConnectorFactory,
} from "./connectors.js";

// ─── Validation ───────────────────────────────────────────────────────────────
export type { EmployeeFileResourceValidationResult } from "./validation.js";
export { validateNoDirectResourceReferences } from "./validation.js";
