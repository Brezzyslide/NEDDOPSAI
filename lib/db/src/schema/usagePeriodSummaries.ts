/**
 * usage_period_summaries table — Sprint 3
 * Aggregated usage per org per dimension per billing period.
 * Updated in real-time as usage events are recorded.
 * Used for fast usage checks without scanning all events.
 */
import { pgTable, text, integer, bigint, timestamp, unique } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";

export const usagePeriodSummariesTable = pgTable(
  "usage_period_summaries",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    dimensionCode: text("dimension_code").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    totalQuantity: bigint("total_quantity", { mode: "number" }).notNull().default(0),
    eventCount: integer("event_count").notNull().default(0),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniquePeriod: unique("usage_period_unique")
      .on(t.organizationId, t.dimensionCode, t.periodStart),
  }),
);

export type UsagePeriodSummary = typeof usagePeriodSummariesTable.$inferSelect;
export type InsertUsagePeriodSummary = typeof usagePeriodSummariesTable.$inferInsert;
