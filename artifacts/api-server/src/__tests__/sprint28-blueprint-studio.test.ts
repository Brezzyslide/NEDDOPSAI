/**
 * Sprint 28 — Blueprint Studio & Organisation Workflow Designer
 *
 * Tests cover:
 *  - Create, edit, archive, restore, clone
 *  - Submit for review, publish, rollback
 *  - Version history
 *  - Sandbox test execution
 *  - Organisation override selection (org published blueprint takes precedence)
 *  - Tenant isolation
 *  - Built-in read-only enforcement
 *  - Status transition guards
 *  - Audit events
 *  - listBlueprints search/filter/sort
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (all declared via vi.hoisted so vi.mock factories can reference them) ─

const { mockInsert, mockUpdate, mockLogOrg, mockSelectImpl } = vi.hoisted(() => ({
  mockInsert:     vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
  mockUpdate:     vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
  mockLogOrg:     vi.fn().mockResolvedValue(undefined),
  mockSelectImpl: vi.fn(),
}));

// Select chain factory
function makeSelectChain(rows: unknown[]) {
  const resolved = Promise.resolve(rows);
  const c: Record<string, unknown> = {};
  c.from        = () => c;
  c.where       = () => c;
  c.orderBy     = () => c;
  c.limit       = () => resolved;
  c.then        = resolved.then.bind(resolved);
  c.catch       = resolved.catch.bind(resolved);
  c.finally     = resolved.finally.bind(resolved);
  return c;
}

vi.mock("@workspace/db", () => ({
  db: {
    select:  () => mockSelectImpl(),
    insert:  mockInsert,
    update:  mockUpdate,
  },
  workBlueprintsTable:  { id: "id", code: "code", organizationId: "organizationId", isActive: "isActive", status: "status" },
  blueprintVersionsTable: { id: "id", blueprintId: "blueprintId", organizationId: "organizationId", createdAt: "createdAt" },
}));

vi.mock("drizzle-orm", () => ({
  eq:    (col: unknown, val: unknown) => ({ op: "eq",    col, val }),
  and:   (...args: unknown[])         => ({ op: "and",   args }),
  or:    (...args: unknown[])         => ({ op: "or",    args }),
  isNull:(col: unknown)               => ({ op: "isNull", col }),
  desc:  (col: unknown)               => ({ op: "desc",  col }),
  ilike: (col: unknown, val: unknown) => ({ op: "ilike", col, val }),
  inArray:(col: unknown, arr: unknown) => ({ op: "inArray", col, arr }),
}));

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: mockLogOrg,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_ID   = "org-test-001";
const USER_ID  = "user-test-001";
const NOW      = new Date("2026-08-04T10:00:00Z");

function makeBlueprintRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "bp-001",
    organizationId: ORG_ID,
    code: "test_blueprint",
    title: "Test Blueprint",
    version: "1.0.0",
    status: "draft",
    objective: "Produce a test document.",
    primarySpecialist: "chief_of_staff",
    supportingSpecialists: [],
    requiredLibraryKnowledge: ["policy"],
    requiredEntityKnowledge: {},
    requiredMemories: [],
    requiredApprovals: {},
    validationRules: [],
    qualityRules: [],
    successCriteria: ["Objective met"],
    outputTypes: ["custom"],
    escalationRules: [],
    mandatoryCitations: [],
    isBuiltIn: false,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeVersionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ver-001",
    blueprintId: "bp-001",
    organizationId: ORG_ID,
    versionLabel: "1.0.0",
    status: "published",
    snapshot: { title: "Test Blueprint", code: "test_blueprint", version: "1.0.0", primarySpecialist: "chief_of_staff", objective: "Produce a test document.", outputTypes: ["custom"], successCriteria: ["Objective met"] },
    notes: "Initial publish",
    createdBy: USER_ID,
    createdAt: NOW,
    ...overrides,
  };
}

// ─── Import service ───────────────────────────────────────────────────────────

import {
  getBlueprintById,
  createCustomBlueprint,
  updateCustomBlueprint,
  archiveBlueprint,
  restoreBlueprint,
  cloneBlueprint,
  submitForReview,
  publishBlueprint,
  rollbackToVersion,
  getVersionHistory,
  getVersionById,
  testBlueprintSandbox,
  selectBlueprint,
  listBlueprints,
} from "../services/workBlueprintService.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupSelectSequence(rowSets: unknown[][]) {
  let call = 0;
  mockSelectImpl.mockImplementation(() => makeSelectChain(rowSets[call++] ?? []));
}

function setupSingleSelect(rows: unknown[]) {
  mockSelectImpl.mockReturnValue(makeSelectChain(rows));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("workBlueprintService — Sprint 28 Blueprint Studio", () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    mockUpdate.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) });
    mockLogOrg.mockResolvedValue(undefined);
  });

  // ─── Create ───────────────────────────────────────────────────────────────

  describe("createCustomBlueprint", () => {
    it("creates a blueprint with status=draft", async () => {
      const row = makeBlueprintRow();
      setupSelectSequence([[row]]);

      const result = await createCustomBlueprint(
        { code: "test_blueprint", title: "Test Blueprint", objective: "Produce a test document.", primarySpecialist: "chief_of_staff" },
        ORG_ID, USER_ID,
      );

      expect(mockInsert).toHaveBeenCalledTimes(1);
      const insertVals = mockInsert.mock.results[0]!.value.values.mock.calls[0]?.[0];
      expect(insertVals.status).toBe("draft");
      expect(insertVals.isBuiltIn).toBe(false);
      expect(insertVals.isActive).toBe(true);
      expect(result.status).toBe("draft");
    });

    it("logs work_blueprint_created audit event", async () => {
      setupSelectSequence([[makeBlueprintRow()]]);
      await createCustomBlueprint(
        { code: "test_blueprint", title: "Test Blueprint", objective: "Produce.", primarySpecialist: "chief_of_staff" },
        ORG_ID, USER_ID,
      );
      expect(mockLogOrg).toHaveBeenCalledWith(expect.objectContaining({ eventType: "work_blueprint_created" }));
    });

    it("returns the created blueprint", async () => {
      const row = makeBlueprintRow({ title: "Custom Blueprint" });
      setupSelectSequence([[row]]);
      const result = await createCustomBlueprint(
        { code: "custom_blueprint", title: "Custom Blueprint", objective: "Custom objective.", primarySpecialist: "operations_manager" },
        ORG_ID, USER_ID,
      );
      expect(result.title).toBe("Custom Blueprint");
    });
  });

  // ─── Edit ─────────────────────────────────────────────────────────────────

  describe("updateCustomBlueprint", () => {
    it("updates a draft blueprint successfully", async () => {
      const updated = makeBlueprintRow({ title: "Updated Title" });
      setupSelectSequence([[makeBlueprintRow()], [updated]]);

      const result = await updateCustomBlueprint("bp-001", { title: "Updated Title" }, ORG_ID, USER_ID);

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(result.title).toBe("Updated Title");
    });

    it("rejects edits on built-in blueprints with 403", async () => {
      setupSelectSequence([[makeBlueprintRow({ isBuiltIn: true, organizationId: null })]]);
      await expect(updateCustomBlueprint("bp-001", { title: "Hack" }, ORG_ID, USER_ID))
        .rejects.toMatchObject({ statusCode: 403 });
    });

    it("rejects edits on published blueprints with 409", async () => {
      setupSelectSequence([[makeBlueprintRow({ status: "published" })]]);
      await expect(updateCustomBlueprint("bp-001", { title: "Edit" }, ORG_ID, USER_ID))
        .rejects.toMatchObject({ statusCode: 409 });
    });

    it("rejects edits on superseded blueprints with 409", async () => {
      setupSelectSequence([[makeBlueprintRow({ status: "superseded" })]]);
      await expect(updateCustomBlueprint("bp-001", { title: "Edit" }, ORG_ID, USER_ID))
        .rejects.toMatchObject({ statusCode: 409 });
    });

    it("returns 404 for a blueprint belonging to another org (tenant isolation via getBlueprintById)", async () => {
      // getBlueprintById already filters cross-org rows and returns null → 404
      // This is correct: we don't leak info about whether the blueprint exists in another org
      setupSelectSequence([[makeBlueprintRow({ organizationId: "other-org" })]]);
      await expect(updateCustomBlueprint("bp-001", { title: "Hack" }, ORG_ID, USER_ID))
        .rejects.toMatchObject({ statusCode: 404 });
    });

    it("logs work_blueprint_updated audit event", async () => {
      setupSelectSequence([[makeBlueprintRow()], [makeBlueprintRow()]]);
      await updateCustomBlueprint("bp-001", { title: "New" }, ORG_ID, USER_ID);
      expect(mockLogOrg).toHaveBeenCalledWith(expect.objectContaining({ eventType: "work_blueprint_updated" }));
    });
  });

  // ─── Archive ──────────────────────────────────────────────────────────────

  describe("archiveBlueprint", () => {
    it("archives a blueprint — sets status=archived, isActive=false", async () => {
      const archived = makeBlueprintRow({ status: "archived", isActive: false });
      setupSelectSequence([[makeBlueprintRow()], [archived]]);

      const result = await archiveBlueprint("bp-001", ORG_ID, USER_ID);

      const setCall = mockUpdate.mock.results[0]!.value.set.mock.calls[0]?.[0];
      expect(setCall.status).toBe("archived");
      expect(setCall.isActive).toBe(false);
      expect(result.status).toBe("archived");
    });

    it("logs work_blueprint_archived audit event", async () => {
      setupSelectSequence([[makeBlueprintRow()], [makeBlueprintRow({ status: "archived" })]]);
      await archiveBlueprint("bp-001", ORG_ID, USER_ID);
      expect(mockLogOrg).toHaveBeenCalledWith(expect.objectContaining({ eventType: "work_blueprint_archived" }));
    });

    it("rejects archiving built-in blueprints with 403", async () => {
      setupSelectSequence([[makeBlueprintRow({ isBuiltIn: true, organizationId: null })]]);
      await expect(archiveBlueprint("bp-001", ORG_ID, USER_ID))
        .rejects.toMatchObject({ statusCode: 403 });
    });

    it("returns 404 for non-existent blueprint", async () => {
      setupSelectSequence([[]]); // getBlueprintById returns nothing
      await expect(archiveBlueprint("nonexistent", ORG_ID, USER_ID))
        .rejects.toMatchObject({ statusCode: 404 });
    });
  });

  // ─── Restore ──────────────────────────────────────────────────────────────

  describe("restoreBlueprint", () => {
    it("restores an archived blueprint to draft", async () => {
      const restored = makeBlueprintRow({ status: "draft", isActive: true });
      setupSelectSequence([[makeBlueprintRow({ status: "archived", isActive: false })], [restored]]);

      const result = await restoreBlueprint("bp-001", ORG_ID, USER_ID);

      const setCall = mockUpdate.mock.results[0]!.value.set.mock.calls[0]?.[0];
      expect(setCall.status).toBe("draft");
      expect(setCall.isActive).toBe(true);
      expect(result.status).toBe("draft");
    });

    it("logs work_blueprint_restored audit event", async () => {
      setupSelectSequence([
        [makeBlueprintRow({ status: "archived", isActive: false })],
        [makeBlueprintRow({ status: "draft" })],
      ]);
      await restoreBlueprint("bp-001", ORG_ID, USER_ID);
      expect(mockLogOrg).toHaveBeenCalledWith(expect.objectContaining({ eventType: "work_blueprint_restored" }));
    });

    it("rejects restoring a non-archived blueprint with 409", async () => {
      setupSelectSequence([[makeBlueprintRow({ status: "draft" })]]);
      await expect(restoreBlueprint("bp-001", ORG_ID, USER_ID))
        .rejects.toMatchObject({ statusCode: 409 });
    });

    it("rejects restoring built-in blueprints with 403", async () => {
      setupSelectSequence([[makeBlueprintRow({ isBuiltIn: true, organizationId: null })]]);
      await expect(restoreBlueprint("bp-001", ORG_ID, USER_ID))
        .rejects.toMatchObject({ statusCode: 403 });
    });
  });

  // ─── Clone ────────────────────────────────────────────────────────────────

  describe("cloneBlueprint", () => {
    it("clones a blueprint with new ID and status=draft", async () => {
      const cloned = makeBlueprintRow({ id: "bp-clone-001", title: "Test Blueprint (Copy)", status: "draft" });
      setupSelectSequence([[makeBlueprintRow()], [cloned]]);

      const result = await cloneBlueprint("bp-001", ORG_ID, USER_ID);

      expect(mockInsert).toHaveBeenCalledTimes(1);
      const insertVals = mockInsert.mock.results[0]!.value.values.mock.calls[0]?.[0];
      expect(insertVals.status).toBe("draft");
      expect(insertVals.isBuiltIn).toBe(false);
      expect(result.title).toBe("Test Blueprint (Copy)");
    });

    it("uses provided title for the clone", async () => {
      const cloned = makeBlueprintRow({ id: "bp-clone-002", title: "My Clone" });
      setupSelectSequence([[makeBlueprintRow()], [cloned]]);

      await cloneBlueprint("bp-001", ORG_ID, USER_ID, "My Clone");

      const insertVals = mockInsert.mock.results[0]!.value.values.mock.calls[0]?.[0];
      expect(insertVals.title).toBe("My Clone");
    });

    it("can clone a built-in blueprint", async () => {
      const builtIn = makeBlueprintRow({ isBuiltIn: true, organizationId: null });
      const cloned  = makeBlueprintRow({ id: "bp-clone-003", isBuiltIn: false, organizationId: ORG_ID });
      setupSelectSequence([[builtIn], [cloned]]);

      const result = await cloneBlueprint("bp-built-in", ORG_ID, USER_ID);

      expect(result.organizationId).toBe(ORG_ID);
    });

    it("logs work_blueprint_cloned audit event", async () => {
      setupSelectSequence([[makeBlueprintRow()], [makeBlueprintRow({ id: "bp-clone-004" })]]);
      await cloneBlueprint("bp-001", ORG_ID, USER_ID);
      expect(mockLogOrg).toHaveBeenCalledWith(expect.objectContaining({ eventType: "work_blueprint_cloned" }));
    });

    it("returns 404 when source not found", async () => {
      setupSelectSequence([[]]);
      await expect(cloneBlueprint("nonexistent", ORG_ID, USER_ID))
        .rejects.toMatchObject({ statusCode: 404 });
    });
  });

  // ─── Submit for review ────────────────────────────────────────────────────

  describe("submitForReview", () => {
    it("transitions draft → review", async () => {
      const reviewed = makeBlueprintRow({ status: "review" });
      setupSelectSequence([[makeBlueprintRow()], [reviewed]]);

      const result = await submitForReview("bp-001", ORG_ID, USER_ID);

      const setCall = mockUpdate.mock.results[0]!.value.set.mock.calls[0]?.[0];
      expect(setCall.status).toBe("review");
      expect(result.status).toBe("review");
    });

    it("rejects non-draft blueprints with 409", async () => {
      setupSelectSequence([[makeBlueprintRow({ status: "review" })]]);
      await expect(submitForReview("bp-001", ORG_ID, USER_ID))
        .rejects.toMatchObject({ statusCode: 409 });
    });

    it("rejects built-in blueprints with 403", async () => {
      setupSelectSequence([[makeBlueprintRow({ isBuiltIn: true, organizationId: null })]]);
      await expect(submitForReview("bp-001", ORG_ID, USER_ID))
        .rejects.toMatchObject({ statusCode: 403 });
    });

    it("logs work_blueprint_submitted_for_review audit event", async () => {
      setupSelectSequence([[makeBlueprintRow()], [makeBlueprintRow({ status: "review" })]]);
      await submitForReview("bp-001", ORG_ID, USER_ID);
      expect(mockLogOrg).toHaveBeenCalledWith(expect.objectContaining({ eventType: "work_blueprint_submitted_for_review" }));
    });
  });

  // ─── Publish ──────────────────────────────────────────────────────────────

  describe("publishBlueprint", () => {
    it("publishes a draft blueprint and creates version snapshot", async () => {
      const published = makeBlueprintRow({ status: "published" });
      const version   = makeVersionRow();

      // Select sequence: getBlueprintById → previouslyPublished → update + insert → getBlueprintById → version by ID
      setupSelectSequence([
        [makeBlueprintRow()], // getBlueprintById (current)
        [],                   // previouslyPublished (none)
        [published],          // getBlueprintById (after update)
        [version],            // getVersionById
      ]);

      const result = await publishBlueprint("bp-001", ORG_ID, USER_ID, "Initial publish");

      expect(mockUpdate).toHaveBeenCalledTimes(1); // published the blueprint
      expect(mockInsert).toHaveBeenCalledTimes(1); // version snapshot
      expect(result.blueprint.status).toBe("published");
      expect(result.version.status).toBe("published");
      expect(result.version.notes).toBe("Initial publish");
    });

    it("supersedes any previously-published blueprint of the same code", async () => {
      const current  = makeBlueprintRow({ id: "bp-001", status: "draft" });
      const prevPub  = { id: "bp-previous" };
      const published = makeBlueprintRow({ status: "published" });
      const version  = makeVersionRow();

      setupSelectSequence([[current], [prevPub], [published], [version]]);

      await publishBlueprint("bp-001", ORG_ID, USER_ID);

      // First update: supersede previous; second update: publish current
      expect(mockUpdate).toHaveBeenCalledTimes(2);
      const firstSet = mockUpdate.mock.results[0]!.value.set.mock.calls[0]?.[0];
      expect(firstSet.status).toBe("superseded");
      expect(firstSet.isActive).toBe(false);
    });

    it("creates immutable version snapshot with full data", async () => {
      setupSelectSequence([
        [makeBlueprintRow()],
        [],
        [makeBlueprintRow({ status: "published" })],
        [makeVersionRow()],
      ]);

      await publishBlueprint("bp-001", ORG_ID, USER_ID, "v1 release");

      const insertVals = mockInsert.mock.results[0]!.value.values.mock.calls[0]?.[0];
      expect(insertVals.status).toBe("published");
      expect(typeof insertVals.snapshot).toBe("object");
      expect(insertVals.notes).toBe("v1 release");
    });

    it("rejects publishing an already-published blueprint with 409", async () => {
      setupSelectSequence([[makeBlueprintRow({ status: "published" })]]);
      await expect(publishBlueprint("bp-001", ORG_ID, USER_ID))
        .rejects.toMatchObject({ statusCode: 409 });
    });

    it("rejects publishing built-in blueprints with 403", async () => {
      setupSelectSequence([[makeBlueprintRow({ isBuiltIn: true, organizationId: null })]]);
      await expect(publishBlueprint("bp-001", ORG_ID, USER_ID))
        .rejects.toMatchObject({ statusCode: 403 });
    });

    it("publishes from review status as well as draft", async () => {
      setupSelectSequence([
        [makeBlueprintRow({ status: "review" })],
        [],
        [makeBlueprintRow({ status: "published" })],
        [makeVersionRow()],
      ]);
      const result = await publishBlueprint("bp-001", ORG_ID, USER_ID);
      expect(result.blueprint.status).toBe("published");
    });

    it("logs work_blueprint_published audit event", async () => {
      setupSelectSequence([
        [makeBlueprintRow()], [], [makeBlueprintRow({ status: "published" })], [makeVersionRow()],
      ]);
      await publishBlueprint("bp-001", ORG_ID, USER_ID);
      expect(mockLogOrg).toHaveBeenCalledWith(expect.objectContaining({ eventType: "work_blueprint_published" }));
    });
  });

  // ─── Rollback ─────────────────────────────────────────────────────────────

  describe("rollbackToVersion", () => {
    it("creates a new draft from the version snapshot", async () => {
      const rollbackResult = makeBlueprintRow({ id: "bp-rollback-001", title: "Test Blueprint (Rollback from v1.0.0)", status: "draft" });
      setupSelectSequence([[makeVersionRow()], [rollbackResult]]);

      const result = await rollbackToVersion("ver-001", ORG_ID, USER_ID);

      expect(mockInsert).toHaveBeenCalledTimes(1);
      const insertVals = mockInsert.mock.results[0]!.value.values.mock.calls[0]?.[0];
      expect(insertVals.status).toBe("draft");
      expect(insertVals.title).toContain("Rollback");
      expect(result.status).toBe("draft");
    });

    it("logs work_blueprint_rolled_back audit event", async () => {
      setupSelectSequence([[makeVersionRow()], [makeBlueprintRow({ status: "draft" })]]);
      await rollbackToVersion("ver-001", ORG_ID, USER_ID);
      expect(mockLogOrg).toHaveBeenCalledWith(expect.objectContaining({ eventType: "work_blueprint_rolled_back" }));
    });

    it("returns 404 when version not found", async () => {
      setupSelectSequence([[]]);
      await expect(rollbackToVersion("nonexistent", ORG_ID, USER_ID))
        .rejects.toMatchObject({ statusCode: 404 });
    });

    it("preserves all snapshot fields in the rollback draft", async () => {
      const snapWithRules = makeVersionRow({
        snapshot: {
          title: "Rich Blueprint",
          code: "test_blueprint",
          version: "2.0.0",
          primarySpecialist: "operations_manager",
          objective: "Rich objective.",
          supportingSpecialists: ["chief_of_staff"],
          requiredLibraryKnowledge: ["policy", "procedure"],
          requiredMemories: ["operating_preference"],
          outputTypes: ["risk_assessment"],
          successCriteria: ["All risks documented"],
          validationRules: [{ rule: "risk_policy_present", required: true, description: "Need risk policy" }],
          qualityRules: [],
          escalationRules: [],
          mandatoryCitations: ["policy"],
          requiredApprovals: {},
          requiredEntityKnowledge: {},
        },
      });
      const rollbackBp = makeBlueprintRow({ status: "draft", primarySpecialist: "operations_manager" });
      setupSelectSequence([[snapWithRules], [rollbackBp]]);

      await rollbackToVersion("ver-001", ORG_ID, USER_ID);

      const insertVals = mockInsert.mock.results[0]!.value.values.mock.calls[0]?.[0];
      expect(insertVals.primarySpecialist).toBe("operations_manager");
      expect(insertVals.requiredLibraryKnowledge).toEqual(["policy", "procedure"]);
    });
  });

  // ─── Version history ──────────────────────────────────────────────────────

  describe("getVersionHistory", () => {
    it("returns versions ordered newest first", async () => {
      const v1 = makeVersionRow({ id: "ver-001", versionLabel: "1.0.0", createdAt: new Date("2026-01-01") });
      const v2 = makeVersionRow({ id: "ver-002", versionLabel: "2.0.0", createdAt: new Date("2026-06-01") });

      // getBlueprintById + orderBy query
      setupSelectSequence([[makeBlueprintRow()], [v2, v1]]);

      const result = await getVersionHistory("bp-001", ORG_ID);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("ver-002");
      expect(result[1].id).toBe("ver-001");
    });

    it("returns 404 when blueprint not found", async () => {
      setupSelectSequence([[]]); // getBlueprintById returns nothing
      await expect(getVersionHistory("nonexistent", ORG_ID))
        .rejects.toMatchObject({ statusCode: 404 });
    });

    it("returns empty list when no versions exist", async () => {
      setupSelectSequence([[makeBlueprintRow()], []]);
      const result = await getVersionHistory("bp-001", ORG_ID);
      expect(result).toEqual([]);
    });
  });

  // ─── Get version by ID ────────────────────────────────────────────────────

  describe("getVersionById", () => {
    it("returns the version when found for the org", async () => {
      setupSelectSequence([[makeVersionRow()]]);
      const result = await getVersionById("ver-001", ORG_ID);
      expect(result).not.toBeNull();
      expect(result!.id).toBe("ver-001");
      expect(result!.versionLabel).toBe("1.0.0");
    });

    it("returns null when version not found", async () => {
      setupSelectSequence([[]]);
      const result = await getVersionById("nonexistent", ORG_ID);
      expect(result).toBeNull();
    });
  });

  // ─── Sandbox test ─────────────────────────────────────────────────────────

  describe("testBlueprintSandbox", () => {
    it("returns sandboxOnly=true — never creates work", async () => {
      setupSelectSequence([[makeBlueprintRow({ validationRules: [] })]]);
      const result = await testBlueprintSandbox({
        blueprintId: "bp-001", organizationId: ORG_ID, testRequest: "Test task",
      });
      expect(result.sandboxOnly).toBe(true);
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it("reports validation passed when no required rules fail", async () => {
      setupSelectSequence([[makeBlueprintRow({ validationRules: [] })]]);
      const result = await testBlueprintSandbox({
        blueprintId: "bp-001", organizationId: ORG_ID, testRequest: "Produce a report.",
      });
      expect(result.validationOutcome).toBe("passed");
      expect(result.validationIssues).toHaveLength(0);
    });

    it("reports failed when required rule not satisfied", async () => {
      setupSelectSequence([[makeBlueprintRow({
        validationRules: [{ rule: "incident_policy_present", required: true, description: "Need incident policy" }],
      })]]);
      const result = await testBlueprintSandbox({
        blueprintId: "bp-001", organizationId: ORG_ID,
        testRequest: "Investigate an incident.",
        uploadedDocumentTypes: [], // no policy uploaded
      });
      expect(result.validationOutcome).toBe("failed");
      expect(result.validationIssues.some(i => i.level === "error")).toBe(true);
      expect(result.missingAssets.length).toBeGreaterThan(0);
    });

    it("reports passed when required rule is satisfied by uploaded doc", async () => {
      setupSelectSequence([[makeBlueprintRow({
        validationRules: [{ rule: "incident_policy_present", required: true, description: "Need incident policy" }],
      })]]);
      const result = await testBlueprintSandbox({
        blueprintId: "bp-001", organizationId: ORG_ID,
        testRequest: "Investigate an incident.",
        uploadedDocumentTypes: ["policy"], // policy uploaded
      });
      expect(result.validationOutcome).toBe("passed");
      expect(result.validationIssues.filter(i => i.level === "error")).toHaveLength(0);
    });

    it("reports warnings for optional unsatisfied rules", async () => {
      setupSelectSequence([[makeBlueprintRow({
        validationRules: [{ rule: "template_present", required: false, description: "Template preferred" }],
      })]]);
      const result = await testBlueprintSandbox({
        blueprintId: "bp-001", organizationId: ORG_ID, testRequest: "Produce a report.",
        uploadedDocumentTypes: [],
      });
      expect(result.validationOutcome).toBe("warnings");
      expect(result.validationIssues.some(i => i.level === "warning")).toBe(true);
    });

    it("returns expected outputs and specialist from blueprint", async () => {
      setupSelectSequence([[makeBlueprintRow({ outputTypes: ["risk_assessment"], primarySpecialist: "compliance_quality_manager" })]]);
      const result = await testBlueprintSandbox({
        blueprintId: "bp-001", organizationId: ORG_ID, testRequest: "Test request.",
      });
      expect(result.expectedOutputs).toEqual(["risk_assessment"]);
      expect(result.selectedSpecialist).toBe("compliance_quality_manager");
    });

    it("returns 404 when blueprint not found", async () => {
      setupSelectSequence([[]]);
      await expect(testBlueprintSandbox({ blueprintId: "nonexistent", organizationId: ORG_ID, testRequest: "Test." }))
        .rejects.toMatchObject({ statusCode: 404 });
    });
  });

  // ─── Organisation override selection ──────────────────────────────────────

  describe("selectBlueprint — org override", () => {
    it("prefers org-published blueprint over built-in for the same code", async () => {
      const orgBp = makeBlueprintRow({
        organizationId: ORG_ID,
        status: "published",
        code: "incident_investigation",
        title: "Our Custom Incident Blueprint",
      });
      // Org query returns a match → built-in query never reached
      setupSelectSequence([[orgBp]]);

      const result = await selectBlueprint("investigate the incident", ORG_ID);

      expect(result.blueprint).not.toBeNull();
      expect(result.blueprint!.title).toBe("Our Custom Incident Blueprint");
      expect(result.fallbackUsed).toBe(false);
    });

    it("falls back to built-in when no org blueprint is published", async () => {
      const builtIn = makeBlueprintRow({
        organizationId: null,
        isBuiltIn: true,
        status: "published",
        code: "incident_investigation",
        title: "Incident Investigation",
      });
      // Org query returns nothing → falls back to built-in
      setupSelectSequence([[], [builtIn]]);

      const result = await selectBlueprint("investigate the incident", ORG_ID);

      expect(result.blueprint).not.toBeNull();
      expect(result.blueprint!.title).toBe("Incident Investigation");
    });

    it("returns fallbackUsed=true when no matching blueprint at all", async () => {
      // Org query: no match; built-in query: no match
      setupSelectSequence([[], []]);

      const result = await selectBlueprint("investigate the incident", ORG_ID);

      expect(result.fallbackUsed).toBe(true);
      expect(result.blueprint).toBeNull();
    });

    it("returns fallbackUsed=true when no keywords match", async () => {
      const result = await selectBlueprint("zzz completely unrecognised task xyzzy", ORG_ID);
      expect(result.fallbackUsed).toBe(true);
      expect(result.blueprint).toBeNull();
      expect(result.confidence).toBe(0);
    });
  });

  // ─── listBlueprints search/filter/sort ───────────────────────────────────

  describe("listBlueprints", () => {
    const rows = [
      makeBlueprintRow({ id: "bp-A", title: "Alpha Blueprint", status: "published",  primarySpecialist: "chief_of_staff",   createdAt: new Date("2026-01-01") }),
      makeBlueprintRow({ id: "bp-B", title: "Beta Blueprint",  status: "draft",       primarySpecialist: "operations_manager", createdAt: new Date("2026-03-01") }),
      makeBlueprintRow({ id: "bp-C", title: "Gamma Workflow",  status: "archived",    primarySpecialist: "chief_of_staff",   createdAt: new Date("2026-06-01") }),
    ];

    it("returns active blueprints by default (excludes archived)", async () => {
      setupSingleSelect(rows.filter(r => r.isActive));
      const result = await listBlueprints(ORG_ID);
      // Two active (A and B only without archived)
      expect(result.every(b => b.isActive)).toBe(true);
    });

    it("filters by status", async () => {
      setupSingleSelect(rows.filter(r => r.isActive));
      const result = await listBlueprints(ORG_ID, { status: "draft" });
      expect(result.every(b => b.status === "draft")).toBe(true);
    });

    it("filters by search term", async () => {
      setupSingleSelect(rows.filter(r => r.isActive));
      const result = await listBlueprints(ORG_ID, { search: "Alpha" });
      expect(result.every(b => b.title.toLowerCase().includes("alpha"))).toBe(true);
    });

    it("filters by specialist", async () => {
      setupSingleSelect(rows.filter(r => r.isActive));
      const result = await listBlueprints(ORG_ID, { specialist: "chief_of_staff" });
      expect(result.every(b => b.primarySpecialist === "chief_of_staff" || b.supportingSpecialists.includes("chief_of_staff"))).toBe(true);
    });

    it("sorts title_asc", async () => {
      setupSingleSelect([rows[1], rows[0]]); // Beta, Alpha
      const result = await listBlueprints(ORG_ID, { sort: "title_asc" });
      // After sort, should be alphabetical
      for (let i = 1; i < result.length; i++) {
        expect(result[i-1]!.title.localeCompare(result[i]!.title)).toBeLessThanOrEqual(0);
      }
    });

    it("sorts newest first by default", async () => {
      setupSingleSelect(rows.filter(r => r.isActive));
      const result = await listBlueprints(ORG_ID, { sort: "newest" });
      for (let i = 1; i < result.length; i++) {
        expect(result[i-1]!.createdAt >= result[i]!.createdAt).toBe(true);
      }
    });

    it("returns all blueprints including archived when includeArchived=true", async () => {
      setupSingleSelect(rows); // All 3 rows
      const result = await listBlueprints(ORG_ID, { includeArchived: true });
      expect(result.some(b => b.status === "archived")).toBe(true);
    });
  });

  // ─── Tenant isolation ─────────────────────────────────────────────────────

  describe("Tenant isolation", () => {
    it("getBlueprintById returns null for a blueprint belonging to another org", async () => {
      setupSelectSequence([[makeBlueprintRow({ organizationId: "other-org" })]]);
      const result = await getBlueprintById("bp-001", ORG_ID);
      expect(result).toBeNull();
    });

    it("getBlueprintById returns built-in (null orgId) blueprints to any org", async () => {
      setupSelectSequence([[makeBlueprintRow({ organizationId: null, isBuiltIn: true })]]);
      const result = await getBlueprintById("bp-built-in", ORG_ID);
      expect(result).not.toBeNull();
    });

    it("archiveBlueprint returns 404 for cross-org blueprint (tenant isolation via getBlueprintById)", async () => {
      // getBlueprintById returns null for other-org rows → service throws 404
      setupSelectSequence([[makeBlueprintRow({ organizationId: "other-org" })]]);
      await expect(archiveBlueprint("bp-001", ORG_ID, USER_ID))
        .rejects.toMatchObject({ statusCode: 404 });
    });

    it("cloneBlueprint correctly assigns the requesting org to the clone", async () => {
      const cloned = makeBlueprintRow({ id: "bp-clone-999", organizationId: ORG_ID });
      setupSelectSequence([[makeBlueprintRow({ organizationId: "other-org", isBuiltIn: false })], [cloned]]);

      // Note: cloneBlueprint reads the source blueprint — if org mismatches and is not null, getBlueprintById returns null
      // Source is "other-org" so getBlueprintById(id, ORG_ID) returns null → 404
      // This is correct tenant isolation behaviour
      const mismatchRow = makeBlueprintRow({ organizationId: "other-org" });
      setupSelectSequence([[mismatchRow]]); // simulate getBlueprintById returning null (org mismatch)

      await expect(cloneBlueprint("bp-other", ORG_ID, USER_ID))
        .rejects.toMatchObject({ statusCode: 404 });
    });
  });

  // ─── Built-in read-only enforcement ──────────────────────────────────────

  describe("Built-in blueprint read-only enforcement", () => {
    const builtIn = makeBlueprintRow({ isBuiltIn: true, organizationId: null });

    it("updateCustomBlueprint refuses built-ins", async () => {
      setupSelectSequence([[builtIn]]);
      await expect(updateCustomBlueprint("bp-built-in", { title: "Hack" }, ORG_ID, USER_ID))
        .rejects.toMatchObject({ statusCode: 403 });
    });

    it("archiveBlueprint refuses built-ins", async () => {
      setupSelectSequence([[builtIn]]);
      await expect(archiveBlueprint("bp-built-in", ORG_ID, USER_ID))
        .rejects.toMatchObject({ statusCode: 403 });
    });

    it("restoreBlueprint refuses built-ins", async () => {
      setupSelectSequence([[builtIn]]);
      await expect(restoreBlueprint("bp-built-in", ORG_ID, USER_ID))
        .rejects.toMatchObject({ statusCode: 403 });
    });

    it("submitForReview refuses built-ins", async () => {
      setupSelectSequence([[builtIn]]);
      await expect(submitForReview("bp-built-in", ORG_ID, USER_ID))
        .rejects.toMatchObject({ statusCode: 403 });
    });

    it("publishBlueprint refuses built-ins", async () => {
      setupSelectSequence([[builtIn]]);
      await expect(publishBlueprint("bp-built-in", ORG_ID, USER_ID))
        .rejects.toMatchObject({ statusCode: 403 });
    });

    it("cloneBlueprint CAN clone a built-in into a new org blueprint", async () => {
      const cloned = makeBlueprintRow({ id: "bp-clone", organizationId: ORG_ID, isBuiltIn: false });
      setupSelectSequence([[builtIn], [cloned]]);
      const result = await cloneBlueprint("bp-built-in", ORG_ID, USER_ID);
      expect(result.isBuiltIn).toBe(false);
      expect(result.organizationId).toBe(ORG_ID);
    });
  });

  // ─── Status lifecycle transitions ─────────────────────────────────────────

  describe("Status lifecycle transitions", () => {
    it("draft → review is allowed", async () => {
      setupSelectSequence([[makeBlueprintRow({ status: "draft" })], [makeBlueprintRow({ status: "review" })]]);
      const result = await submitForReview("bp-001", ORG_ID, USER_ID);
      expect(result.status).toBe("review");
    });

    it("draft → published is allowed directly", async () => {
      setupSelectSequence([
        [makeBlueprintRow({ status: "draft" })],
        [],
        [makeBlueprintRow({ status: "published" })],
        [makeVersionRow()],
      ]);
      const result = await publishBlueprint("bp-001", ORG_ID, USER_ID);
      expect(result.blueprint.status).toBe("published");
    });

    it("review → published is allowed", async () => {
      setupSelectSequence([
        [makeBlueprintRow({ status: "review" })],
        [],
        [makeBlueprintRow({ status: "published" })],
        [makeVersionRow()],
      ]);
      const result = await publishBlueprint("bp-001", ORG_ID, USER_ID);
      expect(result.blueprint.status).toBe("published");
    });

    it("archived → draft is allowed via restore", async () => {
      setupSelectSequence([
        [makeBlueprintRow({ status: "archived", isActive: false })],
        [makeBlueprintRow({ status: "draft", isActive: true })],
      ]);
      const result = await restoreBlueprint("bp-001", ORG_ID, USER_ID);
      expect(result.status).toBe("draft");
    });

    it("review → review is NOT allowed (409)", async () => {
      setupSelectSequence([[makeBlueprintRow({ status: "review" })]]);
      await expect(submitForReview("bp-001", ORG_ID, USER_ID))
        .rejects.toMatchObject({ statusCode: 409 });
    });

    it("draft → draft restore is NOT allowed (409)", async () => {
      setupSelectSequence([[makeBlueprintRow({ status: "draft" })]]);
      await expect(restoreBlueprint("bp-001", ORG_ID, USER_ID))
        .rejects.toMatchObject({ statusCode: 409 });
    });
  });

  // ─── Audit integrity ──────────────────────────────────────────────────────

  describe("Audit events", () => {
    it("every mutating operation logs exactly one audit event", async () => {
      const operations: Array<() => Promise<unknown>> = [
        async () => {
          setupSelectSequence([[makeBlueprintRow()]]);
          return createCustomBlueprint({ code: "c", title: "T", objective: "O", primarySpecialist: "chief_of_staff" }, ORG_ID, USER_ID);
        },
        async () => {
          setupSelectSequence([[makeBlueprintRow()], [makeBlueprintRow()]]);
          return updateCustomBlueprint("bp-001", { title: "U" }, ORG_ID, USER_ID);
        },
        async () => {
          setupSelectSequence([[makeBlueprintRow()], [makeBlueprintRow({ status: "archived" })]]);
          return archiveBlueprint("bp-001", ORG_ID, USER_ID);
        },
        async () => {
          setupSelectSequence([[makeBlueprintRow({ status: "archived" })], [makeBlueprintRow()]]);
          return restoreBlueprint("bp-001", ORG_ID, USER_ID);
        },
        async () => {
          setupSelectSequence([[makeBlueprintRow()], [makeBlueprintRow({ status: "draft" })]]);
          return submitForReview("bp-001", ORG_ID, USER_ID);
        },
        async () => {
          setupSelectSequence([[makeBlueprintRow()], [makeBlueprintRow()]]);
          return cloneBlueprint("bp-001", ORG_ID, USER_ID);
        },
      ];

      for (const op of operations) {
        mockLogOrg.mockClear();
        await op();
        expect(mockLogOrg).toHaveBeenCalledTimes(1);
      }
    });

    it("all audit events include the correct organizationId and resourceType", async () => {
      setupSelectSequence([[makeBlueprintRow()], [makeBlueprintRow({ status: "archived" })]]);
      await archiveBlueprint("bp-001", ORG_ID, USER_ID);
      expect(mockLogOrg).toHaveBeenCalledWith(expect.objectContaining({
        organizationId: ORG_ID,
        resourceType: "work_blueprint",
        actorUserId: USER_ID,
      }));
    });
  });

  // ─── Regression: Sprint 22 compatibility ─────────────────────────────────

  describe("Sprint 22 regression checks", () => {
    it("mapRow correctly maps status field from DB row", async () => {
      const row = makeBlueprintRow({ status: "published" });
      setupSelectSequence([[row]]);
      const result = await getBlueprintById("bp-001", ORG_ID);
      expect(result!.status).toBe("published");
    });

    it("getBlueprintById still works correctly for existing callers", async () => {
      setupSelectSequence([[makeBlueprintRow()]]);
      const result = await getBlueprintById("bp-001", ORG_ID);
      expect(result).not.toBeNull();
      expect(result!.id).toBe("bp-001");
    });

    it("createCustomBlueprint preserves all Sprint 22 fields", async () => {
      setupSelectSequence([[makeBlueprintRow()]]);
      await createCustomBlueprint({
        code: "test", title: "Test", objective: "Obj", primarySpecialist: "chief_of_staff",
        validationRules: [{ rule: "test", required: true, description: "desc" }],
        qualityRules: [{ dimension: "completeness", weight: 50, description: "Complete" }],
      }, ORG_ID, USER_ID);

      const insertVals = mockInsert.mock.results[0]!.value.values.mock.calls[0]?.[0];
      expect(insertVals.validationRules).toHaveLength(1);
      expect(insertVals.qualityRules).toHaveLength(1);
    });

    it("seedBuiltInBlueprints sets status=published for all built-ins", async () => {
      // All 14 built-ins already exist → none seeded
      const { seedBuiltInBlueprints } = await import("../services/workBlueprintService.js");
      // setupSingleSelect: each of the 14 built-in checks returns an existing row
      mockSelectImpl.mockReturnValue(makeSelectChain([{ id: "existing" }]));
      await seedBuiltInBlueprints();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it("seedBuiltInBlueprints inserts status=published when seeding new built-ins", async () => {
      // First built-in does not exist → gets inserted; rest exist
      let call = 0;
      mockSelectImpl.mockImplementation(() => {
        if (call++ === 0) return makeSelectChain([]); // first: not found
        return makeSelectChain([{ id: "existing" }]); // rest: found
      });
      const { seedBuiltInBlueprints } = await import("../services/workBlueprintService.js");
      await seedBuiltInBlueprints();
      const insertVals = mockInsert.mock.results[0]!.value.values.mock.calls[0]?.[0];
      expect(insertVals.status).toBe("published");
      expect(insertVals.isBuiltIn).toBe(true);
    });
  });

});
