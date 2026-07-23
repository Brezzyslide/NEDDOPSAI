/**
 * memberships table — Sprint 1
 *
 * A user may belong to multiple organisations with different roles in each.
 * This replaces the direct organizationId FK that existed on users in Sprint 0.
 */
import { pgTable, text, timestamp, pgEnum, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";

export const membershipRoleEnum = pgEnum("membership_role", [
  "owner",
  "administrator",
  "manager",
  "member",
  "viewer",
  "auditor",
]);

export const membershipStatusEnum = pgEnum("membership_status", [
  "invited",
  "active",
  "suspended",
  "revoked",
]);

export const membershipsTable = pgTable(
  "memberships",
  {
    id: text("id").primaryKey(),

    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),

    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    role: membershipRoleEnum("role").notNull().default("member"),
    status: membershipStatusEnum("status").notNull().default("invited"),

    /** Who invited this user (null for the org creator / owner) */
    invitedBy: text("invited_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),

    joinedAt: timestamp("joined_at", { withTimezone: true }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // A user can only have one active membership per organisation
    unique("memberships_org_user_unique").on(t.organizationId, t.userId),
  ],
);

export type Membership = typeof membershipsTable.$inferSelect;
export type InsertMembership = typeof membershipsTable.$inferInsert;
