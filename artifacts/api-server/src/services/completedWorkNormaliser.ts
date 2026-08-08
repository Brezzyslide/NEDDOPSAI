/**
 * Completed Work Content Normaliser — Sprint 29J.3
 *
 * Single shared normalisation layer between Viewer, PDF, and DOCX exporters.
 *
 * Canonical pipeline:
 *
 *   resolveApprovedVersion()
 *       ↓
 *   normaliseCompletedWorkContent(contentMarkdown)
 *       ↓
 *   Normalised Markdown string
 *       ↓
 *   parseMarkdown() → DocumentNode[]
 *       ↓
 *   ┌──────┬─────┬──────┐
 *  Viewer  PDF   DOCX
 *
 * Handles:
 *   1. Markdown/prose           → passed through unchanged
 *   2. Structured JSON object   → rendered as human-readable markdown sections
 *   3. JSON array               → rendered as numbered list with sub-fields
 *   4. Fenced ```json blocks    → inner JSON extracted; rendered through (2)/(3)
 *   5. Fenced non-JSON block    → inner text returned as plain text (fences stripped)
 *   6. Mixed markdown + JSON    → JSON sections normalised in place
 *   7. Malformed/unrecognised   → safe pass-through as plain text (never crash)
 *
 * SECURITY:
 *   - No LLM calls — deterministic output from approved content
 *   - No remote resource fetching — content treated as untrusted text
 *   - HTML/script characters are not escaped here (done by renderers on output)
 *   - Content is never rewritten, summarised, or paraphrased
 */

// ─── Internal-only field names — never rendered in exported documents ──────────

const SKIP_FIELDS = new Set([
  "specialistRunId",
  "workforceRoleCode",
  "capabilityCode",
  "id",
  "taskId",
  "executionId",
  "orgId",
  "organizationId",
  "organisationId",
  "createdAt",
  "updatedAt",
  "version",
  "_type",
  "__type",
]);

// ─── Human-readable label map ─────────────────────────────────────────────────

const LABEL_MAP: Record<string, string> = {
  executiveSummary:         "Executive Summary",
  summary:                  "Summary",
  overview:                 "Overview",
  status:                   "Status",
  finding:                  "Finding",
  findings:                 "Findings",
  keyFindings:              "Key Findings",
  risk:                     "Risk",
  risks:                    "Risks",
  riskLevel:                "Risk Level",
  evidence:                 "Evidence",
  action:                   "Action",
  actions:                  "Actions",
  recommendation:           "Recommendation",
  recommendations:          "Recommendations",
  priority:                 "Priority",
  responsibleRole:          "Responsible Role",
  responsibleParty:         "Responsible Party",
  owner:                    "Owner",
  implementationTimeframe:  "Implementation Timeframe",
  timeframe:                "Timeframe",
  dueDate:                  "Due Date",
  citation:                 "Citation",
  citations:                "Citations",
  reference:                "Reference",
  references:               "References",
  source:                   "Source",
  sources:                  "Sources",
  title:                    "Title",
  description:              "Description",
  details:                  "Details",
  notes:                    "Notes",
  impact:                   "Impact",
  likelihood:               "Likelihood",
  mitigation:               "Mitigation",
  nextSteps:                "Next Steps",
  conclusion:               "Conclusion",
  background:               "Background",
  context:                  "Context",
  scope:                    "Scope",
  methodology:              "Methodology",
  objectives:               "Objectives",
  outcome:                  "Outcome",
  outcomes:                 "Outcomes",
  result:                   "Result",
  results:                  "Results",
  constraint:               "Constraint",
  constraints:              "Constraints",
  assumption:               "Assumption",
  assumptions:              "Assumptions",
  dependency:               "Dependency",
  dependencies:             "Dependencies",
};

// ─── Key ordering — important semantic sections first ─────────────────────────

const KEY_PRIORITY = [
  "executiveSummary",
  "summary",
  "overview",
  "background",
  "context",
  "scope",
  "status",
  "findings",
  "keyFindings",
  "risks",
  "recommendations",
  "actions",
  "nextSteps",
  "conclusion",
  "citations",
  "references",
  "sources",
];

// ─── Array item: the first non-skip field to use as the numbered item text ────

const PRIMARY_ITEM_KEYS = [
  "finding",
  "action",
  "recommendation",
  "citation",
  "reference",
  "title",
  "description",
  "name",
  "text",
  "summary",
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * normaliseCompletedWorkContent
 *
 * Converts any supported content format into a clean markdown string
 * that can then be fed into parseMarkdown() for rendering.
 *
 * This function is pure and deterministic — it never calls an LLM,
 * never fetches remote resources, and never throws (always safe to call).
 */
export function normaliseCompletedWorkContent(content: string): string {
  if (!content || !content.trim()) return content ?? "";
  const trimmed = content.trim();

  // ── 1. Fenced code block  ──────────────────────────────────────────────────
  // Matches: ```json\n...\n``` or ```\n...\n```
  const fencedMatch = trimmed.match(/^```(?:[a-zA-Z]*)[ \t]*\r?\n([\s\S]+?)\r?\n```[ \t]*$/);
  if (fencedMatch) {
    const inner = (fencedMatch[1] ?? "").trim();
    try {
      const parsed: unknown = JSON.parse(inner);
      return renderJsonAsMarkdown(parsed);
    } catch {
      // Fenced content is not JSON — strip fences and return inner text as-is
      return inner;
    }
  }

  // ── 2. Raw JSON object ─────────────────────────────────────────────────────
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return renderJsonAsMarkdown(parsed);
      }
    } catch {
      // Malformed JSON-like text — fall through to plain text path
    }
  }

  // ── 3. Raw JSON array ──────────────────────────────────────────────────────
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return renderJsonAsMarkdown(parsed);
      }
    } catch {
      // Malformed — fall through
    }
  }

  // ── 4. Markdown or plain text — pass through unchanged ────────────────────
  return content;
}

// ─── JSON → Markdown renderer ─────────────────────────────────────────────────

/**
 * renderJsonAsMarkdown
 *
 * Recursively converts a parsed JSON value into clean markdown.
 * Objects are rendered as heading + paragraph sections.
 * Arrays are rendered as numbered lists with sub-field rows.
 *
 * Guarantees:
 *  - No JSON braces, property name quotes, or colon syntax in output
 *  - SKIP_FIELDS are silently excluded
 *  - Unknown keys are humanised with camelToLabel()
 *  - Content is never rewritten or summarised
 *  - Null / undefined values are silently omitted
 */
export function renderJsonAsMarkdown(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string")  return value;
  if (typeof value === "number")  return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (Array.isArray(value)) {
    return renderArrayAsMarkdown(value, depth);
  }

  if (typeof value === "object") {
    return renderObjectAsMarkdown(value as Record<string, unknown>, depth);
  }

  return String(value);
}

function renderObjectAsMarkdown(obj: Record<string, unknown>, depth: number): string {
  const lines: string[] = [];
  const allKeys = Object.keys(obj);

  // Priority keys first, then remainder (skipping internal fields)
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
      lines.push(`${headingPrefix}${label}`);
      lines.push("");
      lines.push(renderArrayAsMarkdown(val, depth + 1));
      lines.push("");
    } else if (typeof val === "object" && val !== null) {
      lines.push(`${headingPrefix}${label}`);
      lines.push("");
      lines.push(renderObjectAsMarkdown(val as Record<string, unknown>, depth + 1));
      lines.push("");
    } else {
      // Scalar: render as a section heading + paragraph (for priority keys),
      // or as a bold key/value pair (for secondary keys)
      if (KEY_PRIORITY.includes(key)) {
        lines.push(`${headingPrefix}${label}`);
        lines.push("");
        lines.push(String(val));
        lines.push("");
      } else {
        lines.push(`**${label}:** ${val}`);
      }
    }
  }

  return lines.join("\n").trim();
}

function renderArrayAsMarkdown(arr: unknown[], depth: number): string {
  return arr
    .map((item, index) => {
      const num = index + 1;

      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        return renderArrayItemObject(item as Record<string, unknown>, num, depth);
      }

      if (typeof item === "string") {
        return `${num}. ${item}`;
      }

      return `${num}. ${renderJsonAsMarkdown(item, depth)}`;
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * renderArrayItemObject
 *
 * Renders a structured object inside a list (e.g., a finding or recommendation).
 *
 * The first PRIMARY_ITEM_KEY found becomes the numbered item text.
 * All other fields are rendered as indented sub-rows.
 *
 * Example output:
 *   1. Legacy authorisation checks allow privilege escalation in the HR module.
 *      Risk: Critical
 *      Evidence: Demonstrated via penetration test scenario PEN-042.
 *      Responsible Role: Head of IT Security
 *
 * If no primary key exists, the first non-skip string value is used.
 */
function renderArrayItemObject(
  obj: Record<string, unknown>,
  num: number,
  _depth: number,
): string {
  const keys = Object.keys(obj).filter(k => !SKIP_FIELDS.has(k));

  // Find primary key
  let primaryKey = PRIMARY_ITEM_KEYS.find(pk => keys.includes(pk));
  if (!primaryKey) {
    // Fall back to the first key with a string/number value
    primaryKey = keys.find(k => typeof obj[k] === "string" || typeof obj[k] === "number");
  }

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
      val.forEach((v) => {
        lines.push(`     - ${typeof v === "object" ? renderJsonAsMarkdown(v) : String(v)}`);
      });
    } else if (typeof val === "object") {
      lines.push(`   **${label}:** ${renderJsonAsMarkdown(val)}`);
    } else {
      lines.push(`   **${label}:** ${val}`);
    }
  }

  return lines.join("\n");
}

// ─── Label humaniser ──────────────────────────────────────────────────────────

/**
 * camelToLabel — converts a camelCase or snake_case key to "Title Case With Spaces".
 *
 * Checks LABEL_MAP first; falls back to regex splitting.
 *
 * Examples:
 *   executiveSummary       → "Executive Summary"
 *   responsibleRole        → "Responsible Role"
 *   implementationTimeframe → "Implementation Timeframe"
 *   my_field_name          → "My Field Name"
 *   HTMLContent            → "HTML Content"
 */
export function camelToLabel(key: string): string {
  const mapped = LABEL_MAP[key];
  if (mapped) return mapped;

  return key
    .replace(/_/g, " ")                              // snake_case → spaces
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")       // HTMLContent → HTML Content
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")           // camelCase → camel Case
    .replace(/\b\w/g, (c) => c.toUpperCase())         // title case
    .trim();
}
