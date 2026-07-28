/**
 * workforce_pack_access_requests — Sprint 9.6
 * Created when a tenant requests access to a workforce pack from the Plan page.
 * Platform staff review and approve/reject via the Platform Console.
 */
import { pgTable, pgEnum, text, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { workforcePacksTable } from "./workforcePacks.js";

export const packAccessRequestStatusEnum = pgEnum("pack_access_request_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "expired",
]);

export const workforcePackAccessRequestsTable = pgTable("workforce_pack_access_requests", {
  id:                   text("id").primaryKey(),
  organizationId:       text("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  workforcePackId:      text("workforce_pack_id").notNull().references(() => workforcePacksTable.id),
  packCode:             text("pack_code").notNull(),          // denormalised for easy queries
  requestedBy:          text("requested_by").notNull(),        // user id
  requestedAt:          timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  status:               packAccessRequestStatusEnum("status").notNull().default("pending"),
  reviewedBy:           text("reviewed_by"),
  reviewedAt:           timestamp("reviewed_at", { withTimezone: true }),
  reviewNotes:          text("review_notes"),
  requestedPriceVersionId: text("requested_price_version_id"), // price version at time of request
  source:               text("source").notNull().default("plan_page"), // plan_page | onboarding | api
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WorkforcePackAccessRequest = typeof workforcePackAccessRequestsTable.$inferSelect;
export type InsertWorkforcePackAccessRequest = typeof workforcePackAccessRequestsTable.$inferInsert;
