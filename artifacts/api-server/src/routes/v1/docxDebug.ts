/**
 * DOCX Debug Route — Sprint 28.6
 *
 * Reproduces the exact DOCX extraction failure outside the queue so we can
 * see the error before the job sweeper dead-letters it silently.
 *
 * GET /v1/platform/debug/docx-extract?storageKey=<key>
 *
 * Returns:
 *   { stage, success, extractedLength?, error?, errorCode?, stack? }
 *
 * Platform staff only. Never surfaces credentials.
 */

import { Router } from "express";
import { requirePlatformAuth } from "../../middlewares/requirePlatformRole.js";

const router = Router();

router.get(
  "/platform/debug/docx-extract",
  requirePlatformAuth,
  async (req, res, next) => {
    const storageKey = String(req.query.storageKey ?? "").trim();
    if (!storageKey) {
      return res.status(400).json({ error: "storageKey query param is required" });
    }

    let stage = "config";
    try {
      // ── 1. Resolve storage path ──────────────────────────────────────────────
      const privateDir = process.env.PRIVATE_OBJECT_DIR;
      if (!privateDir) {
        return res.status(503).json({ stage, success: false, errorCode: "STORAGE_NOT_CONFIGURED", error: "PRIVATE_OBJECT_DIR is not set" });
      }

      const parts    = privateDir.replace(/^\//, "").split("/").filter(Boolean);
      const bucketId = parts[0];
      if (!bucketId) {
        return res.status(503).json({ stage, success: false, errorCode: "STORAGE_MISCONFIGURED", error: "PRIVATE_OBJECT_DIR cannot be parsed — expected /{bucketId}/{prefix}" });
      }
      const prefix     = parts.slice(1).join("/");
      const objectName = prefix ? `${prefix}/${storageKey}` : storageKey;

      // ── 2. Fetch from object storage ─────────────────────────────────────────
      stage = "fetching";
      const { objectStorageClient } = await import("../../lib/objectStorage.js");
      const bucket = objectStorageClient.bucket(bucketId);
      let fileBuffer: Buffer;
      try {
        const [dl] = await bucket.file(objectName).download();
        fileBuffer = dl as Buffer;
      } catch (fetchErr) {
        const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        return res.status(422).json({ stage, success: false, errorCode: "FETCH_FAILED", error: msg.slice(0, 500) });
      }

      // ── 3. Extract text from DOCX ─────────────────────────────────────────────
      stage = "extracting";
      let extractedText = "";
      let extractWarnings: string[] = [];
      try {
        const mammoth = await import("mammoth");
        const { value, messages } = await mammoth.extractRawText({ buffer: fileBuffer });
        extractedText  = value;
        extractWarnings = messages.map((m: { type: string; message: string }) => `[${m.type}] ${m.message}`);
      } catch (extractErr) {
        const msg   = extractErr instanceof Error ? extractErr.message : String(extractErr);
        const stack = extractErr instanceof Error ? extractErr.stack?.slice(0, 2000) : undefined;
        return res.status(422).json({ stage, success: false, errorCode: "EXTRACTION_FAILED", error: msg.slice(0, 500), stack });
      }

      // ── 4. Normalise ─────────────────────────────────────────────────────────
      stage = "normalising";
      const normalised = extractedText
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\t/g, "  ")
        .replace(/[ ]{3,}/g, "  ")
        .replace(/\n{4,}/g, "\n\n\n")
        .trim();

      // ── 5. Summary ───────────────────────────────────────────────────────────
      const lineCount = normalised.split("\n").length;
      const wordCount = normalised.split(/\s+/).filter(Boolean).length;

      return res.status(200).json({
        success:         true,
        stage:           "complete",
        storageKey,
        objectName,
        bucketId,
        bufferSizeBytes: fileBuffer.length,
        extractedLength: normalised.length,
        lineCount,
        wordCount,
        extractWarnings,
        previewStart:    normalised.slice(0, 500),
        previewEnd:      normalised.slice(-300),
      });

    } catch (err) {
      next(err);
    }
  },
);

export default router;
