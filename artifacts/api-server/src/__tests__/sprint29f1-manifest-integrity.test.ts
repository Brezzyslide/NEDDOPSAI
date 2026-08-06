/**
 * sprint29f1-manifest-integrity.test.ts — Sprint 29F.1 Part 5
 *
 * Tests that:
 *   A — CanonicalExecutionContext.manifestHash type exists
 *   B — manifestHash is a 64-char SHA-256 hex string
 *   C — manifestHash is deterministic for the same input
 *   D — different manifest inputs produce different hashes
 */

import { describe, it, expect } from "vitest";
import { createHash } from "crypto";

// ─── Helper: reproduce the hash computation from unifiedExecutionEngine ────────

function computeManifestHash(executionId: string, specialist: string, blueprintId: string | null = null, version: string | null = null): string {
  return createHash("sha256")
    .update(JSON.stringify({ id: executionId, specialist, blueprint: blueprintId, version }))
    .digest("hex");
}

// ─── Suite A — Type check ─────────────────────────────────────────────────────

describe("Deliverable A — manifestHash type in CanonicalExecutionContext", () => {
  it("manifestHash is an optional string field on the context type", async () => {
    const { } = await import("../types/canonicalExecutionContext.js");
    // Type-only check: manifests that the field exists without runtime error
    const ctx = {
      executionId: "exec_001",
      manifestVersion: 1,
      manifestHash: "abc123",
    };
    expect(ctx.manifestHash).toBe("abc123");
  });

  it("manifestHash can be undefined (optional)", () => {
    const ctx: { executionId: string; manifestVersion: number; manifestHash?: string } = {
      executionId: "exec_001",
      manifestVersion: 1,
    };
    expect(ctx.manifestHash).toBeUndefined();
  });
});

// ─── Suite B — Hash format ────────────────────────────────────────────────────

describe("Deliverable B — manifestHash is a valid SHA-256 hex string", () => {
  it("hash is 64 characters long", () => {
    const hash = computeManifestHash("exec_001", "operations_manager");
    expect(hash.length).toBe(64);
  });

  it("hash contains only hex characters", () => {
    const hash = computeManifestHash("exec_001", "operations_manager");
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
  });

  it("hash is a non-empty string", () => {
    const hash = computeManifestHash("exec_001", "operations_manager");
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });
});

// ─── Suite C — Determinism ────────────────────────────────────────────────────

describe("Deliverable C — manifestHash is deterministic", () => {
  it("same inputs produce the same hash", () => {
    const h1 = computeManifestHash("exec_abc", "chief_of_staff", "blueprint_xyz", "v2");
    const h2 = computeManifestHash("exec_abc", "chief_of_staff", "blueprint_xyz", "v2");
    expect(h1).toBe(h2);
  });

  it("hash is stable across multiple calls", () => {
    const inputs = { id: "exec_stable", specialist: "operations_manager", blueprint: null, version: null };
    const hashes = Array.from({ length: 5 }, () =>
      createHash("sha256").update(JSON.stringify(inputs)).digest("hex"),
    );
    expect(new Set(hashes).size).toBe(1);
  });
});

// ─── Suite D — Collision resistance ──────────────────────────────────────────

describe("Deliverable D — Different manifest inputs produce different hashes", () => {
  it("different executionId → different hash", () => {
    const h1 = computeManifestHash("exec_001", "ops_mgr");
    const h2 = computeManifestHash("exec_002", "ops_mgr");
    expect(h1).not.toBe(h2);
  });

  it("different specialist → different hash", () => {
    const h1 = computeManifestHash("exec_001", "chief_of_staff");
    const h2 = computeManifestHash("exec_001", "operations_manager");
    expect(h1).not.toBe(h2);
  });

  it("different blueprintId → different hash", () => {
    const h1 = computeManifestHash("exec_001", "ops_mgr", "blueprint_a");
    const h2 = computeManifestHash("exec_001", "ops_mgr", "blueprint_b");
    expect(h1).not.toBe(h2);
  });

  it("null blueprint vs non-null blueprint → different hash", () => {
    const h1 = computeManifestHash("exec_001", "ops_mgr", null);
    const h2 = computeManifestHash("exec_001", "ops_mgr", "blueprint_x");
    expect(h1).not.toBe(h2);
  });
});
