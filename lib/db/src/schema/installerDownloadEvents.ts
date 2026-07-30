/**
 * installer_download_events table — Sprint 14
 *
 * Records each installer download for funnel analytics.
 * org_id may be null for unauthenticated downloads.
 * ip_hash is a one-way SHA-256 of the IP — for rate limiting, not identification.
 *
 * No RLS (platform-wide analytics).
 */
import {
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { installerReleasesTable } from "./installerReleases.js";

export const installerDownloadEventsTable = pgTable("installer_download_events", {
  id: text("id").primaryKey(),

  releaseId: text("release_id")
    .references(() => installerReleasesTable.id, { onDelete: "set null" }),

  /** Nullable — may be anonymous before login */
  organizationId: text("organization_id"),
  userId: text("user_id"),

  platform: text("platform"),
  arch: text("arch"),

  /** SHA-256(ip) — not personally identifiable, used for rate limiting */
  ipHash: text("ip_hash"),

  userAgent: text("user_agent"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InstallerDownloadEvent = typeof installerDownloadEventsTable.$inferSelect;
export type InsertInstallerDownloadEvent = typeof installerDownloadEventsTable.$inferInsert;
