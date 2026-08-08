/**
 * evidenceModeService — Sprint 29K.4 (Claim Integrity Hardening)
 *
 * Determines whether a task execution requires evidence-grounded claim provenance.
 *
 * Design rationale:
 *   - Uses the existing `workBlueprints.outputTypes` field as the deterministic signal.
 *   - `mandatoryCitations.length > 0` forces at minimum "optional" mode.
 *   - No parallel classification architecture — this is a pure function over
 *     data that already exists in the WorkBlueprint contract.
 *
 * evidenceMode values:
 *   "required" — evidence retrieval + claim provenance + absence verification
 *   "optional" — evidence may be used but provenance is not mandatory
 *   "none"     — ordinary generation path; no claim integrity overhead
 *
 * Note: "optional" still runs claim validation and provenance if evidence chunks
 * ARE returned by the KRS — it just doesn't fail the execution when they are not.
 * "none" skips all provenance machinery.
 */

import type { WorkBlueprint } from "./workBlueprintService.js";

export type EvidenceMode = "required" | "optional" | "none";

/**
 * Output types that inherently require evidence-grounded findings.
 * These are formally documented deliverables where factual grounding matters.
 */
const EVIDENCE_REQUIRED_OUTPUT_TYPES = new Set([
  "incident_investigation",   // formal investigation report
  "risk_assessment",          // structured risk identification
  "behaviour_support_plan",   // regulated care planning
  "care_plan",                // regulated care planning
  "investigation_report",     // formal investigation output
]);

/**
 * Output types where evidence is useful but not mandatory.
 */
const EVIDENCE_OPTIONAL_OUTPUT_TYPES = new Set([
  "performance_review",       // may cite evidence but not structurally required
  "policy_draft",             // policy creation often needs references
  "action_plan",              // action items may reference findings
  "project_plan",             // project planning may reference data
  "business_proposal",        // proposals may cite evidence
  "operational_procedure",    // procedures may cite standards
]);

/**
 * Classify the evidence mode for a given blueprint.
 *
 * Returns "required" if any of the blueprint's outputTypes are in
 * EVIDENCE_REQUIRED_OUTPUT_TYPES, "optional" if any are in
 * EVIDENCE_OPTIONAL_OUTPUT_TYPES or mandatoryCitations is non-empty,
 * and "none" otherwise.
 */
export function classifyEvidenceMode(blueprint: WorkBlueprint | null): EvidenceMode {
  if (!blueprint) {
    // No blueprint — default to optional so ordinary execution is unaffected
    return "optional";
  }

  const types = blueprint.outputTypes ?? [];
  const citations = blueprint.mandatoryCitations ?? [];

  // Any required output type → required
  if (types.some((t) => EVIDENCE_REQUIRED_OUTPUT_TYPES.has(t))) {
    return "required";
  }

  // Mandatory citations force at least optional
  if (citations.length > 0) {
    return "optional";
  }

  // Optional output types → optional
  if (types.some((t) => EVIDENCE_OPTIONAL_OUTPUT_TYPES.has(t))) {
    return "optional";
  }

  // Simple non-evidence output types (email, brief, meeting notes, customer response)
  return "none";
}

/**
 * Returns true when the evidenceMode warrants running claim provenance.
 * Use this gate to decide whether to call validateClaimBatch + persistProvenanceChain.
 */
export function shouldRunClaimProvenance(
  evidenceMode: EvidenceMode,
  evidencePack: { totalChunks: number } | null,
): boolean {
  if (evidenceMode === "none") return false;
  if (!evidencePack || evidencePack.totalChunks === 0) {
    // optional mode: skip if no evidence (evidence is optional)
    return evidenceMode === "required";
  }
  return true;
}
