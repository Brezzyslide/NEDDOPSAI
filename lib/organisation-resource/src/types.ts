// ─── Resource Types ────────────────────────────────────────────────────────────

export type ResourceType =
  | "document_library"
  | "document_file"
  | "calendar"
  | "email"
  | "contacts"
  | "task_management"
  | "reporting"
  | "forms"
  | "browser_application"
  | "api_service"
  | "database_view"
  | "communication_channel";

export type ConnectorType =
  | "file_connector"
  | "browser_connector"
  | "api_connector"
  | "sharepoint_file_connector"
  | "onedrive_file_connector"
  | "google_drive_connector"
  | "dropbox_connector"
  | "local_file_connector"
  | "network_drive_connector"
  | "microsoft_graph_connector"
  | "google_workspace_connector"
  | "xero_connector"
  | "deputy_connector"
  | "employment_hero_connector"
  | "lumary_connector"
  | "shiftcare_connector"
  | "generic_api_connector";

export type SensitivityClassification =
  | "public"
  | "organisational"
  | "restricted"
  | "confidential"
  | "highly_confidential";

export type ResourcePermission =
  | "read"
  | "write"
  | "search"
  | "create"
  | "delete"
  | "metadata"
  | "watch";

export type IndexingStatus =
  | "not_indexed"
  | "pending"
  | "indexed"
  | "failed"
  | "excluded";

// ─── OrganisationResource ──────────────────────────────────────────────────────
// Full registry entry — includes physical location, NEVER sent to employees.

export interface OrganisationResource {
  resourceId: string;             // unique identifier e.g. "policies"
  displayName: string;            // e.g. "Organisation Policies"
  resourceType: ResourceType;
  connectorType: ConnectorType;
  sourceOfTruth: string;          // e.g. "SharePoint", "Google Drive", "Local File Server"
  physicalLocation: string;       // URL, path, or system reference — NEVER sent to employees
  owner: string;                  // role or person responsible
  permittedEmployees: string[];   // role codes
  readPermissions: string[];      // role codes permitted to read
  writePermissions: string[];     // role codes permitted to write
  sensitivityClassification: SensitivityClassification;
  indexingStatus: IndexingStatus;
  lastVerified: string;           // ISO timestamp
  auditEnabled: boolean;
  metadata?: Record<string, unknown>;
}

// ─── ResourceDescriptor ────────────────────────────────────────────────────────
// Sanitised — what employees see, no physical details.

export interface ResourceDescriptor {
  resourceId: string;
  displayName: string;
  resourceType: ResourceType;
  connectorType: ConnectorType;
  sourceOfTruth: string;          // e.g. "SharePoint" — but NOT the URL
  classification: SensitivityClassification;
  availableOperations: ResourcePermission[];
  employeePermissions: ResourcePermission[];
  // Employees must never receive: URLs, network paths, auth details, implementation metadata
}

// ─── ResourceRequest ───────────────────────────────────────────────────────────

export interface ResourceRequest {
  requestId: string;
  requestingEmployee: string;     // role code
  requestingUser: string;         // user ID
  organisationId: string;
  resourceId?: string;            // specific resource, if known
  resourceType?: ResourceType;    // type of resource needed, if resourceId unknown
  purpose: string;
  requiredPermissions: ResourcePermission[];
  taskId?: string;
  sensitivityRequired?: SensitivityClassification;
}

// ─── ResourceResponse ──────────────────────────────────────────────────────────

export interface ResourceResponse {
  requestId: string;
  resourceId: string;
  descriptor: ResourceDescriptor;
  status: "granted" | "denied" | "pending_approval" | "not_found";
  denialReason?: string;
  approvalRequired: boolean;
  auditRecordId?: string;
  resolvedAt: string;
}

// ─── ResourceValidationResult ─────────────────────────────────────────────────

export interface ResourceValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ─── ConnectorOperation ────────────────────────────────────────────────────────

export interface ConnectorOperation {
  operationId: string;
  resourceId: string;
  employeeRoleCode: string;
  organisationId: string;
  taskId?: string;
}

export interface FileConnectorOperation extends ConnectorOperation {
  connectorType:
    | "file_connector"
    | "sharepoint_file_connector"
    | "onedrive_file_connector"
    | "google_drive_connector"
    | "dropbox_connector"
    | "local_file_connector"
    | "network_drive_connector";
  operation:
    | "search"
    | "locate"
    | "open"
    | "read"
    | "write"
    | "copy"
    | "move"
    | "delete"
    | "metadata"
    | "watch";
  query?: string;     // for search
  content?: string;   // for write
}

export interface BrowserConnectorOperation extends ConnectorOperation {
  connectorType: "browser_connector";
  operation:
    | "openBrowser"
    | "login"
    | "navigate"
    | "click"
    | "type"
    | "upload"
    | "download"
    | "captureScreenshot"
    | "extractContent"
    | "logout"
    | "close";
  targetUrl?: string;
  selector?: string;
  value?: string;
  executionRuntime: "OpenClaw"; // Browser automation ONLY runs via OpenClaw
}

export interface ApiConnectorOperation extends ConnectorOperation {
  connectorType:
    | "microsoft_graph_connector"
    | "google_workspace_connector"
    | "xero_connector"
    | "deputy_connector"
    | "employment_hero_connector"
    | "lumary_connector"
    | "shiftcare_connector"
    | "generic_api_connector";
  operation: string;  // business operation name, not HTTP method
  payload?: Record<string, unknown>;
}

// ─── ConnectorResult ───────────────────────────────────────────────────────────

export interface ConnectorResult {
  operationId: string;
  success: boolean;
  data?: unknown;
  errorCode?: string;
  errorMessage?: string;
  executedAt: string;
  auditRecordId?: string;
}

// ─── EmployeeResourceContext ───────────────────────────────────────────────────
// Runtime context for an employee — what it sees during execution.

export interface EmployeeResourceContext {
  organisationId: string;
  employeeRoleCode: string;
  availableResources: ResourceDescriptor[];                 // sanitised — no physical details
  permittedOperations: Record<string, ResourcePermission[]>; // resourceId → operations
  browserAutomationAvailable: boolean;
}

// ─── Platform Rules ────────────────────────────────────────────────────────────

export const SOURCE_OF_TRUTH_RULE =
  "Customer systems remain the source of truth. NeedsOps stores organisational understanding, not duplicate document repositories.";

export const PLATFORM_RESOURCE_RULE =
  "All organisational resources must be registered before AI Employees may access them. All resource requests must be resolved through the Organisation Resource Registry and Resource Manager. All browser, file and API access must occur exclusively through approved Connectors.";

export const PROHIBITED_EMPLOYEE_FILE_REFERENCES: readonly string[] = [
  "sharepoint",
  "onedrive",
  "google drive",
  "google docs",
  "dropbox",
  "chrome",
  "firefox",
  "edge",
  "openclaw",
  "http://",
  "https://",
  "file://",
  "\\",
  "c:\\",
  "c:/",
  "/var/",
  "/home/",
  "/mnt/",
] as const;
