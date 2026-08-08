/**
 * Completed Work Content Normaliser — Sprint 29J.3 (web copy)
 *
 * Mirror of artifacts/api-server/src/services/completedWorkNormaliser.ts
 * for use in the web viewer (cannot import server-side code).
 *
 * Converts any supported content format into clean markdown for rendering.
 * MUST remain logically identical to the server copy.
 *
 * No LLM calls. No remote fetches. Deterministic. Never throws.
 */

const SKIP_FIELDS = new Set([
  "specialistRunId", "workforceRoleCode", "capabilityCode",
  "id", "taskId", "executionId", "orgId", "organizationId", "organisationId",
  "createdAt", "updatedAt", "version", "_type", "__type",
]);

const LABEL_MAP: Record<string, string> = {
  executiveSummary: "Executive Summary", summary: "Summary", overview: "Overview",
  status: "Status", finding: "Finding", findings: "Findings", keyFindings: "Key Findings",
  risk: "Risk", risks: "Risks", riskLevel: "Risk Level", evidence: "Evidence",
  action: "Action", actions: "Actions", recommendation: "Recommendation",
  recommendations: "Recommendations", priority: "Priority",
  responsibleRole: "Responsible Role", responsibleParty: "Responsible Party",
  owner: "Owner", implementationTimeframe: "Implementation Timeframe",
  timeframe: "Timeframe", dueDate: "Due Date", citation: "Citation",
  citations: "Citations", reference: "Reference", references: "References",
  source: "Source", sources: "Sources", title: "Title", description: "Description",
  details: "Details", notes: "Notes", impact: "Impact", likelihood: "Likelihood",
  mitigation: "Mitigation", nextSteps: "Next Steps", conclusion: "Conclusion",
  background: "Background", context: "Context", scope: "Scope",
  methodology: "Methodology", objectives: "Objectives", outcome: "Outcome",
  outcomes: "Outcomes", result: "Result", results: "Results",
  constraint: "Constraint", constraints: "Constraints",
  assumption: "Assumption", assumptions: "Assumptions",
  dependency: "Dependency", dependencies: "Dependencies",
};

const KEY_PRIORITY = [
  "executiveSummary", "summary", "overview", "background", "context", "scope",
  "status", "findings", "keyFindings", "risks", "recommendations", "actions",
  "nextSteps", "conclusion", "citations", "references", "sources",
];

const PRIMARY_ITEM_KEYS = [
  "finding", "action", "recommendation", "citation", "reference",
  "title", "description", "name", "text", "summary",
];

export function normaliseCompletedWorkContent(content: string): string {
  if (!content || !content.trim()) return content ?? "";
  const trimmed = content.trim();

  const fencedMatch = trimmed.match(/^```(?:[a-zA-Z]*)[ \t]*\r?\n([\s\S]+?)\r?\n```[ \t]*$/);
  if (fencedMatch) {
    const inner = (fencedMatch[1] ?? "").trim();
    try {
      const parsed: unknown = JSON.parse(inner);
      return renderJsonAsMarkdown(parsed);
    } catch {
      return inner;
    }
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return renderJsonAsMarkdown(parsed);
      }
    } catch { /* fall through */ }
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return renderJsonAsMarkdown(parsed);
    } catch { /* fall through */ }
  }

  return content;
}

function renderJsonAsMarkdown(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string")  return value;
  if (typeof value === "number")  return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value))       return renderArrayAsMarkdown(value, depth);
  if (typeof value === "object")  return renderObjectAsMarkdown(value as Record<string, unknown>, depth);
  return String(value);
}

function renderObjectAsMarkdown(obj: Record<string, unknown>, depth: number): string {
  const lines: string[] = [];
  const allKeys = Object.keys(obj);
  const orderedKeys = [
    ...KEY_PRIORITY.filter(k => allKeys.includes(k) && !SKIP_FIELDS.has(k)),
    ...allKeys.filter(k => !KEY_PRIORITY.includes(k) && !SKIP_FIELDS.has(k)),
  ];

  for (const key of orderedKeys) {
    if (SKIP_FIELDS.has(key)) continue;
    const val = obj[key];
    if (val === null || val === undefined || val === "") continue;
    const label = camelToLabel(key);
    const headingPrefix = depth === 0 ? "## " : "### ";

    if (Array.isArray(val)) {
      if (val.length === 0) continue;
      lines.push(`${headingPrefix}${label}`, "", renderArrayAsMarkdown(val, depth + 1), "");
    } else if (typeof val === "object" && val !== null) {
      lines.push(`${headingPrefix}${label}`, "", renderObjectAsMarkdown(val as Record<string, unknown>, depth + 1), "");
    } else if (KEY_PRIORITY.includes(key)) {
      lines.push(`${headingPrefix}${label}`, "", String(val), "");
    } else {
      lines.push(`**${label}:** ${val}`);
    }
  }

  return lines.join("\n").trim();
}

function renderArrayAsMarkdown(arr: unknown[], depth: number): string {
  return arr.map((item, index) => {
    const num = index + 1;
    if (typeof item === "object" && item !== null && !Array.isArray(item)) {
      return renderArrayItemObject(item as Record<string, unknown>, num, depth);
    }
    if (typeof item === "string") return `${num}. ${item}`;
    return `${num}. ${renderJsonAsMarkdown(item, depth)}`;
  }).filter(Boolean).join("\n");
}

function renderArrayItemObject(obj: Record<string, unknown>, num: number, _depth: number): string {
  const keys = Object.keys(obj).filter(k => !SKIP_FIELDS.has(k));
  let primaryKey = PRIMARY_ITEM_KEYS.find(pk => keys.includes(pk));
  if (!primaryKey) primaryKey = keys.find(k => typeof obj[k] === "string" || typeof obj[k] === "number");
  const primaryValue = primaryKey ? obj[primaryKey] : null;
  const remainingKeys = keys.filter(k => k !== primaryKey);
  const lines: string[] = [];

  if (primaryValue !== null && primaryValue !== undefined && String(primaryValue).trim()) {
    lines.push(`${num}. ${String(primaryValue)}`);
  } else {
    lines.push(`${num}.`);
  }

  for (const key of remainingKeys) {
    const val = obj[key];
    if (val === null || val === undefined || val === "") continue;
    const label = camelToLabel(key);
    if (Array.isArray(val)) {
      if (val.length === 0) continue;
      lines.push(`   **${label}:**`);
      val.forEach(v => lines.push(`     - ${typeof v === "object" ? renderJsonAsMarkdown(v) : String(v)}`));
    } else if (typeof val === "object") {
      lines.push(`   **${label}:** ${renderJsonAsMarkdown(val)}`);
    } else {
      lines.push(`   **${label}:** ${val}`);
    }
  }
  return lines.join("\n");
}

export function camelToLabel(key: string): string {
  const mapped = LABEL_MAP[key];
  if (mapped) return mapped;
  return key
    .replace(/_/g, " ")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}
