import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { authMiddleware } from "../../middlewares/auth";

const router: IRouter = Router();

router.use(authMiddleware as RequestHandler);

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const LeaderboardQuery = z.object({
  scope: z.enum(["school", "national"]).optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : NaN)),
});

type LeaderboardRow = {
  rank: number;
  rank_overall?: number;
  rank_by_school?: number;
  user_id: number;
  display_name: string;
  avatar_url: string | null;
  school_id: number | null;
  school_name: string | null;
  form_level: number | null;
  completed_attempts: number;
  total_attempts: number;
  total_score: number;
  total_marks: number;
  score_percent: number;
  last_attempt_at: string | null;
};

type SchoolRow = { school_id: number | null };

router.get("/leaderboard", async (req, res) => {
  const authUser = (req as { user?: { id: number } }).user;
  if (!authUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = LeaderboardQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const scope = parsed.data.scope ?? "school";
  const limitRaw = parsed.data.limit;
  const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.trunc(limitRaw))) : 50;

  try {
    const viewName = "vw_leaderboard_overall";

    let schoolId: number | null = null;
    if (scope === "school") {
      const schoolResult = await db.execute(sql`
        SELECT u.school_id
        FROM users u
        WHERE u.id = ${authUser.id}
        LIMIT 1
      `);
      const schoolRows = (schoolResult as unknown as { rows?: SchoolRow[] }).rows ?? [];
      schoolId = schoolRows[0]?.school_id ?? null;
      if (schoolId == null) {
        res.json({ data: { items: [] } });
        return;
      }
    }

    const query =
      scope === "school"
        ? sql`
            SELECT
              rank_by_school AS rank,
              rank_overall,
              rank_by_school,
              user_id,
              display_name,
              avatar_url,
              school_id,
              school_name,
              form_level,
              completed_attempts,
              total_attempts,
              total_score,
              total_marks,
              score_percent,
              last_attempt_at::text AS last_attempt_at
            FROM ${sql.raw(viewName)}
            WHERE school_id = ${schoolId}
            ORDER BY rank
            LIMIT ${limit}
          `
        : sql`
            SELECT
              rank_overall AS rank,
              rank_overall,
              rank_by_school,
              user_id,
              display_name,
              avatar_url,
              school_id,
              school_name,
              form_level,
              completed_attempts,
              total_attempts,
              total_score,
              total_marks,
              score_percent,
              last_attempt_at::text AS last_attempt_at
            FROM ${sql.raw(viewName)}
            ORDER BY rank
            LIMIT ${limit}
          `;

    const result = await db.execute(query);
    const rows = (result as unknown as { rows?: LeaderboardRow[] }).rows ?? [];

    res.json({ data: { items: rows } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
    return;
  }
});

export default router;

