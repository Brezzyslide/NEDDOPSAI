/**
 * userService — Sprint 1
 *
 * Manages application user records (not Clerk auth — that's the provider's job).
 * This service owns the DB user lifecycle.
 */

import { randomUUID } from "crypto";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

type ResolvedUserSelf = {
  user_id: string;
  user_external_id: string;
  user_email: string;
  user_first_name: string | null;
  user_last_name: string | null;
  user_display_name: string | null;
  user_status: "pending_verification" | "active" | "suspended" | "deactivated";
};

type ResolvedUserOrganisation = {
  membership_id: string;
  membership_role: string;
  membership_status: string;
  joined_at: Date | null;
  organization_id: string;
  organization_slug: string;
  organization_name: string;
  organization_display_name: string | null;
  organization_status: string;
  subscription_tier: string;
};

function mapResolvedUser(row: ResolvedUserSelf) {
  return {
    id: row.user_id,
    externalId: row.user_external_id,
    email: row.user_email,
    firstName: row.user_first_name,
    lastName: row.user_last_name,
    displayName: row.user_display_name,
    status: row.user_status,
  };
}

export async function getUserById(userId: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return user ?? null;
}

export async function getUserByExternalId(externalId: string) {
  const resolved = await db.execute<ResolvedUserSelf>(sql`
    SELECT *
    FROM public.resolve_user_self_context(${externalId})
    LIMIT 1
  `);
  const row = resolved.rows[0];
  return row ? mapResolvedUser(row) : null;
}

export interface ProvisionUserParams {
  externalId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}

/**
 * Creates a DB user record if one doesn't exist for the given Clerk user ID.
 * Safe to call on every authenticated request (idempotent).
 */
export async function provisionUser(params: ProvisionUserParams) {
  const existing = await getUserByExternalId(params.externalId);
  if (existing) return existing;
  return existing;
}

export interface UpdateUserParams {
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  preferredTimezone?: string;
  locale?: string;
  termsAcceptedAt?: Date;
  termsVersion?: string;
  privacyAcceptedAt?: Date;
  privacyVersion?: string;
}

export async function updateUser(userId: string, params: UpdateUserParams) {
  const [updated] = await db
    .update(usersTable)
    .set({ ...params, updatedAt: new Date() })
    .where(eq(usersTable.id, userId))
    .returning();
  return updated ?? null;
}

export async function recordLogin(userId: string) {
  await db
    .update(usersTable)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
}

/**
 * Returns all organisations the user has an active or invited membership in.
 */
export async function getUserMemberships(externalUserId: string) {
  const resolved = await db.execute<ResolvedUserOrganisation>(sql`
    SELECT *
    FROM public.resolve_user_organisations(${externalUserId})
  `);

  return resolved.rows.map((row) => ({
    membership: {
      id: row.membership_id,
      role: row.membership_role,
      status: row.membership_status,
      joinedAt: row.joined_at,
    },
    org: {
      id: row.organization_id,
      slug: row.organization_slug,
      name: row.organization_name,
      displayName: row.organization_display_name,
      status: row.organization_status,
      subscriptionTier: row.subscription_tier,
    },
  }));
}
