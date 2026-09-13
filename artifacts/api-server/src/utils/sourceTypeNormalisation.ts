/**
 * Source-type normalisation — Sprint 27.5
 *
 * Single authoritative mapping from raw sourceType strings to canonical values,
 * human-readable display labels, and trusted-provider classification.
 *
 * Rules:
 *  - Canonical types are stable lower-case snake_case identifiers.
 *  - Aliases only where professional meaning is genuinely identical.
 *  - Distinct requirements (risk_assessment vs policy) are never aliased.
 *  - Trusted-provider types are sourced by the platform, not uploaded by orgs.
 *  - Raw type codes must never appear in user-facing messages.
 */

// ── Canonical type → human-readable display label ─────────────────────────────

export const SOURCE_TYPE_DISPLAY_LABELS: Record<string, string> = {
  policy:                 "Organisation Policy",
  legislation:            "Legislation",
  standards:              "Standards & Guidelines",
  procedure:              "Organisation Procedure",
  risk_assessment:        "Risk Assessment",
  template:               "Organisation Template",
  participant_document:   "Participant Document",
  task_upload:            "Uploaded Document",
  reference:              "Reference Material",
  communication_guide:    "Communication Guide",
  style_guide:            "Style Guide",
  behaviour_support_plan: "Behaviour Support Plan",
  care_plan:              "Care Plan",
  investigation_report:   "Investigation Report",
  ndis_practice_standards:"NDIS Practice Standards",
  commission_guidance:    "Regulatory Guidance",
  fair_work:              "Fair Work Instrument",
  government_publication: "Government Publication",
};

export const DOCUMENT_CATEGORY_DISPLAY_LABELS: Record<string, string> = {
  care_plan:                            "Care Plan",
  health_support_plan:                  "Health Support Plan",
  behaviour_support_plan:               "Behaviour Support Plan",
  risk_assessment:                      "Risk Assessment",
  restrictive_practice_authorisation:   "Restrictive Practice Authorisation",
  participant_document:                 "Participant Document",
  ndis_plan:                            "NDIS Plan",
  strengths_based_questionnaire:        "Strengths-Based Questionnaire",
  intake_form:                          "Intake Form",
  service_agreement:                    "Service Agreement",
  mealtime_management_risk_assessment:  "Mealtime Management Risk Assessment",
  allied_health_report:                 "Allied Health Report",
  home_safety_checklist:                "Home Safety Checklist",
  other_participant_document:           "Other Participant Document",
};

const DOCUMENT_CATEGORY_ALIASES: Record<string, string> = {
  cbsp: "behaviour_support_plan",
  bps: "behaviour_support_plan",
  behaviour_plan: "behaviour_support_plan",
  behavior_support_plan: "behaviour_support_plan",
  behaviour_support: "behaviour_support_plan",
  fire_risk_assessment: "risk_assessment",
  home_safety: "home_safety_checklist",
  intake: "intake_form",
  rp_authorisation: "restrictive_practice_authorisation",
  restrictive_practice_authorization: "restrictive_practice_authorisation",
};

// ── Raw alias → canonical type ────────────────────────────────────────────────
// Only alias where the professional requirement is genuinely the same.
// Do not alias across distinct professional requirements.

const ALIAS_MAP: Record<string, string> = {
  // Policy family — all represent an organisation's governing policy document
  risk_policy:              "policy",
  risk_management_policy:   "policy",
  organisation_policy:      "policy",
  related_policy:           "policy",

  // Legislation family — all represent statutory/regulatory instruments
  legislation_reference:    "legislation",

  // NDIS Practice Standards — trusted-provider source, keep distinct from generic "standards"
  ndis_standards:           "ndis_practice_standards",

  // Participant documents — various names for the same participant-context requirement
  support_plan:             "participant_document",
  participant_care_plan:    "participant_document",
  // Note: care_plan and behaviour_support_plan are kept as their own canonical types
  // because blueprints may require them as distinct evidence categories.
};

/**
 * Normalise a raw sourceType string to its canonical form.
 * Returns "reference" for null/empty inputs.
 */
export function canonicaliseSourceType(raw: string | null | undefined): string {
  if (!raw) return "reference";
  const lower = raw.toLowerCase().trim();
  return ALIAS_MAP[lower] ?? lower;
}

/**
 * Return a human-readable display label for a canonical source type.
 * Never returns a raw type code — always produces a readable label.
 */
export function sourceTypeDisplayLabel(canonical: string): string {
  const label = SOURCE_TYPE_DISPLAY_LABELS[canonical];
  if (label) return label;
  // Fallback: title-case the code for any unlisted type
  return canonical
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

export function canonicaliseDocumentCategory(raw: string | null | undefined): string {
  if (!raw) return "";
  const lower = raw.toLowerCase().trim();
  return DOCUMENT_CATEGORY_ALIASES[lower] ?? lower;
}

export function documentCategoryDisplayLabel(canonical: string): string {
  const normalised = canonicaliseDocumentCategory(canonical);
  return DOCUMENT_CATEGORY_DISPLAY_LABELS[normalised] ?? sourceTypeDisplayLabel(normalised);
}

export function isKnownDocumentCategory(raw: string | null | undefined): boolean {
  const canonical = canonicaliseDocumentCategory(raw);
  return Object.prototype.hasOwnProperty.call(DOCUMENT_CATEGORY_DISPLAY_LABELS, canonical);
}

// ── Trusted-provider source types ─────────────────────────────────────────────
//
// These are provided by the platform's Trusted Intelligence layer, not uploaded
// by organisations. Examples: government legislation, NDIS Practice Standards,
// Commission guidance. Users must not be asked to upload these.
//
// Where platform retrieval is not yet implemented for a type, the system
// surfaces a "platform limitation" notice rather than asking the user to
// upload government text.

// Only canonical types are listed here. Raw aliases (legislation_reference,
// ndis_standards) must be normalised via canonicaliseSourceType() before calling
// isTrustedProviderSource(). The function is not designed for raw input.
const TRUSTED_PROVIDER_TYPES: ReadonlySet<string> = new Set([
  "legislation",
  "ndis_practice_standards",
  "commission_guidance",
  "fair_work",
  "government_publication",
]);

/**
 * Returns true when the canonical type is a trusted-provider source.
 * Organisations must not be asked to upload these document categories.
 */
export function isTrustedProviderSource(canonicalType: string): boolean {
  return TRUSTED_PROVIDER_TYPES.has(canonicalType);
}

/**
 * Convenience wrapper that normalises before checking trusted-provider status.
 */
export function isTrustedProviderSourceRaw(rawType: string): boolean {
  return isTrustedProviderSource(canonicaliseSourceType(rawType));
}
