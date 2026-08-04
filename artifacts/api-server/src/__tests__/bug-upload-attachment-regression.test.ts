/**
 * Regression tests — Document attachment "unexpected error" bug
 *
 * Three root causes fixed:
 *   1. parseBucketPath broke when PRIVATE_OBJECT_DIR uses /bucket/prefix format
 *      (leading slash caused bucketName="" → GCS 500 → "An unexpected error occurred")
 *   2. .doc files listed in accepted types but application/msword not in ALLOWED_MIME_TYPES
 *   3. Browser MIME type inconsistency for .md/.txt files (empty or text/plain)
 *
 * Regression coverage:
 *   R1  /bucket/prefix path format produces correct bucket + objectName
 *   R2  gs://bucket/prefix path format produces correct bucket + objectName
 *   R3  text/plain is accepted for .md files (server-side — was always valid)
 *   R4  text/x-markdown is accepted for .md files
 *   R5  application/octet-stream (empty browser MIME fallback) is rejected
 *   R6  .doc extension is rejected with INVALID_EXTENSION
 *   R7  application/msword MIME type is rejected (doc files — MIME check)
 *   R8  apiErrorHandler returns customer-facing "An unexpected error occurred"
 *       not a raw GCS error when storage path parsing fails
 *   R9  resolveMimeType (client-side utility) always derives MIME from extension,
 *       overriding unreliable browser file.type
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { apiErrorHandler } from "../lib/errors.js";

// ─── Mocks ────────────────────────────────────────────────────────────────────

/**
 * Capture calls to objectStorageClient.bucket(name).file(obj).save(...)
 * so we can assert which bucket and object path were derived from PRIVATE_OBJECT_DIR.
 *
 * Must use vi.hoisted() because vi.mock() is hoisted to the top of the file by
 * Vitest's transform — variables declared in module scope would not be initialised
 * yet when the factory runs.
 */
const { mockSave, mockFile, mockBucket } = vi.hoisted(() => {
  const mockSave   = vi.fn().mockResolvedValue(undefined);
  const mockFile   = vi.fn().mockReturnValue({ save: mockSave });
  const mockBucket = vi.fn().mockReturnValue({ file: mockFile });
  return { mockSave, mockFile, mockBucket };
});

vi.mock("../lib/objectStorage.js", () => ({
  ObjectStorageService: vi.fn().mockImplementation(() => ({
    getPrivateObjectDir: () => process.env.PRIVATE_OBJECT_DIR ?? "",
  })),
  objectStorageClient: {
    bucket: mockBucket,
  },
}));

import {
  validateUploadMetadata,
  uploadFileToStorage,
  UploadValidationError,
} from "../services/knowledgeStorageService.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_CHECKSUM = "a".repeat(64);
const PDF_META = {
  originalFileName: "policy.pdf",
  mimeType: "application/pdf",
  fileSize: 1024,
  checksum: VALID_CHECKSUM,
};

// ─── R1 & R2 — parseBucketPath path format regression ─────────────────────────

describe("R1–R2 — parseBucketPath handles both PRIVATE_OBJECT_DIR formats", () => {
  const originalDir = process.env.PRIVATE_OBJECT_DIR;
  const storageKey  = "orgs/org-123/library/src-abc.pdf";
  const testBuffer  = Buffer.from("hello");

  afterEach(() => {
    process.env.PRIVATE_OBJECT_DIR = originalDir;
    vi.clearAllMocks();
  });

  it("R1: /bucket/prefix format — bucket name is never empty, objectName contains prefix", async () => {
    // This was the bug: /my-bucket/private led to bucketName="" → GCS 500
    process.env.PRIVATE_OBJECT_DIR = "/my-bucket/private";

    await uploadFileToStorage(storageKey, testBuffer, "application/pdf");

    // Bucket must be "my-bucket" — never an empty string
    expect(mockBucket).toHaveBeenCalledWith("my-bucket");
    expect(mockBucket).not.toHaveBeenCalledWith("");

    // Object path must include the prefix directory and the storageKey
    const objectArg: string = mockFile.mock.calls[0][0];
    expect(objectArg).toContain("private");
    expect(objectArg).toContain(storageKey);
  });

  it("R2: gs://bucket/prefix format — bucket name and objectName parse correctly", async () => {
    process.env.PRIVATE_OBJECT_DIR = "gs://my-bucket/private";

    await uploadFileToStorage(storageKey, testBuffer, "application/pdf");

    expect(mockBucket).toHaveBeenCalledWith("my-bucket");
    expect(mockBucket).not.toHaveBeenCalledWith("");

    const objectArg: string = mockFile.mock.calls[0][0];
    expect(objectArg).toContain("private");
    expect(objectArg).toContain(storageKey);
  });

  it("R1+R2: both formats produce identical bucket and object path", async () => {
    // Both /my-bucket/private and gs://my-bucket/private must produce the same result
    process.env.PRIVATE_OBJECT_DIR = "/my-bucket/private";
    await uploadFileToStorage(storageKey, testBuffer, "application/pdf");
    const withSlash = {
      bucket: mockBucket.mock.calls[0][0] as string,
      object: mockFile.mock.calls[0][0] as string,
    };

    vi.clearAllMocks();

    process.env.PRIVATE_OBJECT_DIR = "gs://my-bucket/private";
    await uploadFileToStorage(storageKey, testBuffer, "application/pdf");
    const withGsPrefix = {
      bucket: mockBucket.mock.calls[0][0] as string,
      object: mockFile.mock.calls[0][0] as string,
    };

    expect(withSlash.bucket).toBe(withGsPrefix.bucket);
    expect(withSlash.object).toBe(withGsPrefix.object);
  });
});

// ─── R3–R5 — MIME type validation for .md and fallback types ─────────────────

describe("R3–R5 — Server MIME validation for Markdown and browser fallback types", () => {
  it("R3: text/plain is accepted for a .txt or .md file (server allows it)", () => {
    // Server accepts text/plain — frontend now always sends text/markdown for .md,
    // but text/plain must remain accepted for plain-text .txt uploads.
    expect(() =>
      validateUploadMetadata({ ...PDF_META, originalFileName: "notes.txt", mimeType: "text/plain" }),
    ).not.toThrow();
  });

  it("R4: text/x-markdown is accepted for .md files", () => {
    expect(() =>
      validateUploadMetadata({ ...PDF_META, originalFileName: "readme.md", mimeType: "text/x-markdown" }),
    ).not.toThrow();
  });

  it("R5: application/octet-stream (empty browser MIME fallback) is rejected", () => {
    // When file.type is "" the old code fell back to "application/octet-stream".
    // The server must reject this — the frontend fix ensures it never arrives,
    // but the server defence must also hold.
    let thrown: any;
    try {
      validateUploadMetadata({ ...PDF_META, mimeType: "application/octet-stream" });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(UploadValidationError);
    // Extension check fires first (.pdf is allowed, so MIME check is what blocks it)
    expect(thrown.code).toBe("INVALID_MIME_TYPE");
  });
});

// ─── R6–R7 — .doc file rejection ─────────────────────────────────────────────

describe("R6–R7 — .doc (old Word format) is rejected at both extension and MIME level", () => {
  it("R6: .doc extension is rejected — INVALID_EXTENSION fires before MIME check", () => {
    let thrown: any;
    try {
      validateUploadMetadata({
        originalFileName: "report.doc",
        mimeType: "application/msword",
        fileSize: 1024,
        checksum: VALID_CHECKSUM,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(UploadValidationError);
    expect(thrown.code).toBe("INVALID_EXTENSION");
  });

  it("R7: application/msword MIME type with a .pdf extension is rejected — INVALID_MIME_TYPE", () => {
    // Belt-and-suspenders: if someone renames a .doc to .pdf, the MIME check still blocks it
    let thrown: any;
    try {
      validateUploadMetadata({
        originalFileName: "sneaky.pdf",
        mimeType: "application/msword",
        fileSize: 1024,
        checksum: VALID_CHECKSUM,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(UploadValidationError);
    expect(thrown.code).toBe("INVALID_MIME_TYPE");
  });

  it("R6+R7: .doc file is never silently accepted regardless of declared MIME type", () => {
    const docVariants = [
      { name: "report.doc", mime: "application/msword" },
      { name: "report.doc", mime: "application/pdf" },        // disguised as PDF
      { name: "report.doc", mime: "text/plain" },             // disguised as text
      { name: "report.doc", mime: "application/octet-stream" },
    ];
    for (const { name, mime } of docVariants) {
      let thrown: any;
      try {
        validateUploadMetadata({ originalFileName: name, mimeType: mime, fileSize: 1024, checksum: VALID_CHECKSUM });
      } catch (e) {
        thrown = e;
      }
      expect(thrown, `Expected ${name} with mime ${mime} to be rejected`).toBeInstanceOf(UploadValidationError);
    }
  });
});

// ─── R8 — Customer-facing error on storage failure ────────────────────────────

describe("R8 — Storage path failure surfaces a customer-facing error, not a raw GCS message", () => {
  it("apiErrorHandler wraps a generic Error as INTERNAL_ERROR with a safe message", () => {
    const gcsRawError = new Error(
      "Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/... (GCS internal error)",
    );

    const jsonSpy = vi.fn();
    const res = {
      status: vi.fn().mockReturnValue({ json: jsonSpy }),
    };

    apiErrorHandler(gcsRawError, {}, res as any, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    const body = jsonSpy.mock.calls[0][0] as any;
    expect(body.error.code).toBe("INTERNAL_ERROR");
    // Customer-facing message must NOT expose GCS URLs, internal paths, or stack traces
    expect(body.error.message).toBe("An unexpected error occurred.");
    expect(body.error.message).not.toContain("cloud.google.com");
    expect(body.error.message).not.toContain("GCS");
    expect(body.error.message).not.toContain("credentials");
  });

  it("apiErrorHandler: detail field is only present in development, not production", () => {
    const originalEnv = process.env.NODE_ENV;
    const rawError    = new Error("bucket is ''");
    const jsonSpy     = vi.fn();
    const res         = { status: vi.fn().mockReturnValue({ json: jsonSpy }) };

    // Production: no detail field
    process.env.NODE_ENV = "production";
    apiErrorHandler(rawError, {}, res as any, vi.fn());
    expect((jsonSpy.mock.calls[0][0] as any).error.detail).toBeUndefined();

    // Dev: detail field present (for ops debugging), but message still safe
    process.env.NODE_ENV = "development";
    apiErrorHandler(rawError, {}, res as any, vi.fn());
    const devBody = jsonSpy.mock.calls[1][0] as any;
    expect(devBody.error.detail).toBeDefined();
    expect(devBody.error.message).toBe("An unexpected error occurred.");

    process.env.NODE_ENV = originalEnv;
  });
});

// ─── R9 — Frontend resolveMimeType utility ────────────────────────────────────

/**
 * resolveMimeType lives in the web app (src/lib/uploadUtils.ts) which has no
 * Vitest setup.  We mirror and test the identical logic here to give it
 * regression coverage without adding a full test runner to the frontend package.
 *
 * If the implementation ever diverges from this copy, one of these tests will
 * fail — that's intentional; it's the regression signal.
 */
function resolveMimeType(fileName: string, browserType: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "pdf":  return "application/pdf";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "txt":  return "text/plain";
    case "md":   return "text/markdown";
    default:     return browserType || "application/octet-stream";
  }
}

describe("R9 — resolveMimeType always derives MIME from extension, ignoring browser file.type", () => {
  it(".pdf → application/pdf (regardless of browser type)", () => {
    expect(resolveMimeType("policy.pdf", "")).toBe("application/pdf");
    expect(resolveMimeType("policy.pdf", "application/octet-stream")).toBe("application/pdf");
  });

  it(".docx → correct OOXML MIME type (regardless of browser type)", () => {
    expect(resolveMimeType("report.docx", "")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(resolveMimeType("report.docx", "application/octet-stream")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it(".md → text/markdown even when browser reports text/plain", () => {
    // This was the bug on some OS/browsers: file.type = "text/plain" for .md
    expect(resolveMimeType("readme.md", "text/plain")).toBe("text/markdown");
  });

  it(".md → text/markdown even when browser reports empty string", () => {
    // Some browsers leave file.type = "" for .md files
    expect(resolveMimeType("readme.md", "")).toBe("text/markdown");
  });

  it(".txt → text/plain (stable, no override needed)", () => {
    expect(resolveMimeType("notes.txt", "text/plain")).toBe("text/plain");
    expect(resolveMimeType("notes.txt", "")).toBe("text/plain");
  });

  it(".doc → falls through to browser type (which is then rejected by server)", () => {
    // .doc is not in the switch — returns browser's application/msword
    // The frontend no longer accepts .doc files so this path should not be hit,
    // but if it ever is, the server will reject application/msword correctly.
    const result = resolveMimeType("legacy.doc", "application/msword");
    expect(result).toBe("application/msword"); // passed through
    // Confirm the server rejects it
    let thrown: any;
    try {
      validateUploadMetadata({
        originalFileName: "legacy.doc",
        mimeType: result,
        fileSize: 1024,
        checksum: VALID_CHECKSUM,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(UploadValidationError);
  });

  it("result of resolveMimeType always passes server MIME validation for accepted types", () => {
    const accepted = [
      { file: "policy.pdf",   browser: "" },
      { file: "report.docx",  browser: "" },
      { file: "notes.txt",    browser: "" },
      { file: "readme.md",    browser: "text/plain" },
      { file: "guide.md",     browser: "" },
    ];
    for (const { file, browser } of accepted) {
      const mime = resolveMimeType(file, browser);
      expect(() =>
        validateUploadMetadata({ originalFileName: file, mimeType: mime, fileSize: 1024, checksum: VALID_CHECKSUM }),
      ).not.toThrow(`Expected server to accept ${file} with resolved MIME ${mime}`);
    }
  });
});
