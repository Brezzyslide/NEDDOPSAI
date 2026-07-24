/**
 * platform_roles table — Sprint 3
 * Platform staff role assignments. Completely separate from org membership.
 * Platform roles are assigned by a super admin and cannot be self-assigned.
 *
 * The presence of a row here grants platform console access.
 * Clerk publicMetadata.platformAdmin is still checked as a second gate for
 * session-level assertions; DB is the authoritative source.
 */
import { pgTable, pgEnum, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users.js";

export const platformRoleEnum = pgEnum("platform_role", [
  // Sprint 4 additions
  "platform_auditor",
  "platform_developer",
  "platform_super_admin",
  "platform_operations_admin",
  "platform_support_admin",
  "platform_billing_admin",
  "platform_security_auditor",
]);

export const platformRolesTable = pgTable("platform_roles", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  role: platformRoleEnum("role").notNull(),
  grantedBy: text("granted_by")
    .references(() => usersTable.id, { onDelete: "set null" }),
  grantReason: text("grant_reason"),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: text("revoked_by")
    .references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlatformRoleRow = typeof platformRolesTable.$inferSelect;
export type InsertPlatformRole = typeof platformRolesTable.$inferInsert;
