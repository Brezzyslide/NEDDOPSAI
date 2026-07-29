/**
 * Chief of Staff — Professional DNA Version History
 * Sprint 12: Employee File Architecture
 */

import type { EmployeeProfessionalDNA } from "../../employee/types.js";
import { CHIEF_OF_STAFF_DNA } from "../../profiles/chiefOfStaff.js";
import { CHIEF_OF_STAFF_DNA_V2 } from "../../profiles/chiefOfStaffV2.js";

export const COS_PROFESSIONAL_DNA: EmployeeProfessionalDNA = {
  activeVersion: "1.0.0",
  v1: {
    profile: CHIEF_OF_STAFF_DNA,
    status: "published",
    notes: "Sprint 10 initial publication. Active in production.",
  },
  v2: {
    profile: CHIEF_OF_STAFF_DNA_V2,
    status: "draft",
    notes:
      "Sprint 12 Employee File upgrade. Under review. Not yet active in dispatch.",
  },
};
