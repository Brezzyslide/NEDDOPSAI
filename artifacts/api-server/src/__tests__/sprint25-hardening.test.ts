/**
 * Sprint 25 Hardening
 *
 * Tests:
 *   Part 1 — Server-backed comment resolution
 *   Part 2 — PDF generation (PdfExporter)
 *   Part 3 — DOCX generation (DocxExporter)
 *   Part 4 — Markdown generation (MarkdownExporter)
 *   Part 5 — Export service (CompletedWorkExportService) + audit logging
 *   Part 6 — Export architecture (parseMarkdown intermediate model)
 *   Part 7 — Tenant isolation on comment resolution
 *   Part 8 — Invalid document / format handling
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock db ──────────────────────────────────────────────────────────────────

const mockDb = vi.hoisted(() => ({
  select:  vi.fn(),
  from:    vi.fn(),
  where:   vi.fn(),
  limit:   vi.fn(),
  offset:  vi.fn(),
  orderBy: vi.fn(),
  insert:  vi.fn(),
  values:  vi.fn(),
  update:  vi.fn(),
  set:     vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  return {
    ...actual,
    db: {
      select:  () => mockDb,
      insert:  () => mockDb,
      update:  () => mockDb,
      execute: mockDb.execute,
    },
  };
});

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: vi.fn().mockResolvedValue(undefined),
}));

/**
 * Re-establish the Drizzle chain after any vi.clearAllMocks() / vi.resetAllMocks().
 * Every intermediate method returns mockDb so terminal calls (.limit, .orderBy)
 * can be overridden with specific return values per test.
 */
function resetChain() {
  for (const k of ["from","where","set","orderBy","limit","offset","values"] as const) {
    mockDb[k].mockReturnValue(mockDb);
  }
  (mockDb as any).logOrgEvent?.mockResolvedValue?.(undefined);
}

import {
  parseMarkdown,
  MarkdownExporter,
  PdfExporter,
  DocxExporter,
  CompletedWorkExportService,
  type IntermediateDocument,
} from "../services/completedWorkExportService.js";
import { logOrgEvent } from "../services/auditService.js";
import { getRegistryEntry } from "../services/blueprintRegistry.js";
import { derivePlaceholderTokensFromTemplateField } from "../services/professionalExecutionContextService.js";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

function makeDoc(overrides?: Partial<IntermediateDocument>): IntermediateDocument {
  return {
    title:          "Annual Compliance Report",
    organisation:   "Sunrise Care Services",
    generatedDate:  "3 August 2026",
    specialist:     "Compliance Manager",
    approvalStatus: "Approved",
    version:        2,
    nodes: [
      { type: "heading",     level: 1, content: "Executive Summary" },
      { type: "paragraph",   content: "This report outlines compliance findings." },
      { type: "heading",     level: 2, content: "Key Findings" },
      { type: "list", ordered: false, children: [
        { type: "list_item", content: "Finding A" },
        { type: "list_item", content: "Finding B" },
      ]},
      { type: "table", children: [
        { type: "table_row", children: [
          { type: "table_cell", content: "Area" },
          { type: "table_cell", content: "Status" },
        ]},
        { type: "table_row", children: [
          { type: "table_cell", content: "Documentation" },
          { type: "table_cell", content: "Compliant" },
        ]},
      ]},
      { type: "hr" },
      { type: "code", content: "SELECT * FROM incidents;", language: "sql" },
      { type: "blockquote", content: "All obligations met for Q1." },
    ],
    ...overrides,
  };
}

function carePlanPlaceholderTokens(): string[] {
  const blueprint = getRegistryEntry("care_plan");
  if (!blueprint) throw new Error("missing care_plan blueprint");
  return Array.from(new Set(
    blueprint.sections
      .flatMap((section) => section.fields ?? [])
      .flatMap(derivePlaceholderTokensFromTemplateField),
  ));
}

function documentWithCarePlanPlaceholders(): IntermediateDocument {
  const tokens = carePlanPlaceholderTokens();
  return makeDoc({
    title: "Care Plan Template",
    nodes: parseMarkdown([
      "# Care Plan Template",
      "",
      "## Placeholder Register",
      "",
      tokens.join(" "),
    ].join("\n")),
  });
}

function readDocxXml(buffer: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "needsops-docx-"));
  const path = join(dir, "document.docx");
  try {
    writeFileSync(path, buffer);
    return execFileSync("unzip", ["-p", path, "word/document.xml"], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Part 6 — parseMarkdown intermediate model
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseMarkdown", () => {
  it("parses h1 heading", () => {
    const nodes = parseMarkdown("# Executive Summary");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ type: "heading", level: 1, content: "Executive Summary" });
  });

  it("parses h2 heading", () => {
    const nodes = parseMarkdown("## Section Two");
    expect(nodes[0]).toMatchObject({ type: "heading", level: 2 });
  });

  it("strips bold markup from heading content", () => {
    const nodes = parseMarkdown("# **Bold Title**");
    expect(nodes[0]!.content).toBe("Bold Title");
  });

  it("parses paragraph", () => {
    const nodes = parseMarkdown("This is a paragraph.");
    expect(nodes[0]).toMatchObject({ type: "paragraph", content: "This is a paragraph." });
  });

  it("strips bold from paragraph", () => {
    const nodes = parseMarkdown("Some **important** text.");
    expect(nodes[0]!.content).toBe("Some important text.");
  });

  it("parses unordered list", () => {
    const md = "- Item A\n- Item B\n- Item C";
    const nodes = parseMarkdown(md);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.type).toBe("list");
    expect(nodes[0]!.ordered).toBe(false);
    expect(nodes[0]!.children).toHaveLength(3);
    expect(nodes[0]!.children![0]!.content).toBe("Item A");
  });

  it("parses ordered list", () => {
    const md = "1. First\n2. Second\n3. Third";
    const nodes = parseMarkdown(md);
    expect(nodes[0]!.ordered).toBe(true);
    expect(nodes[0]!.children).toHaveLength(3);
  });

  it("parses fenced code block", () => {
    const md = "```sql\nSELECT 1;\n```";
    const nodes = parseMarkdown(md);
    expect(nodes[0]).toMatchObject({ type: "code", language: "sql", content: "SELECT 1;" });
  });

  it("parses blockquote", () => {
    const md = "> All obligations met.";
    const nodes = parseMarkdown(md);
    expect(nodes[0]).toMatchObject({ type: "blockquote", content: "All obligations met." });
  });

  it("parses horizontal rule", () => {
    const nodes = parseMarkdown("---");
    expect(nodes[0]).toMatchObject({ type: "hr" });
  });

  it("parses GFM table", () => {
    const md = "| Col A | Col B |\n|-------|-------|\n| v1 | v2 |";
    const nodes = parseMarkdown(md);
    expect(nodes[0]!.type).toBe("table");
    // separator row filtered — 2 data rows
    expect(nodes[0]!.children!.length).toBeGreaterThanOrEqual(1);
  });

  it("skips empty lines without generating nodes", () => {
    const md = "# Heading\n\n\nParagraph";
    const nodes = parseMarkdown(md);
    expect(nodes).toHaveLength(2);
  });

  it("strips inline link markup — keeps label", () => {
    const nodes = parseMarkdown("[Click here](https://example.com)");
    expect(nodes[0]!.content).toBe("Click here");
  });

  it("handles empty markdown gracefully", () => {
    const nodes = parseMarkdown("");
    expect(nodes).toHaveLength(0);
  });

  it("handles markdown with only whitespace", () => {
    const nodes = parseMarkdown("   \n  \n  ");
    expect(nodes).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Part 4 — MarkdownExporter
// ═══════════════════════════════════════════════════════════════════════════════

describe("MarkdownExporter", () => {
  const exporter = new MarkdownExporter();

  it("returns a Buffer", () => {
    const doc = makeDoc();
    const result = exporter.export(doc, "# Content\n\nHello.");
    expect(result.buffer).toBeInstanceOf(Buffer);
  });

  it("includes document title in output", () => {
    const doc = makeDoc();
    const result = exporter.export(doc, "Body text");
    const text = result.buffer.toString("utf-8");
    expect(text).toContain("Annual Compliance Report");
  });

  it("includes organisation metadata", () => {
    const doc = makeDoc();
    const result = exporter.export(doc, "");
    const text = result.buffer.toString("utf-8");
    expect(text).toContain("Sunrise Care Services");
  });

  it("includes specialist name", () => {
    const doc = makeDoc();
    const result = exporter.export(doc, "");
    expect(result.buffer.toString("utf-8")).toContain("Compliance Manager");
  });

  it("includes approval status", () => {
    const doc = makeDoc();
    const result = exporter.export(doc, "");
    expect(result.buffer.toString("utf-8")).toContain("Approved");
  });

  it("includes version number", () => {
    const doc = makeDoc();
    const result = exporter.export(doc, "");
    expect(result.buffer.toString("utf-8")).toContain("2");
  });

  it("sets correct mimeType", () => {
    const result = exporter.export(makeDoc(), "");
    expect(result.mimeType).toBe("text/markdown");
  });

  it("sets .md extension in filename", () => {
    const result = exporter.export(makeDoc(), "");
    expect(result.filename).toMatch(/\.md$/);
  });

  it("sanitises filename — no special characters", () => {
    const doc = makeDoc({ title: "Report: Q1/2026 — Final!" });
    const result = exporter.export(doc, "");
    expect(result.filename).not.toMatch(/[:/—!]/);
  });

  it("preserves original markdown body in output", () => {
    const body = "## Custom section\n\nSome detail.";
    const result = exporter.export(makeDoc(), body);
    expect(result.buffer.toString("utf-8")).toContain("Custom section");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Part 2 — PdfExporter
// ═══════════════════════════════════════════════════════════════════════════════

describe("PdfExporter", () => {
  const exporter = new PdfExporter();

  it("returns a Buffer", async () => {
    const result = await exporter.export(makeDoc());
    expect(result.buffer).toBeInstanceOf(Buffer);
  });

  it("produces non-empty output", async () => {
    const result = await exporter.export(makeDoc());
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it("starts with PDF magic bytes", async () => {
    const result = await exporter.export(makeDoc());
    const header = result.buffer.slice(0, 4).toString("ascii");
    expect(header).toBe("%PDF");
  });

  it("sets correct mimeType", async () => {
    const result = await exporter.export(makeDoc());
    expect(result.mimeType).toBe("application/pdf");
  });

  it("sets .pdf extension in filename", async () => {
    const result = await exporter.export(makeDoc());
    expect(result.filename).toMatch(/\.pdf$/);
  });

  it("preserves every declared care-plan placeholder token in PDF text", async () => {
    const { PDFParse } = await import("pdf-parse");
    const tokens = carePlanPlaceholderTokens();
    const result = await exporter.export(documentWithCarePlanPlaceholders());
    const parser = new PDFParse({ data: new Uint8Array(result.buffer) });
    const parsed = await parser.getText();
    await parser.destroy();
    const compactText = parsed.text.replace(/\s+/g, "");

    for (const token of tokens) {
      expect(compactText).toContain(token);
    }
  });

  it("handles heading-only document", async () => {
    const doc = makeDoc({ nodes: [{ type: "heading", level: 1, content: "Title Only" }] });
    const result = await exporter.export(doc);
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it("handles empty nodes list", async () => {
    const doc = makeDoc({ nodes: [] });
    const result = await exporter.export(doc);
    expect(result.buffer).toBeInstanceOf(Buffer);
  });

  it("handles code blocks", async () => {
    const doc = makeDoc({ nodes: [{ type: "code", content: "const x = 1;", language: "ts" }] });
    const result = await exporter.export(doc);
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it("handles tables", async () => {
    const doc = makeDoc({ nodes: [
      { type: "table", children: [
        { type: "table_row", children: [
          { type: "table_cell", content: "A" },
          { type: "table_cell", content: "B" },
        ]},
      ]},
    ]});
    const result = await exporter.export(doc);
    expect(result.buffer.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Part 3 — DocxExporter
// ═══════════════════════════════════════════════════════════════════════════════

describe("DocxExporter", () => {
  const exporter = new DocxExporter();

  it("returns a Buffer", async () => {
    const result = await exporter.export(makeDoc());
    expect(result.buffer).toBeInstanceOf(Buffer);
  });

  it("produces non-empty output", async () => {
    const result = await exporter.export(makeDoc());
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it("starts with PK magic bytes (valid ZIP / DOCX)", async () => {
    const result = await exporter.export(makeDoc());
    // DOCX files are ZIP archives — magic bytes are PK (0x50 0x4B)
    expect(result.buffer[0]).toBe(0x50); // 'P'
    expect(result.buffer[1]).toBe(0x4b); // 'K'
  });

  it("sets correct mimeType", async () => {
    const result = await exporter.export(makeDoc());
    expect(result.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("sets .docx extension in filename", async () => {
    const result = await exporter.export(makeDoc());
    expect(result.filename).toMatch(/\.docx$/);
  });

  it("preserves every declared care-plan placeholder token in DOCX XML", async () => {
    const tokens = carePlanPlaceholderTokens();
    const result = await exporter.export(documentWithCarePlanPlaceholders());
    const xml = readDocxXml(result.buffer);

    for (const token of tokens) {
      expect(xml).toContain(token.replace(/^\[|\]$/g, ""));
    }
  });

  it("handles empty nodes list", async () => {
    const doc = makeDoc({ nodes: [] });
    const result = await exporter.export(doc);
    expect(result.buffer).toBeInstanceOf(Buffer);
  });

  it("handles list nodes (ordered + unordered)", async () => {
    const doc = makeDoc({ nodes: [
      { type: "list", ordered: true,  children: [{ type: "list_item", content: "Step 1" }] },
      { type: "list", ordered: false, children: [{ type: "list_item", content: "Bullet" }] },
    ]});
    const result = await exporter.export(doc);
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it("handles blockquote nodes", async () => {
    const doc = makeDoc({ nodes: [{ type: "blockquote", content: "Important note" }] });
    const result = await exporter.export(doc);
    expect(result.buffer.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Part 5 — CompletedWorkExportService (with audit logging)
// ═══════════════════════════════════════════════════════════════════════════════

describe("CompletedWorkExportService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
    (logOrgEvent as any).mockResolvedValue(undefined);
  });

  function setupDbWithWork(status = "approved", versionNumber = 1) {
    // getCompletedWork → select().from().where().limit(1)
    // getVersions      → select().from().where().orderBy()
    let callCount = 0;
    mockDb.limit.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve([{
          id: "work-1",
          organizationId: "org-1",
          title: "Compliance Plan 2026",
          primarySpecialist: "compliance_manager",
          status,
          blueprintId: null, manifestId: null, conversationId: null,
          currentVersionId: "ver-1",
          createdByUserId: "user-1", approvedByUserId: null,
          approvedAt: null, rejectedAt: null, archivedAt: null,
          reopenedAt: null, supersededById: null,
          createdAt: new Date(), updatedAt: new Date(),
          approvalWorkflow: {},
        }]);
      }
      return Promise.resolve([]);
    });
    mockDb.orderBy.mockResolvedValue([{
      id: "ver-1",
      completedWorkId: "work-1",
      organizationId: "org-1",
      versionNumber,
      contentMarkdown: "# Compliance Plan\n\nThis plan covers all key areas.\n\n## Key Areas\n\n- Privacy\n- Safety",
      qualityScore: 88,
      reviewDimensions: [],
      changeNote: "Initial",
      isAutoRevision: "false",
      createdByUserId: "user-1",
      createdAt: new Date(),
    }]);
  }

  it("exports markdown and returns correct mimeType", async () => {
    setupDbWithWork();
    const svc = new CompletedWorkExportService();
    const result = await svc.export({
      workId: "work-1", organisationId: "org-1",
      organisationName: "Test Org", format: "md", actorUserId: "user-1",
    });
    expect(result.mimeType).toBe("text/markdown");
    expect(result.buffer).toBeInstanceOf(Buffer);
  });

  it("exports PDF and returns correct mimeType", async () => {
    setupDbWithWork();
    const svc = new CompletedWorkExportService();
    const result = await svc.export({
      workId: "work-1", organisationId: "org-1",
      organisationName: "Test Org", format: "pdf", actorUserId: "user-1",
    });
    expect(result.mimeType).toBe("application/pdf");
    expect(result.buffer.slice(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("exports DOCX and returns correct mimeType", async () => {
    setupDbWithWork();
    const svc = new CompletedWorkExportService();
    const result = await svc.export({
      workId: "work-1", organisationId: "org-1",
      organisationName: "Test Org", format: "docx", actorUserId: "user-1",
    });
    expect(result.mimeType).toContain("wordprocessingml");
  });

  it("calls logOrgEvent with export audit data", async () => {
    setupDbWithWork();
    const svc = new CompletedWorkExportService();
    await svc.export({
      workId: "work-1", organisationId: "org-1",
      organisationName: "Test Org", format: "pdf", actorUserId: "user-99",
    });
    expect(logOrgEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        actorUserId:    "user-99",
        eventType:      "completed_work_exported",
        resourceType:   "completed_work",
        resourceId:     "work-1",
        metadata:       expect.objectContaining({ format: "pdf" }),
      }),
    );
  });

  it("logs the correct format in audit metadata", async () => {
    setupDbWithWork();
    const svc = new CompletedWorkExportService();
    await svc.export({
      workId: "work-1", organisationId: "org-1",
      organisationName: "Test Org", format: "docx", actorUserId: "user-1",
    });
    const call = (logOrgEvent as any).mock.calls[0][0];
    expect(call.metadata.format).toBe("docx");
  });

  it("throws 404 when completed work is not found", async () => {
    mockDb.limit.mockResolvedValue([]);
    const svc = new CompletedWorkExportService();
    await expect(
      svc.export({ workId: "missing", organisationId: "org-1", organisationName: "X", format: "md", actorUserId: "u1" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("throws 400 when work has no content", async () => {
    mockDb.limit.mockResolvedValue([{
      id: "work-1", organizationId: "org-1", title: "Empty",
      primarySpecialist: "chief_of_staff", status: "draft",
      blueprintId: null, manifestId: null, conversationId: null,
      currentVersionId: "ver-1", createdByUserId: "u1", approvedByUserId: null,
      approvedAt: null, rejectedAt: null, archivedAt: null,
      reopenedAt: null, supersededById: null,
      createdAt: new Date(), updatedAt: new Date(), approvalWorkflow: {},
    }]);
    mockDb.orderBy.mockResolvedValue([{
      id: "ver-1", completedWorkId: "work-1", organizationId: "org-1",
      versionNumber: 1, contentMarkdown: null, qualityScore: null,
      reviewDimensions: [], changeNote: null, isAutoRevision: "false",
      createdByUserId: "u1", createdAt: new Date(),
    }]);
    const svc = new CompletedWorkExportService();
    await expect(
      svc.export({ workId: "work-1", organisationId: "org-1", organisationName: "X", format: "pdf", actorUserId: "u1" }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Part 1 — Comment resolution service (server-backed)
// ═══════════════════════════════════════════════════════════════════════════════

describe("resolveComment", () => {
  beforeEach(() => { vi.clearAllMocks(); resetChain(); });

  it("resolves an open comment", async () => {
    const { resolveComment } = await import("../services/completedWorkService.js");
    mockDb.limit.mockResolvedValueOnce([{
      id: "c1", completedWorkId: "w1", organizationId: "org-1",
      content: "Fix this", authorUserId: "u1", createdAt: new Date(),
      status: "open", resolvedByUserId: null, resolvedAt: null,
      reopenedByUserId: null, reopenedAt: null,
    }]);
    await expect(resolveComment("c1", "w1", "org-1", "u2")).resolves.toBeUndefined();
  });

  it("throws 404 when comment not found", async () => {
    const { resolveComment } = await import("../services/completedWorkService.js");
    mockDb.limit.mockResolvedValueOnce([]);
    await expect(resolveComment("missing", "w1", "org-1", "u2")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("throws 400 when comment is already resolved", async () => {
    const { resolveComment } = await import("../services/completedWorkService.js");
    mockDb.limit.mockResolvedValueOnce([{
      id: "c1", status: "resolved", completedWorkId: "w1",
      organizationId: "org-1", content: "x", authorUserId: "u1", createdAt: new Date(),
      resolvedByUserId: "u1", resolvedAt: new Date(), reopenedByUserId: null, reopenedAt: null,
    }]);
    await expect(resolveComment("c1", "w1", "org-1", "u2")).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("reopenComment", () => {
  beforeEach(() => { vi.clearAllMocks(); resetChain(); });

  it("reopens a resolved comment", async () => {
    const { reopenComment } = await import("../services/completedWorkService.js");
    mockDb.limit.mockResolvedValueOnce([{
      id: "c1", completedWorkId: "w1", organizationId: "org-1",
      content: "Fix this", authorUserId: "u1", createdAt: new Date(),
      status: "resolved", resolvedByUserId: "u1", resolvedAt: new Date(),
      reopenedByUserId: null, reopenedAt: null,
    }]);
    await expect(reopenComment("c1", "w1", "org-1", "u2")).resolves.toBeUndefined();
  });

  it("throws 400 when comment is already open", async () => {
    const { reopenComment } = await import("../services/completedWorkService.js");
    mockDb.limit.mockResolvedValueOnce([{
      id: "c1", status: "open", completedWorkId: "w1",
      organizationId: "org-1", content: "x", authorUserId: "u1", createdAt: new Date(),
      resolvedByUserId: null, resolvedAt: null, reopenedByUserId: null, reopenedAt: null,
    }]);
    await expect(reopenComment("c1", "w1", "org-1", "u2")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 404 when comment not found", async () => {
    const { reopenComment } = await import("../services/completedWorkService.js");
    mockDb.limit.mockResolvedValueOnce([]);
    await expect(reopenComment("missing", "w1", "org-1", "u2")).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Part 7 — Tenant isolation
// ═══════════════════════════════════════════════════════════════════════════════

describe("Tenant isolation — comment resolution", () => {
  beforeEach(() => { vi.clearAllMocks(); resetChain(); });

  it("does not resolve a comment belonging to a different org", async () => {
    const { resolveComment } = await import("../services/completedWorkService.js");
    mockDb.limit.mockResolvedValueOnce([]);
    await expect(
      resolveComment("c1", "w1", "org-different", "attacker"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("does not reopen a comment belonging to a different org", async () => {
    const { reopenComment } = await import("../services/completedWorkService.js");
    mockDb.limit.mockResolvedValueOnce([]);
    await expect(
      reopenComment("c1", "w1", "org-different", "attacker"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Part 8 — Invalid document handling
// ═══════════════════════════════════════════════════════════════════════════════

describe("Export — invalid document handling", () => {
  it("parseMarkdown handles extremely long line without crashing", () => {
    const longLine = "x".repeat(10000);
    expect(() => parseMarkdown(longLine)).not.toThrow();
  });

  it("parseMarkdown handles mixed content without crashing", () => {
    const mixed = [
      "# Title",
      "",
      "Normal paragraph.",
      "",
      "```json",
      '{ "key": "value" }',
      "```",
      "",
      "| A | B |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "- bullet 1",
      "- bullet 2",
    ].join("\n");
    const nodes = parseMarkdown(mixed);
    expect(nodes.length).toBeGreaterThan(0);
    const types = nodes.map(n => n.type);
    expect(types).toContain("heading");
    expect(types).toContain("paragraph");
    expect(types).toContain("code");
    expect(types).toContain("table");
    expect(types).toContain("list");
  });

  it("MarkdownExporter handles empty title gracefully", () => {
    const doc = makeDoc({ title: "" });
    const exporter = new MarkdownExporter();
    expect(() => exporter.export(doc, "")).not.toThrow();
  });

  it("PdfExporter handles special characters in title", async () => {
    const doc = makeDoc({ title: "Report: Q1/2026 — Final!" });
    const exporter = new PdfExporter();
    const result = await exporter.export(doc);
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.filename).not.toMatch(/[:/—!]/);
  });

  it("DocxExporter handles special characters in title", async () => {
    const doc = makeDoc({ title: 'Report "2026" & <All>' });
    const exporter = new DocxExporter();
    const result = await exporter.export(doc);
    expect(result.buffer).toBeInstanceOf(Buffer);
  });

  it("export service rejects unsupported format", async () => {
    mockDb.limit.mockResolvedValueOnce([{
      id: "w1", organizationId: "org-1", title: "Test", primarySpecialist: "chief_of_staff",
      status: "approved", blueprintId: null, manifestId: null, conversationId: null,
      currentVersionId: "v1", createdByUserId: "u1", approvedByUserId: null,
      approvedAt: null, rejectedAt: null, archivedAt: null, reopenedAt: null, supersededById: null,
      createdAt: new Date(), updatedAt: new Date(), approvalWorkflow: {},
    }]);
    mockDb.orderBy.mockResolvedValueOnce([{
      id: "v1", completedWorkId: "w1", organizationId: "org-1", versionNumber: 1,
      contentMarkdown: "# Hello", qualityScore: null, reviewDimensions: [], changeNote: null,
      isAutoRevision: "false", createdByUserId: "u1", createdAt: new Date(),
    }]);
    const svc = new CompletedWorkExportService();
    await expect(
      svc.export({
        workId: "w1", organisationId: "org-1", organisationName: "X",
        format: "odt" as any, actorUserId: "u1",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
