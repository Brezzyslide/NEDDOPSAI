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
  Footer, PageBreak, PageNumber,
} from "docx";
import { sql } from "drizzle-orm";
import { db, withSystemTenantContext } from "@workspace/db";
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
  carePlanMetadata?: CarePlanDocumentMetadata;
  draftNotice?: DraftNoticeMetadata | null;
}

export interface CarePlanDocumentMetadata {
  participantName: string;
  ndisNumber: string;
  dateOfBirth: string;
  planDate: string;
  reviewDate: string;
}

export interface DraftNoticeMetadata {
  blocked: boolean;
  message: string;
}

function exportDraftNoticeMetadata(work: Awaited<ReturnType<typeof getCompletedWork>>): DraftNoticeMetadata | null {
  if (!work?.approvalWorkflow || work.approvalWorkflow.approvalBlocked !== true) return null;
  return {
    blocked: true,
    message: "This document is an unapproved draft. Completion checks did not pass, so it must not be actioned as a final care plan or given to workers as a current support document.",
  };
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
  const protectedPlaceholders: string[] = [];
  const placeholderProtectedText = text.replace(/\[[A-Z0-9_]{2,160}\]/g, (token) => {
    const index = protectedPlaceholders.push(token) - 1;
    return `@@NEEDSOPSPLACEHOLDER${index}@@`;
  });

  return placeholderProtectedText
    .replace(/\*\*(.+?)\*\*/g,  "$1") // bold
    .replace(/\*(.+?)\*/g,      "$1") // italic
    .replace(/__(.+?)__/g,      "$1") // bold (alt)
    .replace(/_(.+?)_/g,        "$1") // italic (alt)
    .replace(/`(.+?)`/g,        "$1") // inline code
    .replace(/\[(.+?)\]\(.+?\)/g, "$1") // links → label only
    .replace(/~~(.+?)~~/g,      "$1") // strikethrough
    .replace(/@@NEEDSOPSPLACEHOLDER(\d+)@@/g, (_, index: string) =>
      protectedPlaceholders[Number(index)] ?? "",
    );
}

export function prepareClientArtifactMarkdown(markdown: string): string {
  const withoutDraftShell = markdown
    .replace(/^#\s+Unapproved Incomplete Draft[\s\S]*?\n##\s+Draft Content\s*\n?/i, "")
    .replace(/^#\s+Unapproved Draft Notice[\s\S]*?(?:\n---\s*\n|$)/i, "");

  const lines = withoutDraftShell.split("\n");
  const cleaned: string[] = [];
  let skipSectionLevel: number | null = null;
  const apparatusHeadings = new Set([
    "completion checks",
    "completion checks not passed",
    "generation truncated",
    "unsatisfied requirements",
    "suppressed claims",
    "suppressed unsupported claims",
    "generation truncation",
    "truncation notices",
    "truncation notice",
  ]);

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      const level = heading[1]!.length;
      const normalised = stripInlineMarkup(heading[2]!)
        .replace(/[:.]+$/g, "")
        .trim()
        .toLowerCase();
      if (skipSectionLevel !== null && level <= skipSectionLevel) skipSectionLevel = null;
      if (apparatusHeadings.has(normalised)) {
        skipSectionLevel = level;
        continue;
      }
    }
    if (skipSectionLevel !== null) continue;
    if (isGenerationNarrationLine(line)) continue;
    cleaned.push(line);
  }

  return cleaned.join("\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

function isGenerationNarrationLine(line: string): boolean {
  const text = stripInlineMarkup(line).trim();
  if (!text) return false;
  return (
    /\bgeneration_truncated\b/i.test(text) ||
    /\bgeneration_failed\b/i.test(text) ||
    /^Batch .+ generation_(?:truncated|failed)\b/i.test(text) ||
    /^This is an unapproved draft\./i.test(text) ||
    /^Completion checks did not pass\b/i.test(text)
  );
}

type DbClient = typeof db;

interface StructuredCarePlanMetadataInput {
  workId: string;
  organisationId: string;
  title: string;
  generatedDate: string;
  nodes: DocumentNode[];
}

interface ParticipantCoverRecord {
  displayName: string | null;
  preferredName: string | null;
  externalParticipantId: string | null;
  metadata: unknown;
}

function withCompletedWorkExportTenant<T>(
  organizationId: string,
  purpose: string,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  return withSystemTenantContext(
    { tenantId: organizationId, serviceIdentity: "completed_work_export_service", purpose },
    fn,
  );
}

async function buildStructuredCarePlanMetadata(input: StructuredCarePlanMetadataInput): Promise<CarePlanDocumentMetadata> {
  const declaredFields = buildCarePlanMetadata({
    title: input.title,
    generatedDate: input.generatedDate,
    nodes: input.nodes,
  });
  const participant = await resolveBoundSubjectParticipantForCompletedWork(input.organisationId, input.workId);
  if (!participant) return declaredFields;

  return {
    participantName: firstNonEmpty(
      participant.displayName,
      participant.preferredName,
      declaredFields.participantName,
    ) ?? "Participant not recorded",
    ndisNumber: firstNonEmpty(
      participant.externalParticipantId,
      findParticipantMetadataValue(participant.metadata, [
        "ndisNumber",
        "ndis_number",
        "ndisParticipantNumber",
        "ndis_participant_number",
        "participantNdisNumber",
      ]),
      declaredFields.ndisNumber,
    ) ?? "Not recorded",
    dateOfBirth: firstNonEmpty(
      findParticipantMetadataValue(participant.metadata, [
        "dateOfBirth",
        "date_of_birth",
        "dob",
        "birthDate",
        "birth_date",
      ]),
      declaredFields.dateOfBirth,
    ) ?? "Not recorded",
    planDate: declaredFields.planDate,
    reviewDate: declaredFields.reviewDate,
  };
}

async function resolveBoundSubjectParticipantForCompletedWork(
  organisationId: string,
  completedWorkId: string,
): Promise<ParticipantCoverRecord | null> {
  const result = await withCompletedWorkExportTenant(
    organisationId,
    "completed_work.export.subject_participant",
    async (client) => client.execute(sql`
      SELECT
        p.display_name AS "displayName",
        p.preferred_name AS "preferredName",
        p.external_participant_id AS "externalParticipantId",
        p.metadata AS "metadata"
      FROM execution_sessions es
      INNER JOIN task_participants tp
        ON tp.task_id = es.task_id
       AND tp.organization_id = es.organization_id
       AND tp.role = 'subject'
      INNER JOIN participants p
        ON p.id = tp.participant_id
       AND p.organization_id = es.organization_id
       AND p.deleted_at IS NULL
      WHERE es.organization_id = ${organisationId}
        AND es.metadata->>'completedWorkId' = ${completedWorkId}
      ORDER BY es.created_at DESC
      LIMIT 1
    `),
  );
  const rows = Array.isArray((result as { rows?: unknown[] }).rows)
    ? (result as { rows: ParticipantCoverRecord[] }).rows
    : [];
  return rows[0] ?? null;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const clean = typeof value === "string" ? value.trim() : "";
    if (clean && !/^not recorded$/i.test(clean) && !/^participant not recorded$/i.test(clean)) return clean;
  }
  return null;
}

function findParticipantMetadataValue(metadata: unknown, keys: string[]): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const wanted = new Set(keys.map(normaliseMetadataKey));
  const stack: unknown[] = [metadata];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
      if (wanted.has(normaliseMetadataKey(key)) && typeof value === "string" && value.trim()) {
        return value.trim();
      }
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return null;
}

function buildCarePlanMetadata(doc: {
  title: string;
  generatedDate: string;
  nodes: DocumentNode[];
}): CarePlanDocumentMetadata {
  const valueByKey = collectSupportPlanMeetingMetadata(doc.nodes);

  return {
    participantName: firstMetadataValue(valueByKey, [
      "participant name",
      "name",
      "client name",
    ]) || participantNameFromTitle(doc.title) || "Participant not recorded",
    ndisNumber: firstMetadataValue(valueByKey, [
      "ndis number",
      "ndis no",
      "ndis participant number",
    ]) || "Not recorded",
    dateOfBirth: firstMetadataValue(valueByKey, [
      "date of birth",
      "dob",
      "birth date",
    ]) || "Not recorded",
    planDate: firstMetadataValue(valueByKey, [
      "plan date",
      "care plan date",
      "date prepared",
      "created date",
    ]) || doc.generatedDate,
    reviewDate: firstMetadataValue(valueByKey, [
      "next review date",
      "review date",
      "scheduled review date",
    ]) || "Not recorded",
  };
}

function collectSupportPlanMeetingMetadata(nodes: DocumentNode[]): Map<string, string> {
  const valueByKey = new Map<string, string>();
  const supportPlanNodes = nodesForHeading(nodes, /support plan meeting/i);
  for (const node of supportPlanNodes) collectMetadataValues(node, valueByKey);
  return valueByKey;
}

function nodesForHeading(nodes: DocumentNode[], pattern: RegExp): DocumentNode[] {
  const start = nodes.findIndex(node => node.type === "heading" && pattern.test(node.content ?? ""));
  if (start < 0) return [];
  const headingLevel = nodes[start]?.level ?? 1;
  const scoped: DocumentNode[] = [];
  for (let i = start + 1; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.type === "heading" && (node.level ?? 1) <= headingLevel) break;
    scoped.push(node);
  }
  return scoped;
}

function collectMetadataValues(node: DocumentNode, values: Map<string, string>): void {
  if (node.type === "table") {
    for (const row of node.children ?? []) {
      const cells = (row.children ?? []).map(cell => (cell.content ?? "").trim()).filter(Boolean);
      if (cells.length >= 2) {
        addMetadataValue(values, cells[0]!, cells.slice(1).join(" "));
      }
    }
  }
  if (node.type === "paragraph" || node.type === "list_item") {
    const match = (node.content ?? "").match(/^([^:|]{2,80})[:|]\s*(.+)$/);
    if (match) addMetadataValue(values, match[1]!, match[2]!);
  }
  for (const child of node.children ?? []) collectMetadataValues(child, values);
}

function addMetadataValue(values: Map<string, string>, key: string, value: string): void {
  const normalisedKey = normaliseMetadataKey(key);
  const cleanValue = value.trim();
  if (!normalisedKey || !cleanValue || /^[-–—]+$/.test(cleanValue)) return;
  if (!values.has(normalisedKey)) values.set(normalisedKey, cleanValue);
}

function firstMetadataValue(values: Map<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = values.get(normaliseMetadataKey(key));
    if (value) return value;
  }
  return null;
}

function normaliseMetadataKey(key: string): string {
  return stripInlineMarkup(key)
    .replace(/\s+/g, " ")
    .replace(/[:|]+$/g, "")
    .trim()
    .toLowerCase();
}

function participantNameFromTitle(title: string): string | null {
  const clean = title.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const match = clean.match(/\b(?:care plan|support plan)\s+(?:for\s+)?([A-Z][A-Za-z' -]{2,80})/i)
    ?? clean.match(/\b([A-Z][A-Za-z' -]{2,80})\s+(?:care plan|support plan)\b/i);
  return match?.[1]?.trim() ?? null;
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
        bufferPages: true,
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

      renderPdfCover(pdf, doc);
      pdf.addPage();

      // ── Document nodes ──────────────────────────────────────────────────────
      const HEADING_SIZES: Record<number, number> = { 1: 16, 2: 13, 3: 11, 4: 10 };
      let sectionNumber = 0;

      for (const node of doc.nodes) {
        switch (node.type) {
          case "heading": {
            const sz = HEADING_SIZES[node.level ?? 1] ?? 12;
            const level = node.level ?? 1;
            if (level <= 2 && pdf.y > pdf.page.height - 170) pdf.addPage();
            const display = level === 1
              ? `${++sectionNumber}. ${node.content ?? ""}`
              : node.content ?? "";
            pdf.fillColor("#17324D").font("Helvetica-Bold").fontSize(sz).text(display, {
              continued: false,
            });
            pdf.moveTo(72, pdf.y + 2).lineTo(pdf.page.width - 72, pdf.y + 2).strokeColor("#9DB5C8").lineWidth(0.6).stroke();
            pdf.strokeColor("#000000").lineWidth(1);
            pdf.moveDown(0.4);
            break;
          }
          case "paragraph": {
            pdf.fillColor("#111827").font("Helvetica").fontSize(10).text(node.content ?? "", {
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
            const tableX = 72;
            const tableWidth = pdf.page.width - 144;
            const colWidths = calculatePdfTableColumnWidths(rows, tableWidth, colCount);
            let tableY = pdf.y;
            for (let ri = 0; ri < rows.length; ri++) {
              const row = rows[ri]!;
              const cells = row.children ?? [];
              const isHeader = ri === 0;
              const rowHeight = calculatePdfTableRowHeight(pdf, cells, colWidths, isHeader);
              if (tableY + rowHeight > pdf.page.height - 72) {
                pdf.addPage();
                tableY = 72;
              }
              if (isHeader) {
                pdf.rect(tableX, tableY, tableWidth, rowHeight).fill("#D9E6EF");
              }
              let cellX = tableX;
              for (let ci = 0; ci < colCount; ci++) {
                const cell = cells[ci];
                const colWidth = colWidths[ci] ?? tableWidth / colCount;
                pdf.fillColor("#000000")
                   .font(isHeader ? "Helvetica-Bold" : "Helvetica")
                   .fontSize(9)
                   .text(cell?.content ?? "", cellX + 4, tableY + 4, {
                     width: colWidth - 8,
                     lineGap: 1,
                   });
                pdf.rect(cellX, tableY, colWidth, rowHeight).stroke("#7F97AA");
                cellX += colWidth;
              }
              tableY += rowHeight;
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
        renderPdfFooter(pdf, doc, pageNum, range.count);
      }

      pdf.end();
    });
  }
}

function renderPdfCover(pdf: PDFKit.PDFDocument, doc: IntermediateDocument): void {
  const meta = doc.carePlanMetadata ?? buildCarePlanMetadata(doc);
  const tableX = 72;
  const tableWidth = pdf.page.width - 144;
  pdf.fillColor("#17324D").font("Helvetica-Bold").fontSize(26).text("Care Plan", tableX, 118, {
    width: tableWidth,
    align: "center",
  });
  pdf.moveDown(0.5);
  pdf.font("Helvetica").fontSize(12).fillColor("#4B5563").text(doc.organisation, { align: "center" });
  if (doc.draftNotice?.blocked) {
    pdf.moveDown(1.4);
    pdf.rect(tableX, pdf.y, tableWidth, 58).fill("#FDECEC").stroke("#B91C1C");
    pdf.fillColor("#7F1D1D").font("Helvetica-Bold").fontSize(11).text("UNAPPROVED DRAFT", tableX + 12, pdf.y + 12, {
      width: tableWidth - 24,
    });
    pdf.font("Helvetica").fontSize(9).text(doc.draftNotice.message, tableX + 12, pdf.y + 4, {
      width: tableWidth - 24,
      lineGap: 1,
    });
  }
  pdf.y = Math.max(pdf.y + 36, 300);
  const rows: Array<[string, string]> = [
    ["Participant name", meta.participantName],
    ["NDIS number", meta.ndisNumber],
    ["Date of birth", meta.dateOfBirth],
    ["Plan date", meta.planDate],
    ["Review date", meta.reviewDate],
  ];
  const labelWidth = 150;
  const rowHeight = 34;
  pdf.fontSize(10);
  for (const [label, value] of rows) {
    const y = pdf.y;
    pdf.rect(tableX, y, tableWidth, rowHeight).stroke("#7F97AA");
    pdf.rect(tableX, y, labelWidth, rowHeight).fill("#D9E6EF").stroke("#7F97AA");
    pdf.fillColor("#17324D").font("Helvetica-Bold").text(label, tableX + 10, y + 11, { width: labelWidth - 20 });
    pdf.fillColor("#111827").font("Helvetica").text(value, tableX + labelWidth + 10, y + 11, {
      width: tableWidth - labelWidth - 20,
    });
    pdf.y = y + rowHeight;
  }
  pdf.y = pdf.page.height - 150;
  pdf.fillColor("#6B7280").font("Helvetica").fontSize(9).text(
    "Confidential participant care document. For authorised MH&R use only.",
    tableX,
    pdf.y,
    { width: tableWidth, align: "center" },
  );
}

function renderPdfFooter(
  pdf: PDFKit.PDFDocument,
  doc: IntermediateDocument,
  pageNumber: number,
  pageCount: number,
): void {
  const participant = doc.carePlanMetadata?.participantName ?? buildCarePlanMetadata(doc).participantName;
  const footer = `${participant} · Page ${pageNumber} of ${pageCount} · Confidential — MH&R Holdings Pty Ltd`;
  pdf.fontSize(8).fillColor("#6B7280")
    .text(
      footer,
      72,
      pdf.page.height - 40,
      { align: "center", width: pdf.page.width - 144 },
    );
}

function calculatePdfTableColumnWidths(
  rows: DocumentNode[],
  tableWidth: number,
  colCount: number,
): number[] {
  const minimumWidth = Math.min(72, tableWidth / Math.max(colCount, 1));
  const weights = Array.from({ length: colCount }, (_, columnIndex) => {
    const longest = Math.max(
      1,
      ...rows.map((row) => (row.children?.[columnIndex]?.content ?? "").length),
    );
    return Math.max(minimumWidth, Math.sqrt(longest) * 18);
  });
  const minimumTotal = minimumWidth * colCount;
  if (minimumTotal >= tableWidth) return Array.from({ length: colCount }, () => tableWidth / colCount);

  const flexibleWidth = tableWidth - minimumTotal;
  const flexibleWeight = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => minimumWidth + (weight / flexibleWeight) * flexibleWidth);
}

function calculatePdfTableRowHeight(
  pdf: PDFKit.PDFDocument,
  cells: DocumentNode[],
  colWidths: number[],
  isHeader: boolean,
): number {
  pdf.font(isHeader ? "Helvetica-Bold" : "Helvetica").fontSize(9);
  const heights = colWidths.map((colWidth, index) =>
    pdf.heightOfString(cells[index]?.content ?? "", {
      width: colWidth - 8,
      lineGap: 1,
    }) + 8,
  );
  return Math.max(20, ...heights);
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
    const metadata = doc.carePlanMetadata ?? buildCarePlanMetadata(doc);

    // ── Cover page ──────────────────────────────────────────────────────────
    paragraphs.push(
      new Paragraph({
        text: "Care Plan",
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
      }),
      new Paragraph({
        text: doc.organisation,
        alignment: AlignmentType.CENTER,
      }),
      ...(doc.draftNotice?.blocked ? [
        new Paragraph({ text: "" }),
        new Paragraph({
          children: [new TextRun({ text: "UNAPPROVED DRAFT", bold: true, color: "7F1D1D" })],
          border: {
            top: { style: BorderStyle.SINGLE, size: 8, color: "B91C1C" },
            bottom: { style: BorderStyle.SINGLE, size: 8, color: "B91C1C" },
            left: { style: BorderStyle.SINGLE, size: 8, color: "B91C1C" },
            right: { style: BorderStyle.SINGLE, size: 8, color: "B91C1C" },
          },
          shading: { fill: "FDECEC" } as any,
        }),
        new Paragraph({
          text: doc.draftNotice.message,
          shading: { fill: "FDECEC" } as any,
        }),
      ] : []),
      new Paragraph({ text: "" }),
      buildDocxMetadataTable(metadata),
      new Paragraph({
        children: [new TextRun({ text: "Confidential participant care document. For authorised MH&R use only.", italics: true })],
        alignment: AlignmentType.CENTER,
      }),
      new Paragraph({ children: [new PageBreak()] }),
    );

    let sectionNumber = 0;

    // ── Document nodes ──────────────────────────────────────────────────────
    for (const node of doc.nodes) {
      switch (node.type) {
        case "heading": {
          const level = node.level ?? 1;
          const text = level === 1 ? `${++sectionNumber}. ${node.content ?? ""}` : node.content ?? "";
          paragraphs.push(
            new Paragraph({
              text,
              heading: DOCX_HEADING[level] ?? HeadingLevel.HEADING_1,
              spacing: { before: level === 1 ? 260 : 160, after: 120 },
              border: level <= 2 ? { bottom: { style: BorderStyle.SINGLE, size: 4, color: "9DB5C8" } } : undefined,
            }),
          );
          break;
        }

        case "paragraph":
          paragraphs.push(new Paragraph({
            text: node.content ?? "",
            spacing: { after: 120 },
          }));
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
                shading: ri === 0 ? { fill: "D9E6EF" } as any : undefined,
                borders: docxTableCellBorders("7F97AA"),
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
      sections: [{
        properties: {
          page: {
            margin: { top: 1008, bottom: 1008, left: 1008, right: 1008, footer: 480 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: `${metadata.participantName} · Page `, size: 16, color: "6B7280" }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "6B7280" }),
                  new TextRun({ text: " of ", size: 16, color: "6B7280" }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: "6B7280" }),
                  new TextRun({ text: " · Confidential — MH&R Holdings Pty Ltd", size: 16, color: "6B7280" }),
                ],
              }),
            ],
          }),
        },
        children: paragraphs,
      }],
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

function buildDocxMetadataTable(metadata: CarePlanDocumentMetadata): Table {
  const rows: Array<[string, string]> = [
    ["Participant name", metadata.participantName],
    ["NDIS number", metadata.ndisNumber],
    ["Date of birth", metadata.dateOfBirth],
    ["Plan date", metadata.planDate],
    ["Review date", metadata.reviewDate],
  ];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(([label, value]) => new TableRow({
      children: [
        new TableCell({
          shading: { fill: "D9E6EF" } as any,
          borders: docxTableCellBorders("7F97AA"),
          children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })],
        }),
        new TableCell({
          borders: docxTableCellBorders("7F97AA"),
          children: [new Paragraph({ text: value })],
        }),
      ],
    })),
  });
}

function docxTableCellBorders(color: string) {
  return {
    top: { style: BorderStyle.SINGLE, size: 4, color },
    bottom: { style: BorderStyle.SINGLE, size: 4, color },
    left: { style: BorderStyle.SINGLE, size: 4, color },
    right: { style: BorderStyle.SINGLE, size: 4, color },
  };
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

    const generatedDate = new Date().toLocaleDateString("en-AU", {
      day: "numeric", month: "long", year: "numeric",
    });
    const sourceMarkdown = resolvedVersion.contentMarkdown;
    const clientArtifactMarkdown = ["pdf", "docx"].includes(format)
      ? prepareClientArtifactMarkdown(sourceMarkdown)
      : sourceMarkdown;
    // Normalise content format before parsing — converts JSON/fenced-JSON to
    // human-readable markdown so exporters never see raw braces or property names.
    const normalised = normaliseCompletedWorkContent(clientArtifactMarkdown);
    const nodes      = parseMarkdown(normalised);
    const carePlanMetadata = ["pdf", "docx"].includes(format)
      ? await buildStructuredCarePlanMetadata({
          workId,
          organisationId,
          title: work.title,
          generatedDate,
          nodes,
        })
      : buildCarePlanMetadata({ title: work.title, generatedDate, nodes });

    const intermediateDoc: IntermediateDocument = {
      title:          work.title,
      organisation:   organisationName,
      generatedDate,
      specialist:     formatSpecialist(work.primarySpecialist),
      approvalStatus: formatApprovalStatus(work.status),
      version:        resolvedVersion.versionNumber,
      nodes,
      carePlanMetadata,
      draftNotice: exportDraftNoticeMetadata(work),
    };

    let result: ExportResult;
    switch (format) {
      case "md":
        result = this.mdExporter.export(intermediateDoc, sourceMarkdown);
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
