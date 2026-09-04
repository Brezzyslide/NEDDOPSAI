/**
 * Knowledge Hub — Specialist Training API (internal module name)
 * Customer-facing wording: "Train this specialist", "Add knowledge",
 *   "Choose Organisation Library sources", "Review what this specialist can use"
 *
 * Routes:
 *   GET    /v1/organisations/:slug/knowledge/training
 *   GET    /v1/organisations/:slug/knowledge/training/:specialistId
 *   PATCH  /v1/organisations/:slug/knowledge/training/:specialistId
 *   GET    /v1/organisations/:slug/knowledge/training/:specialistId/language-profile
 *   PUT    /v1/organisations/:slug/knowledge/training/:specialistId/language-profile
 *   GET    /v1/organisations/:slug/knowledge/training/:specialistId/config
 *   PUT    /v1/organisations/:slug/knowledge/training/:specialistId/config
 *   GET    /v1/organisations/:slug/knowledge/training/:specialistId/knowledge
 *   POST   /v1/organisations/:slug/knowledge/training/:specialistId/test
 *
 * Permission model:
 *   - Any authenticated org member may view training status, language profile, config, knowledge.
 *   - Transitioning to 'ready' or 'suspended' requires owner or admin.
 *   - Writing language profile and config: any member.
 *   - Running a test: any member.
 *   - Approving to 'ready': owner or admin only.
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import {
  getOrCreateTrainingStatus,
  listAllTrainingStatuses,
  transitionTrainingStatus,
  updateTrainingFlags,
  TrainingStatusError,
} from "../../services/specialistTrainingStatusService.js";
import {
  getOrCreateLanguageProfile,
  upsertLanguageProfile,
} from "../../services/specialistLanguageProfileService.js";
import {
  getOrCreateSpecialistConfig,
  upsertSpecialistConfig,
} from "../../services/specialistConfigService.js";
import { orchestrateKnowledge } from "../../services/knowledgeOrchestrationEngine.js";
import { TRAINING_STATUSES } from "@workspace/db";
import {
  knowledgeSourcesTable,
  knowledgeSourceScopesTable,
  withTenantContext,
} from "@workspace/db";
import { eq, and, or, isNull, inArray } from "drizzle-orm";

const router = Router({ mergeParams: true });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requireOwnerOrAdmin(req: any, res: any): boolean {
  const role = req.tenantContext?.role;
  if (role !== "owner" && role !== "admin") {
    res.status(403).json({
      error: { code: "INSUFFICIENT_ROLE", message: "Owner or admin role required." },
    });
    return false;
  }
  return true;
}

/** Map internal authority level to customer-friendly label */
function friendlyAuthority(level: string): string {
  const map: Record<string, string> = {
    mandatory:       "Required reading",
    authoritative:   "Authoritative source",
    supporting:      "Supporting source",
    example_only:    "Approved example",
    reference_only:  "Reference only",
  };
  return map[level] ?? level;
}

/** Map retrieval score range to customer-friendly match label */
function friendlyMatchLabel(score: number): string {
  if (score >= 0.85) return "Strong match";
  if (score >= 0.70) return "Good match";
  if (score >= 0.55) return "Supporting source";
  return "Possible match";
}

// ─── List all ─────────────────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/knowledge/training",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const statuses = await listAllTrainingStatuses(ctx.tenantId);
      res.json({ trainingStatuses: statuses });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Get for specialist ───────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/knowledge/training/:specialistId",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { specialistId } = req.params;
      const status = await getOrCreateTrainingStatus(ctx.tenantId, specialistId);
      res.json({ trainingStatus: status });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Update (transition or flag update) ───────────────────────────────────────

router.patch(
  "/organisations/:slug/knowledge/training/:specialistId",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      const { specialistId } = req.params;
      const role = ctx.role;

      const {
        status: newStatus,
        notes,
        configurationComplete,
        knowledgeSourcesApproved,
        retrievalTestPassed,
        sampleTaskPassed,
      } = req.body as Record<string, any>;

      if (newStatus !== undefined) {
        if (!TRAINING_STATUSES.includes(newStatus)) {
          res.status(400).json({
            error: {
              code: "INVALID_STATUS",
              message: `Invalid status "${newStatus}". Must be one of: ${TRAINING_STATUSES.join(", ")}`,
            },
          });
          return;
        }

        const updated = await transitionTrainingStatus({
          organizationId: ctx.tenantId,
          specialistId,
          newStatus,
          actorUserId: user.id,
          actorRole:   role,
          notes,
          flags: { configurationComplete, knowledgeSourcesApproved, retrievalTestPassed, sampleTaskPassed },
        });

        res.json({ trainingStatus: updated });
        return;
      }

      const updated = await updateTrainingFlags({
        organizationId: ctx.tenantId,
        specialistId,
        actorUserId:          user.id,
        configurationComplete,
        knowledgeSourcesApproved,
        retrievalTestPassed,
        sampleTaskPassed,
        notes,
      });

      res.json({ trainingStatus: updated });
    } catch (err) {
      if (err instanceof TrainingStatusError) {
        const status = err.code === "INSUFFICIENT_ROLE" ? 403 : 400;
        res.status(status).json({ error: { code: err.code, message: err.message } });
        return;
      }
      next(err);
    }
  },
);

// ─── Language profile GET ─────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/knowledge/training/:specialistId/language-profile",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { specialistId } = req.params;
      const profile = await getOrCreateLanguageProfile(ctx.tenantId, specialistId);
      res.json({ languageProfile: profile });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Language profile PUT ─────────────────────────────────────────────────────

router.put(
  "/organisations/:slug/knowledge/training/:specialistId/language-profile",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { specialistId } = req.params;
      const body = req.body as Record<string, any>;

      const profile = await upsertLanguageProfile({
        organizationId:           ctx.tenantId,
        specialistId,
        locale:                   body.locale,
        spellingConvention:       body.spellingConvention,
        tone:                     body.tone,
        formality:                body.formality,
        preferredTerms:           body.preferredTerms,
        prohibitedTerms:          body.prohibitedTerms,
        dateFormat:               body.dateFormat,
        timeFormat:               body.timeFormat,
        headingPreferences:       body.headingPreferences,
        sentenceLengthPreference: body.sentenceLengthPreference,
        outputStructure:          body.outputStructure,
        confirmProfile:           body.confirmProfile === true,
      });

      res.json({ languageProfile: profile });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Config GET ───────────────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/knowledge/training/:specialistId/config",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { specialistId } = req.params;
      const config = await getOrCreateSpecialistConfig(ctx.tenantId, specialistId);
      res.json({ config });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Config PUT ───────────────────────────────────────────────────────────────

router.put(
  "/organisations/:slug/knowledge/training/:specialistId/config",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { specialistId } = req.params;
      const body = req.body as Record<string, any>;

      const config = await upsertSpecialistConfig({
        organizationId:       ctx.tenantId,
        specialistId,
        goals:                body.goals,
        preferredStyle:       body.preferredStyle,
        escalationContacts:   body.escalationContacts,
        responsibilities:     body.responsibilities,
        additionalContext:    body.additionalContext,
        confirmConfiguration: body.confirmConfiguration === true,
      });

      res.json({ config });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Specialist knowledge GET ─────────────────────────────────────────────────
// Returns all approved library sources scoped to this specialist:
// (scopeType=organisation) OR (scopeType=workforce) OR (scopeType=specialist, scopeId=specialistId)

router.get(
  "/organisations/:slug/knowledge/training/:specialistId/knowledge",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { specialistId } = req.params;

      const { scopes, sources } = await withTenantContext(
        { tenantId: ctx.tenantId, userId: req.appUser!.id, purpose: "specialist_training.knowledge" },
        async (tx) => {
          // Find all scope records that include this specialist
          const scopedRows = await tx
            .select()
            .from(knowledgeSourceScopesTable)
            .where(
              and(
                eq(knowledgeSourceScopesTable.organizationId, ctx.tenantId),
                or(
                  and(
                    eq(knowledgeSourceScopesTable.scopeType, "organisation"),
                    eq(knowledgeSourceScopesTable.scopeId, "all"),
                  ),
                  and(
                    eq(knowledgeSourceScopesTable.scopeType, "workforce"),
                    eq(knowledgeSourceScopesTable.scopeId, "all"),
                  ),
                  and(
                    eq(knowledgeSourceScopesTable.scopeType, "specialist"),
                    eq(knowledgeSourceScopesTable.scopeId, specialistId),
                  ),
                ),
              ),
            );

          if (scopedRows.length === 0) {
            return { scopes: scopedRows, sources: [] };
          }

          const sourceIds = [...new Set(scopedRows.map(s => s.knowledgeSourceId))];

          const sourceRows = await tx
            .select()
            .from(knowledgeSourcesTable)
            .where(
              and(
                eq(knowledgeSourcesTable.organizationId, ctx.tenantId),
                isNull(knowledgeSourcesTable.deletedAt),
                inArray(knowledgeSourcesTable.id, sourceIds),
              ),
            );

          return { scopes: scopedRows, sources: sourceRows };
        },
      );

      if (scopes.length === 0) {
        res.json({ sources: [], total: 0 });
        return;
      }

      // Attach scope type to each source
      const sourcesWithScope = sources.map(s => ({
        ...s,
        scopes: scopes
          .filter(sc => sc.knowledgeSourceId === s.id)
          .map(sc => ({ scopeType: sc.scopeType, scopeId: sc.scopeId })),
      }));

      res.json({ sources: sourcesWithScope, total: sourcesWithScope.length });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Retrieval test POST ──────────────────────────────────────────────────────
// Tests what this specialist would retrieve for a given query.
// Returns customer-friendly citations — no raw scores, vectors, or internal labels.

router.post(
  "/organisations/:slug/knowledge/training/:specialistId/test",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { specialistId } = req.params;
      const { query } = req.body as { query?: string };

      if (!query?.trim()) {
        res.status(400).json({
          error: { code: "MISSING_QUERY", message: "A test query is required." },
        });
        return;
      }

      const result = await orchestrateKnowledge({
        organisationId: ctx.tenantId,
        specialistId,
        query:          query.trim(),
        tokenBudget:    2000,
        writeAudit:     false, // test mode — no audit write
      });

      // Flatten all document-layer items (P1+P2+P4+P5) into a single list for
      // the training UI. P3 org memory is excluded from the test view.
      const allItems = [
        ...result.taskUploadItems,
        ...result.entityItems,
        ...result.specialistItems,
        ...result.libraryItems,
      ];

      // Build a set of source IDs flagged in any conflict for O(1) lookup
      const conflictSourceIds = new Set(
        result.conflicts.flatMap(c => c.sourceIds),
      );

      // Format citations for the customer: no raw scores, no internal labels
      const citations = allItems.map(item => ({
        sourceId:     item.sourceId,
        title:        item.sourceTitle,
        excerpt:      item.content.slice(0, 400),
        section:      item.sectionTitle ?? null,
        pageNumber:   item.pageNumber ?? null,
        versionId:    item.versionId ?? null,
        authority:    friendlyAuthority(item.authorityLevel),
        matchLabel:   friendlyMatchLabel(Math.max(item.semanticScore, item.lexicalScore)),
        isApproved:   item.authorityLevel !== "reference_only",
        isCurrent:    item.isCurrent,
        scopeType:    item.priorityLayer,
        warnings: [
          ...(!item.isCurrent ? ["Outdated source — a newer version may be available"] : []),
          ...(conflictSourceIds.has(item.sourceId) ? ["Possible conflict with another source"] : []),
        ],
      }));

      // Conflict warnings (customer-friendly, using correct field names from ConflictWarning)
      const conflicts = result.conflicts.map(c => ({
        type:    c.conflictType === "effective_date_overlap"  ? "Overlapping scope" :
                 c.conflictType === "policy_conflict"         ? "Contradictory authority levels" :
                 "Possible conflict",
        sources: c.sourceIds,
        warning: c.description,
      }));

      res.json({
        query:            query.trim(),
        retrievalMethod:  result.retrievalMethod === "hybrid"  ? "Full knowledge search" :
                          result.retrievalMethod === "lexical" ? "Keyword search" : "Keyword search",
        citations,
        conflicts,
        sourcesUsed:      citations.length,
        conflictCount:    result.conflicts.length,
        testedAt:         new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
