/**
 * Completed Work Export Service — Sprint 25 Hardening
 *
 * Implements a unified export architecture for Completed Work documents.
 *
 * Architecture:
 *   CompletedWorkExportService.export()
 *     → Fetches document from DB
 *     → Parses markdown into IntermediateDocument model
 *     → Delegates to the requested exporter:
 *         MarkdownExporter  → string (UTF-8 text)
 *         PdfExporter       → Buffer (via pdfkit)
 *         DocxExporter      → Buffer (via docx)
 *     → Logs export audit event
 *     → Returns { buffer, mimeType, filename }
 *
 * Future exporters (HtmlExporter, OdtExporter) extend the same interface
 * without touching parsing or audit logic.
 */

import { randomUUID }   from "crypto";
import PDFDocument      from "pdfkit";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow,
  TableCell, WidthType, BorderStyle, AlignmentType, UnderlineType,
} from "docx";
import { getCompletedWork, getVersions, resolveApprovedVersion } from "./completedWorkService.js";
import { logOrgEvent }                   from "./auditService.js";

// ─── Intermediate document model ─────────────────────────────────────────────

export type NodeType =
  | "heading"
  | "paragraph"
  | "code"
  | "blockquote"
  | "list"
  | "list_item"
  | "table"
  | "table_row"
  | "table_cell"
  | "hr";

export interface DocumentNode {
  type:     NodeType;
  level?:   number;          // heading level 1-4
  content?: string;          // leaf text
  ordered?: boolean;         // list ordering
  language?: string;         // code block language
  children?: DocumentNode[]; // nested nodes (list → list_item, table → table_row → table_cell)
}

export interface IntermediateDocument {
  title:          string;
  organisation:   string;
  generatedDate:  string;
  specialist:     string;
  approvalStatus: string;
  version:        number;
  nodes:          DocumentNode[];
}

// ─── Markdown parser ──────────────────────────────────────────────────────────

/**
 * parseMarkdown — converts a markdown string into DocumentNode[].
 * Handles: h1-h4, bold/italic (stripped to text), code blocks, blockquotes,
 * ordered/unordered lists, GFM tables, paragraphs, horizontal rules.
 */
export function parseMarkdown(markdown: string): DocumentNode[] {
  const nodes: DocumentNode[] = [];
  const lines = markdown.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code block
    if (line.startsWith("```")) {
      const language = line.slice(3).trim() || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        codeLines.push(lines[i]!);
        i++;
      }
      nodes.push({ type: "code", content: codeLines.join("\n"), language });
      i++; // skip closing ```
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      nodes.push({
        type: "heading",
        level: headingMatch[1]!.length,
        content: stripInlineMarkup(headingMatch[2]!),
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line)) {
      nodes.push({ type: "hr" });
      i++;
      continue;
    }

    // GFM table — detect by | in first column
    if (line.startsWith("|") && i + 1 < lines.length && lines[i + 1]!.startsWith("|")) {
      const tableNode: DocumentNode = { type: "table", children: [] };
      while (i < lines.length && lines[i]!.startsWith("|")) {
        const raw = lines[i]!;
        // Skip separator rows (e.g. |---|---|)
        if (/^\|[-|:\s]+\|$/.test(raw.trim())) { i++; continue; }
        const cells = raw.split("|").slice(1, -1).map(c => c.trim());
        const rowNode: DocumentNode = {
          type: "table_row",
          children: cells.map(c => ({ type: "table_cell" as NodeType, content: stripInlineMarkup(c) })),
        };
        tableNode.children!.push(rowNode);
        i++;
      }
      if (tableNode.children!.length > 0) nodes.push(tableNode);
      continue;
    }

    // Blockquote
    if (line.startsWith(">")) {
      const bqLines: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) {
        bqLines.push(lines[i]!.replace(/^>\s?/, ""));
        i++;
      }
      nodes.push({ type: "blockquote", content: stripInlineMarkup(bqLines.join(" ")) });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const listNode: DocumentNode = { type: "list", ordered: true, children: [] };
      while (i < lines.length && /^\d+\.\s/.test(lines[i]!)) {
        listNode.children!.push({
          type: "list_item",
          content: stripInlineMarkup(lines[i]!.replace(/^\d+\.\s+/, "")),
        });
        i++;
      }
      nodes.push(listNode);
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(line)) {
      const listNode: DocumentNode = { type: "list", ordered: false, children: [] };
      while (i < lines.length && /^[-*+]\s/.test(lines[i]!)) {
        listNode.children!.push({
          type: "list_item",
          content: stripInlineMarkup(lines[i]!.replace(/^[-*+]\s+/, "")),
        });
        i++;
      }
      nodes.push(listNode);
      continue;
    }

    // Empty line — skip
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph (default)
    nodes.push({ type: "paragraph", content: stripInlineMarkup(line) });
    i++;
  }

  return nodes;
}

function stripInlineMarkup(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g,  "$1") // bold
    .replace(/\*(.+?)\*/g,      "$1") // italic
    .replace(/__(.+?)__/g,      "$1") // bold (alt)
    .replace(/_(.+?)_/g,        "$1") // italic (alt)
    .replace(/`(.+?)`/g,        "$1") // inline code
    .replace(/\[(.+?)\]\(.+?\)/g, "$1") // links → label only
    .replace(/~~(.+?)~~/g,      "$1"); // strikethrough
}

// ─── Exporter interface ───────────────────────────────────────────────────────

export interface ExportResult {
  buffer:      Buffer;
  mimeType:    string;
  filename:    string;
}

// ─── Markdown Exporter ────────────────────────────────────────────────────────

export class MarkdownExporter {
  export(doc: IntermediateDocument, originalMarkdown: string): ExportResult {
    const header = [
      `# ${doc.title}`,
      ``,
      `**Organisation:** ${doc.organisation}  `,
      `**Generated:** ${doc.generatedDate}  `,
      `**Specialist:** ${doc.specialist}  `,
      `**Status:** ${doc.approvalStatus}  `,
      `**Version:** ${doc.version}`,
      ``,
      `---`,
      ``,
      originalMarkdown,
    ].join("\n");
    return {
      buffer: Buffer.from(header, "utf-8"),
      mimeType: "text/markdown",
      filename: sanitiseFilename(doc.title) + ".md",
    };
  }
}

// ─── PDF Exporter ─────────────────────────────────────────────────────────────

export class PdfExporter {
  async export(doc: IntermediateDocument): Promise<ExportResult> {
    return new Promise<ExportResult>((resolve, reject) => {
      const pdf = new PDFDocument({
        size: "A4",
        margins: { top: 72, bottom: 72, left: 72, right: 72 },
        info: {
          Title:    doc.title,
          Author:   doc.specialist,
          Creator:  "NeedsOps AI+ Platform",
          Subject:  doc.approvalStatus,
        },
      });

      const chunks: Buffer[] = [];
      pdf.on("data",  (chunk: Buffer) => chunks.push(chunk));
      pdf.on("error", reject);
      pdf.on("end",   () => resolve({
        buffer: Buffer.concat(chunks),
        mimeType: "application/pdf",
        filename: sanitiseFilename(doc.title) + `-v${doc.version}.pdf`,
      }));

      // ── Cover metadata ──────────────────────────────────────────────────────
      pdf.fontSize(20).font("Helvetica-Bold").text(doc.title, { align: "left" });
      pdf.moveDown(0.4);
      pdf.fontSize(10).font("Helvetica").fillColor("#555555");
      pdf.text(`Organisation: ${doc.organisation}`);
      pdf.text(`Generated: ${doc.generatedDate}`);
      pdf.text(`Specialist: ${doc.specialist}`);
      pdf.text(`Approval status: ${doc.approvalStatus}`);
      pdf.text(`Version: ${doc.version}`);
      pdf.fillColor("#000000");
      pdf.moveDown(0.8);
      pdf.moveTo(72, pdf.y).lineTo(pdf.page.width - 72, pdf.y).stroke();
      pdf.moveDown(0.8);

      // ── Document nodes ──────────────────────────────────────────────────────
      const HEADING_SIZES: Record<number, number> = { 1: 18, 2: 15, 3: 13, 4: 11 };

      for (const node of doc.nodes) {
        switch (node.type) {
          case "heading": {
            const sz = HEADING_SIZES[node.level ?? 1] ?? 12;
            pdf.font("Helvetica-Bold").fontSize(sz).text(node.content ?? "", {
              continued: false,
            });
            pdf.moveDown(0.4);
            break;
          }
          case "paragraph": {
            pdf.font("Helvetica").fontSize(10).text(node.content ?? "", {
              align: "justify",
              lineGap: 2,
            });
            pdf.moveDown(0.5);
            break;
          }
          case "code": {
            const bg = { x: 72, y: pdf.y - 4, width: pdf.page.width - 144 };
            pdf.rect(bg.x, bg.y, bg.width, 16 + (node.content?.split("\n").length ?? 1) * 13).fill("#f5f5f5");
            pdf.fillColor("#000000").font("Courier").fontSize(9).text(
              node.content ?? "",
              { lineGap: 2 },
            );
            pdf.moveDown(0.6);
            break;
          }
          case "blockquote": {
            pdf.moveTo(80, pdf.y).lineTo(80, pdf.y + 14).stroke("#cccccc");
            pdf.font("Helvetica-Oblique").fontSize(10).fillColor("#555555")
               .text(node.content ?? "", 88, pdf.y, { lineGap: 2 });
            pdf.fillColor("#000000").moveDown(0.5);
            break;
          }
          case "list": {
            for (const item of node.children ?? []) {
              const bullet = node.ordered ? "—" : "•";
              pdf.font("Helvetica").fontSize(10).text(`  ${bullet}  ${item.content ?? ""}`, {
                lineGap: 2,
              });
            }
            pdf.moveDown(0.5);
            break;
          }
          case "table": {
            const rows = node.children ?? [];
            if (rows.length === 0) break;
            const colCount = rows[0]?.children?.length ?? 1;
            const colWidth = (pdf.page.width - 144) / colCount;
            let tableY = pdf.y;
            for (let ri = 0; ri < rows.length; ri++) {
              const row = rows[ri]!;
              const cells = row.children ?? [];
              const isHeader = ri === 0;
              if (isHeader) {
                pdf.rect(72, tableY, pdf.page.width - 144, 18).fill("#eeeeee");
              }
              let cellX = 72;
              for (const cell of cells) {
                pdf.fillColor("#000000")
                   .font(isHeader ? "Helvetica-Bold" : "Helvetica")
                   .fontSize(9)
                   .text(cell.content ?? "", cellX + 4, tableY + 4, {
                     width: colWidth - 8, height: 14, ellipsis: true,
                   });
                pdf.rect(cellX, tableY, colWidth, 18).stroke("#cccccc");
                cellX += colWidth;
              }
              tableY += 18;
            }
            pdf.y = tableY;
            pdf.moveDown(0.5);
            break;
          }
          case "hr": {
            pdf.moveTo(72, pdf.y).lineTo(pdf.page.width - 72, pdf.y).stroke();
            pdf.moveDown(0.6);
            break;
          }
        }
      }

      // ── Footer on each page ─────────────────────────────────────────────────
      const pageCount = (pdf as any)._pageBuffer?.length ?? 1;
      const range = pdf.bufferedPageRange?.() ?? { start: 0, count: pageCount };
      for (let pi = range.start; pi < range.start + range.count; pi++) {
        pdf.switchToPage(pi);
        const pageNum = pi - range.start + 1;
        pdf.fontSize(8).fillColor("#888888")
           .text(
             `${doc.title} · NeedsOps AI+ · ${doc.generatedDate} · Page ${pageNum}`,
             72,
             pdf.page.height - 40,
             { align: "center", width: pdf.page.width - 144 },
           );
      }

      pdf.end();
    });
  }
}

// ─── DOCX Exporter ────────────────────────────────────────────────────────────

export class DocxExporter {
  async export(doc: IntermediateDocument): Promise<ExportResult> {
    const DOCX_HEADING: Record<number, HeadingLevel> = {
      1: HeadingLevel.HEADING_1,
      2: HeadingLevel.HEADING_2,
      3: HeadingLevel.HEADING_3,
      4: HeadingLevel.HEADING_4,
    };

    const paragraphs: (Paragraph | Table)[] = [];

    // ── Metadata block ──────────────────────────────────────────────────────
    paragraphs.push(
      new Paragraph({
        text: doc.title,
        heading: HeadingLevel.TITLE,
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Organisation: ", bold: true }),
          new TextRun({ text: doc.organisation }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Generated: ", bold: true }),
          new TextRun({ text: doc.generatedDate }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Specialist: ", bold: true }),
          new TextRun({ text: doc.specialist }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Approval status: ", bold: true }),
          new TextRun({ text: doc.approvalStatus }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Version: ", bold: true }),
          new TextRun({ text: String(doc.version) }),
        ],
      }),
      new Paragraph({ text: "" }),
    );

    // ── Document nodes ──────────────────────────────────────────────────────
    for (const node of doc.nodes) {
      switch (node.type) {
        case "heading":
          paragraphs.push(
            new Paragraph({
              text: node.content ?? "",
              heading: DOCX_HEADING[node.level ?? 1] ?? HeadingLevel.HEADING_1,
            }),
          );
          break;

        case "paragraph":
          paragraphs.push(new Paragraph({ text: node.content ?? "" }));
          break;

        case "code":
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: node.content ?? "",
                  font: "Courier New",
                  size: 18,
                }),
              ],
              shading: { fill: "F5F5F5" } as any,
            }),
          );
          break;

        case "blockquote":
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({ text: node.content ?? "", italics: true, color: "555555" }),
              ],
              indent: { left: 720 },
              border: { left: { style: BorderStyle.SINGLE, size: 6, color: "AAAAAA" } },
            }),
          );
          break;

        case "list":
          for (const item of node.children ?? []) {
            paragraphs.push(
              new Paragraph({
                text: item.content ?? "",
                bullet: node.ordered ? undefined : { level: 0 },
                numbering: node.ordered ? { reference: "default-numbering", level: 0 } : undefined,
              }),
            );
          }
          break;

        case "hr":
          paragraphs.push(
            new Paragraph({
              children: [new TextRun({ text: "─".repeat(40), color: "CCCCCC" })],
            }),
          );
          break;

        case "table": {
          const rows = node.children ?? [];
          if (rows.length === 0) break;
          const tableRows = rows.map((row, ri) => {
            const cells = (row.children ?? []).map(cell =>
              new TableCell({
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: cell.content ?? "",
                        bold: ri === 0,
                      }),
                    ],
                  }),
                ],
              }),
            );
            return new TableRow({ children: cells });
          });
          paragraphs.push(
            new Table({
              rows: tableRows,
              width: { size: 100, type: WidthType.PERCENTAGE },
            }),
          );
          paragraphs.push(new Paragraph({ text: "" }));
          break;
        }
      }
    }

    const docxDocument = new Document({
      title: doc.title,
      description: `Generated by NeedsOps AI+ — ${doc.specialist}`,
      sections: [{ children: paragraphs }],
      numbering: {
        config: [
          {
            reference: "default-numbering",
            levels: [{ level: 0, format: "decimal", text: "%1.", alignment: AlignmentType.START }],
          },
        ],
      },
    });

    const buffer = await Packer.toBuffer(docxDocument);
    return {
      buffer,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: sanitiseFilename(doc.title) + `-v${doc.version}.docx`,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitiseFilename(title: string): string {
  return title.replace(/[^a-z0-9\s-]/gi, "").replace(/\s+/g, "_").slice(0, 80) || "document";
}

function formatApprovalStatus(status: string): string {
  const MAP: Record<string, string> = {
    draft:             "Draft",
    awaiting_approval: "Awaiting Approval",
    approved:          "Approved",
    rejected:          "Rejected",
    archived:          "Archived",
    superseded:        "Superseded",
    reopened:          "Reopened",
  };
  return MAP[status] ?? status;
}

function formatSpecialist(slug: string): string {
  const MAP: Record<string, string> = {
    chief_of_staff:                   "Chief of Staff",
    operations_manager:               "Operations Manager",
    compliance_manager:               "Compliance Manager",
    hr_manager:                       "HR Manager",
    finance_manager:                  "Finance Manager",
    incident_safeguarding_specialist: "Incident & Safeguarding Specialist",
  };
  return MAP[slug] ?? slug.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Export service ───────────────────────────────────────────────────────────

export type ExportFormat = "md" | "pdf" | "docx";

export class CompletedWorkExportService {
  private readonly mdExporter   = new MarkdownExporter();
  private readonly pdfExporter  = new PdfExporter();
  private readonly docxExporter = new DocxExporter();

  async export(params: {
    workId:         string;
    organisationId: string;
    organisationName: string;
    format:         ExportFormat;
    actorUserId:    string;
  }): Promise<ExportResult> {
    const { workId, organisationId, organisationName, format, actorUserId } = params;

    // Validate format before any DB access (fail fast)
    if (!["md", "pdf", "docx"].includes(format)) {
      throw Object.assign(new Error(`Unsupported export format: ${format}`), { statusCode: 400 });
    }

    // Fetch work + versions
    const work = await getCompletedWork(workId, organisationId);
    if (!work) throw Object.assign(new Error("Completed work not found"), { statusCode: 404 });

    const versions = await getVersions(workId, organisationId);

    // ── Approved-version integrity: canonical resolver (fail-closed for modern pins) ──
    // Uses the single-source-of-truth resolveApprovedVersion():
    //   • Modern approved (approvedVersionId != null) → exact pin; throws APPROVED_VERSION_INTEGRITY_ERROR if missing
    //   • Legacy approved (approvedVersionId = null)  → LEGACY_APPROVAL_FALLBACK to versions[0]
    //   • Non-approved                                → versions[0] (current/latest)
    if (versions.length === 0) {
      throw Object.assign(new Error("No content available for export"), { statusCode: 400 });
    }
    const resolvedVersion = resolveApprovedVersion(work, versions);

    if (!resolvedVersion.contentMarkdown) {
      throw Object.assign(new Error("No content available for export"), { statusCode: 400 });
    }

    const markdown = resolvedVersion.contentMarkdown;
    const nodes    = parseMarkdown(markdown);

    const intermediateDoc: IntermediateDocument = {
      title:          work.title,
      organisation:   organisationName,
      generatedDate:  new Date().toLocaleDateString("en-AU", {
        day: "numeric", month: "long", year: "numeric",
      }),
      specialist:     formatSpecialist(work.primarySpecialist),
      approvalStatus: formatApprovalStatus(work.status),
      version:        resolvedVersion.versionNumber,
      nodes,
    };

    let result: ExportResult;
    switch (format) {
      case "md":
        result = this.mdExporter.export(intermediateDoc, markdown);
        break;
      case "pdf":
        result = await this.pdfExporter.export(intermediateDoc);
        break;
      case "docx":
        result = await this.docxExporter.export(intermediateDoc);
        break;
      default:
        throw Object.assign(new Error(`Unsupported export format: ${format}`), { statusCode: 400 });
    }

    // Export audit
    await logOrgEvent({
      organizationId: organisationId,
      actorUserId,
      eventType: "completed_work_exported" as any,
      resourceType: "completed_work",
      resourceId: workId,
      metadata: { format, filename: result.filename, title: work.title },
    });

    return result;
  }
}

export const completedWorkExportService = new CompletedWorkExportService();
