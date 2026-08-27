import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it, afterEach } from "vitest";
import { PURPOSE_FIELD_ALLOWLIST } from "../../../../lib/ai-gateway/src/types";
import { resolveOpenAIRuntimePolicy } from "../../../../lib/ai-gateway/src/providers/openai";

const root = resolve(__dirname, "..");

function source(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

afterEach(() => {
  delete process.env.AI_TIMEOUT_MS;
  delete process.env.AI_MAX_RETRIES;
  delete process.env.AI_CONVERSATION_TIMEOUT_MS;
  delete process.env.AI_CONVERSATION_MAX_RETRIES;
  delete process.env.AI_PROFESSIONAL_TIMEOUT_MS;
  delete process.env.AI_PROFESSIONAL_MAX_RETRIES;
  delete process.env.AI_FINAL_SYNTHESIS_TIMEOUT_MS;
  delete process.env.AI_FINAL_SYNTHESIS_MAX_RETRIES;
  delete process.env.AI_TARGETED_REPAIR_TIMEOUT_MS;
  delete process.env.AI_TARGETED_REPAIR_MAX_RETRIES;
});

describe("Sprint 35J professional AI gateway timeout hardening", () => {
  it("keeps conversation intelligence on the short interactive timeout profile", () => {
    process.env.AI_TIMEOUT_MS = "30000";
    process.env.AI_MAX_RETRIES = "2";

    const policy = resolveOpenAIRuntimePolicy({ runtimeProfile: "conversation_intelligence" });

    expect(policy.runtimeProfile).toBe("conversation_intelligence");
    expect(policy.timeoutMs).toBe(30_000);
    expect(policy.maxRetries).toBe(0);
    expect(policy.retryOnTimeout).toBe(false);
  });

  it("uses longer bounded-retry profiles for professional generation stages", () => {
    expect(resolveOpenAIRuntimePolicy({ runtimeProfile: "professional_execution" })).toMatchObject({
      runtimeProfile: "professional_execution",
      timeoutMs: 120_000,
      maxRetries: 1,
      retryOnTimeout: true,
    });
    expect(resolveOpenAIRuntimePolicy({ runtimeProfile: "final_synthesis" })).toMatchObject({
      runtimeProfile: "final_synthesis",
      timeoutMs: 120_000,
      maxRetries: 1,
      retryOnTimeout: true,
    });
    expect(resolveOpenAIRuntimePolicy({ runtimeProfile: "targeted_repair" })).toMatchObject({
      runtimeProfile: "targeted_repair",
      timeoutMs: 90_000,
      maxRetries: 1,
      retryOnTimeout: true,
    });
  });

  it("allows deployment overrides without changing the shared gateway code path", () => {
    process.env.AI_CONVERSATION_TIMEOUT_MS = "25000";
    process.env.AI_PROFESSIONAL_TIMEOUT_MS = "150000";
    process.env.AI_PROFESSIONAL_MAX_RETRIES = "2";
    process.env.AI_FINAL_SYNTHESIS_TIMEOUT_MS = "180000";
    process.env.AI_TARGETED_REPAIR_TIMEOUT_MS = "100000";

    expect(resolveOpenAIRuntimePolicy({ runtimeProfile: "conversation_intelligence" }).timeoutMs).toBe(25_000);
    expect(resolveOpenAIRuntimePolicy({ runtimeProfile: "professional_execution" })).toMatchObject({
      timeoutMs: 150_000,
      maxRetries: 2,
    });
    expect(resolveOpenAIRuntimePolicy({ runtimeProfile: "final_synthesis" }).timeoutMs).toBe(180_000);
    expect(resolveOpenAIRuntimePolicy({ runtimeProfile: "targeted_repair" }).timeoutMs).toBe(100_000);
  });

  it("does not manufacture deterministic fallback content for professional generation", () => {
    const gatewaySrc = readFileSync(resolve(root, "../../../lib/ai-gateway/src/aiGateway.ts"), "utf8");

    expect(gatewaySrc).toContain("fallbackAllowed");
    expect(gatewaySrc).toContain("ai_gateway.provider_failure");
    expect(gatewaySrc).toContain("deterministic fallback disabled");
    expect(gatewaySrc).toContain("PROVIDER_TIMEOUT");
    expect(gatewaySrc).toContain("PROVIDER_RUNTIME_FAILURE");
    expect(gatewaySrc).toContain("runtimeProfile === \"professional_execution\"");
    expect(gatewaySrc).toContain("runtimeProfile === \"final_synthesis\"");
    expect(gatewaySrc).toContain("runtimeProfile === \"targeted_repair\"");
  });

  it("threads professional runtime profiles through primary draft, final synthesis and targeted repair", () => {
    const ueeSrc = source("services/unifiedExecutionEngine.ts");

    expect(ueeSrc).toContain('runtimeProfile: "professional_execution"');
    expect(ueeSrc).toContain('runtimeProfile: "final_synthesis"');
    expect(ueeSrc).toContain('runtimeProfile: "targeted_repair"');
    expect(ueeSrc.match(/allowProviderFallback: false/g)?.length).toBeGreaterThanOrEqual(3);
    expect(ueeSrc).toContain("configuredTimeoutMs: response.configuredTimeoutMs");
    expect(ueeSrc).toContain("retryCount: response.retryCount");
    expect(ueeSrc).toContain("providerFailureKind: response.providerFailureKind");
  });

  it("permits only the approved targeted-repair context through task_execution", () => {
    expect(PURPOSE_FIELD_ALLOWLIST.task_execution).toEqual(expect.arrayContaining([
      "deliverableRequirementCoverage.missing",
      "deliverableOutputSchema",
      "currentDeliverable.content",
    ]));
    expect(PURPOSE_FIELD_ALLOWLIST.task_execution).not.toContain("internal.chainOfThought");
    expect(PURPOSE_FIELD_ALLOWLIST.task_execution).not.toContain("organisationLibrarySources.storageKey");
  });
});
