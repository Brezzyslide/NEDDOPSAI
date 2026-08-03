/**
 * Executive Briefing Route — Sprint 23
 *
 * Generates a Chief of Staff executive briefing from live platform data.
 * Tries AI (if OpenAI configured), falls back to rule-based summary.
 *
 * GET /v1/organisations/:slug/executive-briefing
 */

import { Router }                       from "express";
import { randomUUID }                   from "crypto";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import { getKnowledgeHealthMetrics }    from "../../services/knowledgeHealthService.js";
import { listCompletedWork }            from "../../services/completedWorkService.js";
import { createAIGateway }              from "@workspace/ai-gateway";
import type { AIGatewayContext }        from "@workspace/ai-gateway";

const router = Router({ mergeParams: true });

// ─── System prompt ────────────────────────────────────────────────────────────

const BRIEFING_SYSTEM_PROMPT = `You are the Chief of Staff for a professional NDIS disability services organisation using NeedsOps AI+.
Generate a concise executive morning briefing using only the operational data provided.

Rules:
- Maximum 4 sentences, natural prose
- Use ONLY data points that are non-zero / non-null — omit everything else
- Business language only — no AI, technical, or system terminology
- Tone: professional, calm, direct — like a real Chief of Staff briefing an executive
- No bullet points, no headers, no markdown

Good examples:
"Good morning. Three work items were completed overnight, and two approval requests require your attention."
"Knowledge Health remains strong at 94. Your AI Workforce is fully operational."
"Two work items are currently in progress. One is awaiting your approval before proceeding."`;

function buildAIPrompt(ctx: BriefingContext): string {
  const lines = ["Current operational data:"];
  if (ctx.completedToday > 0) lines.push(`- Work completed today: ${ctx.completedToday}`);
  if (ctx.pendingApprovals > 0) lines.push(`- Items awaiting approval: ${ctx.pendingApprovals}`);
  if (ctx.activeWork > 0)       lines.push(`- Work items in progress: ${ctx.activeWork}`);
  if (ctx.healthScore !== null)  lines.push(`- Knowledge Health score: ${ctx.healthScore}/100`);
  lines.push(`- AI Workforce specialists online: ${ctx.activeSpecialists}`);
  lines.push("\nGenerate the executive briefing now.");
  return lines.join("\n");
}

// ─── Rule-based fallback ──────────────────────────────────────────────────────

interface BriefingContext {
  completedToday: number;
  pendingApprovals: number;
  activeWork: number;
  healthScore: number | null;
  activeSpecialists: number;
}

function buildRuleBriefing(ctx: BriefingContext): string {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const sentences: string[] = [`${greeting}.`];

  if (ctx.completedToday > 0) {
    sentences.push(
      `${ctx.completedToday} work item${ctx.completedToday > 1 ? "s were" : " was"} completed today.`
    );
  }
  if (ctx.pendingApprovals > 0) {
    sentences.push(
      `${ctx.pendingApprovals} item${ctx.pendingApprovals > 1 ? "s require" : " requires"} your approval.`
    );
  }
  if (ctx.activeWork > 0) {
    sentences.push(
      `${ctx.activeWork} work item${ctx.activeWork > 1 ? "s are" : " is"} currently in progress.`
    );
  }
  if (ctx.healthScore !== null) {
    const label = ctx.healthScore >= 80 ? "strong" : ctx.healthScore >= 60 ? "satisfactory" : "requires attention";
    sentences.push(`Knowledge Health is ${label} at ${ctx.healthScore}.`);
  }
  if (sentences.length === 1) {
    sentences.push("Your AI Workforce is standing by. No active items require attention.");
  }

  return sentences.join(" ");
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/executive-briefing",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx  = req.tenantContext!;
      const user = req.appUser!;

      // Gather data in parallel — settle all so partial failure is OK
      const [workResult, healthResult] = await Promise.allSettled([
        listCompletedWork(ctx.tenantId, { limit: 200 }),
        getKnowledgeHealthMetrics(ctx.tenantId),
      ]);

      const allWork: any[] = workResult.status === "fulfilled" ? workResult.value : [];

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const completedToday = allWork.filter(
        (w: any) => w.status === "approved" && w.createdAt && new Date(w.createdAt) >= today,
      ).length;
      const pendingApprovals = allWork.filter((w: any) => w.status === "awaiting_approval").length;
      const activeWork       = allWork.filter((w: any) => w.status === "draft").length;

      const healthData: any  = healthResult.status === "fulfilled" ? healthResult.value : null;
      const healthScore: number | null =
        healthData?.overallScore ?? healthData?.score ?? null;

      const briefingCtx: BriefingContext = {
        completedToday,
        pendingApprovals,
        activeWork,
        healthScore: typeof healthScore === "number" ? Math.round(healthScore) : null,
        activeSpecialists: 2, // chief_of_staff + operations_manager
      };

      // Try AI briefing
      let briefing: string;
      let usedAI = false;
      const provider = (process.env.AI_PROVIDER ?? "").toLowerCase().trim();

      if (provider === "openai") {
        try {
          const gatewayCtx: AIGatewayContext = {
            userId:               user.id,
            organizationId:       ctx.tenantId,
            role:                 (ctx as any).role ?? "member",
            permissions:          [],
            purpose:              "executive_briefing",
            correlationId:        randomUUID(),
            provider:             "openai",
            retentionClass:       "transient",
            requiresHumanApproval: false,
          };
          const gateway  = createAIGateway(gatewayCtx);
          const response = await gateway.process({
            systemPrompt: BRIEFING_SYSTEM_PROMPT,
            userMessage:  buildAIPrompt(briefingCtx),
            retrievedFields: [],
            maxTokens: 200,
          });

          if (!response.usedFallback && response.content?.trim()) {
            briefing = response.content.trim();
            usedAI   = true;
          } else {
            briefing = buildRuleBriefing(briefingCtx);
          }
        } catch {
          briefing = buildRuleBriefing(briefingCtx);
        }
      } else {
        briefing = buildRuleBriefing(briefingCtx);
      }

      res.json({ briefing, generatedAt: new Date().toISOString(), usedAI, context: briefingCtx });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
