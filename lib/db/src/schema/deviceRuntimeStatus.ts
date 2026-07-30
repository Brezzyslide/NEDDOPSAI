/**
 * device_runtime_status table — Sprint 14
 *
 * Live status of the desktop app's local runtime components.
 * Upserted (never inserted) on each heartbeat — always one row per device.
 *
 * This table is for monitoring only; it never stores secrets.
 * RLS enforced via organization_id.
 */
import {
  pgTable,
  text,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { devicesTable } from "./devices.js";

export const deviceRuntimeStatusTable = pgTable("device_runtime_status", {
  id: text("id").primaryKey(),

  deviceId: text("device_id")
    .notNull()
    .unique()
    .references(() => devicesTable.id, { onDelete: "cascade" }),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  brokerVersion: text("broker_version"),
  openclawVersion: text("openclaw_version"),
  appVersion: text("app_version"),

  /** healthy | degraded | stopped */
  brokerStatus: text("broker_status"),
  openclawStatus: text("openclaw_status"),
  tunnelStatus: text("tunnel_status"),

  browserExtensionInstalled: boolean("browser_extension_installed"),
  browserName: text("browser_name"),

  /** Last execution id processed on this device */
  lastExecutionId: text("last_execution_id"),

  /** Last error message — must never contain secrets */
  errorMessage: text("error_message"),

  reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DeviceRuntimeStatus = typeof deviceRuntimeStatusTable.$inferSelect;
export type InsertDeviceRuntimeStatus = typeof deviceRuntimeStatusTable.$inferInsert;
