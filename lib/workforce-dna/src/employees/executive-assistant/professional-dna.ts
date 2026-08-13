/**
 * Executive Assistant — Professional DNA Version History
 * Sprint 13: Executive Assistant Employee File
 */

import type { EmployeeProfessionalDNA } from "../../employee/types.js";
import { EXECUTIVE_ASSISTANT_DNA_V1 } from "../../profiles/executiveAssistant.js";

export const EA_PROFESSIONAL_DNA: EmployeeProfessionalDNA = {
  activeVersion: "1.0.0",
  v1: {
    profile: EXECUTIVE_ASSISTANT_DNA_V1,
    status: "published",
    notes:
      "Current v2 Executive Assistant professional source. Canonical WorkforceDNA/SRM is authoritative for task-runtime behaviour; Employee File remains presentation and legacy compatibility metadata.",
  },
};
