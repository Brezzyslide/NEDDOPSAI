/**
 * specialist_capabilities join table — Sprint 2
 */
import { pgTable, text, primaryKey } from "drizzle-orm/pg-core";
import { specialistsTable } from "./specialists.js";
import { capabilitiesTable } from "./capabilities.js";

export const specialistCapabilitiesTable = pgTable(
  "specialist_capabilities",
  {
    specialistId: text("specialist_id")
      .notNull()
      .references(() => specialistsTable.id, { onDelete: "cascade" }),
    capabilityId: text("capability_id")
      .notNull()
      .references(() => capabilitiesTable.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.specialistId, t.capabilityId] })],
);
