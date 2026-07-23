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
import approvalsRouter from "./approvalRoutes.js";
import { apiErrorHandler } from "../../lib/errors.js";

const router = Router();

router.use("/me", meRouter);
router.use("/organisations", organisationsRouter);
router.use("/organisations/:slug/members", orgMembersRouter);
router.use("/organisations/:slug/invitations", orgInvitationsRouter);
router.use("/organisations/:slug/audit", orgAuditRouter);
router.use("/organisations/:slug/tasks", tasksRouter);
router.use("/organisations/:slug/approvals", approvalsRouter);
router.use("/invitations", invitationAcceptRouter);
router.use("/workforce", workforceRouter);
router.use("/admin", adminRouter);

// Sprint 1 error handler
router.use(apiErrorHandler as unknown as Parameters<typeof router.use>[0]);

export default router;
