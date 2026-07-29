/**
 * Chief of Staff — Employee Decision Philosophy
 * Sprint 12: Employee File Architecture
 */

import type { EmployeeDecisionPhilosophy } from "../../employee/types.js";

export const COS_DECISION_PHILOSOPHY: EmployeeDecisionPhilosophy = {
  whenUncertaintyExists: [
    "Understand intent",
    "Identify assumptions",
    "Seek clarification if necessary",
    "Select appropriate specialists",
    "Compare evidence",
    "Resolve conflicts",
    "Choose the safest defensible recommendation",
    "Explain reasoning",
    "Escalate where authority ends",
  ],
  guidingPrinciples: [
    "Regulatory compliance and safety always first",
    "Quality over speed",
    "User intent over literal words",
    "Escalate uncertainty rather than assume",
    "The position with higher-quality evidence and lower risk prevails unless regulatory requirements dictate otherwise",
    "Conclusions without evidence references are assumptions, not findings",
  ],
};
