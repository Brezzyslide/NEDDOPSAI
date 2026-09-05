/**
 * Notification Reads Service — Task #36
 *
 * Server-side read/archive/snooze state for notification items.
 * Notification IDs are synthetic strings (work-<uuid>, approval-<uuid>, etc.)
 * assembled by the notification centre from multiple data sources.
 *
 * All operations are scoped to (organization_id, user_id).
 */

import { randomUUID } from "crypto";
import { db, notificationReadsTable, withSystemTenantContext } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";

type DbClient = typeof db;

function withNotificationTenant<T>(
  organizationId: string,
  purpose: string,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  return withSystemTenantContext(
    { tenantId: organizationId, serviceIdentity: "notification_reads_service", purpose },
    fn,
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NotificationState {
  notificationId: string;
  isRead:         boolean;
  isArchived:     boolean;
  snoozedUntil:   string | null;
}

// ─── Read state ───────────────────────────────────────────────────────────────

/**
 * Return all notification state records for this user in this org.
 * Used by the notification centre to hydrate the full read/archive map.
 */
export async function getAllNotificationStates(
  organizationId: string,
  userId: string,
): Promise<NotificationState[]> {
  const rows = await withNotificationTenant(organizationId, "notification_reads.list", async (client) => client
    .select()
    .from(notificationReadsTable)
    .where(
      and(
        eq(notificationReadsTable.organizationId, organizationId),
        eq(notificationReadsTable.userId, userId),
      ),
    ));

  return rows.map(r => ({
    notificationId: r.notificationId,
    isRead:         r.readAt !== null,
    isArchived:     r.archivedAt !== null,
    snoozedUntil:   r.snoozedUntil?.toISOString() ?? null,
  }));
}

// ─── Mark read ────────────────────────────────────────────────────────────────

export async function markNotificationsRead(
  organizationId: string,
  userId: string,
  notificationIds: string[],
): Promise<void> {
  if (notificationIds.length === 0) return;
  const now = new Date();
  const rows = notificationIds.map(notificationId => ({
    id:             randomUUID(),
    organizationId,
    userId,
    notificationId,
    readAt:         now,
    archivedAt:     null,
    snoozedUntil:   null,
    createdAt:      now,
    updatedAt:      now,
  }));

  await withNotificationTenant(organizationId, "notification_reads.mark_read", async (client) => client
    .insert(notificationReadsTable)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        notificationReadsTable.organizationId,
        notificationReadsTable.userId,
        notificationReadsTable.notificationId,
      ],
      set: { readAt: now, updatedAt: now },
    }));
}

// ─── Mark unread ──────────────────────────────────────────────────────────────

export async function markNotificationsUnread(
  organizationId: string,
  userId: string,
  notificationIds: string[],
): Promise<void> {
  if (notificationIds.length === 0) return;
  await withNotificationTenant(organizationId, "notification_reads.mark_unread", async (client) => client
    .update(notificationReadsTable)
    .set({ readAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(notificationReadsTable.organizationId, organizationId),
        eq(notificationReadsTable.userId, userId),
        inArray(notificationReadsTable.notificationId, notificationIds),
      ),
    ));
}

// ─── Archive ──────────────────────────────────────────────────────────────────

export async function archiveNotifications(
  organizationId: string,
  userId: string,
  notificationIds: string[],
): Promise<void> {
  if (notificationIds.length === 0) return;
  const now = new Date();
  const rows = notificationIds.map(notificationId => ({
    id:             randomUUID(),
    organizationId,
    userId,
    notificationId,
    readAt:         now, // archiving also marks as read
    archivedAt:     now,
    snoozedUntil:   null,
    createdAt:      now,
    updatedAt:      now,
  }));

  await withNotificationTenant(organizationId, "notification_reads.archive", async (client) => client
    .insert(notificationReadsTable)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        notificationReadsTable.organizationId,
        notificationReadsTable.userId,
        notificationReadsTable.notificationId,
      ],
      set: { archivedAt: now, readAt: now, updatedAt: now },
    }));
}

// ─── Restore from archive ─────────────────────────────────────────────────────

export async function restoreNotifications(
  organizationId: string,
  userId: string,
  notificationIds: string[],
): Promise<void> {
  if (notificationIds.length === 0) return;
  await withNotificationTenant(organizationId, "notification_reads.restore", async (client) => client
    .update(notificationReadsTable)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(notificationReadsTable.organizationId, organizationId),
        eq(notificationReadsTable.userId, userId),
        inArray(notificationReadsTable.notificationId, notificationIds),
      ),
    ));
}

// ─── Snooze ───────────────────────────────────────────────────────────────────

export async function snoozeNotification(
  organizationId: string,
  userId: string,
  notificationId: string,
  snoozedUntil: Date,
): Promise<void> {
  const now = new Date();
  await withNotificationTenant(organizationId, "notification_reads.snooze", async (client) => client
    .insert(notificationReadsTable)
    .values({
      id:             randomUUID(),
      organizationId,
      userId,
      notificationId,
      readAt:         null,
      archivedAt:     null,
      snoozedUntil,
      createdAt:      now,
      updatedAt:      now,
    })
    .onConflictDoUpdate({
      target: [
        notificationReadsTable.organizationId,
        notificationReadsTable.userId,
        notificationReadsTable.notificationId,
      ],
      set: { snoozedUntil, updatedAt: now },
    }));
}
