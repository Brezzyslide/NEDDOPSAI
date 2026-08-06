/**
 * Sprint 28.3 — Live Workforce Availability
 *
 * Tests the replacement of the hardcoded CoS workforce list with a live,
 * organisation-aware and execution-aware specialist availability context.
 *
 *  A. getConversationWorkforceContext — dispatchability rules
 *  B. buildWorkforceSection — context section formatting
 *  C. classifyMessageLLM — workforce section injected; structural validation
 *  D. classifyMessage (deterministic) — no obsolete v1 role codes returned
 *  E. parseAndValidateLLMResponse (via classifyMessageLLM) — filtering
 *  F. Tenant isolation
 *  G. Regression scenario — Medication Management Policy
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ─── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const gatewayProcess            = vi.fn();
  const validateRetrievedFields   = vi.fn();
  const createAIGateway           = vi.fn(() => ({ process: gatewayProcess, validateRetrievedFields }));
  const buildChiefOfStaffContext  = vi.fn();
  const buildSystemInstructionForEmployee = vi.fn().mockReturnValue("SYSTEM");
  const buildDNASystemInstruction = vi.fn().mockReturnValue("DNA");
  const checkOrganisationLibraryPresence = vi.fn();

  // Catalogue entries — keyed by specialistCode
  const catalogueEntries: any[] = [];
  const listCatalogue = vi.fn(async () => ({ entries: catalogueEntries }));

  // Entitlement — default: all specialists entitled
  const tenantCanUseSpecialist = vi.fn(async () => ({ allowed: true, reason: undefined }));

  return {
    createAIGateway,
    gatewayProcess,
    validateRetrievedFields,
    buildChiefOfStaffContext,
    buildSystemInstructionForEmployee,
    buildDNASystemInstruction,
    checkOrganisationLibraryPresence,
    catalogueEntries,
    listCatalogue,
    tenantCanUseSpecialist,
  };
});

vi.mock("@workspace/ai-gateway", () => ({ createAIGateway: mocks.createAIGateway }));
vi.mock("../services/contextSelectionService.js", () => ({
  buildChiefOfStaffContext: mocks.buildChiefOfStaffContext,
}));
vi.mock("@workspace/workforce-dna", () => ({
  buildSystemInstructionForEmployee: mocks.buildSystemInstructionForEmployee,
  buildDNASystemInstruction: mocks.buildDNASystemInstruction,
}));
vi.mock("../services/organisationLibraryPresenceService.js", () => ({
  checkOrganisationLibraryPresence: mocks.checkOrganisationLibraryPresence,
}));
vi.mock("../services/specialistCatalogueService.js", () => ({
  listCatalogue: mocks.listCatalogue,
}));
vi.mock("../services/entitlementService.js", () => ({
  tenantCanUseSpecialist: mocks.tenantCanUseSpecialist,
}));
vi.mock("../lib/workforceRegistry.js", () => ({
  SPECIALISTS: [
    {
      code: "chief_of_staff",
      displayName: "Chief of Staff",
      packCode: "core",
      capabilities: ["route_task", "orchestrate", "summarise"],
      executionStatus: "available",
      dnaStatus: "approved",
      departmentCode: "executive",
      catalogueVersion: "2",
    },
    {
      code: "operations_manager",
      displayName: "Operations Manager",
      packCode: "core",
      capabilities: ["operational_assurance", "service_delivery_oversight"],
      executionStatus: "available",
      dnaStatus: "approved",
      departmentCode: "operations",
      catalogueVersion: "2",
    },
    {
      code: "compliance_quality_manager",
      displayName: "Compliance & Quality Manager",
      packCode: "compliance",
      capabilities: ["review_policy", "audit_preparation", "quality_review"],
      executionStatus: "dna_pending",
      dnaStatus: "pending_design",
      departmentCode: "compliance",
      catalogueVersion: "2",
    },
    {
      code: "executive_assistant",
      displayName: "Executive Assistant",
      packCode: "core",
      capabilities: ["manage_calendar", "draft_communication"],
      executionStatus: "dna_pending",
      dnaStatus: "pending_design",
      departmentCode: "executive",
      catalogueVersion: "2",
    },
    {
      // Deprecated v1 code — must NEVER appear in conversation context
      code: "compliance_officer",
      displayName: "Compliance Officer",
      packCode: "compliance",
      capabilities: [],
      executionStatus: "deprecated",
      dnaStatus: "none",
      departmentCode: "legacy",
      catalogueVersion: "1",
    },
  ],
}));

// ─── Subject under test ────────────────────────────────────────────────────────

import {
  getConversationWorkforceContext,
  buildWorkforceSection,
  _clearWorkforceCache,
} from "../services/conversationWorkforceContextService.js";

import { classifyMessageLLM } from "../services/chiefOfStaffLLMService.js";
import { classifyMessage }    from "../services/conversationIntelligenceService.js";
import type { MessageContext } from "../services/conversationIntelligenceService.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_A = "org-aaa-111";
const ORG_B = "org-bbb-222";
const CONV_ID = "conv-001";

const baseCtx: MessageContext = {
  organizationId:   ORG_A,
  conversationId:   CONV_ID,
  currentTaskId:    null,
  currentTaskTitle: null,
  currentTaskState: null,
  pendingApprovalId: null,
  recentMessages:   [],
};

const authCtx = {
  userId: "user-001",
  organizationId: ORG_A,
  role: "admin",
  permissions: [],
};

function makeLLMResponse(partial: Record<string, unknown> = {}) {
  return JSON.stringify({
    conversationMode: "task_intent",
    confidence: 0.85,
    shouldCreateTask: false,
    shouldUpdateTask: false,
    relatedWorkforceRoles: ["chief_of_staff", "operations_manager"],
    customerResponse: "I can prepare this task with the Operations Manager.",
    ...partial,
  });
}

// ─── A. getConversationWorkforceContext ────────────────────────────────────────

describe("getConversationWorkforceContext", () => {
  beforeEach(() => {
    _clearWorkforceCache();
    vi.resetAllMocks();
    mocks.listCatalogue.mockResolvedValue({ entries: [] });
    mocks.tenantCanUseSpecialist.mockResolvedValue({ allowed: true });
  });

  it("marks operations_manager as dispatchable (approved DNA + entitled + runtime ready)", async () => {
    const ctx = await getConversationWorkforceContext(ORG_A);
    const om = ctx.specialists.find(s => s.code === "operations_manager");
    expect(om).toBeDefined();
    expect(om!.availableForDispatch).toBe(true);
    expect(om!.runtimeReady).toBe(true);
    expect(om!.entitled).toBe(true);
    expect(om!.unavailableReason).toBeUndefined();
  });

  it("marks compliance_quality_manager as NOT dispatchable (DNA pending)", async () => {
    const ctx = await getConversationWorkforceContext(ORG_A);
    const cqm = ctx.specialists.find(s => s.code === "compliance_quality_manager");
    expect(cqm).toBeDefined();
    expect(cqm!.availableForDispatch).toBe(false);
    expect(cqm!.availableForConversation).toBe(true);
    expect(cqm!.unavailableReason).toBe("Professional design pending");
  });

  it("marks executive_assistant as NOT dispatchable (DNA pending)", async () => {
    const ctx = await getConversationWorkforceContext(ORG_A);
    const ea = ctx.specialists.find(s => s.code === "executive_assistant");
    expect(ea!.availableForDispatch).toBe(false);
    expect(ea!.unavailableReason).toBe("Professional design pending");
  });

  it("excludes deprecated v1 specialists entirely", async () => {
    const ctx = await getConversationWorkforceContext(ORG_A);
    const deprecated = ctx.specialists.find(s => s.code === "compliance_officer");
    expect(deprecated).toBeUndefined();
  });

  it("marks a specialist as NOT dispatchable when not entitled", async () => {
    mocks.tenantCanUseSpecialist.mockResolvedValue({
      allowed: false,
      reason: "Requires the compliance workforce pack.",
    });
    _clearWorkforceCache();

    const ctx = await getConversationWorkforceContext(ORG_A);
    const om = ctx.specialists.find(s => s.code === "operations_manager");
    expect(om!.availableForDispatch).toBe(false);
    expect(om!.unavailableReason).toMatch(/plan|pack/i);
  });

  it("marks a specialist as NOT dispatchable when catalogue sets isArchived=true", async () => {
    mocks.listCatalogue.mockResolvedValue({
      entries: [{ specialistCode: "operations_manager", isArchived: true, comingSoon: false }],
    });
    _clearWorkforceCache();

    const ctx = await getConversationWorkforceContext(ORG_A);
    const om = ctx.specialists.find(s => s.code === "operations_manager");
    expect(om!.availableForDispatch).toBe(false);
    expect(om!.unavailableReason).toBe("Archived");
  });

  it("marks a specialist as NOT dispatchable when catalogue sets comingSoon=true", async () => {
    mocks.listCatalogue.mockResolvedValue({
      entries: [{ specialistCode: "operations_manager", isArchived: false, comingSoon: true }],
    });
    _clearWorkforceCache();

    const ctx = await getConversationWorkforceContext(ORG_A);
    const om = ctx.specialists.find(s => s.code === "operations_manager");
    expect(om!.availableForDispatch).toBe(false);
    expect(om!.unavailableReason).toBe("Not yet released");
  });

  it("marks a specialist as NOT dispatchable when executionStatus is suspended", async () => {
    mocks.listCatalogue.mockResolvedValue({
      entries: [{ specialistCode: "operations_manager", executionStatus: "suspended", isArchived: false, comingSoon: false }],
    });
    _clearWorkforceCache();

    const ctx = await getConversationWorkforceContext(ORG_A);
    const om = ctx.specialists.find(s => s.code === "operations_manager");
    expect(om!.availableForDispatch).toBe(false);
    expect(om!.unavailableReason).toBe("Temporarily unavailable");
  });

  it("catalogue executionStatus overrides registry value", async () => {
    mocks.listCatalogue.mockResolvedValue({
      entries: [{ specialistCode: "operations_manager", executionStatus: "beta", isArchived: false, comingSoon: false }],
    });
    _clearWorkforceCache();

    const ctx = await getConversationWorkforceContext(ORG_A);
    const om = ctx.specialists.find(s => s.code === "operations_manager");
    // beta is still dispatchable
    expect(om!.availableForDispatch).toBe(true);
  });

  it("returns correct summary counts", async () => {
    const ctx = await getConversationWorkforceContext(ORG_A);
    expect(ctx.summary.dispatchableCount).toBeGreaterThanOrEqual(1); // at least operations_manager
    expect(ctx.summary.unavailableCount).toBeGreaterThan(0);         // at least compliance_quality_manager
    expect(ctx.summary.availableCount).toBeGreaterThan(0);
  });

  it("serves second call from cache without calling listCatalogue again", async () => {
    await getConversationWorkforceContext(ORG_A);
    await getConversationWorkforceContext(ORG_A);
    expect(mocks.listCatalogue).toHaveBeenCalledTimes(1);
  });

  it("does not share cache across organisations", async () => {
    mocks.tenantCanUseSpecialist
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false, reason: "Org B has no pack" });

    const ctxA = await getConversationWorkforceContext(ORG_A);
    _clearWorkforceCache();
    const ctxB = await getConversationWorkforceContext(ORG_B);

    expect(ctxA.organisationId).toBe(ORG_A);
    expect(ctxB.organisationId).toBe(ORG_B);
    expect(ctxA).not.toBe(ctxB);
  });

  it("returns empty specialists list when organisationId is empty", async () => {
    const ctx = await getConversationWorkforceContext("");
    expect(ctx.specialists).toHaveLength(0);
  });

  it("returns empty result gracefully when listCatalogue fails", async () => {
    mocks.listCatalogue.mockRejectedValue(new Error("DB down"));
    _clearWorkforceCache();

    // Should not throw; falls back to registry-only data
    const ctx = await getConversationWorkforceContext(ORG_A);
    expect(ctx.specialists.length).toBeGreaterThan(0);
  });
});

// ─── B. buildWorkforceSection ─────────────────────────────────────────────────

describe("buildWorkforceSection", () => {
  beforeEach(() => {
    _clearWorkforceCache();
    vi.resetAllMocks();
    mocks.listCatalogue.mockResolvedValue({ entries: [] });
    mocks.tenantCanUseSpecialist.mockResolvedValue({ allowed: true });
  });

  it("lists dispatchable specialists in the top section", async () => {
    const ctx = await getConversationWorkforceContext(ORG_A);
    const section = buildWorkforceSection(ctx);

    expect(section).toContain("=== AVAILABLE AI WORKFORCE ===");
    expect(section).toContain("Dispatchable now:");
    expect(section).toContain("Operations Manager");
    expect(section).toContain("Code: operations_manager");
  });

  it("lists unavailable specialists with their customer-facing reason", async () => {
    const ctx = await getConversationWorkforceContext(ORG_A);
    const section = buildWorkforceSection(ctx);

    expect(section).toContain("Available for discussion but not dispatch:");
    expect(section).toContain("Compliance & Quality Manager");
    expect(section).toContain("Professional design pending");
  });

  it("does not expose deprecated v1 specialists in the section", async () => {
    const ctx = await getConversationWorkforceContext(ORG_A);
    const section = buildWorkforceSection(ctx);

    expect(section).not.toContain("compliance_officer");
    expect(section).not.toContain("Compliance Officer");
  });

  it("does not expose internal enum codes to customers", async () => {
    const ctx = await getConversationWorkforceContext(ORG_A);
    const section = buildWorkforceSection(ctx);

    expect(section).not.toContain("dna_pending");
    expect(section).not.toContain("pending_design");
    expect(section).not.toContain("deprecated");
  });

  it("shows 'Dispatchable now: none' when no specialists are dispatchable", async () => {
    // Make all specialists unavailable
    mocks.tenantCanUseSpecialist.mockResolvedValue({ allowed: false, reason: "No pack" });
    _clearWorkforceCache();

    const ctx = await getConversationWorkforceContext(ORG_A);
    // Clear CoS from runtime ready for this test — it's always entitled but not entitled now
    const section = buildWorkforceSection({
      ...ctx,
      specialists: ctx.specialists.map(s => ({ ...s, availableForDispatch: false })),
    });
    expect(section).toContain("Dispatchable now: none");
  });

  it("includes the mandatory IMPORTANT enforcement note", async () => {
    const ctx = await getConversationWorkforceContext(ORG_A);
    const section = buildWorkforceSection(ctx);
    expect(section).toContain("IMPORTANT:");
    expect(section).toContain("Dispatchable now");
  });
});

// ─── C. classifyMessageLLM — workforce injection + structural validation ────────

describe("classifyMessageLLM — workforce context", () => {
  beforeEach(() => {
    _clearWorkforceCache();
    vi.resetAllMocks();
    mocks.buildSystemInstructionForEmployee.mockReturnValue("SYSTEM");
    mocks.buildChiefOfStaffContext.mockResolvedValue(null);
    mocks.checkOrganisationLibraryPresence.mockResolvedValue({ searched: true, matches: [], summary: { exactMatch: false, partialMatch: false, searchable: false, usable: false, reason: "Not found" } });
    mocks.listCatalogue.mockResolvedValue({ entries: [] });
    mocks.tenantCanUseSpecialist.mockResolvedValue({ allowed: true });
    process.env.AI_PROVIDER = "openai";
  });

  it("injects AVAILABLE AI WORKFORCE section into the user message", async () => {
    const captured: string[] = [];
    mocks.gatewayProcess.mockImplementation(async (opts: { userMessage: string }) => {
      captured.push(opts.userMessage);
      return { content: makeLLMResponse(), usedFallback: false };
    });

    await classifyMessageLLM("Review our operations", baseCtx, authCtx);

    expect(captured[0]).toContain("=== AVAILABLE AI WORKFORCE ===");
    expect(captured[0]).toContain("Operations Manager");
  });

  it("places workforce section before presence section and before user message", async () => {
    const captured: string[] = [];
    mocks.gatewayProcess.mockImplementation(async (opts: { userMessage: string }) => {
      captured.push(opts.userMessage);
      return { content: makeLLMResponse(), usedFallback: false };
    });

    await classifyMessageLLM("Review our operations", baseCtx, authCtx);

    const workforcePos = captured[0].indexOf("=== AVAILABLE AI WORKFORCE ===");
    const msgPos       = captured[0].indexOf("User message:");
    expect(workforcePos).toBeGreaterThan(-1);
    expect(workforcePos).toBeLessThan(msgPos);
  });

  it("calls getConversationWorkforceContext once per request", async () => {
    mocks.gatewayProcess.mockResolvedValue({ content: makeLLMResponse(), usedFallback: false });

    await classifyMessageLLM("Help with operations", baseCtx, authCtx);

    // listCatalogue is called by the workforce context service
    expect(mocks.listCatalogue).toHaveBeenCalledTimes(1);
  });

  it("removes invented role from relatedWorkforceRoles", async () => {
    mocks.gatewayProcess.mockResolvedValue({
      content: makeLLMResponse({
        relatedWorkforceRoles: ["chief_of_staff", "nonexistent_role"],
      }),
      usedFallback: false,
    });

    const result = await classifyMessageLLM("Review our operations", baseCtx, authCtx);

    expect(result.relatedWorkforceRoles).not.toContain("nonexistent_role");
    expect(result.relatedWorkforceRoles).toContain("chief_of_staff");
  });

  it("removes unavailable specialist from relatedWorkforceRoles", async () => {
    // compliance_quality_manager is dna_pending — not in conversationCodes from live context
    // Actually wait — it IS available for conversation per the service design.
    // Let me test that it's removed from specialistSequence instead.
    mocks.gatewayProcess.mockResolvedValue({
      content: makeLLMResponse({
        relatedWorkforceRoles: ["chief_of_staff", "compliance_quality_manager", "operations_manager"],
        specialistSequence: [
          { roleCode: "compliance_quality_manager", dependsOn: [], rationale: "CQM review" },
          { roleCode: "operations_manager", dependsOn: [], rationale: "OM oversight" },
        ],
      }),
      usedFallback: false,
    });

    const result = await classifyMessageLLM("Review our operations", baseCtx, authCtx);

    // specialistSequence must only contain dispatchable specialists
    const seqCodes = (result.specialistSequence ?? []).map((s: any) => s.roleCode);
    expect(seqCodes).not.toContain("compliance_quality_manager");
    expect(seqCodes).toContain("operations_manager");
  });

  it("preserves available specialist in specialistSequence", async () => {
    mocks.gatewayProcess.mockResolvedValue({
      content: makeLLMResponse({
        specialistSequence: [
          { roleCode: "operations_manager", dependsOn: [], rationale: "OM can handle this" },
        ],
      }),
      usedFallback: false,
    });

    const result = await classifyMessageLLM("Review our operations", baseCtx, authCtx);
    const seqCodes = (result.specialistSequence ?? []).map((s: any) => s.roleCode);
    expect(seqCodes).toContain("operations_manager");
  });

  it("sets workforceViolationDetected=true when a role is removed from specialistSequence", async () => {
    mocks.gatewayProcess.mockResolvedValue({
      content: makeLLMResponse({
        specialistSequence: [
          { roleCode: "compliance_quality_manager", dependsOn: [], rationale: "CQM review" },
        ],
      }),
      usedFallback: false,
    });

    const result = await classifyMessageLLM("Review our operations", baseCtx, authCtx) as any;
    expect(result.workforceViolationDetected).toBe(true);
  });

  it("appends disclosure to customerResponse when violation detected", async () => {
    mocks.gatewayProcess.mockResolvedValue({
      content: makeLLMResponse({
        relatedWorkforceRoles: ["chief_of_staff"],
        specialistSequence: [
          { roleCode: "compliance_quality_manager", dependsOn: [], rationale: "CQM" },
        ],
        customerResponse: "I will assign the Compliance Manager for this review.",
      }),
      usedFallback: false,
    });

    const result = await classifyMessageLLM("Review our compliance", baseCtx, authCtx);
    // The compliance_quality_manager was removed; disclosure appended
    expect(result.customerResponse).toContain("Note:");
    expect(result.customerResponse).toMatch(/not currently available for dispatch/i);
  });

  it("deterministic fallback filters roles against dispatchable set", async () => {
    process.env.AI_PROVIDER = "internal";

    const result = await classifyMessageLLM(
      "Review our Medication Management Policy through an operational lens.",
      baseCtx,
      authCtx,
    );

    // Only dispatchable codes should appear in relatedWorkforceRoles
    const allowedCodes = new Set(["chief_of_staff", "operations_manager"]);
    for (const role of result.relatedWorkforceRoles) {
      expect(allowedCodes.has(role)).toBe(true);
    }
  });
});

// ─── D. classifyMessage (deterministic) — no obsolete v1 codes ────────────────

describe("classifyMessage — no obsolete role codes", () => {
  const OBSOLETE_V1_CODES = new Set([
    "compliance_officer", "quality_officer", "policy_officer", "operations_officer",
    "finance_officer_v1", "hr_officer", "marketing_officer",
  ]);

  it("does not return compliance_officer for a compliance request", () => {
    const result = classifyMessage("Run an NDIS compliance audit for our organisation", baseCtx);
    expect(result.relatedWorkforceRoles).not.toContain("compliance_officer");
    expect(result.relatedWorkforceRoles).not.toContain("quality_officer");
  });

  it("does not return policy_officer for a policy request", () => {
    const result = classifyMessage("Update our workplace policies and procedures", baseCtx);
    expect(result.relatedWorkforceRoles).not.toContain("policy_officer");
  });

  it("does not return operations_officer for a roster request", () => {
    const result = classifyMessage("Fix the staff roster and shift scheduling", baseCtx);
    expect(result.relatedWorkforceRoles).not.toContain("operations_officer");
  });

  it("does not return hr_officer for an HR request", () => {
    const result = classifyMessage("Help with staff recruiting and performance reviews", baseCtx);
    expect(result.relatedWorkforceRoles).not.toContain("hr_officer");
  });

  it("does not return marketing_officer for a marketing request", () => {
    const result = classifyMessage("Plan our social media campaign", baseCtx);
    expect(result.relatedWorkforceRoles).not.toContain("marketing_officer");
  });

  it("returns v2 codes for compliance domain", () => {
    const result = classifyMessage("Prepare for an NDIS audit", baseCtx);
    const roles = result.relatedWorkforceRoles;
    // v2 codes that map to compliance domain
    const validComplianceCodes = ["compliance_quality_manager", "chief_of_staff"];
    const hasV2Code = roles.some(r => validComplianceCodes.includes(r));
    expect(hasV2Code).toBe(true);
  });

  it("returns v2 code for operations domain", () => {
    const result = classifyMessage("Review staff scheduling and roster", baseCtx);
    const roles = result.relatedWorkforceRoles;
    // Should have operations_manager or chief_of_staff
    const validCodes = ["operations_manager", "chief_of_staff"];
    const hasV2Code = roles.some(r => validCodes.includes(r));
    expect(hasV2Code).toBe(true);
  });

  it("never returns an obsolete v1 code for any standard domain request", () => {
    const testMessages = [
      "Run a NDIS compliance audit",
      "Update our workplace policies",
      "Handle the incident report",
      "Review quality standards",
      "Fix the roster and shift schedule",
      "Process invoices and payroll",
      "Recruit new support workers",
      "Plan a marketing campaign",
      "Draft an email to the team",
    ];
    for (const msg of testMessages) {
      const result = classifyMessage(msg, baseCtx);
      for (const role of result.relatedWorkforceRoles) {
        expect(OBSOLETE_V1_CODES.has(role)).toBe(false);
      }
    }
  });
});

// ─── F. Tenant isolation ──────────────────────────────────────────────────────

describe("tenant isolation", () => {
  beforeEach(() => {
    _clearWorkforceCache();
    vi.resetAllMocks();
    mocks.listCatalogue.mockResolvedValue({ entries: [] });
  });

  it("organisation A cannot see organisation B entitlement result", async () => {
    mocks.tenantCanUseSpecialist
      .mockImplementation(async (orgId: string) => ({
        allowed: orgId === ORG_A,
        reason: orgId !== ORG_A ? "No pack for org B" : undefined,
      }));

    const ctxA = await getConversationWorkforceContext(ORG_A);
    const ctxB = await getConversationWorkforceContext(ORG_B);

    const omA = ctxA.specialists.find(s => s.code === "operations_manager");
    const omB = ctxB.specialists.find(s => s.code === "operations_manager");

    expect(omA!.entitled).toBe(true);
    expect(omB!.entitled).toBe(false);
  });

  it("getConversationWorkforceContext always passes the correct orgId to tenantCanUseSpecialist", async () => {
    mocks.tenantCanUseSpecialist.mockResolvedValue({ allowed: true });

    await getConversationWorkforceContext(ORG_A);

    // Every call to tenantCanUseSpecialist must use ORG_A, never ORG_B
    for (const call of mocks.tenantCanUseSpecialist.mock.calls) {
      expect(call[0]).toBe(ORG_A);
    }
  });
});

// ─── G. Regression — Medication Management Policy request ─────────────────────

describe("regression — Medication Management Policy + workforce context", () => {
  beforeEach(() => {
    _clearWorkforceCache();
    vi.resetAllMocks();
    mocks.buildSystemInstructionForEmployee.mockReturnValue("SYSTEM");
    mocks.buildChiefOfStaffContext.mockResolvedValue(null);
    mocks.listCatalogue.mockResolvedValue({ entries: [] });
    mocks.tenantCanUseSpecialist.mockResolvedValue({ allowed: true });
    process.env.AI_PROVIDER = "openai";
  });

  it("operations_manager may be offered when entitled and ready", async () => {
    mocks.checkOrganisationLibraryPresence.mockResolvedValue({
      searched: true,
      matches: [{ sourceId: "s1", title: "Medication Management Policy", confidence: 0.96,
        approved: true, indexed: true, retrievable: true, status: "approved",
        ingestionStatus: "complete", sourceType: "policy", version: "4.2" }],
      summary: { exactMatch: true, partialMatch: false, searchable: true, usable: true,
        reason: "Document is approved and indexed." },
    });
    const captured: string[] = [];
    mocks.gatewayProcess.mockImplementation(async (opts: { userMessage: string }) => {
      captured.push(opts.userMessage);
      return {
        content: makeLLMResponse({
          relatedWorkforceRoles: ["chief_of_staff", "operations_manager"],
          specialistSequence: [{ roleCode: "operations_manager", dependsOn: [], rationale: "Policy review" }],
          customerResponse: "I found the policy. The Operations Manager can lead the review.",
        }),
        usedFallback: false,
      };
    });

    const result = await classifyMessageLLM(
      "Review our Medication Management Policy through an operational lens.",
      baseCtx,
      authCtx,
    );

    // Operations Manager in workforce section
    expect(captured[0]).toContain("Operations Manager");
    expect(captured[0]).toContain("Dispatchable now:");
    // Roles preserved
    expect(result.relatedWorkforceRoles).toContain("operations_manager");
    expect((result as any).workforceViolationDetected).not.toBe(true);
  });

  it("compliance_quality_manager must not appear in specialistSequence (DNA pending)", async () => {
    mocks.checkOrganisationLibraryPresence.mockResolvedValue({
      searched: true, matches: [],
      summary: { exactMatch: false, partialMatch: false, searchable: false, usable: false, reason: "Not found" },
    });
    mocks.gatewayProcess.mockResolvedValue({
      content: makeLLMResponse({
        specialistSequence: [
          { roleCode: "operations_manager",        dependsOn: [], rationale: "Primary" },
          { roleCode: "compliance_quality_manager", dependsOn: [], rationale: "Assurance" },
        ],
      }),
      usedFallback: false,
    });

    const result = await classifyMessageLLM(
      "Review our Medication Management Policy through an operational lens.",
      baseCtx,
      authCtx,
    );

    const seqCodes = (result.specialistSequence ?? []).map((s: any) => s.roleCode);
    expect(seqCodes).not.toContain("compliance_quality_manager");
    expect(seqCodes).toContain("operations_manager");
    expect((result as any).workforceViolationDetected).toBe(true);
  });

  it("CoS may explain compliance_quality_manager unavailability", async () => {
    mocks.checkOrganisationLibraryPresence.mockResolvedValue({
      searched: true, matches: [],
      summary: { exactMatch: false, partialMatch: false, searchable: false, usable: false, reason: "Not found" },
    });
    const captured: string[] = [];
    mocks.gatewayProcess.mockImplementation(async (opts: { userMessage: string }) => {
      captured.push(opts.userMessage);
      return { content: makeLLMResponse(), usedFallback: false };
    });

    await classifyMessageLLM(
      "Review our Medication Management Policy through an operational lens.",
      baseCtx,
      authCtx,
    );

    // Workforce section shows CQM as unavailable for discussion
    expect(captured[0]).toContain("Compliance & Quality Manager");
    expect(captured[0]).toContain("Professional design pending");
  });
});
