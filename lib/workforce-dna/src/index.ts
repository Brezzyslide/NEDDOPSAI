/**
 * @workspace/workforce-dna — Professional DNA Framework
 *
 * Sprint 10: Digital Workforce Intelligence & Execution
 * Sprint 12: Employee File Architecture & Constitution
 * Sprint 13: Executive Assistant Employee File
 *
 * This package contains the intellectual property core of NeedsOps AI+.
 * Every specialist's professional identity, reasoning methodology,
 * evidence standards, and operational boundaries are defined here.
 *
 * Architecture position:
 *   NeedsOps Constitution
 *           ↓
 *   Employee File
 *           ↓
 *   Professional DNA
 *           ↓
 *   Worker Profile
 *           ↓
 *   Runtime Manifest
 *           ↓
 *   Execution Runtime
 *
 * Usage:
 *   import { getDNAProfile, buildDNASystemInstruction } from "@workspace/workforce-dna";
 *   import { CHIEF_OF_STAFF_EMPLOYEE_FILE, getEmployeeFile } from "@workspace/workforce-dna";
 *
 *   const profile = getDNAProfile("compliance_officer");
 *   const systemInstruction = buildDNASystemInstruction("compliance_officer");
 *   const versions = captureSpecialistRunVersions("compliance_officer", "gpt-4o");
 *
 *   const file = getEmployeeFile("chief_of_staff");
 *   const fullInstruction = buildSystemInstructionForEmployee("chief_of_staff");
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

export type {
  SpecialistKind,
  SeniorityLevel,
  DnaOwnerType,
  DnaVisibilityTier,
  CanonicalDnaStatus,
  RuntimeProjectionClassification,
  RuntimeProjectionRule,
  WorkforceDNAIdentity,
  WorkforceDNAProfessionalMission,
  WorkforceDNADomainExpertise,
  WorkforceDNAProfessionalPractice,
  WorkforceDNAReasoningModel,
  WorkforceDNAEvidenceModel,
  WorkforceDNABoundaryModel,
  WorkforceDNARiskAndUncertaintyModel,
  WorkforceDNACollaborationModel,
  WorkforceDNACommunicationModel,
  WorkforceDNAMemoryBehaviour,
  WorkforceDNARegulatoryAwareness,
  WorkforceDNAOrganisationContextUse,
  WorkforceDNABlueprintInteraction,
  WorkforceDNAGovernance,
  WorkforceDNARuntimeProjection,
  WorkforceDNAVersioning,
  RequiredWorkerProfileReference,
  WorkforceDNA,
  SafeWorkforceDNADescriptor,
} from "./canonical.js";

export {
  CANONICAL_DNA_PROJECTION_VERSION,
  CANONICAL_DNA_PROJECTION_RULES,
  computeWorkforceDNAHash,
  mapLegacyDNAProfileToWorkforceDNA,
  buildSafeWorkforceDNADescriptor,
} from "./canonical.js";

// ─── Constitution ─────────────────────────────────────────────────────────────
export {
  NEEDSOPS_CONSTITUTION,
  CONSTITUTION_VERSION,
  CONSTITUTION_PUBLISHED_AT,
  CONSTITUTION_PUBLISHED_BY,
  getConstitutionStatements,
  getConstitutionalPrinciple,
  buildConstitutionPreamble,
  validateConstitutionInheritance,
} from "./constitution.js";
export type { ConstitutionalPrinciple } from "./constitution.js";

// ─── Employee File types ──────────────────────────────────────────────────────
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
  EmployeeResourceRequirements,
  ResourceRequirementItem,
  PermittedResourceType,
  ResourceSensitivity,
} from "./employee/types.js";

// ─── Employee File utilities ──────────────────────────────────────────────────
export {
  compileRuntimeManifest,
  buildEmployeeSystemInstruction,
  validateEmployeeFile,
  getRuntimeManifestSections,
  getSensitiveEmployeeFileSections,
} from "./employee/index.js";

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
  getCanonicalDNAProfile,
  getSafeDNADescriptor,
  getActivatedRoleCodes,
  getDNASummary,
  // Sprint 12 additions
  EMPLOYEE_FILE_REGISTRY,
  getEmployeeFile,
  buildSystemInstructionForEmployee,
  CHIEF_OF_STAFF_EMPLOYEE_FILE,
  // Sprint 13 additions
  EXECUTIVE_ASSISTANT_EMPLOYEE_FILE,
} from "./registry.js";

// ─── Profiles (direct access — prefer registry for runtime use) ────────────────
export { CHIEF_OF_STAFF_DNA } from "./profiles/chiefOfStaff.js";
export { AUTHORISED_PROGRAM_OFFICER_DNA } from "./profiles/authorisedProgramOfficer.js";
export { COMPLIANCE_OFFICER_DNA } from "./profiles/complianceOfficer.js";
export { COMPLIANCE_QUALITY_MANAGER_DNA } from "./profiles/complianceQualityManager.js";
export { INCIDENT_SAFEGUARDING_SPECIALIST_DNA } from "./profiles/incidentSafeguardingSpecialist.js";
export { OPERATIONS_MANAGER_DNA } from "./profiles/operationsManager.js";
export { DOCUMENT_SPECIALIST_DNA } from "./profiles/documentSpecialist.js";
export { CHIEF_OF_STAFF_DNA_V2 } from "./profiles/chiefOfStaffV2.js";
export { EXECUTIVE_ASSISTANT_DNA_V1 } from "./profiles/executiveAssistant.js";

// ─── Runtime Manifests ─────────────────────────────────────────────────────────
export { EXECUTIVE_ASSISTANT_RUNTIME_MANIFEST } from "./employees/executive-assistant/index.js";
