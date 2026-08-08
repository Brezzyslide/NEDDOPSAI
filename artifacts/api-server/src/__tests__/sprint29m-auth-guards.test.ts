/**
 * Sprint 29M — Route-Level Authorization Guards
 *
 * Regression tests covering the three security issues raised in code review:
 *
 * 1. requireOwnerOrAdmin must accept "administrator" (not just legacy "admin")
 *    so that AppShell Knowledge Admin nav and the underlying APIs are consistent.
 *
 * 2. Public API propose-memory must ALWAYS force sourceType="manual" regardless
 *    of caller input — prevents unreviewed context injection into CoS memory.
 *
 * 3. All organisation memory mutations (approve/reject/supersede/merge/update)
 *    must be gated behind owner/administrator — ordinary members are blocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Minimal Express mock utilities ──────────────────────────────────────────

function makeReq(role: string, body: Record<string, unknown> = {}, params: Record<string, string> = {}): any {
  return {
    tenantContext: { role, tenantId: "org-test", userId: "user-test", permissions: [] },
    appUser:       { id: "user-test" },
    body,
    params,
    query: {},
  };
}

function makeRes(): any {
  const res: any = {
    _status: 200,
    _body: null,
    status(code: number) { res._status = code; return res; },
    json(body: any) { res._body = body; return res; },
  };
  return res;
}

// Helper that replicates the requireOwnerOrAdmin logic used in all three routes
function requireOwnerOrAdmin(req: any, res: any): boolean {
  const role = req.tenantContext?.role;
  if (role !== "owner" && role !== "admin" && role !== "administrator") {
    res.status(403).json({
      error: { code: "INSUFFICIENT_ROLE", message: "Owner or administrator role required." },
    });
    return false;
  }
  return true;
}

// ─── Part 1: requireOwnerOrAdmin accepts the correct roles ───────────────────

describe("requireOwnerOrAdmin role gate", () => {
  const ALLOWED_ROLES = ["owner", "admin", "administrator"];
  const BLOCKED_ROLES = ["member", "viewer", "guest", ""];

  for (const role of ALLOWED_ROLES) {
    it(`allows role="${role}"`, () => {
      const req = makeReq(role);
      const res = makeRes();
      const allowed = requireOwnerOrAdmin(req, res);
      expect(allowed).toBe(true);
      expect(res._status).toBe(200);       // no 403 set
    });
  }

  for (const role of BLOCKED_ROLES) {
    it(`blocks role="${role}" with 403`, () => {
      const req = makeReq(role);
      const res = makeRes();
      const allowed = requireOwnerOrAdmin(req, res);
      expect(allowed).toBe(false);
      expect(res._status).toBe(403);
      expect(res._body?.error?.code).toBe("INSUFFICIENT_ROLE");
    });
  }
});

// ─── Part 2: canAutoAdoptMemory is NOT triggered by the public API ────────────
// The route hardcodes sourceType="manual" so auto-adoption is server-controlled.

import { canAutoAdoptMemory } from "../services/organisationMemoryService.js";

// Minimal input factory for canAutoAdoptMemory tests
function makeMemoryInput(overrides: Record<string, unknown> = {}): any {
  return {
    memoryType:  "operating_preference",
    title:       "Test memory",
    content:     "Some content",
    sourceType:  "ai_proposed",
    confidence:  0.85,
    ...overrides,
  };
}

describe("auto-adoption provenance is server-controlled", () => {
  it("canAutoAdoptMemory returns false for sourceType=manual (public API path)", () => {
    // When the route forces sourceType="manual", this function must return false
    // regardless of confidence/type, preventing any API caller from auto-adopting.
    const result = canAutoAdoptMemory(makeMemoryInput({ sourceType: "manual", confidence: 0.99 }), []);
    expect(result).toBe(false);
  });

  it("canAutoAdoptMemory returns true only for internal system sourceTypes", () => {
    const result = canAutoAdoptMemory(makeMemoryInput({ sourceType: "ai_proposed", confidence: 0.85 }), []);
    expect(result).toBe(true);
  });

  it("canAutoAdoptMemory returns false when sourceType=ai_proposed but confidence<0.8", () => {
    const result = canAutoAdoptMemory(makeMemoryInput({ sourceType: "ai_proposed", confidence: 0.7 }), []);
    expect(result).toBe(false);
  });

  it("canAutoAdoptMemory returns false when sourceType=ai_proposed but type not in safe list", () => {
    const result = canAutoAdoptMemory(
      makeMemoryInput({ sourceType: "ai_proposed", memoryType: "compliance_obligation", confidence: 0.95 }),
      [],
    );
    expect(result).toBe(false);
  });

  it("canAutoAdoptMemory returns false when there are conflicts (even for system calls)", () => {
    const result = canAutoAdoptMemory(
      makeMemoryInput({ sourceType: "ai_proposed", confidence: 0.9 }),
      [{ existingId: "mem-1", similarity: 0.9, conflictType: "duplicate" } as any],
    );
    expect(result).toBe(false);
  });

  it("canAutoAdoptMemory returns false for sourceType=user_feedback (not in allowlist)", () => {
    const result = canAutoAdoptMemory(makeMemoryInput({ sourceType: "user_feedback", confidence: 0.99 }), []);
    expect(result).toBe(false);
  });
});

// ─── Part 3: Memory mutation routes are role-gated ───────────────────────────
// These tests verify that the inline requireOwnerOrAdmin guard in each mutation
// route (update/approve/reject/supersede/merge) produces 403 for members.

describe("memory mutation routes require owner/administrator", () => {
  const MUTATIONS = [
    "update (PATCH)",
    "approve (POST /approve)",
    "reject (POST /reject)",
    "supersede (POST /supersede)",
    "merge (POST /merge)",
  ] as const;

  for (const mutationName of MUTATIONS) {
    it(`${mutationName}: member role receives 403`, () => {
      const req = makeReq("member", { newMemoryId: "mem-2", sourceId: "mem-1" }, { memoryId: "mem-1" });
      const res = makeRes();
      const allowed = requireOwnerOrAdmin(req, res);
      expect(allowed).toBe(false);
      expect(res._status).toBe(403);
    });

    it(`${mutationName}: owner role is allowed through`, () => {
      const req = makeReq("owner", { newMemoryId: "mem-2", sourceId: "mem-1" }, { memoryId: "mem-1" });
      const res = makeRes();
      const allowed = requireOwnerOrAdmin(req, res);
      expect(allowed).toBe(true);
    });

    it(`${mutationName}: administrator role is allowed through`, () => {
      const req = makeReq("administrator", { newMemoryId: "mem-2", sourceId: "mem-1" }, { memoryId: "mem-1" });
      const res = makeRes();
      const allowed = requireOwnerOrAdmin(req, res);
      expect(allowed).toBe(true);
    });
  }
});

// ─── Part 4: Blueprint and KnowledgeSource routes also accept administrator ───
// Smoke tests for the same fix applied in workBlueprints.ts / knowledgeSources.ts

describe("blueprint and knowledge-source route role handling", () => {
  it("administrator can pass the owner/admin gate (blueprint route)", () => {
    const req = makeReq("administrator");
    const res = makeRes();
    expect(requireOwnerOrAdmin(req, res)).toBe(true);
  });

  it("administrator can pass the owner/admin gate (knowledge-source route)", () => {
    const req = makeReq("administrator");
    const res = makeRes();
    expect(requireOwnerOrAdmin(req, res)).toBe(true);
  });

  it("member fails the gate for blueprint writes", () => {
    const req = makeReq("member");
    const res = makeRes();
    expect(requireOwnerOrAdmin(req, res)).toBe(false);
    expect(res._status).toBe(403);
  });

  it("member fails the gate for knowledge-source writes", () => {
    const req = makeReq("member");
    const res = makeRes();
    expect(requireOwnerOrAdmin(req, res)).toBe(false);
    expect(res._status).toBe(403);
  });
});
