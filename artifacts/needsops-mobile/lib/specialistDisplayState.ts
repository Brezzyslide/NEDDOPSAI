/**
 * specialistDisplayState.ts — Mobile
 *
 * Mirrors artifacts/needsops-web/src/lib/specialistDisplayState.ts.
 *
 * Precedence order (highest → lowest):
 *   1. archived              — isArchived in catalogue
 *   2. unavailable_for_plan  — org doesn't have pack access (isAccessible === false)
 *   3. coming_soon           — comingSoon flag OR executionStatus "coming_soon"
 *   4. dna_pending           — executionStatus "dna_pending" OR dnaStatus "pending_design"
 *   5. deprecated            — executionStatus "deprecated"
 *   6. active                — executionStatus "available" (and none of the above)
 */

export type SpecialistDisplayState =
  | 'active'
  | 'coming_soon'
  | 'dna_pending'
  | 'archived'
  | 'deprecated'
  | 'unavailable_for_plan';

export interface SpecialistDisplayStateInput {
  executionStatus?: string;
  comingSoon?: boolean;
  isArchived?: boolean;
  isAccessible?: boolean; // false = org's plan doesn't include the pack
  dnaStatus?: string;     // "pending_design" means DNA not yet designed
}

export function getSpecialistDisplayState(
  s: SpecialistDisplayStateInput,
): SpecialistDisplayState {
  if (s.isArchived)                                                          return 'archived';
  if (s.isAccessible === false)                                              return 'unavailable_for_plan';
  if (s.comingSoon || s.executionStatus === 'coming_soon')                   return 'coming_soon';
  if (s.executionStatus === 'dna_pending' || s.dnaStatus === 'pending_design') return 'dna_pending';
  if (s.executionStatus === 'deprecated')                                    return 'deprecated';
  return 'active';
}

// ─── Display metadata per state ───────────────────────────────────────────────

export interface DisplayStateMeta {
  label:      string;
  color:      string;  // hex accent colour
  dot?:       boolean; // show a status dot
  tooltip:    string;  // user-facing explanation
  canExecute: boolean; // can the user start a conversation/dispatch?
}

export const DISPLAY_STATE_META: Record<SpecialistDisplayState, DisplayStateMeta> = {
  active: {
    label:      'Active',
    color:      '#10b981',
    dot:        true,
    tooltip:    'This specialist is fully operational and ready to perform work.',
    canExecute: true,
  },
  coming_soon: {
    label:      'Coming Soon',
    color:      '#f59e0b',
    tooltip:    'This specialist is not yet available. Check back soon.',
    canExecute: false,
  },
  dna_pending: {
    label:      'In Development',
    color:      '#3b82f6',
    tooltip:    "This specialist's professional profile (DNA) is still being designed and is not yet ready for use.",
    canExecute: false,
  },
  archived: {
    label:      'Archived',
    color:      '#6b7896',
    tooltip:    'This specialist has been retired and is no longer available.',
    canExecute: false,
  },
  deprecated: {
    label:      'Deprecated',
    color:      '#ef4444',
    tooltip:    'This specialist has been replaced by a newer version.',
    canExecute: false,
  },
  unavailable_for_plan: {
    label:      'Not in your plan',
    color:      '#4A5568',
    tooltip:    "Your organisation's plan does not include this specialist. Upgrade your pack to access them.",
    canExecute: false,
  },
};
