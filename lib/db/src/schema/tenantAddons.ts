/**
 * tenant_addons table — Sprint 3
 * Optional add-ons purchased by an organisation on top of their base plan.
 * Sprint 3: manually seeded. Sprint 4+: Stripe-managed.
 */
import { pgTable, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";

export const tenantAddonsTable = pgTable("tenant_addons", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  addonCode: text("addon_code").notNull(),  // e.g. "extra_seats_10"
  quantity: integer("quantity").notNull().default(1),
  startAt: timestamp("start_at", { withTimezone: true }).notNull().defaultNow(),
  endAt: timestamp("end_at", { withTimezone: true }),
  metadata: jsonb("metadata").notNull().default({}),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TenantAddon = typeof tenantAddonsTable.$inferSelect;
export type InsertTenantAddon = typeof tenantAddonsTable.$inferInsert;
