import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import organizationsRouter from "./organizations.js";
import workforcePacksRouter from "./workforcePacks.js";
import systemRouter from "./system.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/organizations", organizationsRouter);
router.use("/workforce-packs", workforcePacksRouter);
router.use("/system", systemRouter);

export default router;
