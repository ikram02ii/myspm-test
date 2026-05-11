import { Router, type IRouter } from "express";
import mobileAuthRouter from "./auth";
import dashboardRouter from "./dashboard";
import onboardingRouter from "./onboarding";
import profileRouter from "./profile";
import practiceSetsRouter from "./practiceSets";
import scanRouter from "./scan";
import leaderboardRouter from "./leaderboard";
import examTasksRouter from "./examTasks";

const router: IRouter = Router();

router.use(mobileAuthRouter);
router.use(onboardingRouter);
router.use(dashboardRouter);
router.use(profileRouter);
router.use(practiceSetsRouter);
router.use(scanRouter);
router.use(leaderboardRouter);
router.use(examTasksRouter);

export default router;
