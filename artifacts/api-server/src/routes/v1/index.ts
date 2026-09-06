import { Router } from "express";
import meRouter from "./me.js";
import organisationsRouter from "./organisations.js";
import orgMembersRouter from "./orgMembers.js";
import orgInvitationsRouter from "./orgInvitations.js";
import orgAuditRouter from "./orgAudit.js";
import invitationAcceptRouter from "./invitationAccept.js";
import adminRouter from "./admin.js";
import workforceRouter from "./workforce.js";
import tasksRouter from "./tasks.js";
import participantsRouter from "./participants.js";
import approvalsRouter from "./approvalRoutes.js";
// Sprint 8: Execution lifecycle routes
import executionRouter from "./execution.js";
import runtimeEventsRouter from "./runtimeEvents.js";
// Sprint 9: Conversational Task Workroom
import conversationsRouter from "./conversations.js";
import taskWorkroomRouter from "./taskWorkroom.js";
import notificationsRouter from "./notifications.js";
// Sprint 9.2: Tenant-Aware Chief of Staff Memory
import conversationMemoryRouter from "./conversationMemory.js";
import organisationMemoryRouter from "./organisationMemory.js";
// Sprint 9.4: Capability Registry and Entitlement Checking
import { capabilitiesRouter, orgCapRouter } from "./capabilities.js";
// Sprint 9.5: Specialist runs (per-task) + Platform Capability Console
import specialistRunsRouter from "./specialistRuns.js";
import { platformCapabilitiesRouter } from "./platformCapabilities.js";
// Sprint 3 routers
import plansRouter from "./plans.js";
import workforcePacksRouter from "./workforcePacks.js";
import orgSubscriptionRouter from "./orgSubscription.js";
import platformRouter from "./platform.js";
import { apiErrorHandler } from "../../lib/errors.js";
// Sprint 10: Execution intents
import executionIntentsRouter from "./executionIntents.js";

const router = Router();

router.use("/me", meRouter);
router.use("/organisations", organisationsRouter);
router.use("/organisations/:slug/members", orgMembersRouter);
router.use("/organisations/:slug/invitations", orgInvitationsRouter);
router.use("/organisations/:slug/audit", orgAuditRouter);
router.use("/organisations/:slug/tasks", tasksRouter);
router.use("/organisations/:slug/participants", participantsRouter);
router.use("/organisations/:slug/approvals", approvalsRouter);
// Sprint 8: Task execution sessions
router.use("/organisations/:slug/tasks/:taskId/execution", executionRouter);
// Sprint 9: Task Workroom (messages, clarifications, commands per task)
router.use("/organisations/:slug/tasks/:taskId", taskWorkroomRouter);
// Sprint 9: Conversations (general + task-linked)
router.use("/organisations/:slug/conversations", conversationsRouter);
// Sprint 9: Notifications (unread counts, mark-read)
router.use("/organisations/:slug/notifications", notificationsRouter);
// Sprint 9.2: Conversation memory + Org memory (full-path routers)
router.use("/", conversationMemoryRouter);
router.use("/", organisationMemoryRouter);
// Sprint 3: subscription / entitlements / usage scoped to org
router.use("/organisations/:slug", orgSubscriptionRouter);
router.use("/invitations", invitationAcceptRouter);
router.use("/workforce", workforceRouter);
// Sprint 3: public plan catalogue and workforce-packs catalogue
router.use("/plans", plansRouter);
router.use("/workforce-packs", workforcePacksRouter);
// Sprint 8: OpenClaw webhook receiver (raw body — no json() middleware)
router.use("/", runtimeEventsRouter);
// Sprint 9.4: Capability registry and org-scoped capability entitlement
router.use("/capabilities", capabilitiesRouter);
router.use("/organisations/:slug/capabilities", orgCapRouter);
// Sprint 9.5: Specialist runs per task
router.use("/organisations/:slug/tasks/:taskId/specialist-runs", specialistRunsRouter);
// Sprint 9.5: Platform Capability Console + specialist run monitoring
router.use("/platform", platformCapabilitiesRouter);
// Sprint 10: Execution intents (task-scoped GET + approve/reject actions)
router.use("/", executionIntentsRouter);
// Sprint 9.6: Platform Pack Builder (CRUD for workforce packs + pricing)
import platformPacksRouter from "./platformPacks.js";
router.use("/platform/packs", platformPacksRouter);
// Sprint 9.6: Pack access requests (tenant + platform)
import { tenantPackRequestsRouter } from "./packAccessRequests.js";
import platformPackRequestsRouter from "./platformPackAccessRequests.js";
router.use("/organisations/:slug/pack-access-requests", tenantPackRequestsRouter);
router.use("/platform/pack-access-requests", platformPackRequestsRouter);
// Sprint 3: platform console (platform_roles DB-backed)
router.use("/platform", platformRouter);
router.use("/admin", adminRouter);
// Sprint 14 — NeedsOps AI+ Installer, Device Management, Business Discovery
import activationCodesRouter from "./activationCodes.js";
import devicesRouter from "./devices.js";
import paymentBypassRouter from "./paymentBypass.js";
import installerReleasesRouter from "./installerReleases.js";
import platformInstallerReleasesRouter from "./platformInstallerReleases.js";
import orgDiscoveryRouter from "./orgDiscovery.js";
router.use("/", activationCodesRouter);
router.use("/", devicesRouter);
router.use("/", paymentBypassRouter);
router.use("/", installerReleasesRouter);
router.use("/platform/installer", platformInstallerReleasesRouter);
router.use("/", orgDiscoveryRouter);
// Sprint 15 — Short-lived device auth (challenge / exchange / refresh)
import deviceAuthRouter from "./deviceAuth.js";
router.use("/devices", deviceAuthRouter);
// Task #15 — Knowledge Schema, Scopes & Secure Upload (Organisation Library)
import knowledgeSourcesRouter from "./knowledgeSources.js";
import specialistTrainingRouter from "./specialistTraining.js";
router.use("/", knowledgeSourcesRouter);
router.use("/", specialistTrainingRouter);
// Task #16 — Document Ingestion & Embedding Pipeline
import ingestionRouter from "./ingestion.js";
router.use("/", ingestionRouter);
// Task #19 — Knowledge Worker Health
import knowledgeWorkerHealthRouter from "./knowledgeWorkerHealth.js";
router.use("/platform", knowledgeWorkerHealthRouter);

// Sprint 21: Knowledge Curation (proposals, health, version intelligence)
import curationRouter from "./curation.js";
router.use("/", curationRouter);

// Sprint 22: Work Execution Engine — Blueprints, Executions, Completed Work, Task Uploads
import workBlueprintsRouter from "./workBlueprints.js";
import completedWorkRouter from "./completedWork.js";
import taskUploadsRouter from "./taskUploads.js";
router.use("/", workBlueprintsRouter);
router.use("/", completedWorkRouter);
router.use("/", taskUploadsRouter);

// Sprint 23: Executive Workspace — Briefing
import executiveBriefingRouter from "./executiveBriefing.js";
router.use("/", executiveBriefingRouter);

// Sprint 26: Workforce Operations Centre
import workforceOpsRouter from "./workforceOps.js";
router.use("/", workforceOpsRouter);

// Sprint 27.4 — Execution Inspector & Runtime Transparency
import executionInspectorRouter from "./executionInspector.js";
router.use("/", executionInspectorRouter);

// Sprint 28.6 — AI provider health check
import aiHealthRouter from "./aiHealth.js";
router.use("/", aiHealthRouter);

// Sprint 28.6 — DOCX extraction debug (platform staff only)
import docxDebugRouter from "./docxDebug.js";
router.use("/", docxDebugRouter);

// Sprint 1 error handler
router.use(apiErrorHandler as unknown as Parameters<typeof router.use>[0]);

export default router;
