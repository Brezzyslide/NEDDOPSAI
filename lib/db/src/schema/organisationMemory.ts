/**
 * organisation_memory — Sprint 9.2
 *
 * Tenant-scoped knowledge base for the Chief of Staff.
 * Only 'approved' records enter AI context.
 * Soft lifecycle: proposed → approved → superseded/expired (never hard-deleted).
 */
import { pgTable, text, timestamp, jsonb, integer, numeric } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { usersTable } from "./users.js";

export const organisationMemoryTable = pgTable("organisation_memory", {
  id:               text("id").primaryKey(),
  organizationId:   text("organization_id").notNull()
                      .references(() => organizationsTable.id, { onDelete: "cascade" }),
  memoryType:       text("memory_type").notNull().default("other"),
  title:            text("title").notNull(),
  content:          text("content").notNull(),
  structuredContent:jsonb("structured_content").notNull().default({}),
  sourceType:       text("source_type").notNull().default("conversation"),
  sourceId:         text("source_id"),
  status:           text("status").notNull().default("proposed"),
  confidence:       numeric("confidence", { precision: 3, scale: 2 }).notNull().default("0.80"),
  importance:       integer("importance").notNull().default(5),
  effectiveFrom:    timestamp("effective_from",  { withTimezone: true }),
  effectiveTo:      timestamp("effective_to",    { withTimezone: true }),
  expiresAt:        timestamp("expires_at",      { withTimezone: true }),
  /**
   * Specialist scope for this memory record.
   * NULL  = org-wide (available to any authorised specialist).
   * value = workforce role code — only that specialist receives this memory.
   * Example: "incident_management", "chief_of_staff"
   */
  specialistId:     text("specialist_id"),
  createdBy:        text("created_by").notNull(),
  approvedBy:       text("approved_by"),
  approvedAt:       timestamp("approved_at", { withTimezone: true }),
  supersededBy:     text("superseded_by"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OrganisationMemory       = typeof organisationMemoryTable.$inferSelect;
export type InsertOrganisationMemory = typeof organisationMemoryTable.$inferInsert;
