/**
 * @workspace/auth — Core authentication types
 *
 * Sprint 0 shell. Full implementation in Sprint 1 (Clerk integration).
 * These types define the shape that auth middleware will inject into requests.
 */

import type { UserRole } from "@workspace/shared";

// ─── Authenticated user (injected by auth middleware) ────────────────────────

export interface AuthUser {
  /** User's UUID (primary key in users table) */
  id: string;
  /** The organisation this user belongs to */
  organizationId: string;
  /** User's role within their organisation */
  role: UserRole;
  /** User's email address */
  email: string;
  /** External identity provider subject ID (Clerk user ID in Sprint 1+) */
  externalId?: string;
}

// ─── JWT payload ──────────────────────────────────────────────────────────────

export interface JWTPayload {
  sub: string;             // User ID
  org: string;             // Organisation ID
  role: UserRole;
  email: string;
  iat: number;
  exp: number;
}

// ─── Session ──────────────────────────────────────────────────────────────────

export interface Session {
  user: AuthUser;
  /** ISO timestamp when the session was created */
  createdAt: string;
  /** ISO timestamp when the session expires */
  expiresAt: string;
}

// ─── Auth context (attached to req.auth in Sprint 1+) ────────────────────────

export interface AuthContext {
  user: AuthUser;
  session: Session;
  /** True if the user is an org owner or admin */
  isAdmin: boolean;
  /** True if the user is the org owner */
  isOwner: boolean;
}

// ─── Auth errors ─────────────────────────────────────────────────────────────

export type AuthErrorCode =
  | "UNAUTHENTICATED"
  | "TOKEN_EXPIRED"
  | "TOKEN_INVALID"
  | "INSUFFICIENT_PERMISSIONS"
  | "TENANT_MISMATCH";

export interface AuthError {
  code: AuthErrorCode;
  message: string;
}
