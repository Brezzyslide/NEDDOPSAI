/**
 * Employee File Architecture — Sprint 12
 *
 * Canonical type system for the NeedsOps AI Employee File.
 *
 * Every AI Employee in NeedsOps is defined by an Employee File.
 * The Employee File is the complete professional identity of the employee.
 * It compiles into a lightweight Runtime Manifest for execution.
 *
 * Architecture:
 *
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
 */

import type { DNAProfile } from "../types.js";

// ─── Identity ─────────────────────────────────────────────────────────────────

export type EmploymentType =
  | "permanent_executive"
  | "permanent_specialist"
  | "permanent_coordinator"
  | "specialist_contract"
  | "project_assignment";

export interface EmployeeIdentity {
  /** Canonical workforce role code — must match workforceRegistry */
  roleCode: string;
  /** Full professional title, e.g. "AI Chief of Staff" */
  title: string;
  /** Department name, e.g. "Executive" */
  department: string;
  /** Department code, matching workforceRegistry departmentCode */
  departmentCode: string;
  /** Who or what this employee reports to */
  reportsTo: string;
  /** Who or what reports to this employee */
  directReports: string;
  /** Employment classification */
  employmentType: EmploymentType;
  /** One-sentence purpose statement — why this employee exists */
  purpose: string;
  /** The Workforce Pack this employee belongs to */
  packCode: string;
}

// ─── Soul ─────────────────────────────────────────────────────────────────────

/**
 * Soul defines enduring character — not personality.
 * Soul traits are fundamental and rarely change.
 * They represent what the employee IS, not just how they behave.
 */
export interface EmployeeSoul {
  /** Enduring character traits. Should be 8–12 traits. */
  traits: string[];
  /** Soul version — increment only when a fundamental trait changes (rare) */
  version: string;
  /** When this soul definition was last updated */
  updatedAt: string;
}

// ─── Mission ──────────────────────────────────────────────────────────────────

export interface EmployeeMission {
  /** One-sentence professional mission */
  mission: string;
  /** Operational purpose — how the mission is fulfilled */
  purpose: string;
  /** 3–7 core objectives that define success */
  objectives: string[];
}

// ─── Values ───────────────────────────────────────────────────────────────────

export interface EmployeeValues {
  /**
   * Must always be true.
   * The Constitution is inherited by every Employee File without exception.
   */
  readonly constitutionInherited: true;
  /** The version of the Constitution this Employee File was designed against */
  constitutionVersion: string;
  /** Role-specific professional values, in addition to the Constitution */
  roleSpecificValues: string[];
}

// ─── Personality ─────────────────────────────────────────────────────────────

export interface EmployeePersonality {
  /** Positive personality traits — how the employee presents and behaves */
  traits: string[];
  /** Behaviours and patterns to actively avoid */
  avoid: string[];
}

// ─── Authority ────────────────────────────────────────────────────────────────

export interface EmployeeAuthority {
  /** Actions this employee is explicitly authorised to take */
  may: string[];
  /** Actions this employee is explicitly prohibited from taking */
  mayNot: string[];
}

// ─── Decision Philosophy ──────────────────────────────────────────────────────

export interface EmployeeDecisionPhilosophy {
  /**
   * Ordered steps to follow when uncertainty exists.
   * These are non-negotiable — they must never be skipped.
   */
  whenUncertaintyExists: string[];
  /**
   * Additional guiding principles for all decisions.
   * Supplements the uncertainty steps.
   */
  guidingPrinciples: string[];
}

// ─── Communication Style ──────────────────────────────────────────────────────

export interface EmployeeCommunicationStyle {
  /** Communication characteristics */
  characteristics: string[];
  /**
   * What the employee must always clearly distinguish in its outputs.
   * e.g. evidence vs assumptions vs recommendations vs risks
   */
  distinguish: string[];
  /** Never exaggerate certainty — this is always true */
  readonly neverExaggerateCertainty: true;
  /** Plain English preference — avoid jargon unless necessary */
  plainEnglish: boolean;
}

// ─── Responsibilities ─────────────────────────────────────────────────────────

export interface EmployeeResponsibilities {
  /** Core professional responsibilities */
  responsibilities: string[];
}

// ─── Professional DNA ─────────────────────────────────────────────────────────

export type DNAVersionStatus = "published" | "draft" | "archived";

export interface EmployeeDNAVersion {
  profile: DNAProfile;
  status: DNAVersionStatus;
  notes: string;
}

export interface EmployeeProfessionalDNA {
  /** The currently active published DNA version */
  activeVersion: string;
  /** The published v1 profile — historical runs remain reproducible using this */
  v1: EmployeeDNAVersion;
  /** Draft v2 profile if created — not yet active in dispatch */
  v2?: EmployeeDNAVersion;
}

// ─── Worker Profile (Expanded) ────────────────────────────────────────────────

export type RoleLevel =
  | "executive"
  | "principal"
  | "senior"
  | "specialist"
  | "coordinator"
  | "support";

export type AuthorityLevel =
  | "executive"      // highest — can coordinate all employees
  | "principal"      // senior specialist authority
  | "senior"         // experienced specialist authority
  | "intermediate"   // standard professional authority
  | "junior";        // supervised authority

export interface ExpandedWorkerProfile {
  profileCode: string;
  reportingLine: string;
  department: string;
  departmentCode: string;
  employmentStatus: string;
  roleLevel: RoleLevel;
  authorityLevel: AuthorityLevel;
  /** Capability codes this employee can be assigned */
  availableCapabilities: string[];
  /** Specific capability limitations (what this employee will not do even if technically capable) */
  capabilityLimits: string[];
  /** Execution permission codes */
  executionPermissions: string[];
  /** Connector permission codes — what external connectors may be used */
  connectorPermissions: string[];
  /** Memory permission codes — what memory categories may be read/written */
  memoryPermissions: string[];
  /** Delegation permission codes — what the employee may delegate and to whom */
  delegationPermissions: string[];
  /** Approval requirements for actions */
  approvalRequirements: string;
  /** Escalation pathways — who receives escalations and under what conditions */
  escalationPathways: string[];
  /** Performance objectives for this employee */
  performanceObjectives: string[];
  /** Profile version */
  version: string;
  /** When this profile was last updated */
  updatedAt: string;
}

// ─── Runtime Manifest ─────────────────────────────────────────────────────────

/**
 * Lightweight runtime representation of an Employee File.
 *
 * The Runtime Manifest is the ONLY thing sent to OpenClaw / the execution runtime.
 * It excludes sensitive Employee File sections (soul, full personality, full values, etc.)
 * and contains only what is needed for a single task execution.
 *
 * Compile with: compileRuntimeManifest(employeeFile, taskContext)
 */
export interface RuntimeManifest {
  // ── Employee identity ────────────────────────────────────────────────────
  employeeId: string;           // roleCode
  title: string;
  department: string;
  dnaVersion: string;           // active DNA version
  workerProfileVersion: string;
  constitutionVersion: string;  // must always be present

  // ── Current task (injected at execution time) ────────────────────────────
  currentTask: {
    taskId: string;
    capabilityCode: string;
    conversationContext: string;
    organisationalContext: string;
  } | null;

  // ── Active capabilities ──────────────────────────────────────────────────
  activeCapabilities: string[];

  // ── Runtime permissions ──────────────────────────────────────────────────
  runtimePermissions: {
    execution: string[];
    connectors: string[];
    memory: string[];
    delegation: string[];
  };

  // ── Execution boundaries ─────────────────────────────────────────────────
  executionBoundaries: {
    canDo: string[];
    cannotDo: string[];
    requiresApproval: string[];
    hardStops: string[];
  };

  // ── Security constraints ─────────────────────────────────────────────────
  securityConstraints: string[];

  // ── Constitution (abbreviated) ───────────────────────────────────────────
  constitutionStatements: string[];

  // ── Metadata ─────────────────────────────────────────────────────────────
  compiledAt: string;
}

/**
 * Task context injected when compiling a Runtime Manifest for a specific execution.
 */
export interface RuntimeTaskContext {
  taskId: string;
  capabilityCode: string;
  conversationContext: string;
  organisationalContext: string;
}

// ─── Organisation Resource Requirements ──────────────────────────────────────

/**
 * Permitted resource types for an AI Employee.
 * Employees may only access resource types listed here.
 */
export type PermittedResourceType =
  | "document_library"
  | "document_file"
  | "calendar"
  | "email"
  | "contacts"
  | "task_management"
  | "reporting"
  | "forms"
  | "browser_application"
  | "api_service"
  | "database_view"
  | "communication_channel";

/**
 * Resource sensitivity classification.
 */
export type ResourceSensitivity =
  | "public"
  | "organisational"
  | "restricted"
  | "confidential"
  | "highly_confidential";

/**
 * A single resource requirement entry for an AI Employee.
 */
export interface ResourceRequirementItem {
  /** Human-readable name of the required resource (e.g. "Organisational Policies") */
  resourceName: string;
  /** Logical resource type — must not reference a specific vendor or technology */
  resourceType: PermittedResourceType;
  /** Operations this employee requires on this resource */
  requiredPermissions: Array<"read" | "write" | "search" | "create" | "delete" | "metadata">;
  /** Sensitivity classification of this resource */
  sensitivity: ResourceSensitivity;
  /** Whether approval is required before accessing this resource */
  approvalRequired: boolean;
  /** Description of how this resource is used */
  purpose: string;
}

/**
 * Mandatory Resource Requirements section for an AI Employee File.
 *
 * Every Employee File must declare which organisational resources it requires.
 * Employees must not assume physical storage locations or vendor implementations.
 * All resource access occurs through the Organisation Resource Registry and Resource Manager.
 *
 * Platform rule: No Employee File may reference storage technologies or execution
 * runtimes directly (SharePoint, Google Drive, Chrome, OpenClaw, URLs, folder paths).
 */
export interface EmployeeResourceRequirements {
  /**
   * Resources this employee requires to perform its work.
   * Described abstractly — vendor implementations resolved by the Resource Manager.
   */
  requiredResources: ResourceRequirementItem[];
  /**
   * Resource types this employee is permitted to access.
   * Access to other types must be explicitly added.
   */
  permittedResourceTypes: PermittedResourceType[];
  /**
   * Whether this employee may initiate browser automation through the Browser Connector.
   */
  browserAutomationPermitted: boolean;
  /**
   * Source-of-truth behaviour: the employee must treat registered resources as
   * the authoritative source and must not duplicate them in organisation memory.
   */
  sourceOfTruthBehaviour: string;
  /**
   * How this employee discovers resources it does not know about.
   * e.g. "Request through Resource Manager with resource type and purpose"
   */
  resourceDiscoveryRule: string;
  /** Version of this Resource Requirements section */
  version: string;
}

// ─── Employee File (master assembly) ─────────────────────────────────────────

/**
 * The complete Employee File for an AI professional.
 *
 * Contains every section of the employee's professional identity.
 * This is the source of truth — it compiles into a Runtime Manifest for execution.
 *
 * The Employee File is never sent directly to the execution runtime.
 * Only the Runtime Manifest is.
 */
export interface EmployeeFile {
  // Core identity
  identity: EmployeeIdentity;
  // Enduring character
  soul: EmployeeSoul;
  // Mission and purpose
  mission: EmployeeMission;
  // Values (Constitution inherited + role-specific)
  values: EmployeeValues;
  // Personality and behaviour
  personality: EmployeePersonality;
  // Authority boundaries
  authority: EmployeeAuthority;
  // Decision-making philosophy
  decisionPhilosophy: EmployeeDecisionPhilosophy;
  // Communication style
  communication: EmployeeCommunicationStyle;
  // Professional responsibilities
  responsibilities: EmployeeResponsibilities;
  // DNA profile links (v1 + optional v2 draft)
  professionalDNA: EmployeeProfessionalDNA;
  // Expanded worker profile
  workerProfile: ExpandedWorkerProfile;
  /**
   * Organisation Resource Requirements — MANDATORY.
   * Declares which organisational resources this employee requires.
   * Employee Files without this section fail validation.
   * No physical storage locations, vendor names, or URLs may appear here.
   */
  resourceRequirements?: EmployeeResourceRequirements;
  // File metadata
  fileVersion: string;
  createdAt: string;
  updatedAt: string;
}
