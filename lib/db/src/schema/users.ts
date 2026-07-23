/**
 * users table — Sprint 1 rewrite
 *
 * In Sprint 1, users are identity records independent of organisations.
 * Organisation membership is tracked in the `memberships` table.
 * Authentication is handled by Clerk; `external_id` is the Clerk user ID.
 */
import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const userStatusEnum = pgEnum("user_status", [
  "pending_verification",
  "active",
  "suspended",
  "deactivated",
]);

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),

  /** Clerk user ID — the external identity provider reference */
  externalId: text("external_id").notNull().unique(),

  email: text("email").notNull().unique(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  displayName: text("display_name"),

  status: userStatusEnum("status").notNull().default("pending_verification"),

  /** Preferred timezone, e.g. "Australia/Sydney" */
  preferredTimezone: text("preferred_timezone").default("Australia/Sydney"),
  locale: text("locale").default("en-AU"),

  /** Legal acceptance tracking */
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  termsVersion: text("terms_version"),
  privacyAcceptedAt: timestamp("privacy_accepted_at", { withTimezone: true }),
  privacyVersion: text("privacy_version"),

  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
