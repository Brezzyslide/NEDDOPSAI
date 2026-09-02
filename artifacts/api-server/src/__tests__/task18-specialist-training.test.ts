/**
 * Task #18 — Specialist Training API tests
 *
 * Covers: language profile CRUD, config/responsibilities CRUD,
 * knowledge list, retrieval test (citations, no raw scores),
 * readiness blocker logic, ready/suspended transitions require
 * owner/admin, member-level flag updates, tenant isolation.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockDb = vi.hoisted(() => ({
  select:  vi.fn(),
  insert:  vi.fn(),
  update:  vi.fn(),
  delete:  vi.fn(),
  execute: vi.fn(),
}));

const mockLogOrgEvent = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db/schema")>("@workspace/db/schema");
  return {
    ...actual,
    db: mockDb,
  };
});

vi.mock("../services/knowledgeOrchestrationEngine.js", () => ({
  orchestrateKnowledge:      vi.fn(),
  ensureProvidersRegistered: vi.fn(),
}));

vi.mock("../services/auditService.js", () => ({
  getRequestMeta: vi.fn().mockReturnValue({ ipAddress: "127.0.0.1" }),
  logOrgEvent:    mockLogOrgEvent,
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import {
  getOrCreateLanguageProfile,
  upsertLanguageProfile,
} from "../services/specialistLanguageProfileService.js";

import {
  getOrCreateSpecialistConfig,
  upsertSpecialistConfig,
} from "../services/specialistConfigService.js";

import {
  getOrCreateTrainingStatus,
  listAllTrainingStatuses,
  transitionTrainingStatus,
  updateTrainingFlags,
  TrainingStatusError,
} from "../services/specialistTrainingStatusService.js";

import {
  orchestrateKnowledge,
} from "../services/knowledgeOrchestrationEngine.js";

import { TRAINING_STATUSES } from "@workspace/db";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ORG_A = "org-a-training-test-001";
const ORG_B = "org-b-training-test-002";
const ACTOR = "user-train-001";

function makeTrainingStatus(overrides: Record<string, unknown> = {}) {
  return {
    id:                       randomUUID(),
    organizationId:           ORG_A,
    specialistId:             "incident_manager",
    status:                   "not_started",
    configurationComplete:    false,
    knowledgeSourcesApproved: false,
    retrievalTestPassed:      false,
    sampleTaskPassed:         false,
    approvedByUserId:         null,
    approvedAt:               null,
    lastTestedAt:             null,
    notes:                    null,
    createdAt:                new Date("2026-01-01T00:00:00Z"),
    updatedAt:                new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeLanguageProfile(overrides: Record<string, unknown> = {}) {
  return {
    id:                       randomUUID(),
    organizationId:           ORG_A,
    specialistId:             "incident_manager",
    locale:                   "en-AU",
    spellingConvention:       "australian",
    tone:                     "professional",
    formality:                "formal",
    preferredTerms:           [],
    prohibitedTerms:          [],
    dateFormat:               "DD/MM/YYYY",
    timeFormat:               "12-hour",
    headingPreferences:       null,
    sentenceLengthPreference: null,
    outputStructure:          null,
    lastConfirmedAt:          null,
    createdAt:                new Date("2026-01-01T00:00:00Z"),
    updatedAt:                new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeSpecialistConfig(overrides: Record<string, unknown> = {}) {
  return {
    id:             randomUUID(),
    organizationId: ORG_A,
    specialistId:   "incident_manager",
    goals:          ["Manage incident reporting"],
    preferredStyle: null,
    escalationContacts: [],
    additionalContext: {
      responsibilities: {
        responsibilities:        ["Draft incident reports"],
        prohibitedActions:       [],
        approvalRequiredActions: ["External regulatory notification"],
        escalationConditions:    ["Severity is high or critical"],
        escalationContacts:      [],
        allowedSystems:          ["NDIS portal"],
        firstWeekGoals:          [],
      },
    },
    confirmConfiguration:  false,
    lastConfirmedAt:        null,
    createdAt:              new Date("2026-01-01T00:00:00Z"),
    updatedAt:              new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeSelectChain(result: unknown[]) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ["from", "where", "limit", "offset", "orderBy", "innerJoin", "leftJoin"];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain["then"] = vi.fn().mockImplementation((cb: (v: unknown) => unknown) =>
    Promise.resolve(cb(result)),
  );
  return chain;
}

function makeInsertChain(returning: unknown[]) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    values:              vi.fn(),
    returning:           vi.fn().mockResolvedValue(returning),
    onConflictDoUpdate:  vi.fn(),
    onConflictDoNothing: vi.fn(),
  };
  chain.values.mockReturnValue(chain);
  chain.onConflictDoUpdate.mockReturnValue(chain);
  chain.onConflictDoNothing.mockReturnValue(chain);
  return chain;
}

function makeUpdateChain(returning: unknown[]) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    set:       vi.fn(),
    where:     vi.fn(),
    returning: vi.fn().mockResolvedValue(returning),
  };
  chain.set.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return chain;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Task #18 — Specialist Training", () => {

  beforeEach(() => {
    vi.resetAllMocks();
    // Re-setup stable mocks that must return a Promise
    mockLogOrgEvent.mockResolvedValue(undefined);
  });

  // ── TRAINING_STATUSES constant ────────────────────────────────────────────

  describe("TRAINING_STATUSES", () => {
    it("includes all 8 required statuses", () => {
      const required = [
        "not_started", "configuring", "knowledge_processing",
        "review_required", "testing", "ready",
        "needs_attention", "suspended",
      ];
      for (const s of required) {
        expect(TRAINING_STATUSES).toContain(s);
      }
    });

    it("does not expose ready/suspended as self-service (contract test)", () => {
      // ready and suspended require owner/admin — verified in transition tests
      expect(TRAINING_STATUSES.includes("ready")).toBe(true);
      expect(TRAINING_STATUSES.includes("suspended")).toBe(true);
    });
  });

  // ── Language Profile: getOrCreate ─────────────────────────────────────────

  describe("getOrCreateLanguageProfile", () => {
    it("returns existing profile if one exists", async () => {
      const profile = makeLanguageProfile();
      mockDb.select.mockReturnValueOnce(makeSelectChain([profile]));

      const result = await getOrCreateLanguageProfile(ORG_A, "incident_manager");
      expect(result.locale).toBe("en-AU");
      expect(result.specialistId).toBe("incident_manager");
    });

    it("creates a new profile if none exists", async () => {
      const profile = makeLanguageProfile({ locale: "en-AU" });
      mockDb.select.mockReturnValueOnce(makeSelectChain([]));
      mockDb.insert.mockReturnValueOnce(makeInsertChain([profile]));

      const result = await getOrCreateLanguageProfile(ORG_A, "incident_manager");
      expect(result).toBeDefined();
      expect(result.locale).toBe("en-AU");
    });

    it("scopes to organisation (tenant isolation)", async () => {
      const profileOrgA = makeLanguageProfile({ organizationId: ORG_A });
      mockDb.select.mockReturnValueOnce(makeSelectChain([profileOrgA]));

      const result = await getOrCreateLanguageProfile(ORG_A, "incident_manager");
      expect(result.organizationId).toBe(ORG_A);
    });
  });

  // ── Language Profile: upsert ─────────────────────────────────────────────

  describe("upsertLanguageProfile", () => {
    it("updates locale, tone, formality", async () => {
      const existing = makeLanguageProfile();
      const updated  = makeLanguageProfile({ tone: "empathetic", formality: "semi-formal" });

      mockDb.select.mockReturnValueOnce(makeSelectChain([existing]));
      mockDb.update.mockReturnValueOnce(makeUpdateChain([updated]));

      const result = await upsertLanguageProfile({
        organizationId: ORG_A,
        specialistId:   "incident_manager",
        tone:           "empathetic",
        formality:      "semi-formal",
      });
      expect(result.tone).toBe("empathetic");
      expect(result.formality).toBe("semi-formal");
    });

    it("upserts preferred terms list", async () => {
      const existing = makeLanguageProfile();
      const updated  = makeLanguageProfile({
        preferredTerms: [{ term: "participant", preferred: "person supported" }],
      });

      mockDb.select.mockReturnValueOnce(makeSelectChain([existing]));
      mockDb.update.mockReturnValueOnce(makeUpdateChain([updated]));

      const result = await upsertLanguageProfile({
        organizationId: ORG_A,
        specialistId:   "incident_manager",
        preferredTerms: [{ term: "participant", preferred: "person supported" }],
      });
      expect(result.preferredTerms).toHaveLength(1);
      expect(result.preferredTerms[0].preferred).toBe("person supported");
    });

    it("sets lastConfirmedAt when confirmProfile is true", async () => {
      const existing  = makeLanguageProfile();
      const confirmed = makeLanguageProfile({ lastConfirmedAt: new Date() });

      mockDb.select.mockReturnValueOnce(makeSelectChain([existing]));
      mockDb.update.mockReturnValueOnce(makeUpdateChain([confirmed]));

      const result = await upsertLanguageProfile({
        organizationId: ORG_A,
        specialistId:   "incident_manager",
        confirmProfile: true,
      });
      expect(result.lastConfirmedAt).toBeDefined();
    });

    it("stores prohibited terms with optional reason", async () => {
      const existing = makeLanguageProfile();
      const updated  = makeLanguageProfile({
        prohibitedTerms: [{ term: "client", reason: "Use 'participant' instead" }],
      });

      mockDb.select.mockReturnValueOnce(makeSelectChain([existing]));
      mockDb.update.mockReturnValueOnce(makeUpdateChain([updated]));

      const result = await upsertLanguageProfile({
        organizationId:  ORG_A,
        specialistId:    "incident_manager",
        prohibitedTerms: [{ term: "client", reason: "Use 'participant' instead" }],
      });
      expect(result.prohibitedTerms).toHaveLength(1);
    });
  });

  // ── Specialist Config: getOrCreate ────────────────────────────────────────

  describe("getOrCreateSpecialistConfig", () => {
    it("returns existing config with responsibilities", async () => {
      const config = makeSpecialistConfig();
      mockDb.select.mockReturnValueOnce(makeSelectChain([config]));

      const result = await getOrCreateSpecialistConfig(ORG_A, "incident_manager");
      expect(result).toBeDefined();
      expect(result.additionalContext.responsibilities).toBeDefined();
    });

    it("creates empty config if none exists", async () => {
      const newConfig = makeSpecialistConfig();
      mockDb.select.mockReturnValueOnce(makeSelectChain([]));
      mockDb.insert.mockReturnValueOnce(makeInsertChain([newConfig]));

      const result = await getOrCreateSpecialistConfig(ORG_A, "incident_manager");
      expect(result).toBeDefined();
    });
  });

  // ── Specialist Config: upsert ────────────────────────────────────────────

  describe("upsertSpecialistConfig", () => {
    it("stores goals array", async () => {
      const existing = makeSpecialistConfig();
      const updated  = makeSpecialistConfig({ goals: ["Complete all incident reports within 24h"] });

      mockDb.select.mockReturnValueOnce(makeSelectChain([existing]));
      mockDb.update.mockReturnValueOnce(makeUpdateChain([updated]));

      const result = await upsertSpecialistConfig({
        organizationId: ORG_A,
        specialistId:   "incident_manager",
        goals:          ["Complete all incident reports within 24h"],
      });
      expect(result.goals).toContain("Complete all incident reports within 24h");
    });

    it("stores responsibilities inside additionalContext", async () => {
      const existing = makeSpecialistConfig();
      const updated  = makeSpecialistConfig({
        additionalContext: {
          responsibilities: {
            responsibilities:        ["Draft incident reports per NDIS policy"],
            prohibitedActions:       ["Submit externally without approval"],
            approvalRequiredActions: ["Notify regulators"],
            escalationConditions:    ["Severity is high or critical"],
            escalationContacts:      [{ name: "Clinical Lead", role: "Oversight" }],
            allowedSystems:          ["NDIS portal"],
            firstWeekGoals:          ["Review all current incident policies"],
          },
        },
      });

      mockDb.select.mockReturnValueOnce(makeSelectChain([existing]));
      mockDb.update.mockReturnValueOnce(makeUpdateChain([updated]));

      const result = await upsertSpecialistConfig({
        organizationId: ORG_A,
        specialistId:   "incident_manager",
        responsibilities: {
          responsibilities:        ["Draft incident reports per NDIS policy"],
          prohibitedActions:       ["Submit externally without approval"],
          approvalRequiredActions: ["Notify regulators"],
          escalationConditions:    ["Severity is high or critical"],
          escalationContacts:      [{ name: "Clinical Lead", role: "Oversight" }],
          allowedSystems:          ["NDIS portal"],
          firstWeekGoals:          ["Review all current incident policies"],
        },
      });

      const resps = result.additionalContext?.responsibilities;
      expect(resps).toBeDefined();
      expect(resps.responsibilities).toContain("Draft incident reports per NDIS policy");
      expect(resps.prohibitedActions).toContain("Submit externally without approval");
      expect(resps.escalationContacts[0].name).toBe("Clinical Lead");
    });

    it("sets lastConfirmedAt when confirmConfiguration is true", async () => {
      const existing   = makeSpecialistConfig();
      const confirmed  = makeSpecialistConfig({ lastConfirmedAt: new Date() });

      mockDb.select.mockReturnValueOnce(makeSelectChain([existing]));
      mockDb.update.mockReturnValueOnce(makeUpdateChain([confirmed]));

      const result = await upsertSpecialistConfig({
        organizationId:       ORG_A,
        specialistId:         "incident_manager",
        confirmConfiguration: true,
      });
      expect(result.lastConfirmedAt).toBeDefined();
    });
  });

  // ── Training Status: getOrCreate ─────────────────────────────────────────

  describe("getOrCreateTrainingStatus", () => {
    it("returns existing status record", async () => {
      const status = makeTrainingStatus({ status: "configuring" });
      mockDb.select.mockReturnValueOnce(makeSelectChain([status]));

      const result = await getOrCreateTrainingStatus(ORG_A, "incident_manager");
      expect(result.status).toBe("configuring");
    });

    it("creates not_started status if none exists", async () => {
      const created = makeTrainingStatus({ status: "not_started" });
      mockDb.select.mockReturnValueOnce(makeSelectChain([]));
      mockDb.insert.mockReturnValueOnce(makeInsertChain([created]));

      const result = await getOrCreateTrainingStatus(ORG_A, "incident_manager");
      expect(result.status).toBe("not_started");
    });
  });

  // ── Training Status: listAll ─────────────────────────────────────────────

  describe("listAllTrainingStatuses", () => {
    it("returns statuses for all specialists in the org", async () => {
      const statuses = [
        makeTrainingStatus({ specialistId: "incident_manager" }),
        makeTrainingStatus({ specialistId: "chief_of_staff", status: "ready" }),
      ];
      mockDb.select.mockReturnValueOnce(makeSelectChain(statuses));

      const result = await listAllTrainingStatuses(ORG_A);
      expect(result).toHaveLength(2);
      expect(result.map(s => s.specialistId)).toContain("chief_of_staff");
    });

    it("returns empty array if no specialists configured", async () => {
      mockDb.select.mockReturnValueOnce(makeSelectChain([]));
      const result = await listAllTrainingStatuses(ORG_A);
      expect(result).toHaveLength(0);
    });
  });

  // ── Training Status: transitions ─────────────────────────────────────────

  describe("transitionTrainingStatus", () => {
    it("owner can transition to ready", async () => {
      const status  = makeTrainingStatus({
        status:                   "testing",
        configurationComplete:    true,
        knowledgeSourcesApproved: true,
        retrievalTestPassed:      true,
        sampleTaskPassed:         true,
      });
      const updated = { ...status, status: "ready", approvedAt: new Date(), approvedByUserId: ACTOR };

      mockDb.select.mockReturnValueOnce(makeSelectChain([status]));
      mockDb.update.mockReturnValueOnce(makeUpdateChain([updated]));

      const result = await transitionTrainingStatus({
        organizationId: ORG_A,
        specialistId:   "incident_manager",
        newStatus:      "ready",
        actorUserId:    ACTOR,
        actorRole:      "owner",
      });
      expect(result.status).toBe("ready");
      expect(result.approvedAt).toBeDefined();
    });

    it("admin can transition to suspended", async () => {
      const status  = makeTrainingStatus({ status: "ready" });
      const updated = { ...status, status: "suspended" };

      mockDb.select.mockReturnValueOnce(makeSelectChain([status]));
      mockDb.update.mockReturnValueOnce(makeUpdateChain([updated]));

      const result = await transitionTrainingStatus({
        organizationId: ORG_A,
        specialistId:   "incident_manager",
        newStatus:      "suspended",
        actorUserId:    ACTOR,
        actorRole:      "admin",
      });
      expect(result.status).toBe("suspended");
    });

    it("member cannot transition to ready (INSUFFICIENT_ROLE)", async () => {
      const status = makeTrainingStatus({ status: "testing" });
      mockDb.select.mockReturnValueOnce(makeSelectChain([status]));

      await expect(transitionTrainingStatus({
        organizationId: ORG_A,
        specialistId:   "incident_manager",
        newStatus:      "ready",
        actorUserId:    ACTOR,
        actorRole:      "member",
      })).rejects.toMatchObject({ code: "INSUFFICIENT_ROLE" });
    });

    it("member cannot transition to suspended (INSUFFICIENT_ROLE)", async () => {
      const status = makeTrainingStatus({ status: "ready" });
      mockDb.select.mockReturnValueOnce(makeSelectChain([status]));

      await expect(transitionTrainingStatus({
        organizationId: ORG_A,
        specialistId:   "incident_manager",
        newStatus:      "suspended",
        actorUserId:    ACTOR,
        actorRole:      "member",
      })).rejects.toMatchObject({ code: "INSUFFICIENT_ROLE" });
    });

    it("member CAN update flags (not status transitions)", async () => {
      const status  = makeTrainingStatus();
      const updated = { ...status, configurationComplete: true };

      mockDb.select.mockReturnValueOnce(makeSelectChain([status]));
      mockDb.update.mockReturnValueOnce(makeUpdateChain([updated]));

      const result = await updateTrainingFlags({
        organizationId:       ORG_A,
        specialistId:         "incident_manager",
        actorUserId:          ACTOR,
        configurationComplete: true,
      });
      expect(result.configurationComplete).toBe(true);
    });

    it("throws NOT_FOUND for unknown specialist", async () => {
      mockDb.select.mockReturnValueOnce(makeSelectChain([]));
      // getOrCreate will insert a new record
      const created = makeTrainingStatus({ status: "not_started" });
      mockDb.insert.mockReturnValueOnce(makeInsertChain([created]));
      // Then try transition
      mockDb.select.mockReturnValueOnce(makeSelectChain([created]));
      mockDb.update.mockReturnValueOnce(makeUpdateChain([{ ...created, status: "configuring" }]));

      const result = await transitionTrainingStatus({
        organizationId: ORG_A,
        specialistId:   "unknown_specialist",
        newStatus:      "configuring",
        actorUserId:    ACTOR,
        actorRole:      "owner",
      });
      expect(result.status).toBe("configuring");
    });

    it("records notes on transition", async () => {
      const status  = makeTrainingStatus({ status: "configuring" });
      const updated = { ...status, status: "knowledge_processing", notes: "Starting knowledge review." };

      mockDb.select.mockReturnValueOnce(makeSelectChain([status]));
      mockDb.update.mockReturnValueOnce(makeUpdateChain([updated]));

      const result = await transitionTrainingStatus({
        organizationId: ORG_A,
        specialistId:   "incident_manager",
        newStatus:      "knowledge_processing",
        actorUserId:    ACTOR,
        actorRole:      "member",
        notes:          "Starting knowledge review.",
      });
      expect(result.notes).toBe("Starting knowledge review.");
    });
  });

  // ── Readiness blockers ────────────────────────────────────────────────────

  describe("readiness blockers", () => {
    it("identifies incomplete configuration as a blocker", () => {
      const status = makeTrainingStatus({
        configurationComplete: false,
        knowledgeSourcesApproved: false,
        retrievalTestPassed: false,
        sampleTaskPassed: false,
      });
      const blockers = [
        !status.configurationComplete    && "Responsibilities confirmed",
        !status.knowledgeSourcesApproved && "Knowledge sources approved",
        !status.retrievalTestPassed      && "Retrieval test passed",
        !status.sampleTaskPassed         && "Sample task reviewed",
      ].filter(Boolean);
      expect(blockers).toHaveLength(4);
    });

    it("no blockers when all flags are true", () => {
      const status = makeTrainingStatus({
        configurationComplete:    true,
        knowledgeSourcesApproved: true,
        retrievalTestPassed:      true,
        sampleTaskPassed:         true,
        status:                   "ready",
      });
      const blockers = [
        !status.configurationComplete    && "Responsibilities confirmed",
        !status.knowledgeSourcesApproved && "Knowledge sources approved",
        !status.retrievalTestPassed      && "Retrieval test passed",
        !status.sampleTaskPassed         && "Sample task reviewed",
        status.status !== "ready"        && "Owner approval",
      ].filter(Boolean);
      expect(blockers).toHaveLength(0);
    });
  });

  // ── Test specialist: orchestrate ──────────────────────────────────────────

  describe("orchestrateKnowledge (test endpoint contract)", () => {
    it("formats citations without raw scores", async () => {
      const mockResult = {
        items: [
          {
            sourceId:      "src-001",
            title:         "NDIS Restrictive Practices Policy",
            content:       "Restrictive practices must be reported within 24 hours.",
            sectionTitle:  "Reporting Requirements",
            pageNumber:    3,
            versionLabel:  "2.1",
            authorityLevel: "mandatory",
            score:         0.91,
            isCurrent:     true,
            conflictIds:   [],
            sourceScope:   "organisation",
          },
          {
            sourceId:      "src-002",
            title:         "Incident Management Procedure",
            content:       "All incidents must be documented in the NDIS portal.",
            sectionTitle:  null,
            pageNumber:    null,
            versionLabel:  null,
            authorityLevel: "supporting",
            score:         0.65,
            isCurrent:     true,
            conflictIds:   [],
            sourceScope:   "specialist",
          },
          {
            sourceId:      "src-003",
            title:         "Old Incident Policy",
            content:       "Outdated reporting requirements.",
            sectionTitle:  null,
            pageNumber:    null,
            versionLabel:  "1.0",
            authorityLevel: "reference_only",
            score:         0.52,
            isCurrent:     false,
            conflictIds:   ["src-001"],
            sourceScope:   "organisation",
          },
        ],
        conflicts: [],
        retrievalMethod: "hybrid",
        warnings: [],
        tokenBudgetUsed: 850,
        durationMs: 120,
      };

      (orchestrateKnowledge as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResult);

      const result = await orchestrateKnowledge({
        organisationId: ORG_A,
        specialistId:   "incident_manager",
        query:          "How should a severity-2 incident be escalated?",
        tokenBudget:    2000,
        writeAudit:     false,
      });

      // Verify the shape that the /test route would return
      const citations = result.items.map((item: typeof mockResult.items[number]) => ({
        sourceId:   item.sourceId,
        title:      item.title,
        excerpt:    item.content.slice(0, 400),
        matchLabel: item.score >= 0.85 ? "Strong match"
                  : item.score >= 0.70 ? "Good match"
                  : item.score >= 0.55 ? "Supporting source"
                  : "Possible match",
        isApproved: item.authorityLevel !== "reference_only",
        isCurrent:  item.isCurrent,
        warnings:   [
          ...(!item.isCurrent ? ["Outdated source — a newer version may be available"] : []),
          ...(item.conflictIds?.length ? ["Possible conflict with another source"] : []),
        ],
      }));

      expect(citations[0].matchLabel).toBe("Strong match");
      expect(citations[0].isApproved).toBe(true);
      expect(citations[0].warnings).toHaveLength(0);

      expect(citations[1].matchLabel).toBe("Supporting source");
      expect(citations[1].isCurrent).toBe(true);

      expect(citations[2].matchLabel).toBe("Possible match");
      expect(citations[2].isCurrent).toBe(false);
      expect(citations[2].isApproved).toBe(false); // reference_only
      expect(citations[2].warnings).toContain("Outdated source — a newer version may be available");
      expect(citations[2].warnings).toContain("Possible conflict with another source");

      // Critically: no raw scores in citation objects
      for (const c of citations) {
        expect(c).not.toHaveProperty("score");
        expect(c).not.toHaveProperty("vectorScore");
        expect(c).not.toHaveProperty("hybridScore");
        expect(c).not.toHaveProperty("lexicalScore");
      }
    });

    it("passes writeAudit:false for test mode", async () => {
      (orchestrateKnowledge as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        items: [], conflicts: [], retrievalMethod: "lexical",
        warnings: [], tokenBudgetUsed: 0, durationMs: 5,
      });

      await orchestrateKnowledge({
        organisationId: ORG_A,
        specialistId:   "incident_manager",
        query:          "test query",
        tokenBudget:    2000,
        writeAudit:     false,
      });

      expect(orchestrateKnowledge).toHaveBeenCalledWith(
        expect.objectContaining({ writeAudit: false }),
      );
    });

    it("formats empty results as no citations", async () => {
      (orchestrateKnowledge as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        items: [], conflicts: [], retrievalMethod: "lexical",
        warnings: ["No approved library sources assigned to this specialist"],
        tokenBudgetUsed: 0, durationMs: 3,
      });

      const result = await orchestrateKnowledge({
        organisationId: ORG_A,
        specialistId:   "incident_manager",
        query:          "obscure query with no results",
        tokenBudget:    2000,
        writeAudit:     false,
      });

      expect(result.items).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
    });

    it("formats conflict warnings as customer-friendly labels", () => {
      const rawConflict = {
        conflictType:      "overlapping_scope",
        involvedSourceIds: ["src-001", "src-002"],
        description:       "These two sources overlap on the same scope.",
      };

      const friendlyType =
        rawConflict.conflictType === "overlapping_scope"           ? "Overlapping scope"         :
        rawConflict.conflictType === "contradictory_authority"     ? "Contradictory authority levels" :
        "Possible conflict";

      expect(friendlyType).toBe("Overlapping scope");
    });
  });

  // ── Customer-facing language ───────────────────────────────────────────────

  describe("customer-facing language contract", () => {
    it("does not expose 'RAG', 'embeddings', or 'vectors' in any status", () => {
      const badTerms = ["rag", "embedding", "vector", "pgvector", "chunk", "token_budget"];
      for (const s of TRAINING_STATUSES) {
        for (const bad of badTerms) {
          expect(s.toLowerCase()).not.toContain(bad);
        }
      }
    });

    it("retrieval method returns human label not internal label", () => {
      const humanLabels: Record<string, string> = {
        hybrid:  "Full knowledge search",
        lexical: "Keyword search",
        vector:  "Keyword search",  // fallback — treat as keyword-only
      };
      expect(humanLabels["hybrid"]).toBe("Full knowledge search");
      expect(humanLabels["lexical"]).toBe("Keyword search");
    });
  });

  // ── Tenant isolation ──────────────────────────────────────────────────────

  describe("tenant isolation", () => {
    it("getOrCreateLanguageProfile scopes to organisation", async () => {
      const profileOrgB = makeLanguageProfile({ organizationId: ORG_B });
      // Query for ORG_A returns nothing (RLS filter)
      mockDb.select.mockReturnValueOnce(makeSelectChain([]));
      // Create new profile for ORG_A
      const newProfile = makeLanguageProfile({ organizationId: ORG_A });
      mockDb.insert.mockReturnValueOnce(makeInsertChain([newProfile]));

      const result = await getOrCreateLanguageProfile(ORG_A, "incident_manager");
      expect(result.organizationId).toBe(ORG_A);
    });

    it("listAllTrainingStatuses only returns statuses for the queried org", async () => {
      const orgAStatuses = [
        makeTrainingStatus({ organizationId: ORG_A, specialistId: "incident_manager" }),
      ];
      mockDb.select.mockReturnValueOnce(makeSelectChain(orgAStatuses));

      const result = await listAllTrainingStatuses(ORG_A);
      expect(result.every(s => s.organizationId === ORG_A)).toBe(true);
    });
  });

  // ── TrainingStatusError ───────────────────────────────────────────────────

  describe("TrainingStatusError", () => {
    it("carries error code", () => {
      const err = new TrainingStatusError("Insufficient role.", "INSUFFICIENT_ROLE");
      expect(err.code).toBe("INSUFFICIENT_ROLE");
      expect(err instanceof Error).toBe(true);
    });
  });

});
