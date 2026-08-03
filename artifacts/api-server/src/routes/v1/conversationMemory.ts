/**
 * Conversation Memory routes — Sprint 9.2
 *
 * GET  /v1/organisations/:slug/conversations/:conversationId/memory          — get summary + pins
 * POST /v1/organisations/:slug/conversations/:conversationId/memory/summarise — trigger rolling summarisation
 * POST /v1/organisations/:slug/conversations/:conversationId/memory/pin       — pin a decision
 * DELETE /v1/organisations/:slug/conversations/:conversationId/memory/pin/:pinId — unpin
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import { fetchConversationMemory } from "../../services/contextSelectionService.js";
import {
  updateConversationSummary,
  shouldTriggerSummarisation,
  pinDecision,
  unpinDecision,
} from "../../services/conversationMemoryService.js";

const router = Router({ mergeParams: true });

// ─── Get memory for conversation ───────────────────────────────────────────────
router.get(
  "/organisations/:slug/conversations/:conversationId/memory",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { conversationId } = req.params as { conversationId: string };
      const memory = await fetchConversationMemory(ctx.tenantId, conversationId);
      const needsSummarisation = await shouldTriggerSummarisation(ctx.tenantId, conversationId);
      res.json({ memory, needsSummarisation });
    } catch (err) { next(err); }
  }
);

// ─── Trigger rolling summarisation ────────────────────────────────────────────
router.post(
  "/organisations/:slug/conversations/:conversationId/memory/summarise",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      const { conversationId } = req.params as { conversationId: string };
      const result = await updateConversationSummary(ctx.tenantId, conversationId, user.id);
      res.json(result);
    } catch (err) { next(err); }
  }
);

// ─── Pin a decision ───────────────────────────────────────────────────────────
router.post(
  "/organisations/:slug/conversations/:conversationId/memory/pin",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      const { conversationId } = req.params as { conversationId: string };
      const { decision, sourceMessageId } = req.body as {
        decision?: string;
        sourceMessageId?: string;
      };

      if (!decision || typeof decision !== "string" || !decision.trim()) {
        res.status(400).json({ error: "decision text is required" });
        return;
      }

      const pin = await pinDecision(ctx.tenantId, conversationId, decision.slice(0, 500), sourceMessageId ?? null, user.id);
      res.status(201).json({ pin });
    } catch (err) { next(err); }
  }
);

// ─── Unpin a decision ─────────────────────────────────────────────────────────
router.delete(
  "/organisations/:slug/conversations/:conversationId/memory/pin/:pinId",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      const { conversationId, pinId } = req.params as { conversationId: string; pinId: string };
      const ok = await unpinDecision(ctx.tenantId, conversationId, pinId, user.id);
      if (!ok) { res.status(404).json({ error: "Pin not found" }); return; }
      res.json({ ok: true });
    } catch (err) { next(err); }
  }
);

export default router;
