/**
 * @workspace/workforce-dna — Professional DNA Framework
 *
 * Sprint 10: Digital Workforce Intelligence & Execution
 *
 * This package contains the intellectual property core of NeedsOps AI+.
 * Every specialist's professional identity, reasoning methodology,
 * evidence standards, and operational boundaries are defined here.
 *
 * Architecture position:
 *   Conversation → Chief of Staff → Professional DNA → Worker Profile
 *       → Specialist Run → Professional Reasoning → Work Package
 *       → Execution Queue → (OpenClaw later)
 *
 * Usage:
 *   import { getDNAProfile, buildDNASystemInstruction } from "@workspace/workforce-dna";
 *
 *   const profile = getDNAProfile("compliance_officer");
 *   const systemInstruction = buildDNASystemInstruction("compliance_officer");
 *   const versions = captureSpecialistRunVersions("compliance_officer", "gpt-4o");
 */

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  DNAProfile,
  DNAIdentity,
  DNAMission,
  DNAPhilosophy,
  DNACompetency,
  DNAReasoningMethodology,
  ReasoningStep,
  ReasoningStepType,
  DecisionCriteria,
  DNAEvidenceStandards,
  EvidenceStandard,
  DNARiskTolerance,
  RiskAppetite,
  DNAEscalationFramework,
  EscalationRule,
  DNAProfessionalBoundaries,
  DNACommunicationStyle,
  ToneOfVoice,
  PreferredOutput,
  OutputType,
  DNAMemoryPolicy,
  DNALearningPolicy,
  DNACapabilityConfig,
  DNAConfidenceModel,
  DNAConflictPolicy,
  DNAOutputSchema,
  RequiredWorkerProfile,
  DNAVersion,
  RunVersionRecord,
} from "./types.js";

export { captureRunVersions } from "./types.js";

// ─── Registry ─────────────────────────────────────────────────────────────────
export {
  getDNAProfile,
  getAllActiveDNAProfiles,
  hasActiveDNA,
  getDNAVersion,
  getReasoningVersion,
  getOutputSchemaVersion,
  captureSpecialistRunVersions,
  buildDNASystemInstruction,
  getActivatedRoleCodes,
  getDNASummary,
} from "./registry.js";

// ─── Profiles (direct access — prefer registry for runtime use) ────────────────
export { CHIEF_OF_STAFF_DNA } from "./profiles/chiefOfStaff.js";
export { COMPLIANCE_OFFICER_DNA } from "./profiles/complianceOfficer.js";
export { OPERATIONS_MANAGER_DNA } from "./profiles/operationsManager.js";
export { DOCUMENT_SPECIALIST_DNA } from "./profiles/documentSpecialist.js";
