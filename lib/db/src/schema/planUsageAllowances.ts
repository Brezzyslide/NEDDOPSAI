/**
 * plan_usage_allowances table — Sprint 3
 * Per-dimension usage allowances for each plan version.
 * null hardLimit = unlimited.
 */
import { pgTable, text, bigint, real, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { planVersionsTable } from "./planVersions.js";

export const planUsageAllowancesTable = pgTable(
  "plan_usage_allowances",
  {
    planVersionId: text("plan_version_id")
      .notNull()
      .references(() => planVersionsTable.id, { onDelete: "cascade" }),
    dimensionCode: text("dimension_code").notNull(),  // references usage_dimensions.code
    /** null = unlimited. bigint supports byte counts up to ~9.2 exabytes. */
    hardLimit: bigint("hard_limit", { mode: "number" }),
    /** Warning threshold as percentage of hardLimit (e.g. 80.0). null = use platform default (80%) */
    softLimitPct: real("soft_limit_pct").default(80.0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.planVersionId, t.dimensionCode] }),
  }),
);

export type PlanUsageAllowance = typeof planUsageAllowancesTable.$inferSelect;
export type InsertPlanUsageAllowance = typeof planUsageAllowancesTable.$inferInsert;
