/**
 * device_task_dispatch — Sprint 15
 *
 * Durable task delivery queue for the WebSocket relay.
 * Each row represents a single attempt to dispatch a task to a device.
 * Idempotency is enforced by execution_id — duplicate dispatches return
 * the previously-known status rather than executing twice.
 *
 * Security:
 *   - RLS enforced via organization_id
 *   - Payload is JSON-encoded; sensitive fields should be omitted if not
 *     required by the local runtime (avoid persisting business secrets)
 *   - Completed/failed rows are retained for 30 days for audit purposes
 */
import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { devicesTable } from "./devices.js";

export const deviceTaskDispatchTable = pgTable("device_task_dispatch", {
  id: text("id").primaryKey(),

  deviceId: text("device_id")
    .notNull()
    .references(() => devicesTable.id, { onDelete: "cascade" }),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** Reference to the platform task that triggered this dispatch */
  taskId: text("task_id"),

  /** Unique identifier for this dispatch attempt — device uses this for idempotency */
  executionId: text("execution_id").notNull().unique(),

  /** JSON-encoded task payload sent to the device */
  payloadJson: text("payload_json").notNull(),

  /**
   * pending — created, not yet sent
   * sent    — dispatched over WS, awaiting ack
   * acknowledged — device confirmed receipt
   * running — device reported task started
   * completed — result received
   * failed — error received or max retries exhausted
   * cancelled — cancelled before delivery
   */
  status: text("status").notNull().default("pending"),

  /** Number of delivery attempts made */
  deliveryAttempts: integer("delivery_attempts").notNull().default(0),

  /** Max delivery attempts before moving to failed */
  maxDeliveryAttempts: integer("max_delivery_attempts").notNull().default(3),

  sentAt: timestamp("sent_at", { withTimezone: true }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),

  /** Reference to a stored result (e.g. object storage key) */
  resultRef: text("result_ref"),

  /** Short machine-readable error code */
  errorCode: text("error_code"),

  /** Last error message (human-readable, truncated to 2 KB) */
  lastError: text("last_error"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DeviceTaskDispatch = typeof deviceTaskDispatchTable.$inferSelect;
export type InsertDeviceTaskDispatch = typeof deviceTaskDispatchTable.$inferInsert;
