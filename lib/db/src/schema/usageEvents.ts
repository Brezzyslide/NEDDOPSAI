/**
 * usage_events table — Sprint 3
 * Individual usage events with idempotency support.
 * One row per discrete usage action. Aggregated into usage_period_summaries.
 *
 * Idempotency: (organization_id, dimension_code, idempotency_key) must be unique.
 */
import { pgTable, text, integer, timestamp, jsonb, unique } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";

export const usageEventsTable = pgTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    dimensionCode: text("dimension_code").notNull(),
    quantity: integer("quantity").notNull().default(1),
    /** Caller-provided key to prevent double-counting. e.g. taskId or planId */
    idempotencyKey: text("idempotency_key").notNull(),
    /** Linked resource (optional) */
    taskId: text("task_id"),
    specialistCode: text("specialist_code"),
    metadata: jsonb("metadata").notNull().default({}),
    /** Billing period this event belongs to */
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idempotent: unique("usage_events_idempotency")
      .on(t.organizationId, t.dimensionCode, t.idempotencyKey),
  }),
);

export type UsageEvent = typeof usageEventsTable.$inferSelect;
export type InsertUsageEvent = typeof usageEventsTable.$inferInsert;
