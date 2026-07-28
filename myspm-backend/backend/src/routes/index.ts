import { Router, type IRouter } from "express";
import { authMiddleware, authorize } from "../middlewares/auth";
import authRouter from "./auth";
import healthRouter from "./health";
import scanRouter from "./scan";
import dashboardRouter from "./dashboard";
import questionsRouter from "./questions";
import examsRouter from "./exams";
import assignmentsRouter from "./assignments";
import resultsRouter from "./results";
import usersRouter from "./users";
import rolesRouter from "./roles";
import systemParametersRouter from "./systemParameters";
import lovRouter from "./lov";
import initRouter from "./init";
import mobileRouter from "./mobile";
import ragRouter from "./rag";

const router: IRouter = Router();

// Public routes (no auth required)
router.use(authRouter);
router.use(healthRouter);
router.use(initRouter);
router.use(scanRouter);
router.use("/mobile", mobileRouter);
router.use("/rag", ragRouter);

// Protected routes (auth required) - apply middleware to each protected route group
// Dashboard - all authenticated users
router.use(authMiddleware, dashboardRouter);

// Questions - students and teachers can access
router.use("/questions", authMiddleware, authorize("student", "teacher"), questionsRouter);

// Exams - students and teachers
router.use("/exams", authMiddleware, authorize("student", "teacher"), examsRouter);

// Assignments - students and teachers
router.use("/assignments", authMiddleware, authorize("student", "teacher"), assignmentsRouter);

// Results - students and teachers
router.use("/results", authMiddleware, authorize("student", "teacher"), resultsRouter);

// Users - admin only
router.use("/users", authMiddleware, authorize("admin"), usersRouter);

// Roles - admin only
router.use("/roles", authMiddleware, authorize("admin"), rolesRouter);

// System parameters - admin only
router.use("/system-parameters", authMiddleware, authorize("admin"), systemParametersRouter);

// LOV (List of Values) - admin only
router.use("/lov", authMiddleware, authorize("admin"), lovRouter);

export default router;
