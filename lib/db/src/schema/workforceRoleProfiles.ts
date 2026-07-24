/**
 * workforce_role_profiles table — Sprint 2 Architecture Correction
 *
 * Join table linking Workforce Roles (AI Specialists) to Worker Profiles.
 * One Workforce Role may have multiple Worker Profiles (e.g. restricted vs
 * extended profile for different execution contexts).
 *
 * workforceRoleCode references specialists.code (not FK enforced — specialists
 * table is seeded from the registry, not a live FK target yet).
 * workerProfileCode references worker_profiles.code.
 */
import { pgTable, text, boolean, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { workerProfilesTable } from "./workerProfiles.js";

export const workforceRoleProfilesTable = pgTable(
  "workforce_role_profiles",
  {
    workforceRoleCode: text("workforce_role_code").notNull(),
    workerProfileCode: text("worker_profile_code")
      .notNull()
      .references(() => workerProfilesTable.code, { onDelete: "cascade" }),
    /** When a role has multiple profiles, isPrimary marks the default */
    isPrimary: boolean("is_primary").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workforceRoleCode, table.workerProfileCode] }),
  })
);

export type WorkforceRoleProfile = typeof workforceRoleProfilesTable.$inferSelect;
export type InsertWorkforceRoleProfile = typeof workforceRoleProfilesTable.$inferInsert;
