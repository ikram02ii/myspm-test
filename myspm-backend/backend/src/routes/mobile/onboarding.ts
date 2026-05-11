import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { authMiddleware } from "../../middlewares/auth";

const CompleteOnboardingBody = z.object({
  formLevel: z.union([z.literal(4), z.literal(5)]),
  schoolId: z.number().int().positive(),
  subjectCodes: z
    .array(z.string().min(1))
    .min(1)
    .transform((arr) => [...new Set(arr)]),
  teacherIds: z
    .array(z.number().int().positive())
    .min(1, "At least one teacher is required")
    .transform((arr) => [...new Set(arr)]),
});

const router: IRouter = Router();

router.use(authMiddleware as RequestHandler);

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

type SubjectRow = {
  code: string;
  display_name_en: string | null;
  display_name_ms: string | null;
  sort_order: number | null;
};

type SchoolRow = {
  id: number;
  name: string;
  city: string | null;
  state: string | null;
};

type TeacherRow = {
  id: number;
  name: string;
  follower_count: string | number;
};

router.get("/onboarding/subjects", async (_req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT
        lv.code,
        lv.display_name_en,
        lv.display_name_ms,
        lv.sort_order
      FROM lov_values lv
      INNER JOIN lov_categories lc
        ON lc.id = lv.category_id
      WHERE lc.code = 'subjects'
        AND lv.status = 'active'
      ORDER BY lv.sort_order ASC, lv.id ASC
    `);

    const rows = (result as unknown as { rows?: SubjectRow[] }).rows ?? [];
    const data = rows.map((row) => ({
      code: row.code,
      name: row.display_name_en ?? row.display_name_ms ?? row.code,
    }));

    res.json({ data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to load subjects" });
  }
});

router.get("/onboarding/schools", async (_req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT id, name, city, state
      FROM schools
      ORDER BY name ASC
    `);

    const rows = (result as unknown as { rows?: SchoolRow[] }).rows ?? [];
    const data = rows.map((row) => ({
      id: row.id,
      name: row.name,
      city: row.city ?? "",
      state: row.state ?? "",
    }));

    res.json({ data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to load schools" });
  }
});

router.post("/onboarding/complete", async (req, res) => {
  const authUser = (req as { user?: { id: number } }).user;
  if (!authUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = CompleteOnboardingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { formLevel, schoolId, subjectCodes } = parsed.data;
  const teacherIds = parsed.data.teacherIds.filter((id) => id !== authUser.id);
  const userId = authUser.id;

  if (teacherIds.length < 1) {
    res.status(400).json({ error: "At least one teacher is required" });
    return;
  }

  try {
    const schoolResult = await db.execute(sql`
      SELECT id FROM schools WHERE id = ${schoolId} LIMIT 1
    `);
    const schoolRows = (schoolResult as unknown as { rows?: { id: number }[] }).rows ?? [];
    if (schoolRows.length === 0) {
      res.status(400).json({ error: "Invalid school" });
      return;
    }

    const codesSql = sql.join(subjectCodes.map((c) => sql`${c}`), sql`, `);
    const subjResult = await db.execute(sql`
      SELECT COUNT(*)::text AS c
      FROM lov_values lv
      INNER JOIN lov_categories lc ON lc.id = lv.category_id
      WHERE lc.code = 'subjects'
        AND lv.status = 'active'
        AND lv.code IN (${codesSql})
    `);
    const subjRows = (subjResult as unknown as { rows?: { c: string }[] }).rows ?? [];
    const subjCount = Number(subjRows[0]?.c ?? 0);
    if (!Number.isFinite(subjCount) || subjCount !== subjectCodes.length) {
      res.status(400).json({ error: "One or more subject codes are invalid" });
      return;
    }

    const idsSql = sql.join(teacherIds.map((id) => sql`${id}`), sql`, `);
    const teachResult = await db.execute(sql`
      SELECT COUNT(*)::text AS c
      FROM users
      WHERE role = 'teacher' AND id IN (${idsSql})
    `);
    const teachRows = (teachResult as unknown as { rows?: { c: string }[] }).rows ?? [];
    const teachCount = Number(teachRows[0]?.c ?? 0);
    if (!Number.isFinite(teachCount) || teachCount !== teacherIds.length) {
      res.status(400).json({ error: "One or more teachers are invalid" });
      return;
    }

    await db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE users
        SET school_id = ${schoolId},
            form_level = ${formLevel},
            updated_at = NOW()
        WHERE id = ${userId}
      `);

      await tx.execute(sql`
        DELETE FROM user_subject_favourites WHERE user_id = ${userId}
      `);

      for (const code of subjectCodes) {
        await tx.execute(sql`
          INSERT INTO user_subject_favourites (user_id, subject_code, created_at, updated_at)
          VALUES (${userId}, ${code}, NOW(), NOW())
        `);
      }

      await tx.execute(sql`
        DELETE FROM user_follows_teacher WHERE user_id = ${userId}
      `);

      for (const teacherId of teacherIds) {
        await tx.execute(sql`
          INSERT INTO user_follows_teacher (user_id, teacher_id, created_at, updated_at)
          VALUES (${userId}, ${teacherId}, NOW(), NOW())
        `);
      }
    });

    res.json({ data: { ok: true } });
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/onboarding/teachers", async (_req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT
        u.id,
        u.name,
        COALESCE(COUNT(uft.id), 0) AS follower_count
      FROM users u
      LEFT JOIN user_follows_teacher uft
        ON uft.teacher_id = u.id
      WHERE u.role = 'teacher'
      GROUP BY u.id, u.name
      ORDER BY u.name ASC
    `);

    const rows = (result as unknown as { rows?: TeacherRow[] }).rows ?? [];
    const data = rows.map((row) => {
      const n = Number(row.follower_count);
      return {
        id: row.id,
        name: row.name,
        followerCount: Number.isFinite(n) ? n : 0,
      };
    });

    res.json({ data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
