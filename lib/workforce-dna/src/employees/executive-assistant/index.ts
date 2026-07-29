/**
 * Executive Assistant — Employee File
 * Sprint 13: Executive Assistant Employee File
 *
 * Assembles the complete Employee File for the AI Executive Assistant.
 * This is the source of truth for the Executive Assistant's professional identity.
 *
 * Usage:
 *   import { EXECUTIVE_ASSISTANT_EMPLOYEE_FILE } from "@workspace/workforce-dna";
 */

import type { EmployeeFile, RuntimeManifest } from "../../employee/types.js";
import { compileRuntimeManifest } from "../../employee/index.js";

import { EA_IDENTITY } from "./identity.js";
import { EA_SOUL } from "./soul.js";
import { EA_MISSION } from "./mission.js";
import { EA_VALUES } from "./values.js";
import { EA_PERSONALITY } from "./personality.js";
import { EA_AUTHORITY } from "./authority.js";
import { EA_DECISION_PHILOSOPHY } from "./decision-philosophy.js";
import { EA_COMMUNICATION } from "./communication.js";
import { EA_RESPONSIBILITIES } from "./responsibilities.js";
import { EA_PROFESSIONAL_DNA } from "./professional-dna.js";
import { EA_WORKER_PROFILE } from "./worker-profile.js";

// Re-export DNA v1 and professional oath so tests and consumers can import them from this module
export { EXECUTIVE_ASSISTANT_DNA_V1, EXECUTIVE_ASSISTANT_PROFESSIONAL_OATH } from "../../profiles/executiveAssistant.js";

// ─── Employee File assembly ───────────────────────────────────────────────────

export const EXECUTIVE_ASSISTANT_EMPLOYEE_FILE: EmployeeFile = {
  identity: EA_IDENTITY,
  soul: EA_SOUL,
  mission: EA_MISSION,
  values: EA_VALUES,
  personality: EA_PERSONALITY,
  authority: EA_AUTHORITY,
  decisionPhilosophy: EA_DECISION_PHILOSOPHY,
  communication: EA_COMMUNICATION,
  responsibilities: EA_RESPONSIBILITIES,
  professionalDNA: EA_PROFESSIONAL_DNA,
  workerProfile: EA_WORKER_PROFILE,
  fileVersion: "1.0.0",
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z",
};

// ─── Pre-compiled Runtime Manifest ───────────────────────────────────────────

/**
 * Pre-compiled default Runtime Manifest for the Executive Assistant.
 * Used for fast dispatch when no specific task context is provided.
 * Inject a task context at execution time using compileRuntimeManifest().
 */
export const EXECUTIVE_ASSISTANT_RUNTIME_MANIFEST: RuntimeManifest =
  compileRuntimeManifest(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE, null);

// ─── Section re-exports ───────────────────────────────────────────────────────

export { EA_IDENTITY } from "./identity.js";
export { EA_SOUL } from "./soul.js";
export { EA_MISSION } from "./mission.js";
export { EA_VALUES } from "./values.js";
export { EA_PERSONALITY } from "./personality.js";
export { EA_AUTHORITY } from "./authority.js";
export { EA_DECISION_PHILOSOPHY } from "./decision-philosophy.js";
export { EA_COMMUNICATION } from "./communication.js";
export { EA_RESPONSIBILITIES } from "./responsibilities.js";
export { EA_PROFESSIONAL_DNA } from "./professional-dna.js";
export { EA_WORKER_PROFILE } from "./worker-profile.js";
