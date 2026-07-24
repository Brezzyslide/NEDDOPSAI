/**
 * plan_features table — Sprint 3
 * Which features are included in a given plan version.
 */
import { pgTable, text, boolean, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { planVersionsTable } from "./planVersions.js";
import { featuresTable } from "./features.js";

export const planFeaturesTable = pgTable(
  "plan_features",
  {
    planVersionId: text("plan_version_id")
      .notNull()
      .references(() => planVersionsTable.id, { onDelete: "cascade" }),
    featureCode: text("feature_code")
      .notNull()
      .references(() => featuresTable.code, { onDelete: "cascade" }),
    /** Is this feature enabled by default or must the tenant explicitly opt in? */
    enabledByDefault: boolean("enabled_by_default").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.planVersionId, t.featureCode] }),
  }),
);

export type PlanFeature = typeof planFeaturesTable.$inferSelect;
export type InsertPlanFeature = typeof planFeaturesTable.$inferInsert;
