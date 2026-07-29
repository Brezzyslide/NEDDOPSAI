/**
 * Executive Assistant — Professional DNA Version History
 * Sprint 13: Executive Assistant Employee File
 */

import type { EmployeeProfessionalDNA } from "../../employee/types.js";
import { EXECUTIVE_ASSISTANT_DNA_V1 } from "../../profiles/executiveAssistant.js";

export const EA_PROFESSIONAL_DNA: EmployeeProfessionalDNA = {
  activeVersion: "none",
  v1: {
    profile: EXECUTIVE_ASSISTANT_DNA_V1,
    status: "draft",
    notes: "Sprint 13 initial design. Under review. Not yet active in dispatch.",
  },
};
