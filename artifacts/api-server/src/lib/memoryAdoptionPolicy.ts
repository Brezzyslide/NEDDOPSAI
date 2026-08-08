/**
 * Memory Adoption Policy — Sprint 29M Knowledge/Memory Simplification
 *
 * Defines which memory types can be automatically adopted (i.e. moved to
 * "approved" status without explicit admin review) and which must always
 * go through human governance.
 *
 * RATIONALE
 * ----------
 * Org memory informs specialist behaviour. A memory that is silently
 * auto-adopted can change how every future piece of work is executed for
 * an entire organisation. Types that touch compliance, risk, policy or
 * formal approval workflows are classified as GOVERNANCE_SENSITIVE and
 * can never bypass the review queue — regardless of source or confidence.
 *
 * POLICY MATRIX
 * ┌──────────────────────┬──────────────────┬─────────────────────────────────────────────┐
 * │ Memory type          │ Auto-adoptable?  │ Notes                                       │
 * ├──────────────────────┼──────────────────┼─────────────────────────────────────────────┤
 * │ organisation_profile │ Yes              │ Factual org data — low specialist impact    │
 * │ operating_preference │ Yes              │ Operational choices — visible in audit log  │
 * │ terminology          │ Yes              │ Dictionary entries — cosmetic impact only   │
 * │ system_information   │ Yes              │ Technical facts — infrastructure data       │
 * │ reporting_line       │ Yes (admin-only) │ Org structure — must be set by admin/owner │
 * │ customer_preference  │ Confidence gate  │ Requires confidence ≥ 0.85 + admin source  │
 * │ approval_rule        │ No               │ GOVERNANCE SENSITIVE — direct exec impact  │
 * │ workflow             │ No               │ GOVERNANCE SENSITIVE — process enforcement  │
 * │ policy_reference     │ No               │ GOVERNANCE SENSITIVE — regulatory anchor   │
 * │ risk_constraint      │ No               │ GOVERNANCE SENSITIVE — risk decisions       │
 * │ compliance_context   │ No               │ GOVERNANCE SENSITIVE — compliance boundary  │
 * │ other                │ No               │ Unknown category — safe default: require    │
 * └──────────────────────┴──────────────────┴─────────────────────────────────────────────┘
 *
 * SOURCE RULES
 * ------------
 * Auto-adoption is only permitted when sourceType is "conversation" or "ai_proposed".
 * Records sourced via "import" always require manual review (they may contain
 * bulk policy content not individually inspected by the importing user).
 * Records created via "manual" are already human-authored and need no adoption gate.
 *
 * MINIMUM CONFIDENCE
 * ------------------
 * When the source provides a confidence score, auto-adoption is refused below
 * AUTO_ADOPT_MIN_CONFIDENCE (default 0.80) regardless of memory type.
 * For customer_preference the threshold is higher (0.85) due to the
 * personalisation impact on specialist tone and prioritisation.
 */

export type MemoryType =
  | "organisation_profile" | "operating_preference" | "terminology"
  | "approval_rule" | "reporting_line" | "system_information" | "workflow"
  | "policy_reference" | "customer_preference" | "risk_constraint"
  | "compliance_context" | "other";

export type MemorySourceType = "conversation" | "manual" | "ai_proposed" | "import";

// ─── Governance-sensitive types — never auto-adopted ─────────────────────────

/** Memory types that ALWAYS require explicit admin review before approval.
 *  These directly constrain or authorise specialist behaviour in ways that
 *  could affect regulatory compliance, risk exposure, or formal process. */
export const GOVERNANCE_SENSITIVE_MEMORY_TYPES: ReadonlySet<MemoryType> = new Set([
  "approval_rule",       // Who can approve what — formal authority matrix
  "workflow",            // Step-by-step process rules enforced by specialists
  "policy_reference",    // Pointers to regulatory or internal policy documents
  "risk_constraint",     // Risk management boundaries and escalation thresholds
  "compliance_context",  // Regulatory context that governs every specialist output
]);

// ─── Types eligible for auto-adoption ────────────────────────────────────────

/** Memory types that CAN be auto-adopted subject to source and confidence rules. */
export const AUTO_ADOPTABLE_MEMORY_TYPES: ReadonlySet<MemoryType> = new Set([
  "organisation_profile",
  "operating_preference",
  "terminology",
  "system_information",
  "reporting_line",
  "customer_preference",
]);

// ─── Confidence thresholds ────────────────────────────────────────────────────

/** Default minimum confidence for any auto-adoption. */
export const AUTO_ADOPT_MIN_CONFIDENCE = 0.80;

/** Higher threshold for customer_preference due to personalisation sensitivity. */
export const CUSTOMER_PREFERENCE_MIN_CONFIDENCE = 0.85;

// ─── Source eligibility ───────────────────────────────────────────────────────

/** Sources from which auto-adoption is permitted. */
const AUTO_ADOPTABLE_SOURCES: ReadonlySet<MemorySourceType> = new Set([
  "conversation",
  "ai_proposed",
]);

// ─── Policy evaluation ────────────────────────────────────────────────────────

export interface MemoryAdoptionDecision {
  allowed: boolean;
  reason: string;
}

/**
 * Determines whether a memory record may be automatically adopted
 * (moved to "approved") without explicit admin action.
 *
 * @param memoryType   - The type of the memory record
 * @param sourceType   - How the record was created
 * @param confidence   - Optional confidence score (0–1). Null = unknown.
 * @param actorRole    - The org role of the actor requesting adoption ("member" | "admin" | "owner")
 */
export function evaluateMemoryAdoption(
  memoryType: MemoryType,
  sourceType: MemorySourceType,
  confidence: number | null,
  actorRole: "member" | "admin" | "owner" = "member",
): MemoryAdoptionDecision {
  // 1. Governance-sensitive types always require human review
  if (GOVERNANCE_SENSITIVE_MEMORY_TYPES.has(memoryType)) {
    return {
      allowed: false,
      reason: `"${memoryType}" is governance-sensitive and requires explicit admin approval`,
    };
  }

  // 2. Unknown / catch-all types default to requiring review
  if (!AUTO_ADOPTABLE_MEMORY_TYPES.has(memoryType)) {
    return {
      allowed: false,
      reason: `"${memoryType}" is not in the auto-adoptable type list — manual review required`,
    };
  }

  // 3. Import sources always require review (bulk content, not individually inspected)
  if (sourceType === "import") {
    return {
      allowed: false,
      reason: "Imported records must be reviewed individually before adoption",
    };
  }

  // 4. Manual creation is already human-authored — no adoption gate needed
  if (sourceType === "manual") {
    return { allowed: true, reason: "Manual creation — no adoption gate required" };
  }

  // 5. Only conversation / ai_proposed sources are eligible for auto-adoption
  if (!AUTO_ADOPTABLE_SOURCES.has(sourceType)) {
    return {
      allowed: false,
      reason: `Source type "${sourceType}" is not eligible for auto-adoption`,
    };
  }

  // 6. reporting_line changes must be made by admin or owner
  if (memoryType === "reporting_line" && actorRole === "member") {
    return {
      allowed: false,
      reason: "Reporting-line changes require admin or owner authority",
    };
  }

  // 7. Confidence gate
  if (confidence !== null) {
    const threshold =
      memoryType === "customer_preference"
        ? CUSTOMER_PREFERENCE_MIN_CONFIDENCE
        : AUTO_ADOPT_MIN_CONFIDENCE;

    if (confidence < threshold) {
      return {
        allowed: false,
        reason: `Confidence ${confidence.toFixed(2)} is below the ${threshold} threshold for "${memoryType}"`,
      };
    }
  }

  return { allowed: true, reason: "Meets all auto-adoption criteria" };
}

/**
 * Convenience predicate — returns true if the memory type can NEVER be
 * auto-adopted under any circumstances (compliance guard for call sites
 * that don't need the full decision context).
 */
export function isGovernanceSensitiveMemoryType(memoryType: MemoryType): boolean {
  return GOVERNANCE_SENSITIVE_MEMORY_TYPES.has(memoryType);
}
