/**
 * userService — Sprint 1
 *
 * Manages application user records (not Clerk auth — that's the provider's job).
 * This service owns the DB user lifecycle.
 */

import { randomUUID } from "crypto";
import { db, usersTable, membershipsTable, organizationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function getUserById(userId: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return user ?? null;
}

export async function getUserByExternalId(externalId: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.externalId, externalId))
    .limit(1);
  return user ?? null;
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

  const [created] = await db
    .insert(usersTable)
    .values({
      id: randomUUID(),
      externalId: params.externalId,
      email: params.email,
      firstName: params.firstName ?? null,
      lastName: params.lastName ?? null,
      status: "active",
    })
    .returning();

  return created!;
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
export async function getUserMemberships(userId: string) {
  const rows = await db
    .select({
      membership: membershipsTable,
      org: organizationsTable,
    })
    .from(membershipsTable)
    .innerJoin(
      organizationsTable,
      eq(membershipsTable.organizationId, organizationsTable.id),
    )
    .where(eq(membershipsTable.userId, userId));

  return rows;
}
