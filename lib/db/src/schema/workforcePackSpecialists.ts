/**
 * workforce_pack_specialists table — Sprint 3
 * Join table linking workforce packs to specialist codes.
 * Populated from the workforce registry during seeding.
 * Used for DB-level queries about pack → specialist relationships.
 */
import { pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core";

export const workforcePackSpecialistsTable = pgTable(
  "workforce_pack_specialists",
  {
    packCode: text("pack_code").notNull(),         // e.g. "compliance"
    specialistCode: text("specialist_code").notNull(), // e.g. "compliance_officer"
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.packCode, t.specialistCode] }),
  }),
);

export type WorkforcePackSpecialist = typeof workforcePackSpecialistsTable.$inferSelect;
export type InsertWorkforcePackSpecialist = typeof workforcePackSpecialistsTable.$inferInsert;
