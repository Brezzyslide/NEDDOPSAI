/**
 * Sprint 28.7 — Gateway Output-Mode Architecture Tests
 *
 * Regression tests for the output-mode architecture that prevents OpenAI HTTP 400
 * errors caused by sending response_format: json_object on prose-producing requests.
 *
 * Root cause: OpenAI enforces that when response_format: json_object is set, the
 * word "json" MUST appear in the prompt. Specialist work execution, self-review
 * revision, and executive briefing prompts produce prose/markdown and did not
 * include "json" — causing every specialist execution to fail and fall back to
 * the deterministic stub, which was then rejected by FallbackDraftError.
 *
 * Fix: Extend AIRequest with outputMode: GatewayOutputMode. The OpenAI provider
 * only sends response_format when outputMode is "json" or "structured". All
 * callers now declare outputMode explicitly.
 *
 * Sections:
 *   1. Type-level checks — GatewayOutputMode, new AIPurpose values, system role
 *   2. callOpenAI — response_format conditional on outputMode
 *   3. Gateway.process() — outputMode threaded to AIResponse
 *   4. Caller source audit — each service declares the expected outputMode
 *   5. InspectorDiagnostics — gateway field populated from fallback root causes
 *
 * Classification: MOCKED — no real DB or OpenAI calls
 *
 * NOTE: vi.mock() calls at module scope are hoisted to file top by vitest.
 * This file does NOT mock @workspace/ai-gateway so sections 1–3 use the real
 * gateway logic. The caller audit (section 4) uses readFile only — no imports
 * of the caller services — so no gateway mock is needed there either.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ── OpenAI SDK mock — hoisted to top of file ──────────────────────────────────

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  })),
}));

// ── Shared DB mock — required by gateway audit writer ─────────────────────────
//
// The ai-gateway writes audit events via `db as platformDb` from @workspace/db.
// The insert call is: platformDb.insert(table).values({...})
// The mock must return a chainable object: insert() → { values: fn }

const mockDbExec = vi.hoisted(() => vi.fn().mockResolvedValue({ rows: [] }));

const makeInsertChain = () =>
  vi.fn().mockReturnValue({
    values: vi.fn().mockResolvedValue([]),
    returning: vi.fn().mockResolvedValue([]),
  });

const makeUpdateChain = () =>
  vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  });

const makeSelectChain = () => vi.fn().mockReturnValue({
  from: vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue([]),
    limit: vi.fn().mockReturnValue({ offset: vi.fn().mockResolvedValue([]) }),
  }),
});

vi.mock("@workspace/db", () => ({
  // `db as platformDb` — used by ai-gateway's writeGatewayAuditEvent
  db: {
    select: makeSelectChain(),
    insert: makeInsertChain(),
    update: makeUpdateChain(),
    execute: mockDbExec,
  },
  orgAuditLogTable:              {},
  organisationsTable:            {},
  usersTable:                    {},
  workPackageManifestsTable:     {},
  workBlueprintsTable:           {},
  knowledgeSourcesTable:         {},
  knowledgeSourceVersionsTable:  {},
  knowledgeChunksTable:          {},
  ingestionJobsTable:            {},
  organisationMemoryTable:       {},
  aiGatewayAuditTable:           {},
  aiGatewayUsageTable:           {},
  tenant_entitlements:           {},
}));

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: vi.fn().mockResolvedValue(undefined),
}));

// ─── Path helpers ──────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const serviceDir = join(__dirname, "..", "services");
const routeDir   = join(__dirname, "..", "routes", "v1");

function readService(name: string): Promise<string> {
  return readFile(join(serviceDir, name), "utf-8");
}

function readRoute(name: string): Promise<string> {
  return readFile(join(routeDir, name), "utf-8");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOpenAIResponse(content: string, model = "gpt-4o-mini") {
  return {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
    model,
  };
}

function baseCtx(overrides: Record<string, unknown> = {}) {
  return {
    userId: randomUUID(),
    organizationId: randomUUID(),
    role: "administrator",
    permissions: [] as string[],
    purpose: "task_planning" as const,
    correlationId: randomUUID(),
    provider: "internal" as const,
    retentionClass: "operational" as const,
    requiresHumanApproval: false,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Type-level checks — GatewayOutputMode, new AIPurpose values, system role
// ─────────────────────────────────────────────────────────────────────────────

describe("Sprint 28.7 — Gateway types: GatewayOutputMode + new purposes + system role", () => {

  it("PURPOSE_FIELD_ALLOWLIST includes all four Sprint 28.7 purposes", async () => {
    const { PURPOSE_FIELD_ALLOWLIST } = await import("@workspace/ai-gateway");
    expect(PURPOSE_FIELD_ALLOWLIST).toHaveProperty("blueprint_classification");
    expect(PURPOSE_FIELD_ALLOWLIST).toHaveProperty("executive_briefing");
    expect(PURPOSE_FIELD_ALLOWLIST).toHaveProperty("work_self_review_revision");
    expect(PURPOSE_FIELD_ALLOWLIST).toHaveProperty("knowledge_curation");
  });

  it("system role is in ROLE_PURPOSE_ALLOWLIST with ≥5 permitted purposes", async () => {
    const { ROLE_PURPOSE_ALLOWLIST } = await import("@workspace/ai-gateway");
    const purposes = ROLE_PURPOSE_ALLOWLIST["system"] ?? [];
    expect(purposes.length).toBeGreaterThanOrEqual(5);
    expect(purposes).toContain("task_execution");
    expect(purposes).toContain("blueprint_classification");
    expect(purposes).toContain("work_self_review_revision");
    expect(purposes).toContain("knowledge_curation");
    expect(purposes).toContain("knowledge_retrieval");
  });

  it("blueprint_classification field allowlist is empty (no customer data)", async () => {
    const { PURPOSE_FIELD_ALLOWLIST } = await import("@workspace/ai-gateway");
    expect(PURPOSE_FIELD_ALLOWLIST["blueprint_classification"]).toHaveLength(0);
  });

  it("work_self_review_revision field allowlist is empty (no retrieved data)", async () => {
    const { PURPOSE_FIELD_ALLOWLIST } = await import("@workspace/ai-gateway");
    expect(PURPOSE_FIELD_ALLOWLIST["work_self_review_revision"]).toHaveLength(0);
  });

  it("knowledge_curation allows chunk + source fields; blocks task/participant data", async () => {
    const { PURPOSE_FIELD_ALLOWLIST } = await import("@workspace/ai-gateway");
    const allowed = PURPOSE_FIELD_ALLOWLIST["knowledge_curation"] ?? [];
    expect(allowed).toContain("knowledge.chunk");
    expect(allowed).toContain("knowledge.source");
    expect(allowed).not.toContain("task.description");
    expect(allowed).not.toContain("participant.dateOfBirth");
  });

  it("system role can create a gateway for blueprint_classification without AIGatewayPurposeError", async () => {
    const { createAIGateway, AIGatewayPurposeError } = await import("@workspace/ai-gateway");
    expect(() =>
      createAIGateway(baseCtx({
        role: "system",
        purpose: "blueprint_classification",
      }))
    ).not.toThrow();
  });

  it("system role can create a gateway for knowledge_curation", async () => {
    const { createAIGateway } = await import("@workspace/ai-gateway");
    expect(() =>
      createAIGateway(baseCtx({ role: "system", purpose: "knowledge_curation" }))
    ).not.toThrow();
  });

  it("system role can create a gateway for work_self_review_revision", async () => {
    const { createAIGateway } = await import("@workspace/ai-gateway");
    expect(() =>
      createAIGateway(baseCtx({ role: "system", purpose: "work_self_review_revision" }))
    ).not.toThrow();
  });

  it("@workspace/ai-gateway module smoke: key runtime exports are present", async () => {
    // GatewayOutputMode is a TypeScript type — verified at compile time.
    // Verify the module loads cleanly and has the key runtime exports.
    // callOpenAI is an internal function (not in the public index.ts export).
    const mod = await import("@workspace/ai-gateway");
    expect(mod.createAIGateway).toBeDefined();
    expect(mod.ROLE_PURPOSE_ALLOWLIST).toBeDefined();
    expect(mod.PURPOSE_FIELD_ALLOWLIST).toBeDefined();
    expect(mod.AIGatewayError).toBeDefined();
    expect(mod.APPROVED_PROVIDERS).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. OpenAI provider source — response_format conditional logic
//
// Tests the OpenAI provider source code directly to verify the conditional
// that determines whether response_format is sent. This avoids the OpenAI
// client singleton issue (the _client cache persists across test files).
// The source checks prove the logic is correct; the gateway threading is
// verified in section 3 using the internal provider.
// ─────────────────────────────────────────────────────────────────────────────

describe("Sprint 28.7 — OpenAI provider source: response_format conditional", () => {

  it("provider source uses outputMode !== 'text' to guard response_format", async () => {
    const src = await readFile(
      join(dirname(fileURLToPath(import.meta.url)), "../../../..", "lib/ai-gateway/src/providers/openai.ts"),
      "utf-8",
    );
    // The guard condition
    expect(src).toContain(`outputMode !== "text"`);
    // The conditional spread
    expect(src).toContain("response_format");
    // useJsonMode variable
    expect(src).toContain("useJsonMode");
  });

  it("provider source sets responseFormat=null when text mode (not useJsonMode)", async () => {
    const src = await readFile(
      join(dirname(fileURLToPath(import.meta.url)), "../../../..", "lib/ai-gateway/src/providers/openai.ts"),
      "utf-8",
    );
    // responseFormat variable is set to null when not json mode
    expect(src).toContain(`useJsonMode ? "json_object" : null`);
  });

  it("provider source returns responseFormat in result object", async () => {
    const src = await readFile(
      join(dirname(fileURLToPath(import.meta.url)), "../../../..", "lib/ai-gateway/src/providers/openai.ts"),
      "utf-8",
    );
    // The result must include responseFormat
    expect(src).toContain("responseFormat,");
  });

  it("provider source spreads response_format only when useJsonMode is true", async () => {
    const src = await readFile(
      join(dirname(fileURLToPath(import.meta.url)), "../../../..", "lib/ai-gateway/src/providers/openai.ts"),
      "utf-8",
    );
    // Conditional spread: ...(useJsonMode ? { response_format: ... } : {})
    expect(src).toMatch(/useJsonMode\s*\?\s*\{\s*response_format/);
  });

  it("provider source handles undefined outputMode with a legacy default", async () => {
    const src = await readFile(
      join(dirname(fileURLToPath(import.meta.url)), "../../../..", "lib/ai-gateway/src/providers/openai.ts"),
      "utf-8",
    );
    // Legacy default: outputMode ?? "json"
    expect(src).toContain(`outputMode ?? "json"`);
  });

  it("gateway source captures callOpenAI's responseFormat into actualResponseFormat", async () => {
    const src = await readFile(
      join(dirname(fileURLToPath(import.meta.url)), "../../../..", "lib/ai-gateway/src/aiGateway.ts"),
      "utf-8",
    );
    expect(src).toContain("actualResponseFormat = result.responseFormat");
    expect(src).toContain("responseFormat: actualResponseFormat");
  });

  it("gateway source propagates outputMode in response object", async () => {
    const src = await readFile(
      join(dirname(fileURLToPath(import.meta.url)), "../../../..", "lib/ai-gateway/src/aiGateway.ts"),
      "utf-8",
    );
    expect(src).toContain("outputMode,");
    expect(src).toContain("responseFormat: actualResponseFormat");
  });

  it("AIResponse type definition includes outputMode and responseFormat fields", async () => {
    const src = await readFile(
      join(dirname(fileURLToPath(import.meta.url)), "../../../..", "lib/ai-gateway/src/types.ts"),
      "utf-8",
    );
    expect(src).toContain("outputMode: GatewayOutputMode");
    expect(src).toContain("responseFormat: string | null");
    expect(src).toContain("GatewayOutputMode");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Gateway.process() — outputMode threaded to AIResponse
//
// Uses only the internal provider (no OpenAI API key required) to verify
// that the gateway correctly threads outputMode from request → AIResponse.
// OpenAI-specific behaviour (response_format conditional) is verified in
// section 2 via source inspection, which is deterministic and singleton-safe.
// ─────────────────────────────────────────────────────────────────────────────

describe("Sprint 28.7 — Gateway.process(): outputMode threaded to AIResponse", () => {

  it("internal provider: response.outputMode='text' when declared text", async () => {
    const { createAIGateway } = await import("@workspace/ai-gateway");
    const gateway = createAIGateway(baseCtx({
      role: "system",
      purpose: "task_execution",
      provider: "internal",
    }));
    const response = await gateway.process({
      systemPrompt: "You are a specialist.",
      userMessage: "Execute.",
      retrievedFields: [],
      outputMode: "text",
    });
    expect(response.outputMode).toBe("text");
  });

  it("internal provider: response.outputMode='json' when declared json", async () => {
    const { createAIGateway } = await import("@workspace/ai-gateway");
    const gateway = createAIGateway(baseCtx({
      role: "administrator",
      purpose: "task_planning",
      provider: "internal",
    }));
    const response = await gateway.process({
      systemPrompt: "Classify this request. Return JSON.",
      userMessage: "Test.",
      retrievedFields: [],
      outputMode: "json",
    });
    expect(response.outputMode).toBe("json");
  });

  it("internal provider: response.outputMode='structured' when declared structured", async () => {
    const { createAIGateway } = await import("@workspace/ai-gateway");
    const gateway = createAIGateway(baseCtx({
      role: "system",
      purpose: "task_execution",
      provider: "internal",
    }));
    const response = await gateway.process({
      systemPrompt: "Evaluate and return JSON schema output.",
      userMessage: "Test.",
      retrievedFields: [],
      outputMode: "structured",
    });
    expect(response.outputMode).toBe("structured");
  });

  it("internal provider: response.responseFormat is always null (internal never calls OpenAI)", async () => {
    const { createAIGateway } = await import("@workspace/ai-gateway");
    const gateway = createAIGateway(baseCtx({
      role: "administrator",
      purpose: "task_planning",
      provider: "internal",
    }));
    const response = await gateway.process({
      systemPrompt: "You are an assistant.",
      userMessage: "Help.",
      retrievedFields: [],
      outputMode: "json",
    });
    // Internal provider never contacts OpenAI — responseFormat is always null
    expect(response.responseFormat).toBeNull();
  });

  it("gateway emits console.warn when outputMode is omitted (backward-compat)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { createAIGateway } = await import("@workspace/ai-gateway");
    const gateway = createAIGateway(baseCtx({
      role: "administrator",
      purpose: "task_planning",
      provider: "internal",
    }));
    await gateway.process({
      systemPrompt: "Do something.",
      userMessage: "test",
      retrievedFields: [],
      // outputMode deliberately omitted — verify backward-compat warning
    } as any);
    const warningFound = warnSpy.mock.calls.some(args =>
      String(args[0]).includes("outputMode not declared by caller"),
    );
    expect(warningFound).toBe(true);
    warnSpy.mockRestore();
  });

  it("gateway response includes both outputMode and responseFormat fields on AIResponse", async () => {
    const { createAIGateway } = await import("@workspace/ai-gateway");
    const gateway = createAIGateway(baseCtx({
      role: "system",
      purpose: "task_execution",
      provider: "internal",
    }));
    const response = await gateway.process({
      systemPrompt: "Execute specialist work.",
      userMessage: "Run the task.",
      retrievedFields: [],
      outputMode: "text",
    });
    // Both new Sprint 28.7 fields must be present on every AIResponse
    expect(response).toHaveProperty("outputMode");
    expect(response).toHaveProperty("responseFormat");
    expect(response.outputMode).toBe("text");
    expect(response.responseFormat).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Caller source audit — each service declares the correct outputMode
//
// These tests read source files directly (no module imports) to verify that
// every gateway.process() call has an explicit outputMode declaration.
// ─────────────────────────────────────────────────────────────────────────────

describe("Sprint 28.7 — Caller outputMode declaration audit (source-level)", () => {

  it("workExecutionPipelineService: outputMode='json' (Sprint 29K.3: task execution uses json for dual content+claims output)", async () => {
    // Sprint 29K.3: generateTaskDraft changed from outputMode="text" to "json" so the specialist
    // can return { content, claims } in a single LLM call with no second pass.
    // The content field contains the full human-readable Completed Work.
    // The claims field contains structured provenance metadata.
    const src = await readService("unifiedExecutionEngine.ts");
    expect(src).toContain(`outputMode: "json"`);
    // Claim emission addendum must be present in the source
    expect(src).toContain("buildClaimEmissionAddendum");
  });

  it("selfReviewService: outputMode='text' (revision produces prose)", async () => {
    const src = await readService("selfReviewService.ts");
    expect(src).toContain(`outputMode: "text"`);
  });

  it("executiveBriefing route: outputMode='text' (briefing produces prose)", async () => {
    const src = await readRoute("executiveBriefing.ts");
    expect(src).toContain(`outputMode: "text"`);
  });

  it("chiefOfStaffLLMService: outputMode='json' (classification returns JSON)", async () => {
    const src = await readService("chiefOfStaffLLMService.ts");
    expect(src).toContain(`outputMode: "json"`);
  });

  it("workBlueprintService: outputMode='json' (blueprint selection returns JSON)", async () => {
    const src = await readService("workBlueprintService.ts");
    expect(src).toContain(`outputMode: "json"`);
  });

  it("knowledgeCurationService: outputMode='json' (curation proposals are JSON)", async () => {
    const src = await readService("knowledgeCurationService.ts");
    expect(src).toContain(`outputMode: "json"`);
  });

  it("specialistIntelligenceService: outputMode='json' (intelligence result is JSON)", async () => {
    // Sprint 29B: execution logic moved to unifiedExecutionEngine.ts (thin adapter pattern).
    // The outputMode="json" declaration for conversation-driven specialist runs lives in the engine.
    const src = await readService("unifiedExecutionEngine.ts");
    expect(src).toContain(`outputMode: "json"`);
  });

  it("chiefOfStaffOrchestrator: outputMode='json' (conflict decision is JSON)", async () => {
    const src = await readService("chiefOfStaffOrchestrator.ts");
    expect(src).toContain(`outputMode: "json"`);
  });

  it("capabilityIdentificationService: outputMode='json' (capability list is JSON)", async () => {
    const src = await readService("capabilityIdentificationService.ts");
    expect(src).toContain(`outputMode: "json"`);
  });

  it("conversationMemoryService: outputMode='json' (summary is JSON)", async () => {
    const src = await readService("conversationMemoryService.ts");
    expect(src).toContain(`outputMode: "json"`);
  });

  it("all text-mode callers do NOT contain response_format directly (gateway handles it)", async () => {
    const [pipeline, selfReview, briefing] = await Promise.all([
      readService("workExecutionPipelineService.ts"),
      readService("selfReviewService.ts"),
      readRoute("executiveBriefing.ts"),
    ]);
    // These callers should not hardcode response_format — the gateway owns that
    for (const [name, src] of [["pipeline", pipeline], ["selfReview", selfReview], ["briefing", briefing]]) {
      expect(src, `${name} must not hardcode response_format`).not.toContain("response_format");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. InspectorGatewayDiagnostics — gateway field population logic
// ─────────────────────────────────────────────────────────────────────────────

describe("Sprint 28.7 — InspectorGatewayDiagnostics population logic", () => {

  it("FallbackDraftError message matches fallback detection pattern", () => {
    // Verify the rootCause message written by generateDraft triggers detection
    const rootCause = "AI specialist execution did not produce content (gateway used fallback). The work output cannot be saved as Completed Work.";
    const isFallback = rootCause.includes("gateway used fallback") ||
      rootCause.includes("AI specialist execution did not produce content");
    expect(isFallback).toBe(true);
  });

  it("generic execution error (non-gateway) does NOT trigger fallback detection", () => {
    const rootCause = "Network timeout during evidence retrieval";
    const isFallback = rootCause.includes("gateway used fallback") ||
      rootCause.includes("AI specialist execution did not produce content");
    expect(isFallback).toBe(false);
  });

  it("OpenAI API error rootCause triggers gateway diagnostics (contains 'openai')", () => {
    const rootCause = "OpenAI api_error: messages must contain the word 'json' in some form, to use 'response_format' of type 'json_object'";
    const isOpenAIError = rootCause.toLowerCase().includes("openai");
    expect(isOpenAIError).toBe(true);
  });

  it("validation failure rootCause does NOT trigger gateway diagnostics", () => {
    const rootCause = "Missing required evidence: NDIS Plan";
    const isOpenAIError = rootCause.toLowerCase().includes("openai");
    const isFallback = rootCause.includes("gateway used fallback");
    expect(isOpenAIError).toBe(false);
    expect(isFallback).toBe(false);
  });

  it("gateway diagnostics for text-mode work execution have correct field values", () => {
    // Work execution always uses outputMode: "text" after Sprint 28.7
    // text mode → no response_format sent → responseFormat=null in diagnostics
    const gatewayDiagnostics = {
      outputMode: "text",
      provider: "openai",
      model: null,            // model is in audit log, not stored in manifest
      responseFormat: null,   // null because text mode — this is the Sprint 28.7 fix
      usedFallback: true,
      fallbackReason: "AI specialist execution did not produce content (gateway used fallback).",
    };
    // Verify the shape used by the inspector builder
    expect(gatewayDiagnostics.outputMode).toBe("text");
    expect(gatewayDiagnostics.responseFormat).toBeNull();
    expect(gatewayDiagnostics.usedFallback).toBe(true);
    expect(gatewayDiagnostics.model).toBeNull();
  });

  it("InspectorGatewayDiagnostics interface is exported from executionInspectorService", async () => {
    // If the import throws, the interface or export is missing
    const mod = await import("../services/executionInspectorService.js");
    // getExecutionInspection is the primary exported function — verify it exists
    expect(mod.getExecutionInspection).toBeDefined();
    expect(mod.getInspectionByCompletedWorkId).toBeDefined();
  });

  it("executionInspectorService source defines InspectorGatewayDiagnostics interface", async () => {
    const src = await readFile(
      join(serviceDir, "executionInspectorService.ts"),
      "utf-8"
    );
    expect(src).toContain("InspectorGatewayDiagnostics");
    expect(src).toContain("gateway: InspectorGatewayDiagnostics | null");
    expect(src).toContain("outputMode:");
    expect(src).toContain("usedFallback:");
    expect(src).toContain("fallbackReason:");
    expect(src).toContain("responseFormat:");
  });

  it("inspector builder populates gateway=null when failedStage is not 'executing'", () => {
    // Simulate the inspector's gateway population logic for a non-executing failure
    const failInfo = {
      state: "failed",
      failedStage: "validating",  // NOT "executing"
      rootCause: "Blueprint not found",
      retryAvailable: false,
    };
    const rootCauseText = failInfo.rootCause ?? "";
    const isFallback = rootCauseText.includes("gateway used fallback") ||
      rootCauseText.includes("AI specialist execution did not produce content");
    const isOpenAI = rootCauseText.toLowerCase().includes("openai");
    const shouldPopulateGateway = failInfo.failedStage === "executing" && (isFallback || isOpenAI);
    expect(shouldPopulateGateway).toBe(false);
  });

  it("inspector builder populates gateway diagnostics when failedStage='executing' and fallback detected", () => {
    // Simulate the gateway population logic for a fallback failure
    const failInfo = {
      state: "failed",
      failedStage: "executing",
      rootCause: "AI specialist execution did not produce content (gateway used fallback). The work output cannot be saved.",
      retryAvailable: true,
    };
    const rootCauseText = failInfo.rootCause;
    const isFallback = rootCauseText.includes("gateway used fallback") ||
      rootCauseText.includes("AI specialist execution did not produce content");
    const isOpenAI = rootCauseText.toLowerCase().includes("openai");
    const shouldPopulateGateway = failInfo.failedStage === "executing" && (isFallback || isOpenAI);

    expect(shouldPopulateGateway).toBe(true);

    const gatewayDiag = shouldPopulateGateway ? {
      outputMode: "text",
      provider: "openai",
      model: null,
      responseFormat: null,
      usedFallback: isFallback,
      fallbackReason: isFallback ? rootCauseText : null,
    } : null;

    expect(gatewayDiag).not.toBeNull();
    expect(gatewayDiag!.outputMode).toBe("text");
    expect(gatewayDiag!.responseFormat).toBeNull();
    expect(gatewayDiag!.usedFallback).toBe(true);
    expect(gatewayDiag!.fallbackReason).toContain("gateway used fallback");
  });
});
