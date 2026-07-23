/**
 * @workspace/auth — Middleware interface
 *
 * Sprint 0 shell. Defines passthrough middleware stubs.
 * Sprint 1 will replace requireAuth with a real Clerk JWT verifier.
 *
 * Typed as generic functions so lib/auth has zero runtime dependency on express.
 * The API server imports express directly and casts as needed.
 */

import type { AuthContext } from "./types.js";

// Minimal middleware function type — no express dependency at lib level
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MiddlewareFn = (req: any, res: any, next: any) => void;

// Augmentation hint (applied when express is in scope in the consuming package)
export type AuthenticatedRequest = {
  auth?: AuthContext;
  [key: string]: unknown;
};

/**
 * Sprint 0 passthrough — allows all requests.
 *
 * Sprint 1: replace with Clerk JWT verification middleware that:
 *   1. Reads the Authorization: Bearer <token> header
 *   2. Verifies the JWT against Clerk's public key
 *   3. Extracts the user and org from claims
 *   4. Populates req.auth with an AuthContext
 *   5. Returns 401 if the token is missing or invalid
 */
export const requireAuth: MiddlewareFn = (_req, _res, next) => {
  // TODO Sprint 1: implement Clerk JWT verification
  next();
};

/**
 * Middleware that enforces the user belongs to the org referenced in the URL.
 *
 * Sprint 0: passthrough. Sprint 1: enforce req.auth.user.organizationId === req.params.orgId.
 */
export const requireTenantAccess: MiddlewareFn = (_req, _res, next) => {
  // TODO Sprint 1: enforce tenant isolation
  next();
};
