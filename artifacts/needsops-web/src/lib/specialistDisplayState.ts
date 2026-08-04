/**
 * specialistDisplayState.ts
 * Task #41 — Coming-Soon Specialists & Provider Status Transparency
 *
 * Defines the SpecialistDisplayState union and a single pure mapping function
 * that takes any specialist-shaped object and returns the correct display state.
 *
 * All UI layers (WorkforcePage, WorkforceBrowser, WorkforceSpecialistDetail)
 * must call getSpecialistDisplayState() instead of branching on raw field values.
 *
 * Precedence order (highest → lowest):
 *   1. archived       — isArchived in catalogue
 *   2. unavailable_for_plan — org doesn't have pack access (isAccessible === false)
 *   3. coming_soon    — comingSoon flag OR executionStatus "coming_soon"
 *   4. dna_pending    — executionStatus "dna_pending" OR dnaStatus "pending_design"
 *   5. deprecated     — executionStatus "deprecated"
 *   6. active         — executionStatus "available" (and none of the above)
 */

export type SpecialistDisplayState =
  | "active"
  | "coming_soon"
  | "dna_pending"
  | "archived"
  | "deprecated"
  | "unavailable_for_plan";

export interface SpecialistDisplayStateInput {
  executionStatus?: string;
  comingSoon?: boolean;
  isArchived?: boolean;
  isAccessible?: boolean;   // false = org's plan doesn't include the pack
  dnaStatus?: string;        // "pending_design" means DNA not yet designed
}

export function getSpecialistDisplayState(s: SpecialistDisplayStateInput): SpecialistDisplayState {
  if (s.isArchived)                                                         return "archived";
  if (s.isAccessible === false)                                             return "unavailable_for_plan";
  if (s.comingSoon || s.executionStatus === "coming_soon")                  return "coming_soon";
  if (s.executionStatus === "dna_pending" || s.dnaStatus === "pending_design") return "dna_pending";
  if (s.executionStatus === "deprecated")                                   return "deprecated";
  return "active";
}

// ─── Display metadata per state ───────────────────────────────────────────────

export interface DisplayStateMeta {
  label:       string;
  cls:         string;          // Tailwind classes for badge
  dot?:        string;          // optional status dot colour
  tooltip:     string;          // user-facing explanation
  canTrain:    boolean;         // show Train / Knowledge button?
  canExecute:  boolean;         // show Dispatch / Run button?
}

export const DISPLAY_STATE_META: Record<SpecialistDisplayState, DisplayStateMeta> = {
  active: {
    label:     "Active",
    cls:       "bg-emerald-900/30 text-emerald-400 border border-emerald-700/30",
    dot:       "bg-emerald-400",
    tooltip:   "This specialist is fully operational and ready to perform work.",
    canTrain:  true,
    canExecute: true,
  },
  coming_soon: {
    label:     "Coming Soon",
    cls:       "bg-amber-900/20 text-amber-400 border border-amber-700/20",
    dot:       "bg-amber-400",
    tooltip:   "This specialist is not yet available. Check back soon.",
    canTrain:  false,
    canExecute: false,
  },
  dna_pending: {
    label:     "In Development",
    cls:       "bg-blue-900/20 text-blue-400 border border-blue-700/20",
    dot:       "bg-blue-400",
    tooltip:   "This specialist's professional profile (DNA) is still being designed and is not yet ready for use.",
    canTrain:  false,
    canExecute: false,
  },
  archived: {
    label:     "Archived",
    cls:       "bg-gray-900/20 text-gray-500 border border-gray-700/20",
    dot:       "bg-gray-600",
    tooltip:   "This specialist has been retired and is no longer available.",
    canTrain:  false,
    canExecute: false,
  },
  deprecated: {
    label:     "Deprecated",
    cls:       "bg-red-900/20 text-red-400 border border-red-700/20",
    dot:       "bg-red-400",
    tooltip:   "This specialist has been replaced by a newer version.",
    canTrain:  false,
    canExecute: false,
  },
  unavailable_for_plan: {
    label:     "Unavailable for your plan",
    cls:       "bg-[#1E3A5F] text-[#64748B] border border-[#1E3A5F]",
    dot:       "bg-[#4A5568]",
    tooltip:   "Your organisation's plan does not include this specialist. Upgrade your pack to access them.",
    canTrain:  false,
    canExecute: false,
  },
};
