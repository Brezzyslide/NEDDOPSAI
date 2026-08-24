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
 *         XlsxExporter      → Buffer (minimal OOXML workbook)
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
import { normaliseCompletedWorkContent } from "./completedWorkNormaliser.js";

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

// ─── XLSX Exporter ────────────────────────────────────────────────────────────

export class XlsxExporter {
  export(doc: IntermediateDocument): ExportResult {
    const rows = documentToWorksheetRows(doc);
    const worksheet = buildWorksheetXml(rows);
    const workbook = zipStore({
      "[Content_Types].xml": [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`,
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`,
        `<Default Extension="xml" ContentType="application/xml"/>`,
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`,
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`,
        `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`,
        `</Types>`,
      ].join(""),
      "_rels/.rels": [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`,
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`,
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`,
        `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>`,
        `</Relationships>`,
      ].join(""),
      "xl/workbook.xml": [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`,
        `<sheets><sheet name="Completed Work" sheetId="1" r:id="rId1"/></sheets>`,
        `</workbook>`,
      ].join(""),
      "xl/_rels/workbook.xml.rels": [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`,
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>`,
        `</Relationships>`,
      ].join(""),
      "xl/worksheets/sheet1.xml": worksheet,
      "docProps/core.xml": [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
        `<dc:title>${xmlEscape(doc.title)}</dc:title>`,
        `<dc:creator>${xmlEscape(doc.specialist)}</dc:creator>`,
        `<cp:lastModifiedBy>NeedsOps AI+ Platform</cp:lastModifiedBy>`,
        `<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>`,
        `<dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>`,
        `</cp:coreProperties>`,
      ].join(""),
      "docProps/app.xml": [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">`,
        `<Application>NeedsOps AI+</Application>`,
        `</Properties>`,
      ].join(""),
    });

    return {
      buffer: workbook,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: sanitiseFilename(doc.title) + `-v${doc.version}.xlsx`,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitiseFilename(title: string): string {
  return title.replace(/[^a-z0-9\s-]/gi, "").replace(/\s+/g, "_").slice(0, 80) || "document";
}

function documentToWorksheetRows(doc: IntermediateDocument): string[][] {
  const rows: string[][] = [
    ["NeedsOps Completed Work"],
    ["Title", doc.title],
    ["Organisation", doc.organisation],
    ["Generated", doc.generatedDate],
    ["Specialist", doc.specialist],
    ["Approval status", doc.approvalStatus],
    [],
  ];

  for (const node of doc.nodes) {
    appendNodeRows(rows, node);
  }

  return rows.length > 0 ? rows : [["No content available"]];
}

function appendNodeRows(rows: string[][], node: DocumentNode, prefix = ""): void {
  switch (node.type) {
    case "heading":
      rows.push([]);
      rows.push([node.content ?? ""]);
      break;
    case "paragraph":
    case "blockquote":
      if (node.content?.trim()) rows.push([prefix + node.content.trim()]);
      break;
    case "code":
      for (const line of (node.content ?? "").split("\n")) {
        if (line.trim()) rows.push([prefix + line.trim()]);
      }
      break;
    case "list":
      for (const child of node.children ?? []) appendNodeRows(rows, child, prefix);
      break;
    case "list_item":
      rows.push([`${node.ordered ? "1." : "-"} ${node.content ?? ""}`.trim()]);
      for (const child of node.children ?? []) appendNodeRows(rows, child, "  ");
      break;
    case "table":
      for (const row of node.children ?? []) {
        const cells = (row.children ?? []).map(cell => cell.content ?? "");
        if (cells.length > 0) rows.push(cells);
      }
      rows.push([]);
      break;
    case "hr":
      rows.push([]);
      break;
    default:
      if (node.content?.trim()) rows.push([prefix + node.content.trim()]);
      for (const child of node.children ?? []) appendNodeRows(rows, child, prefix);
  }
}

function buildWorksheetXml(rows: string[][]): string {
  const xmlRows = rows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const cells = row.map((cell, cellIndex) => {
      const ref = `${columnName(cellIndex + 1)}${rowNumber}`;
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(cell)}</t></is></c>`;
    }).join("");
    return `<row r="${rowNumber}">${cells}</row>`;
  }).join("");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`,
    `<sheetData>${xmlRows}</sheetData>`,
    `</worksheet>`,
  ].join("");
}

function columnName(index: number): string {
  let value = index;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name || "A";
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()): { dosDate: number; dosTime: number } {
  const year = Math.max(1980, date.getFullYear());
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  return { dosDate, dosTime };
}

function zipStore(files: Record<string, string>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  const offsets: Array<{ name: Buffer; offset: number; crc: number; size: number }> = [];
  const { dosDate, dosTime } = dosDateTime();
  let offset = 0;

  for (const [path, content] of Object.entries(files)) {
    const name = Buffer.from(path, "utf8");
    const data = Buffer.from(content, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);
    offsets.push({ name, offset, crc, size: data.length });
    offset += local.length + name.length + data.length;
  }

  for (const entry of offsets) {
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(entry.crc, 16);
    central.writeUInt32LE(entry.size, 20);
    central.writeUInt32LE(entry.size, 24);
    central.writeUInt16LE(entry.name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(entry.offset, 42);
    centralParts.push(central, entry.name);
  }

  const centralDirectory = Buffer.concat(centralParts);
  const localDirectory = Buffer.concat(localParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(offsets.length, 8);
  end.writeUInt16LE(offsets.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localDirectory.length, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([localDirectory, centralDirectory, end]);
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

export type ExportFormat = "md" | "pdf" | "docx" | "xlsx";

export class CompletedWorkExportService {
  private readonly mdExporter   = new MarkdownExporter();
  private readonly pdfExporter  = new PdfExporter();
  private readonly docxExporter = new DocxExporter();
  private readonly xlsxExporter = new XlsxExporter();

  async export(params: {
    workId:         string;
    organisationId: string;
    organisationName: string;
    format:         ExportFormat;
    actorUserId:    string;
  }): Promise<ExportResult> {
    const { workId, organisationId, organisationName, format, actorUserId } = params;

    // Validate format before any DB access (fail fast)
    if (!["md", "pdf", "docx", "xlsx"].includes(format)) {
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

    const markdown   = resolvedVersion.contentMarkdown;
    // Normalise content format before parsing — converts JSON/fenced-JSON to
    // human-readable markdown so exporters never see raw braces or property names.
    const normalised = normaliseCompletedWorkContent(markdown);
    const nodes      = parseMarkdown(normalised);

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
      case "xlsx":
        result = this.xlsxExporter.export(intermediateDoc);
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
