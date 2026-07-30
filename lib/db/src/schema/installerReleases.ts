/**
 * installer_releases table — Sprint 14
 *
 * Platform-wide catalogue of published NeedsOps AI+ installer binaries.
 * No per-tenant scoping — these are public release metadata records.
 * The actual binary is hosted on GitHub Releases or S3; this table stores metadata.
 *
 * No RLS (platform-wide, no tenant context).
 */
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
} from "drizzle-orm/pg-core";

export const installerReleasesTable = pgTable("installer_releases", {
  id: text("id").primaryKey(),

  /** Semantic version, e.g. "1.0.0" */
  version: text("version").notNull(),

  /** stable | beta | canary */
  channel: text("channel").notNull().default("stable"),

  /** macos | windows | linux */
  platform: text("platform").notNull(),

  /** arm64 | x64 | universal */
  arch: text("arch").notNull(),

  /** Public HTTPS URL to download the installer binary */
  downloadUrl: text("download_url").notNull(),

  /** SHA-256 hex checksum for verification */
  sha256: text("sha256"),

  /** File size in bytes */
  fileSizeBytes: integer("file_size_bytes"),

  /** Minimum supported OS version, e.g. "10.15" for macOS Catalina */
  minOsVersion: text("min_os_version"),

  /** Markdown release notes */
  releaseNotes: text("release_notes"),

  /** True = returned by "latest" lookup */
  isCurrent: boolean("is_current").notNull().default(false),

  publishedAt: timestamp("published_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InstallerRelease = typeof installerReleasesTable.$inferSelect;
export type InsertInstallerRelease = typeof installerReleasesTable.$inferInsert;
