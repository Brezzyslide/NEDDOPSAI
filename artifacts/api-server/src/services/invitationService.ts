/**
 * invitationService — Sprint 1 (email delivery update)
 *
 * Security rules:
 * - Raw tokens are NEVER stored; only SHA-256 hashes
 * - Token expiry is enforced at acceptance time
 * - The invitee's authenticated email must match the invitation email
 * - Accepted or revoked invitations cannot be reused
 * - Email delivery failures do not delete the invitation
 */

import { randomUUID } from "crypto";
import {
  db,
  withSystemTenantContext,
  invitationsTable,
  usersTable,
  organizationsTable,
  emailDeliveryLogsTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import {
  generateInvitationToken,
  hashToken,
  buildInvitationUrl,
} from "../lib/invitationToken.js";
import {
  InvitationAlreadyUsed,
  InvitationEmailMismatch,
  InvitationExpired,
  InvitationInvalid,
  ResourceNotFound,
} from "../lib/errors.js";
import type { MembershipRole } from "@workspace/shared";
import { getEmailService } from "./email/index.js";
import type { EmailDeliveryResult } from "./email/index.js";

export type { EmailDeliveryResult };

type DbClient = typeof db;

type InvitationTokenContext = {
  invitation_id: string;
  organization_id: string;
  user_id: string;
  invitation_email: string;
  invitation_role: MembershipRole;
  invited_by: string;
};

export interface CreateInvitationParams {
  organizationId: string;
  email: string;
  role: MembershipRole;
  invitedByUserId: string;
}

export interface CreateInvitationResult {
  invitation: typeof invitationsTable.$inferSelect;
  /** Raw acceptance URL — only present in development mode for preview */
  previewUrl: string | null;
  emailDelivery: EmailDeliveryResult;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function withInvitationTenant<T>(
  organizationId: string,
  purpose: string,
  fn: (client: DbClient) => Promise<T>,
  client?: DbClient,
): Promise<T> {
  if (client) return fn(client);
  return withSystemTenantContext(
    { tenantId: organizationId, serviceIdentity: "invitation_service", purpose },
    fn,
  );
}

async function getOrgName(client: DbClient, organizationId: string): Promise<string> {
  const [org] = await client
    .select({ name: organizationsTable.name })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, organizationId))
    .limit(1);
  return org?.name ?? "your organisation";
}

async function getInviterName(client: DbClient, userId: string): Promise<string | null> {
  const [user] = await client
    .select({
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      displayName: usersTable.displayName,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) return null;
  if (user.displayName) return user.displayName;
  const parts = [user.firstName, user.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

async function logEmailDelivery(
  client: DbClient,
  invitationId: string,
  result: EmailDeliveryResult,
): Promise<void> {
  await client.insert(emailDeliveryLogsTable).values({
    id: randomUUID(),
    invitationId,
    provider: result.provider,
    deliveryState: result.state,
    providerMessageId: result.providerMessageId,
    attemptedAt: new Date(),
    sentAt: result.sentAt,
    failureCategory: result.failureCategory,
    failureSummary: result.failureSummary,
  });
}

// ─── createInvitation ─────────────────────────────────────────────────────────

export async function createInvitation(
  params: CreateInvitationParams,
  injectedClient?: DbClient,
): Promise<CreateInvitationResult> {
  return withInvitationTenant(params.organizationId, "invitation.create", async (client) => {
  // users.email currently stores Clerk fallback addresses for some accounts.
  // Do not use it for duplicate membership detection until Clerk email sync is fixed.

  const { rawToken, tokenHash, expiresAt } = generateInvitationToken();

  const [invitation] = await client
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
      emailDeliveryStatus: "not_attempted",
    })
    .returning();

  const acceptanceUrl = buildInvitationUrl(rawToken);

  // Look up org name and inviter for the email
  const [orgName, inviterName] = injectedClient
    ? await Promise.all([
        getOrgName(client, params.organizationId),
        getInviterName(client, params.invitedByUserId),
      ])
    : ["your organisation", null] as const;

  // Send invitation email through the service abstraction
  const emailService = getEmailService();
  const deliveryResult = await emailService.sendInvitationEmail({
    toEmail: params.email,
    orgName,
    inviterName,
    role: params.role,
    expiresAt,
    acceptanceUrl,
  });

  // Persist delivery log and update invitation status — do not throw on failure
  await Promise.all([
    logEmailDelivery(client, invitation!.id, deliveryResult).catch((err) =>
      console.error("[invitationService] Failed to write delivery log:", err),
    ),
    client
      .update(invitationsTable)
      .set({ emailDeliveryStatus: deliveryResult.state, updatedAt: new Date() })
      .where(eq(invitationsTable.id, invitation!.id))
      .catch((err) =>
        console.error("[invitationService] Failed to update delivery status:", err),
      ),
  ]);

  // Fetch the updated invitation so the caller has the latest state
  const [updated] = await client
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.id, invitation!.id))
    .limit(1);

  const isDev = process.env.NODE_ENV !== "production";
  const previewUrl = isDev && deliveryResult.state === "development_preview"
    ? acceptanceUrl
    : null;

  return {
    invitation: updated!,
    previewUrl,
    emailDelivery: deliveryResult,
  };
  }, injectedClient);
}

// ─── listInvitations ──────────────────────────────────────────────────────────

export async function listInvitations(organizationId: string, injectedClient?: DbClient) {
  return withInvitationTenant(organizationId, "invitation.list", (client) => client
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.organizationId, organizationId)), injectedClient);
}

// ─── getInvitationByToken ─────────────────────────────────────────────────────

export async function getInvitationByToken(rawToken: string, externalUserId: string) {
  const tokenHash = hashToken(rawToken);
  const resolved = await db.execute<InvitationTokenContext>(sql`
    SELECT *
    FROM public.resolve_invitation_token_context(${tokenHash}, ${externalUserId})
    LIMIT 1
  `);
  return resolved.rows[0] ?? null;
}

// ─── revokeInvitation ────────────────────────────────────────────────────────

export async function revokeInvitation(
  organizationId: string,
  invitationId: string,
  injectedClient?: DbClient,
) {
  return withInvitationTenant(organizationId, "invitation.revoke", async (client) => {
  const [invitation] = await client
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

  const [updated] = await client
    .update(invitationsTable)
    .set({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(invitationsTable.id, invitationId))
    .returning();
  return updated!;
  }, injectedClient);
}

// ─── resendInvitation ────────────────────────────────────────────────────────

export async function resendInvitation(
  organizationId: string,
  invitationId: string,
  resendingUserId: string,
  injectedClient?: DbClient,
): Promise<CreateInvitationResult> {
  return withInvitationTenant(organizationId, "invitation.resend", async (client) => {
  const [invitation] = await client
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
  if (invitation.status === "revoked") throw new InvitationInvalid();
  if (invitation.status === "accepted") throw new InvitationAlreadyUsed();
  if (invitation.status !== "pending") throw new InvitationAlreadyUsed();

  // Expire the old token by replacing it with a fresh one
  const { rawToken, tokenHash, expiresAt } = generateInvitationToken();

  await client
    .update(invitationsTable)
    .set({ tokenHash, expiresAt, emailDeliveryStatus: "not_attempted", updatedAt: new Date() })
    .where(eq(invitationsTable.id, invitationId));

  const acceptanceUrl = buildInvitationUrl(rawToken);

  const [orgName, inviterName] = injectedClient
    ? await Promise.all([
        getOrgName(client, organizationId),
        getInviterName(client, resendingUserId),
      ])
    : ["your organisation", null] as const;

  const emailService = getEmailService();
  const deliveryResult = await emailService.sendInvitationEmail({
    toEmail: invitation.email,
    orgName,
    inviterName,
    role: invitation.role,
    expiresAt,
    acceptanceUrl,
  });

  await Promise.all([
    logEmailDelivery(client, invitationId, deliveryResult).catch((err) =>
      console.error("[invitationService] Failed to write delivery log:", err),
    ),
    client
      .update(invitationsTable)
      .set({ emailDeliveryStatus: deliveryResult.state, updatedAt: new Date() })
      .where(eq(invitationsTable.id, invitationId))
      .catch((err) =>
        console.error("[invitationService] Failed to update delivery status:", err),
      ),
  ]);

  const [updated] = await client
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.id, invitationId))
    .limit(1);

  const isDev = process.env.NODE_ENV !== "production";
  const previewUrl = isDev && deliveryResult.state === "development_preview"
    ? acceptanceUrl
    : null;

  return {
    invitation: updated!,
    previewUrl,
    emailDelivery: deliveryResult,
  };
  }, injectedClient);
}

// ─── acceptInvitation ────────────────────────────────────────────────────────

export async function acceptInvitation(
  rawToken: string,
  externalUserId: string,
  userId: string,
  userEmail: string,
) {
  const invitation = await getInvitationByToken(rawToken, externalUserId);

  if (!invitation) throw new InvitationInvalid();

  // Email must match the invitation
  if (invitation.invitation_email !== userEmail.toLowerCase()) {
    throw new InvitationEmailMismatch();
  }

  // Check for duplicate membership
  return withInvitationTenant(invitation.organization_id, "invitation.accept", async (client) => {
  const [existing] = await client
    .select({ status: membershipsTable.status })
    .from(membershipsTable)
    .where(
      and(
        eq(membershipsTable.organizationId, invitation.organization_id),
        eq(membershipsTable.userId, userId),
      ),
    )
    .limit(1);

  if (existing?.status === "active") throw new DuplicateMembership();

    const [membership] = await client
      .insert(membershipsTable)
      .values({
        id: randomUUID(),
        organizationId: invitation.organization_id,
        userId,
        role: invitation.invitation_role,
        status: "active",
        invitedBy: invitation.invited_by,
        joinedAt: new Date(),
      })
      .returning();

    const [updated] = await client
      .update(invitationsTable)
      .set({ status: "accepted", acceptedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(invitationsTable.id, invitation.invitation_id),
          eq(invitationsTable.organizationId, invitation.organization_id),
        ),
      )
      .returning();

    return { membership: membership!, invitation: updated! };
  });
}
