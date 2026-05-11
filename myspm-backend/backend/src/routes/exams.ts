import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { examsTable, examSectionsTable, examQuestionsTable, questionsTable } from "@workspace/db/schema";
import { eq, ilike, and, count, sql } from "drizzle-orm";
import { CreateExamBody, ListExamsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/exams", async (req, res) => {
  try {
    const query = ListExamsQueryParams.parse(req.query);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions = [];
    if (query.subject) conditions.push(eq(examsTable.subject, query.subject));
    if (query.search) conditions.push(ilike(examsTable.title, `%${query.search}%`));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db.select({ count: count() }).from(examsTable).where(where);
    const total = totalResult?.count ?? 0;

    const data = await db
      .select()
      .from(examsTable)
      .where(where)
      .orderBy(sql`${examsTable.id} DESC`)
      .limit(limit)
      .offset(offset);

    const examsWithCounts = await Promise.all(
      data.map(async (exam) => {
        const sections = await db.select().from(examSectionsTable).where(eq(examSectionsTable.examId, exam.id));
        let questionCount = 0;
        for (const section of sections) {
          const [qCount] = await db.select({ count: count() }).from(examQuestionsTable).where(eq(examQuestionsTable.sectionId, section.id));
          questionCount += qCount?.count ?? 0;
        }
        return {
          ...exam,
          questionCount,
          createdAt: exam.createdAt.toISOString(),
          updatedAt: exam.updatedAt.toISOString(),
        };
      })
    );

    res.json({ data: examsWithCounts, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error("List exams error:", error);
    res.status(500).json({ error: "Failed to list exams" });
  }
});

router.post("/exams", async (req, res) => {
  try {
    const body = CreateExamBody.parse(req.body);
    const { sections, ...examData } = body;
    const [exam] = await db.insert(examsTable).values(examData).returning();

    if (sections) {
      for (const section of sections) {
        const [sec] = await db.insert(examSectionsTable).values({ examId: exam.id, name: section.name, sortOrder: section.sortOrder }).returning();
        if (section.questionIds) {
          for (let i = 0; i < section.questionIds.length; i++) {
            await db.insert(examQuestionsTable).values({ sectionId: sec.id, questionId: section.questionIds[i], sortOrder: i });
          }
        }
      }
    }

    res.status(201).json({ ...exam, createdAt: exam.createdAt.toISOString(), updatedAt: exam.updatedAt.toISOString() });
  } catch (error) {
    console.error("Create exam error:", error);
    res.status(500).json({ error: "Failed to create exam" });
  }
});

router.get("/exams/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [exam] = await db.select().from(examsTable).where(eq(examsTable.id, id));
    if (!exam) {
      res.status(404).json({ error: "Exam not found" });
      return;
    }

    const sections = await db.select().from(examSectionsTable).where(eq(examSectionsTable.examId, id)).orderBy(examSectionsTable.sortOrder);

    const sectionsWithQuestions = await Promise.all(
      sections.map(async (section) => {
        const eqs = await db
          .select({ questionId: examQuestionsTable.questionId, sortOrder: examQuestionsTable.sortOrder })
          .from(examQuestionsTable)
          .where(eq(examQuestionsTable.sectionId, section.id))
          .orderBy(examQuestionsTable.sortOrder);

        const questions = await Promise.all(
          eqs.map(async (eq_item) => {
            const [q] = await db.select().from(questionsTable).where(eq(questionsTable.id, eq_item.questionId));
            return q ? { ...q, createdAt: q.createdAt.toISOString(), updatedAt: q.updatedAt.toISOString() } : null;
          })
        );

        return { ...section, questions: questions.filter(Boolean) };
      })
    );

    res.json({
      ...exam,
      createdAt: exam.createdAt.toISOString(),
      updatedAt: exam.updatedAt.toISOString(),
      sections: sectionsWithQuestions,
    });
  } catch (error) {
    console.error("Get exam error:", error);
    res.status(500).json({ error: "Failed to get exam" });
  }
});

router.put("/exams/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = CreateExamBody.parse(req.body);
    const { sections, ...examData } = body;
    const [exam] = await db.update(examsTable).set({ ...examData, updatedAt: new Date() }).where(eq(examsTable.id, id)).returning();
    if (!exam) {
      res.status(404).json({ error: "Exam not found" });
      return;
    }

    if (sections) {
      await db.delete(examSectionsTable).where(eq(examSectionsTable.examId, id));
      for (const section of sections) {
        const [sec] = await db.insert(examSectionsTable).values({ examId: id, name: section.name, sortOrder: section.sortOrder }).returning();
        if (section.questionIds) {
          for (let i = 0; i < section.questionIds.length; i++) {
            await db.insert(examQuestionsTable).values({ sectionId: sec.id, questionId: section.questionIds[i], sortOrder: i });
          }
        }
      }
    }

    res.json({ ...exam, createdAt: exam.createdAt.toISOString(), updatedAt: exam.updatedAt.toISOString() });
  } catch (error) {
    console.error("Update exam error:", error);
    res.status(500).json({ error: "Failed to update exam" });
  }
});

router.delete("/exams/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.delete(examsTable).where(eq(examsTable.id, id));
    res.json({ success: true, message: "Exam deleted" });
  } catch (error) {
    console.error("Delete exam error:", error);
    res.status(500).json({ error: "Failed to delete exam" });
  }
});

export default router;
