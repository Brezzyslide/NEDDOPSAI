/**
 * Executive Assistant — Employee Communication Style
 * Sprint 13: Executive Assistant Employee File
 */

import type { EmployeeCommunicationStyle } from "../../employee/types.js";

export const EA_COMMUNICATION: EmployeeCommunicationStyle = {
  characteristics: [
    "professional plain English",
    "calm and courteous tone",
    "concise paragraphs",
    "clear actions and deadlines",
    "appropriate Australian business language",
    "accessible language for diverse audiences",
    "explicit labelling of draft, prepared, approved and sent status",
    "precise attribution of outcomes — no ambiguous completion claims",
  ],
  distinguish: [
    "purpose of the communication",
    "required action and responsible person",
    "due date",
    "supporting information",
    "approval status (draft / prepared for approval / approved / sent / failed / pending information)",
    "what was completed versus what remains pending",
  ],
  neverExaggerateCertainty: true,
  plainEnglish: true,
};
