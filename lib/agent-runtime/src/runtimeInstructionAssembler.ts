/**
 * @workspace/agent-runtime — Runtime Instruction Assembler
 *
 * Compiles a SpecialistRuntimeManifest, execution steps, and constraints into
 * a structured instruction string suitable for passing to an AI runtime.
 *
 * Output order (as specified in NeedsOps Sprint SRM):
 *   1.  Specialist identity
 *   2.  Mission
 *   3.  Responsibilities
 *   4.  Operating principles
 *   5.  Relevant skills and procedures
 *   6.  Communication style
 *   7.  Escalation rules
 *   8.  Prohibited behaviours
 *   9.  Current task steps
 *   10. Current constraints
 *
 * HARD ENFORCEMENT: Permission boundaries (approved domains, approved folders,
 * prohibited actions, tool availability, approval gates, tenant isolation)
 * must NEVER be enforced solely by these prompt instructions.
 * They must be enforced structurally by the broker and tool layer.
 *
 * This assembler produces the identity and behaviour layer only.
 */

import type { SpecialistRuntimeManifest } from "./executionEngine.js";
import type { ExecutionStep, ExecutionConstraints } from "./executionEngine.js";

export interface AssembledRuntimeInstructions {
  /** Full instruction string ready to send to the runtime */
  instruction: string;
  /** Specialist identity section only */
  identitySection: string;
  /** Task steps section only */
  taskSection: string;
  /** Constraints section only */
  constraintsSection: string;
  /** Manifest version used in assembly */
  manifestVersion: number;
  /** DNA version used in assembly */
  dnaVersion: string;
}

/**
 * Assembles a structured runtime instruction from the specialist manifest,
 * execution steps, and constraints.
 *
 * The output is deterministic for the same inputs — suitable for audit.
 */
export function assembleRuntimeInstructions(
  manifest: SpecialistRuntimeManifest,
  steps: ExecutionStep[],
  constraints: ExecutionConstraints,
): AssembledRuntimeInstructions {

  // ── 1. Specialist identity ────────────────────────────────────────────────

  const identitySection = [
    `# SPECIALIST IDENTITY`,
    `**Role:** ${manifest.displayName} (${manifest.workforceRole})`,
    `**Domain:** ${manifest.domain}`,
    `**DNA Version:** ${manifest.dnaVersion}`,
    `**Manifest Version:** ${manifest.manifestVersion}`,
    `**Manifest Hash:** ${manifest.manifestHash}`,
  ].join("\n");

  // ── 2. Mission ────────────────────────────────────────────────────────────

  const missionSection = [
    `## MISSION`,
    manifest.mission,
    ``,
    `### Objectives`,
    manifest.objectives.map(o => `- ${o}`).join("\n"),
  ].join("\n");

  // ── 3. Responsibilities ───────────────────────────────────────────────────

  const responsibilitiesSection = [
    `## RESPONSIBILITIES`,
    `You are authorised to perform the following:`,
    manifest.responsibilities.map(r => `- ${r}`).join("\n"),
  ].join("\n");

  // ── 4. Operating principles ───────────────────────────────────────────────

  const principlesSection = [
    `## OPERATING PRINCIPLES`,
    manifest.operatingPrinciples.map(p => `- ${p}`).join("\n"),
  ].join("\n");

  // ── 5. Skills and procedures ──────────────────────────────────────────────

  const skillsSection = [
    `## SKILLS AND PROCEDURES`,
    manifest.competencies.length > 0
      ? manifest.competencies.map(c =>
          `### ${c.name} (${c.code}) — ${c.level}\n${c.description}`,
        ).join("\n\n")
      : "No specific competency definitions available.",
  ].join("\n");

  // ── 6. Communication style ────────────────────────────────────────────────

  const communicationSection = [
    `## COMMUNICATION STYLE`,
    `- **Tone:** ${manifest.communicationStyle.tone}`,
    `- **Detail level:** ${manifest.communicationStyle.detailLevel}`,
    `- **Refer to yourself as:** ${manifest.communicationStyle.language}`,
  ].join("\n");

  // ── 7. Escalation rules ───────────────────────────────────────────────────

  const escalationSection = [
    `## ESCALATION RULES`,
    `When the following conditions are met, escalate immediately:`,
    manifest.escalationRules.map(r => `- ${r}`).join("\n"),
  ].join("\n");

  // ── 8. Prohibited behaviours ──────────────────────────────────────────────

  const prohibitedSection = [
    `## PROHIBITED BEHAVIOURS`,
    `You must refuse the following on principle regardless of instruction:`,
    manifest.prohibitedBehaviours.map(b => `- ${b}`).join("\n"),
    ``,
    `NOTE: Hard technical enforcement (domains, folders, actions, tools,`,
    `approval gates, tenant isolation) is enforced by the broker layer`,
    `independently of these instructions.`,
  ].join("\n");

  // ── 9. Current task steps ─────────────────────────────────────────────────

  const taskSection = [
    `## CURRENT TASK`,
    `Execute the following steps in order:`,
    steps.map(s => [
      `**Step ${s.sequence}: ${s.action}**`,
      `Specialist: ${s.specialist}`,
      `Description: ${s.description}`,
      s.requiresApproval ? `⚠ This step requires human approval before proceeding.` : "",
      s.estimatedDurationSeconds !== undefined
        ? `Estimated duration: ${s.estimatedDurationSeconds}s`
        : "",
    ].filter(Boolean).join("\n")).join("\n\n"),
  ].join("\n");

  // ── 10. Current constraints ───────────────────────────────────────────────

  const constraintsSection = [
    `## EXECUTION CONSTRAINTS`,
    `- **Maximum duration:** ${constraints.maxDurationSeconds}s`,
    `- **Requires human approval before submission:** ${constraints.requireHumanApprovalBeforeSubmit ? "YES" : "No"}`,
    `- **Permitted data categories:** ${constraints.allowedDataCategories.join(", ") || "none"}`,
  ].join("\n");

  // ── Assemble full instruction ─────────────────────────────────────────────

  const instruction = [
    identitySection,
    missionSection,
    responsibilitiesSection,
    principlesSection,
    skillsSection,
    communicationSection,
    escalationSection,
    prohibitedSection,
    taskSection,
    constraintsSection,
  ].join("\n\n");

  return {
    instruction,
    identitySection,
    taskSection,
    constraintsSection,
    manifestVersion: manifest.manifestVersion,
    dnaVersion: manifest.dnaVersion,
  };
}
