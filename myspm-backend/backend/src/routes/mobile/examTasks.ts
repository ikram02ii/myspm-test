import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { attemptAnswersTable } from "@workspace/db/schema";
import { authMiddleware } from "../../middlewares/auth";

const router: IRouter = Router();

router.use(authMiddleware as RequestHandler);
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

function requireUserId(req: unknown): number | null {
  const id = (req as { user?: { id?: number } }).user?.id;
  return typeof id === "number" && Number.isFinite(id) ? id : null;
}

type ExamTaskListRow = {
  assignment_student_id: number;
  assignment_id: number;
  assignment_title: string;
  assigned_by_name: string | null;
  due_date: string;
  submitted: boolean;
  assignment_score: number | null;
  exam_id: number;
  exam_title: string;
  total_questions: string;
  result_id: number | null;
  result_status: string | null;
  answered_count: string | null;
};

router.get("/exam-tasks", async (req, res) => {
  const userId = requireUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const result = await db.execute(sql`
      SELECT
        astu.id AS assignment_student_id,
        a.id AS assignment_id,
        a.title AS assignment_title,
        (
          CASE
            WHEN trim(a.created_by) ~ '^[0-9]+$' THEN
              COALESCE(
                (
                  SELECT u.name
                  FROM users u
                  WHERE u.id = trim(a.created_by)::int
                  LIMIT 1
                ),
                trim(a.created_by)
              )
            ELSE COALESCE(NULLIF(trim(a.created_by), ''), 'System')
          END
        ) AS assigned_by_name,
        a.due_date::text AS due_date,
        astu.submitted,
        astu.score AS assignment_score,
        e.id AS exam_id,
        e.title AS exam_title,
        (
          SELECT COUNT(*)::text
          FROM exam_questions eq
          INNER JOIN exam_sections es ON es.id = eq.section_id
          WHERE es.exam_id = e.id
        ) AS total_questions,
        sr.id AS result_id,
        sr.status AS result_status,
        (
          SELECT COUNT(DISTINCT aa.question_id)::text
          FROM attempt_answers aa
          WHERE aa.result_id = sr.id
        ) AS answered_count
      FROM assignment_students astu
      INNER JOIN assignments a ON a.id = astu.assignment_id
      INNER JOIN exams e ON e.id = a.exam_id
      LEFT JOIN student_results sr ON sr.assignment_student_id = astu.id
      WHERE astu.student_id = ${userId}
      ORDER BY a.due_date ASC, astu.id DESC
    `);

    const rows = (result as unknown as { rows?: ExamTaskListRow[] }).rows ?? [];
    res.json({
      data: rows.map((r) => {
        const totalQuestions = Number(r.total_questions ?? 0);
        const answeredCount = Number(r.answered_count ?? 0);
        return {
          assignmentStudentId: r.assignment_student_id,
          assignmentId: r.assignment_id,
          assignmentTitle: r.assignment_title,
          assignedByName: r.assigned_by_name?.trim() || null,
          dueDate: r.due_date,
          submitted: r.submitted,
          score: r.assignment_score,
          exam: { id: r.exam_id, title: r.exam_title },
          progress: {
            answered: Number.isFinite(answeredCount) ? Math.trunc(answeredCount) : 0,
            total: Number.isFinite(totalQuestions) ? Math.trunc(totalQuestions) : 0,
          },
          attempt: r.result_id
            ? { id: r.result_id, status: r.result_status ?? "unknown" }
            : null,
        };
      }),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

type ExamTaskDetailRow = {
  assignment_student_id: number;
  assignment_id: number;
  assignment_title: string;
  due_date: string;
  submitted: boolean;
  assignment_score: number | null;
  exam_id: number;
  exam_title: string;
  exam_subject: string;
  exam_form_level: string;
  exam_timer: number | null;
  result_id: number | null;
  result_status: string | null;
  result_score: number | null;
  result_total_marks: number | null;
  correct_count: string | null;
};

type ExamSectionRow = {
  section_id: number;
  section_name: string;
  section_sort_order: number;
  question_id: number;
  question_sort_order: number;
  question_text: string;
  question_type: string;
  options: string | null;
};

type AttemptAnswerReviewRow = {
  question_id: number;
  student_answer: string;
  is_correct: boolean;
};

router.get("/exam-tasks/:assignmentStudentId", async (req, res) => {
  const userId = requireUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const assignmentStudentId = Number(req.params.assignmentStudentId);
  if (!Number.isFinite(assignmentStudentId) || assignmentStudentId <= 0) {
    res.status(400).json({ error: "Invalid assignmentStudentId" });
    return;
  }

  try {
    const headerResult = await db.execute(sql`
      SELECT
        astu.id AS assignment_student_id,
        a.id AS assignment_id,
        a.title AS assignment_title,
        a.due_date::text AS due_date,
        astu.submitted,
        astu.score AS assignment_score,
        e.id AS exam_id,
        e.title AS exam_title,
        e.subject AS exam_subject,
        e.form_level AS exam_form_level,
        e.timer AS exam_timer,
        sr.id AS result_id,
        sr.status AS result_status,
        sr.score AS result_score,
        sr.total_marks AS result_total_marks,
        (
          SELECT COALESCE(SUM(CASE WHEN latest.is_correct THEN 1 ELSE 0 END), 0)::text
          FROM (
            SELECT DISTINCT ON (aa.question_id) aa.question_id, aa.is_correct
            FROM attempt_answers aa
            WHERE sr.id IS NOT NULL AND aa.result_id = sr.id
            ORDER BY aa.question_id, aa.created_at DESC
          ) latest
        ) AS correct_count
      FROM assignment_students astu
      INNER JOIN assignments a ON a.id = astu.assignment_id
      INNER JOIN exams e ON e.id = a.exam_id
      LEFT JOIN student_results sr ON sr.assignment_student_id = astu.id
      WHERE astu.id = ${assignmentStudentId} AND astu.student_id = ${userId}
      LIMIT 1
    `);
    const headerRows = (headerResult as unknown as { rows?: ExamTaskDetailRow[] }).rows ?? [];
    const header = headerRows[0];
    if (!header) {
      res.status(404).json({ error: "Exam task not found" });
      return;
    }

    const itemsResult = await db.execute(sql`
      SELECT
        es.id AS section_id,
        es.name AS section_name,
        es.sort_order AS section_sort_order,
        q.id AS question_id,
        eq.sort_order AS question_sort_order,
        q.question_text,
        q.question_type,
        q.options
      FROM exam_sections es
      INNER JOIN exam_questions eq ON eq.section_id = es.id
      INNER JOIN questions q ON q.id = eq.question_id
      WHERE es.exam_id = ${header.exam_id}
      ORDER BY es.sort_order ASC, eq.sort_order ASC
    `);
    const itemRows = (itemsResult as unknown as { rows?: ExamSectionRow[] }).rows ?? [];

    let existingAnswers: Record<string, string> = {};
    let answerReview: Record<string, { studentAnswer: string; isCorrect: boolean }> = {};
    if (header.result_id) {
      const ansResult = await db.execute(sql`
        SELECT DISTINCT ON (aa.question_id)
          aa.question_id,
          aa.student_answer,
          aa.is_correct
        FROM attempt_answers aa
        WHERE aa.result_id = ${header.result_id}
        ORDER BY aa.question_id, aa.created_at DESC
      `);
      const ansRows = (ansResult as unknown as { rows?: AttemptAnswerReviewRow[] }).rows ?? [];
      existingAnswers = Object.fromEntries(ansRows.map((a) => [String(a.question_id), a.student_answer]));
      answerReview = Object.fromEntries(
        ansRows.map((r) => [String(r.question_id), { studentAnswer: r.student_answer, isCorrect: r.is_correct }])
      );
    }

    const sections: Array<{
      id: number;
      name: string;
      questions: Array<{
        id: number;
        text: string;
        questionType: string;
        options: string | null;
      }>;
    }> = [];

    const bySection = new Map<number, { id: number; name: string; questions: any[] }>();
    for (const r of itemRows) {
      let s = bySection.get(r.section_id);
      if (!s) {
        s = { id: r.section_id, name: r.section_name, questions: [] };
        bySection.set(r.section_id, s);
        sections.push(s);
      }
      s.questions.push({
        id: r.question_id,
        text: r.question_text,
        questionType: r.question_type,
        options: r.options,
      });
    }

    const examQuestionCount = itemRows.length;
    const correctN = Number(header.correct_count ?? 0);
    const totalMarks =
      header.result_total_marks != null && Number.isFinite(Number(header.result_total_marks))
        ? Math.trunc(Number(header.result_total_marks))
        : examQuestionCount;
    const scorePct =
      header.assignment_score != null && Number.isFinite(Number(header.assignment_score))
        ? Number(header.assignment_score)
        : header.result_score != null && Number.isFinite(Number(header.result_score))
          ? Number(header.result_score)
          : 0;

    res.json({
      data: {
        assignmentStudentId: header.assignment_student_id,
        assignment: {
          id: header.assignment_id,
          title: header.assignment_title,
          dueDate: header.due_date,
        },
        submitted: header.submitted,
        exam: {
          id: header.exam_id,
          title: header.exam_title,
          subject: header.exam_subject,
          formLevel: header.exam_form_level,
          timerMinutes: header.exam_timer,
        },
        attempt: header.result_id ? { id: header.result_id, status: header.result_status ?? "unknown" } : null,
        answers: existingAnswers,
        answerReview,
        resultSummary:
          header.submitted && header.result_id
            ? {
                resultId: header.result_id,
                scorePercent: scorePct,
                correct: Number.isFinite(correctN) ? Math.trunc(correctN) : 0,
                total: totalMarks,
              }
            : null,
        sections,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/exam-tasks/:assignmentStudentId/start", async (req, res) => {
  const userId = requireUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const assignmentStudentId = Number(req.params.assignmentStudentId);
  if (!Number.isFinite(assignmentStudentId) || assignmentStudentId <= 0) {
    res.status(400).json({ error: "Invalid assignmentStudentId" });
    return;
  }

  try {
    const seatResult = await db.execute(sql`
      SELECT
        astu.id AS assignment_student_id,
        astu.submitted,
        a.exam_id
      FROM assignment_students astu
      INNER JOIN assignments a ON a.id = astu.assignment_id
      WHERE astu.id = ${assignmentStudentId} AND astu.student_id = ${userId}
      LIMIT 1
    `);
    const seatRows = (seatResult as unknown as { rows?: Array<{ assignment_student_id: number; submitted: boolean; exam_id: number }> }).rows ?? [];
    const seat = seatRows[0];
    if (!seat) {
      res.status(404).json({ error: "Exam task not found" });
      return;
    }
    if (seat.submitted) {
      res.status(400).json({ error: "This assignment has already been submitted" });
      return;
    }

    const existingResult = await db.execute(sql`
      SELECT id, status
      FROM student_results
      WHERE assignment_student_id = ${assignmentStudentId}
      LIMIT 1
    `);
    const existingRows = (existingResult as unknown as { rows?: Array<{ id: number; status: string }> }).rows ?? [];
    const existing = existingRows[0];
    if (existing) {
      res.json({ data: { resultId: existing.id, status: existing.status } });
      return;
    }

    const totalQResult = await db.execute(sql`
      SELECT COUNT(*)::text AS c
      FROM exam_questions eq
      INNER JOIN exam_sections es ON es.id = eq.section_id
      WHERE es.exam_id = ${seat.exam_id}
    `);
    const totalQRows = (totalQResult as unknown as { rows?: Array<{ c: string }> }).rows ?? [];
    const totalQuestions = Number(totalQRows[0]?.c ?? 0);
    const totalMarks = Number.isFinite(totalQuestions) ? Math.trunc(totalQuestions) : 0;

    const insertResult = await db.execute(sql`
      INSERT INTO student_results (student_id, exam_id, assignment_student_id, score, total_marks, status, attempt_date)
      VALUES (${userId}, ${seat.exam_id}, ${assignmentStudentId}, 0, ${totalMarks}, 'in_progress', NOW())
      RETURNING id, status
    `);
    const insertedRows = (insertResult as unknown as { rows?: Array<{ id: number; status: string }> }).rows ?? [];
    const inserted = insertedRows[0];
    if (!inserted) {
      res.status(500).json({ error: "Internal Server Error" });
      return;
    }

    res.json({ data: { resultId: inserted.id, status: inserted.status } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

const SaveAnswerBody = z.object({
  questionId: z.number().int().positive(),
  answer: z.string().trim().min(1),
});

function normalizeAnswer(s: string): string {
  return s.trim().toLowerCase();
}

function tryParseOptions(input: string | null): string[] | null {
  if (!input) return null;
  const t = input.trim();
  if (!t) return null;
  try {
    const parsed = JSON.parse(t) as unknown;
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) return parsed;
  } catch {
    // Some rows are stored as an escaped JSON array string: [\"A\", \"B\"]
    if (t.startsWith("[") && t.endsWith("]") && t.includes("\\\"")) {
      try {
        const parsed2 = JSON.parse(t.replace(/\\"/g, '"')) as unknown;
        if (Array.isArray(parsed2) && parsed2.every((x) => typeof x === "string")) return parsed2;
      } catch {
        // fall through
      }
    }
    // Postgres text[] format: {"A","B"} or {A,B}
    if (t.startsWith("{") && t.endsWith("}")) {
      const inner = t.slice(1, -1).trim();
      if (!inner) return [];
      const out: string[] = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < inner.length; i++) {
        const ch = inner[i]!;
        if (ch === '"' && inner[i - 1] !== "\\") {
          inQuotes = !inQuotes;
          continue;
        }
        if (!inQuotes && ch === ",") {
          out.push(cur);
          cur = "";
          continue;
        }
        cur += ch;
      }
      out.push(cur);
      return out.map((s) => s.replace(/\\"/g, '"').trim()).filter((s) => s.length > 0);
    }
  }
  return null;
}

router.post("/exam-attempts/:resultId/answer", async (req, res) => {
  const userId = requireUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const resultId = Number(req.params.resultId);
  if (!Number.isFinite(resultId) || resultId <= 0) {
    res.status(400).json({ error: "Invalid resultId" });
    return;
  }

  const parsed = SaveAnswerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  try {
    const ownerResult = await db.execute(sql`
      SELECT sr.id, sr.exam_id, sr.status, astu.submitted
      FROM student_results sr
      LEFT JOIN assignment_students astu ON astu.id = sr.assignment_student_id
      WHERE sr.id = ${resultId} AND sr.student_id = ${userId}
      LIMIT 1
    `);
    const ownerRows = (ownerResult as unknown as { rows?: Array<{ id: number; exam_id: number; status: string; submitted: boolean | null }> }).rows ?? [];
    const owner = ownerRows[0];
    if (!owner) {
      res.status(404).json({ error: "Attempt not found" });
      return;
    }
    if (owner.submitted) {
      res.status(400).json({ error: "This assignment has already been submitted" });
      return;
    }
    if (owner.status === "completed") {
      res.status(400).json({ error: "This attempt is already completed" });
      return;
    }

    const qResult = await db.execute(sql`
      SELECT q.correct_answer, q.options
      FROM questions q
      WHERE q.id = ${parsed.data.questionId}
      LIMIT 1
    `);
    const qRows = (qResult as unknown as { rows?: Array<{ correct_answer: string | null; options: string | null }> }).rows ?? [];
    const correctAnswer = qRows[0]?.correct_answer ?? null;
    const options = tryParseOptions(qRows[0]?.options ?? null);

    let isCorrect = false;
    if (correctAnswer) {
      const idx = Number(correctAnswer);
      if (options && Number.isInteger(idx) && idx >= 0 && idx < options.length) {
        isCorrect = normalizeAnswer(options[idx]!) === normalizeAnswer(parsed.data.answer);
      } else {
        isCorrect = normalizeAnswer(correctAnswer) === normalizeAnswer(parsed.data.answer);
      }
    }
    const marks = isCorrect ? 1 : 0;

    await db.insert(attemptAnswersTable).values({
      resultId,
      questionId: parsed.data.questionId,
      studentAnswer: parsed.data.answer,
      isCorrect,
      marks,
      feedback: null,
    });

    res.json({ data: { ok: true, isCorrect, marks } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/exam-attempts/:resultId/submit", async (req, res) => {
  const userId = requireUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const resultId = Number(req.params.resultId);
  if (!Number.isFinite(resultId) || resultId <= 0) {
    res.status(400).json({ error: "Invalid resultId" });
    return;
  }

  try {
    const attemptResult = await db.execute(sql`
      SELECT sr.id, sr.exam_id, sr.assignment_student_id, sr.status
      FROM student_results sr
      WHERE sr.id = ${resultId} AND sr.student_id = ${userId}
      LIMIT 1
    `);
    const attemptRows = (attemptResult as unknown as { rows?: Array<{ id: number; exam_id: number; assignment_student_id: number | null; status: string }> }).rows ?? [];
    const attempt = attemptRows[0];
    if (!attempt) {
      res.status(404).json({ error: "Attempt not found" });
      return;
    }
    if (!attempt.assignment_student_id) {
      res.status(400).json({ error: "This attempt is not linked to an assignment" });
      return;
    }
    if (attempt.status === "completed") {
      res.status(400).json({ error: "This attempt is already completed" });
      return;
    }

    const totalQResult = await db.execute(sql`
      SELECT COUNT(*)::text AS c
      FROM exam_questions eq
      INNER JOIN exam_sections es ON es.id = eq.section_id
      WHERE es.exam_id = ${attempt.exam_id}
    `);
    const totalQRows = (totalQResult as unknown as { rows?: Array<{ c: string }> }).rows ?? [];
    const totalQuestions = Number(totalQRows[0]?.c ?? 0);
    const totalMarks = Number.isFinite(totalQuestions) ? Math.trunc(totalQuestions) : 0;

    const correctResult = await db.execute(sql`
      SELECT COALESCE(SUM(CASE WHEN latest.is_correct THEN 1 ELSE 0 END), 0)::text AS c
      FROM (
        SELECT DISTINCT ON (aa.question_id) aa.question_id, aa.is_correct
        FROM attempt_answers aa
        WHERE aa.result_id = ${resultId}
        ORDER BY aa.question_id, aa.created_at DESC
      ) latest
    `);
    const correctRows = (correctResult as unknown as { rows?: Array<{ c: string }> }).rows ?? [];
    const correct = Number(correctRows[0]?.c ?? 0);
    const correctCount = Number.isFinite(correct) ? Math.trunc(correct) : 0;

    const scorePct = totalMarks > 0 ? (correctCount / totalMarks) * 100 : 0;

    await db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE student_results
        SET score = ${scorePct}, total_marks = ${totalMarks}, status = 'completed', attempt_date = NOW()
        WHERE id = ${resultId} AND student_id = ${userId}
      `);

      await tx.execute(sql`
        UPDATE assignment_students
        SET submitted = TRUE, score = ${scorePct}
        WHERE id = ${attempt.assignment_student_id} AND student_id = ${userId}
      `);
    });

    res.json({
      data: {
        ok: true,
        score: scorePct,
        correct: correctCount,
        total: totalMarks,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;

