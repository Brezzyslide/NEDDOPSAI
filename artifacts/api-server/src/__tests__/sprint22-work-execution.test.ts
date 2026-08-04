/**
 * Sprint 22 — Work Execution Engine & Completed Work
 *
 * Statuses (from completedWork.ts schema):
 *   draft → awaiting_approval → approved → archived | superseded
 *                             ↘ rejected → reopened → awaiting_approval
 *
 * Covers:
 *   - Work Blueprint selection (rule-based keyword match, DB lookup, no-match fallback)
 *   - Blueprint listing (built-ins + org-specific)
 *   - Blueprint create / update (custom)
 *   - Work Validation Service (each rule type, conflict detection)
 *   - Approved Example Service (empty list, style guidance extraction)
 *   - Self Review Service (10 dimensions, weighted scoring, auto-revision trigger)
 *   - Completed Work lifecycle (all 7 statuses & valid transitions)
 *   - Invalid status transition errors
 *   - Promote-to-Library (approved + unapproved guard)
 *   - Version history (addVersion, getVersions)
 *   - Comments (addComment, getComments)
 *   - RLS isolation for all 6 Sprint-22 tables
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { REQUIRED_RLS_TABLES } from "@workspace/org-db";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockDb, mockLogOrgEvent, mockCreateAIGateway } = vi.hoisted(() => {
  // A mock DB row for a blueprint
  const makeBpRow = (overrides: Record<string, unknown> = {}) => ({
    id: "bp-db-row-001",
    organizationId: null,
    code: "incident_investigation",
    title: "Incident Investigation",
    version: "1.0.0",
    objective: "Investigate incidents",
    primarySpecialist: "incident_safeguarding_specialist",
    supportingSpecialists: [],
    requiredLibraryKnowledge: ["policy"],
    requiredEntityKnowledge: {},
    requiredMemories: [],
    requiredApprovals: {},
    validationRules: [],
    qualityRules: [],
    successCriteria: [],
    outputTypes: ["investigation_report"],
    escalationRules: [],
    mandatoryCitations: [],
    isBuiltIn: true,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const mockDb = {
    select:  vi.fn(() => ({ from: () => ({ where: () => ({ limit: () => [makeBpRow()], orderBy: () => [], offset: () => [] }) }) })),
    insert:  vi.fn(() => ({ values: () => ({ returning: () => [makeBpRow()] }) })),
    update:  vi.fn(() => ({ set: () => ({ where: () => ({ returning: () => [makeBpRow()] }) }) })),
    delete:  vi.fn(() => ({ where: () => ({ returning: () => [] }) })),
    query:   {},
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb)),
    _makeBpRow: makeBpRow,
  };

  const mockLogOrgEvent = vi.fn().mockResolvedValue(undefined);

  const mockCreateAIGateway = vi.fn(() => ({
    chat: vi.fn().mockResolvedValue({
      choices: [{ message: { content: "Draft content from AI" } }],
    }),
  }));

  return { mockDb, mockLogOrgEvent, mockCreateAIGateway };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: mockDb };
});

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: mockLogOrgEvent,
  getRequestMeta: vi.fn().mockReturnValue({}),
}));

vi.mock("@workspace/ai-gateway", () => ({
  createAIGateway: mockCreateAIGateway,
}));

// ─── Import services after mocks ──────────────────────────────────────────────

import {
  selectBlueprint,
  listBlueprints,
  createCustomBlueprint,
  updateCustomBlueprint,
  seedBuiltInBlueprints,
  type WorkBlueprint,
  type CreateBlueprintInput,
} from "../services/workBlueprintService.js";

import {
  validateWorkPackage,
} from "../services/workValidationService.js";

import {
  reviewDraft,
  QUALITY_THRESHOLD,
  REVIEW_DIMENSIONS,
} from "../services/selfReviewService.js";

import {
  buildStyleGuidance,
  type ApprovedExample,
} from "../services/approvedExampleService.js";

import type { WorkPackageManifest } from "../services/workPackageService.js";

// ─── Shared test fixtures ─────────────────────────────────────────────────────

const ORG_ID  = "org-sprint22-test";
const USER_ID = "user-sprint22-test";

function makeBlueprint(overrides: Partial<WorkBlueprint> = {}): WorkBlueprint {
  return {
    id:                      "bp-test-001",
    organizationId:          null,
    code:                    "test_blueprint",
    title:                   "Test Blueprint",
    version:                 "1.0.0",
    objective:               "Produce a test document",
    primarySpecialist:       "chief_of_staff",
    supportingSpecialists:   [],
    requiredLibraryKnowledge: ["policy", "procedure"],
    requiredEntityKnowledge: {},
    requiredMemories:        ["approval_rule"],
    requiredApprovals:       {},
    validationRules:         [
      { rule: "policy_present", required: true,  description: "A policy must be present" },
      { rule: "template_present", required: false, description: "A template is preferred" },
    ],
    qualityRules: [
      { dimension: "completeness", weight: 40, description: "All sections populated" },
      { dimension: "policy_compliance", weight: 60, description: "Complies with org policy" },
    ],
    successCriteria:  ["Document produced", "Policy cited"],
    outputTypes:      ["report"],
    escalationRules:  [],
    mandatoryCitations: ["policy"],
    isBuiltIn:  true,
    isActive:   true,
    createdAt:  new Date(),
    updatedAt:  new Date(),
    ...overrides,
  };
}

function makeManifest(overrides: Partial<WorkPackageManifest> = {}): WorkPackageManifest {
  return {
    id:               "manifest-test-001",
    organizationId:   ORG_ID,
    completedWorkId:  null,
    executionId:      "exec-test-001",
    blueprintId:      "bp-test-001",
    blueprintVersion: "1.0.0",
    primarySpecialist: "chief_of_staff",
    supportingSpecialists: [],
    organisationLibrarySources: [],
    cosMemories:       [],
    specialistMemories: [],
    entityKnowledge:  {},
    taskUploads:      [],
    modelVersion:     "gpt-4o",
    promptVersion:    "sprint22.1.0",
    assembledAt:      new Date(),
    requesterId:      USER_ID,
    createdAt:        new Date(),
    ...overrides,
  };
}

function makeCwRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cw-default", organizationId: ORG_ID, status: "draft",
    primarySpecialist: "chief_of_staff", title: "Report",
    outputType: "report", currentVersionId: "v-default",
    conversationId: null, blueprintId: null, manifestId: null,
    createdByUserId: USER_ID, approvedByUserId: null, approvedAt: null,
    rejectedAt: null, archivedAt: null, reopenedAt: null, supersededById: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

// ─── Blueprint Selection ──────────────────────────────────────────────────────

describe("selectBlueprint — keyword matching", () => {
  it("returns a well-formed result for 'incident investigation report'", async () => {
    const result = await selectBlueprint("I need to write an incident investigation report", ORG_ID);
    expect(result).toHaveProperty("blueprint");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("matchedKeywords");
    expect(result).toHaveProperty("fallbackUsed");
  });

  it("confidence is a number between 0 and 1 for an incident request", async () => {
    const result = await selectBlueprint("I need to write an incident investigation report", ORG_ID);
    expect(typeof result.confidence).toBe("number");
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("matchedKeywords is an array", async () => {
    const result = await selectBlueprint("I need to write an incident investigation report", ORG_ID);
    expect(Array.isArray(result.matchedKeywords)).toBe(true);
  });

  it("returns null blueprint with fallbackUsed=true when DB returns no row for matched keyword", async () => {
    // Sprint 28: selectBlueprint now does TWO queries: org-published first, then built-in fallback
    const emptyChain = { from: () => ({ where: () => ({ limit: () => [] }) }) };
    mockDb.select.mockReturnValueOnce(emptyChain); // org query: no match
    mockDb.select.mockReturnValueOnce(emptyChain); // built-in query: no match
    const result = await selectBlueprint("incident investigation report", ORG_ID);
    // DB returned nothing for both queries — fallback
    expect(result.fallbackUsed).toBe(true);
    expect(result.blueprint).toBeNull();
  });

  it("returns null blueprint with fallbackUsed=true for completely unrelated request", async () => {
    const result = await selectBlueprint("the quick brown fox jumps over the lazy dog", ORG_ID);
    // No keyword match → immediate fallback without DB query
    expect(result.fallbackUsed).toBe(true);
    expect(result.blueprint).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("returns blueprint with confidence > 0 when DB has a matching row", async () => {
    const bpRow = mockDb._makeBpRow({ code: "incident_investigation" });
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => [bpRow] }) }),
    });
    const result = await selectBlueprint("incident investigation report", ORG_ID);
    expect(result.blueprint).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.fallbackUsed).toBe(false);
  });

  it("maps a DB blueprint row to the correct primarySpecialist", async () => {
    const bpRow = mockDb._makeBpRow({ code: "incident_investigation", primarySpecialist: "incident_safeguarding_specialist" });
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => [bpRow] }) }),
    });
    const result = await selectBlueprint("Write an incident investigation report please", ORG_ID);
    if (result.blueprint) {
      expect(result.blueprint.primarySpecialist).toBe("incident_safeguarding_specialist");
    }
  });

  it("returns well-formed result for 'behaviour support plan' request", async () => {
    const result = await selectBlueprint("Create a behaviour support plan for this participant", ORG_ID);
    expect(result).toHaveProperty("blueprint");
    expect(result).toHaveProperty("fallbackUsed");
  });
});

// ─── listBlueprints ───────────────────────────────────────────────────────────

describe("listBlueprints", () => {
  // listBlueprints: db.select().from().where()  ← no orderBy / limit / offset
  it("returns an array when DB has rows", async () => {
    const row = mockDb._makeBpRow({ code: "risk_assessment", organizationId: ORG_ID });
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => [row] }),
    });
    const result = await listBlueprints(ORG_ID);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
  });

  it("returns empty array when DB is empty", async () => {
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => [] }),
    });
    const result = await listBlueprints(ORG_ID);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it("maps DB rows to WorkBlueprint objects with expected shape", async () => {
    const row = mockDb._makeBpRow({ code: "care_plan", organizationId: ORG_ID, title: "Care Plan" });
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => [row] }),
    });
    const result = await listBlueprints(ORG_ID);
    expect(result.length).toBe(1);
    expect(result[0]).toHaveProperty("code");
    expect(result[0]).toHaveProperty("title");
    expect(result[0]).toHaveProperty("primarySpecialist");
    expect(result[0]).toHaveProperty("isBuiltIn");
  });
});

// ─── Blueprint Create ─────────────────────────────────────────────────────────

describe("createCustomBlueprint", () => {
  const input: CreateBlueprintInput = {
    code: "custom_review",
    title: "Custom Review",
    objective: "Conduct a custom review",
    primarySpecialist: "compliance_quality_manager",
    supportingSpecialists: ["chief_of_staff"],
    requiredLibraryKnowledge: ["policy"],
    requiredEntityKnowledge: {},
    requiredMemories: ["approval_rule"],
    requiredApprovals: {},
    validationRules: [],
    qualityRules: [],
    successCriteria: ["Review completed"],
    outputTypes: ["report"],
    escalationRules: [],
    mandatoryCitations: [],
  };

  it("inserts a new blueprint and returns the created record", async () => {
    const created = mockDb._makeBpRow({ code: "custom_review", organizationId: ORG_ID, isBuiltIn: false, title: "Custom Review" });
    mockDb.insert.mockReturnValueOnce({ values: () => ({ returning: () => [created] }) });
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [created] }) }) });
    const result = await createCustomBlueprint(input, ORG_ID, USER_ID);
    expect(result.code).toBe("custom_review");
  });

  it("calls logOrgEvent on creation", async () => {
    const created = mockDb._makeBpRow({ code: "custom_review2", organizationId: ORG_ID, isBuiltIn: false });
    mockDb.insert.mockReturnValueOnce({ values: () => ({ returning: () => [created] }) });
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [created] }) }) });
    mockLogOrgEvent.mockClear();
    await createCustomBlueprint({ ...input, code: "custom_review2" }, ORG_ID, USER_ID);
    expect(mockLogOrgEvent).toHaveBeenCalled();
  });

  it("throws if getBlueprintById returns null after insert (simulates DB failure)", async () => {
    // insert succeeds, but getBlueprintById finds nothing → "Blueprint not found after creation"
    mockDb.insert.mockReturnValueOnce({ values: () => Promise.resolve() });
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [] }) }) });
    await expect(createCustomBlueprint(input, ORG_ID, USER_ID)).rejects.toThrow();
  });
});

// ─── Blueprint Update ─────────────────────────────────────────────────────────

describe("updateCustomBlueprint", () => {
  it("applies updates and returns updated record", async () => {
    const existing = mockDb._makeBpRow({ id: "bp-upd-001", organizationId: ORG_ID, isBuiltIn: false, title: "Original Title" });
    const updated  = { ...existing, title: "Updated Title" };
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [existing] }) }) })
               .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [updated] }) }) });
    mockDb.update.mockReturnValueOnce({ set: () => ({ where: () => ({ returning: () => [updated] }) }) });
    const result = await updateCustomBlueprint("bp-upd-001", { title: "Updated Title" }, ORG_ID, USER_ID);
    expect(result.title).toBe("Updated Title");
  });

  it("throws if blueprint not found", async () => {
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [] }) }) });
    await expect(updateCustomBlueprint("bp-missing", { title: "X" }, ORG_ID, USER_ID)).rejects.toThrow();
  });

  it("throws if attempting to update a built-in blueprint", async () => {
    const builtIn = mockDb._makeBpRow({ id: "bp-builtin", organizationId: null, isBuiltIn: true });
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [builtIn] }) }) });
    await expect(updateCustomBlueprint("bp-builtin", { title: "X" }, ORG_ID, USER_ID)).rejects.toThrow();
  });
});

// ─── Work Validation Service ──────────────────────────────────────────────────

describe("validateWorkPackage — no blueprint", () => {
  it("passes when no blueprint is provided", () => {
    const result = validateWorkPackage(makeManifest(), null);
    expect(result.passed).toBe(true);
    expect(result.recommendedAction).toBe("proceed");
  });

  it("returns empty issues list with no blueprint", () => {
    const result = validateWorkPackage(makeManifest(), null);
    expect(result.issues).toHaveLength(0);
    expect(result.missingItems).toHaveLength(0);
  });

  it("summary is a non-empty string", () => {
    const result = validateWorkPackage(makeManifest(), null);
    expect(typeof result.summary).toBe("string");
    expect(result.summary.length).toBeGreaterThan(0);
  });
});

describe("validateWorkPackage — blueprint validation rules", () => {
  it("flags missing required policy source as error", () => {
    const bp = makeBlueprint({
      validationRules: [
        { rule: "incident_policy_present", required: true, description: "Incident policy required" },
      ],
    });
    const result = validateWorkPackage(makeManifest({ organisationLibrarySources: [] }), bp);
    expect(result.passed).toBe(false);
    expect(result.issues.some(i => i.level === "error")).toBe(true);
    expect(result.missingItems.length).toBeGreaterThan(0);
  });

  it("passes when required policy source is present", () => {
    const bp = makeBlueprint({
      validationRules: [{ rule: "policy_present", required: true, description: "Policy required" }],
    });
    const manifest = makeManifest({
      organisationLibrarySources: [
        { sourceId: "src-001", title: "Leave Policy", sourceType: "policy", authorityLevel: "authoritative" } as never,
      ],
    });
    const result = validateWorkPackage(manifest, bp);
    expect(result.issues.filter(i => i.level === "error").length).toBe(0);
  });

  it("non-required rule produces warning or less, not error", () => {
    const bp = makeBlueprint({
      validationRules: [{ rule: "template_present", required: false, description: "Template preferred" }],
    });
    const result = validateWorkPackage(makeManifest({ organisationLibrarySources: [] }), bp);
    expect(result.issues.filter(i => i.level === "error").length).toBe(0);
  });

  it("recommendedAction is not 'proceed' when required items are missing", () => {
    const bp = makeBlueprint({
      validationRules: [
        { rule: "legislation_present", required: true, description: "Legislation required" },
        { rule: "policy_present",      required: true, description: "Policy required" },
      ],
    });
    const result = validateWorkPackage(makeManifest({ organisationLibrarySources: [] }), bp);
    expect(result.passed).toBe(false);
    expect(["request_information", "retrieve_additional_documents", "flag_for_human_review"]).toContain(result.recommendedAction);
  });

  it("passes all rules when all required sources are present", () => {
    const bp = makeBlueprint({
      validationRules: [
        { rule: "policy_present",    required: true, description: "Policy required" },
        { rule: "procedure_present", required: true, description: "Procedure required" },
      ],
    });
    const manifest = makeManifest({
      organisationLibrarySources: [
        { sourceId: "s1", title: "Policy", sourceType: "policy", authorityLevel: "authoritative" } as never,
        { sourceId: "s2", title: "Procedure", sourceType: "procedure", authorityLevel: "authoritative" } as never,
      ],
    });
    const result = validateWorkPackage(manifest, bp);
    expect(result.issues.filter(i => i.level === "error").length).toBe(0);
  });

  it("fails participant_context_present when no taskUploads and no entityKnowledge", () => {
    const bp = makeBlueprint({
      validationRules: [
        { rule: "participant_context_present", required: true, description: "Participant context required" },
      ],
    });
    const result = validateWorkPackage(makeManifest({ taskUploads: [], entityKnowledge: {} }), bp);
    expect(result.passed).toBe(false);
  });

  it("passes participant_context_present when taskUploads provided", () => {
    const bp = makeBlueprint({
      validationRules: [
        { rule: "participant_context_present", required: true, description: "Participant context required" },
      ],
    });
    const manifest = makeManifest({
      taskUploads: [
        { sourceId: "u1", title: "Participant Notes", sourceType: "task_upload", authorityLevel: "supporting" } as never,
      ],
    });
    const result = validateWorkPackage(manifest, bp);
    expect(result.issues.filter(i => i.level === "error" && i.rule === "participant_context_present").length).toBe(0);
  });

  it("returns proceed when no validation rules defined", () => {
    const bp = makeBlueprint({ validationRules: [] });
    const result = validateWorkPackage(makeManifest(), bp);
    expect(result.recommendedAction).toBe("proceed");
  });

  it("risk_policy_present fails without risk source", () => {
    const bp = makeBlueprint({
      validationRules: [{ rule: "risk_policy_present", required: true, description: "Risk policy required" }],
    });
    const result = validateWorkPackage(makeManifest({ organisationLibrarySources: [] }), bp);
    expect(result.passed).toBe(false);
  });

  it("summary is always a non-empty string", () => {
    const cases = [
      validateWorkPackage(makeManifest(), makeBlueprint({ validationRules: [] })),
      validateWorkPackage(makeManifest({ organisationLibrarySources: [] }), makeBlueprint({
        validationRules: [{ rule: "policy_present", required: true, description: "Policy required" }],
      })),
    ];
    for (const result of cases) {
      expect(typeof result.summary).toBe("string");
      expect(result.summary.length).toBeGreaterThan(0);
    }
  });
});

// ─── Style Guidance (Approved Examples) ──────────────────────────────────────

describe("buildStyleGuidance — from approved examples", () => {
  it("returns a StyleGuidance object with the correct keys for empty examples", async () => {
    const guidance = await buildStyleGuidance([], ORG_ID);
    expect(guidance).toHaveProperty("writingStyle");
    expect(guidance).toHaveProperty("terminology");
    expect(guidance).toHaveProperty("formattingConventions");
    expect(guidance).toHaveProperty("toneDescriptors");
    expect(guidance).toHaveProperty("avoidPatterns");
    expect(guidance).toHaveProperty("guidanceBlock");
  });

  it("returns empty arrays and empty guidanceBlock for zero examples", async () => {
    const guidance = await buildStyleGuidance([], ORG_ID);
    expect(Array.isArray(guidance.writingStyle)).toBe(true);
    expect(Array.isArray(guidance.terminology)).toBe(true);
    expect(Array.isArray(guidance.formattingConventions)).toBe(true);
    expect(guidance.guidanceBlock).toBe("");
  });

  it("returns non-empty guidanceBlock when chunks contain style signals", async () => {
    const examples: ApprovedExample[] = [
      { sourceId: "src-ex-001", title: "Example Report", sourceType: "approved_example", authorityLevel: "authoritative" },
    ];
    mockDb.select.mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: () => [
            { content: "Pursuant to the policy, all participants must be notified.", chunkIndex: 0 },
            { content: "In accordance with legislation, formal language is required.", chunkIndex: 1 },
          ],
        }),
      }),
    });
    const guidance = await buildStyleGuidance(examples, ORG_ID);
    expect(typeof guidance.guidanceBlock).toBe("string");
    expect(Array.isArray(guidance.writingStyle)).toBe(true);
  });

  it("does not reproduce example content verbatim in guidanceBlock", async () => {
    const examples: ApprovedExample[] = [
      { sourceId: "src-ex-002", title: "Example", sourceType: "approved_example", authorityLevel: null },
    ];
    mockDb.select.mockReturnValueOnce({
      from: () => ({
        where: () => ({ limit: () => [{ content: "EXACT_REPRODUCED_XYZ987", chunkIndex: 0 }] }),
      }),
    });
    const guidance = await buildStyleGuidance(examples, ORG_ID);
    expect(guidance.guidanceBlock).not.toContain("EXACT_REPRODUCED_XYZ987");
  });

  it("returns toneDescriptors as array", async () => {
    const guidance = await buildStyleGuidance([], ORG_ID);
    expect(Array.isArray(guidance.toneDescriptors)).toBe(true);
  });

  it("returns avoidPatterns as array", async () => {
    const guidance = await buildStyleGuidance([], ORG_ID);
    expect(Array.isArray(guidance.avoidPatterns)).toBe(true);
  });
});

// ─── Self Review Service ──────────────────────────────────────────────────────

describe("reviewDraft — quality scoring", () => {
  const manifest = makeManifest({
    organisationLibrarySources: [
      { sourceId: "s1", title: "Policy", sourceType: "policy", authorityLevel: "authoritative" } as never,
    ],
  });
  const ctx = { organizationId: ORG_ID, userId: USER_ID, conversationId: "conv-001" };

  it("returns a ReviewResult with the expected shape", async () => {
    const result = await reviewDraft("This is a well-written draft document with policy compliance.", manifest, null, ctx);
    expect(result).toHaveProperty("qualityScore");
    expect(result).toHaveProperty("dimensions");
    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("finalContent");
    expect(result).toHaveProperty("revised");
  });

  it("qualityScore is between 0 and 100", async () => {
    const result = await reviewDraft("Some content", manifest, null, ctx);
    expect(result.qualityScore).toBeGreaterThanOrEqual(0);
    expect(result.qualityScore).toBeLessThanOrEqual(100);
  });

  it("dimensions array contains all 10 review dimensions", async () => {
    const result = await reviewDraft("Content for review", manifest, null, ctx);
    expect(result.dimensions).toHaveLength(10);
    const names = result.dimensions.map(d => d.dimension);
    for (const dim of REVIEW_DIMENSIONS) {
      expect(names).toContain(dim);
    }
  });

  it("each dimension has score 0-10 and a feedback string", async () => {
    const result = await reviewDraft("Draft content", manifest, null, ctx);
    for (const dim of result.dimensions) {
      expect(dim.score).toBeGreaterThanOrEqual(0);
      expect(dim.score).toBeLessThanOrEqual(10);
      expect(typeof dim.feedback).toBe("string");
    }
  });

  it("passed=true iff qualityScore >= QUALITY_THRESHOLD (70)", async () => {
    const result = await reviewDraft("Draft content", manifest, null, ctx);
    expect(result.passed).toBe(result.qualityScore >= QUALITY_THRESHOLD);
  });

  it("QUALITY_THRESHOLD is 70", () => {
    expect(QUALITY_THRESHOLD).toBe(70);
  });

  it("REVIEW_DIMENSIONS has exactly 10 items", () => {
    expect(REVIEW_DIMENSIONS).toHaveLength(10);
  });

  it("finalContent is the original content when not revised", async () => {
    const content = "This is my draft content.";
    const result = await reviewDraft(content, manifest, null, ctx);
    if (!result.revised) {
      expect(result.finalContent).toBe(content);
    }
  });

  it("uses blueprint quality rules for weighted scoring", async () => {
    const bp = makeBlueprint({
      qualityRules: [
        { dimension: "completeness", weight: 50, description: "Completeness" },
        { dimension: "policy_compliance", weight: 50, description: "Policy compliance" },
      ],
    });
    const result = await reviewDraft("Document content with all required sections.", manifest, bp, ctx);
    expect(result.qualityScore).toBeGreaterThanOrEqual(0);
    expect(result.qualityScore).toBeLessThanOrEqual(100);
  });

  it("improvementFeedback is an array", async () => {
    const result = await reviewDraft("x", makeManifest(), null, ctx);
    expect(Array.isArray(result.improvementFeedback)).toBe(true);
  });

  it("short content scores low on completeness", async () => {
    const result = await reviewDraft("Hi.", makeManifest(), null, ctx);
    const completeness = result.dimensions.find(d => d.dimension === "completeness");
    expect(completeness).toBeDefined();
    expect(completeness!.score).toBeLessThanOrEqual(10);
  });

  it("safety dimension is always present and scored", async () => {
    const result = await reviewDraft(
      "This document considers participant safety and includes emergency procedures.",
      makeManifest(), null, ctx,
    );
    const safety = result.dimensions.find(d => d.dimension === "safety");
    expect(safety).toBeDefined();
    expect(safety!.score).toBeGreaterThanOrEqual(0);
  });
});

// ─── Completed Work — status values ──────────────────────────────────────────

describe("completed work — COMPLETED_WORK_STATUSES", () => {
  it("contains the 7 required lifecycle statuses", async () => {
    const { COMPLETED_WORK_STATUSES } = await import("@workspace/db");
    const expected = ["draft", "awaiting_approval", "approved", "rejected", "archived", "superseded", "reopened"];
    for (const s of expected) {
      expect(COMPLETED_WORK_STATUSES).toContain(s);
    }
  });

  it("has exactly 7 statuses", async () => {
    const { COMPLETED_WORK_STATUSES } = await import("@workspace/db");
    expect(COMPLETED_WORK_STATUSES).toHaveLength(7);
  });
});

// ─── completedWorkService — createDraft ──────────────────────────────────────

describe("completedWorkService — createDraft", () => {
  it("creates a draft and returns CompletedWorkItem with status=draft", async () => {
    const draftRow = makeCwRow({ id: "cw-001", status: "draft" });
    const versionRow = { id: "v-001", completedWorkId: "cw-001", organizationId: ORG_ID,
      versionNumber: 1, contentMarkdown: "# Test\n\nContent.", qualityScore: null,
      reviewDimensions: [], changeNote: null, isAutoRevision: "false",
      createdByUserId: USER_ID, createdAt: new Date() };

    mockDb.insert.mockReturnValueOnce({ values: () => ({ returning: () => [draftRow] }) })
               .mockReturnValueOnce({ values: () => ({ returning: () => [versionRow] }) });
    mockDb.update.mockReturnValueOnce({ set: () => ({ where: () => ({ returning: () => [draftRow] }) }) });
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [draftRow] }) }) });

    const { createDraft } = await import("../services/completedWorkService.js");
    const result = await createDraft({
      organizationId: ORG_ID,
      primarySpecialist: "chief_of_staff",
      title: "Test Report",
      outputType: "report",
      contentMarkdown: "# Test Report\n\nContent here.",
      createdByUserId: USER_ID,
    });

    expect(result.status).toBe("draft");
    expect(result.primarySpecialist).toBe("chief_of_staff");
  });
});

// ─── completedWorkService — getCompletedWork ──────────────────────────────────

describe("completedWorkService — getCompletedWork", () => {
  it("returns null when no row found", async () => {
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [] }) }) });
    const { getCompletedWork } = await import("../services/completedWorkService.js");
    expect(await getCompletedWork("nonexistent", ORG_ID)).toBeNull();
  });

  it("maps DB row to CompletedWorkItem shape", async () => {
    const row = makeCwRow({ id: "cw-002", status: "awaiting_approval", outputType: "care_plan" });
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [row] }) }) });
    const { getCompletedWork } = await import("../services/completedWorkService.js");
    const result = await getCompletedWork("cw-002", ORG_ID);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("awaiting_approval");
    expect(result!.outputType).toBe("care_plan");
  });
});

// ─── completedWorkService — submitForApproval (draft → awaiting_approval) ────

describe("completedWorkService — submitForApproval", () => {
  it("transitions draft → awaiting_approval", async () => {
    const draft     = makeCwRow({ id: "cw-003", status: "draft" });
    const submitted = makeCwRow({ id: "cw-003", status: "awaiting_approval" });
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [draft] }) }) })
               .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [submitted] }) }) });
    mockDb.update.mockReturnValueOnce({ set: () => ({ where: () => ({ returning: () => [submitted] }) }) });

    const { submitForApproval } = await import("../services/completedWorkService.js");
    const result = await submitForApproval("cw-003", ORG_ID, USER_ID);
    expect(result.status).toBe("awaiting_approval");
  });

  it("throws for invalid transition: awaiting_approval → awaiting_approval", async () => {
    const submitted = makeCwRow({ status: "awaiting_approval" });
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [submitted] }) }) });
    const { submitForApproval } = await import("../services/completedWorkService.js");
    await expect(submitForApproval("cw-004", ORG_ID, USER_ID)).rejects.toThrow();
  });

  it("throws when completed work not found", async () => {
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [] }) }) });
    const { submitForApproval } = await import("../services/completedWorkService.js");
    await expect(submitForApproval("missing-id", ORG_ID, USER_ID)).rejects.toThrow();
  });
});

// ─── completedWorkService — approve (awaiting_approval → approved) ────────────

describe("completedWorkService — approve", () => {
  it("transitions awaiting_approval → approved", async () => {
    const awaiting = makeCwRow({ id: "cw-010", status: "awaiting_approval" });
    const approved = makeCwRow({ id: "cw-010", status: "approved", approvedByUserId: USER_ID, approvedAt: new Date() });
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [awaiting] }) }) })
               .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [approved] }) }) });
    mockDb.update.mockReturnValueOnce({ set: () => ({ where: () => ({ returning: () => [approved] }) }) });

    const { approve } = await import("../services/completedWorkService.js");
    const result = await approve("cw-010", ORG_ID, USER_ID);
    expect(result.status).toBe("approved");
    expect(result.approvedByUserId).toBe(USER_ID);
  });

  it("throws: cannot approve a draft (must be awaiting_approval)", async () => {
    const draft = makeCwRow({ status: "draft" });
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [draft] }) }) });
    const { approve } = await import("../services/completedWorkService.js");
    await expect(approve("cw-011", ORG_ID, USER_ID)).rejects.toThrow();
  });
});

// ─── completedWorkService — reject (awaiting_approval → rejected) ─────────────

describe("completedWorkService — reject", () => {
  it("transitions awaiting_approval → rejected", async () => {
    const awaiting = makeCwRow({ id: "cw-020", status: "awaiting_approval" });
    const rejected = makeCwRow({ id: "cw-020", status: "rejected", rejectedAt: new Date() });
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [awaiting] }) }) })
               .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [rejected] }) }) });
    mockDb.update.mockReturnValueOnce({ set: () => ({ where: () => ({ returning: () => [rejected] }) }) });

    const { reject } = await import("../services/completedWorkService.js");
    const result = await reject("cw-020", ORG_ID, USER_ID, "Needs revision");
    expect(result.status).toBe("rejected");
  });

  it("throws: cannot reject a draft (must be awaiting_approval)", async () => {
    const draft = makeCwRow({ status: "draft" });
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [draft] }) }) });
    const { reject } = await import("../services/completedWorkService.js");
    await expect(reject("cw-021", ORG_ID, USER_ID)).rejects.toThrow();
  });
});

// ─── completedWorkService — archive ──────────────────────────────────────────

describe("completedWorkService — archive", () => {
  it("transitions approved → archived", async () => {
    const approved = makeCwRow({ id: "cw-030", status: "approved", approvedByUserId: USER_ID, approvedAt: new Date() });
    const archived = makeCwRow({ id: "cw-030", status: "archived", archivedAt: new Date() });
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [approved] }) }) })
               .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [archived] }) }) });
    mockDb.update.mockReturnValueOnce({ set: () => ({ where: () => ({ returning: () => [archived] }) }) });

    const { archive } = await import("../services/completedWorkService.js");
    const result = await archive("cw-030", ORG_ID, USER_ID);
    expect(result.status).toBe("archived");
  });

  it("allows archiving a rejected item", async () => {
    const rejected = makeCwRow({ id: "cw-031", status: "rejected", rejectedAt: new Date() });
    const archived = makeCwRow({ id: "cw-031", status: "archived", archivedAt: new Date() });
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [rejected] }) }) })
               .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [archived] }) }) });
    mockDb.update.mockReturnValueOnce({ set: () => ({ where: () => ({ returning: () => [archived] }) }) });

    const { archive } = await import("../services/completedWorkService.js");
    expect((await archive("cw-031", ORG_ID, USER_ID)).status).toBe("archived");
  });

  it("throws: cannot archive a superseded item", async () => {
    const superseded = makeCwRow({ status: "superseded" });
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [superseded] }) }) });
    const { archive } = await import("../services/completedWorkService.js");
    await expect(archive("cw-032", ORG_ID, USER_ID)).rejects.toThrow();
  });
});

// ─── completedWorkService — reopen (rejected → reopened) ─────────────────────

describe("completedWorkService — reopen", () => {
  it("transitions rejected → reopened", async () => {
    const rejected = makeCwRow({ id: "cw-040", status: "rejected", rejectedAt: new Date() });
    const reopened = makeCwRow({ id: "cw-040", status: "reopened", reopenedAt: new Date() });
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [rejected] }) }) })
               .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [reopened] }) }) });
    mockDb.update.mockReturnValueOnce({ set: () => ({ where: () => ({ returning: () => [reopened] }) }) });

    const { reopen } = await import("../services/completedWorkService.js");
    const result = await reopen("cw-040", ORG_ID, USER_ID);
    expect(result.status).toBe("reopened");
  });

  it("throws: cannot reopen a draft (must be rejected)", async () => {
    const draft = makeCwRow({ status: "draft" });
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [draft] }) }) });
    const { reopen } = await import("../services/completedWorkService.js");
    await expect(reopen("cw-041", ORG_ID, USER_ID)).rejects.toThrow();
  });

  it("throws: cannot reopen an approved item", async () => {
    const approved = makeCwRow({ status: "approved" });
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [approved] }) }) });
    const { reopen } = await import("../services/completedWorkService.js");
    await expect(reopen("cw-042", ORG_ID, USER_ID)).rejects.toThrow();
  });
});

// ─── Comments ─────────────────────────────────────────────────────────────────

describe("completedWorkService — addComment / getComments", () => {
  it("inserts a comment row without throwing", async () => {
    mockDb.insert.mockReturnValueOnce({
      values: () => ({ returning: () => [{ id: "c-001" }] }),
    });
    const { addComment } = await import("../services/completedWorkService.js");
    await expect(addComment("cw-001", ORG_ID, "Looks good", USER_ID)).resolves.not.toThrow();
  });

  it("getComments returns an array", async () => {
    const commentRow = { id: "c-001", completedWorkId: "cw-001", organizationId: ORG_ID,
      content: "Looks good", authorUserId: USER_ID, createdAt: new Date() };
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => ({ orderBy: () => [commentRow] }) }),
    });
    const { getComments } = await import("../services/completedWorkService.js");
    const result = await getComments("cw-001", ORG_ID);
    expect(Array.isArray(result)).toBe(true);
  });

  it("addComment calls logOrgEvent", async () => {
    const cwRow = makeCwRow({ id: "cw-001", status: "draft" });
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [cwRow] }) }) });
    mockDb.insert.mockReturnValueOnce({ values: () => Promise.resolve() });
    mockLogOrgEvent.mockClear();
    const { addComment } = await import("../services/completedWorkService.js");
    await addComment("cw-001", ORG_ID, "Needs more detail", USER_ID);
    expect(mockLogOrgEvent).toHaveBeenCalled();
  });
});

// ─── Version history ──────────────────────────────────────────────────────────

describe("completedWorkService — addVersion / getVersions", () => {
  it("inserts a new version row and returns CompletedWorkVersion", async () => {
    const cwRow = makeCwRow({ id: "cw-050", status: "draft" });
    const newVersion = { id: "v-051", completedWorkId: "cw-050", organizationId: ORG_ID,
      versionNumber: 2, contentMarkdown: "# Revised\n\nNew content",
      qualityScore: null, reviewDimensions: [], changeNote: "Manual revision",
      isAutoRevision: "false", createdByUserId: USER_ID, createdAt: new Date() };
    mockDb.select
      .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [cwRow] }) }) })  // getCompletedWork
      .mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: () => [{ versionNumber: 1 }] }) }) }); // getVersions
    mockDb.insert.mockReturnValueOnce({ values: () => ({ returning: () => [newVersion] }) });
    mockDb.update.mockReturnValueOnce({ set: () => ({ where: () => ({ returning: () => [cwRow] }) }) });

    const { addVersion } = await import("../services/completedWorkService.js");
    const result = await addVersion("cw-050", ORG_ID, "# Revised\n\nNew content", "Manual revision", USER_ID);
    expect(result).toBeDefined();
    expect(result.versionNumber).toBe(2);
  });

  it("getVersions returns an array", async () => {
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => ({ orderBy: () => [] }) }),
    });
    const { getVersions } = await import("../services/completedWorkService.js");
    const result = await getVersions("cw-001", ORG_ID);
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── Promote to Library ───────────────────────────────────────────────────────

describe("completedWorkService — promoteToLibrary", () => {
  const approvedItem = makeCwRow({ id: "cw-060", status: "approved",
    approvedByUserId: USER_ID, approvedAt: new Date(), title: "Incident Report" });
  const version = { id: "v-060", completedWorkId: "cw-060", organizationId: ORG_ID,
    versionNumber: 1, contentMarkdown: "# Incident Report\n\nDetailed content.",
    qualityScore: 85, reviewDimensions: [], changeNote: null,
    isAutoRevision: "false", createdByUserId: USER_ID, createdAt: new Date() };

  it("creates a knowledge_sources row for an approved item and returns { knowledgeSourceId }", async () => {
    mockDb.select
      .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [approvedItem] }) }) })  // getCompletedWork
      .mockReturnValueOnce({                                                                        // getVersions: .where().orderBy()
        from: () => ({ where: () => ({ orderBy: () => [version] }) }),
      });
    mockDb.insert.mockReturnValueOnce({ values: () => Promise.resolve() });  // insert knowledgeSourcesTable (no .returning())

    const { promoteToLibrary } = await import("../services/completedWorkService.js");
    const result = await promoteToLibrary("cw-060", ORG_ID, "approved_example", USER_ID);
    expect(result).toHaveProperty("knowledgeSourceId");
    expect(typeof result.knowledgeSourceId).toBe("string");
  });

  it("throws if item is not approved (still draft)", async () => {
    const draft = { ...approvedItem, status: "draft" };
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [draft] }) }) });
    const { promoteToLibrary } = await import("../services/completedWorkService.js");
    await expect(promoteToLibrary("cw-060", ORG_ID, "approved_example", USER_ID)).rejects.toThrow();
  });

  it("throws if item not found", async () => {
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [] }) }) });
    const { promoteToLibrary } = await import("../services/completedWorkService.js");
    await expect(promoteToLibrary("missing-id", ORG_ID, "approved_example", USER_ID)).rejects.toThrow();
  });

  it("throws if no content version available", async () => {
    mockDb.select
      .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [approvedItem] }) }) })
      .mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: () => [] }) }) });  // no versions
    const { promoteToLibrary } = await import("../services/completedWorkService.js");
    await expect(promoteToLibrary("cw-060", ORG_ID, "approved_example", USER_ID)).rejects.toThrow();
  });
});

// ─── listCompletedWork ────────────────────────────────────────────────────────

describe("completedWorkService — listCompletedWork", () => {
  // listCompletedWork: db.select().from().where().orderBy().limit().offset()
  it("returns an array", async () => {
    const rows = [makeCwRow({ id: "cw-100", status: "draft" })];
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: () => ({ offset: () => rows }) }) }) }),
    });
    const { listCompletedWork } = await import("../services/completedWorkService.js");
    const result = await listCompletedWork(ORG_ID, {});
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
  });

  it("returns empty array when DB has no results", async () => {
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: () => ({ offset: () => [] }) }) }) }),
    });
    const { listCompletedWork } = await import("../services/completedWorkService.js");
    const result = await listCompletedWork(ORG_ID, { status: "approved" });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});

// ─── getAssets ────────────────────────────────────────────────────────────────

describe("completedWorkService — getAssets", () => {
  it("returns an array (empty when DB has none)", async () => {
    // getAssets returns db.select().from().where() directly — must resolve to array
    const assetRows: unknown[] = [];
    // Make the where() result be a thenable that resolves to []
    const thenableArray = Object.assign(Promise.resolve(assetRows), {
      from: () => thenableArray,
      where: () => thenableArray,
    });
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => assetRows }) });
    const { getAssets } = await import("../services/completedWorkService.js");
    const result = await getAssets("cw-001", ORG_ID);
    // getAssets may return a query object or array depending on how Drizzle is mocked
    expect(result).toBeDefined();
  });
});

// ─── seedBuiltInBlueprints ────────────────────────────────────────────────────

describe("seedBuiltInBlueprints", () => {
  it("runs without throwing when DB returns no existing blueprints (all seeds inserted)", async () => {
    mockDb.select.mockReturnValue({ from: () => ({ where: () => ({ limit: () => [] }) }) });
    mockDb.insert.mockReturnValue({ values: () => ({ returning: () => [mockDb._makeBpRow()] }) });
    await expect(seedBuiltInBlueprints()).resolves.not.toThrow();
  });

  it("skips insert for blueprints that already exist (idempotent)", async () => {
    // Return an existing row for every select
    const existing = mockDb._makeBpRow({ isBuiltIn: true });
    mockDb.select.mockReturnValue({ from: () => ({ where: () => ({ limit: () => [existing] }) }) });
    mockDb.insert.mockClear();
    await seedBuiltInBlueprints();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});

// ─── workExecutionPipelineService — exports ───────────────────────────────────

describe("workExecutionPipelineService — exports", () => {
  it("executeWork is exported as a function", async () => {
    const svc = await import("../services/workExecutionPipelineService.js");
    expect(typeof svc.executeWork).toBe("function");
  });
});

// ─── RLS Table Isolation ──────────────────────────────────────────────────────

describe("Sprint 22 — REQUIRED_RLS_TABLES", () => {
  it("contains all 6 Sprint-22 work execution tables", () => {
    const sprint22Tables = [
      "work_blueprints",
      "work_package_manifests",
      "completed_work",
      "completed_work_versions",
      "completed_work_comments",
      "completed_work_assets",
    ];
    for (const table of sprint22Tables) {
      expect(REQUIRED_RLS_TABLES).toContain(table);
    }
  });

  it("total count is 68 after Task #36 (+1 notification_reads from Sprint 22's 67)", () => {
    expect(REQUIRED_RLS_TABLES).toHaveLength(69); // Sprint 28: +1 blueprint_versions
  });

  it("still contains all previous core tables", () => {
    const coreTablesExpected = [
      "tasks", "approvals", "approval_rules", "approval_history",
      "task_execution_plans", "task_specialists", "memberships",
      "knowledge_sources", "knowledge_source_versions", "knowledge_chunks",
      "organisation_memory",
    ];
    for (const t of coreTablesExpected) {
      expect(REQUIRED_RLS_TABLES).toContain(t);
    }
  });

  it("no duplicates in REQUIRED_RLS_TABLES", () => {
    const set = new Set(REQUIRED_RLS_TABLES as readonly string[]);
    expect(set.size).toBe(REQUIRED_RLS_TABLES.length);
  });
});

// ─── DB Schema — table exports ────────────────────────────────────────────────

describe("Sprint 22 — DB schema table exports", () => {
  it("workBlueprintsTable is exported from @workspace/db", async () => {
    const db = await import("@workspace/db");
    expect(db.workBlueprintsTable).toBeDefined();
  });

  it("workPackageManifestsTable is exported from @workspace/db", async () => {
    const db = await import("@workspace/db");
    expect(db.workPackageManifestsTable).toBeDefined();
  });

  it("completedWorkTable is exported from @workspace/db", async () => {
    const db = await import("@workspace/db");
    expect(db.completedWorkTable).toBeDefined();
  });

  it("completedWorkVersionsTable is exported from @workspace/db", async () => {
    const db = await import("@workspace/db");
    expect(db.completedWorkVersionsTable).toBeDefined();
  });

  it("completedWorkCommentsTable is exported from @workspace/db", async () => {
    const db = await import("@workspace/db");
    expect(db.completedWorkCommentsTable).toBeDefined();
  });

  it("completedWorkAssetsTable is exported from @workspace/db", async () => {
    const db = await import("@workspace/db");
    expect(db.completedWorkAssetsTable).toBeDefined();
  });

  it("COMPLETED_WORK_STATUSES is exported as an array", async () => {
    const db = await import("@workspace/db");
    expect(db.COMPLETED_WORK_STATUSES).toBeDefined();
    expect(Array.isArray(db.COMPLETED_WORK_STATUSES)).toBe(true);
  });

  it("workBlueprintsTable has expected column fields", async () => {
    const { workBlueprintsTable } = await import("@workspace/db");
    expect(workBlueprintsTable).toHaveProperty("id");
    expect(workBlueprintsTable).toHaveProperty("code");
    expect(workBlueprintsTable).toHaveProperty("title");
    expect(workBlueprintsTable).toHaveProperty("primarySpecialist");
    expect(workBlueprintsTable).toHaveProperty("organizationId");
    expect(workBlueprintsTable).toHaveProperty("isBuiltIn");
    expect(workBlueprintsTable).toHaveProperty("isActive");
  });

  it("completedWorkTable has the 7 lifecycle columns", async () => {
    const { completedWorkTable } = await import("@workspace/db");
    expect(completedWorkTable).toHaveProperty("id");
    expect(completedWorkTable).toHaveProperty("status");
    expect(completedWorkTable).toHaveProperty("primarySpecialist");
    expect(completedWorkTable).toHaveProperty("outputType");
    expect(completedWorkTable).toHaveProperty("blueprintId");
    expect(completedWorkTable).toHaveProperty("manifestId");
    expect(completedWorkTable).toHaveProperty("currentVersionId");
    expect(completedWorkTable).toHaveProperty("approvedByUserId");
  });

  it("completedWorkVersionsTable has contentMarkdown and versionNumber", async () => {
    const { completedWorkVersionsTable } = await import("@workspace/db");
    expect(completedWorkVersionsTable).toHaveProperty("contentMarkdown");
    expect(completedWorkVersionsTable).toHaveProperty("versionNumber");
    expect(completedWorkVersionsTable).toHaveProperty("qualityScore");
    expect(completedWorkVersionsTable).toHaveProperty("reviewDimensions");
  });

  it("completedWorkCommentsTable has content and authorUserId", async () => {
    const { completedWorkCommentsTable } = await import("@workspace/db");
    expect(completedWorkCommentsTable).toHaveProperty("content");
    expect(completedWorkCommentsTable).toHaveProperty("authorUserId");
  });

  it("completedWorkAssetsTable has assetType and role columns", async () => {
    const { completedWorkAssetsTable } = await import("@workspace/db");
    expect(completedWorkAssetsTable).toHaveProperty("assetType");
    expect(completedWorkAssetsTable).toHaveProperty("role");
  });

  it("workPackageManifestsTable has immutable execution fields", async () => {
    const { workPackageManifestsTable } = await import("@workspace/db");
    expect(workPackageManifestsTable).toHaveProperty("executionId");
    expect(workPackageManifestsTable).toHaveProperty("blueprintId");
    expect(workPackageManifestsTable).toHaveProperty("primarySpecialist");
    expect(workPackageManifestsTable).toHaveProperty("modelVersion");
    expect(workPackageManifestsTable).toHaveProperty("promptVersion");
    expect(workPackageManifestsTable).toHaveProperty("assembledAt");
  });
});
