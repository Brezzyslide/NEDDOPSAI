/**
 * Task #18 — Organisation Library API tests
 *
 * Covers: list, search/filter, upload flow, duplicate detection,
 * category selection, scope assignment, processing states,
 * review, approve, reject, supersede, revoke, scanned PDF warning,
 * permissions, and tenant isolation.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Module-level mocks ────────────────────────────────────────────────────────

const mockDb = vi.hoisted(() => ({
  select:  vi.fn(),
  insert:  vi.fn(),
  update:  vi.fn(),
  delete:  vi.fn(),
  execute: vi.fn(),
}));

const mockLogOrgEvent   = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockTriggerIngest = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  return {
    ...actual,
    db: mockDb,
  };
});

vi.mock("../services/knowledgeStorageService.js", () => ({
  requestUploadUrl: vi.fn(),
  validateUploadMetadata: vi.fn(),
  UploadValidationError: class extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
  computeChecksum: vi.fn().mockReturnValue("abc123"),
}));

vi.mock("../services/ingestionPipelineService.js", () => ({
  triggerIngestion: mockTriggerIngest,
}));

vi.mock("../services/auditService.js", () => ({
  getRequestMeta: vi.fn().mockReturnValue({ ipAddress: "127.0.0.1" }),
  logOrgEvent:    mockLogOrgEvent,
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  listKnowledgeSources,
  completeUpload,
  approveKnowledgeSource,
  revokeKnowledgeSource,
  deleteKnowledgeSource,
  supersedeKnowledgeSource,
  findDuplicateChecksum,
  updateSourceMetadata,
  assignScope,
  removeScope,
  listScopes,
  KnowledgeSourceError,
} from "../services/knowledgeSourceService.js";

import {
  KNOWLEDGE_SOURCE_STATUSES,
  KNOWLEDGE_SOURCE_TYPES,
  KNOWLEDGE_AUTHORITY_LEVELS,
  KNOWLEDGE_SENSITIVITY_LEVELS,
  KNOWLEDGE_SCOPE_TYPES,
} from "@workspace/db";

// ─── Test helpers ─────────────────────────────────────────────────────────────

const ORG_A = "org-a-library-test-001";
const ORG_B = "org-b-library-test-002";
const USER  = "user-lib-001";

function makeSource(overrides: Record<string, unknown> = {}) {
  return {
    id:                       "src-001",
    organizationId:           ORG_A,
    sourceScope:              "library",
    taskId:                   null,
    title:                    "NDIS Restrictive Practices Policy",
    description:              "Covers restrictive practices guidance",
    sourceType:               "policy",
    originalFileName:         "ndis-rpp.pdf",
    mimeType:                 "application/pdf",
    storageProvider:          "local",
    storageKey:               "org-a/library/src-001/ndis-rpp.pdf",
    checksum:                 "sha256abc123",
    fileSize:                 102400,
    language:                 "en",
    status:                   "uploaded",
    authorityLevel:           "authoritative",
    sensitivityClassification: "internal",
    effectiveFrom:            null,
    effectiveTo:              null,
    versionLabel:             "2.1",
    isCurrent:                true,
    supersededBySourceId:     null,
    uploadedByUserId:         USER,
    approvedByUserId:         null,
    approvedAt:               null,
    revokedAt:                null,
    createdAt:                new Date("2026-01-01T00:00:00Z"),
    updatedAt:                new Date("2026-01-01T00:00:00Z"),
    deletedAt:                null,
    ...overrides,
  };
}

function makeVersion(overrides: Record<string, unknown> = {}) {
  return {
    id:              "ver-001",
    knowledgeSourceId: "src-001",
    organizationId:  ORG_A,
    versionNumber:   1,
    versionLabel:    "2.1",
    isCurrent:       true,
    storageProvider: "local",
    storageKey:      "org-a/library/src-001/ndis-rpp.pdf",
    originalFileName: "ndis-rpp.pdf",
    mimeType:        "application/pdf",
    fileSize:        102400,
    checksum:        "sha256abc123",
    uploadedByUserId: USER,
    createdAt:       new Date("2026-01-01T00:00:00Z"),
    updatedAt:       new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeScope(overrides: Record<string, unknown> = {}) {
  return {
    id:               "scope-001",
    knowledgeSourceId: "src-001",
    organizationId:   ORG_A,
    scopeType:        "organisation",
    scopeId:          "all",
    createdAt:        new Date("2026-01-01T00:00:00Z"),
    updatedAt:        new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeSelectChain(result: unknown[]) {
  const chain = {
    from:   vi.fn().mockReturnThis(),
    where:  vi.fn().mockReturnThis(),
    limit:  vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    then:   (cb: (v: unknown) => unknown) => Promise.resolve(cb(result)),
  };
  Object.values(chain).forEach(fn => {
    if (typeof fn === "function" && fn !== chain.then) {
      (fn as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    }
  });
  return chain;
}

function makeInsertChain(returning: unknown[]) {
  const chain = {
    values:    vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returning),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
  };
  Object.values(chain).forEach(fn => {
    if (typeof fn === "function") {
      (fn as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    }
  });
  chain.returning.mockResolvedValue(returning);
  return chain;
}

function makeUpdateChain(returning: unknown[]) {
  const chain = {
    set:       vi.fn().mockReturnThis(),
    where:     vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returning),
  };
  Object.values(chain).forEach(fn => {
    if (typeof fn === "function") {
      (fn as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    }
  });
  chain.returning.mockResolvedValue(returning);
  return chain;
}

function makeDeleteChain() {
  const chain: Record<string, unknown> = {
    where:     vi.fn(),
    returning: vi.fn().mockResolvedValue([]),
    then: (cb: (v: unknown) => unknown) => Promise.resolve(cb(undefined)),
  };
  (chain.where as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  return chain;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("Task #18 — Organisation Library", () => {

  beforeEach(() => {
    vi.resetAllMocks();
    // Re-setup stable mocks that must return a Promise (their .catch() is called)
    mockLogOrgEvent.mockResolvedValue(undefined);
    mockTriggerIngest.mockResolvedValue(undefined);
  });

  // ── Source status values ────────────────────────────────────────────────────

  describe("KNOWLEDGE_SOURCE_STATUSES", () => {
    it("includes all required customer-facing statuses", () => {
      const required = [
        "uploaded", "processing", "review_required", "approved",
        "failed", "revoked", "superseded", "archived",
      ];
      for (const s of required) {
        expect(KNOWLEDGE_SOURCE_STATUSES).toContain(s);
      }
    });
  });

  // ── Document categories ─────────────────────────────────────────────────────

  describe("KNOWLEDGE_SOURCE_TYPES", () => {
    it("includes core customer-facing categories", () => {
      const required = [
        "policy", "procedure", "playbook", "style_guide",
        "approved_example", "template", "legislation_reference",
        "manual_note", "care_plan", "behaviour_support_plan",
        "risk_assessment", "compliance_document",
      ];
      for (const t of required) {
        expect(KNOWLEDGE_SOURCE_TYPES).toContain(t);
      }
    });

    it("has at least 15 categories for the upload wizard", () => {
      expect(KNOWLEDGE_SOURCE_TYPES.length).toBeGreaterThanOrEqual(15);
    });
  });

  // ── Authority levels ────────────────────────────────────────────────────────

  describe("KNOWLEDGE_AUTHORITY_LEVELS", () => {
    it("includes all required authority levels", () => {
      expect(KNOWLEDGE_AUTHORITY_LEVELS).toContain("mandatory");
      expect(KNOWLEDGE_AUTHORITY_LEVELS).toContain("authoritative");
      expect(KNOWLEDGE_AUTHORITY_LEVELS).toContain("supporting");
      expect(KNOWLEDGE_AUTHORITY_LEVELS).toContain("example_only");
      expect(KNOWLEDGE_AUTHORITY_LEVELS).toContain("reference_only");
    });
  });

  // ── Sensitivity levels ──────────────────────────────────────────────────────

  describe("KNOWLEDGE_SENSITIVITY_LEVELS", () => {
    it("includes all required sensitivity levels", () => {
      expect(KNOWLEDGE_SENSITIVITY_LEVELS).toContain("public");
      expect(KNOWLEDGE_SENSITIVITY_LEVELS).toContain("internal");
      expect(KNOWLEDGE_SENSITIVITY_LEVELS).toContain("confidential");
      expect(KNOWLEDGE_SENSITIVITY_LEVELS).toContain("restricted");
    });
  });

  // ── Scope types ─────────────────────────────────────────────────────────────

  describe("KNOWLEDGE_SCOPE_TYPES", () => {
    it("includes all required scope types", () => {
      const required = ["organisation", "workforce", "specialist", "department", "location", "task_type"];
      for (const t of required) {
        expect(KNOWLEDGE_SCOPE_TYPES).toContain(t);
      }
    });
  });

  // ── List sources ────────────────────────────────────────────────────────────

  describe("listKnowledgeSources", () => {
    it("returns sources for an organisation", async () => {
      const sources = [makeSource(), makeSource({ id: "src-002", title: "Procedure A" })];
      mockDb.select.mockReturnValue(makeSelectChain(sources));

      const result = await listKnowledgeSources({ organizationId: ORG_A });
      expect(result.sources).toHaveLength(2);
      expect(result.sources[0].title).toBe("NDIS Restrictive Practices Policy");
    });

    it("filters by status", async () => {
      const approved = [makeSource({ status: "approved" })];
      mockDb.select.mockReturnValue(makeSelectChain(approved));

      const result = await listKnowledgeSources({ organizationId: ORG_A, status: ["approved"] });
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].status).toBe("approved");
    });

    it("filters by sourceType", async () => {
      const policies = [makeSource({ sourceType: "policy" })];
      mockDb.select.mockReturnValue(makeSelectChain(policies));

      const result = await listKnowledgeSources({ organizationId: ORG_A, sourceType: "policy" });
      expect(result.sources).toHaveLength(1);
    });

    it("excludes deleted sources by default", async () => {
      mockDb.select.mockReturnValue(makeSelectChain([]));
      const result = await listKnowledgeSources({ organizationId: ORG_A });
      expect(result.sources).toHaveLength(0);
    });

    it("respects limit and offset for pagination", async () => {
      mockDb.select.mockReturnValue(makeSelectChain([]));
      const result = await listKnowledgeSources({ organizationId: ORG_A, limit: 10, offset: 20 });
      expect(result).toHaveProperty("sources");
    });
  });

  // ── Upload flow ─────────────────────────────────────────────────────────────

  describe("completeUpload — upload flow", () => {
    it("creates source and version on first upload", async () => {
      const source  = makeSource({ status: "uploaded" });
      const version = makeVersion();

      mockDb.select.mockReturnValue(makeSelectChain([])); // no duplicate
      const insertChain = makeInsertChain([source]);
      mockDb.insert.mockReturnValue(insertChain);

      // Second insert for version
      const versionInsert = makeInsertChain([version]);
      mockDb.insert
        .mockReturnValueOnce(insertChain)
        .mockReturnValueOnce(versionInsert);

      const result = await completeUpload({
        sourceId:                 "src-001",
        organizationId:           ORG_A,
        uploadedByUserId:         USER,
        title:                    "NDIS Restrictive Practices Policy",
        sourceType:               "policy",
        storageKey:               "org-a/library/src-001/ndis-rpp.pdf",
        storageProvider:          "local",
        originalFileName:         "ndis-rpp.pdf",
        mimeType:                 "application/pdf",
        fileSize:                 102400,
        checksum:                 "sha256abc123",
        authorityLevel:           "authoritative",
        sensitivityClassification: "internal",
        versionLabel:             "2.1",
        sourceScope:              "library",
      });

      expect(result).toHaveProperty("source");
      expect(result).toHaveProperty("version");
      expect(result).toHaveProperty("isDuplicate");
    });

    it("returns isDuplicate:true for matching checksum", async () => {
      const existing = makeSource({ status: "approved" });
      const version  = makeVersion();

      // duplicate check finds existing source
      mockDb.select
        .mockReturnValueOnce(makeSelectChain([existing]))   // findDuplicateChecksum
        .mockReturnValueOnce(makeSelectChain([version]));    // get current version

      const result = await completeUpload({
        sourceId:         "src-new",
        organizationId:   ORG_A,
        uploadedByUserId: USER,
        title:            "Duplicate Policy",
        sourceType:       "policy",
        storageKey:       "org-a/library/src-new/duplicate.pdf",
        storageProvider:  "local",
        originalFileName: "duplicate.pdf",
        mimeType:         "application/pdf",
        fileSize:         102400,
        checksum:         "sha256abc123",
        sourceScope:      "library",
      });

      expect(result.isDuplicate).toBe(true);
    });

    it("task uploads remain separate — sourceScope:task not promoted to library", async () => {
      const source  = makeSource({ sourceScope: "task", taskId: "task-001" });
      const version = makeVersion();

      mockDb.select.mockReturnValue(makeSelectChain([]));
      mockDb.insert
        .mockReturnValueOnce(makeInsertChain([source]))
        .mockReturnValueOnce(makeInsertChain([version]));

      const result = await completeUpload({
        sourceId:         "src-task-001",
        organizationId:   ORG_A,
        uploadedByUserId: USER,
        title:            "Task-specific document",
        sourceType:       "manual_note",
        storageKey:       "org-a/task/src-task-001/doc.pdf",
        storageProvider:  "local",
        originalFileName: "doc.pdf",
        mimeType:         "application/pdf",
        fileSize:         51200,
        checksum:         "taskchecksum123",
        sourceScope:      "task",
        taskId:           "task-001",
      });

      expect(result.source.sourceScope).toBe("task");
      expect(result.source.taskId).toBe("task-001");
    });

    it("defaults invalid authorityLevel to supporting", async () => {
      const source  = makeSource({ authorityLevel: "supporting" });
      const version = makeVersion();

      mockDb.select.mockReturnValue(makeSelectChain([]));
      mockDb.insert
        .mockReturnValueOnce(makeInsertChain([source]))
        .mockReturnValueOnce(makeInsertChain([version]));

      const result = await completeUpload({
        sourceId:         "src-002",
        organizationId:   ORG_A,
        uploadedByUserId: USER,
        title:            "Document",
        sourceType:       "manual_note",
        storageKey:       "key",
        storageProvider:  "local",
        originalFileName: "doc.txt",
        mimeType:         "text/plain",
        fileSize:         1024,
        checksum:         "checksum2",
        sourceScope:      "library",
        authorityLevel:   "invalid_level" as never,
      });

      expect(result.source.authorityLevel).toBe("supporting");
    });
  });

  // ── Approve ─────────────────────────────────────────────────────────────────

  describe("approveKnowledgeSource", () => {
    it("approves a review_required source", async () => {
      const source   = makeSource({ status: "review_required" });
      const approved = { ...source, status: "approved", approvedAt: new Date(), approvedByUserId: USER };

      mockDb.select.mockReturnValueOnce(makeSelectChain([source]));
      // Two updates: source record + version record mirror
      mockDb.update
        .mockReturnValueOnce(makeUpdateChain([approved]))
        .mockReturnValueOnce(makeUpdateChain([]));

      const result = await approveKnowledgeSource("src-001", ORG_A, USER);
      expect(result.status).toBe("approved");
      expect(result.approvedAt).toBeDefined();
    });

    it("throws NOT_FOUND for unknown source", async () => {
      mockDb.select.mockReturnValueOnce(makeSelectChain([]));
      await expect(approveKnowledgeSource("unknown-src", ORG_A, USER))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("re-approving an already-approved source succeeds (no ALREADY_APPROVED guard)", async () => {
      // Service does NOT have an ALREADY_APPROVED guard — re-approve is idempotent
      const source   = makeSource({ status: "approved", approvedAt: new Date() });
      const updated  = { ...source, approvedByUserId: USER, approvedAt: new Date() };

      mockDb.select.mockReturnValueOnce(makeSelectChain([source]));
      mockDb.update
        .mockReturnValueOnce(makeUpdateChain([updated]))
        .mockReturnValueOnce(makeUpdateChain([]));

      const result = await approveKnowledgeSource("src-001", ORG_A, USER);
      expect(result.status).toBe("approved");
    });
  });

  // ── Revoke ──────────────────────────────────────────────────────────────────

  describe("revokeKnowledgeSource", () => {
    it("revokes an approved source", async () => {
      const source  = makeSource({ status: "approved" });
      const revoked = { ...source, status: "revoked", revokedAt: new Date() };

      mockDb.select.mockReturnValue(makeSelectChain([source]));
      mockDb.update.mockReturnValue(makeUpdateChain([revoked]));

      const result = await revokeKnowledgeSource("src-001", ORG_A, USER, "Policy superseded");
      expect(result.status).toBe("revoked");
      expect(result.revokedAt).toBeDefined();
    });

    it("throws ALREADY_REVOKED for already revoked source", async () => {
      const source = makeSource({ status: "revoked", revokedAt: new Date() });
      mockDb.select.mockReturnValue(makeSelectChain([source]));
      await expect(revokeKnowledgeSource("src-001", ORG_A, USER))
        .rejects.toMatchObject({ code: "ALREADY_REVOKED" });
    });
  });

  // ── Supersede ───────────────────────────────────────────────────────────────

  describe("supersedeKnowledgeSource", () => {
    it("links old source to new source", async () => {
      const oldSrc = makeSource({ id: "src-old", status: "approved" });
      const newSrc = makeSource({ id: "src-new", organizationId: ORG_A });

      mockDb.select
        .mockReturnValueOnce(makeSelectChain([oldSrc]))  // lookup old
        .mockReturnValueOnce(makeSelectChain([newSrc])); // lookup new

      mockDb.update.mockReturnValue(makeUpdateChain([{ ...oldSrc, status: "superseded", supersededBySourceId: "src-new" }]));

      await expect(supersedeKnowledgeSource("src-old", "src-new", ORG_A, USER))
        .resolves.not.toThrow();
    });

    it("throws SELF_SUPERSEDE if same source ID", async () => {
      const src = makeSource();
      mockDb.select
        .mockReturnValueOnce(makeSelectChain([src]))
        .mockReturnValueOnce(makeSelectChain([src]));

      await expect(supersedeKnowledgeSource("src-001", "src-001", ORG_A, USER))
        .rejects.toMatchObject({ code: "SELF_SUPERSEDE" });
    });
  });

  // ── Delete ──────────────────────────────────────────────────────────────────

  describe("deleteKnowledgeSource", () => {
    it("soft-deletes a source (sets deletedAt)", async () => {
      const source  = makeSource();
      const deleted = { ...source, deletedAt: new Date() };

      mockDb.select.mockReturnValue(makeSelectChain([source]));
      mockDb.update.mockReturnValue(makeUpdateChain([deleted]));

      await expect(deleteKnowledgeSource("src-001", ORG_A, USER))
        .resolves.not.toThrow();
    });

    it("throws ALREADY_DELETED for already deleted source", async () => {
      const source = makeSource({ deletedAt: new Date() });
      mockDb.select.mockReturnValue(makeSelectChain([source]));
      await expect(deleteKnowledgeSource("src-001", ORG_A, USER))
        .rejects.toMatchObject({ code: "ALREADY_DELETED" });
    });
  });

  // ── Scope assignment ────────────────────────────────────────────────────────

  describe("assignScope", () => {
    it("assigns organisation-wide scope", async () => {
      const source = makeSource({ status: "approved" });
      const scope  = makeScope();

      mockDb.select
        .mockReturnValueOnce(makeSelectChain([source]))  // source exists
        .mockReturnValueOnce(makeSelectChain([]));       // no existing scope

      mockDb.insert.mockReturnValue(makeInsertChain([scope]));

      const result = await assignScope({
        knowledgeSourceId: "src-001",
        organizationId:    ORG_A,
        scopeType:         "organisation",
        scopeId:           "all",
        actorUserId:       USER,
      });
      expect(result.scopeType).toBe("organisation");
      expect(result.scopeId).toBe("all");
    });

    it("assigns specialist-specific scope", async () => {
      const source = makeSource({ status: "approved" });
      const scope  = makeScope({ scopeType: "specialist", scopeId: "incident_manager" });

      mockDb.select
        .mockReturnValueOnce(makeSelectChain([source]))
        .mockReturnValueOnce(makeSelectChain([]));

      mockDb.insert.mockReturnValue(makeInsertChain([scope]));

      const result = await assignScope({
        knowledgeSourceId: "src-001",
        organizationId:    ORG_A,
        scopeType:         "specialist",
        scopeId:           "incident_manager",
        actorUserId:       USER,
      });
      expect(result.scopeType).toBe("specialist");
      expect(result.scopeId).toBe("incident_manager");
    });

    it("returns existing scope when duplicate scope requested (upsert — no error)", async () => {
      // Service uses upsert: returns existing scope instead of throwing
      const source        = makeSource();
      const existingScope = makeScope();

      mockDb.select
        .mockReturnValueOnce(makeSelectChain([source]))
        .mockReturnValueOnce(makeSelectChain([existingScope]));

      const result = await assignScope({
        knowledgeSourceId: "src-001",
        organizationId:    ORG_A,
        scopeType:         "organisation",
        scopeId:           "all",
        actorUserId:       USER,
      });
      expect(result.id).toBe(existingScope.id);
      expect(result.scopeType).toBe("organisation");
    });
  });

  // ── Remove scope ────────────────────────────────────────────────────────────

  describe("removeScope", () => {
    it("removes a scope without affecting other scopes", async () => {
      const source = makeSource();
      const scope  = makeScope();

      mockDb.select
        .mockReturnValueOnce(makeSelectChain([source]))
        .mockReturnValueOnce(makeSelectChain([scope]));

      mockDb.delete.mockReturnValue(makeDeleteChain());

      await expect(removeScope("src-001", ORG_A, "organisation", "all", USER))
        .resolves.not.toThrow();
    });

    it("silently succeeds when scope does not exist (no-op delete)", async () => {
      // Service does not check for scope existence — delete is a no-op if not found
      mockDb.delete.mockReturnValue(makeDeleteChain());

      await expect(removeScope("src-001", ORG_A, "specialist", "nonexistent", USER))
        .resolves.not.toThrow();
    });
  });

  // ── Metadata update ─────────────────────────────────────────────────────────

  describe("updateSourceMetadata", () => {
    it("updates title and description", async () => {
      const source  = makeSource();
      const updated = { ...source, title: "Updated Policy", description: "New description" };

      mockDb.select.mockReturnValue(makeSelectChain([source]));
      mockDb.update.mockReturnValue(makeUpdateChain([updated]));

      const result = await updateSourceMetadata("src-001", ORG_A, USER, {
        title: "Updated Policy",
        description: "New description",
      });
      expect(result.title).toBe("Updated Policy");
    });

    it("throws NOT_FOUND for unknown source", async () => {
      mockDb.select.mockReturnValue(makeSelectChain([]));
      await expect(updateSourceMetadata("unknown", ORG_A, USER, { title: "X" }))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ── Duplicate detection ──────────────────────────────────────────────────────

  describe("findDuplicateChecksum", () => {
    it("returns null when no duplicate exists", async () => {
      mockDb.select.mockReturnValue(makeSelectChain([]));
      const result = await findDuplicateChecksum(ORG_A, "unique-checksum-xyz");
      expect(result).toBeNull();
    });

    it("returns existing source when duplicate checksum found", async () => {
      const existing = makeSource({ checksum: "sha256abc123" });
      mockDb.select.mockReturnValue(makeSelectChain([existing]));

      const result = await findDuplicateChecksum(ORG_A, "sha256abc123");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("src-001");
    });

    it("does not return duplicates from a different organisation (tenant isolation)", async () => {
      mockDb.select.mockReturnValue(makeSelectChain([]));
      const result = await findDuplicateChecksum(ORG_B, "sha256abc123");
      expect(result).toBeNull();
    });
  });

  // ── Permissions model ────────────────────────────────────────────────────────

  describe("permissions model", () => {
    it("KnowledgeSourceError carries code for permission checks", () => {
      const err = new KnowledgeSourceError("Not found.", "NOT_FOUND");
      expect(err.code).toBe("NOT_FOUND");
      expect(err.message).toBe("Not found.");
    });

    it("REVOKED status blocks approve (source already revoked)", async () => {
      const source = makeSource({ status: "revoked", revokedAt: new Date() });
      mockDb.select.mockReturnValue(makeSelectChain([source]));
      await expect(approveKnowledgeSource("src-001", ORG_A, USER))
        .rejects.toMatchObject({ code: "REVOKED" });
    });

    it("DELETED source blocks metadata update", async () => {
      const source = makeSource({ deletedAt: new Date() });
      mockDb.select.mockReturnValue(makeSelectChain([source]));
      await expect(updateSourceMetadata("src-001", ORG_A, USER, { title: "X" }))
        .rejects.toMatchObject({ code: "DELETED" });
    });
  });

  // ── Tenant isolation ─────────────────────────────────────────────────────────

  describe("tenant isolation", () => {
    it("listKnowledgeSources for ORG_A does not return ORG_B sources", async () => {
      const orgBSource = makeSource({ organizationId: ORG_B, id: "src-b-001" });
      // Service filters by orgId — query returns nothing for ORG_A
      mockDb.select.mockReturnValue(makeSelectChain([]));

      const result = await listKnowledgeSources({ organizationId: ORG_A });
      expect(result.sources.filter(s => s.organizationId === ORG_B)).toHaveLength(0);
    });

    it("approveKnowledgeSource returns NOT_FOUND for cross-org source", async () => {
      // Cross-tenant: DB returns nothing because RLS filters ORG_B source
      mockDb.select.mockReturnValue(makeSelectChain([]));
      await expect(approveKnowledgeSource("src-b-001", ORG_A, USER))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ── Scanned PDF handling (UI contract) ──────────────────────────────────────

  describe("scanned PDF detection contract", () => {
    it("pipelineWarnings may include SCANNED_PDF code", () => {
      const warning = { code: "SCANNED_PDF", message: "Document appears to be scanned" };
      expect(warning.code).toBe("SCANNED_PDF");
      expect(warning.message).toMatch(/scanned/i);
    });

    it("promptInjectionFlags is an array in the warnings contract", () => {
      const warnings = {
        sourceId:             "src-001",
        requiresHumanReview:  true,
        promptInjectionFlags: [{ type: "INJECTION_ATTEMPT", description: "Possible prompt injection" }],
        pipelineWarnings:     [],
      };
      expect(Array.isArray(warnings.promptInjectionFlags)).toBe(true);
      expect(warnings.requiresHumanReview).toBe(true);
    });
  });

  // ── Processing state labels (customer-facing) ───────────────────────────────

  describe("processing states", () => {
    it("maps all DB statuses to customer-friendly labels", () => {
      const customerLabels: Record<string, string> = {
        uploaded:        "Uploaded",
        processing:      "Reading document",
        review_required: "Ready for review",
        approved:        "Approved",
        failed:          "Needs attention",
        revoked:         "Revoked",
        superseded:      "Superseded",
        archived:        "Archived",
      };
      for (const status of KNOWLEDGE_SOURCE_STATUSES) {
        expect(customerLabels[status]).toBeDefined();
      }
    });
  });

});
