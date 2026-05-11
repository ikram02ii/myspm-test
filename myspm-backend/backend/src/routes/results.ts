import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { studentResultsTable, attemptAnswersTable, usersTable, examsTable, questionsTable } from "@workspace/db/schema";
import { eq, ilike, and, count, sql, gte, lte } from "drizzle-orm";
import { ListResultsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/results", async (req, res) => {
  try {
    const query = ListResultsQueryParams.parse(req.query);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions = [];
    if (query.subject) conditions.push(eq(examsTable.subject, query.subject));
    if (query.examId) conditions.push(eq(studentResultsTable.examId, query.examId));
    if (query.startDate) conditions.push(gte(studentResultsTable.attemptDate, new Date(query.startDate)));
    if (query.endDate) conditions.push(lte(studentResultsTable.attemptDate, new Date(query.endDate)));
    if (query.search) conditions.push(ilike(usersTable.name, `%${query.search}%`));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const baseQuery = db
      .select({
        id: studentResultsTable.id,
        studentName: usersTable.name,
        school: usersTable.school,
        examTitle: examsTable.title,
        subject: examsTable.subject,
        score: studentResultsTable.score,
        totalMarks: studentResultsTable.totalMarks,
        attemptDate: studentResultsTable.attemptDate,
        status: studentResultsTable.status,
      })
      .from(studentResultsTable)
      .innerJoin(usersTable, eq(studentResultsTable.studentId, usersTable.id))
      .innerJoin(examsTable, eq(studentResultsTable.examId, examsTable.id));

    const countQuery = db
      .select({ count: count() })
      .from(studentResultsTable)
      .innerJoin(usersTable, eq(studentResultsTable.studentId, usersTable.id))
      .innerJoin(examsTable, eq(studentResultsTable.examId, examsTable.id));

    const [totalResult] = where ? await countQuery.where(where) : await countQuery;
    const total = totalResult?.count ?? 0;

    const data = where
      ? await baseQuery.where(where).orderBy(sql`${studentResultsTable.attemptDate} DESC`).limit(limit).offset(offset)
      : await baseQuery.orderBy(sql`${studentResultsTable.attemptDate} DESC`).limit(limit).offset(offset);

    res.json({
      data: data.map((r) => ({
        ...r,
        school: r.school ?? "",
        attemptDate: r.attemptDate.toISOString(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("List results error:", error);
    res.status(500).json({ error: "Failed to list results" });
  }
});

router.get("/results/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [result] = await db
      .select({
        id: studentResultsTable.id,
        studentName: usersTable.name,
        school: usersTable.school,
        examTitle: examsTable.title,
        subject: examsTable.subject,
        score: studentResultsTable.score,
        totalMarks: studentResultsTable.totalMarks,
        attemptDate: studentResultsTable.attemptDate,
        status: studentResultsTable.status,
      })
      .from(studentResultsTable)
      .innerJoin(usersTable, eq(studentResultsTable.studentId, usersTable.id))
      .innerJoin(examsTable, eq(studentResultsTable.examId, examsTable.id))
      .where(eq(studentResultsTable.id, id));

    if (!result) {
      res.status(404).json({ error: "Result not found" });
      return;
    }

    const answersData = await db
      .select({
        questionId: attemptAnswersTable.questionId,
        questionText: questionsTable.questionText,
        studentAnswer: attemptAnswersTable.studentAnswer,
        correctAnswer: questionsTable.correctAnswer,
        isCorrect: attemptAnswersTable.isCorrect,
        marks: attemptAnswersTable.marks,
        feedback: attemptAnswersTable.feedback,
      })
      .from(attemptAnswersTable)
      .innerJoin(questionsTable, eq(attemptAnswersTable.questionId, questionsTable.id))
      .where(eq(attemptAnswersTable.resultId, id));

    res.json({
      ...result,
      school: result.school ?? "",
      attemptDate: result.attemptDate.toISOString(),
      answers: answersData,
    });
  } catch (error) {
    console.error("Get result error:", error);
    res.status(500).json({ error: "Failed to get result" });
  }
});

export default router;
