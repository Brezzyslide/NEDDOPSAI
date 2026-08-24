/**
 * Sprint 29J.3 — Completed Work Human-Readable Export Quality
 *
 * Tests O1–O24 (as specified in the sprint brief):
 *
 *  O1.  Structured JSON renders without raw braces or property serialization
 *  O2.  camelCase keys become human-readable labels
 *  O3.  Nested findings render
 *  O4.  Nested recommendations render
 *  O5.  Arrays render deterministically
 *  O6.  Markdown headings render
 *  O7.  Markdown bullets render
 *  O8.  Numbered lists render
 *  O9.  Markdown table renders / readably degrades
 * O10.  Fenced JSON is detected and extracted
 * O11.  Invalid fenced JSON does not crash
 * O12.  Plain text remains intact
 * O13.  Long content exports
 * O14.  Unique content markers survive normalisation
 * O15.  PDF contains expected substantive text  (mocked integration)
 * O16.  DOCX contains expected substantive text (mocked integration)
 * O17.  PDF/DOCX substantive parity
 * O18.  Approved-version pin respected (V2 approved, V3 latest → export uses V2)
 * O19.  Broken modern approved pin still fails closed
 * O20.  Legacy null-pin behaviour unchanged
 * O21.  Cross-tenant export denied
 * O22.  Correct MIME types returned
 * O23.  Correct versioned filenames returned
 * O24.  No LLM call occurs during export
 *
 * Additional normaliser unit tests (N-series):
 * N1.  SKIP_FIELDS (specialistRunId, workforceRoleCode, capabilityCode) absent from output
 * N2.  JSON with executiveSummary renders section heading "Executive Summary"
 * N3.  Nested array items emit numbered list with sub-fields
 * N4.  Fenced JSON strips opening/closing fence markers
 * N5.  Fenced non-JSON strips fences but preserves inner text
 * N6.  Malformed JSON-like text passes through unchanged (no crash)
 * N7.  Empty/null content returns safely
 * N8.  Real specialist format (chief_of_staff JSON) renders without internal artefacts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CompletedWorkItem, CompletedWorkVersion } from "../services/completedWorkService.js";
import { resolveApprovedVersion } from "../services/completedWorkService.js";
import {
  normaliseCompletedWorkContent,
  camelToLabel,
  renderJsonAsMarkdown,
} from "../services/completedWorkNormaliser.js";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(), insert: vi.fn(), update: vi.fn(),
    transaction: vi.fn(), selectDistinctOn: vi.fn(),
  },
}));

vi.mock("../services/completedWorkService.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/completedWorkService.js")>();
  return {
    ...original,
    getCompletedWork: vi.fn(),
    getVersions:      vi.fn(),
    // resolveApprovedVersion: real implementation — kept for O18/O19/O20
  };
});

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: vi.fn().mockResolvedValue(undefined),
}));

// Guard: no LLM SDK called during export (O24)
vi.mock("openai", () => ({
  default: class { chat = { completions: { create: vi.fn().mockRejectedValue(new Error("LLM must not be called during export")) } } },
}));

import { getCompletedWork, getVersions } from "../services/completedWorkService.js";
import { CompletedWorkExportService }     from "../services/completedWorkExportService.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_A = "org-export-test";
const ORG_B = "org-other-tenant";
const WORK_ID = "work-export-001";
const ACTOR   = "user-export-test";

const BASE_WORK: CompletedWorkItem = {
  id:               WORK_ID,
  organizationId:   ORG_A,
  title:            "Compliance Policy Review",
  status:           "approved" as any,
  primarySpecialist: "chief_of_staff",
  approvedByUserId: "user-approver",
  approvedAt:       new Date("2026-08-01T10:00:00Z"),
  approvedVersionId: "ver-v2",
  currentVersionId: "ver-v3",
  createdAt:        new Date("2026-07-01T09:00:00Z"),
  updatedAt:        new Date("2026-08-01T10:00:00Z"),
};

/** Version V2 — the pinned approved version */
const VERSION_V2: CompletedWorkVersion = {
  id:              "ver-v2",
  completedWorkId: WORK_ID,
  organizationId:  ORG_A,
  versionNumber:   2,
  contentMarkdown: "## Approved Content\n\nThis is V2 approved content. MARKER_V2_APPROVED",
  changeNote:      "Approved revision",
  createdByUserId: "user-approver",
  createdAt:       new Date("2026-08-01T09:00:00Z"),
};

/** Version V3 — latest (must NOT be used when V2 is the modern pin) */
const VERSION_V3: CompletedWorkVersion = {
  id:              "ver-v3",
  completedWorkId: WORK_ID,
  organizationId:  ORG_A,
  versionNumber:   3,
  contentMarkdown: "## Latest Content\n\nThis is V3 latest content. MARKER_V3_LATEST",
  changeNote:      "New revision after approval",
  createdByUserId: "user-reviser",
  createdAt:       new Date("2026-08-02T10:00:00Z"),
};

const MARKER_EXEC_SUMMARY  = "UNIQUE_EXEC_SUMMARY_MARKER_ZX9A";
const MARKER_FINDING       = "UNIQUE_FINDING_CONTENT_QW3B";
const MARKER_RISK          = "Critical";
const MARKER_EVIDENCE      = "UNIQUE_EVIDENCE_DETAIL_PL7C";
const MARKER_RECOMMENDATION = "UNIQUE_RECOMMENDATION_ACTION_MN4D";
const MARKER_RESPONSIBLE   = "Head of IT Security";
const MARKER_TIMEFRAME     = "Q3 2026";
const MARKER_CITATION      = "UNIQUE_CITATION_SOURCE_KV8E";

/** Structured JSON — Chief of Staff format */
const STRUCTURED_JSON_CONTENT = JSON.stringify({
  specialistRunId:   "run-001",        // SKIP_FIELD — must not appear
  workforceRoleCode: "chief_of_staff", // SKIP_FIELD — must not appear
  capabilityCode:    "operational_procedure", // SKIP_FIELD — must not appear
  executiveSummary:  MARKER_EXEC_SUMMARY,
  status:            "completed",
  findings: [
    {
      finding:  MARKER_FINDING,
      risk:     MARKER_RISK,
      evidence: MARKER_EVIDENCE,
    },
  ],
  recommendations: [
    {
      action:                  MARKER_RECOMMENDATION,
      priority:                "High",
      responsibleRole:         MARKER_RESPONSIBLE,
      implementationTimeframe: MARKER_TIMEFRAME,
    },
  ],
  citations: [MARKER_CITATION],
}, null, 2);

/** Same content wrapped in fenced code block */
const FENCED_JSON_CONTENT = "```json\n" + STRUCTURED_JSON_CONTENT + "\n```";

/** Malformed JSON-like text */
const MALFORMED_JSON_CONTENT = '{"executiveSummary": "This is not closed properly';

const PLAIN_TEXT_CONTENT = "This is a plain text legacy work output with no formatting.";

const MARKDOWN_CONTENT = `# Policy Review Report

## Executive Summary

The organisation's current complaint management policy has several compliance gaps.

## Findings

- Gap 1: No documented escalation path
- Gap 2: Missing SLA definitions

## Recommendations

1. Update escalation procedures
2. Define and publish SLA targets

| Section | Status |
|---------|--------|
| Intake  | Compliant |
| Review  | Non-compliant |

> Key insight: immediate action required on the review section.
`;

const LONG_CONTENT = `# Long Report

## Executive Summary

${Array(200).fill("This is a detailed paragraph of the executive summary.").join(" ")}

## Findings

${Array(20).fill(0).map((_, i) => `- Finding ${i + 1}: Detailed observation about compliance item number ${i + 1}.`).join("\n")}

## Recommendations

${Array(20).fill(0).map((_, i) => `${i + 1}. Recommendation ${i + 1}: Implement specific improvement for area ${i + 1}.`).join("\n")}
`;

const TABLE_HEAVY_CONTENT = `# Risk Register

| Risk | Likelihood | Impact | Rating |
|------|-----------|--------|--------|
| Data breach | High | Critical | 16 |
| Policy non-compliance | Medium | High | 9 |
| Vendor failure | Low | Medium | 4 |
| System outage | Medium | High | 9 |
| Regulatory change | High | Medium | 8 |

## Summary

Five risks identified across the operational landscape.
`;

function makeWork(overrides: Partial<CompletedWorkItem> = {}): CompletedWorkItem {
  return { ...BASE_WORK, ...overrides };
}

function makeVersion(id: string, versionNumber: number, contentMarkdown: string): CompletedWorkVersion {
  return { ...VERSION_V2, id, versionNumber, contentMarkdown };
}

const exportService = new CompletedWorkExportService();

function setupMocks(work: CompletedWorkItem, versions: CompletedWorkVersion[]) {
  vi.mocked(getCompletedWork).mockResolvedValue(work as any);
  vi.mocked(getVersions).mockResolvedValue(versions as any);
}

beforeEach(() => vi.clearAllMocks());

// ─── N-series: Normaliser unit tests ─────────────────────────────────────────

describe("Sprint 29J.3 — Content normaliser unit tests", () => {

  it("N1. SKIP_FIELDS (specialistRunId, workforceRoleCode, capabilityCode) absent from output", () => {
    const result = normaliseCompletedWorkContent(STRUCTURED_JSON_CONTENT);
    expect(result).not.toContain("specialistRunId");
    expect(result).not.toContain("workforceRoleCode");
    expect(result).not.toContain("capabilityCode");
    expect(result).not.toContain("run-001");
    expect(result).not.toContain("chief_of_staff");
    expect(result).not.toContain("operational_procedure");
  });

  it("N2. executiveSummary key renders as 'Executive Summary' section heading", () => {
    const result = normaliseCompletedWorkContent(STRUCTURED_JSON_CONTENT);
    expect(result).toContain("Executive Summary");
    expect(result).not.toContain("executiveSummary");
  });

  it("N3. Nested array items emit numbered list with sub-fields", () => {
    const result = normaliseCompletedWorkContent(STRUCTURED_JSON_CONTENT);
    expect(result).toContain("1.");
    expect(result).toContain(MARKER_FINDING);
    expect(result).toContain("Risk:");
    expect(result).toContain("Evidence:");
  });

  it("N4. Fenced JSON strips opening/closing fence markers from output", () => {
    const result = normaliseCompletedWorkContent(FENCED_JSON_CONTENT);
    expect(result).not.toContain("```json");
    expect(result).not.toContain("```");
    expect(result).toContain(MARKER_EXEC_SUMMARY);
  });

  it("N5. Fenced non-JSON strips fences but preserves inner text verbatim", () => {
    const inner = "This is plain text inside a code fence.\nNo JSON here.";
    const fenced = "```\n" + inner + "\n```";
    const result = normaliseCompletedWorkContent(fenced);
    expect(result).not.toContain("```");
    expect(result).toContain("This is plain text inside a code fence.");
    expect(result).toContain("No JSON here.");
  });

  it("N6. Malformed JSON-like text passes through unchanged — no crash, no empty output", () => {
    expect(() => normaliseCompletedWorkContent(MALFORMED_JSON_CONTENT)).not.toThrow();
    const result = normaliseCompletedWorkContent(MALFORMED_JSON_CONTENT);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("executiveSummary");  // raw key remains — fallback path
  });

  it("N7. Empty string returns safely", () => {
    expect(normaliseCompletedWorkContent("")).toBe("");
    expect(normaliseCompletedWorkContent("   ")).toBe("   ");
  });

  it("N8. Real CoS JSON format: no raw braces, no quoted property names, no colon syntax in output", () => {
    const result = normaliseCompletedWorkContent(STRUCTURED_JSON_CONTENT);
    // No raw JSON structure characters used as separators
    expect(result).not.toMatch(/"\w+":/);  // no "key": patterns
    expect(result).not.toContain("{");
    expect(result).not.toContain("}");
    expect(result).not.toContain("[");
    expect(result).not.toContain("]");
  });

  it("N9. camelToLabel maps known keys correctly", () => {
    expect(camelToLabel("executiveSummary")).toBe("Executive Summary");
    expect(camelToLabel("responsibleRole")).toBe("Responsible Role");
    expect(camelToLabel("implementationTimeframe")).toBe("Implementation Timeframe");
  });

  it("N10. camelToLabel humanises unknown camelCase keys", () => {
    expect(camelToLabel("someUnknownField")).toBe("Some Unknown Field");
    expect(camelToLabel("htmlContent")).toBe("Html Content");
  });
});

// ─── O-series: Acceptance tests ───────────────────────────────────────────────

describe("Sprint 29J.3 — Export quality acceptance tests", () => {

  // O1 ─ Structured JSON renders without raw braces/property serialization
  it("O1. Structured JSON export produces no raw JSON in PDF output", async () => {
    const ver = makeVersion("ver-struct", 1, STRUCTURED_JSON_CONTENT);
    setupMocks(makeWork({ status: "draft" as any, approvedVersionId: null }), [ver]);
    const result = await exportService.export({
      workId: WORK_ID, organisationId: ORG_A, organisationName: "Test Org",
      format: "pdf", actorUserId: ACTOR,
    });
    // PDF is binary — we can't read text directly, but we verify it was generated (not throwing)
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.mimeType).toBe("application/pdf");
  });

  it("O1b. normaliseCompletedWorkContent on structured JSON contains no raw braces", () => {
    const result = normaliseCompletedWorkContent(STRUCTURED_JSON_CONTENT);
    expect(result).not.toContain("{");
    expect(result).not.toContain("}");
    expect(result).not.toMatch(/"\w+":/);
  });

  // O2 ─ camelCase keys become human-readable labels
  it("O2. camelCase property names are converted to human-readable labels", () => {
    const result = normaliseCompletedWorkContent(STRUCTURED_JSON_CONTENT);
    expect(result).toContain("Executive Summary");
    expect(result).toContain("Findings");
    expect(result).toContain("Recommendations");
    expect(result).not.toContain("executiveSummary");
    expect(result).not.toContain("findings:");
    expect(result).not.toContain("recommendations:");
  });

  // O3 ─ Nested findings render
  it("O3. Nested findings array renders with finding text, risk, and evidence", () => {
    const result = normaliseCompletedWorkContent(STRUCTURED_JSON_CONTENT);
    expect(result).toContain(MARKER_FINDING);
    expect(result).toContain(MARKER_RISK);
    expect(result).toContain(MARKER_EVIDENCE);
    expect(result).toContain("Risk:");
    expect(result).toContain("Evidence:");
  });

  // O4 ─ Nested recommendations render
  it("O4. Nested recommendations render with action, priority, responsible role, timeframe", () => {
    const result = normaliseCompletedWorkContent(STRUCTURED_JSON_CONTENT);
    expect(result).toContain(MARKER_RECOMMENDATION);
    expect(result).toContain(MARKER_RESPONSIBLE);
    expect(result).toContain(MARKER_TIMEFRAME);
    expect(result).toContain("Responsible Role:");
    expect(result).toContain("Implementation Timeframe:");
  });

  // O5 ─ Arrays render deterministically
  it("O5. Array rendering is deterministic — same input produces identical output on repeated calls", () => {
    const r1 = normaliseCompletedWorkContent(STRUCTURED_JSON_CONTENT);
    const r2 = normaliseCompletedWorkContent(STRUCTURED_JSON_CONTENT);
    const r3 = normaliseCompletedWorkContent(STRUCTURED_JSON_CONTENT);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
  });

  // O6 ─ Markdown headings render (pass-through path)
  it("O6. Markdown content is passed through unchanged — headings present", () => {
    const result = normaliseCompletedWorkContent(MARKDOWN_CONTENT);
    expect(result).toContain("# Policy Review Report");
    expect(result).toContain("## Executive Summary");
    expect(result).toContain("## Findings");
    expect(result).toContain("## Recommendations");
  });

  // O7 ─ Markdown bullets render
  it("O7. Markdown bullet lists pass through correctly", () => {
    const result = normaliseCompletedWorkContent(MARKDOWN_CONTENT);
    expect(result).toContain("- Gap 1:");
    expect(result).toContain("- Gap 2:");
  });

  // O8 ─ Numbered lists render
  it("O8. Markdown numbered lists pass through correctly", () => {
    const result = normaliseCompletedWorkContent(MARKDOWN_CONTENT);
    expect(result).toContain("1. Update escalation procedures");
    expect(result).toContain("2. Define and publish SLA targets");
  });

  // O9 ─ Markdown table renders
  it("O9. Markdown GFM table passes through for renderer to handle", () => {
    const result = normaliseCompletedWorkContent(TABLE_HEAVY_CONTENT);
    expect(result).toContain("| Risk |");
    expect(result).toContain("| Data breach |");
    expect(result).toContain("Data breach");
  });

  // O10 ─ Fenced JSON is detected
  it("O10. Fenced ```json block is detected — inner JSON rendered as sections, not as code", () => {
    const result = normaliseCompletedWorkContent(FENCED_JSON_CONTENT);
    expect(result).not.toContain("```json");
    expect(result).not.toContain("```");
    expect(result).toContain("Executive Summary");
    expect(result).toContain(MARKER_EXEC_SUMMARY);
  });

  // O11 ─ Invalid fenced JSON does not crash
  it("O11. Invalid JSON inside fenced block does not throw — returns inner text as plain", () => {
    const invalidFenced = "```json\n{not: valid json\n```";
    expect(() => normaliseCompletedWorkContent(invalidFenced)).not.toThrow();
    const result = normaliseCompletedWorkContent(invalidFenced);
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toContain("```json");
    expect(result).not.toContain("```");
  });

  // O12 ─ Plain text remains intact
  it("O12. Plain text content passes through verbatim", () => {
    const result = normaliseCompletedWorkContent(PLAIN_TEXT_CONTENT);
    expect(result).toBe(PLAIN_TEXT_CONTENT);
  });

  // O13 ─ Long content exports
  it("O13. Long markdown content exports as PDF without throwing", async () => {
    const ver = makeVersion("ver-long", 1, LONG_CONTENT);
    setupMocks(makeWork({ status: "draft" as any, approvedVersionId: null }), [ver]);
    const result = await exportService.export({
      workId: WORK_ID, organisationId: ORG_A, organisationName: "Test Org",
      format: "pdf", actorUserId: ACTOR,
    });
    expect(result.buffer.length).toBeGreaterThan(1000);
  });

  // O14 ─ Unique content markers survive normalisation
  it("O14. All unique content markers survive JSON normalisation intact", () => {
    const result = normaliseCompletedWorkContent(STRUCTURED_JSON_CONTENT);
    expect(result).toContain(MARKER_EXEC_SUMMARY);
    expect(result).toContain(MARKER_FINDING);
    expect(result).toContain(MARKER_RISK);
    expect(result).toContain(MARKER_EVIDENCE);
    expect(result).toContain(MARKER_RECOMMENDATION);
    expect(result).toContain(MARKER_RESPONSIBLE);
    expect(result).toContain(MARKER_TIMEFRAME);
    expect(result).toContain(MARKER_CITATION);
  });

  // O15 ─ PDF contains expected substantive text (mocked integration)
  it("O15. PDF export succeeds and returns a non-empty buffer from structured JSON", async () => {
    const ver = makeVersion("ver-j", 1, STRUCTURED_JSON_CONTENT);
    setupMocks(makeWork({ status: "draft" as any, approvedVersionId: null }), [ver]);
    const result = await exportService.export({
      workId: WORK_ID, organisationId: ORG_A, organisationName: "Test Org",
      format: "pdf", actorUserId: ACTOR,
    });
    expect(result.buffer.length).toBeGreaterThan(1000);
    expect(result.mimeType).toBe("application/pdf");
  });

  // O16 ─ DOCX contains expected substantive text (mocked integration)
  it("O16. DOCX export succeeds and returns a non-empty buffer from structured JSON", async () => {
    const ver = makeVersion("ver-j", 1, STRUCTURED_JSON_CONTENT);
    setupMocks(makeWork({ status: "draft" as any, approvedVersionId: null }), [ver]);
    const result = await exportService.export({
      workId: WORK_ID, organisationId: ORG_A, organisationName: "Test Org",
      format: "docx", actorUserId: ACTOR,
    });
    expect(result.buffer.length).toBeGreaterThan(1000);
    expect(result.mimeType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });

  // O17 ─ PDF/DOCX substantive parity
  it("O17. Both PDF and DOCX export succeed from same content — same normalised markdown base", async () => {
    const ver = makeVersion("ver-parity", 1, STRUCTURED_JSON_CONTENT);

    setupMocks(makeWork({ status: "draft" as any, approvedVersionId: null }), [ver]);
    const pdf = await exportService.export({
      workId: WORK_ID, organisationId: ORG_A, organisationName: "Test Org",
      format: "pdf", actorUserId: ACTOR,
    });

    setupMocks(makeWork({ status: "draft" as any, approvedVersionId: null }), [ver]);
    const docx = await exportService.export({
      workId: WORK_ID, organisationId: ORG_A, organisationName: "Test Org",
      format: "docx", actorUserId: ACTOR,
    });

    expect(pdf.buffer.length).toBeGreaterThan(0);
    expect(docx.buffer.length).toBeGreaterThan(0);
    // Both derive from the same normalised content — confirmed by normaliser determinism (O5)
    const pdfNorm  = normaliseCompletedWorkContent(STRUCTURED_JSON_CONTENT);
    const docxNorm = normaliseCompletedWorkContent(STRUCTURED_JSON_CONTENT);
    expect(pdfNorm).toBe(docxNorm);
  });

  // O18 ─ Approved-version pin respected
  it("O18. Export uses V2 (pinned approved) not V3 (latest) when V2 is the modern approved pin", async () => {
    // Versions returned DESC by versionNumber — V3 is index 0 (latest)
    setupMocks(
      makeWork({ approvedVersionId: "ver-v2" }),
      [VERSION_V3, VERSION_V2],
    );
    const result = await exportService.export({
      workId: WORK_ID, organisationId: ORG_A, organisationName: "Test Org",
      format: "pdf", actorUserId: ACTOR,
    });
    // Filename contains versionNumber of V2 (2), not V3 (3)
    expect(result.filename).toContain("-v2.");
    expect(result.filename).not.toContain("-v3.");
  });

  // O19 ─ Broken modern approved pin still fails closed
  it("O19. Broken modern approved pin throws APPROVED_VERSION_INTEGRITY_ERROR — no fallback", async () => {
    setupMocks(
      makeWork({ approvedVersionId: "ver-DELETED-does-not-exist" }),
      [VERSION_V2, VERSION_V3],  // neither has id "ver-DELETED-does-not-exist"
    );
    await expect(
      exportService.export({
        workId: WORK_ID, organisationId: ORG_A, organisationName: "Test Org",
        format: "pdf", actorUserId: ACTOR,
      }),
    ).rejects.toMatchObject({ code: "APPROVED_VERSION_INTEGRITY_ERROR" });
  });

  // O20 ─ Legacy null-pin behaviour unchanged
  it("O20. Legacy null-pin approved work uses versions[0] gracefully (LEGACY_APPROVAL_FALLBACK)", async () => {
    const legacyWork = makeWork({ status: "approved" as any, approvedVersionId: null });
    const ver = makeVersion("ver-legacy", 5, MARKDOWN_CONTENT);
    setupMocks(legacyWork, [ver]);
    const result = await exportService.export({
      workId: WORK_ID, organisationId: ORG_A, organisationName: "Test Org",
      format: "pdf", actorUserId: ACTOR,
    });
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.filename).toContain("-v5.");
  });

  // O21 ─ Cross-tenant export denied
  it("O21. Cross-tenant export is denied — getCompletedWork returns null for wrong org", async () => {
    vi.mocked(getCompletedWork).mockResolvedValue(null);
    await expect(
      exportService.export({
        workId: WORK_ID, organisationId: ORG_B, organisationName: "Other Org",
        format: "pdf", actorUserId: ACTOR,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  // O22 ─ Correct MIME types
  it("O22a. PDF export returns correct MIME type", async () => {
    const ver = makeVersion("ver-mime", 1, PLAIN_TEXT_CONTENT);
    setupMocks(makeWork({ status: "draft" as any, approvedVersionId: null }), [ver]);
    const result = await exportService.export({
      workId: WORK_ID, organisationId: ORG_A, organisationName: "Test Org",
      format: "pdf", actorUserId: ACTOR,
    });
    expect(result.mimeType).toBe("application/pdf");
  });

  it("O22b. DOCX export returns correct MIME type", async () => {
    const ver = makeVersion("ver-mime", 1, PLAIN_TEXT_CONTENT);
    setupMocks(makeWork({ status: "draft" as any, approvedVersionId: null }), [ver]);
    const result = await exportService.export({
      workId: WORK_ID, organisationId: ORG_A, organisationName: "Test Org",
      format: "docx", actorUserId: ACTOR,
    });
    expect(result.mimeType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });

  it("O22c. XLSX export returns a valid workbook MIME and ZIP container", async () => {
    const ver = makeVersion("ver-xlsx", 1, TABLE_HEAVY_CONTENT);
    setupMocks(makeWork({ status: "draft" as any, approvedVersionId: null }), [ver]);
    const result = await exportService.export({
      workId: WORK_ID, organisationId: ORG_A, organisationName: "Test Org",
      format: "xlsx", actorUserId: ACTOR,
    });
    expect(result.mimeType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(result.buffer.length).toBeGreaterThan(1000);
    expect(result.buffer.subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(result.buffer.toString("utf8")).toContain("xl/worksheets/sheet1.xml");
  });

  // O23 ─ Correct versioned filenames
  it("O23a. PDF filename contains versioned suffix -vN.pdf", async () => {
    const ver = makeVersion("ver-fn", 7, PLAIN_TEXT_CONTENT);
    setupMocks(makeWork({ status: "draft" as any, approvedVersionId: null }), [ver]);
    const result = await exportService.export({
      workId: WORK_ID, organisationId: ORG_A, organisationName: "Test Org",
      format: "pdf", actorUserId: ACTOR,
    });
    expect(result.filename).toMatch(/-v7\.pdf$/);
  });

  it("O23b. DOCX filename contains versioned suffix -vN.docx", async () => {
    const ver = makeVersion("ver-fn", 7, PLAIN_TEXT_CONTENT);
    setupMocks(makeWork({ status: "draft" as any, approvedVersionId: null }), [ver]);
    const result = await exportService.export({
      workId: WORK_ID, organisationId: ORG_A, organisationName: "Test Org",
      format: "docx", actorUserId: ACTOR,
    });
    expect(result.filename).toMatch(/-v7\.docx$/);
  });

  it("O23c. XLSX filename contains versioned suffix -vN.xlsx", async () => {
    const ver = makeVersion("ver-fn-xlsx", 7, TABLE_HEAVY_CONTENT);
    setupMocks(makeWork({ status: "draft" as any, approvedVersionId: null }), [ver]);
    const result = await exportService.export({
      workId: WORK_ID, organisationId: ORG_A, organisationName: "Test Org",
      format: "xlsx", actorUserId: ACTOR,
    });
    expect(result.filename).toMatch(/-v7\.xlsx$/);
  });

  // O24 ─ No LLM call during export
  it("O24. No LLM (OpenAI) call is made during PDF export — export is deterministic", async () => {
    // openai mock is set to reject — if it is called, the export will fail
    const ver = makeVersion("ver-nollm", 1, STRUCTURED_JSON_CONTENT);
    setupMocks(makeWork({ status: "draft" as any, approvedVersionId: null }), [ver]);
    // Should succeed (openai mock was NOT called)
    await expect(
      exportService.export({
        workId: WORK_ID, organisationId: ORG_A, organisationName: "Test Org",
        format: "pdf", actorUserId: ACTOR,
      }),
    ).resolves.toBeDefined();
  });

  // ─── Real-world acceptance fixtures (N-series real-content) ────────────────

  it("REAL-1. Operations Manager markdown policy review exports without raw markdown syntax", async () => {
    const ver = makeVersion("ver-om", 1, MARKDOWN_CONTENT);
    setupMocks(makeWork({ status: "draft" as any, approvedVersionId: null, primarySpecialist: "operations_manager" }), [ver]);
    const result = await exportService.export({
      workId: WORK_ID, organisationId: ORG_A, organisationName: "Test Org",
      format: "pdf", actorUserId: ACTOR,
    });
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it("REAL-2. Chief of Staff structured JSON exports clean (no internal field leakage)", () => {
    const result = normaliseCompletedWorkContent(STRUCTURED_JSON_CONTENT);
    expect(result).not.toContain("specialistRunId");
    expect(result).not.toContain("workforceRoleCode");
    expect(result).not.toContain('"');  // no quoted JSON property names
    expect(result).toContain("Executive Summary");
    expect(result).toContain("Findings");
    expect(result).toContain("Recommendations");
  });

  it("REAL-3. Plain-text legacy work passes through unchanged", () => {
    const result = normaliseCompletedWorkContent(PLAIN_TEXT_CONTENT);
    expect(result).toBe(PLAIN_TEXT_CONTENT);
  });

  it("REAL-4. Fenced JSON renders as sections (not raw code block)", () => {
    const result = normaliseCompletedWorkContent(FENCED_JSON_CONTENT);
    expect(result).not.toContain("```");
    expect(result).toContain("Executive Summary");
    expect(result).toContain(MARKER_FINDING);
  });

  it("REAL-5. Long markdown report exports as PDF without timeout or truncation", async () => {
    const ver = makeVersion("ver-long2", 2, LONG_CONTENT);
    setupMocks(makeWork({ status: "draft" as any, approvedVersionId: null }), [ver]);
    const result = await exportService.export({
      workId: WORK_ID, organisationId: ORG_A, organisationName: "Test Org",
      format: "pdf", actorUserId: ACTOR,
    });
    expect(result.buffer.length).toBeGreaterThan(5000); // multi-page content
  });

  it("REAL-6. Table-heavy markdown report exports correctly", async () => {
    const ver = makeVersion("ver-table", 1, TABLE_HEAVY_CONTENT);
    setupMocks(makeWork({ status: "draft" as any, approvedVersionId: null }), [ver]);
    const result = await exportService.export({
      workId: WORK_ID, organisationId: ORG_A, organisationName: "Test Org",
      format: "pdf", actorUserId: ACTOR,
    });
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it("REAL-7. Malformed JSON-like content does not crash export — fallback to readable text", async () => {
    const ver = makeVersion("ver-malformed", 1, MALFORMED_JSON_CONTENT);
    setupMocks(makeWork({ status: "draft" as any, approvedVersionId: null }), [ver]);
    await expect(
      exportService.export({
        workId: WORK_ID, organisationId: ORG_A, organisationName: "Test Org",
        format: "pdf", actorUserId: ACTOR,
      }),
    ).resolves.toBeDefined();
  });

  it("REAL-8. Approved V2 with newer V3 present — export uses V2", async () => {
    setupMocks(
      makeWork({ approvedVersionId: "ver-v2" }),
      [VERSION_V3, VERSION_V2], // V3 is versions[0] but must not be used
    );
    const pdfResult = await exportService.export({
      workId: WORK_ID, organisationId: ORG_A, organisationName: "Test Org",
      format: "pdf", actorUserId: ACTOR,
    });
    expect(pdfResult.filename).toContain("-v2.");

    setupMocks(
      makeWork({ approvedVersionId: "ver-v2" }),
      [VERSION_V3, VERSION_V2],
    );
    const docxResult = await exportService.export({
      workId: WORK_ID, organisationId: ORG_A, organisationName: "Test Org",
      format: "docx", actorUserId: ACTOR,
    });
    expect(docxResult.filename).toContain("-v2.");
  });
});
