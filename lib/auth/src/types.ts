/**
 * @workspace/auth — Sprint 1 core authentication types
 *
 * These interfaces form the abstraction layer between the application and
 * the authentication provider (Clerk). The rest of the application depends
 * only on these interfaces, not on Clerk directly.
 */

import type { MembershipRole } from "@workspace/shared";

// ─── Authenticated identity (from the auth provider) ─────────────────────────

/**
 * The identity returned by the authentication provider.
 * Maps Clerk's session claims to a provider-agnostic shape.
 */
export interface AuthenticatedIdentity {
  /** The external provider's user ID (Clerk user ID) */
  externalUserId: string;
  email: string;
  emailVerified: boolean;
  firstName?: string;
  lastName?: string;
  displayName?: string;
}

// ─── Application user (from the database) ────────────────────────────────────

export interface AppUser {
  id: string;
  externalId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  status: "pending_verification" | "active" | "suspended" | "deactivated";
}

// ─── Tenant context (resolved per request) ───────────────────────────────────

/**
 * Attached to every authenticated tenant-scoped request.
 * This is the resolved security context — never trust anything else.
 *
 * `permissions` is typed as `string[]` so lib/auth has no dependency on
 * lib/permissions (which itself depends on lib/auth via lib/shared). The
 * API server's requirePermission middleware casts to PermissionAction[].
 */
export interface TenantContext {
  userId: string;           // Internal DB user ID
  externalUserId: string;   // Clerk user ID
  tenantId: string;         // Organisation UUID (authoritative tenant boundary)
  tenantSlug: string;       // Organisation slug (for display only)
  membershipId: string;
  role: MembershipRole;
  permissions: string[];    // PermissionAction[] values (string to avoid circular dep)
}

// ─── Auth error codes ─────────────────────────────────────────────────────────

export type AuthErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "EMAIL_VERIFICATION_REQUIRED"
  | "USER_SUSPENDED"
  | "TENANT_NOT_FOUND"
  | "TENANT_INACTIVE"
  | "MEMBERSHIP_REQUIRED"
  | "MEMBERSHIP_SUSPENDED"
  | "PERMISSION_DENIED";

// ─── Auth service interface ───────────────────────────────────────────────────

/**
 * The auth service abstraction. The application depends on this interface,
 * not on Clerk's SDK directly.
 */
export interface AuthService {
  getCurrentIdentity(req: unknown): Promise<AuthenticatedIdentity | null>;
  requireIdentity(req: unknown): Promise<AuthenticatedIdentity>;
  revokeSessions(externalUserId: string): Promise<void>;
}
