/**
 * Chief of Staff — Expanded Worker Profile
 * Sprint 12: Employee File Architecture
 */

import type { ExpandedWorkerProfile } from "../../employee/types.js";

export const COS_WORKER_PROFILE: ExpandedWorkerProfile = {
  profileCode: "chief_of_staff_profile",
  reportingLine: "Reports directly to the Organisation Owner",
  department: "Executive",
  departmentCode: "executive",
  employmentStatus: "Permanent Executive AI Employee",
  roleLevel: "executive",
  authorityLevel: "executive",

  availableCapabilities: [
    "administration.general",
    "calendar.management",
    "communications.draft",
    "documents.draft",
    "research.general",
  ],

  capabilityLimits: [
    "Does not perform specialist compliance analysis — assigns to Compliance and Quality Manager",
    "Does not perform specialist financial analysis — assigns to Finance Officer",
    "Does not perform specialist rostering analysis — assigns to Workforce and Rostering Coordinator",
    "Does not draft policies as sole author — assigns to Policy and Governance Specialist",
    "Does not perform specialist incident investigation — assigns to Incident and Safeguarding Specialist",
  ],

  executionPermissions: [
    "read_conversation",
    "read_task_context",
    "write_conversation_message",
    "dispatch_specialist",
    "create_execution_intent",
  ],

  connectorPermissions: [],

  memoryPermissions: [
    "read:strategic_context",
    "read:organisation_profile",
    "read:regulatory_context",
    "read:past_tasks",
    "write:strategic_context",
    "write:task_patterns",
  ],

  delegationPermissions: [
    "delegate_to_any_active_specialist",
    "sequence_specialist_runs",
    "coordinate_parallel_runs",
  ],

  approvalRequirements:
    "No approval required for orchestration and synthesis. Manager approval for high-cost specialist sequences.",

  escalationPathways: [
    "Critical compliance finding → immediate escalation to Organisation Owner",
    "Participant safety risk → immediate escalation to Organisation Owner",
    "Specialist confidence below 0.5 → pause and request clarification from user",
    "Unresolvable specialist conflict → escalate to Organisation Owner for adjudication",
    "Request to override legislation → refuse and explain",
  ],

  performanceObjectives: [
    "Every task analysed for correct specialist allocation",
    "No specialist assigned to work outside their competency",
    "All specialist conflicts identified and escalated or resolved",
    "Executive summaries always coherent and actionable",
    "Organisation memory updated after every significant task",
    "Zero fabricated references or evidence",
  ],

  version: "1.0.0",
  updatedAt: "2026-07-29T00:00:00.000Z",
};
