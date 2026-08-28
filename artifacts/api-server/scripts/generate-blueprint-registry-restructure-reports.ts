import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BLUEPRINT_REGISTRY, type RegistryEntry } from "../src/services/blueprintRegistry.js";
import {
  auditPurposeClausePreservation,
  getRestructuredRegistryEntries,
  registryDomainCounts,
  registryOperationScopeReport,
  type RestructuredRegistryEntry,
} from "../src/services/blueprintRegistryRestructureService.js";

const OUT_DIR = join(process.cwd(), "../../artifacts/blueprint-registry-restructure");

interface MergeReviewGroup {
  title: string;
  codes: string[];
  proposedCode: string | null;
  proposedName: string | null;
  proposedScopes: string[];
  founderDecision: string;
}

const MERGE_REVIEW_GROUPS: MergeReviewGroup[] = [
  {
    title: "Risk Assessments",
    codes: [
      "community_access_risk_assessment",
      "fire_risk_assessment",
      "participant_risk_assessment",
      "site_environmental_risk_assessment",
    ],
    proposedCode: "risk_assessment",
    proposedName: "Risk Assessment",
    proposedScopes: [
      "participant_general",
      "participant_health",
      "participant_behavioural",
      "participant_home",
      "community_access",
      "site_environmental",
      "fire",
    ],
    founderDecision: "Founder decision needed: whether fire and site/environmental should split into a separate site-level Blueprint.",
  },
  {
    title: "Mealtime",
    codes: [
      "dysphagia_mealtime_safety_review",
      "mealtime_management_plan_review",
      "mealtime_risk_assessment",
      "mealtime_support_strategy",
    ],
    proposedCode: "mealtime_safety_management",
    proposedName: "Mealtime Safety Management",
    proposedScopes: ["dysphagia_review", "risk_assessment", "support_strategy", "plan_review"],
    founderDecision: "Founder decision needed: preserve dysphagia/credentialed clinical authority boundaries before any merge.",
  },
  {
    title: "Participant Emergency",
    codes: ["participant_disaster_risk_assessment", "individual_emergency_preparedness_plan"],
    proposedCode: "participant_emergency_preparedness",
    proposedName: "Participant Emergency Preparedness",
    proposedScopes: ["risk_assessment", "preparedness_plan"],
    founderDecision: "Founder decision needed before any merge.",
  },
  {
    title: "Health Support",
    codes: ["health_support_plan", "health_clinical_escalation_plan"],
    proposedCode: "health_support_plan",
    proposedName: "Health Support Plan",
    proposedScopes: ["support_plan", "escalation_pathways"],
    founderDecision: "Founder decision needed: author and preserve clinical-authority limitations before any merge.",
  },
  {
    title: "Care Plan vs Individual Support Plan",
    codes: ["care_plan", "individual_support_plan"],
    proposedCode: null,
    proposedName: null,
    proposedScopes: [],
    founderDecision: "Comparison only. No merge proposal without an explicit founder ruling.",
  },
];

main();

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const entries = getRestructuredRegistryEntries();
  const byCode = new Map(entries.map((entry) => [entry.code, entry]));
  const sourceByCode = new Map(BLUEPRINT_REGISTRY.map((entry) => [entry.code, entry]));

  writeFileSync(
    join(OUT_DIR, "registry-restructure-audit.json"),
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      registryCount: entries.length,
      classifierOptionCount: entries.filter((entry) => entry.classifierSelectable).length,
      domainCounts: registryDomainCounts(),
      operationScopeReport: registryOperationScopeReport(),
      clausePreservation: auditPurposeClausePreservation(),
      stubsRequiringFounderReview: entries
        .filter((entry) => entry.authority_boundary_source === "authored_review_required")
        .map((entry) => ({ code: entry.code, name: entry.name, boundary: entry.authority_boundary })),
    }, null, 2)}\n`,
  );

  writeFileSync(join(OUT_DIR, "clause-preservation.md"), renderClausePreservation());
  writeFileSync(join(OUT_DIR, "operation-scope-mapping.md"), renderOperationScopeMapping());
  writeFileSync(join(OUT_DIR, "domain-counts.md"), renderDomainCounts());
  writeFileSync(join(OUT_DIR, "stub-boundaries-for-founder-review.md"), renderStubBoundaries(entries));
  writeFileSync(join(OUT_DIR, "pre-merge-founder-review.md"), renderPreMergeReview(MERGE_REVIEW_GROUPS, byCode, sourceByCode));
  writeFileSync(join(OUT_DIR, "blueprint-definitions-table.md"), renderDefinitionTable(entries));

  console.log(`Wrote Blueprint registry restructure reports to ${OUT_DIR}`);
}

function renderClausePreservation(): string {
  const rows = auditPurposeClausePreservation();
  return [
    "# Blueprint Clause Preservation Audit",
    "",
    "Every source purpose clause containing boundary keywords is checked against the target projection.",
    "",
    "| Code | Clause | Status | Target location |",
    "|---|---|---|---|",
    ...rows.map((row) =>
      `| \`${row.code}\` | ${cell(row.clause)} | ${row.status} | ${row.targetLocation ?? ""} |`,
    ),
    "",
  ].join("\n");
}

function renderOperationScopeMapping(): string {
  return [
    "# Blueprint Operation / Scope Mapping",
    "",
    "| Code | Original supportedModes | True operations | Scopes | Mapping |",
    "|---|---|---|---|---|",
    ...registryOperationScopeReport().map((row) =>
      `| \`${row.code}\` | ${cell(row.originalSupportedModes.join(", "))} | ${cell(row.operations.join(", "))} | ${cell(row.scopes.join(", ") || "-")} | ${cell(row.mapping.map((item) => `${item.original} -> ${item.mappedTo} (${item.status})`).join("; "))} |`,
    ),
    "",
  ].join("\n");
}

function renderDomainCounts(): string {
  const counts = registryDomainCounts();
  return [
    "# Blueprint Domain Counts",
    "",
    "| Target domain | Count |",
    "|---|---:|",
    ...Object.entries(counts).map(([domain, count]) => `| \`${domain}\` | ${count} |`),
    "",
  ].join("\n");
}

function renderStubBoundaries(entries: RestructuredRegistryEntry[]): string {
  const stubs = entries.filter((entry) => entry.authority_boundary_source === "authored_review_required");
  return [
    "# Blueprint Stubs Requiring Founder Review",
    "",
    "These entries had no extractable source clause containing the required boundary keywords. The target boundary is authored and marked for review.",
    "",
    "| Code | Name | Authored boundary |",
    "|---|---|---|",
    ...stubs.map((entry) => `| \`${entry.code}\` | ${cell(entry.name)} | ${cell(entry.authority_boundary)} |`),
    "",
  ].join("\n");
}

function renderDefinitionTable(entries: RestructuredRegistryEntry[]): string {
  return [
    "# Blueprint Definitions And Intended Purpose",
    "",
    "| Code | Name | Domain | Intended purpose / definition | Operations | Scopes | Specificity | Authority boundary |",
    "|---|---|---|---|---|---|---|---|",
    ...entries.map((entry) =>
      `| \`${entry.code}\` | ${cell(entry.name)} | \`${entry.domain}\` | ${cell(entry.purpose)} | ${cell(entry.operations.join(", "))} | ${cell(entry.scopes.join(", ") || "-")} | ${entry.specificity} | ${cell(entry.authority_boundary)} |`,
    ),
    "",
  ].join("\n");
}

function renderPreMergeReview(
  groups: MergeReviewGroup[],
  byCode: Map<string, RestructuredRegistryEntry>,
  sourceByCode: Map<string, RegistryEntry>,
): string {
  const chunks = [
    "# Blueprint Pre-Merge Founder Review",
    "",
    "No merge has been applied. These are review packs only.",
    "",
  ];

  for (const group of groups) {
    const entries = group.codes.map((code) => {
      const projected = byCode.get(code);
      const source = sourceByCode.get(code);
      if (!projected || !source) throw new Error(`Missing registry entry ${code}`);
      return { projected, source };
    });
    const sectionCodes = entries.map(({ source }) => sectionCodeSet(source));
    const shared = sharedSectionPercentage(sectionCodes);
    const clauses = entries.flatMap(({ projected }) =>
      projected.authority_boundary_source === "extracted"
        ? projected.authority_boundary.split(/(?<=[.!?])\s+/).map((clause) => ({ code: projected.code, clause }))
        : [{ code: projected.code, clause: projected.authority_boundary }],
    );

    chunks.push(`## ${group.title}`);
    chunks.push("");
    chunks.push(group.founderDecision);
    chunks.push("");
    chunks.push("### Entries");
    chunks.push("");
    chunks.push("| Code | Name | Purpose / description | Operations | Scopes | Specificity | Authority boundary |");
    chunks.push("|---|---|---|---|---|---|---|");
    for (const { projected } of entries) {
      chunks.push(`| \`${projected.code}\` | ${cell(projected.name)} | ${cell(projected.purpose)} | ${cell(projected.operations.join(", "))} | ${cell(projected.scopes.join(", ") || "-")} | ${projected.specificity} | ${cell(projected.authority_boundary)} |`);
    }
    chunks.push("");
    chunks.push("### Deliverable / Section Comparison");
    chunks.push("");
    chunks.push(`Shared section-code percentage: **${shared}%**`);
    chunks.push("");
    chunks.push("| Code | Section codes and headings |");
    chunks.push("|---|---|");
    for (const { source } of entries) {
      chunks.push(`| \`${source.code}\` | ${cell((source.sections ?? []).map((section) => `${section.sectionCode}: ${section.title}`).join("; ") || "No sections declared")} |`);
    }
    chunks.push("");
    chunks.push("### Clauses To Preserve");
    chunks.push("");
    chunks.push("| Source code | Clause |");
    chunks.push("|---|---|");
    for (const clause of clauses) {
      chunks.push(`| \`${clause.code}\` | ${cell(clause.clause)} |`);
    }
    chunks.push("");
    chunks.push("### Proposed Merged Entry For Review Only");
    chunks.push("");
    if (!group.proposedCode || !group.proposedName) {
      chunks.push("No merged entry proposed. Founder ruling required first.");
    } else {
      chunks.push("```yaml");
      chunks.push(`code: ${group.proposedCode}`);
      chunks.push(`name: ${group.proposedName}`);
      chunks.push(`domain: ${entries[0]?.projected.domain ?? ""}`);
      chunks.push(`purpose: "[AUTHORED — REVIEW REQUIRED] Merge candidate combining the listed purposes without deleting any source purpose text."`);
      chunks.push("source_purposes:");
      for (const { projected } of entries) {
        chunks.push(`  - ${projected.code}: ${JSON.stringify(projected.purpose)}`);
      }
      chunks.push("operations:");
      for (const operation of unique(entries.flatMap(({ projected }) => projected.operations))) {
        chunks.push(`  - ${operation}`);
      }
      chunks.push("scopes:");
      for (const scope of group.proposedScopes) {
        chunks.push(`  - ${scope}`);
      }
      chunks.push("authority_boundary:");
      for (const clause of clauses) {
        chunks.push(`  - ${clause.code}: ${JSON.stringify(clause.clause)}`);
      }
      chunks.push("```");
    }
    chunks.push("");
    chunks.push("DECISION: KEEP BOTH / MERGE / ARCHIVE ONE");
    chunks.push("");
  }

  return chunks.join("\n");
}

function sectionCodeSet(entry: RegistryEntry): Set<string> {
  return new Set((entry.sections ?? []).map((section) => section.sectionCode));
}

function sharedSectionPercentage(sectionSets: Set<string>[]): number {
  if (sectionSets.length < 2) return 100;
  const nonEmpty = sectionSets.filter((set) => set.size > 0);
  if (nonEmpty.length !== sectionSets.length) return 0;
  const [first, ...rest] = sectionSets;
  const union = new Set(sectionSets.flatMap((set) => [...set]));
  const intersection = [...first].filter((code) => rest.every((set) => set.has(code)));
  return union.size === 0 ? 0 : Math.round((intersection.length / union.size) * 100);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}
