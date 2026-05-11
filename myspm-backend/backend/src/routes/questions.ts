import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { questionsTable } from "@workspace/db/schema";
import { eq, ilike, and, count, sql, or } from "drizzle-orm";
import {
  ListQuestionsQueryParams,
  CreateQuestionBody,
  GetQuestionParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/questions", async (req, res) => {
  try {
    const query = ListQuestionsQueryParams.parse(req.query);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions = [];
    if (query.subject) conditions.push(eq(questionsTable.subject, query.subject));
    if (query.topic) conditions.push(eq(questionsTable.topic, query.topic));
    if (query.difficulty) conditions.push(eq(questionsTable.difficulty, query.difficulty));
    if (query.questionType) conditions.push(eq(questionsTable.questionType, query.questionType));
    if (query.source) conditions.push(eq(questionsTable.source, query.source));
    if (query.search) conditions.push(ilike(questionsTable.questionText, `%${query.search}%`));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db.select({ count: count() }).from(questionsTable).where(where);
    const total = totalResult?.count ?? 0;

    const data = await db
      .select()
      .from(questionsTable)
      .where(where)
      .orderBy(sql`${questionsTable.id} DESC`)
      .limit(limit)
      .offset(offset);

    res.json({
      data: data.map((q) => ({
        ...q,
        createdAt: q.createdAt.toISOString(),
        updatedAt: q.updatedAt.toISOString(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("List questions error:", error);
    res.status(500).json({ error: "Failed to list questions" });
  }
});

router.post("/questions", async (req, res) => {
  try {
    const body = CreateQuestionBody.parse(req.body);
    const [question] = await db.insert(questionsTable).values(body).returning();
    res.status(201).json({
      ...question,
      createdAt: question.createdAt.toISOString(),
      updatedAt: question.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Create question error:", error);
    res.status(500).json({ error: "Failed to create question" });
  }
});

router.get("/questions/:id", async (req, res) => {
  try {
    const { id } = GetQuestionParams.parse({ id: Number(req.params.id) });
    const [question] = await db.select().from(questionsTable).where(eq(questionsTable.id, id));
    if (!question) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    res.json({
      ...question,
      createdAt: question.createdAt.toISOString(),
      updatedAt: question.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Get question error:", error);
    res.status(500).json({ error: "Failed to get question" });
  }
});

router.put("/questions/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = CreateQuestionBody.parse(req.body);
    const [question] = await db.update(questionsTable).set({ ...body, updatedAt: new Date() }).where(eq(questionsTable.id, id)).returning();
    if (!question) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    res.json({
      ...question,
      createdAt: question.createdAt.toISOString(),
      updatedAt: question.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Update question error:", error);
    res.status(500).json({ error: "Failed to update question" });
  }
});

router.delete("/questions/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.update(questionsTable).set({ status: "archived", updatedAt: new Date() }).where(eq(questionsTable.id, id));
    res.json({ success: true, message: "Question archived" });
  } catch (error) {
    console.error("Archive question error:", error);
    res.status(500).json({ error: "Failed to archive question" });
  }
});

router.post("/questions/:id/duplicate", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [original] = await db.select().from(questionsTable).where(eq(questionsTable.id, id));
    if (!original) {
      res.status(404).json({ error: "Question not found" });
      return;
    }

    const { id: _, createdAt, updatedAt, ...rest } = original;
    const [duplicate] = await db.insert(questionsTable).values({ ...rest, createdBy: "System" }).returning();
    res.status(201).json({
      ...duplicate,
      createdAt: duplicate.createdAt.toISOString(),
      updatedAt: duplicate.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Duplicate question error:", error);
    res.status(500).json({ error: "Failed to duplicate question" });
  }
});

export default router;
