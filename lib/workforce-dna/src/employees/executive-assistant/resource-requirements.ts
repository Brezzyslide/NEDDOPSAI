/**
 * Executive Assistant — Organisation Resource Requirements
 * Sprint XX: Organisation Resource Architecture
 *
 * Declares the organisational resources the AI Executive Assistant requires.
 * All access occurs through the Organisation Resource Registry and Resource Manager.
 * No physical storage locations, vendor names, or URLs may appear here.
 */

import type { EmployeeResourceRequirements } from "../../employee/types.js";

export const EA_RESOURCE_REQUIREMENTS: EmployeeResourceRequirements = {
  requiredResources: [
    {
      resourceName: "Calendar",
      resourceType: "calendar",
      requiredPermissions: ["read", "write", "create"],
      sensitivity: "organisational",
      approvalRequired: true,
      purpose:
        "Schedule, update, and cancel meetings and events on behalf of the organisation and its executives",
    },
    {
      resourceName: "Email",
      resourceType: "email",
      requiredPermissions: ["read", "write", "create"],
      sensitivity: "restricted",
      approvalRequired: true,
      purpose:
        "Read inbound correspondence, draft replies, and send approved outbound communications",
    },
    {
      resourceName: "Contacts",
      resourceType: "contacts",
      requiredPermissions: ["read", "search"],
      sensitivity: "organisational",
      approvalRequired: false,
      purpose:
        "Look up contact details for meeting invitations, communications, and correspondence",
    },
    {
      resourceName: "Documents and Templates",
      resourceType: "document_library",
      requiredPermissions: ["read", "search"],
      sensitivity: "organisational",
      approvalRequired: false,
      purpose:
        "Access document templates and reference materials to support meeting preparation, briefings, and correspondence",
    },
    {
      resourceName: "Task Lists and Action Registers",
      resourceType: "task_management",
      requiredPermissions: ["read", "write", "create"],
      sensitivity: "organisational",
      approvalRequired: false,
      purpose:
        "Create, update, and track action items and tasks arising from meetings and correspondence",
    },
    {
      resourceName: "Meeting Records and Agendas",
      resourceType: "document_file",
      requiredPermissions: ["read", "write", "create"],
      sensitivity: "organisational",
      approvalRequired: false,
      purpose:
        "Store meeting agendas, notes, and minutes for future reference and action tracking",
    },
    {
      resourceName: "Communication Templates",
      resourceType: "document_file",
      requiredPermissions: ["read"],
      sensitivity: "organisational",
      approvalRequired: false,
      purpose:
        "Access approved communication templates to maintain consistent and professional correspondence",
    },
  ],

  permittedResourceTypes: [
    "calendar",
    "email",
    "contacts",
    "task_management",
    "document_library",
    "document_file",
    "communication_channel",
  ],

  browserAutomationPermitted: false,

  sourceOfTruthBehaviour:
    "The Executive Assistant treats calendar systems, email systems, and task management systems as the source of truth. It does not create duplicate copies of communications, meetings, or action items in organisation memory unless explicitly instructed.",

  resourceDiscoveryRule:
    "When a required resource is not registered, the Executive Assistant requests registration through the Resource Manager. It does not attempt to locate physical storage or connector implementations directly.",

  version: "1.0.0",
};
