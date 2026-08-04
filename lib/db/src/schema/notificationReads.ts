/**
 * notification_reads — Task #36
 *
 * Per-user, per-tenant read/archive/snooze state for any notification item.
 * Notification IDs are synthetic strings (e.g. "work-uuid", "approval-uuid",
 * "proposal-uuid", "conv-unread") assembled by the notification service.
 *
 * Unique constraint on (organization_id, user_id, notification_id) so upserts
 * are safe. RLS enforced at the DB layer.
 */

import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { usersTable } from "./users.js";

export const notificationReadsTable = pgTable(
  "notification_reads",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationsTable.id),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id),
    /** Synthetic notification ID, e.g. "work-<uuid>", "approval-<uuid>" */
    notificationId: text("notification_id").notNull(),
    /** Null = unread, set when user marks as read */
    readAt: timestamp("read_at", { withTimezone: true }),
    /** Null = not archived, set when user archives */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** Null = not snoozed, set when user snoozes */
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueUserNotif: uniqueIndex("notification_reads_user_notif_uidx")
      .on(table.organizationId, table.userId, table.notificationId),
  }),
);

export type NotificationRead   = typeof notificationReadsTable.$inferSelect;
export type InsertNotificationRead = typeof notificationReadsTable.$inferInsert;
