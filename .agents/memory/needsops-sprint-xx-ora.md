---
name: NeedsOps Sprint XX Organisation Resource Architecture
description: New lib/organisation-resource package, ResourceRegistry, ResourceManager, Connectors, Employee File resourceRequirements, 1164 tests
---

## What was built

New platform architecture sprint — AI Employees now declare resources abstractly; all access routes through the Organisation Resource Registry and Resource Manager.

## New package: lib/organisation-resource (@workspace/organisation-resource)
- src/types.ts — ResourceType, ConnectorType, SensitivityClassification, ResourcePermission, OrganisationResource (internal, has physicalLocation), ResourceDescriptor (what employees see — no physicalLocation), ResourceRequest, ResourceResponse, connector operation types, platform rule constants
- src/registry.ts — IOrganisationResourceRegistry interface + OrganisationResourceRegistryImpl (in-memory Map)
- src/resourceManager.ts — IResourceManager interface + ResourceManagerImpl (resolveRequest, buildDescriptor, validateEmployeeAccess)
- src/connectors.ts — IFileConnector (10 ops), IBrowserConnector (11 ops, must use OpenClaw), IApiConnector interfaces
- src/validation.ts — validateNoDirectResourceReferences() against PROHIBITED_EMPLOYEE_FILE_REFERENCES
- src/index.ts — re-exports all

## New API server services
- artifacts/api-server/src/services/organisationResourceRegistryService.ts — per-org in-memory registry (Map<orgId, Map<resourceId, ResourceEntry>>)
- artifacts/api-server/src/services/resourceManagerService.ts — resolveResourceRequest with access validation, descriptor sanitisation (no physicalLocation), audit logging

## Capability registry update
- "resource" added to CapabilityCategory type
- resource.locate added to BUSINESS_CAPABILITIES (core, packCode null, 11 eligible roles, executionAllowed false)

## Employee File type changes (lib/workforce-dna/src/employee/types.ts)
- Added EmployeeResourceRequirements interface + ResourceRequirementItem + PermittedResourceType + ResourceSensitivity
- Added resourceRequirements?: EmployeeResourceRequirements to EmployeeFile (optional TypeScript, enforced in validateEmployeeFile)

## Employee File validation changes (lib/workforce-dna/src/employee/index.ts)
- validateEmployeeFile now errors if resourceRequirements is absent
- validateEmployeeFile scans responsibilities, authority.may, authority.mayNot for PROHIBITED_DIRECT_REFS (sharepoint, google drive, onedrive, dropbox, chrome, firefox, edge, openclaw, http://, https://, file://)

## CoS resourceRequirements (lib/workforce-dna/src/employees/chief-of-staff/resource-requirements.ts)
- COS_RESOURCE_REQUIREMENTS: 5 resources (document_library ×4, document_file ×1)
- browserAutomationPermitted: false
- permittedResourceTypes: ["document_library", "document_file", "reporting"]

## EA resourceRequirements (lib/workforce-dna/src/employees/executive-assistant/resource-requirements.ts)
- EA_RESOURCE_REQUIREMENTS: 7 resources (calendar, email, contacts, document_library, task_management, document_file ×2)
- browserAutomationPermitted: false
- permittedResourceTypes: 7 types including calendar, email, contacts

## Architecture rules (permanent, in platform constants)
- SOURCE_OF_TRUTH_RULE: "Customer systems remain the source of truth. NeedsOps stores organisational understanding, not duplicate document repositories."
- PLATFORM_RESOURCE_RULE: all resources via Registry → Resource Manager → Connector
- Employees never see physicalLocation, URLs, credentials, or implementation metadata — only ResourceDescriptor
- Browser automation exclusively via OpenClaw through IBrowserConnector — employees never directly

## Test file
- artifacts/api-server/src/__tests__/sprint-xx-organisation-resource.test.ts — 70 new tests (10 groups)
- Total: 1164 tests passing

## Notes for future employees
- When adding a new AI Employee, create resource-requirements.ts in employees/<role>/ following CoS/EA pattern
- resourceRequirements is now mandatory — validateEmployeeFile errors if absent
- buildSystemInstructionForEmployee does NOT currently render resourceRequirements into the prompt — it is a declaration only
- The lib/organisation-resource package is pure types + in-memory implementations — no real connector code exists yet (they are interfaces)
