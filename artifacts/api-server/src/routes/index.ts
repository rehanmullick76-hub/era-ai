import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import creditsRouter from "./credits";
import projectsRouter from "./projects";
import aiRouter from "./ai";
import workspacesRouter from "./workspaces";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(creditsRouter);
router.use(projectsRouter);
router.use(aiRouter);
router.use(workspacesRouter);

export default router;
