/**
 * Work Validation Service — Sprint 22 (Work Execution Engine & Completed Work)
 *
 * Validates a Work Package Manifest against a Blueprint's rules before
 * specialist execution begins. Checks for required templates, policies,
 * participant context, legislation, and conflicting sources.
 *
 * Never silently continues on failure — returns a structured ValidationResult
 * so the CoS can request missing information from the user.
 */

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
  /** Specific items that are missing or conflicting */
  details?: string[];
}

export interface ValidationResult {
  passed: boolean;
  issues: ValidationIssue[];
  missingItems: string[];
  conflictingItems: string[];
  recommendedAction: ValidationRecommendedAction;
  /** Human-readable summary for inclusion in CoS clarification response */
  summary: string;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateWorkPackage(
  manifest: WorkPackageManifest,
  blueprint: WorkBlueprint | null,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const missingItems: string[] = [];
  const conflictingItems: string[] = [];

  if (!blueprint) {
    return {
      passed: true,
      issues: [],
      missingItems: [],
      conflictingItems: [],
      recommendedAction: "proceed",
      summary: "No blueprint selected — proceeding with general execution.",
    };
  }

  const sourceTypes = new Set(manifest.organisationLibrarySources.map(s => s.sourceType));
  const memoryTypes = new Set(manifest.cosMemories.map(m => m.memoryType));

  // ── Run blueprint validation rules ────────────────────────────────────────
  for (const rule of blueprint.validationRules) {
    const result = evaluateRule(rule.rule, sourceTypes, memoryTypes, manifest);
    if (!result.passed) {
      if (rule.required) {
        issues.push({
          rule: rule.rule,
          level: "error",
          message: rule.description,
          details: result.details,
        });
        missingItems.push(...(result.details ?? [rule.description]));
      } else {
        issues.push({
          rule: rule.rule,
          level: "warning",
          message: rule.description,
          details: result.details,
        });
      }
    }
  }

  // ── Check for conflicting active policies ─────────────────────────────────
  const policyTitles = manifest.organisationLibrarySources
    .filter(s => s.sourceType === "policy")
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

  // ── Check required library knowledge is present ───────────────────────────
  for (const requiredType of blueprint.requiredLibraryKnowledge) {
    if (!sourceTypes.has(requiredType)) {
      issues.push({
        rule: "required_library_knowledge",
        level: "warning",
        message: `No approved "${requiredType}" documents found in Organisation Library`,
        details: [requiredType],
      });
      if (!missingItems.includes(requiredType)) {
        missingItems.push(requiredType);
      }
    }
  }

  // ── Check mandatory citations are available ───────────────────────────────
  for (const required of blueprint.mandatoryCitations) {
    if (!sourceTypes.has(required)) {
      issues.push({
        rule: "mandatory_citation",
        level: "warning",
        message: `Mandatory citation type "${required}" not available in retrieved sources`,
        details: [required],
      });
    }
  }

  // ── Determine overall pass/fail and recommended action ────────────────────
  const hasErrors = issues.some(i => i.level === "error");
  const hasWarnings = issues.some(i => i.level === "warning");

  let recommendedAction: ValidationRecommendedAction = "proceed";
  if (hasErrors) {
    recommendedAction = "request_information";
  } else if (conflictingItems.length > 0) {
    recommendedAction = "flag_for_human_review";
  } else if (hasWarnings && missingItems.length > 2) {
    recommendedAction = "retrieve_additional_documents";
  }

  const passed = !hasErrors;

  const summary = buildSummary(passed, issues, missingItems, conflictingItems);

  return { passed, issues, missingItems, conflictingItems, recommendedAction, summary };
}

// ─── Rule evaluation ──────────────────────────────────────────────────────────

function evaluateRule(
  rule: string,
  sourceTypes: Set<string>,
  memoryTypes: Set<string>,
  manifest: WorkPackageManifest,
): { passed: boolean; details?: string[] } {
  switch (rule) {
    case "incident_policy_present":
      return { passed: sourceTypes.has("policy"), details: ["Incident management policy"] };

    case "risk_policy_present":
      return { passed: sourceTypes.has("policy") || sourceTypes.has("risk_assessment"), details: ["Risk management policy"] };

    case "legislation_present":
      return {
        passed: sourceTypes.has("legislation") || sourceTypes.has("legislation_reference"),
        details: ["Relevant legislation"],
      };

    case "template_present":
      return { passed: sourceTypes.has("template"), details: ["Relevant template document"] };

    case "participant_context_present":
      return {
        passed: manifest.taskUploads.length > 0 || Object.keys(manifest.entityKnowledge ?? {}).length > 0,
        details: ["Participant information (task upload or entity knowledge)"],
      };

    case "staff_context_present":
      return {
        passed: manifest.taskUploads.length > 0 || Object.keys(manifest.entityKnowledge ?? {}).length > 0,
        details: ["Staff member information"],
      };

    case "related_policy_present":
      return { passed: sourceTypes.has("policy"), details: ["Related policy document"] };

    case "policy_present":
      return { passed: sourceTypes.has("policy"), details: ["Policy document"] };

    case "investigation_scope_defined":
      // Cannot evaluate purely from manifest — assume defined if entity knowledge has scope
      return { passed: Object.keys(manifest.entityKnowledge ?? {}).length > 0, details: ["Investigation scope"] };

    default:
      // Unknown rule — pass by default (don't block on unknown rules)
      return { passed: true };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractPolicyTopic(title: string): string {
  // Simple heuristic — first 2 significant words
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

  const parts: string[] = [];
  const errors = issues.filter(i => i.level === "error");
  const warnings = issues.filter(i => i.level === "warning");

  if (errors.length > 0) {
    parts.push(`${errors.length} required item(s) missing: ${missingItems.slice(0, 3).join(", ")}`);
  }
  if (warnings.length > 0) {
    parts.push(`${warnings.length} warning(s) — execution may proceed with reduced quality`);
  }
  if (conflictingItems.length > 0) {
    parts.push(`Potential policy conflicts detected — human review recommended`);
  }

  return parts.join(". ") + ".";
}
