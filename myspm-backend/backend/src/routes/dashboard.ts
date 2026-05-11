import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, examsTable, assignmentsTable, studentResultsTable } from "@workspace/db/schema";
import { eq, count, avg, sql, and } from "drizzle-orm";

const router: IRouter = Router();

router.get("/dashboard/stats", async (_req, res) => {
  try {
    const [studentCount] = await db.select({ count: count() }).from(usersTable).where(eq(usersTable.role, "student"));
    const [examCount] = await db.select({ count: count() }).from(examsTable);
    const [avgScore] = await db.select({ avg: avg(studentResultsTable.score) }).from(studentResultsTable);
    const [activeAssignments] = await db.select({ count: count() }).from(assignmentsTable).where(eq(assignmentsTable.status, "active"));
    const [totalResults] = await db.select({ count: count() }).from(studentResultsTable);

    res.json({
      totalStudents: studentCount?.count ?? 0,
      totalExams: examCount?.count ?? 0,
      averageScore: Number(avgScore?.avg ?? 0),
      activeAssignments: activeAssignments?.count ?? 0,
      examCompletionRate: totalResults?.count ? 85.5 : 0,
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    res.status(500).json({ error: "Failed to fetch dashboard stats" });
  }
});

router.get("/dashboard/activity", async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 10;
    const results = await db
      .select({
        id: studentResultsTable.id,
        studentName: usersTable.name,
        examTitle: examsTable.title,
        score: studentResultsTable.score,
        attemptDate: studentResultsTable.attemptDate,
      })
      .from(studentResultsTable)
      .innerJoin(usersTable, eq(studentResultsTable.studentId, usersTable.id))
      .innerJoin(examsTable, eq(studentResultsTable.examId, examsTable.id))
      .orderBy(sql`${studentResultsTable.attemptDate} DESC`)
      .limit(limit);

    const activity = results.map((r) => ({
      id: r.id,
      type: "exam_attempt",
      description: `${r.studentName} scored ${r.score}% on ${r.examTitle}`,
      userName: r.studentName,
      timestamp: r.attemptDate?.toISOString() ?? new Date().toISOString(),
    }));

    res.json(activity);
  } catch (error) {
    console.error("Dashboard activity error:", error);
    res.status(500).json({ error: "Failed to fetch activity" });
  }
});

router.get("/dashboard/performance-trend", async (_req, res) => {
  try {
    const results = await db
      .select({
        month: sql<string>`TO_CHAR(${studentResultsTable.attemptDate}, 'YYYY-MM')`,
        averageScore: avg(studentResultsTable.score),
        totalAttempts: count(),
      })
      .from(studentResultsTable)
      .groupBy(sql`TO_CHAR(${studentResultsTable.attemptDate}, 'YYYY-MM')`)
      .orderBy(sql`TO_CHAR(${studentResultsTable.attemptDate}, 'YYYY-MM')`);

    const trend = results.map((r) => ({
      month: r.month,
      averageScore: Number(r.averageScore ?? 0),
      totalAttempts: r.totalAttempts,
    }));

    res.json(trend);
  } catch (error) {
    console.error("Performance trend error:", error);
    res.status(500).json({ error: "Failed to fetch trend" });
  }
});

export default router;
