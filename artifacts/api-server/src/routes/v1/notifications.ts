/**
 * Notifications routes — Task #36
 *
 * Server-backed read/archive/unread state for in-app notifications.
 *
 * GET  /v1/organisations/:slug/notifications/unread-count
 *      — Fixed: joins message_reads to exclude already-read messages.
 *
 * GET  /v1/organisations/:slug/notifications/state
 *      — Returns per-user read/archive state map for all known notification IDs.
 *
 * POST /v1/organisations/:slug/notifications/mark-read
 *      — Persists read state for one or more notification IDs.
 *
 * POST /v1/organisations/:slug/notifications/mark-unread
 *      — Clears read state for one or more notification IDs.
 *
 * POST /v1/organisations/:slug/notifications/archive
 *      — Archives (and marks read) one or more notification IDs.
 *
 * POST /v1/organisations/:slug/notifications/restore
 *      — Restores archived notifications to the inbox.
 *
 * POST /v1/organisations/:slug/notifications/snooze
 *      — Snoozes a notification until a given timestamp.
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import { db } from "@workspace/db";
import {
  conversationMessagesTable,
  messageReadsTable,
} from "@workspace/db";
import { eq, and, sql, isNull } from "drizzle-orm";
import * as notificationReadsService from "../../services/notificationReadsService.js";
import { markMessagesRead } from "../../services/conversationService.js";

const router = Router({ mergeParams: true });

// ─── Unread count — fixed to join message_reads ───────────────────────────────

router.get("/unread-count", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx  = req.tenantContext!;
    const user = req.appUser!;

    // Count non-self messages that do NOT have a message_reads row for this user
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(conversationMessagesTable)
      .leftJoin(
        messageReadsTable,
        and(
          eq(messageReadsTable.messageId, conversationMessagesTable.id),
          eq(messageReadsTable.userId, user.id),
          eq(messageReadsTable.organizationId, ctx.tenantId),
        ),
      )
      .where(
        and(
          eq(conversationMessagesTable.organizationId, ctx.tenantId),
          sql`${conversationMessagesTable.senderUserId} IS DISTINCT FROM ${user.id}`,
          isNull(messageReadsTable.id),
        ),
      );

    res.json({ unreadCount: Number(result[0]?.count ?? 0) });
  } catch (err) { next(err); }
});

// ─── Notification state — returns all per-user state for this org ─────────────

router.get("/state", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx  = req.tenantContext!;
    const user = req.appUser!;

    const states = await notificationReadsService.getAllNotificationStates(
      ctx.tenantId,
      user.id,
    );

    res.json({ states });
  } catch (err) { next(err); }
});

// ─── Mark read ────────────────────────────────────────────────────────────────

router.post("/mark-read", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx  = req.tenantContext!;
    const user = req.appUser!;
    const { notificationIds, messageIds } = req.body as {
      notificationIds?: string[];
      messageIds?:      string[];   // legacy compat — callers that only know about conversation messages
    };

    const notifIds   = (Array.isArray(notificationIds) ? notificationIds : []).slice(0, 200);
    const legacyMsgIds = (Array.isArray(messageIds) ? messageIds : []).slice(0, 200);

    // Both paths must have at least one ID; empty call is a client error
    if (notifIds.length === 0 && legacyMsgIds.length === 0) {
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "notificationIds array is required and must not be empty." },
      });
      return;
    }

    // Persist to notification_reads for all IDs (new server-backed state)
    const allIds = [...notifIds, ...legacyMsgIds];
    await notificationReadsService.markNotificationsRead(ctx.tenantId, user.id, allIds);

    // LEGACY COMPAT: also persist messageIds to message_reads so that
    // /unread-count (which JOINs message_reads) correctly decrements for
    // callers that pass raw conversation message IDs.
    if (legacyMsgIds.length > 0) {
      await markMessagesRead(ctx.tenantId, legacyMsgIds, user.id);
    }

    res.json({ ok: true, marked: allIds.length });
  } catch (err) { next(err); }
});

// ─── Mark unread ──────────────────────────────────────────────────────────────

router.post("/mark-unread", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx  = req.tenantContext!;
    const user = req.appUser!;
    const { notificationIds } = req.body as { notificationIds?: string[] };

    if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "notificationIds array is required." },
      });
      return;
    }

    await notificationReadsService.markNotificationsUnread(
      ctx.tenantId,
      user.id,
      notificationIds.slice(0, 200),
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Archive ──────────────────────────────────────────────────────────────────

router.post("/archive", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx  = req.tenantContext!;
    const user = req.appUser!;
    const { notificationIds } = req.body as { notificationIds?: string[] };

    if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "notificationIds array is required." },
      });
      return;
    }

    await notificationReadsService.archiveNotifications(
      ctx.tenantId,
      user.id,
      notificationIds.slice(0, 200),
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Restore ──────────────────────────────────────────────────────────────────

router.post("/restore", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx  = req.tenantContext!;
    const user = req.appUser!;
    const { notificationIds } = req.body as { notificationIds?: string[] };

    if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "notificationIds array is required." },
      });
      return;
    }

    await notificationReadsService.restoreNotifications(
      ctx.tenantId,
      user.id,
      notificationIds.slice(0, 200),
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Snooze ───────────────────────────────────────────────────────────────────

router.post("/snooze", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx  = req.tenantContext!;
    const user = req.appUser!;
    const { notificationId, snoozedUntil } = req.body as {
      notificationId?: string;
      snoozedUntil?:   string;
    };

    if (!notificationId || typeof notificationId !== "string") {
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "notificationId is required." },
      });
      return;
    }

    const snoozeDate = snoozedUntil ? new Date(snoozedUntil) : (() => {
      const d = new Date();
      d.setHours(d.getHours() + 24);
      return d;
    })();

    if (isNaN(snoozeDate.getTime())) {
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "snoozedUntil must be a valid ISO 8601 date." },
      });
      return;
    }

    await notificationReadsService.snoozeNotification(
      ctx.tenantId,
      user.id,
      notificationId,
      snoozeDate,
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
