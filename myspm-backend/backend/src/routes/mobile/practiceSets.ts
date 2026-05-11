import { Router, type IRouter, type RequestHandler } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { authMiddleware } from "../../middlewares/auth";

const router: IRouter = Router();

router.use(authMiddleware as RequestHandler);

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

type PracticeSetListRow = {
  id: number;
  title: string;
  subject: string;
  form_level: string;
  linked_question_count: string | number | null;
  dominant_difficulty: string | null;
};

type PracticeSetMetaRow = {
  id: number;
  title: string;
  subject: string;
  form_level: string;
  status: string;
  question_count: number | null;
  created_at: string;
  updated_at: string;
};

type PracticeQuestionRow = {
  sort_order: number;
  question_id: number;
  question_text: string;
  options: string | null;
  question_type: string;
  difficulty: string;
  correct_answer: string | null;
  explanation: string | null;
};

/** Options in DB are often a JSON array string; some rows use escaped quotes `[\\"3\\",...]` that `JSON.parse` rejects without normalizing. */
function parseQuestionOptionsCell(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x).trim()).filter((s) => s.length > 0);
  }
  const s = String(raw).trim();
  if (!s) return [];

  const candidates: string[] = [];
  const add = (c: string) => {
    if (!candidates.includes(c)) candidates.push(c);
  };
  add(s);
  add(s.replace(/\\"/g, '"'));
  if (s.startsWith('"') && s.endsWith('"')) {
    add(s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  }

  for (const candidate of candidates) {
    try {
      let parsed: unknown = JSON.parse(candidate);
      if (typeof parsed === "string") {
        try {
          parsed = JSON.parse(parsed);
        } catch {
          continue;
        }
      }
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x).trim()).filter((x) => x.length > 0);
      }
    } catch {
      continue;
    }
  }

  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).replace(/\\"/g, '"');
    const parts: string[] = [];
    const re = /"((?:[^"\\]|\\.)*)"/g;
    let m: RegExpExecArray | null;
    for (m = re.exec(inner); m !== null; m = re.exec(inner)) {
      parts.push(m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
    }
    if (parts.length > 0) {
      return parts.map((p) => p.trim()).filter(Boolean);
    }
  }

  return [];
}

router.get("/practice-sets", async (_req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT
        ps.id,
        ps.title,
        ps.subject,
        ps.form_level,
        COUNT(psq.id) AS linked_question_count,
        dd.difficulty AS dominant_difficulty
      FROM practice_sets ps
      LEFT JOIN practice_set_questions psq ON psq.practice_set_id = ps.id
      LEFT JOIN LATERAL (
        SELECT
          q.difficulty
        FROM practice_set_questions psq2
        INNER JOIN questions q ON q.id = psq2.question_id
        WHERE psq2.practice_set_id = ps.id
          AND LOWER(COALESCE(q.status, '')) = 'active'
          AND q.difficulty IS NOT NULL
          AND LENGTH(TRIM(q.difficulty)) > 0
        GROUP BY q.difficulty
        ORDER BY COUNT(*) DESC, MIN(psq2.sort_order) ASC, q.difficulty ASC
        LIMIT 1
      ) dd ON TRUE
      WHERE LOWER(COALESCE(ps.status, '')) NOT IN ('draft', 'archived')
      GROUP BY ps.id, dd.difficulty
      ORDER BY MAX(ps.updated_at) DESC
    `);

    const rows = (result as unknown as { rows?: PracticeSetListRow[] }).rows ?? [];
    const sets = rows.map((row) => {
      const n = row.linked_question_count;
      const count = typeof n === "string" ? Number(n) : Number(n ?? 0);
      return {
        id: row.id,
        title: row.title,
        subject: row.subject,
        formLevel: row.form_level,
        questionCount: Number.isFinite(count) ? count : 0,
        difficultyLevel: row.dominant_difficulty ? row.dominant_difficulty : "mixed",
      };
    });

    res.json({ data: { sets } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/practice-sets/:id", async (req, res) => {
  const rawId = req.params.id;
  const setId = Number(rawId);
  if (!Number.isInteger(setId) || setId < 1) {
    res.status(400).json({ error: "Invalid practice set id" });
    return;
  }

  try {
    const metaResult = await db.execute(sql`
      SELECT
        ps.id,
        ps.title,
        ps.subject,
        ps.form_level,
        ps.status,
        ps.question_count,
        ps.created_at::text AS created_at,
        ps.updated_at::text AS updated_at
      FROM practice_sets ps
      WHERE ps.id = ${setId}
        AND LOWER(COALESCE(ps.status, '')) NOT IN ('draft', 'archived')
      LIMIT 1
    `);

    const metaRows = (metaResult as unknown as { rows?: PracticeSetMetaRow[] }).rows ?? [];
    const meta = metaRows[0];
    if (!meta) {
      res.status(404).json({ error: "Practice set not found" });
      return;
    }

    const questionsResult = await db.execute(sql`
      SELECT
        psq.sort_order,
        q.id AS question_id,
        q.question_text,
        q.options,
        q.question_type,
        q.difficulty,
        q.correct_answer,
        q.explanation
      FROM practice_set_questions psq
      INNER JOIN questions q ON q.id = psq.question_id
      WHERE psq.practice_set_id = ${setId}
        AND LOWER(COALESCE(q.status, '')) = 'active'
      ORDER BY psq.sort_order ASC
    `);

    const qRows =
      (questionsResult as unknown as { rows?: PracticeQuestionRow[] }).rows ?? [];

    const questions = qRows.map((row) => ({
      id: row.question_id,
      sortOrder: row.sort_order,
      questionText: row.question_text,
      questionType: row.question_type,
      difficulty: row.difficulty,
      options: parseQuestionOptionsCell(row.options),
      correctAnswer: row.correct_answer ?? "",
      explanation: row.explanation ?? null,
    }));

    res.json({
      data: {
        set: {
          id: meta.id,
          title: meta.title,
          subject: meta.subject,
          formLevel: meta.form_level,
          questionCount: meta.question_count ?? questions.length,
        },
        questions,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
