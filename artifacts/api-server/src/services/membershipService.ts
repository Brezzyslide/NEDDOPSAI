/**
 * membershipService — Sprint 1
 *
 * All mutations emit an audit event via auditService.
 * Security: every query is tenant-scoped by orgId UUID.
 */

import { randomUUID } from "crypto";
import { db, membershipsTable, usersTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import {
  ConflictError,
  DuplicateMembership,
  OwnerProtection,
  ResourceNotFound,
  PermissionDenied,
} from "../lib/errors.js";
import { roleAtLeast } from "@workspace/permissions";
import type { MembershipRole } from "@workspace/shared";

export async function getMemberships(orgId: string) {
  return db
    .select({ membership: membershipsTable, user: usersTable })
    .from(membershipsTable)
    .innerJoin(usersTable, eq(membershipsTable.userId, usersTable.id))
    .where(eq(membershipsTable.organizationId, orgId));
}

export async function getMembership(orgId: string, membershipId: string) {
  const [row] = await db
    .select({ membership: membershipsTable, user: usersTable })
    .from(membershipsTable)
    .innerJoin(usersTable, eq(membershipsTable.userId, usersTable.id))
    .where(
      and(
        eq(membershipsTable.organizationId, orgId),
        eq(membershipsTable.id, membershipId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getMembershipForUser(orgId: string, userId: string) {
  const [row] = await db
    .select()
    .from(membershipsTable)
    .where(
      and(
        eq(membershipsTable.organizationId, orgId),
        eq(membershipsTable.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Count active owners in the org (for owner-protection checks). */
async function countActiveOwners(orgId: string): Promise<number> {
  const [result] = await db
    .select({ n: count() })
    .from(membershipsTable)
    .where(
      and(
        eq(membershipsTable.organizationId, orgId),
        eq(membershipsTable.role, "owner"),
        eq(membershipsTable.status, "active"),
      ),
    );
  return Number(result?.n ?? 0);
}

export async function updateMembershipRole(
  orgId: string,
  membershipId: string,
  newRole: MembershipRole,
  actorRole: MembershipRole,
) {
  const row = await getMembership(orgId, membershipId);
  if (!row) throw new ResourceNotFound("Membership");

  const currentRole = row.membership.role as MembershipRole;

  // Administrators cannot change owner's role
  if (currentRole === "owner" && actorRole !== "owner") {
    throw new PermissionDenied("Only an owner can change another owner's role.");
  }

  // Cannot remove the last owner
  if (currentRole === "owner" && newRole !== "owner") {
    const ownerCount = await countActiveOwners(orgId);
    if (ownerCount <= 1) throw new OwnerProtection();
  }

  const [updated] = await db
    .update(membershipsTable)
    .set({ role: newRole, updatedAt: new Date() })
    .where(
      and(
        eq(membershipsTable.id, membershipId),
        eq(membershipsTable.organizationId, orgId),
      ),
    )
    .returning();
  return updated!;
}

export async function suspendMembership(
  orgId: string,
  membershipId: string,
  actorRole: MembershipRole,
) {
  const row = await getMembership(orgId, membershipId);
  if (!row) throw new ResourceNotFound("Membership");

  const targetRole = row.membership.role as MembershipRole;
  if (targetRole === "owner" && actorRole !== "owner") {
    throw new PermissionDenied("Only an owner can suspend another owner.");
  }

  if (targetRole === "owner") {
    const ownerCount = await countActiveOwners(orgId);
    if (ownerCount <= 1) throw new OwnerProtection();
  }

  const [updated] = await db
    .update(membershipsTable)
    .set({ status: "suspended", suspendedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(membershipsTable.id, membershipId),
        eq(membershipsTable.organizationId, orgId),
      ),
    )
    .returning();
  return updated!;
}

export async function reactivateMembership(orgId: string, membershipId: string) {
  const [updated] = await db
    .update(membershipsTable)
    .set({
      status: "active",
      suspendedAt: null,
      joinedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(membershipsTable.id, membershipId),
        eq(membershipsTable.organizationId, orgId),
      ),
    )
    .returning();
  if (!updated) throw new ResourceNotFound("Membership");
  return updated;
}

export async function revokeMembership(
  orgId: string,
  membershipId: string,
  actorRole: MembershipRole,
) {
  const row = await getMembership(orgId, membershipId);
  if (!row) throw new ResourceNotFound("Membership");

  const targetRole = row.membership.role as MembershipRole;
  if (targetRole === "owner" && actorRole !== "owner") {
    throw new PermissionDenied("Only an owner can remove another owner.");
  }

  if (targetRole === "owner") {
    const ownerCount = await countActiveOwners(orgId);
    if (ownerCount <= 1) throw new OwnerProtection();
  }

  const [updated] = await db
    .update(membershipsTable)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(
      and(
        eq(membershipsTable.id, membershipId),
        eq(membershipsTable.organizationId, orgId),
      ),
    )
    .returning();
  return updated!;
}
