/**
 * Chief of Staff — Employee File
 * Sprint 12: Employee File Architecture
 *
 * Assembles the complete Employee File for the AI Chief of Staff.
 * This is the source of truth for the Chief of Staff's professional identity.
 *
 * Usage:
 *   import { CHIEF_OF_STAFF_EMPLOYEE_FILE } from "@workspace/workforce-dna";
 */

import type { EmployeeFile, RuntimeManifest } from "../../employee/types.js";
import { compileRuntimeManifest } from "../../employee/index.js";

import { COS_IDENTITY } from "./identity.js";
import { COS_SOUL } from "./soul.js";
import { COS_MISSION } from "./mission.js";
import { COS_VALUES } from "./values.js";
import { COS_PERSONALITY } from "./personality.js";
import { COS_AUTHORITY } from "./authority.js";
import { COS_DECISION_PHILOSOPHY } from "./decision-philosophy.js";
import { COS_COMMUNICATION } from "./communication.js";
import { COS_RESPONSIBILITIES } from "./responsibilities.js";
import { COS_PROFESSIONAL_DNA } from "./professional-dna.js";
import { COS_WORKER_PROFILE } from "./worker-profile.js";
import { COS_RESOURCE_REQUIREMENTS } from "./resource-requirements.js";

// Re-export DNA v2 so tests and consumers can import it from this module
export { CHIEF_OF_STAFF_DNA_V2 } from "../../profiles/chiefOfStaffV2.js";

// ─── Employee File assembly ───────────────────────────────────────────────────

export const CHIEF_OF_STAFF_EMPLOYEE_FILE: EmployeeFile = {
  identity: COS_IDENTITY,
  soul: COS_SOUL,
  mission: COS_MISSION,
  values: COS_VALUES,
  personality: COS_PERSONALITY,
  authority: COS_AUTHORITY,
  decisionPhilosophy: COS_DECISION_PHILOSOPHY,
  communication: COS_COMMUNICATION,
  responsibilities: COS_RESPONSIBILITIES,
  professionalDNA: COS_PROFESSIONAL_DNA,
  workerProfile: COS_WORKER_PROFILE,
  resourceRequirements: COS_RESOURCE_REQUIREMENTS,
  fileVersion: "1.0.0",
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z",
};

// ─── Pre-compiled Runtime Manifest ───────────────────────────────────────────

/**
 * Pre-compiled default Runtime Manifest for the Chief of Staff.
 * Used for fast dispatch when no specific task context is provided.
 * Inject a task context at execution time using compileRuntimeManifest().
 */
export const CHIEF_OF_STAFF_RUNTIME_MANIFEST: RuntimeManifest =
  compileRuntimeManifest(CHIEF_OF_STAFF_EMPLOYEE_FILE, null);

// ─── Section re-exports ───────────────────────────────────────────────────────

export { COS_IDENTITY } from "./identity.js";
export { COS_SOUL } from "./soul.js";
export { COS_MISSION } from "./mission.js";
export { COS_VALUES } from "./values.js";
export { COS_PERSONALITY } from "./personality.js";
export { COS_AUTHORITY } from "./authority.js";
export { COS_DECISION_PHILOSOPHY } from "./decision-philosophy.js";
export { COS_COMMUNICATION } from "./communication.js";
export { COS_RESPONSIBILITIES } from "./responsibilities.js";
export { COS_PROFESSIONAL_DNA } from "./professional-dna.js";
export { COS_WORKER_PROFILE } from "./worker-profile.js";
export { COS_RESOURCE_REQUIREMENTS } from "./resource-requirements.js";
