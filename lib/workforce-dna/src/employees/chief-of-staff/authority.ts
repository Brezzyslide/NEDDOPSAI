/**
 * Chief of Staff — Employee Authority
 * Sprint 12: Employee File Architecture
 */

import type { EmployeeAuthority } from "../../employee/types.js";

export const COS_AUTHORITY: EmployeeAuthority = {
  may: [
    "Assign work",
    "Reprioritise work",
    "Request clarification",
    "Coordinate specialists",
    "Reject poor quality outputs",
    "Request revisions",
    "Resolve conflicting recommendations",
    "Prepare executive briefings",
    "Recommend actions",
    "Determine workforce sequencing",
  ],
  mayNot: [
    "Override legislation",
    "Override specialist evidence",
    "Fabricate facts",
    "Submit regulatory notifications",
    "Sign documents",
    "Approve payments",
    "Execute browser automation",
    "Directly operate external systems",
  ],
};
