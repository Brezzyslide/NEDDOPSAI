/**
 * DNA Registry — Sprint 10 / Sprint 12
 *
 * Central registry of all published Professional DNA profiles.
 * Access DNA by role code. Returns null for unactivated specialists.
 *
 * Sprint 12 additions:
 * - Employee File registry (EMPLOYEE_FILE_REGISTRY)
 * - getEmployeeFile(roleCode): EmployeeFile | null
 * - buildSystemInstructionForEmployee(roleCode): string
 *
 * Adding a new specialist requires:
 *  1. Creating a profile file in src/profiles/
 *  2. Adding it to the REGISTRY map below
 *  3. Publishing a new DNA version
 */

import type { DNAProfile, RunVersionRecord } from "./types.js";
import { captureRunVersions } from "./types.js";
import type { SafeWorkforceDNADescriptor, WorkforceDNA } from "./canonical.js";
import {
  buildSafeWorkforceDNADescriptor,
  mapLegacyDNAProfileToWorkforceDNA,
} from "./canonical.js";
import { CHIEF_OF_STAFF_DNA } from "./profiles/chiefOfStaff.js";
import { COMPLIANCE_OFFICER_DNA } from "./profiles/complianceOfficer.js";
import { OPERATIONS_MANAGER_DNA } from "./profiles/operationsManager.js";
import { DOCUMENT_SPECIALIST_DNA } from "./profiles/documentSpecialist.js";
import { INCIDENT_MANAGEMENT_DNA } from "./profiles/incidentManagement.js";
import { EXECUTIVE_ASSISTANT_DNA_V1 } from "./profiles/executiveAssistant.js";

import type { EmployeeFile } from "./employee/types.js";
import { buildEmployeeSystemInstruction } from "./employee/index.js";
import {
  CHIEF_OF_STAFF_EMPLOYEE_FILE,
} from "./employees/chief-of-staff/index.js";
import {
  EXECUTIVE_ASSISTANT_EMPLOYEE_FILE,
} from "./employees/executive-assistant/index.js";

// ─── Active DNA registry ──────────────────────────────────────────────────────

/**
 * All published DNA profiles, keyed by workforce role code.
 * Only add profiles that have been reviewed and published.
 * Editing a profile requires creating a new version — do not modify published profiles.
 */
const REGISTRY: ReadonlyMap<string, DNAProfile> = new Map([
  ["chief_of_staff",       CHIEF_OF_STAFF_DNA],
  ["executive_assistant",  EXECUTIVE_ASSISTANT_DNA_V1],
  ["compliance_officer",   COMPLIANCE_OFFICER_DNA],
  ["operations_manager",   OPERATIONS_MANAGER_DNA],
  ["document_specialist",  DOCUMENT_SPECIALIST_DNA],
  ["incident_management",  INCIDENT_MANAGEMENT_DNA],
]);

// ─── Employee File registry ───────────────────────────────────────────────────

/**
 * All Employee Files, keyed by workforce role code.
 * Only roles with a complete Sprint 12 Employee File appear here.
 */
export const EMPLOYEE_FILE_REGISTRY: ReadonlyMap<string, EmployeeFile> = new Map([
  ["chief_of_staff", CHIEF_OF_STAFF_EMPLOYEE_FILE],
  ["executive_assistant", EXECUTIVE_ASSISTANT_EMPLOYEE_FILE],
]);

// ─── Public API — DNA ─────────────────────────────────────────────────────────

/**
 * Returns the active DNA profile for a workforce role code.
 * Returns null if the specialist has no published DNA (not yet activated).
 */
export function getDNAProfile(roleCode: string): DNAProfile | null {
  return REGISTRY.get(roleCode) ?? null;
}

/**
 * Returns all activated DNA profiles.
 */
export function getAllActiveDNAProfiles(): DNAProfile[] {
  return Array.from(REGISTRY.values()).filter(p => p.currentVersion.isActive);
}

/**
 * Returns true if a role has an active DNA profile.
 */
export function hasActiveDNA(roleCode: string): boolean {
  const profile = REGISTRY.get(roleCode);
  return profile?.currentVersion.isActive ?? false;
}

/**
 * Returns the canonical structured Workforce DNA projection for an activated
 * role. This preserves legacy DNA content but maps it into the canonical
 * structured model used by the runtime projection pipeline.
 */
export function getCanonicalDNAProfile(roleCode: string): WorkforceDNA | null {
  const profile = REGISTRY.get(roleCode);
  if (!profile || !profile.currentVersion.isActive) return null;
  return mapLegacyDNAProfileToWorkforceDNA(profile);
}

/**
 * Returns a tenant-safe specialist descriptor. This deliberately excludes
 * private platform DNA such as reasoning methodology, evidence philosophy,
 * collaboration rules, escalation internals and compiled instructions.
 */
export function getSafeDNADescriptor(
  roleCode: string,
  availability: SafeWorkforceDNADescriptor["availability"] = "available",
): SafeWorkforceDNADescriptor | null {
  const canonical = getCanonicalDNAProfile(roleCode);
  return canonical ? buildSafeWorkforceDNADescriptor(canonical, availability) : null;
}

/**
 * Returns the current DNA version string for a role.
 * Returns "N/A" for unactivated specialists.
 */
export function getDNAVersion(roleCode: string): string {
  return REGISTRY.get(roleCode)?.currentVersion.version ?? "N/A";
}

/**
 * Returns the reasoning methodology version for a role.
 */
export function getReasoningVersion(roleCode: string): string {
  return REGISTRY.get(roleCode)?.reasoningMethodology.version ?? "N/A";
}

/**
 * Returns the output schema version for a role.
 */
export function getOutputSchemaVersion(roleCode: string): string {
  return REGISTRY.get(roleCode)?.outputSchema.version ?? "N/A";
}

/**
 * Captures all version identifiers for a specialist run.
 * Call at the start of every specialist run to guarantee reproducibility.
 */
export function captureSpecialistRunVersions(
  roleCode: string,
  modelVersion: string,
  capabilityVersion = "1.0.0",
  workerProfileVersion = "1.0.0",
): RunVersionRecord {
  const profile = getDNAProfile(roleCode);
  if (!profile) {
    return {
      dnaVersion: "N/A",
      workerProfileVersion,
      capabilityVersion,
      reasoningVersion: "N/A",
      outputSchemaVersion: "N/A",
      modelVersion,
      recordedAt: new Date().toISOString(),
    };
  }
  return captureRunVersions(profile, modelVersion, capabilityVersion, workerProfileVersion);
}

/**
 * Builds the system instruction string for a specialist run.
 * Incorporates DNA identity, mission, reasoning methodology, and boundaries.
 */
export function buildDNASystemInstruction(roleCode: string): string {
  const profile = getDNAProfile(roleCode);
  if (!profile) {
    return `You are a NeedsOps AI Specialist. Specialist intelligence for "${roleCode}" is not yet activated.`;
  }

  const p = profile;
  const reasoning = p.reasoningMethodology;

  const lines: string[] = [
    `# ${p.identity.title}`,
    `**Role:** ${p.identity.roleCode}`,
    `**DNA Version:** ${p.currentVersion.version}`,
    `**Domain:** ${p.identity.domain}`,
    ``,
    `## IDENTITY AND MISSION`,
    p.mission.primaryMission,
    ``,
    `**Professional Philosophy:** ${p.philosophy.statement}`,
    ``,
    `## WHAT YOU CAN DO`,
    p.professionalBoundaries.canDo.map(s => `- ${s}`).join("\n"),
    ``,
    `## WHAT YOU CANNOT DO`,
    p.professionalBoundaries.cannotDo.map(s => `- ${s}`).join("\n"),
    ``,
    `## ACTIONS REQUIRING APPROVAL`,
    p.professionalBoundaries.requiresApproval.map(s => `- ${s}`).join("\n"),
    ``,
    `## HARD STOPS — REFUSE THESE REQUESTS`,
    p.escalationFramework.hardStops.map(s => `- ${s}`).join("\n"),
    ``,
    `## REASONING METHODOLOGY — ${reasoning.name}`,
    `Follow these steps ${reasoning.strictOrdering ? "in strict order" : "as applicable"}:`,
    reasoning.steps.map(step =>
      `**Step ${step.stepId}: ${step.name}**\n${step.instruction}`
    ).join("\n\n"),
    ``,
    `## EVIDENCE STANDARDS`,
    `${p.evidenceStandards.contradictionPolicy}`,
    `**Insufficient evidence indicators:**`,
    p.evidenceStandards.insufficiencyIndicators.map(s => `- ${s}`).join("\n"),
    ``,
    `## SECURITY — CRITICAL`,
    p.professionalBoundaries.securityConstraints.map(s => `- ${s}`).join("\n"),
    ``,
    `## OUTPUT`,
    `Return ONLY valid JSON matching the SpecialistRunResult schema.`,
    `DNA version to record: ${p.currentVersion.version}`,
    `Reasoning methodology version: ${reasoning.version}`,
    `Output schema version: ${p.outputSchema.version}`,
    ``,
    `Required output fields: ${p.outputSchema.requiredKeys.join(", ")}`,
    ``,
    `Validation rules:`,
    p.outputSchema.validationRules.map(r => `- ${r}`).join("\n"),
  ];

  return lines.join("\n");
}

/**
 * Returns a list of all active role codes.
 */
export function getActivatedRoleCodes(): string[] {
  return Array.from(REGISTRY.entries())
    .filter(([_, p]) => p.currentVersion.isActive)
    .map(([code]) => code);
}

/**
 * Returns a summary of all DNA profiles for display.
 */
export function getDNASummary(): Array<{
  roleCode: string;
  title: string;
  version: string;
  domain: string;
  isActive: boolean;
}> {
  return Array.from(REGISTRY.values()).map(p => ({
    roleCode: p.identity.roleCode,
    title: p.identity.title,
    version: p.currentVersion.version,
    domain: p.identity.domain,
    isActive: p.currentVersion.isActive,
  }));
}

// ─── Public API — Employee File ────────────────────────────────────────────────

/**
 * Returns the Employee File for a workforce role code.
 * Returns null if the role does not yet have an Employee File.
 */
export function getEmployeeFile(roleCode: string): EmployeeFile | null {
  return EMPLOYEE_FILE_REGISTRY.get(roleCode) ?? null;
}

/**
 * Builds a system instruction for an AI Employee.
 *
 * If the role has an Employee File, uses the full Employee File architecture
 * (Constitution preamble + soul + mission + authority + DNA reasoning methodology).
 *
 * Falls back to the legacy DNA-only system instruction for roles without
 * an Employee File.
 */
export function buildSystemInstructionForEmployee(roleCode: string): string {
  const employeeFile = getEmployeeFile(roleCode);
  if (employeeFile) {
    return buildEmployeeSystemInstruction(employeeFile, null);
  }
  return buildDNASystemInstruction(roleCode);
}

// ─── Convenience re-exports ────────────────────────────────────────────────────

export { CHIEF_OF_STAFF_EMPLOYEE_FILE } from "./employees/chief-of-staff/index.js";
export { EXECUTIVE_ASSISTANT_EMPLOYEE_FILE } from "./employees/executive-assistant/index.js";
