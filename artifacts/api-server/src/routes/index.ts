import { Router, type IRouter } from "express";
import healthRouter from "./health";
import organizationsRouter from "./organizations";
import workforcePacksRouter from "./workforcePacks";
import systemRouter from "./system";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/organizations", organizationsRouter);
router.use("/workforce-packs", workforcePacksRouter);
router.use("/system", systemRouter);

export default router;
