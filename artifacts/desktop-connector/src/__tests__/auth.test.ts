/**
 * Broker — auth middleware unit tests
 *
 * Tests Bearer token enforcement and constant-time comparison.
 */

import { describe, it, expect } from "vitest";
import { createAuthMiddleware, extractBearerToken } from "../broker/auth.js";
import type { Request, Response, NextFunction } from "express";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(authHeader?: string): Request {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  } as unknown as Request;
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  return res;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createAuthMiddleware", () => {
  const TOKEN = "test-secret-token-abc123";
  const auth = createAuthMiddleware(TOKEN);

  it("allows requests with the correct Bearer token", () => {
    const req = makeReq(`Bearer ${TOKEN}`);
    const res = makeRes();
    let nextCalled = false;
    auth(req, res as unknown as Response, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it("rejects requests with no Authorization header", () => {
    const req = makeReq();
    const res = makeRes();
    auth(req, res as unknown as Response, () => { throw new Error("next should not be called"); });
    expect(res.statusCode).toBe(401);
    expect((res.body as { error: { code: string } }).error.code).toBe("UNAUTHORIZED");
  });

  it("rejects requests with a wrong token", () => {
    const req = makeReq("Bearer wrong-token");
    const res = makeRes();
    auth(req, res as unknown as Response, () => { throw new Error("next should not be called"); });
    expect(res.statusCode).toBe(401);
  });

  it("rejects requests with a token that is too short (timing safety)", () => {
    const req = makeReq("Bearer short");
    const res = makeRes();
    auth(req, res as unknown as Response, () => { throw new Error("next should not be called"); });
    expect(res.statusCode).toBe(401);
  });

  it("rejects requests with no Bearer scheme (basic auth)", () => {
    const req = makeReq(`Basic ${Buffer.from(`user:${TOKEN}`).toString("base64")}`);
    const res = makeRes();
    auth(req, res as unknown as Response, () => { throw new Error("next should not be called"); });
    expect(res.statusCode).toBe(401);
  });

  it("rejects empty string Authorization header", () => {
    const req = makeReq("");
    const res = makeRes();
    auth(req, res as unknown as Response, () => { throw new Error("next should not be called"); });
    expect(res.statusCode).toBe(401);
  });

  it("throws if constructed with empty token", () => {
    expect(() => createAuthMiddleware("")).toThrow();
  });
});

describe("extractBearerToken", () => {
  it("extracts token from valid Bearer header", () => {
    expect(extractBearerToken("Bearer abc123")).toBe("abc123");
  });

  it("returns null for undefined header", () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it("returns null for empty header", () => {
    expect(extractBearerToken("")).toBeNull();
  });

  it("returns null for Basic scheme", () => {
    expect(extractBearerToken("Basic dXNlcjpwYXNz")).toBeNull();
  });

  it("is case-insensitive on Bearer keyword", () => {
    expect(extractBearerToken("bearer abc123")).toBe("abc123");
  });
});
