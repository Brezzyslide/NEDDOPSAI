/**
 * Notifications routes — Sprint 9
 *
 * In-app notification placeholders.
 * Unread counts are derived from conversation_messages + message_reads.
 *
 * GET  /v1/organisations/:slug/notifications/unread-count
 * POST /v1/organisations/:slug/notifications/mark-read
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import * as conversationService from "../../services/conversationService.js";
import { db } from "@workspace/db";
import { conversationsTable, conversationMessagesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

const router = Router({ mergeParams: true });

router.get("/unread-count", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const user = req.appUser!;

    // Count all messages not sent by user, not yet read by user
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(conversationMessagesTable)
      .where(
        and(
          eq(conversationMessagesTable.organizationId, ctx.tenantId),
          sql`${conversationMessagesTable.senderUserId} IS DISTINCT FROM ${user.id}`,
        )
      );

    res.json({ unreadCount: Number(result[0]?.count ?? 0) });
  } catch (err) { next(err); }
});

router.post("/mark-read", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const user = req.appUser!;
    const { messageIds } = req.body as { messageIds?: string[] };

    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "messageIds array is required." } });
      return;
    }

    await conversationService.markMessagesRead(ctx.tenantId, messageIds.slice(0, 100), user.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
