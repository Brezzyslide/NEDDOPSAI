/**
 * Upload utilities — shared between OrgLibraryPage and any future upload surfaces.
 *
 * Pure functions only; no React deps so they can be unit-tested independently.
 */

/**
 * Resolve the canonical MIME type for a file, derived from its extension.
 *
 * Browsers are inconsistent: .md files may come in as "text/plain", "" or even
 * undefined depending on the OS and browser.  .doc files report "application/msword"
 * which is not accepted by the server.  Always derive from the extension so the
 * server always receives the correct MIME type regardless of what the browser reports.
 */
export function resolveMimeType(file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "pdf":  return "application/pdf";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "txt":  return "text/plain";
    case "md":   return "text/markdown";
    default:     return file.type || "application/octet-stream";
  }
}

/**
 * File types accepted by the upload dialog.
 * Keep this in sync with ALLOWED_EXTENSIONS in knowledgeStorageService.ts.
 * .doc (application/msword) is intentionally excluded — old Word format cannot
 * be parsed reliably. Users should convert to .docx first.
 */
export const ACCEPTED_UPLOAD_TYPES = ".pdf,.docx,.txt,.md";
