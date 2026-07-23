/**
 * email_delivery_logs table
 *
 * Tracks each email delivery attempt for an invitation.
 * Append-only — one row per attempt.
 * Security: never store API credentials or raw tokens.
 */
import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { invitationsTable } from "./invitations";

export const emailDeliveryStateEnum = pgEnum("email_delivery_state", [
  "not_attempted",
  "development_preview",
  "queued",
  "sent",
  "failed",
]);

export const emailDeliveryLogsTable = pgTable("email_delivery_logs", {
  id: text("id").primaryKey(),

  invitationId: text("invitation_id")
    .notNull()
    .references(() => invitationsTable.id, { onDelete: "cascade" }),

  /** 'resend' | 'development' */
  provider: text("provider").notNull(),

  deliveryState: emailDeliveryStateEnum("delivery_state").notNull(),

  /** Provider-assigned message ID (e.g. Resend message ID). Never the raw token. */
  providerMessageId: text("provider_message_id"),

  attemptedAt: timestamp("attempted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  sentAt: timestamp("sent_at", { withTimezone: true }),

  /** e.g. "provider_error" | "network_error" | "config_missing" */
  failureCategory: text("failure_category"),

  /** Human-readable summary, never includes API keys or tokens */
  failureSummary: text("failure_summary"),
});

export type EmailDeliveryLog = typeof emailDeliveryLogsTable.$inferSelect;
export type InsertEmailDeliveryLog = typeof emailDeliveryLogsTable.$inferInsert;
