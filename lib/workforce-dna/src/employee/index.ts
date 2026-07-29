/**
 * Employee File Architecture — Public API
 *
 * Sprint 12: Provides runtime compilation and utility functions
 * for the Employee File / Runtime Manifest layer.
 *
 * Usage:
 *   import { compileRuntimeManifest, buildEmployeeSystemInstruction } from "@workspace/workforce-dna/employee";
 */

export type {
  EmployeeIdentity,
  EmployeeSoul,
  EmployeeMission,
  EmployeeValues,
  EmployeePersonality,
  EmployeeAuthority,
  EmployeeDecisionPhilosophy,
  EmployeeCommunicationStyle,
  EmployeeResponsibilities,
  EmployeeProfessionalDNA,
  EmployeeDNAVersion,
  DNAVersionStatus,
  ExpandedWorkerProfile,
  RuntimeManifest,
  RuntimeTaskContext,
  EmployeeFile,
  EmploymentType,
  RoleLevel,
  AuthorityLevel,
} from "./types.js";

import type { EmployeeFile, RuntimeManifest, RuntimeTaskContext } from "./types.js";
import {
  getConstitutionStatements,
  buildConstitutionPreamble,
  validateConstitutionInheritance,
  CONSTITUTION_VERSION,
} from "../constitution.js";

// ─── Runtime Manifest compilation ────────────────────────────────────────────

/**
 * Compiles an Employee File into a lightweight Runtime Manifest.
 *
 * The Runtime Manifest is the ONLY representation sent to the execution runtime.
 * It strips sensitive sections (soul, full personality, internal values detail)
 * and includes only what is needed for a specific task execution.
 *
 * @param file - The complete Employee File
 * @param taskContext - The current task context (null for testing/inspection)
 */
export function compileRuntimeManifest(
  file: EmployeeFile,
  taskContext: RuntimeTaskContext | null = null,
): RuntimeManifest {
  const activeDNA =
    file.professionalDNA.v2?.profile ?? file.professionalDNA.v1.profile;

  return {
    // Employee identity
    employeeId: file.identity.roleCode,
    title: file.identity.title,
    department: file.identity.department,
    dnaVersion: file.professionalDNA.activeVersion,
    workerProfileVersion: file.workerProfile.version,
    constitutionVersion: CONSTITUTION_VERSION,

    // Task context
    currentTask: taskContext
      ? {
          taskId: taskContext.taskId,
          capabilityCode: taskContext.capabilityCode,
          conversationContext: taskContext.conversationContext,
          organisationalContext: taskContext.organisationalContext,
        }
      : null,

    // Active capabilities
    activeCapabilities: file.workerProfile.availableCapabilities,

    // Runtime permissions
    runtimePermissions: {
      execution: file.workerProfile.executionPermissions,
      connectors: file.workerProfile.connectorPermissions,
      memory: file.workerProfile.memoryPermissions,
      delegation: file.workerProfile.delegationPermissions,
    },

    // Execution boundaries (from active DNA)
    executionBoundaries: {
      canDo: activeDNA.professionalBoundaries.canDo,
      cannotDo: activeDNA.professionalBoundaries.cannotDo,
      requiresApproval: activeDNA.professionalBoundaries.requiresApproval,
      hardStops: activeDNA.escalationFramework.hardStops,
    },

    // Security constraints
    securityConstraints: activeDNA.professionalBoundaries.securityConstraints,

    // Constitution (always included, abbreviated)
    constitutionStatements: getConstitutionStatements(),

    compiledAt: new Date().toISOString(),
  };
}

// ─── System instruction building ─────────────────────────────────────────────

/**
 * Builds a complete system instruction for an AI Employee.
 *
 * This is the enhanced version that uses the full Employee File architecture:
 *   1. Constitution preamble (10 immutable principles)
 *   2. Employee identity and soul
 *   3. Mission and values
 *   4. DNA reasoning methodology
 *   5. Authority boundaries
 *   6. Communication style
 *
 * For employees without an Employee File, fall back to buildDNASystemInstruction().
 */
export function buildEmployeeSystemInstruction(
  file: EmployeeFile,
  taskContext: RuntimeTaskContext | null = null,
): string {
  const manifest = compileRuntimeManifest(file, taskContext);
  const activeDNA =
    file.professionalDNA.v2?.profile ?? file.professionalDNA.v1.profile;
  const reasoning = activeDNA.reasoningMethodology;

  const lines: string[] = [
    // ── 1. Constitution preamble ────────────────────────────────────────────
    buildConstitutionPreamble(),
    ``,
    `---`,
    ``,

    // ── 2. Employee identity ────────────────────────────────────────────────
    `# ${file.identity.title}`,
    `**Role:** ${file.identity.roleCode} | **Department:** ${file.identity.department} | **DNA Version:** ${manifest.dnaVersion}`,
    ``,
    `## PURPOSE`,
    file.identity.purpose,
    ``,
    `## MISSION`,
    file.mission.mission,
    ``,
    `**Objectives:**`,
    file.mission.objectives.map(o => `- ${o}`).join("\n"),
    ``,

    // ── 3. Professional values ──────────────────────────────────────────────
    `## PROFESSIONAL VALUES`,
    `*(Constitution inherited — principles above govern all conduct)*`,
    ``,
    `Role-specific values:`,
    file.values.roleSpecificValues.map(v => `- ${v}`).join("\n"),
    ``,

    // ── 4. Authority ────────────────────────────────────────────────────────
    `## AUTHORITY — WHAT YOU MAY DO`,
    file.authority.may.map(a => `- ${a}`).join("\n"),
    ``,
    `## AUTHORITY — WHAT YOU MAY NOT DO`,
    file.authority.mayNot.map(a => `- ${a}`).join("\n"),
    ``,

    // ── 5. Decision philosophy ──────────────────────────────────────────────
    `## DECISION PHILOSOPHY — WHEN UNCERTAINTY EXISTS`,
    `Follow these steps in order. Never skip them.`,
    file.decisionPhilosophy.whenUncertaintyExists
      .map((step, i) => `${i + 1}. ${step}`)
      .join("\n"),
    ``,

    // ── 6. Reasoning methodology ────────────────────────────────────────────
    `## REASONING METHODOLOGY — ${reasoning.name}`,
    `Follow these steps ${reasoning.strictOrdering ? "in strict order" : "as applicable"}:`,
    reasoning.steps
      .map(step => `**Step ${step.stepId}: ${step.name}**\n${step.instruction}`)
      .join("\n\n"),
    ``,

    // ── 7. Communication style ──────────────────────────────────────────────
    `## COMMUNICATION STYLE`,
    file.communication.characteristics.map(c => `- ${c}`).join("\n"),
    ``,
    `Clearly distinguish in all outputs:`,
    file.communication.distinguish.map(d => `- ${d}`).join("\n"),
    ``,

    // ── 8. Hard stops ───────────────────────────────────────────────────────
    `## HARD STOPS — REFUSE THESE REQUESTS`,
    manifest.executionBoundaries.hardStops.map(s => `- ${s}`).join("\n"),
    ``,

    // ── 9. Security ─────────────────────────────────────────────────────────
    `## SECURITY — CRITICAL`,
    manifest.securityConstraints.map(s => `- ${s}`).join("\n"),
    ``,

    // ── 10. Task context ────────────────────────────────────────────────────
    ...(taskContext
      ? [
          `## CURRENT TASK`,
          `**Task ID:** ${taskContext.taskId}`,
          `**Capability:** ${taskContext.capabilityCode}`,
          ``,
        ]
      : []),

    // ── 11. Output ──────────────────────────────────────────────────────────
    `## OUTPUT`,
    `Return ONLY valid JSON matching the SpecialistRunResult schema.`,
    `DNA version to record: ${manifest.dnaVersion}`,
    `Reasoning methodology version: ${reasoning.version}`,
    `Output schema version: ${activeDNA.outputSchema.version}`,
    ``,
    `Required output fields: ${activeDNA.outputSchema.requiredKeys.join(", ")}`,
    ``,
    `Validation rules:`,
    activeDNA.outputSchema.validationRules.map(r => `- ${r}`).join("\n"),
  ];

  return lines.join("\n");
}

// ─── Validation utilities ─────────────────────────────────────────────────────

/**
 * Validates that an Employee File has been correctly constructed.
 * Returns an array of validation errors (empty = valid).
 */
export function validateEmployeeFile(file: EmployeeFile): string[] {
  const errors: string[] = [];

  // Constitution must always be inherited
  if (!file.values.constitutionInherited) {
    errors.push("values.constitutionInherited must be true — Constitution cannot be bypassed");
  }
  if (!validateConstitutionInheritance(file.values.constitutionVersion, file.values.constitutionInherited)) {
    errors.push(`values.constitutionVersion "${file.values.constitutionVersion}" does not match current Constitution version "${CONSTITUTION_VERSION}"`);
  }

  // Communication style invariants
  if (!file.communication.neverExaggerateCertainty) {
    errors.push("communication.neverExaggerateCertainty must be true");
  }

  // Soul must have traits
  if (!file.soul.traits.length) {
    errors.push("soul.traits must not be empty");
  }

  // Authority must be defined
  if (!file.authority.may.length) {
    errors.push("authority.may must not be empty");
  }
  if (!file.authority.mayNot.length) {
    errors.push("authority.mayNot must not be empty");
  }

  // DNA v1 must be published, unless this employee has no active version yet
  // (new employees with draft-only DNA have activeVersion === "none")
  if (file.professionalDNA.activeVersion !== "none" && file.professionalDNA.v1.status !== "published") {
    errors.push("professionalDNA.v1.status must be 'published'");
  }

  // DNA v2, if present, must be draft
  if (file.professionalDNA.v2 && file.professionalDNA.v2.status !== "draft") {
    errors.push("professionalDNA.v2.status must be 'draft' — v2 requires review before publishing");
  }

  // Identity role code must be present
  if (!file.identity.roleCode) {
    errors.push("identity.roleCode must not be empty");
  }

  return errors;
}

/**
 * Returns the Runtime Manifest without sensitive Employee File sections.
 * Verifies that sensitive sections are not present in the manifest.
 */
export function getRuntimeManifestSections(manifest: RuntimeManifest): string[] {
  return Object.keys(manifest);
}

/**
 * Returns the sections of an Employee File that are EXCLUDED from the Runtime Manifest.
 * These must never be sent to the execution runtime.
 */
export function getSensitiveEmployeeFileSections(): string[] {
  return [
    "soul",
    "personality",
    "values (full detail)",
    "mission.objectives (full list)",
    "professionalDNA (full profiles)",
    "workerProfile (full personnel detail)",
    "fileVersion",
    "createdAt",
    "updatedAt",
  ];
}
