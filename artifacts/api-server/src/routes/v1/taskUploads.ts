/**
 * Task Uploads Router — Sprint 22 (Work Execution Engine & Completed Work)
 *
 * Conversation-scoped document uploads isolated from the Organisation Library.
 * Task Uploads may influence specialist execution but never permanently enter
 * the library unless explicitly promoted by an authorised user.
 *
 * Routes:
 *   POST /organisations/:slug/conversations/:conversationId/task-uploads
 *   GET  /organisations/:slug/conversations/:conversationId/task-uploads
 *   POST /organisations/:slug/conversations/:conversationId/task-uploads/:sourceId/promote
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import { db } from "@workspace/db";
import { knowledgeSourcesTable, knowledgeSourceVersionsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logOrgEvent } from "../../services/auditService.js";

const router = Router({ mergeParams: true });

function requireOwnerOrAdmin(req: any, res: any): boolean {
  const role = req.tenantContext?.role;
  if (role !== "owner" && role !== "admin") {
    res.status(403).json({ error: { code: "INSUFFICIENT_ROLE", message: "Owner or admin role required." } });
    return false;
  }
  return true;
}

// ─── Create task upload ────────────────────────────────────────────────────────

router.post(
  "/organisations/:slug/conversations/:conversationId/task-uploads",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx              = req.tenantContext!;
      const user             = req.appUser!;
      const { conversationId } = req.params as { conversationId: string };
      const { title, originalFileName, mimeType, storageKey, description } =
        req.body as Record<string, string | undefined>;

      if (!title) { res.status(400).json({ error: "title is required" }); return; }

      const sourceId  = randomUUID();
      const versionId = randomUUID();
      const now       = new Date();

      await db.insert(knowledgeSourcesTable).values({
        id:                     sourceId,
        organizationId:         ctx.tenantId,
        sourceScope:            "task",
        taskId:                 conversationId,
        title,
        description:            description ?? null,
        sourceType:             "task_upload",
        originalFileName:       originalFileName ?? null,
        mimeType:               mimeType ?? null,
        storageProvider:        "local",
        storageKey:             storageKey ?? null,
        checksum:               null,
        fileSize:               null,
        language:               "en",
        status:                 "approved",
        authorityLevel:         "supporting",
        sensitivityClassification: "internal",
        effectiveFrom:          null,
        effectiveTo:            null,
        versionLabel:           "1.0",
        isCurrent:              true,
        uploadedByUserId:       user.id,
        createdAt:              now,
        updatedAt:              now,
      });

      await db.insert(knowledgeSourceVersionsTable).values({
        id:               versionId,
        knowledgeSourceId: sourceId,
        organizationId:   ctx.tenantId,
        versionLabel:     "1.0",
        checksum:         null,
        storageKey:       storageKey ?? null,
        storageProvider:  "local",
        fileSize:         null,
        mimeType:         mimeType ?? null,
        originalFileName: originalFileName ?? null,
        isCurrent:        true,
        status:           "approved",
        uploadedByUserId: user.id,
        ingestionStatus:  "pending",
        createdAt:        now,
        updatedAt:        now,
      } as never);

      await logOrgEvent({
        organizationId: ctx.tenantId,
        actorUserId:    user.id,
        eventType:      "task_upload_created",
        resourceType:   "knowledge_source",
        resourceId:     sourceId,
        metadata:       { conversationId, title, sourceType: "task_upload" },
      });

      res.status(201).json({ sourceId, title, sourceType: "task_upload", sourceScope: "task", conversationId, status: "approved" });
    } catch (err) { next(err); }
  }
);

// ─── List task uploads ─────────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/conversations/:conversationId/task-uploads",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx              = req.tenantContext!;
      const { conversationId } = req.params as { conversationId: string };

      const uploads = await db
        .select({
          id:               knowledgeSourcesTable.id,
          title:            knowledgeSourcesTable.title,
          sourceType:       knowledgeSourcesTable.sourceType,
          originalFileName: knowledgeSourcesTable.originalFileName,
          mimeType:         knowledgeSourcesTable.mimeType,
          uploadedByUserId: knowledgeSourcesTable.uploadedByUserId,
          status:           knowledgeSourcesTable.status,
          createdAt:        knowledgeSourcesTable.createdAt,
        })
        .from(knowledgeSourcesTable)
        .where(
          and(
            eq(knowledgeSourcesTable.organizationId, ctx.tenantId),
            eq(knowledgeSourcesTable.sourceScope, "task"),
            eq(knowledgeSourcesTable.taskId, conversationId),
            isNull(knowledgeSourcesTable.deletedAt),
          )
        );

      res.json({ taskUploads: uploads });
    } catch (err) { next(err); }
  }
);

// ─── Promote to Library ───────────────────────────────────────────────────────

router.post(
  "/organisations/:slug/conversations/:conversationId/task-uploads/:sourceId/promote",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      if (!requireOwnerOrAdmin(req, res)) return;
      const ctx              = req.tenantContext!;
      const user             = req.appUser!;
      const { conversationId, sourceId } = req.params as { conversationId: string; sourceId: string };

      const rows = await db
        .select()
        .from(knowledgeSourcesTable)
        .where(
          and(
            eq(knowledgeSourcesTable.id, sourceId),
            eq(knowledgeSourcesTable.organizationId, ctx.tenantId),
            eq(knowledgeSourcesTable.sourceScope, "task"),
            eq(knowledgeSourcesTable.taskId, conversationId),
          )
        )
        .limit(1);

      const source = rows[0];
      if (!source) { res.status(404).json({ error: "Task upload not found" }); return; }

      const { documentType, authorityLevel } = req.body as { documentType?: string; authorityLevel?: string };
      if (!documentType) { res.status(400).json({ error: "documentType is required for Library promotion" }); return; }

      await db
        .update(knowledgeSourcesTable)
        .set({
          sourceScope:    "library",
          taskId:         null,
          sourceType:     documentType,
          authorityLevel: authorityLevel ?? source.authorityLevel ?? "supporting",
          status:         "review_required",
          updatedAt:      new Date(),
        } as never)
        .where(eq(knowledgeSourcesTable.id, sourceId));

      await logOrgEvent({
        organizationId: ctx.tenantId,
        actorUserId:    user.id,
        eventType:      "task_upload_promoted_to_library",
        resourceType:   "knowledge_source",
        resourceId:     sourceId,
        metadata:       { documentType, conversationId },
      });

      res.json({ sourceId, message: "Task upload promoted to Organisation Library — awaiting approval", newStatus: "review_required", newScope: "library", documentType });
    } catch (err) { next(err); }
  }
);

export default router;
