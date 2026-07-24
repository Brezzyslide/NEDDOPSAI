/**
 * plan_workforce_packs table — Sprint 3
 * Which workforce packs are included in a given plan version.
 * Pack codes reference the workforce registry (not a FK to DB table — registry is source of truth).
 */
import { pgTable, text, boolean, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { planVersionsTable } from "./planVersions.js";

export const planWorkforcePacksTable = pgTable(
  "plan_workforce_packs",
  {
    planVersionId: text("plan_version_id")
      .notNull()
      .references(() => planVersionsTable.id, { onDelete: "cascade" }),
    packCode: text("pack_code").notNull(),  // e.g. "core", "compliance"
    isIncluded: boolean("is_included").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.planVersionId, t.packCode] }),
  }),
);

export type PlanWorkforcePack = typeof planWorkforcePacksTable.$inferSelect;
export type InsertPlanWorkforcePack = typeof planWorkforcePacksTable.$inferInsert;
