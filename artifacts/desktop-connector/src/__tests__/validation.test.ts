/**
 * Broker — package validation unit tests
 *
 * Covers all validation rules: schema, expiry, callback URL, private-network abuse.
 */

import { describe, it, expect } from "vitest";
import { validateInboundPackage } from "../broker/validation.js";

// ─── Valid base package ───────────────────────────────────────────────────────

function makePackage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const future = new Date(Date.now() + 300_000).toISOString(); // 5 min ahead
  return {
    executionId:    "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    tenantId:       "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    workforceRole:  "chief_of_staff",
    workerProfile: {
      allowedChannels:            ["api"],
      allowedBrowserDomains:      [],
      allowedLocalPathCategories: [],
      allowedApplicationCategories: [],
      prohibitedActions:          [],
      riskLevel:                  "low",
      requiresApprovalFor:        [],
    },
    steps: [{
      sequence: 1, specialist: "chief_of_staff", action: "execute",
      description: "Test step", requiresApproval: false,
    }],
    requestedTools:               ["api_call"],
    requestedChannels:            ["api"],
    requestedConnectorCategories: [],
    approvalState:                "approved",
    constraints: {
      maxDurationSeconds:              300,
      requireHumanApprovalBeforeSubmit: false,
      allowedDataCategories:           ["task_context"],
    },
    callbackUrl: "https://xyz.replit.dev/v1/runtime/events",
    expiresAt:   future,
    issuedAt:    new Date().toISOString(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("validateInboundPackage — valid packages", () => {
  it("accepts a well-formed package", () => {
    const result = validateInboundPackage(makePackage());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.package).toBeDefined();
  });

  it("returns the parsed package on success", () => {
    const result = validateInboundPackage(makePackage());
    expect(result.package!.executionId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
  });
});

describe("validateInboundPackage — missing fields", () => {
  it("rejects null body", () => {
    const result = validateInboundPackage(null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects missing executionId", () => {
    const pkg = makePackage({ executionId: undefined });
    const result = validateInboundPackage(pkg);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === "executionId")).toBe(true);
  });

  it("rejects missing tenantId", () => {
    const pkg = makePackage({ tenantId: undefined });
    const result = validateInboundPackage(pkg);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === "tenantId")).toBe(true);
  });

  it("rejects empty steps array", () => {
    const pkg = makePackage({ steps: [] });
    const result = validateInboundPackage(pkg);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === "steps")).toBe(true);
  });

  it("rejects missing workerProfile", () => {
    const pkg = makePackage({ workerProfile: undefined });
    const result = validateInboundPackage(pkg);
    expect(result.valid).toBe(false);
  });
});

describe("validateInboundPackage — UUID validation", () => {
  it("rejects invalid executionId UUID format", () => {
    const pkg = makePackage({ executionId: "not-a-uuid" });
    const result = validateInboundPackage(pkg);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === "executionId")).toBe(true);
  });

  it("rejects invalid tenantId UUID format", () => {
    const pkg = makePackage({ tenantId: "abc" });
    const result = validateInboundPackage(pkg);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === "tenantId")).toBe(true);
  });
});

describe("validateInboundPackage — expiry", () => {
  it("rejects packages that have already expired", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const pkg = makePackage({ expiresAt: past });
    const result = validateInboundPackage(pkg);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "PACKAGE_EXPIRED")).toBe(true);
  });

  it("rejects non-ISO expiresAt", () => {
    const pkg = makePackage({ expiresAt: "not-a-date" });
    const result = validateInboundPackage(pkg);
    expect(result.valid).toBe(false);
  });

  it("accepts packages expiring in the future", () => {
    const future = new Date(Date.now() + 600_000).toISOString();
    const pkg = makePackage({ expiresAt: future });
    const result = validateInboundPackage(pkg);
    expect(result.valid).toBe(true);
  });
});

describe("validateInboundPackage — callback URL", () => {
  it("rejects an invalid URL", () => {
    const pkg = makePackage({ callbackUrl: "not-a-url" });
    const result = validateInboundPackage(pkg);
    expect(result.valid).toBe(false);
  });

  it("accepts HTTP callback in non-production mode", () => {
    const pkg = makePackage({ callbackUrl: "http://localhost:5001/v1/runtime/events" });
    const result = validateInboundPackage(pkg, { nodeEnv: "development", allowLocalCallbacks: true });
    expect(result.valid).toBe(true);
  });

  it("rejects HTTP callback in production", () => {
    const pkg = makePackage({ callbackUrl: "http://example.com/v1/runtime/events" });
    const result = validateInboundPackage(pkg, { nodeEnv: "production" });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "INSECURE_CALLBACK")).toBe(true);
  });

  it("rejects localhost callback in production without allow flag", () => {
    const pkg = makePackage({ callbackUrl: "https://localhost/v1/runtime/events" });
    const result = validateInboundPackage(pkg, { nodeEnv: "production", allowLocalCallbacks: false });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "LOCAL_CALLBACK_FORBIDDEN")).toBe(true);
  });

  it("allows localhost callback in production with BROKER_ALLOW_LOCAL_CALLBACKS=true", () => {
    const pkg = makePackage({ callbackUrl: "https://localhost/v1/runtime/events" });
    const result = validateInboundPackage(pkg, { nodeEnv: "production", allowLocalCallbacks: true });
    expect(result.valid).toBe(true);
  });

  it("rejects 127.0.0.1 callback in production", () => {
    const pkg = makePackage({ callbackUrl: "https://127.0.0.1/v1/runtime/events" });
    const result = validateInboundPackage(pkg, { nodeEnv: "production", allowLocalCallbacks: false });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "LOCAL_CALLBACK_FORBIDDEN")).toBe(true);
  });

  it("rejects 192.168.x.x callback in production", () => {
    const pkg = makePackage({ callbackUrl: "https://192.168.1.1/v1/runtime/events" });
    const result = validateInboundPackage(pkg, { nodeEnv: "production", allowLocalCallbacks: false });
    expect(result.valid).toBe(false);
  });
});

describe("validateInboundPackage — constraints", () => {
  it("rejects maxDurationSeconds > 86400", () => {
    const pkg = makePackage({ constraints: { maxDurationSeconds: 100000, requireHumanApprovalBeforeSubmit: false, allowedDataCategories: [] } });
    const result = validateInboundPackage(pkg);
    expect(result.valid).toBe(false);
  });

  it("rejects maxDurationSeconds of 0", () => {
    const pkg = makePackage({ constraints: { maxDurationSeconds: 0, requireHumanApprovalBeforeSubmit: false, allowedDataCategories: [] } });
    const result = validateInboundPackage(pkg);
    expect(result.valid).toBe(false);
  });
});
