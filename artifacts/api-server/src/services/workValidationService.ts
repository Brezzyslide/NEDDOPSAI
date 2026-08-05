/**
 * Work Validation Service — Sprint 22 (original), Sprint 27.5 (evidence-aware rewrite)
 *
 * Validates a Work Package Manifest against a Blueprint's rules AFTER
 * KnowledgeResolutionService has retrieved evidence. Validation answers:
 *
 *   - Was relevant evidence actually retrieved?
 *   - Does it meet the required source category?
 *   - Is it approved and current?
 *   - Does it meet the minimum confidence threshold?
 *   - Is a mandatory citation source available?
 *   - Is the evidence sufficient for the requested work?
 *
 * Validation never runs on abstract document metadata alone. It runs on the
 * EvidencePack produced by resolveEvidence(). Manifest metadata is used only
 * as a fallback for ad-hoc (no-blueprint) or legacy executions.
 *
 * Trusted-provider source types (legislation, NDIS Practice Standards,
 * regulatory guidance) are not treated as organisation blockers. Where
 * platform retrieval is unavailable, the limitation is surfaced as an
 * informational notice rather than asking the user to upload public documents.
 */

import {
  canonicaliseSourceType,
  sourceTypeDisplayLabel,
  isTrustedProviderSource,
} from "../utils/sourceTypeNormalisation.js";
import type { EvidencePack } from "./knowledgeResolutionService.js";
import type { WorkBlueprint } from "./workBlueprintService.js";
import type { WorkPackageManifest } from "./workPackageService.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ValidationIssueLevel = "error" | "warning" | "info";
export type ValidationRecommendedAction =
  | "proceed"
  | "request_information"
  | "retrieve_additional_documents"
  | "flag_for_human_review";

export interface ValidationIssue {
  rule: string;
  level: ValidationIssueLevel;
  message: string;
  details?: string[];
}

/**
 * Structured model for a single missing evidence item.
 * Used to produce precise, deduplicated clarification messages.
 */
export interface MissingEvidenceItem {
  /** Canonical source type — never shown raw in user messages */
  canonicalType: string;
  /** Human-readable label for user messages and the Inspector */
  displayLabel: string;
  /** Whether this item blocks execution (required rule failed) */
  required: boolean;
  /** Why this evidence is needed */
  reason: string;
  /** Whether resolveEvidence was called for this execution */
  searched: boolean;
  /** What the evidence search found (or why it was not performed) */
  searchOutcome:
    | "not_found"
    | "low_confidence"
    | "not_searched"
    | "trusted_source_unavailable";
  /**
   * What the user (or platform) should do next.
   * "platform_limitation" means the user should not be asked to upload anything.
   */
  suggestedAction:
    | "upload_document"
    | "approve_existing"
    | "platform_limitation"
    | "proceed_without";
}

export interface ValidationResult {
  passed: boolean;
  issues: ValidationIssue[];
  /** Human-readable items for blocking clarification (required: true only) */
  missingItems: string[];
  conflictingItems: string[];
  recommendedAction: ValidationRecommendedAction;
  /** Human-readable summary for inclusion in logs and Inspector */
  summary: string;
  /** Structured missing-evidence items (deduped by canonical type) */
  missingEvidenceItems: MissingEvidenceItem[];
  /** Whether KnowledgeResolutionService was called before this validation */
  evidenceSearched: boolean;
  /**
   * Ready-to-send clarification message for the CoS to relay to the user.
   * Only populated when passed=false and a blocking item exists.
   */
  clarificationMessage: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Minimum confidence score for an evidence chunk to satisfy a required rule.
 * Chunks below this threshold are retrieved but not relied upon for compliance.
 */
const MIN_REQUIRED_EVIDENCE_CONFIDENCE = 0.25;

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateWorkPackage(
  manifest: WorkPackageManifest,
  blueprint: WorkBlueprint | null,
  evidencePack?: EvidencePack | null,
): ValidationResult {
  const evidenceSearched = evidencePack != null;

  if (!blueprint) {
    return {
      passed: true,
      issues: [],
      missingItems: [],
      conflictingItems: [],
      recommendedAction: "proceed",
      summary: "No blueprint selected — proceeding with general execution.",
      missingEvidenceItems: [],
      evidenceSearched,
      clarificationMessage: "",
    };
  }

  // ── Build evidence coverage from retrieved chunks ─────────────────────────
  // Separate: all retrieved types (for warnings) vs high-confidence types (for required rules)
  const retrievedAllTypes = new Set<string>();
  const retrievedHighConfTypes = new Set<string>();

  if (evidencePack) {
    for (const chunk of evidencePack.chunks) {
      const canonical = canonicaliseSourceType(chunk.sourceType);
      retrievedAllTypes.add(canonical);
      if (chunk.confidence >= MIN_REQUIRED_EVIDENCE_CONFIDENCE) {
        retrievedHighConfTypes.add(canonical);
      }
    }
    // Task upload evidence can also satisfy requirements (always direct relevance)
    for (const upload of manifest.taskUploads) {
      const canonical = canonicaliseSourceType(upload.sourceType);
      retrievedAllTypes.add(canonical);
      retrievedHighConfTypes.add(canonical); // uploads are always directly relevant
    }
  } else {
    // Legacy / ad-hoc fallback: use manifest source-type metadata
    for (const src of manifest.organisationLibrarySources) {
      const canonical = canonicaliseSourceType(src.sourceType);
      retrievedAllTypes.add(canonical);
      retrievedHighConfTypes.add(canonical);
    }
    for (const upload of manifest.taskUploads) {
      const canonical = canonicaliseSourceType(upload.sourceType);
      retrievedAllTypes.add(canonical);
      retrievedHighConfTypes.add(canonical);
    }
  }

  // Memory types (always from manifest — memories are not in the evidence pack)
  const memoryTypes = new Set(manifest.cosMemories.map(m => m.memoryType));

  const issues: ValidationIssue[] = [];
  const conflictingItems: string[] = [];

  // Accumulate missing items keyed by canonicalType for deduplication.
  // Named validation-rule entries take priority over generic category entries.
  const missingByType = new Map<string, MissingEvidenceItem>();

  function upsertMissing(item: MissingEvidenceItem): void {
    const existing = missingByType.get(item.canonicalType);
    // Keep whichever is more specific (required > not-required; named reason > generic)
    if (!existing || (!existing.required && item.required)) {
      missingByType.set(item.canonicalType, item);
    }
  }

  // ── Run blueprint validation rules ────────────────────────────────────────
  for (const rule of blueprint.validationRules) {
    const evalResult = evaluateRule(
      rule.rule,
      retrievedHighConfTypes,
      retrievedAllTypes,
      memoryTypes,
      manifest,
    );

    if (!evalResult.passed) {
      const canonicalMissing = evalResult.missingCanonicalType;
      const isTrusted = canonicalMissing ? isTrustedProviderSource(canonicalMissing) : false;

      // Trusted-provider failures are never organisation blockers regardless of
      // whether the blueprint marks them as required. Surface as warnings.
      const effectiveRequired = rule.required && !isTrusted;
      const level: ValidationIssueLevel = effectiveRequired ? "error" : "warning";

      issues.push({
        rule: rule.rule,
        level,
        message: rule.description,
        details: evalResult.details,
      });

      if (canonicalMissing) {
        const searchOutcome = isTrusted
          ? "trusted_source_unavailable"
          : evidenceSearched
          ? "not_found"
          : "not_searched";

        const suggestedAction = isTrusted
          ? "platform_limitation"
          : evidenceSearched
          ? "upload_document"
          : "approve_existing";

        upsertMissing({
          canonicalType: canonicalMissing,
          displayLabel: sourceTypeDisplayLabel(canonicalMissing),
          required: effectiveRequired,
          reason: rule.description,
          searched: evidenceSearched,
          searchOutcome,
          suggestedAction,
        });
      }
    }
  }

  // ── Check for conflicting active policies ─────────────────────────────────
  // Still uses manifest metadata — conflict detection is structural, not content-based.
  const policyTitles = manifest.organisationLibrarySources
    .filter(s => canonicaliseSourceType(s.sourceType) === "policy")
    .map(s => s.title.toLowerCase());

  const seenTopics = new Set<string>();
  for (const title of policyTitles) {
    const topic = extractPolicyTopic(title);
    if (seenTopics.has(topic)) {
      conflictingItems.push(title);
      issues.push({
        rule: "no_conflicting_policies",
        level: "warning",
        message: `Multiple policies found for topic "${topic}" — review for conflicts before proceeding`,
        details: [title],
      });
    }
    seenTopics.add(topic);
  }

  // ── Check required library knowledge ─────────────────────────────────────
  // These generate warnings only. Only validationRules with required:true can block.
  for (const rawType of blueprint.requiredLibraryKnowledge) {
    const canonical = canonicaliseSourceType(rawType);
    if (!retrievedAllTypes.has(canonical)) {
      const isTrusted = isTrustedProviderSource(canonical);
      const searchOutcome = isTrusted
        ? "trusted_source_unavailable"
        : evidenceSearched
        ? "not_found"
        : "not_searched";
      const suggestedAction = isTrusted ? "platform_limitation" : "approve_existing";

      // Never a blocker — required library knowledge is recommended evidence.
      // Required blockers come only from named validationRules with required:true.
      issues.push({
        rule: "required_library_knowledge",
        level: "warning",
        message: isTrusted
          ? `${sourceTypeDisplayLabel(canonical)} is sourced by the platform — retrieval not yet available for this work type`
          : evidenceSearched
          ? `Searched Organisation Library but could not locate a current ${sourceTypeDisplayLabel(canonical)}`
          : `No ${sourceTypeDisplayLabel(canonical)} documents found in Organisation Library`,
        details: [sourceTypeDisplayLabel(canonical)],
      });

      upsertMissing({
        canonicalType: canonical,
        displayLabel: sourceTypeDisplayLabel(canonical),
        required: false,
        reason: `Blueprint recommends a ${sourceTypeDisplayLabel(canonical)} for this type of work`,
        searched: evidenceSearched,
        searchOutcome,
        suggestedAction,
      });
    }
  }

  // ── Check mandatory citations (informational only) ────────────────────────
  for (const rawType of blueprint.mandatoryCitations) {
    const canonical = canonicaliseSourceType(rawType);
    if (!retrievedAllTypes.has(canonical)) {
      const isTrusted = isTrustedProviderSource(canonical);
      issues.push({
        rule: "mandatory_citation",
        level: "info",
        message: isTrusted
          ? `${sourceTypeDisplayLabel(canonical)} citation will reference platform-sourced content`
          : `${sourceTypeDisplayLabel(canonical)} citation type not yet retrieved — specialist will note limitation`,
        details: [sourceTypeDisplayLabel(canonical)],
      });
    }
  }

  // ── Determine overall pass/fail ───────────────────────────────────────────
  const hasErrors = issues.some(i => i.level === "error");
  const hasWarnings = issues.some(i => i.level === "warning");

  let recommendedAction: ValidationRecommendedAction = "proceed";
  if (hasErrors) {
    recommendedAction = "request_information";
  } else if (conflictingItems.length > 0) {
    recommendedAction = "flag_for_human_review";
  } else if (hasWarnings && missingByType.size > 2) {
    recommendedAction = "retrieve_additional_documents";
  }

  const passed = !hasErrors;

  // ── Produce deduped missingEvidenceItems ─────────────────────────────────
  const missingEvidenceItems = Array.from(missingByType.values());

  // missingItems (for backward-compat) — display labels of required blockers only
  const missingItems = missingEvidenceItems
    .filter(m => m.required)
    .map(m => m.displayLabel);

  const summary = buildSummary(passed, issues, missingItems, conflictingItems);
  const clarificationMessage = passed
    ? ""
    : buildClarificationMessage(missingEvidenceItems, evidenceSearched);

  return {
    passed,
    issues,
    missingItems,
    conflictingItems,
    recommendedAction,
    summary,
    missingEvidenceItems,
    evidenceSearched,
    clarificationMessage,
  };
}

// ─── Rule evaluation ──────────────────────────────────────────────────────────

interface RuleEvalResult {
  passed: boolean;
  /** Canonical type of the primary missing requirement (for MissingEvidenceItem) */
  missingCanonicalType?: string;
  details?: string[];
}

function evaluateRule(
  rule: string,
  highConfSourceTypes: Set<string>, // for required rules
  allSourceTypes: Set<string>,      // for optional/warning rules
  memoryTypes: Set<string>,
  manifest: WorkPackageManifest,
): RuleEvalResult {
  switch (rule) {
    case "incident_policy_present":
      return {
        passed: highConfSourceTypes.has("policy"),
        missingCanonicalType: "policy",
        details: ["Organisation incident management policy"],
      };

    case "risk_policy_present":
      // Risk management requires either a risk management policy (policy type)
      // or a participant-specific risk assessment — these are professionally distinct.
      // The rule documents both possibilities so blueprint reviewers can refine it.
      return {
        passed: highConfSourceTypes.has("policy") || highConfSourceTypes.has("risk_assessment"),
        missingCanonicalType: "policy", // primary requirement; risk_assessment is alternative
        details: ["Risk Management Policy"],
      };

    case "legislation_present":
      // Legislation is a trusted-provider source — not an org upload requirement.
      // This rule will be downgraded to a warning by the caller for trusted types.
      return {
        passed: allSourceTypes.has("legislation"),
        missingCanonicalType: "legislation",
        details: ["Relevant legislation"],
      };

    case "template_present":
      return {
        passed: allSourceTypes.has("template"),
        missingCanonicalType: "template",
        details: ["Relevant template document"],
      };

    case "participant_context_present":
      return {
        passed:
          manifest.taskUploads.length > 0 ||
          Object.keys(manifest.entityKnowledge ?? {}).length > 0,
        missingCanonicalType: "participant_document",
        details: ["Participant information (task upload or entity knowledge)"],
      };

    case "staff_context_present":
      return {
        passed:
          manifest.taskUploads.length > 0 ||
          Object.keys(manifest.entityKnowledge ?? {}).length > 0,
        missingCanonicalType: "participant_document",
        details: ["Staff member information"],
      };

    case "related_policy_present":
      return {
        passed: highConfSourceTypes.has("policy"),
        missingCanonicalType: "policy",
        details: ["Related policy document"],
      };

    case "policy_present":
      return {
        passed: highConfSourceTypes.has("policy"),
        missingCanonicalType: "policy",
        details: ["Organisation policy document"],
      };

    case "investigation_scope_defined":
      return {
        passed: Object.keys(manifest.entityKnowledge ?? {}).length > 0,
        missingCanonicalType: "participant_document",
        details: ["Investigation scope (entity knowledge)"],
      };

    default:
      // Unknown rule — pass by default (don't block on unrecognised rules)
      return { passed: true };
  }
}

// ─── Clarification message builder ────────────────────────────────────────────

/**
 * Build a precise, evidence-aware clarification message for the user.
 *
 * - Names specific missing documents using display labels (never raw type codes).
 * - Distinguishes between "searched and not found" vs "not yet searched".
 * - Identifies trusted-provider sources as platform limitations.
 * - Only asks the user to provide org-owned documents.
 */
export function buildClarificationMessage(
  items: MissingEvidenceItem[],
  evidenceSearched: boolean,
): string {
  const blockers  = items.filter(m => m.required);
  const warnings  = items.filter(m => !m.required);
  const platformLimitations = items.filter(m => m.suggestedAction === "platform_limitation");

  const parts: string[] = [];

  if (blockers.length === 0) return "";

  // ── Required blockers ─────────────────────────────────────────────────────
  const orgBlockers = blockers.filter(m => m.suggestedAction !== "platform_limitation");
  if (orgBlockers.length > 0) {
    if (evidenceSearched) {
      if (orgBlockers.length === 1) {
        const item = orgBlockers[0]!;
        parts.push(
          `I searched your approved Organisation Library but could not locate a current ${item.displayLabel} required for this work.`,
        );
        parts.push(
          `Please upload or approve a ${item.displayLabel}, or confirm that another approved document should be used instead.`,
        );
      } else {
        const labels = orgBlockers.map(m => m.displayLabel);
        parts.push(
          `I searched your approved Organisation Library but could not locate the following required documents:\n\n` +
          labels.map(l => `• ${l}`).join("\n"),
        );
        parts.push(
          `Please upload or approve these documents to continue, or confirm that existing approved documents cover these requirements.`,
        );
      }
    } else {
      const labels = orgBlockers.map(m => m.displayLabel);
      if (orgBlockers.length === 1) {
        parts.push(
          `This work requires a ${labels[0]} to proceed. Please upload or approve the relevant document.`,
        );
      } else {
        parts.push(
          `This work requires the following documents to proceed:\n\n` +
          labels.map(l => `• ${l}`).join("\n") + "\n\n" +
          `Please upload or approve these documents to continue.`,
        );
      }
    }
  }

  // ── Platform limitations (trusted provider, not an org upload request) ────
  if (platformLimitations.length > 0) {
    const labels = platformLimitations.map(m => m.displayLabel);
    parts.push(
      `Note: ${labels.join(" and ")} ${labels.length === 1 ? "is" : "are"} sourced automatically by the platform. ` +
      `This capability is not yet available for this type of work — the specialist will proceed with available organisational evidence and note this limitation.`,
    );
  }

  // ── Recommended but not blocking ─────────────────────────────────────────
  const orgWarnings = warnings.filter(m => m.suggestedAction !== "platform_limitation");
  if (orgWarnings.length > 0 && blockers.length === 0) {
    // Only include warnings in message if they are the only concern (no blockers)
    const labels = orgWarnings.map(m => m.displayLabel);
    parts.push(
      `I could not locate ${labels.join(" or ")} in your Organisation Library. ` +
      `I can continue using available organisational evidence, but the final review will identify this limitation.`,
    );
  }

  return parts.join("\n\n");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractPolicyTopic(title: string): string {
  const words = title
    .replace(/policy|procedure|guideline|framework|standard/gi, "")
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 3)
    .slice(0, 2);
  return words.join(" ").toLowerCase();
}

function buildSummary(
  passed: boolean,
  issues: ValidationIssue[],
  missingItems: string[],
  conflictingItems: string[],
): string {
  if (passed && issues.length === 0) {
    return "Work package validated — all requirements met.";
  }
  if (passed && missingItems.length === 0) {
    return "Work package validated — proceeding with available evidence.";
  }

  const parts: string[] = [];
  const errors   = issues.filter(i => i.level === "error");
  const warnings = issues.filter(i => i.level === "warning");

  if (errors.length > 0) {
    parts.push(`${errors.length} required item(s) missing: ${missingItems.slice(0, 3).join(", ")}`);
  }
  if (warnings.length > 0) {
    parts.push(`${warnings.length} advisory item(s) — execution may proceed with reduced evidence coverage`);
  }
  if (conflictingItems.length > 0) {
    parts.push(`Potential policy conflicts detected — human review recommended`);
  }

  return parts.join(". ") + ".";
}
