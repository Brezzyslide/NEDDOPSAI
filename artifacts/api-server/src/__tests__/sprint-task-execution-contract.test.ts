/**
 * Task Execution Data-Field Contract Tests
 *
 * Verifies the least-privilege permission contract for purpose="task_execution"
 * in the AI gateway. Covers:
 *
 *   Core contract   — all 6 data classes permitted
 *   Denials         — excluded fields, wrong-class fields, unknown fields
 *   Purpose separation — conversation_intelligence vs task_execution vs knowledge_retrieval
 *   Structural safety  — storageKey, embedding vectors, hidden prompts rejected
 *   Regression        — "Review our Medication Management Policy" full flow passes gateway
 *
 * Classification: MOCKED — no external provider calls; internal DB audit writes only.
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import {
  createAIGateway,
  AIGatewayDataError,
  PURPOSE_FIELD_ALLOWLIST,
  type AIGatewayContext,
} from "@workspace/ai-gateway";

// ─── Test helpers ─────────────────────────────────────────────────────────────

const TEST_ORG_ID = randomUUID();
const TEST_USER_ID = randomUUID();

function execCtx(overrides: Partial<AIGatewayContext> = {}): AIGatewayContext {
  return {
    userId: TEST_USER_ID,
    organizationId: TEST_ORG_ID,
    role: "administrator",
    permissions: [],
    purpose: "task_execution",
    correlationId: randomUUID(),
    provider: "internal",
    retentionClass: "operational",
    requiresHumanApproval: true,
    ...overrides,
  };
}

function purposeCtx(purpose: AIGatewayContext["purpose"]): AIGatewayContext {
  return execCtx({ purpose });
}

// ─── Part 1 — Core contract: all permitted data classes ───────────────────────

describe("task_execution data-field contract — core permissions", () => {

  it("permits task_core fields", () => {
    const gw = createAIGateway(execCtx());
    expect(() => gw.validateRetrievedFields([
      "task.id", "task.title", "task.description", "task.executionPlan",
    ])).not.toThrow();
  });

  it("permits specialist_identity fields", () => {
    const gw = createAIGateway(execCtx());
    expect(() => gw.validateRetrievedFields([
      "specialist.name", "specialist.capabilities",
    ])).not.toThrow();
  });

  it("permits approved_organisation_evidence fields (ManifestLibrarySource sans storageKey)", () => {
    const gw = createAIGateway(execCtx());
    expect(() => gw.validateRetrievedFields([
      "organisationLibrarySources.sourceId",
      "organisationLibrarySources.title",
      "organisationLibrarySources.sourceType",
      "organisationLibrarySources.versionLabel",
      "organisationLibrarySources.authorityLevel",
      "organisationLibrarySources.relevantChunks.text",
      "organisationLibrarySources.relevantChunks.confidence",
    ])).not.toThrow();
  });

  it("permits approved_organisation_memory fields (ManifestMemoryRef title reference)", () => {
    const gw = createAIGateway(execCtx());
    expect(() => gw.validateRetrievedFields([
      "cosMemories.memoryId",
      "cosMemories.memoryType",
      "cosMemories.title",
      "cosMemories.approvalStatus",
    ])).not.toThrow();
  });

  it("permits task_scoped_uploads fields (no storageKey or authorityLevel)", () => {
    const gw = createAIGateway(execCtx());
    expect(() => gw.validateRetrievedFields([
      "taskUploads.sourceId",
      "taskUploads.title",
      "taskUploads.sourceType",
      "taskUploads.versionLabel",
    ])).not.toThrow();
  });

  it("permits entity_scoped_knowledge fields", () => {
    const gw = createAIGateway(execCtx());
    expect(() => gw.validateRetrievedFields([
      "entityKnowledge.entityType",
      "entityKnowledge.entityId",
      "entityKnowledge.title",
      "entityKnowledge.relevantContent",
      "entityKnowledge.clearance",
    ])).not.toThrow();
  });

  it("permits the full pipeline retrievedFields array (all 21 declared paths)", () => {
    const gw = createAIGateway(execCtx());
    const pipelineFields = [
      "organisationLibrarySources.sourceId",
      "organisationLibrarySources.title",
      "organisationLibrarySources.sourceType",
      "organisationLibrarySources.versionLabel",
      "organisationLibrarySources.authorityLevel",
      "organisationLibrarySources.relevantChunks.text",
      "organisationLibrarySources.relevantChunks.confidence",
      "cosMemories.memoryId",
      "cosMemories.memoryType",
      "cosMemories.title",
      "cosMemories.approvalStatus",
      "taskUploads.sourceId",
      "taskUploads.title",
      "taskUploads.sourceType",
      "taskUploads.versionLabel",
      "entityKnowledge.entityType",
      "entityKnowledge.entityId",
      "entityKnowledge.title",
      "entityKnowledge.relevantContent",
      "entityKnowledge.clearance",
    ];
    expect(() => gw.validateRetrievedFields(pipelineFields)).not.toThrow();
    expect(pipelineFields).toHaveLength(20);
  });
});

// ─── Part 2 — Denials ──────────────────────────────────────────────────────────

describe("task_execution data-field contract — denials", () => {

  it("denies raw GCS storageKey from library sources", () => {
    const gw = createAIGateway(execCtx());
    expect(() => gw.validateRetrievedFields(["organisationLibrarySources.storageKey"]))
      .toThrow(AIGatewayDataError);
  });

  it("denies raw GCS storageKey from task uploads", () => {
    const gw = createAIGateway(execCtx());
    expect(() => gw.validateRetrievedFields(["taskUploads.storageKey"]))
      .toThrow(AIGatewayDataError);
  });

  it("denies taskUploads.authorityLevel (user uploads have no authority level)", () => {
    const gw = createAIGateway(execCtx());
    expect(() => gw.validateRetrievedFields(["taskUploads.authorityLevel"]))
      .toThrow(AIGatewayDataError);
  });

  it("denies unapproved library source using legacy flat snake_case name", () => {
    const gw = createAIGateway(execCtx());
    expect(() => gw.validateRetrievedFields(["organisation_library_sources"]))
      .toThrow(AIGatewayDataError);
  });

  it("denies legacy flat cos_memories name", () => {
    const gw = createAIGateway(execCtx());
    expect(() => gw.validateRetrievedFields(["cos_memories"]))
      .toThrow(AIGatewayDataError);
  });

  it("denies legacy flat entity_knowledge name", () => {
    const gw = createAIGateway(execCtx());
    expect(() => gw.validateRetrievedFields(["entity_knowledge"]))
      .toThrow(AIGatewayDataError);
  });

  it("denies legacy flat task_uploads name", () => {
    const gw = createAIGateway(execCtx());
    expect(() => gw.validateRetrievedFields(["task_uploads"]))
      .toThrow(AIGatewayDataError);
  });

  it("denies embedding vectors", () => {
    const gw = createAIGateway(execCtx());
    expect(() => gw.validateRetrievedFields(["organisationLibrarySources.embeddingVector"]))
      .toThrow(AIGatewayDataError);
  });

  it("denies hidden system prompt fields", () => {
    const gw = createAIGateway(execCtx());
    expect(() => gw.validateRetrievedFields(["specialist.systemPrompt"]))
      .toThrow(AIGatewayDataError);
  });

  it("denies internal chain-of-thought", () => {
    const gw = createAIGateway(execCtx());
    expect(() => gw.validateRetrievedFields(["specialist.internalChainOfThought"]))
      .toThrow(AIGatewayDataError);
  });

  it("denies participant PII fields", () => {
    const gw = createAIGateway(execCtx());
    expect(() => gw.validateRetrievedFields(["participant.dateOfBirth"]))
      .toThrow(AIGatewayDataError);
    expect(() => gw.validateRetrievedFields(["participant.ndisNumber"]))
      .toThrow(AIGatewayDataError);
  });

  it("denies any unknown field not in the explicit allowlist", () => {
    const gw = createAIGateway(execCtx());
    expect(() => gw.validateRetrievedFields(["someNewField.thatWasAddedLater"]))
      .toThrow(AIGatewayDataError);
  });

  it("denies a mix of permitted and forbidden — all-or-nothing", () => {
    const gw = createAIGateway(execCtx());
    expect(() => gw.validateRetrievedFields([
      "organisationLibrarySources.title",       // permitted
      "organisationLibrarySources.storageKey",  // forbidden
    ])).toThrow(AIGatewayDataError);
  });

  it("AIGatewayDataError.deniedFields lists exactly the rejected paths", () => {
    const gw = createAIGateway(execCtx());
    try {
      gw.validateRetrievedFields([
        "organisationLibrarySources.title",       // permitted
        "organisationLibrarySources.storageKey",  // forbidden
        "participant.ndisNumber",                 // forbidden
      ]);
      expect.fail("Expected AIGatewayDataError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AIGatewayDataError);
      const dataErr = err as AIGatewayDataError;
      expect(dataErr.deniedFields).toContain("organisationLibrarySources.storageKey");
      expect(dataErr.deniedFields).toContain("participant.ndisNumber");
      expect(dataErr.deniedFields).not.toContain("organisationLibrarySources.title");
      expect(dataErr.code).toBe("DATA_NOT_PERMITTED");
    }
  });

  it("deniedFields is always an array even when one field denied", () => {
    const gw = createAIGateway(execCtx());
    try {
      gw.validateRetrievedFields(["taskUploads.storageKey"]);
    } catch (err) {
      expect(err).toBeInstanceOf(AIGatewayDataError);
      expect(Array.isArray((err as AIGatewayDataError).deniedFields)).toBe(true);
      expect((err as AIGatewayDataError).deniedFields).toHaveLength(1);
    }
  });
});

// ─── Part 3 — Purpose separation matrix ──────────────────────────────────────

describe("task_execution data-field contract — purpose separation", () => {

  it("conversation_intelligence cannot receive evidence chunks", () => {
    const gw = createAIGateway(purposeCtx("conversation_intelligence"));
    expect(() => gw.validateRetrievedFields(["organisationLibrarySources.relevantChunks.text"]))
      .toThrow(AIGatewayDataError);
  });

  it("conversation_intelligence cannot receive organisation library sources", () => {
    const gw = createAIGateway(purposeCtx("conversation_intelligence"));
    expect(() => gw.validateRetrievedFields(["organisationLibrarySources.sourceId"]))
      .toThrow(AIGatewayDataError);
  });

  it("task_execution can receive evidence chunks", () => {
    const gw = createAIGateway(purposeCtx("task_execution"));
    expect(() => gw.validateRetrievedFields([
      "organisationLibrarySources.relevantChunks.text",
      "organisationLibrarySources.relevantChunks.confidence",
    ])).not.toThrow();
  });

  it("knowledge_retrieval uses knowledge.* fields, not organisationLibrarySources.*", () => {
    const gw = createAIGateway(purposeCtx("knowledge_retrieval"));
    expect(() => gw.validateRetrievedFields(["knowledge.chunk", "knowledge.source", "knowledge.relevanceScore"]))
      .not.toThrow();
    expect(() => gw.validateRetrievedFields(["organisationLibrarySources.title"]))
      .toThrow(AIGatewayDataError);
  });

  it("task_planning cannot receive organisation evidence or memory", () => {
    const gw = createAIGateway(purposeCtx("task_planning"));
    expect(() => gw.validateRetrievedFields(["organisationLibrarySources.title"]))
      .toThrow(AIGatewayDataError);
    expect(() => gw.validateRetrievedFields(["cosMemories.title"]))
      .toThrow(AIGatewayDataError);
  });

  it("report_generation cannot receive individual record content", () => {
    const gw = createAIGateway(purposeCtx("report_generation"));
    expect(() => gw.validateRetrievedFields(["organisationLibrarySources.title"]))
      .toThrow(AIGatewayDataError);
    expect(() => gw.validateRetrievedFields(["cosMemories.title"]))
      .toThrow(AIGatewayDataError);
  });

  it("report_generation is limited to aggregate fields only", () => {
    const gw = createAIGateway(purposeCtx("report_generation"));
    expect(() => gw.validateRetrievedFields(["task.aggregates", "approval.aggregates"]))
      .not.toThrow();
  });

  it("internal_tooling has an empty field allowlist (no customer data)", () => {
    const allowlist = PURPOSE_FIELD_ALLOWLIST["internal_tooling"];
    expect(allowlist).toHaveLength(0);
  });

  it("purpose names in allowlist match the AIPurpose union (no phantom purposes)", () => {
    // Every key in PURPOSE_FIELD_ALLOWLIST must be a valid AIPurpose value.
    // This protects against typos like "self_review" or "conversation" that don't exist.
    const registeredPurposes = Object.keys(PURPOSE_FIELD_ALLOWLIST);
    const expectedPurposes = [
      "task_planning", "task_execution", "workforce_routing",
      "compliance_check", "report_generation", "knowledge_retrieval",
      "search_assistance", "conversation_intelligence",
      "internal_tooling", "testing",
    ];
    expect(registeredPurposes.sort()).toEqual(expectedPurposes.sort());
  });
});

// ─── Part 4 — Allowlist integrity ─────────────────────────────────────────────

describe("task_execution data-field contract — allowlist integrity", () => {

  it("task_execution allowlist contains all 6 data classes", () => {
    const allowlist = PURPOSE_FIELD_ALLOWLIST["task_execution"];
    expect(allowlist.some(f => f.startsWith("task."))).toBe(true);
    expect(allowlist.some(f => f.startsWith("specialist."))).toBe(true);
    expect(allowlist.some(f => f.startsWith("organisationLibrarySources."))).toBe(true);
    expect(allowlist.some(f => f.startsWith("cosMemories."))).toBe(true);
    expect(allowlist.some(f => f.startsWith("taskUploads."))).toBe(true);
    expect(allowlist.some(f => f.startsWith("entityKnowledge."))).toBe(true);
  });

  it("task_execution allowlist never permits storageKey", () => {
    const allowlist = PURPOSE_FIELD_ALLOWLIST["task_execution"];
    expect(allowlist.some(f => f.includes("storageKey"))).toBe(false);
  });

  it("task_execution allowlist never permits embedding vectors", () => {
    const allowlist = PURPOSE_FIELD_ALLOWLIST["task_execution"];
    expect(allowlist.some(f => f.toLowerCase().includes("embedding"))).toBe(false);
    expect(allowlist.some(f => f.toLowerCase().includes("vector"))).toBe(false);
  });

  it("task_execution allowlist never permits taskUploads.authorityLevel", () => {
    const allowlist = PURPOSE_FIELD_ALLOWLIST["task_execution"];
    expect(allowlist).not.toContain("taskUploads.authorityLevel");
  });

  it("task_execution allowlist does not grant the same broad access as every purpose", () => {
    // conversation_intelligence and task_execution must have different allowlists
    const taskExec = new Set(PURPOSE_FIELD_ALLOWLIST["task_execution"]);
    const convInt = new Set(PURPOSE_FIELD_ALLOWLIST["conversation_intelligence"]);
    // task_execution has evidence fields not in conversation_intelligence
    expect(taskExec.has("organisationLibrarySources.relevantChunks.text")).toBe(true);
    expect(convInt.has("organisationLibrarySources.relevantChunks.text")).toBe(false);
    // conversation_intelligence has fields not in task_execution
    expect(convInt.has("conversation.id")).toBe(true);
    expect(taskExec.has("conversation.id")).toBe(false);
  });
});

// ─── Part 5 — Regression: medication policy workflow ─────────────────────────

describe("task_execution data-field contract — regression", () => {

  it("gateway accepts context for 'Review our Medication Management Policy through an operational lens'", async () => {
    // This is the exact scenario that was failing with "Data fields not permitted".
    // Verifies: role resolved → purpose = task_execution → evidence fields authorised
    // → gateway accepts → Operations Manager can execute.
    const gw = createAIGateway(execCtx({
      role: "administrator",
      purpose: "task_execution",
    }));

    // Simulate the pipeline's retrievedFields declaration
    const medicationPolicyFields: string[] = [
      "organisationLibrarySources.sourceId",
      "organisationLibrarySources.title",
      "organisationLibrarySources.sourceType",
      "organisationLibrarySources.versionLabel",
      "organisationLibrarySources.authorityLevel",
      "organisationLibrarySources.relevantChunks.text",
      "organisationLibrarySources.relevantChunks.confidence",
      "cosMemories.memoryId",
      "cosMemories.memoryType",
      "cosMemories.title",
      "cosMemories.approvalStatus",
      "taskUploads.sourceId",
      "taskUploads.title",
      "taskUploads.sourceType",
      "taskUploads.versionLabel",
      "entityKnowledge.entityType",
      "entityKnowledge.entityId",
      "entityKnowledge.title",
      "entityKnowledge.relevantContent",
      "entityKnowledge.clearance",
    ];

    // Must NOT throw — these fields are all in the task_execution allowlist
    expect(() => gw.validateRetrievedFields(medicationPolicyFields)).not.toThrow();

    // Full gateway process must also accept these fields
    const response = await gw.process({
      systemPrompt: "You are the Operations Manager...",
      userMessage: "Review our Medication Management Policy through an operational lens.",
      retrievedFields: medicationPolicyFields,
      maxTokens: 3000,
    });

    expect(response.responseId).toBeDefined();
    expect(response.correlationId).toBe(gw.context.correlationId);
    expect(response.purpose).toBe("task_execution");
    expect(response.requiresHumanApproval).toBe(true);
    expect(response.auditEventId).toBeDefined();
  });

  it("gateway still rejects the legacy flat field names after fix", async () => {
    // The old pipeline passed these flat snake_case strings — they must still be rejected.
    const gw = createAIGateway(execCtx());
    try {
      await gw.process({
        systemPrompt: "test",
        userMessage: "test",
        retrievedFields: [
          "organisation_library_sources",
          "cos_memories",
          "entity_knowledge",
          "task_uploads",
        ],
      });
      expect.fail("Expected AIGatewayDataError to be thrown for legacy flat field names");
    } catch (err) {
      expect(err).toBeInstanceOf(AIGatewayDataError);
      const dataErr = err as AIGatewayDataError;
      expect(dataErr.deniedFields).toContain("organisation_library_sources");
      expect(dataErr.deniedFields).toContain("cos_memories");
      expect(dataErr.deniedFields).toContain("entity_knowledge");
      expect(dataErr.deniedFields).toContain("task_uploads");
    }
  });

  it("manager role can also perform task_execution (permitted in ROLE_PURPOSE_ALLOWLIST)", () => {
    expect(() => createAIGateway(execCtx({ role: "manager" }))).not.toThrow();
  });

  it("owner role can perform task_execution", () => {
    expect(() => createAIGateway(execCtx({ role: "owner" }))).not.toThrow();
  });
});
