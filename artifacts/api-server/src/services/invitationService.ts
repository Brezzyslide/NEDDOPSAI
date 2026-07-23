/**
 * invitationService — Sprint 1
 *
 * Security rules:
 * - Raw tokens are NEVER stored; only SHA-256 hashes
 * - Token expiry is enforced at acceptance time
 * - The invitee's authenticated email must match the invitation email
 * - Accepted or revoked invitations cannot be reused
 */

import { randomUUID } from "crypto";
import { db, invitationsTable, membershipsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  generateInvitationToken,
  hashToken,
  buildInvitationUrl,
} from "../lib/invitationToken.js";
import {
  DuplicateMembership,
  InvitationAlreadyUsed,
  InvitationEmailMismatch,
  InvitationExpired,
  InvitationInvalid,
  ResourceNotFound,
} from "../lib/errors.js";
import type { MembershipRole } from "@workspace/shared";

export interface CreateInvitationParams {
  organizationId: string;
  email: string;
  role: MembershipRole;
  invitedByUserId: string;
}

export async function createInvitation(params: CreateInvitationParams) {
  // Check if there's already an active membership for this email
  const [existingUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, params.email.toLowerCase()))
    .limit(1);

  if (existingUser) {
    const [existingMembership] = await db
      .select({ id: membershipsTable.id, status: membershipsTable.status })
      .from(membershipsTable)
      .where(
        and(
          eq(membershipsTable.organizationId, params.organizationId),
          eq(membershipsTable.userId, existingUser.id),
        ),
      )
      .limit(1);

    if (existingMembership && existingMembership.status === "active") {
      throw new DuplicateMembership();
    }
  }

  const { rawToken, tokenHash, expiresAt } = generateInvitationToken();

  const [invitation] = await db
    .insert(invitationsTable)
    .values({
      id: randomUUID(),
      organizationId: params.organizationId,
      email: params.email.toLowerCase(),
      role: params.role,
      status: "pending",
      tokenHash,
      invitedBy: params.invitedByUserId,
      expiresAt,
    })
    .returning();

  const invitationUrl = buildInvitationUrl(rawToken);

  // Development: log the invitation URL since no email provider is configured
  if (process.env.NODE_ENV !== "production") {
    console.log(`\n🔗 INVITATION LINK (dev only — never expose in prod):`);
    console.log(`   Email: ${params.email}`);
    console.log(`   URL:   ${invitationUrl}`);
    console.log(`   Expires: ${expiresAt.toISOString()}\n`);
  }

  return { invitation: invitation!, invitationUrl };
}

export async function listInvitations(organizationId: string) {
  return db
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.organizationId, organizationId));
}

export async function getInvitationByToken(rawToken: string) {
  const tokenHash = hashToken(rawToken);
  const [invitation] = await db
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.tokenHash, tokenHash))
    .limit(1);
  return invitation ?? null;
}

export async function revokeInvitation(
  organizationId: string,
  invitationId: string,
) {
  const [invitation] = await db
    .select()
    .from(invitationsTable)
    .where(
      and(
        eq(invitationsTable.id, invitationId),
        eq(invitationsTable.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!invitation) throw new ResourceNotFound("Invitation");
  if (invitation.status !== "pending") throw new InvitationAlreadyUsed();

  const [updated] = await db
    .update(invitationsTable)
    .set({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(invitationsTable.id, invitationId))
    .returning();
  return updated!;
}

export async function resendInvitation(
  organizationId: string,
  invitationId: string,
) {
  const [invitation] = await db
    .select()
    .from(invitationsTable)
    .where(
      and(
        eq(invitationsTable.id, invitationId),
        eq(invitationsTable.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!invitation) throw new ResourceNotFound("Invitation");
  if (invitation.status !== "pending") throw new InvitationAlreadyUsed();

  // Generate a new token + new expiry
  const { rawToken, tokenHash, expiresAt } = generateInvitationToken();

  const [updated] = await db
    .update(invitationsTable)
    .set({ tokenHash, expiresAt, updatedAt: new Date() })
    .where(eq(invitationsTable.id, invitationId))
    .returning();

  const invitationUrl = buildInvitationUrl(rawToken);

  if (process.env.NODE_ENV !== "production") {
    console.log(`\n🔗 RESENT INVITATION LINK (dev only):`);
    console.log(`   Email: ${invitation.email}`);
    console.log(`   URL:   ${invitationUrl}`);
    console.log(`   Expires: ${expiresAt.toISOString()}\n`);
  }

  return { invitation: updated!, invitationUrl };
}

/**
 * Accepts an invitation.
 * - Verifies token, expiry, and email match
 * - Creates an active membership for the user
 * - Marks invitation as accepted
 */
export async function acceptInvitation(rawToken: string, userId: string, userEmail: string) {
  const invitation = await getInvitationByToken(rawToken);

  if (!invitation) throw new InvitationInvalid();
  if (invitation.status === "accepted") throw new InvitationAlreadyUsed();
  if (invitation.status === "revoked") throw new InvitationInvalid();
  if (invitation.status === "expired") throw new InvitationExpired();
  if (new Date() > invitation.expiresAt) {
    await db
      .update(invitationsTable)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(invitationsTable.id, invitation.id));
    throw new InvitationExpired();
  }

  // Email must match the invitation
  if (invitation.email !== userEmail.toLowerCase()) {
    throw new InvitationEmailMismatch();
  }

  // Check for duplicate membership
  const [existing] = await db
    .select({ status: membershipsTable.status })
    .from(membershipsTable)
    .where(
      and(
        eq(membershipsTable.organizationId, invitation.organizationId),
        eq(membershipsTable.userId, userId),
      ),
    )
    .limit(1);

  if (existing?.status === "active") throw new DuplicateMembership();

  return db.transaction(async (tx) => {
    const [membership] = await tx
      .insert(membershipsTable)
      .values({
        id: randomUUID(),
        organizationId: invitation.organizationId,
        userId,
        role: invitation.role,
        status: "active",
        invitedBy: invitation.invitedBy,
        joinedAt: new Date(),
      })
      .returning();

    const [updated] = await tx
      .update(invitationsTable)
      .set({ status: "accepted", acceptedAt: new Date(), updatedAt: new Date() })
      .where(eq(invitationsTable.id, invitation.id))
      .returning();

    return { membership: membership!, invitation: updated! };
  });
}
