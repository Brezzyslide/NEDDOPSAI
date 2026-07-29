/**
 * Chief of Staff — Organisation Resource Requirements
 * Sprint XX: Organisation Resource Architecture
 *
 * Declares the organisational resources the AI Chief of Staff requires.
 * All access occurs through the Organisation Resource Registry and Resource Manager.
 * No physical storage locations, vendor names, or URLs may appear here.
 */

import type { EmployeeResourceRequirements } from "../../employee/types.js";

export const COS_RESOURCE_REQUIREMENTS: EmployeeResourceRequirements = {
  requiredResources: [
    {
      resourceName: "Organisation Overview and Context",
      resourceType: "document_library",
      requiredPermissions: ["read"],
      sensitivity: "organisational",
      approvalRequired: false,
      purpose:
        "Provides organisational context for task routing, strategic alignment, and executive briefings",
    },
    {
      resourceName: "Task History and Patterns",
      resourceType: "document_library",
      requiredPermissions: ["read", "search"],
      sensitivity: "organisational",
      approvalRequired: false,
      purpose:
        "Enables pattern recognition across past tasks to improve specialist allocation and identify recurring operational themes",
    },
    {
      resourceName: "Specialist Outputs and Work Packages",
      resourceType: "document_file",
      requiredPermissions: ["read"],
      sensitivity: "restricted",
      approvalRequired: false,
      purpose:
        "Allows the Chief of Staff to review, synthesise, and relay specialist outputs to the requesting user",
    },
    {
      resourceName: "Compliance References",
      resourceType: "document_library",
      requiredPermissions: ["read", "search"],
      sensitivity: "organisational",
      approvalRequired: false,
      purpose:
        "Supports awareness of compliance obligations when routing tasks to the Compliance and Quality Manager",
    },
    {
      resourceName: "Workforce Policies",
      resourceType: "document_library",
      requiredPermissions: ["read"],
      sensitivity: "organisational",
      approvalRequired: false,
      purpose:
        "Informs task routing and specialist allocation with awareness of current workforce policies",
    },
  ],

  permittedResourceTypes: [
    "document_library",
    "document_file",
    "reporting",
  ],

  browserAutomationPermitted: false,

  sourceOfTruthBehaviour:
    "The Chief of Staff treats all registered organisational resources as the source of truth. It does not duplicate document content in organisation memory — only extracted structured understanding.",

  resourceDiscoveryRule:
    "When a required resource is not registered, the Chief of Staff requests registration through the Resource Manager before attempting to access it.",

  version: "1.0.0",
};
