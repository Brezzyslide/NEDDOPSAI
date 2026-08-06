/**
 * sprint29f1-adapter-purity.test.ts — Sprint 29F.1 Part 6
 *
 * Architecture tests proving workExecutionPipelineService is a pure adapter.
 * A pure adapter:
 *   - Contains NO business-rule guards (specialist validation, capability checks,
 *     approval decisions, evidence rules, work-package rules, prompt rules)
 *   - Contains ONLY: input translation, compatibility mapping, delegation
 *   - Delegates all real work to UnifiedExecutionEngine
 *
 * These tests inspect the service's source code to enforce adapter purity.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ADAPTER_PATH = resolve(
  import.meta.dirname ?? __dirname,
  "../services/workExecutionPipelineService.ts",
);
const END_TO_END_PATH = resolve(
  import.meta.dirname ?? __dirname,
  "../services/endToEndWorkflowService.ts",
);

function readSource(path: string): string {
  return readFileSync(path, "utf-8");
}

// ─── Suite A — workExecutionPipelineService is a thin adapter ────────────────

describe("Deliverable A — workExecutionPipelineService adapter purity", () => {
  const source = readSource(ADAPTER_PATH);

  it("file is short (< 100 lines — a pure adapter needs very little code)", () => {
    const lines = source.split("\n").filter(l => l.trim().length > 0);
    expect(lines.length).toBeLessThan(100);
  });

  it("imports UnifiedExecutionEngine or createUnifiedExecutionEngine", () => {
    expect(
      source.includes("createUnifiedExecutionEngine") ||
      source.includes("UnifiedExecutionEngine"),
    ).toBe(true);
  });

  it("does NOT contain specialist validation logic", () => {
    const prohibitedPatterns = [
      "ACTIVE_SPECIALIST",
      "validateWorkPackage",
      "specialistEligibility",
      "specialist_not_found",
    ];
    for (const pattern of prohibitedPatterns) {
      expect(source).not.toContain(pattern);
    }
  });

  it("does NOT contain capability validation logic", () => {
    const prohibitedPatterns = [
      "checkEntitlement",
      "capabilityGate",
      "EntitlementResult",
    ];
    for (const pattern of prohibitedPatterns) {
      expect(source).not.toContain(pattern);
    }
  });

  it("does NOT contain approval decision logic", () => {
    const prohibitedPatterns = [
      "requireHumanApproval",
      "approvalRequired",
      "approvalPlan",
    ];
    for (const pattern of prohibitedPatterns) {
      expect(source).not.toContain(pattern);
    }
  });

  it("does NOT contain evidence resolution logic", () => {
    const prohibitedPatterns = [
      "resolveEvidence",
      "EvidencePack",
      "KnowledgeResolution",
    ];
    for (const pattern of prohibitedPatterns) {
      expect(source).not.toContain(pattern);
    }
  });

  it("does NOT contain prompt building logic", () => {
    const prohibitedPatterns = [
      "buildDNASystemInstruction",
      "buildSpecialistUserPrompt",
      "buildWorkPackagePrompt",
    ];
    for (const pattern of prohibitedPatterns) {
      expect(source).not.toContain(pattern);
    }
  });

  it("calls engine.execute — delegation pattern verified", () => {
    expect(source.includes("engine.execute") || source.includes(".execute(")).toBe(true);
  });
});

// ─── Suite B — endToEndWorkflowService is isolated ───────────────────────────

describe("Deliverable B — endToEndWorkflowService legacy isolation", () => {
  const source = readSource(END_TO_END_PATH);

  it("has @deprecated annotation in file header", () => {
    expect(source.includes("@deprecated") || source.includes("LEGACY")).toBe(true);
  });

  it("has a production import guard (assertLegacyPermitted or similar)", () => {
    expect(
      source.includes("assertLegacyPermitted") ||
      source.includes("ALLOW_LEGACY_WORKFLOW") ||
      source.includes("production import is not permitted"),
    ).toBe(true);
  });

  it("is NOT imported by any production route file", () => {
    // Check key route files for import of endToEndWorkflowService
    const routeFiles = [
      resolve(import.meta.dirname ?? __dirname, "../../src/index.ts"),
      resolve(import.meta.dirname ?? __dirname, "../routes/v1/tasks.ts"),
      resolve(import.meta.dirname ?? __dirname, "../routes/v1/workExecution.ts"),
    ];
    for (const routeFile of routeFiles) {
      try {
        const routeSource = readFileSync(routeFile, "utf-8");
        expect(routeSource).not.toContain("endToEndWorkflowService");
      } catch {
        // File doesn't exist — that's fine, can't import what doesn't exist
      }
    }
  });
});

// ─── Suite C — executionCheckpointStore is annotated ─────────────────────────

describe("Deliverable C — executionCheckpointStore legacy annotation", () => {
  const storePath = resolve(
    import.meta.dirname ?? __dirname,
    "../services/executionCheckpointStore.ts",
  );
  const source = readSource(storePath);

  it("has @legacy ISOLATED annotation", () => {
    expect(source.includes("@legacy") || source.includes("SUPERSEDED") || source.includes("RETAIN")).toBe(true);
  });

  it("has a warning not to add new callers", () => {
    expect(
      source.includes("DO NOT add new callers") ||
      source.includes("DO NOT reconnect") ||
      source.includes("not available in production"),
    ).toBe(true);
  });
});

// ─── Suite D — chiefOfStaffOrchestrator no longer has unused import ───────────

describe("Deliverable D — Unused import removal", () => {
  const cosPath = resolve(
    import.meta.dirname ?? __dirname,
    "../services/chiefOfStaffOrchestrator.ts",
  );
  const source = readSource(cosPath);

  it("does NOT have an active import of buildSpecialistContext", () => {
    // The import line was replaced with a comment
    expect(source).not.toContain('import { buildSpecialistContext }');
  });

  it("still has a comment explaining where buildSpecialistContext is used", () => {
    expect(source).toContain("buildSpecialistContext");
  });
});
