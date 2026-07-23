/**
 * invitations table — Sprint 1
 *
 * Security rules:
 * - tokenHash stores SHA-256(rawToken), never the raw token
 * - Tokens expire (default 7 days)
 * - Tokens are single-use (accepted tokens cannot be reused)
 * - Invitation email must match the authenticated account at acceptance
 */
import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";
import { membershipRoleEnum } from "./memberships";

export const invitationStatusEnum = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "expired",
  "revoked",
]);

export const invitationsTable = pgTable("invitations", {
  id: text("id").primaryKey(),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** Email address the invitation was sent to */
  email: text("email").notNull(),

  /** Role that will be granted on acceptance */
  role: membershipRoleEnum("role").notNull().default("member"),

  status: invitationStatusEnum("status").notNull().default("pending"),

  /**
   * SHA-256 hash of the raw invitation token.
   * The raw token is sent via email and NEVER stored.
   */
  tokenHash: text("token_hash").notNull().unique(),

  invitedBy: text("invited_by")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),

  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),

  /**
   * Latest email delivery status — mirrored from email_delivery_logs for
   * quick access without a join. One of the emailDeliveryStateEnum values.
   */
  emailDeliveryStatus: text("email_delivery_status")
    .notNull()
    .default("not_attempted"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Invitation = typeof invitationsTable.$inferSelect;
export type InsertInvitation = typeof invitationsTable.$inferInsert;
