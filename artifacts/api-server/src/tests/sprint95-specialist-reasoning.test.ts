/**
 * Sprint 9.5 — Specialist Intelligence Service Tests
 *
 * Tests the intelligence service with the deterministic (internal) provider.
 * No real AI calls — all tests use AI_PROVIDER=internal path.
 * Uses actual capability codes from the registry.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import {
  createSpecialistIntelligenceService,
} from "../services/specialistIntelligenceService.js";
import type { SpecialistWorkPackage, SpecialistContext } from "../services/specialistIntelligenceService.js";

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/ai-gateway", () => ({
  createAIGateway: vi.fn().mockReturnValue({
    processRequest: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        specialistRunId: "run-1",
        workforceRoleCode: "compliance_officer",
        capabilityCode: "compliance.audit_readiness",
        status: "completed",
        summary: "Test summary from mock gateway",
        findings: [
          {
            title: "Test finding",
            description: "Policy gap identified",
            severity: "medium",
            confidence: 0.85,
            evidenceReferences: [],
          },
        ],
        recommendations: [],
        risks: [],
        assumptions: [],
        unresolvedQuestions: [],
        requestedExternalActions: [],
        expectedOutputs: [],
        confidence: 0.85,
        completedAt: new Date().toISOString(),
      }),
      usage: { promptTokens: 100, completionTokens: 200 },
    }),
  }),
}));

const FAKE_WORK_PACKAGE: SpecialistWorkPackage = {
  specialistRunId: "run-1",
  organizationId: "org-1",
  taskId: "task-1",
  capabilityCode: "compliance.audit_readiness",
  capabilityLevel: "professional_analysis",
  workforceRoleCode: "compliance_officer",
  workerProfileCode: "compliance_auditor",
  objective: "Review the organisation's NDIS compliance framework",
  responsibilities: ["Identify compliance gaps"],
  expectedOutputs: ["Findings and recommendations report"],
  approvedOrganisationMemory: [
    { id: "mem-1", content: "Organisation holds NDIS registration", category: "compliance" },
  ],
  relevantConversationContext: [
    { id: "msg-1", role: "user", content: "Please review our incident response policy" },
  ],
  taskContext: [
    { id: "ctx-1", type: "task_description", content: "Review compliance framework" },
  ],
  previousSpecialistOutputs: [],
  allowedCapabilities: ["compliance.audit_readiness"],
  allowedTools: ["search_tools", "reporting_tools"],
  allowedConnectorCategories: [],
  allowedExecutionChannels: ["internal_api"],
  prohibitedActions: ["modify_data", "send_external_communication"],
  approvalRequiredActions: [],
  dependencies: [],
  assumptions: ["Organisation is currently registered with the NDIS"],
  unresolvedQuestions: [],
  riskLevel: "medium",
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
};

const FAKE_CONTEXT: SpecialistContext = {
  taskScope: "Review incident response policy",
  approvedMemory: [
    { id: "mem-1", content: "Organisation holds NDIS registration", category: "compliance" },
  ],
  pinnedDecisions: [],
  unresolvedQuestions: [],
  relevantMessages: [
    { id: "msg-1", role: "user", content: "Please review our incident response policy" },
  ],
  previousOutputs: [],
  evidenceReferences: [],
  approvalState: "not_required",
  executionEntitlementState: "not_checked",
};

describe("Sprint 9.5 — Specialist Intelligence Service", () => {
  const originalProvider = process.env.AI_PROVIDER;

  beforeAll(() => {
    process.env.AI_PROVIDER = "internal";
  });

  afterAll(() => {
    if (originalProvider !== undefined) {
      process.env.AI_PROVIDER = originalProvider;
    } else {
      delete process.env.AI_PROVIDER;
    }
  });

  describe("Deterministic provider (internal)", () => {
    it("returns a completed result for compliance_officer", async () => {
      const service = createSpecialistIntelligenceService();
      const result = await service.executeRun(FAKE_WORK_PACKAGE, FAKE_CONTEXT);
      expect(result.status).toBe("completed");
      expect(result.specialistRunId).toBe("run-1");
      expect(result.workforceRoleCode).toBe("compliance_officer");
      expect(result.capabilityCode).toBe("compliance.audit_readiness");
    });

    it("returns a completed result for document_specialist", async () => {
      const service = createSpecialistIntelligenceService();
      const pkg = { ...FAKE_WORK_PACKAGE, workforceRoleCode: "document_specialist", capabilityCode: "documents.draft", specialistRunId: "run-2" };
      const result = await service.executeRun(pkg, FAKE_CONTEXT);
      expect(result.status).toBe("completed");
      expect(result.workforceRoleCode).toBe("document_specialist");
    });

    it("returns a completed result for operations_manager", async () => {
      const service = createSpecialistIntelligenceService();
      const pkg = { ...FAKE_WORK_PACKAGE, workforceRoleCode: "operations_manager", capabilityCode: "operations.workflow_review", specialistRunId: "run-3" };
      const result = await service.executeRun(pkg, FAKE_CONTEXT);
      expect(result.status).toBe("completed");
      expect(result.workforceRoleCode).toBe("operations_manager");
    });

    it("returns blocked result for inactive specialist", async () => {
      const service = createSpecialistIntelligenceService();
      const pkg = { ...FAKE_WORK_PACKAGE, workforceRoleCode: "marketing_director", specialistRunId: "run-4" };
      const result = await service.executeRun(pkg, FAKE_CONTEXT);
      expect(result.status).toBe("blocked");
      expect(result.summary).toContain("not yet activated");
    });

    it("includes instruction version in deterministic result", async () => {
      const service = createSpecialistIntelligenceService();
      const result = await service.executeRun(FAKE_WORK_PACKAGE, FAKE_CONTEXT);
      expect(result.instructionVersion).toBe("1.0.0");
    });

    it("includes model provider as internal in deterministic result", async () => {
      const service = createSpecialistIntelligenceService();
      const result = await service.executeRun(FAKE_WORK_PACKAGE, FAKE_CONTEXT);
      expect(result.modelProvider).toBe("internal");
    });

    it("confidence is 1.0 for deterministic test mode", async () => {
      const service = createSpecialistIntelligenceService();
      const result = await service.executeRun(FAKE_WORK_PACKAGE, FAKE_CONTEXT);
      expect(result.confidence).toBe(1.0);
    });

    it("includes run ID in result", async () => {
      const service = createSpecialistIntelligenceService();
      const result = await service.executeRun(FAKE_WORK_PACKAGE, FAKE_CONTEXT);
      expect(result.specialistRunId).toBe(FAKE_WORK_PACKAGE.specialistRunId);
    });
  });

  describe("SpecialistRunResult shape", () => {
    it("always includes required fields", async () => {
      const service = createSpecialistIntelligenceService();
      const result = await service.executeRun(FAKE_WORK_PACKAGE, FAKE_CONTEXT);
      expect(typeof result.specialistRunId).toBe("string");
      expect(typeof result.workforceRoleCode).toBe("string");
      expect(typeof result.capabilityCode).toBe("string");
      expect(["completed", "blocked", "failed"]).toContain(result.status);
      expect(typeof result.summary).toBe("string");
      expect(Array.isArray(result.findings)).toBe(true);
      expect(Array.isArray(result.recommendations)).toBe(true);
      expect(Array.isArray(result.risks)).toBe(true);
      expect(Array.isArray(result.assumptions)).toBe(true);
      expect(Array.isArray(result.unresolvedQuestions)).toBe(true);
      expect(Array.isArray(result.requestedExternalActions)).toBe(true);
      expect(Array.isArray(result.expectedOutputs)).toBe(true);
      expect(typeof result.confidence).toBe("number");
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(typeof result.completedAt).toBe("string");
    });

    it("returns findings array with correct shape", async () => {
      const service = createSpecialistIntelligenceService();
      const result = await service.executeRun(FAKE_WORK_PACKAGE, FAKE_CONTEXT);
      for (const finding of result.findings) {
        expect(typeof finding.title).toBe("string");
        expect(typeof finding.description).toBe("string");
        expect(typeof finding.confidence).toBe("number");
        expect(Array.isArray(finding.evidenceReferences)).toBe(true);
      }
    });
  });

  describe("Revision and clarification", () => {
    it("revises a run with feedback", async () => {
      const service = createSpecialistIntelligenceService();
      const result = await service.reviseRun(
        "run-1",
        FAKE_WORK_PACKAGE,
        FAKE_CONTEXT,
        "Please focus more on Section 5 of the NDIS Practice Standards",
      );
      expect(result).toBeDefined();
      expect(["completed", "blocked", "failed"]).toContain(result.status);
    });

    it("resumes after clarification", async () => {
      const service = createSpecialistIntelligenceService();
      const result = await service.resumeAfterClarification(
        "run-1",
        FAKE_WORK_PACKAGE,
        FAKE_CONTEXT,
        "The incident occurred on the 15th of June 2025",
      );
      expect(result).toBeDefined();
      expect(["completed", "blocked", "failed"]).toContain(result.status);
    });
  });
});
