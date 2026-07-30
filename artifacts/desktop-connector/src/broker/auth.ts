/**
 * NeedsOps Runtime Broker — Bearer Token Authentication
 *
 * All routes (except GET /v1/health which is unauthenticated for tunnel
 * probing) require a valid Bearer token in the Authorization header.
 *
 * Constant-time comparison prevents timing attacks on the token.
 */

import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";

/**
 * Create a middleware that rejects requests without a valid Bearer token.
 *
 * @param expectedToken - The token NeedsOps must send. Must not be empty.
 */
export function createAuthMiddleware(expectedToken: string) {
  if (!expectedToken) {
    throw new Error("BUG: auth middleware created with empty token");
  }

  const expectedBuf = Buffer.from(`Bearer ${expectedToken}`, "utf8");

  return function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers["authorization"] ?? "";

    // Constant-time comparison — prevents timing oracle attacks
    let match = false;
    try {
      const actualBuf = Buffer.from(authHeader, "utf8");
      if (actualBuf.length === expectedBuf.length) {
        match = timingSafeEqual(actualBuf, expectedBuf);
      }
    } catch {
      match = false;
    }

    if (!match) {
      res.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Missing or invalid Bearer token.",
        },
      });
      return;
    }

    next();
  };
}

/**
 * Parse the Bearer token value from an Authorization header.
 * Returns null if header is absent or not a Bearer scheme.
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? (match[1] ?? null) : null;
}
