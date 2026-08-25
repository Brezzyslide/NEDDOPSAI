import { access, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IntermediateDocument } from "./services/completedWorkExportService.js";

const REQUIRED_PDFKIT_DATA_FILES = [
  "Courier-Bold.afm",
  "Courier-BoldOblique.afm",
  "Courier-Oblique.afm",
  "Courier.afm",
  "Helvetica-Bold.afm",
  "Helvetica-BoldOblique.afm",
  "Helvetica-Oblique.afm",
  "Helvetica.afm",
  "Symbol.afm",
  "Times-Bold.afm",
  "Times-BoldItalic.afm",
  "Times-Italic.afm",
  "Times-Roman.afm",
  "ZapfDingbats.afm",
  "sRGB_IEC61966_2_1.icc",
] as const;

async function assertPdfKitRuntimeAssets() {
  const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
  const dataDir = path.join(runtimeDir, "data");
  for (const file of REQUIRED_PDFKIT_DATA_FILES) {
    const filePath = path.join(dataDir, file);
    await access(filePath);
    const info = await stat(filePath);
    if (info.size <= 0) {
      throw new Error(`PDFKit runtime asset is empty: ${filePath}`);
    }
  }
  return dataDir;
}

async function renderSyntheticPdf() {
  process.env.DATABASE_URL ??= "postgres://needsops_smoke:needsops_smoke@localhost:5432/needsops_smoke";
  const { PdfExporter } = await import("./services/completedWorkExportService.js");
  const doc: IntermediateDocument = {
    title: "NeedsOps PDF Runtime Smoke",
    organisation: "NeedsOps Dev",
    generatedDate: new Date("2026-08-25T00:00:00.000Z").toISOString(),
    specialist: "System",
    approvalStatus: "Smoke Test",
    version: 1,
    nodes: [
      { type: "heading", level: 1, content: "Runtime Smoke" },
      { type: "paragraph", content: "This PDF proves bundled PDFKit standard-font runtime data is available." },
    ],
  };
  const result = await new PdfExporter().export(doc);
  if (result.mimeType !== "application/pdf") {
    throw new Error(`Unexpected PDF MIME type: ${result.mimeType}`);
  }
  if (result.buffer.length <= 100 || result.buffer.slice(0, 4).toString("ascii") !== "%PDF") {
    throw new Error(`Synthetic PDF is invalid or empty; size=${result.buffer.length}`);
  }
  return { bytes: result.buffer.length, filename: result.filename };
}

async function main() {
  const dataDir = await assertPdfKitRuntimeAssets();
  const pdf = await renderSyntheticPdf();
  console.log(JSON.stringify({ ok: true, dataDir, pdf }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
