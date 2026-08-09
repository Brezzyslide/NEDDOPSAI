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

// ─── Suite B — endToEndWorkflowService deleted (Sprint 29N.8 dead-code audit) ─

describe("Deliverable B — endToEndWorkflowService deleted (proved dead)", () => {
  it("file no longer exists on disk", () => {
    const { existsSync } = require("fs");
    expect(existsSync(END_TO_END_PATH)).toBe(false);
  });

  it("is NOT imported by any production route or service file", () => {
    const { execSync } = require("child_process");
    let result = "";
    try {
      result = execSync(
        'grep -rl "endToEndWorkflowService" src/ --include="*.ts"',
        { encoding: "utf-8", cwd: process.cwd() },
      ).trim();
    } catch { result = ""; }
    const liveCallers = result.split("\n").filter(Boolean).filter(
      f => !f.includes("__tests__") && !f.includes("/tests/"),
    );
    expect(liveCallers).toHaveLength(0);
  });
});

// ─── Suite C — executionCheckpointStore deleted (Sprint 29N.8 dead-code audit) ─

describe("Deliverable C — executionCheckpointStore deleted (proved dead)", () => {
  it("file no longer exists on disk", () => {
    const { existsSync } = require("fs");
    const storePath = resolve(
      import.meta.dirname ?? __dirname,
      "../services/executionCheckpointStore.ts",
    );
    expect(existsSync(storePath)).toBe(false);
  });

  it("is superseded by executionCheckpointService (DB-backed)", () => {
    const servicePath = resolve(
      import.meta.dirname ?? __dirname,
      "../services/executionCheckpointService.ts",
    );
    const { existsSync } = require("fs");
    expect(existsSync(servicePath)).toBe(true);
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
