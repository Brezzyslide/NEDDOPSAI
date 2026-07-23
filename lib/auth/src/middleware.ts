/**
 * @workspace/auth — Middleware stubs (Sprint 1)
 *
 * The real auth middleware uses Clerk's `getAuth` from `@clerk/express`.
 * These are typed stubs — the concrete implementation lives in
 * `artifacts/api-server/src/middlewares/` to keep lib/auth free of
 * runtime Clerk dependencies.
 */

import type { TenantContext, AppUser } from "./types.js";

// ─── Express request augmentation ────────────────────────────────────────────

// These augment the Express Request type in packages that import @workspace/auth.
// The concrete values are populated by the API server's middleware.
declare global {
  namespace Express {
    interface Request {
      /** Populated by requireAuth middleware */
      appUser?: AppUser;
      /** Populated by resolveTenantContext middleware */
      tenantContext?: TenantContext;
    }
  }
}

// ─── Generic middleware type (no express runtime dep at lib level) ────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MiddlewareFn = (req: any, res: any, next: any) => void | Promise<void>;

export type AuthenticatedRequest = {
  appUser?: AppUser;
  tenantContext?: TenantContext;
  [key: string]: unknown;
};
