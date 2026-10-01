/**
 * Task Workroom routes — Sprint 9
 *
 * GET  /v1/organisations/:slug/tasks/:taskId/workroom
 * POST /v1/organisations/:slug/tasks/:taskId/messages
 * POST /v1/organisations/:slug/tasks/:taskId/clarifications/:clarificationId/respond
 * POST /v1/organisations/:slug/tasks/:taskId/plan/request-changes
 * POST /v1/organisations/:slug/tasks/:taskId/commands
 */

import { Router } from "express";
import { createHash, randomUUID } from "crypto";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import * as conversationService from "../../services/conversationService.js";
import * as taskService from "../../services/taskService.js";
import { dispatchWorkExecution } from "../../services/executionCoordinatorService.js";
import { cancelTaskExecution } from "../../services/executionService.js";
import { listCompletedWork, getCompletedWork } from "../../services/completedWorkService.js";
import { listCompletedWorkGeneratedArtifacts } from "../../services/completedWorkArtifactService.js";
import * as auditService from "../../services/auditService.js";
import { handleIncomingMessage } from "../../services/messageIngressService.js";
import { getRetrievalSubjectParticipantIdsForTask } from "../../services/taskParticipantService.js";
import {
  approvalsTable,
  knowledgeChunksTable,
  knowledgeSourceScopesTable,
  knowledgeSourcesTable,
  knowledgeSourceVersionsTable,
  workArtifactsTable,
  withTenantContext,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import type { TaskState } from "@workspace/shared";

const router = Router({ mergeParams: true });

function displayNameForUser(user: any): string {
  const name = String(user?.displayName ?? "").trim()
    || [user?.firstName, user?.lastName].map(v => String(v ?? "").trim()).filter(Boolean).join(" ")
    || String(user?.email ?? "").trim();
  return name || "Provider";
}

function displayRole(role: string | undefined): string {
  const raw = String(role ?? "provider").replace(/_/g, " ").trim();
  return raw.replace(/\b\w/g, c => c.toUpperCase());
}

function formatProviderStatementDate(date: Date): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function cleanStatementField(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function buildProviderStatementText(input: {
  authorName: string;
  authorRole: string;
  dateLabel: string;
  sectionCode: string;
  sectionTitle: string;
  gapDescription: string;
  missingDocument: string;
  text: string;
  evidenceClass: "PROVIDER_STATED" | "PARTICIPANT_STATED";
}): string {
  const statementKind = input.evidenceClass === "PARTICIPANT_STATED"
    ? "Participant-stated information relayed by provider"
    : "Provider-stated information";
  return [
    statementKind,
    `Advised by ${input.authorName}, ${input.authorRole}, ${input.dateLabel}.`,
    `Section: ${input.sectionTitle || input.sectionCode}`,
    `Section code: ${input.sectionCode}`,
    `Gap addressed: ${input.gapDescription}`,
    `Document that would close the gap: ${input.missingDocument}`,
    "",
    "Statement:",
    input.text,
  ].join("\n");
}

// ─── Get workroom (conversation + task detail for the full workroom page) ──────
router.get("/workroom", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const user = req.appUser!;
    const { taskId } = req.params as { taskId: string };

    const task = await taskService.getTaskById(taskId, ctx.tenantId);
    if (!task) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Task not found." } });
      return;
    }

    const plan = await taskService.getTaskPlan(taskId, ctx.tenantId);
    const conv = await conversationService.getOrCreateWorkroom(ctx.tenantId, taskId, user.id);
    const messages = await conversationService.getMessages(ctx.tenantId, conv.id, { limit: 100 });
    const unreadCount = await conversationService.getUnreadCount(ctx.tenantId, conv.id, user.id);
    const subjectParticipantIds = await getRetrievalSubjectParticipantIdsForTask(ctx.tenantId, taskId).catch(() => []);
    const taskMetadata = (task.metadata as Record<string, unknown> | null) ?? {};
    const completedWorkIds = new Set<string>();
    const executionCompletion = taskMetadata.executionCompletion as Record<string, unknown> | undefined;
    const approvalGate = taskMetadata.approvalGate as Record<string, unknown> | undefined;
    if (typeof executionCompletion?.completedWorkId === "string") completedWorkIds.add(executionCompletion.completedWorkId);
    if (typeof approvalGate?.completedWorkId === "string") completedWorkIds.add(approvalGate.completedWorkId);

    const artifactLinks = await withTenantContext(
      { tenantId: ctx.tenantId, userId: user.id, purpose: "task_workroom.artifact_links" },
      (tx) => tx.select({ completedWorkId: workArtifactsTable.completedWorkId })
        .from(workArtifactsTable)
        .where(and(
          eq(workArtifactsTable.organizationId, ctx.tenantId),
          eq(workArtifactsTable.taskId, taskId),
        )),
    );
    for (const link of artifactLinks) {
      if (link.completedWorkId) completedWorkIds.add(link.completedWorkId);
    }

    const conversationWork = await listCompletedWork(ctx.tenantId, {
      conversationId: conv.id,
      limit: 20,
    });
    for (const item of conversationWork) completedWorkIds.add(item.id);

    const completedWork = await Promise.all(
      Array.from(completedWorkIds).map(async (completedWorkId) => {
        const item = conversationWork.find(work => work.id === completedWorkId)
          ?? await getCompletedWork(completedWorkId, ctx.tenantId);
        if (!item) return null;
        const generatedArtifacts = await listCompletedWorkGeneratedArtifacts(item.id, ctx.tenantId);
        return { ...item, generatedArtifacts };
      }),
    );

    // Pending approval
    const [approval] = await withTenantContext(
      { tenantId: ctx.tenantId, userId: user.id, purpose: "task_workroom.pending_approval" },
      (tx) => tx.select()
        .from(approvalsTable)
        .where(and(eq(approvalsTable.organizationId, ctx.tenantId), eq(approvalsTable.taskId, taskId), eq(approvalsTable.state, "pending")))
        .limit(1),
    );

    res.json({
      task,
      plan: plan?.planData ?? null,
      conversation: conv,
      messages,
      unreadCount,
      pendingApproval: approval ?? null,
      completedWork: completedWork.filter(Boolean),
      providerContribution: {
        subjectParticipantIds,
        enabled: subjectParticipantIds.length > 0,
      },
    });
  } catch (err) { next(err); }
});

// ─── Add participant-scoped provider statement evidence ───────────────────────
router.post("/provider-statements", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const user = req.appUser!;
    const { taskId } = req.params as { taskId: string };
    const {
      participantId,
      sectionCode,
      sectionTitle,
      gapDescription,
      missingDocument,
      text,
      participantStated,
    } = req.body as Record<string, unknown>;

    const task = await taskService.getTaskById(taskId, ctx.tenantId);
    if (!task) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Task not found." } });
      return;
    }

    const subjectParticipantIds = await getRetrievalSubjectParticipantIdsForTask(ctx.tenantId, taskId);
    const targetParticipantId = cleanStatementField(participantId, 100) || (subjectParticipantIds.length === 1 ? subjectParticipantIds[0]! : "");
    if (!targetParticipantId || !subjectParticipantIds.includes(targetParticipantId)) {
      res.status(400).json({
        error: {
          code: "PARTICIPANT_REQUIRED",
          message: "Choose the task's subject participant before adding provider-stated evidence.",
        },
      });
      return;
    }

    const bodyText = String(text ?? "").trim();
    if (bodyText.length < 10) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Provider statement must be at least 10 characters." } });
      return;
    }
    if (bodyText.length > 6000) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Provider statement must be 6000 characters or less." } });
      return;
    }

    const cleanSectionCode = cleanStatementField(sectionCode, 120);
    const cleanSectionTitle = cleanStatementField(sectionTitle, 180) || cleanSectionCode;
    const cleanGap = cleanStatementField(gapDescription, 500);
    const cleanMissingDocument = cleanStatementField(missingDocument, 240);
    if (!cleanSectionCode || !cleanGap || !cleanMissingDocument) {
      res.status(400).json({
        error: {
          code: "TARGETED_GAP_REQUIRED",
          message: "Provider statements must name the section, the gap, and the document that would close it.",
        },
      });
      return;
    }

    const now = new Date();
    const sourceId = randomUUID();
    const versionId = randomUUID();
    const chunkId = randomUUID();
    const scopeId = randomUUID();
    const authorName = displayNameForUser(user);
    const authorRole = displayRole(ctx.role);
    const dateLabel = formatProviderStatementDate(now);
    const evidenceClass = participantStated === true ? "PARTICIPANT_STATED" : "PROVIDER_STATED";
    const statementText = buildProviderStatementText({
      authorName,
      authorRole,
      dateLabel,
      sectionCode: cleanSectionCode,
      sectionTitle: cleanSectionTitle,
      gapDescription: cleanGap,
      missingDocument: cleanMissingDocument,
      text: bodyText,
      evidenceClass,
    });
    const sourceTitle = `Advised by ${authorName}, ${authorRole}, ${dateLabel}`;

    await withTenantContext(
      { tenantId: ctx.tenantId, userId: user.id, purpose: "provider_statement.create" },
      async (tx) => {
        await tx.insert(knowledgeSourcesTable).values({
          id: sourceId,
          organizationId: ctx.tenantId,
          sourceScope: "library",
          taskId: null,
          title: sourceTitle,
          canonicalTitle: sourceTitle,
          description: `Provider statement for ${cleanSectionTitle}: ${cleanGap}`,
          sourceType: "provider_stated",
          documentCategory: "provider_stated",
          evidenceClass,
          originalFileName: null,
          mimeType: "text/plain",
          storageProvider: "local",
          storageKey: null,
          checksum: createHash("sha256").update(statementText, "utf8").digest("hex"),
          fileSize: Buffer.byteLength(statementText, "utf8"),
          language: "en-AU",
          status: "approved",
          authorityLevel: "reference_only",
          sensitivityClassification: "confidential",
          effectiveFrom: now,
          effectiveTo: null,
          versionLabel: "1.0",
          isCurrent: true,
          uploadedByUserId: user.id,
          approvedByUserId: user.id,
          approvedAt: now,
          searchAliases: [cleanSectionTitle, cleanSectionCode, cleanMissingDocument, cleanGap],
          createdAt: now,
          updatedAt: now,
        } as never);

        await tx.insert(knowledgeSourceVersionsTable).values({
          id: versionId,
          knowledgeSourceId: sourceId,
          organizationId: ctx.tenantId,
          versionLabel: "1.0",
          checksum: createHash("sha256").update(statementText, "utf8").digest("hex"),
          storageKey: null,
          storageProvider: "local",
          fileSize: Buffer.byteLength(statementText, "utf8"),
          mimeType: "text/plain",
          originalFileName: null,
          isCurrent: true,
          status: "approved",
          effectiveFrom: now,
          effectiveTo: null,
          uploadedByUserId: user.id,
          approvedByUserId: user.id,
          approvedAt: now,
          ingestionStatus: "complete",
          ingestionMetadata: {
            providerStatement: true,
            participantId: targetParticipantId,
            taskId,
            sectionCode: cleanSectionCode,
            sectionTitle: cleanSectionTitle,
            gapDescription: cleanGap,
            missingDocument: cleanMissingDocument,
            authorName,
            authorRole,
            advisedAt: now.toISOString(),
            evidenceClass,
          },
          createdAt: now,
          updatedAt: now,
        } as never);

        await tx.insert(knowledgeChunksTable).values({
          id: chunkId,
          organizationId: ctx.tenantId,
          knowledgeSourceId: sourceId,
          sourceVersionId: versionId,
          chunkIndex: 0,
          sectionTitle: cleanSectionTitle,
          pageNumber: null,
          headingPath: `Provider statement > ${cleanSectionTitle}`,
          text: statementText,
          tokenCount: Math.ceil(statementText.length / 4),
          embedding: null,
          embeddingModel: null,
          embeddingDimensions: null,
          contentHash: createHash("sha256").update(statementText, "utf8").digest("hex"),
          chunkingStrategy: "provider_statement_v1",
          chunkingStrategyVersion: "1.0.0",
          createdAt: now,
        } as never);

        await tx.insert(knowledgeSourceScopesTable).values({
          id: scopeId,
          knowledgeSourceId: sourceId,
          organizationId: ctx.tenantId,
          scopeType: "entity",
          scopeId: targetParticipantId,
          createdAt: now,
          updatedAt: now,
        });
      },
    );

    const conv = await conversationService.getOrCreateWorkroom(ctx.tenantId, taskId, user.id);
    const message = await conversationService.addMessage({
      organizationId: ctx.tenantId,
      conversationId: conv.id,
      taskId,
      senderType: "user",
      senderUserId: user.id,
      messageType: "text",
      content: `Provider statement added for ${cleanSectionTitle}: ${cleanGap}`,
      structuredContent: {
        type: "provider_statement_created",
        data: {
          sourceId,
          chunkId,
          participantId: targetParticipantId,
          sectionCode: cleanSectionCode,
          sectionTitle: cleanSectionTitle,
          gapDescription: cleanGap,
          missingDocument: cleanMissingDocument,
          evidenceClass,
          citation: sourceTitle,
        },
      },
    });

    await auditService.writeAuditEvent({
      organizationId: ctx.tenantId,
      actorUserId: user.id,
      eventType: "provider_statement.created",
      resourceType: "knowledge_source",
      resourceId: sourceId,
      metadata: {
        taskId,
        participantId: targetParticipantId,
        sectionCode: cleanSectionCode,
        sectionTitle: cleanSectionTitle,
        gapDescription: cleanGap,
        missingDocument: cleanMissingDocument,
        evidenceClass,
      },
      ...auditService.getRequestMeta(req),
    }).catch(() => {});

    res.status(201).json({
      providerStatement: {
        sourceId,
        chunkId,
        participantId: targetParticipantId,
        sectionCode: cleanSectionCode,
        sectionTitle: cleanSectionTitle,
        gapDescription: cleanGap,
        missingDocument: cleanMissingDocument,
        evidenceClass,
        citation: sourceTitle,
      },
      message,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Post message to task workroom ────────────────────────────────────────────
router.post("/messages", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const user = req.appUser!;
    const { taskId } = req.params as { taskId: string };
    const { content, idempotencyKey } = req.body as { content?: string; idempotencyKey?: string };
    const requestIdempotencyKey =
      typeof idempotencyKey === "string" && idempotencyKey.trim()
        ? idempotencyKey.trim()
        : req.header("Idempotency-Key") ?? req.header("X-Idempotency-Key") ?? undefined;

    if (!content || content.trim().length === 0) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "content is required." } });
      return;
    }
    if (content.length > 8000) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Message too long." } });
      return;
    }

    const task = await taskService.getTaskById(taskId, ctx.tenantId);
    if (!task) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Task not found." } });
      return;
    }

    const conv = await conversationService.getOrCreateWorkroom(ctx.tenantId, taskId, user.id);

    // SSE streaming — same pattern as conversation messages
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const sendEvent = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent({ type: "ack" });

    // Sprint 27.2 — Unified message ingress (checkpoint routing + CoS classification).
    // Workroom messages that answer clarification questions resume the paused
    // execution instead of going through normal CoS classification.
    const ingressResult = await handleIncomingMessage({
      content: content.trim(),
      organizationId: ctx.tenantId,
      conversationId: conv.id,
      taskId,
      userId: user.id,
      idempotencyKey: requestIdempotencyKey,
    });

    if (ingressResult.type === "checkpoint_resume") {
      sendEvent({ type: "user_message",  message: ingressResult.userMessage });
      sendEvent({ type: "agent_message", message: ingressResult.agentMessage ?? null });
      sendEvent({ type: "done" });
      res.end();
      return;
    }

    if (ingressResult.type === "checkpoint_duplicate") {
      sendEvent({ type: "done" });
      res.end();
      return;
    }

    if (ingressResult.type === "error") {
      sendEvent({ type: "error", message: ingressResult.message });
      res.end();
      return;
    }

    const result = ingressResult.result;

    const words = result.understanding.customerResponse.split(" ");
    for (const word of words) {
      sendEvent({ type: "token", content: word + " " });
      await new Promise(r => setTimeout(r, 8));
    }

    sendEvent({ type: "user_message", message: result.userMessage });
    sendEvent({
      type: "agent_message",
      // Coerce to null — see conversations.ts agent_message comment for full
      // explanation of why undefined must never reach the SSE stream.
      message: result.agentMessage ?? null,
      understanding: {
        conversationMode: result.understanding.conversationMode,
        requestedTaskAction: result.understanding.requestedTaskAction,
        shouldCreateTask: result.understanding.shouldCreateTask,
        clarificationRequired: result.understanding.clarificationRequired,
        clarificationQuestions: result.understanding.clarificationQuestions,
        proposedTask: result.understanding.proposedTask,
        relatedWorkforceRoles: result.understanding.relatedWorkforceRoles,
      },
    });
    sendEvent({ type: "done" });
    res.end();

    auditService.writeAuditEvent({
      organizationId: ctx.tenantId,
      actorUserId: user.id,
      eventType: "conversation.message_created",
      resourceType: "task",
      resourceId: taskId,
      metadata: { conversationId: conv.id, conversationMode: result.understanding.conversationMode },
      ...auditService.getRequestMeta(req),
    }).catch(() => {});

  } catch (err) {
    if (!res.headersSent) next(err);
    else { res.write(`data: ${JSON.stringify({ type: "error" })}\n\n`); res.end(); }
  }
});

// ─── Respond to clarification ─────────────────────────────────────────────────
router.post("/clarifications/:clarificationId/respond", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const user = req.appUser!;
    const { taskId, clarificationId } = req.params as { taskId: string; clarificationId: string };
    const { response } = req.body as { response?: string };

    if (!response || response.trim().length === 0) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "response is required." } });
      return;
    }

    const task = await taskService.getTaskById(taskId, ctx.tenantId);
    if (!task) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Task not found." } });
      return;
    }

    const conv = await conversationService.getOrCreateWorkroom(ctx.tenantId, taskId, user.id);

    // Store the user's clarification response
    const userMsg = await conversationService.addMessage({
      organizationId: ctx.tenantId,
      conversationId: conv.id,
      taskId,
      senderType: "user",
      senderUserId: user.id,
      messageType: "text",
      content: response.trim(),
      parentMessageId: clarificationId,
    });

    // Mark clarification resolved and generate acknowledgement
    const agentMsg = await conversationService.addMessage({
      organizationId: ctx.tenantId,
      conversationId: conv.id,
      taskId,
      senderType: "chief_of_staff",
      workforceRoleCode: "chief_of_staff",
      messageType: "text",
      content: "Thank you. I have recorded your response and will update the plan accordingly.",
      parentMessageId: clarificationId,
    });

    await auditService.writeAuditEvent({
      organizationId: ctx.tenantId,
      actorUserId: user.id,
      eventType: "clarification.responded",
      resourceType: "task",
      resourceId: taskId,
      metadata: { clarificationId, conversationId: conv.id },
      ...auditService.getRequestMeta(req),
    }).catch(() => {});

    res.json({ userMessage: userMsg, agentMessage: agentMsg });
  } catch (err) { next(err); }
});

// ─── Request plan changes ──────────────────────────────────────────────────────
router.post("/plan/request-changes", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const user = req.appUser!;
    const { taskId } = req.params as { taskId: string };
    const { feedback } = req.body as { feedback?: string };

    if (!feedback || feedback.trim().length === 0) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "feedback is required." } });
      return;
    }

    const task = await taskService.getTaskById(taskId, ctx.tenantId);
    if (!task) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Task not found." } });
      return;
    }

    const conv = await conversationService.getOrCreateWorkroom(ctx.tenantId, taskId, user.id);

    await conversationService.addMessage({
      organizationId: ctx.tenantId,
      conversationId: conv.id,
      taskId,
      senderType: "user",
      senderUserId: user.id,
      messageType: "text",
      content: `Plan change requested: ${feedback.trim()}`,
    });

    const agentMsg = await conversationService.addMessage({
      organizationId: ctx.tenantId,
      conversationId: conv.id,
      taskId,
      senderType: "chief_of_staff",
      workforceRoleCode: "chief_of_staff",
      messageType: "plan_revision",
      content: `Understood. I have recorded your feedback: "${feedback.trim()}". I will revise the plan and present an updated version for your review.`,
    });

    await auditService.writeAuditEvent({
      organizationId: ctx.tenantId,
      actorUserId: user.id,
      eventType: "plan.change_requested",
      resourceType: "task",
      resourceId: taskId,
      metadata: { conversationId: conv.id, feedback },
      ...auditService.getRequestMeta(req),
    }).catch(() => {});

    res.json({ agentMessage: agentMsg });
  } catch (err) { next(err); }
});

// ─── Task commands ─────────────────────────────────────────────────────────────
// Recognised commands: approve_plan, reject_plan, pause, resume, cancel, retry, status, create_follow_up
router.post("/commands", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const user = req.appUser!;
    const { taskId } = req.params as { taskId: string };
    const { command, payload } = req.body as { command?: string; payload?: Record<string, unknown> };

    if (!command) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "command is required." } });
      return;
    }

    const task = await taskService.getTaskById(taskId, ctx.tenantId);
    if (!task) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Task not found." } });
      return;
    }

    const conv = await conversationService.getOrCreateWorkroom(ctx.tenantId, taskId, user.id);
    const meta = auditService.getRequestMeta(req);

    let responseContent = "";
    let newState: TaskState | null = null;
    let dispatchAfterCommand = false;

    switch (command) {
      case "approve_plan":
        // Task must be in planning or awaiting_approval state
        if (!["planning", "awaiting_approval", "approved"].includes(task.currentState)) {
          res.status(422).json({ error: { code: "INVALID_TRANSITION", message: `Cannot approve plan when task is in state: ${task.currentState}.` } });
          return;
        }
        {
          const [pendingApproval] = await withTenantContext(
            { tenantId: ctx.tenantId, userId: user.id, purpose: "task_workroom.approve_plan_pending_approval" },
            (tx) => tx.select({ id: approvalsTable.id })
              .from(approvalsTable)
              .where(and(
                eq(approvalsTable.organizationId, ctx.tenantId),
                eq(approvalsTable.taskId, taskId),
                eq(approvalsTable.state, "pending"),
              ))
              .limit(1),
          );
          if (pendingApproval) {
            res.status(409).json({
              error: {
                code: "PENDING_APPROVAL_REQUIRED",
                message: "This task has a concrete pending approval request. Resolve that approval rather than using approve_plan.",
                approvalId: pendingApproval.id,
              },
            });
            return;
          }
        }
        newState = "approved";
        dispatchAfterCommand = true;
        responseContent = "Plan approved. The task is now queued for execution.";
        break;

      case "reject_plan":
        if (!["planning", "awaiting_approval"].includes(task.currentState)) {
          res.status(422).json({ error: { code: "INVALID_TRANSITION", message: "No plan to reject in current state." } });
          return;
        }
        newState = "cancelled";
        responseContent = "The plan has been rejected and the task cancelled. You can create a new task to start again.";
        break;

      case "cancel":
        if (task.currentState === "completed") {
          res.status(422).json({ error: { code: "INVALID_TRANSITION", message: "Completed tasks cannot be cancelled." } });
          return;
        }
        if (task.currentState === "cancelled") {
          responseContent = "The task was already cancelled.";
          break;
        }
        const result = await taskService.cancelTask(taskId, ctx.tenantId, {
          cancelledBy: user.id,
          source: "task_workroom_command",
          conversationId: conv.id,
        });
        if (result.status === "not_cancelled") {
          res.status(409).json({ error: { code: "TASK_NOT_CANCELLED", message: result.reason ?? "The task state did not allow cancellation." } });
          return;
        }
        await cancelTaskExecution(taskId, ctx.tenantId).catch(() => {});
        responseContent = "The task has been cancelled.";
        break;

      case "retry":
        if (!["failed", "queued"].includes(task.currentState)) {
          res.status(422).json({ error: { code: "INVALID_TRANSITION", message: "Only failed or queued tasks can be retried." } });
          return;
        }
        newState = task.currentState === "queued" ? null : "queued";
        dispatchAfterCommand = true;
        responseContent = "The task has been queued for retry.";
        break;

      case "status":
        responseContent = `Current status: ${task.currentState.replace(/_/g, " ")}.`;
        break;

      default:
        res.status(400).json({ error: { code: "UNKNOWN_COMMAND", message: `Unknown command: ${command}.` } });
        return;
    }

    // Apply state transition
    if (newState) {
      await taskService.transitionTaskState(taskId, ctx.tenantId, newState);
      await auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId: user.id,
        eventType: "task.command_completed",
        resourceType: "task",
        resourceId: taskId,
        metadata: { command, newState },
        ...meta,
      }).catch(() => {});
    } else if (command === "cancel") {
      await auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId: user.id,
        eventType: "task.command_completed",
        resourceType: "task",
        resourceId: taskId,
        metadata: { command, newState: "cancelled" },
        ...meta,
      }).catch(() => {});
    }

    if (dispatchAfterCommand) {
      dispatchWorkExecution({
        organizationId: ctx.tenantId,
        taskId,
        taskTitle: task.title,
        taskDescription: task.description ?? undefined,
        requesterId: user.id,
        conversationId: conv.id,
      }).catch(err =>
        console.warn("[taskWorkroom] Post-approval dispatch failed (non-fatal):", err?.message),
      );
    }

    // Post result to conversation thread
    const agentMsg = await conversationService.addMessage({
      organizationId: ctx.tenantId,
      conversationId: conv.id,
      taskId,
      senderType: "chief_of_staff",
      workforceRoleCode: "chief_of_staff",
      messageType: "status_change",
      content: responseContent,
      structuredContent: newState ? { type: "status_summary", data: { command, newState, taskId } } : null,
    });

    res.json({ ok: true, agentMessage: agentMsg, newState });
  } catch (err) { next(err); }
});

export default router;
