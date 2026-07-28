/**
 * seat_overrides table — Sprint 9.7
 *
 * Platform staff can grant a temporary or permanent seat allowance override
 * to an organisation. The override supersedes the plan's included seat count.
 *
 * Rules:
 *  - Multiple overrides per org are allowed but only the one where
 *    effective_from <= NOW() <= effective_to (or effective_to IS NULL) is active.
 *  - If multiple active overrides exist (shouldn't happen), take the MAX.
 *  - Reducing an allowance that exceeds current usage is allowed but blocks
 *    new invitations until usage drops below the new allowance.
 */
import { pgTable, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { usersTable } from "./users.js";

export const seatOverridesTable = pgTable("seat_overrides", {
  id: text("id").primaryKey(),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** The overridden seat allowance. NULL means "unlimited". */
  seatAllowance: integer("seat_allowance"),

  /** Why the override was applied. */
  overrideReason: text("override_reason").notNull(),

  /** Platform staff member who applied this override. */
  setBy: text("set_by")
    .notNull()
    .references(() => usersTable.id, { onDelete: "set null" }),

  effectiveFrom: timestamp("effective_from", { withTimezone: true })
    .notNull()
    .defaultNow(),

  /** NULL = no expiry (permanent override). */
  effectiveTo: timestamp("effective_to", { withTimezone: true }),

  /** True if this override has been manually revoked before its natural expiry. */
  revoked: boolean("revoked").notNull().default(false),

  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: text("revoked_by"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type SeatOverride = typeof seatOverridesTable.$inferSelect;
export type InsertSeatOverride = typeof seatOverridesTable.$inferInsert;
