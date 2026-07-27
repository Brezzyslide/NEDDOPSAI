/**
 * specialist_queue — Sprint 9.5
 *
 * Durable database-backed queue for specialist runs.
 * Supports multiple workers, lease expiry, retries, and cancellation.
 * Designed to be replaceable by Amazon SQS later.
 *
 * RLS: organisation_id must match app.current_organization_id
 */

import {
  pgTable,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const SPECIALIST_QUEUE_STATUSES = [
  "waiting",
  "claimed",
  "running",
  "retrying",
  "blocked",
  "completed",
  "failed",
  "cancelled",
] as const;

export type SpecialistQueueStatus = (typeof SPECIALIST_QUEUE_STATUSES)[number];

export const specialistQueueTable = pgTable(
  "specialist_queue",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    specialistRunId: text("specialist_run_id").notNull(),
    priority: integer("priority").notNull().default(5),
    status: text("status").notNull().default("waiting"),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().default(sql`NOW()`),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimedBy: text("claimed_by"), // worker identifier
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`NOW()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`NOW()`),
  },
  (t) => [
    uniqueIndex("specialist_queue_run_idx").on(t.specialistRunId),
    index("specialist_queue_org_status_idx").on(t.organizationId, t.status),
    index("specialist_queue_available_priority_idx").on(t.availableAt, t.priority),
    index("specialist_queue_lease_idx").on(t.leaseExpiresAt),
  ],
);
