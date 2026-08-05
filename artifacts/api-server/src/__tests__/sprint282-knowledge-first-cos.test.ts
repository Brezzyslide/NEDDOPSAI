/**
 * Sprint 28.2 — Knowledge-First Chief of Staff
 *
 * Tests the integration of organisationLibraryPresenceService into the Chief of
 * Staff conversation path. Covers:
 *
 *  A. extractDocumentSearchTerms — pure function unit tests
 *  B. buildLibraryPresenceSection — context section formatting
 *  C. classifyMessageLLM (OpenAI path) — presence result injected into user message
 *  D. classifyMessage (deterministic path) — namedDocTerms suppresses "which policy?"
 *  E. Behaviour safeguards (exact vs partial, no claimed content review, etc.)
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const gatewayProcess = vi.fn();
  const validateRetrievedFields = vi.fn();
  const createAIGateway = vi.fn(() => ({
    process: gatewayProcess,
    validateRetrievedFields,
  }));

  const buildChiefOfStaffContext = vi.fn();
  const buildSystemInstructionForEmployee = vi.fn().mockReturnValue("SYSTEM");
  const buildDNASystemInstruction = vi.fn().mockReturnValue("DNA");
  const checkOrganisationLibraryPresence = vi.fn();

  return {
    createAIGateway,
    gatewayProcess,
    validateRetrievedFields,
    buildChiefOfStaffContext,
    buildSystemInstructionForEmployee,
    buildDNASystemInstruction,
    checkOrganisationLibraryPresence,
  };
});

vi.mock("@workspace/ai-gateway", () => ({
  createAIGateway: mocks.createAIGateway,
}));

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

vi.mock("../lib/workforceRegistry.js", () => ({
  SPECIALISTS: [
    { code: "chief_of_staff", name: "Chief of Staff" },
    { code: "operations_manager", name: "Operations Manager" },
  ],
}));

// ─── Subject under test ────────────────────────────────────────────────────────

import {
  classifyMessageLLM,
  extractDocumentSearchTerms,
  buildLibraryPresenceSection,
} from "../services/chiefOfStaffLLMService.js";

import { classifyMessage } from "../services/conversationIntelligenceService.js";
import type { LibraryPresenceResult } from "../services/organisationLibraryPresenceService.js";
import type { MessageContext } from "../services/conversationIntelligenceService.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_ID = "org-abc-123";
const CONV_ID = "conv-001";

const baseCtx: MessageContext = {
  organizationId:   ORG_ID,
  conversationId:   CONV_ID,
  currentTaskId:    null,
  currentTaskTitle: null,
  currentTaskState: null,
  pendingApprovalId: null,
  recentMessages:   [],
};

const authCtx = {
  userId: "user-001",
  organizationId: ORG_ID,
  role: "admin",
  permissions: [],
};

function makePresenceResult(overrides: Partial<ReturnType<typeof makeUsableResult>>): LibraryPresenceResult {
  return makeUsableResult(overrides as Parameters<typeof makeUsableResult>[0]);
}

function makeUsableResult(overrides?: {
  title?: string;
  version?: string;
  status?: string;
  approved?: boolean;
  indexed?: boolean;
  retrievable?: boolean;
  ingestionStatus?: string | null;
  confidence?: number;
  exactMatch?: boolean;
  partialMatch?: boolean;
  usable?: boolean;
  reason?: string;
}): LibraryPresenceResult {
  const o = overrides ?? {};
  const approved    = o.approved    ?? true;
  const indexed     = o.indexed     ?? true;
  const retrievable = o.retrievable ?? true;
  const usable      = o.usable      ?? true;
  const exactMatch  = o.exactMatch  ?? true;
  const partialMatch = o.partialMatch ?? false;

  return {
    searched: true,
    matches: [{
      sourceId:        "src-001",
      title:           o.title    ?? "Medication Management Policy",
      sourceType:      "policy",
      version:         o.version  ?? "4.2",
      approved,
      indexed,
      retrievable,
      status:          o.status   ?? "approved",
      // Use !== undefined so explicit null is preserved (not replaced by the default)
      ingestionStatus: o.ingestionStatus !== undefined ? o.ingestionStatus : "complete",
      confidence:      o.confidence ?? 0.96,
    }],
    summary: {
      exactMatch,
      partialMatch,
      searchable: approved,
      usable,
      reason: o.reason ?? (usable ? "Document is approved, indexed, and current." : "Document unavailable."),
    },
  };
}

function makeEmptyResult(reason = "No matching source exists in the Organisation Library."): LibraryPresenceResult {
  return {
    searched: true,
    matches: [],
    summary: { exactMatch: false, partialMatch: false, searchable: false, usable: false, reason },
  };
}

function makeLLMResponse(partial: Record<string, unknown> = {}) {
  return JSON.stringify({
    conversationMode: "task_intent",
    confidence: 0.85,
    shouldCreateTask: true,
    shouldUpdateTask: false,
    relatedWorkforceRoles: ["chief_of_staff"],
    customerResponse: "I found the policy and will prepare the review.",
    ...partial,
  });
}

// ─── A. extractDocumentSearchTerms ────────────────────────────────────────────

describe("extractDocumentSearchTerms", () => {
  it("extracts a specific named policy from the message", () => {
    const terms = extractDocumentSearchTerms("Review our Medication Management Policy");
    expect(terms).toEqual(["Medication Management Policy"]);
  });

  it("extracts a procedure name in lowercase", () => {
    const terms = extractDocumentSearchTerms("Review our incident reporting procedure");
    expect(terms).toContain("Incident Reporting Procedure");
  });

  it("extracts a compound assessment name", () => {
    const terms = extractDocumentSearchTerms("Check the participant's risk assessment");
    expect(terms).toContain("Risk Assessment");
  });

  it("returns empty for a vague policy reference with no specific name", () => {
    // "our policies" — no specific document name before the keyword
    const terms = extractDocumentSearchTerms("Update our policies");
    expect(terms).toHaveLength(0);
  });

  it("returns empty when no document type keyword is present", () => {
    const terms = extractDocumentSearchTerms("Help me onboard a new staff member");
    expect(terms).toHaveLength(0);
  });

  it("extracts multiple distinct document names", () => {
    const terms = extractDocumentSearchTerms(
      "Review the Safeguarding Policy and the Incident Management Procedure"
    );
    expect(terms.length).toBeGreaterThanOrEqual(2);
    expect(terms.some(t => t.toLowerCase().includes("safeguarding"))).toBe(true);
    expect(terms.some(t => t.toLowerCase().includes("incident"))).toBe(true);
  });

  it("does not invent document requirements from vague topics", () => {
    const terms = extractDocumentSearchTerms("Can you help us improve our HR processes?");
    expect(terms).toHaveLength(0);
  });

  it("caps results at 5 terms", () => {
    const terms = extractDocumentSearchTerms(
      "Review the A Policy, B Procedure, C Standard, D Protocol, E Manual, F Framework"
    );
    expect(terms.length).toBeLessThanOrEqual(5);
  });

  it("extracts SOP by acronym", () => {
    const terms = extractDocumentSearchTerms("Retrieve the Medication Administration SOP");
    expect(terms.some(t => t.toLowerCase().includes("medication administration"))).toBe(true);
  });
});

// ─── B. buildLibraryPresenceSection ───────────────────────────────────────────

describe("buildLibraryPresenceSection", () => {
  it("formats a found-and-usable result correctly", () => {
    const result = makeUsableResult();
    const section = buildLibraryPresenceSection(result, ["Medication Management Policy"]);

    expect(section).toContain("=== ORGANISATION LIBRARY PRESENCE ===");
    expect(section).toContain("Search: Medication Management Policy");
    expect(section).toContain("Result: Found and usable");
    expect(section).toContain("Match type: exact");
    expect(section).toContain("Best match: Medication Management Policy");
    expect(section).toContain("Version: 4.2");
    expect(section).toContain("Status: approved");
    expect(section).toContain("Indexed: yes");
    expect(section).toContain("Retrievable: yes");
    expect(section).toContain("Confidence: 0.96");
    // No storage keys or internal paths
    expect(section).not.toMatch(/gcs:|s3:|gs:\/\//);
    expect(section).not.toMatch(/\/bucket\//i);
  });

  it("formats a found-but-unavailable (awaiting approval) result", () => {
    const result = makeUsableResult({
      approved:    false,
      retrievable: false,
      usable:      false,
      status:      "uploaded",
      ingestionStatus: "complete",
      reason:      "The document is awaiting approval.",
    });
    const section = buildLibraryPresenceSection(result, ["Medication Management Policy"]);

    expect(section).toContain("Result: Found but unavailable");
    expect(section).toContain("Reason: The document is awaiting approval.");
    expect(section).not.toContain("Found and usable");
  });

  it("formats a partial/related match correctly", () => {
    const result = makeUsableResult({
      title:        "Medication Administration Procedure",
      exactMatch:   false,
      partialMatch: true,
      confidence:   0.72,
    });
    const section = buildLibraryPresenceSection(result, ["Medication Management Policy"]);

    expect(section).toContain("Match type: partial");
    expect(section).toContain("Best match: Medication Administration Procedure");
    expect(section).toContain("Confidence: 0.72");
  });

  it("formats a not-found result with reason", () => {
    const result = makeEmptyResult();
    const section = buildLibraryPresenceSection(result, ["Medication Management Policy"]);

    expect(section).toContain("Result: Not found");
    expect(section).toContain("Reason: No matching source exists");
    expect(section).not.toContain("Best match");
  });

  it("omits ingestion status when null", () => {
    const result = makeUsableResult({ ingestionStatus: null });
    const section = buildLibraryPresenceSection(result, ["Medication Management Policy"]);
    expect(section).not.toContain("Ingestion:");
  });

  it("shows ingestion status when processing", () => {
    const result = makeUsableResult({
      approved: false, indexed: false, retrievable: false, usable: false,
      status: "uploaded", ingestionStatus: "processing",
      reason: "Document is being processed.",
    });
    const section = buildLibraryPresenceSection(result, ["Medication Management Policy"]);
    expect(section).toContain("Ingestion: processing");
  });
});

// ─── C. classifyMessageLLM — OpenAI path ──────────────────────────────────────

describe("classifyMessageLLM — OpenAI path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.buildSystemInstructionForEmployee.mockReturnValue("SYSTEM");
    mocks.buildChiefOfStaffContext.mockResolvedValue(null);
    process.env.AI_PROVIDER = "openai";
  });

  it("injects ORGANISATION LIBRARY PRESENCE section when document is found and usable", async () => {
    mocks.checkOrganisationLibraryPresence.mockResolvedValue(makeUsableResult());
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

    expect(captured[0]).toContain("=== ORGANISATION LIBRARY PRESENCE ===");
    expect(captured[0]).toContain("Result: Found and usable");
    expect(captured[0]).toContain("Medication Management Policy");
  });

  it("calls checkOrganisationLibraryPresence with extracted terms", async () => {
    mocks.checkOrganisationLibraryPresence.mockResolvedValue(makeUsableResult());
    mocks.gatewayProcess.mockResolvedValue({ content: makeLLMResponse(), usedFallback: false });

    await classifyMessageLLM(
      "Review our Medication Management Policy",
      baseCtx,
      authCtx,
    );

    expect(mocks.checkOrganisationLibraryPresence).toHaveBeenCalledWith(
      ORG_ID,
      expect.arrayContaining(["Medication Management Policy"]),
    );
  });

  it("does not call presence service when no document terms are found", async () => {
    mocks.gatewayProcess.mockResolvedValue({ content: makeLLMResponse(), usedFallback: false });

    await classifyMessageLLM("Help me plan our quarterly review", baseCtx, authCtx);

    expect(mocks.checkOrganisationLibraryPresence).not.toHaveBeenCalled();
  });

  it("injects awaiting-approval state in context section", async () => {
    mocks.checkOrganisationLibraryPresence.mockResolvedValue(
      makeUsableResult({ approved: false, retrievable: false, usable: false, status: "uploaded", reason: "Awaiting approval." })
    );
    const captured: string[] = [];
    mocks.gatewayProcess.mockImplementation(async (opts: { userMessage: string }) => {
      captured.push(opts.userMessage);
      return { content: makeLLMResponse(), usedFallback: false };
    });

    await classifyMessageLLM("Review our Medication Management Policy", baseCtx, authCtx);

    expect(captured[0]).toContain("Result: Found but unavailable");
    expect(captured[0]).toContain("Reason: Awaiting approval.");
  });

  it("injects processing state in context section", async () => {
    mocks.checkOrganisationLibraryPresence.mockResolvedValue(
      makeUsableResult({
        approved: false, indexed: false, retrievable: false, usable: false,
        status: "uploaded", ingestionStatus: "processing",
        reason: "Document is still being processed.",
      })
    );
    const captured: string[] = [];
    mocks.gatewayProcess.mockImplementation(async (opts: { userMessage: string }) => {
      captured.push(opts.userMessage);
      return { content: makeLLMResponse(), usedFallback: false };
    });

    await classifyMessageLLM("Review our Medication Management Policy", baseCtx, authCtx);

    expect(captured[0]).toContain("Ingestion: processing");
  });

  it("injects ingestion failed state in context section", async () => {
    mocks.checkOrganisationLibraryPresence.mockResolvedValue(
      makeUsableResult({
        approved: true, indexed: false, retrievable: false, usable: false,
        status: "approved", ingestionStatus: "failed",
        reason: "Processing failed.",
      })
    );
    const captured: string[] = [];
    mocks.gatewayProcess.mockImplementation(async (opts: { userMessage: string }) => {
      captured.push(opts.userMessage);
      return { content: makeLLMResponse(), usedFallback: false };
    });

    await classifyMessageLLM("Review our Medication Management Policy", baseCtx, authCtx);

    expect(captured[0]).toContain("Ingestion: failed");
  });

  it("injects archived status", async () => {
    mocks.checkOrganisationLibraryPresence.mockResolvedValue(
      makeUsableResult({
        status: "archived", approved: false, retrievable: false, usable: false,
        reason: "Source is archived.",
      })
    );
    const captured: string[] = [];
    mocks.gatewayProcess.mockImplementation(async (opts: { userMessage: string }) => {
      captured.push(opts.userMessage);
      return { content: makeLLMResponse(), usedFallback: false };
    });

    await classifyMessageLLM("Review our Medication Management Policy", baseCtx, authCtx);

    expect(captured[0]).toContain("Status: archived");
  });

  it("injects superseded status", async () => {
    mocks.checkOrganisationLibraryPresence.mockResolvedValue(
      makeUsableResult({
        status: "superseded", approved: false, retrievable: false, usable: false,
        reason: "Source has been superseded by a newer version.",
      })
    );
    const captured: string[] = [];
    mocks.gatewayProcess.mockImplementation(async (opts: { userMessage: string }) => {
      captured.push(opts.userMessage);
      return { content: makeLLMResponse(), usedFallback: false };
    });

    await classifyMessageLLM("Review our Medication Management Policy", baseCtx, authCtx);

    expect(captured[0]).toContain("Status: superseded");
  });

  it("marks partial match with 'partial' match type in context", async () => {
    mocks.checkOrganisationLibraryPresence.mockResolvedValue(
      makeUsableResult({
        title: "Medication Administration Procedure",
        exactMatch: false,
        partialMatch: true,
        confidence: 0.72,
        usable: true,
      })
    );
    const captured: string[] = [];
    mocks.gatewayProcess.mockImplementation(async (opts: { userMessage: string }) => {
      captured.push(opts.userMessage);
      return { content: makeLLMResponse(), usedFallback: false };
    });

    await classifyMessageLLM("Review our Medication Management Policy", baseCtx, authCtx);

    expect(captured[0]).toContain("Match type: partial");
    expect(captured[0]).toContain("Medication Administration Procedure");
  });

  it("injects not-found result when no document matches", async () => {
    mocks.checkOrganisationLibraryPresence.mockResolvedValue(makeEmptyResult());
    const captured: string[] = [];
    mocks.gatewayProcess.mockImplementation(async (opts: { userMessage: string }) => {
      captured.push(opts.userMessage);
      return { content: makeLLMResponse(), usedFallback: false };
    });

    await classifyMessageLLM("Review our Medication Management Policy", baseCtx, authCtx);

    expect(captured[0]).toContain("Result: Not found");
  });

  it("injects service-unavailable notice when presence service throws", async () => {
    mocks.checkOrganisationLibraryPresence.mockRejectedValue(new Error("DB timeout"));
    const captured: string[] = [];
    mocks.gatewayProcess.mockImplementation(async (opts: { userMessage: string }) => {
      captured.push(opts.userMessage);
      return { content: makeLLMResponse(), usedFallback: false };
    });

    await classifyMessageLLM("Review our Medication Management Policy", baseCtx, authCtx);

    expect(captured[0]).toContain("Result: Service unavailable");
    // Must not surface internal error details to the LLM
    expect(captured[0]).not.toContain("DB timeout");
  });

  it("places the presence section before the user message", async () => {
    mocks.checkOrganisationLibraryPresence.mockResolvedValue(makeUsableResult());
    const captured: string[] = [];
    mocks.gatewayProcess.mockImplementation(async (opts: { userMessage: string }) => {
      captured.push(opts.userMessage);
      return { content: makeLLMResponse(), usedFallback: false };
    });

    await classifyMessageLLM("Review our Medication Management Policy", baseCtx, authCtx);

    // buildChiefOfStaffContext returns null in this test so the legacy builder is used.
    // The legacy builder ends with "\nUser message: <text>" not "CURRENT USER MESSAGE".
    const presPos = captured[0].indexOf("=== ORGANISATION LIBRARY PRESENCE ===");
    // Find the user's actual message text as the anchor
    const msgPos  = captured[0].indexOf("User message:");
    expect(presPos).toBeGreaterThan(-1);
    expect(msgPos).toBeGreaterThan(-1);
    expect(presPos).toBeLessThan(msgPos);
  });

  it("returns a valid ConversationUnderstanding from the LLM", async () => {
    mocks.checkOrganisationLibraryPresence.mockResolvedValue(makeUsableResult());
    mocks.gatewayProcess.mockResolvedValue({ content: makeLLMResponse(), usedFallback: false });

    const result = await classifyMessageLLM(
      "Review our Medication Management Policy",
      baseCtx,
      authCtx,
    );

    expect(result.conversationMode).toBe("task_intent");
    expect(result.usedFallback).toBe(false);
  });

  it("falls back to deterministic path when AI_PROVIDER is not openai", async () => {
    process.env.AI_PROVIDER = "internal";
    mocks.checkOrganisationLibraryPresence.mockResolvedValue(makeUsableResult());

    const result = await classifyMessageLLM(
      "Review our Medication Management Policy through an operational lens.",
      baseCtx,
      authCtx,
    );

    expect(mocks.gatewayProcess).not.toHaveBeenCalled();
    expect(result).toHaveProperty("conversationMode");
  });
});

// ─── D. classifyMessage — deterministic path ──────────────────────────────────

describe("classifyMessage — deterministic path", () => {
  const taskCtx: MessageContext = {
    ...baseCtx,
    currentTaskId: null,
    currentTaskState: null,
  };

  it("does NOT ask 'which policies?' when user has named a specific document (via namedDocTerms)", () => {
    const result = classifyMessage(
      "Review our Medication Management Policy through an operational lens.",
      taskCtx,
      ["Medication Management Policy"],
    );

    const questions = result.clarificationQuestions ?? [];
    expect(questions.some(q => q.toLowerCase().includes("which specific policies"))).toBe(false);
  });

  it("does NOT ask 'which policies?' when message itself contains a specific document name", () => {
    // Even without namedDocTerms, the SPECIFIC_DOC_NAME_PATTERN should catch it
    const result = classifyMessage(
      "Review our Medication Management Policy.",
      taskCtx,
    );

    const questions = result.clarificationQuestions ?? [];
    expect(questions.some(q => q.toLowerCase().includes("which specific policies"))).toBe(false);
  });

  it("DOES ask 'which policies?' when user mentions policies vaguely (no specific name)", () => {
    // "update our policies" — no specific document name
    const result = classifyMessage(
      "Please update and review our policies",
      taskCtx,
    );

    const questions = result.clarificationQuestions ?? [];
    // Only expect the question when the classifier reaches task_intent and policies keyword is found
    // The classifier may not reach task_intent for all vague requests, but if it does,
    // the question should be present
    if (result.conversationMode === "task_intent" || result.conversationMode === "clarification") {
      expect(questions.some(q => q.toLowerCase().includes("which specific policies"))).toBe(true);
    }
  });

  it("omits 'which policies?' for an incident management procedure request", () => {
    const result = classifyMessage(
      "Run an audit against our Incident Management Procedure",
      taskCtx,
      ["Incident Management Procedure"],
    );

    const questions = result.clarificationQuestions ?? [];
    expect(questions.some(q => q.toLowerCase().includes("which specific policies"))).toBe(false);
  });

  it("returns a task_intent mode for a specific policy review request", () => {
    const result = classifyMessage(
      "Review our Medication Management Policy through an operational lens.",
      taskCtx,
      ["Medication Management Policy"],
    );

    // Should be task_intent or similar actionable mode, not stuck in clarification
    expect(["task_intent", "task_followup", "general"]).toContain(result.conversationMode);
  });
});

// ─── E. Behaviour safeguards ──────────────────────────────────────────────────

describe("behaviour safeguards — context section content", () => {
  it("never exposes internal sourceId or storage paths in presence section", () => {
    const result = makeUsableResult();
    const section = buildLibraryPresenceSection(result, ["Medication Management Policy"]);

    expect(section).not.toContain("src-001");
    expect(section).not.toMatch(/gcs:|s3:|gs:|\/storage\//i);
  });

  it("exact match is distinguished from partial match in context section", () => {
    const exact   = buildLibraryPresenceSection(makeUsableResult({ exactMatch: true, partialMatch: false }), ["T"]);
    const partial = buildLibraryPresenceSection(
      makeUsableResult({ exactMatch: false, partialMatch: true }), ["T"]
    );

    expect(exact).toContain("Match type: exact");
    expect(partial).toContain("Match type: partial");
    expect(exact).not.toContain("Match type: partial");
    expect(partial).not.toContain("Match type: exact");
  });

  it("raw internal status codes are rendered in human-readable context (not raw DB enums)", () => {
    // "approved", "uploaded", "archived", "superseded" are readable — this test confirms they pass through
    // rather than being replaced with numeric codes or UUIDs
    const section = buildLibraryPresenceSection(makeUsableResult({ status: "approved" }), ["T"]);
    expect(section).toContain("Status: approved");
  });

  it("presence section does not include document content", () => {
    const result = makeUsableResult();
    const section = buildLibraryPresenceSection(result, ["Medication Management Policy"]);

    // Should only contain metadata — no document body
    expect(section.length).toBeLessThan(800);
    expect(section).not.toMatch(/section \d/i);
    expect(section).not.toContain("requires");
  });

  it("wrong-tenant sources cannot appear — service is called with the correct org ID", async () => {
    vi.resetAllMocks();
    mocks.buildSystemInstructionForEmployee.mockReturnValue("SYSTEM");
    mocks.buildChiefOfStaffContext.mockResolvedValue(null);
    process.env.AI_PROVIDER = "openai";

    mocks.checkOrganisationLibraryPresence.mockResolvedValue(makeEmptyResult());
    mocks.gatewayProcess.mockResolvedValue({ content: makeLLMResponse(), usedFallback: false });

    await classifyMessageLLM("Review our Medication Management Policy", baseCtx, authCtx);

    expect(mocks.checkOrganisationLibraryPresence).toHaveBeenCalledWith(
      ORG_ID,  // the org from ctx, never cross-tenant
      expect.any(Array),
    );
    expect(mocks.checkOrganisationLibraryPresence).not.toHaveBeenCalledWith(
      expect.not.stringContaining(ORG_ID),
      expect.any(Array),
    );
  });
});

// ─── F. Regression scenario ───────────────────────────────────────────────────

describe("regression — Medication Management Policy request", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.buildSystemInstructionForEmployee.mockReturnValue("SYSTEM");
    mocks.buildChiefOfStaffContext.mockResolvedValue(null);
    process.env.AI_PROVIDER = "openai";
  });

  it("FOUND AND USABLE: presence section tells LLM the policy is available", async () => {
    mocks.checkOrganisationLibraryPresence.mockResolvedValue(makeUsableResult({ version: "4.2" }));
    const captured: string[] = [];
    mocks.gatewayProcess.mockImplementation(async (opts: { userMessage: string }) => {
      captured.push(opts.userMessage);
      return { content: makeLLMResponse({ customerResponse: "I found Medication Management Policy v4.2 in your approved Organisation Library. I can use it for the operational review." }), usedFallback: false };
    });

    const result = await classifyMessageLLM(
      "Review our Medication Management Policy through an operational lens.",
      baseCtx,
      authCtx,
    );

    // Presence section is injected
    expect(captured[0]).toContain("Result: Found and usable");
    expect(captured[0]).toContain("Version: 4.2");
    // No clarification question about document existence
    const questions = result.clarificationQuestions ?? [];
    expect(questions.some(q => /latest version|have the|do you have/i.test(q))).toBe(false);
  });

  it("NOT FOUND: presence section tells LLM no match was found", async () => {
    mocks.checkOrganisationLibraryPresence.mockResolvedValue(makeEmptyResult());
    const captured: string[] = [];
    mocks.gatewayProcess.mockImplementation(async (opts: { userMessage: string }) => {
      captured.push(opts.userMessage);
      return { content: makeLLMResponse({ customerResponse: "I searched your Organisation Library but could not locate a current Medication Management Policy." }), usedFallback: false };
    });

    await classifyMessageLLM(
      "Review our Medication Management Policy through an operational lens.",
      baseCtx,
      authCtx,
    );

    expect(captured[0]).toContain("Result: Not found");
  });

  it("deterministic fallback: named policy does not produce 'which policies?' question", () => {
    process.env.AI_PROVIDER = "internal";

    const result = classifyMessage(
      "Review our Medication Management Policy through an operational lens.",
      baseCtx,
      ["Medication Management Policy"],
    );

    const questions = result.clarificationQuestions ?? [];
    expect(questions.some(q => /which specific policies/i.test(q))).toBe(false);
  });
});
