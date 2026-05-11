import { Router, type IRouter, type RequestHandler } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { authMiddleware } from "../../middlewares/auth";

const STUB_XP = 0;
const STUB_STREAK = 0;

const router: IRouter = Router();

router.use(authMiddleware as RequestHandler);

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

type PostRow = {
  id: number;
  title: string;
  excerpt: string | null;
  content: string | null;
  category: string;
  audience: string;
  pinned: boolean;
  created_at: string;
  author_name: string;
  author_role: string;
};

router.get("/dashboard", async (req, res) => {
  const user = (req as { user?: { id: number; name: string } }).user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const rawLimit = req.query.postsLimit;
  const parsedLimit =
    typeof rawLimit === "string"
      ? Number(rawLimit)
      : Array.isArray(rawLimit) && typeof rawLimit[0] === "string"
        ? Number(rawLimit[0])
        : NaN;
  const postsLimit = Number.isFinite(parsedLimit)
    ? Math.min(50, Math.max(1, Math.trunc(parsedLimit)))
    : 10;

  try {
    const meResult = await db.execute(sql`
      SELECT u.avatar_url
      FROM users u
      WHERE u.id = ${user.id}
      LIMIT 1
    `);
    const meRows = (meResult as unknown as { rows?: { avatar_url: string | null }[] }).rows ?? [];
    const avatarUrl = meRows[0]?.avatar_url ?? null;

    const examAggResult = await db.execute(sql`
      SELECT
        ROUND(COALESCE(AVG(sr.score), 0)::numeric, 1)::double precision AS avg_score_percent,
        COUNT(*)::int AS completed_attempts
      FROM student_results sr
      WHERE sr.student_id = ${user.id} AND sr.status = 'completed'
    `);
    const examAggRows = (examAggResult as unknown as { rows?: { avg_score_percent: number | null; completed_attempts: number }[] }).rows ?? [];
    const examRow = examAggRows[0];
    const examSummary = {
      averageScorePercent: Number(examRow?.avg_score_percent ?? 0),
      completedAttempts: Number(examRow?.completed_attempts ?? 0),
    };

    const masteryResult = await db.execute(sql`
      SELECT
        m.subject,
        m.avg_score_percent::double precision AS avg_score_percent,
        m.completed_attempts::int AS completed_attempts
      FROM vw_student_subject_mastery m
      WHERE m.student_id = ${user.id}
      ORDER BY m.avg_score_percent DESC, m.subject ASC
      LIMIT 12
    `);
    const masteryRows =
      (masteryResult as unknown as {
        rows?: { subject: string; avg_score_percent: number; completed_attempts: number }[];
      }).rows ?? [];
    const subjectMastery = masteryRows.map((r) => ({
      subject: r.subject,
      avgScorePercent: Number(r.avg_score_percent ?? 0),
      completedAttempts: Number(r.completed_attempts ?? 0),
    }));

    const postsResult = await db.execute(sql`
      SELECT
        tp.id,
        tp.title,
        tp.excerpt,
        tp.content,
        tp.category,
        tp.audience,
        tp.pinned,
        tp.created_at::text AS created_at,
        u.name AS author_name,
        u.role AS author_role
      FROM teacher_posts tp
      INNER JOIN users u ON u.id = tp.author
      INNER JOIN user_follows_teacher uft
        ON uft.teacher_id = tp.author
        AND uft.user_id = ${user.id}
      WHERE LOWER(COALESCE(tp.status, '')) NOT IN ('draft', 'archived')
      ORDER BY tp.pinned DESC, tp.created_at DESC
      LIMIT ${postsLimit}
    `);

    const rows = (postsResult as unknown as { rows?: PostRow[] }).rows ?? [];
    const teacherPosts = rows.map((row) => ({
      id: row.id,
      title: row.title,
      excerpt: row.excerpt,
      content: row.content,
      category: row.category,
      audience: row.audience,
      pinned: Boolean(row.pinned),
      createdAt: row.created_at,
      authorName: row.author_name,
      authorRole: row.author_role,
    }));

    res.json({
      data: {
        greetingName: user.name,
        avatarUrl,
        streakDays: STUB_STREAK,
        totalXp: STUB_XP,
        examSummary,
        subjectMastery,
        teacherPosts,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
