import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod";
import multer from "multer";
import OSS from "ali-oss";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { authMiddleware, type AuthRequest } from "../../middlewares/auth";

const STUB_XP = 0;
const STUB_STREAK = 0;

const router: IRouter = Router();

router.use(authMiddleware as RequestHandler);

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function requiredEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function makeOssClient() {
  return new OSS({
    accessKeyId: requiredEnv("OSS_ACCESS_KEY_ID"),
    accessKeySecret: requiredEnv("OSS_ACCESS_KEY_SECRET"),
    endpoint: requiredEnv("OSS_ENDPOINT"),
    bucket: requiredEnv("OSS_BUCKET"),
    secure: true,
  });
}

function publicUrlForKey(key: string): string {
  const domain = requiredEnv("OSS_BUCKET_DOMAIN").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${domain}/${key}`;
}

function safeUserFolderFromEmail(email: string): string {
  const local = email.split("@")[0]?.trim().toLowerCase() ?? "";
  const safe = local.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
  return safe || "unknown";
}

function prefixForProfileAvatar(req: AuthRequest): string {
  const email = req.user?.email?.trim();
  if (!email) {
    throw new Error("Missing user email");
  }
  const folder = safeUserFolderFromEmail(email);
  return `myspm/mobile/profile_avatar/${folder}/`;
}

function ossKeyFromAvatarPublicUrl(url: string): string | null {
  try {
    const trimmed = url.trim();
    if (!trimmed) return null;
    const domain = requiredEnv("OSS_BUCKET_DOMAIN").replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const u = trimmed.replace(/^https?:\/\//, "");
    const prefix = `${domain}/`;
    if (!u.startsWith(prefix)) return null;
    const key = u.slice(prefix.length).split("?")[0];
    if (!key.startsWith("myspm/mobile/profile_avatar/")) return null;
    return key;
  } catch {
    return null;
  }
}

type UserRow = {
  id: number;
  name: string;
  email: string;
  role: string;
  form_level: number | null;
  school_name: string | null;
  avatar_url: string | null;
};

type SubjectFavouriteRow = {
  code: string;
  name: string;
};

type TeacherRow = {
  id: number;
  name: string;
};

const AddSubjectFavouriteBody = z.object({
  subjectCode: z.string().min(1),
});

const UpdateAccountBody = z.object({
  name: z.string().trim().min(1).max(120),
  teacherIds: z
    .array(z.number().int().positive())
    .min(1, "At least one teacher is required")
    .transform((arr) => [...new Set(arr)]),
});

router.get("/profile", async (req, res) => {
  const user = (req as { user?: { id: number } }).user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const userResult = await db.execute(sql`
      SELECT
        u.id,
        u.name,
        u.email,
        u.role,
        u.form_level,
        u.avatar_url,
        s.name AS school_name
      FROM users u
      LEFT JOIN schools s ON s.id = u.school_id
      WHERE u.id = ${user.id}
      LIMIT 1
    `);

    const userRows = (userResult as unknown as { rows?: UserRow[] }).rows ?? [];
    const row = userRows[0];
    if (!row) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const countResult = await db.execute(sql`
      SELECT COUNT(*)::text AS c
      FROM attempt_answers aa
      INNER JOIN student_results sr ON sr.id = aa.result_id
      WHERE sr.student_id = ${user.id}
    `);
    const countRows = (countResult as unknown as { rows?: { c: string }[] }).rows ?? [];
    const n = Number(countRows[0]?.c ?? 0);
    const questionsAnswered = Number.isFinite(n) ? Math.trunc(n) : 0;

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

    const favResult = await db.execute(sql`
      SELECT
        lv.code,
        COALESCE(lv.display_name_en, lv.display_name_ms, lv.code) AS name
      FROM user_subject_favourites usf
      INNER JOIN lov_values lv ON lv.code = usf.subject_code
      INNER JOIN lov_categories lc ON lc.id = lv.category_id AND lc.code = 'subjects'
      WHERE usf.user_id = ${user.id}
      ORDER BY usf.created_at ASC
    `);
    const favRows = (favResult as unknown as { rows?: SubjectFavouriteRow[] }).rows ?? [];
    const subjectFavourites = favRows.map((r) => ({
      code: r.code,
      name: r.name,
    }));

    res.json({
      data: {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        formLevel: row.form_level,
        schoolName: row.school_name,
        avatarUrl: row.avatar_url,
        totalXp: STUB_XP,
        streakDays: STUB_STREAK,
        questionsAnswered,
        examSummary,
        subjectMastery,
        subjectFavourites,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/profile/account", async (req, res) => {
  const user = (req as { user?: { id: number } }).user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const userResult = await db.execute(sql`
      SELECT
        u.id,
        u.name,
        u.email,
        u.role,
        s.name AS school_name
      FROM users u
      LEFT JOIN schools s ON s.id = u.school_id
      WHERE u.id = ${user.id}
      LIMIT 1
    `);
    const userRows = (userResult as unknown as { rows?: Array<{ id: number; name: string; email: string; role: string; school_name: string | null }> }).rows ?? [];
    const row = userRows[0];
    if (!row) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const followingResult = await db.execute(sql`
      SELECT t.id, t.name
      FROM user_follows_teacher uft
      INNER JOIN users t ON t.id = uft.teacher_id
      WHERE uft.user_id = ${user.id}
      ORDER BY t.name ASC
    `);
    const followingTeachers = ((followingResult as unknown as { rows?: TeacherRow[] }).rows ?? []).map((t) => ({
      id: t.id,
      name: t.name,
    }));

    const teachersResult = await db.execute(sql`
      SELECT u.id, u.name
      FROM users u
      WHERE u.role = 'teacher'
      ORDER BY u.name ASC
    `);
    const teachers = ((teachersResult as unknown as { rows?: TeacherRow[] }).rows ?? []).map((t) => ({
      id: t.id,
      name: t.name,
    }));

    res.json({
      data: {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        schoolName: row.school_name,
        followingTeachers,
        teachers,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/profile/account", async (req, res) => {
  const authUser = (req as { user?: { id: number } }).user;
  if (!authUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = UpdateAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const name = parsed.data.name;
  const teacherIds = parsed.data.teacherIds.filter((id) => id !== authUser.id);
  if (teacherIds.length < 1) {
    res.status(400).json({ error: "At least one teacher is required" });
    return;
  }

  try {
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
        SET name = ${name}, updated_at = NOW()
        WHERE id = ${authUser.id}
      `);

      await tx.execute(sql`
        DELETE FROM user_follows_teacher WHERE user_id = ${authUser.id}
      `);

      for (const teacherId of teacherIds) {
        await tx.execute(sql`
          INSERT INTO user_follows_teacher (user_id, teacher_id, created_at, updated_at)
          VALUES (${authUser.id}, ${teacherId}, NOW(), NOW())
        `);
      }
    });

    res.json({ data: { ok: true } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/profile/subject-favourites", async (req, res) => {
  const authUser = (req as { user?: { id: number } }).user;
  if (!authUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = AddSubjectFavouriteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const subjectCode = parsed.data.subjectCode.trim();
  try {
    const validResult = await db.execute(sql`
      SELECT lv.code
      FROM lov_values lv
      INNER JOIN lov_categories lc ON lc.id = lv.category_id
      WHERE lc.code = 'subjects'
        AND lv.status = 'active'
        AND lv.code = ${subjectCode}
      LIMIT 1
    `);
    const validRows = (validResult as unknown as { rows?: { code: string }[] }).rows ?? [];
    if (validRows.length === 0) {
      res.status(400).json({ error: "Invalid subject" });
      return;
    }

    await db.execute(sql`
      INSERT INTO user_subject_favourites (user_id, subject_code, created_at, updated_at)
      VALUES (${authUser.id}, ${subjectCode}, NOW(), NOW())
      ON CONFLICT (user_id, subject_code) DO NOTHING
    `);

    res.json({ data: { ok: true } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/profile/avatar", avatarUpload.single("image"), async (req, res) => {
  const authUser = (req as { user?: { id: number } }).user;
  if (!authUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const file = req.file;
  if (!file?.buffer || !file.mimetype) {
    res.status(400).json({ error: "Missing image" });
    return;
  }

  const ext =
    file.mimetype === "image/png"
      ? "png"
      : file.mimetype === "image/webp"
        ? "webp"
        : "jpg";

  try {
    const prevResult = await db.execute(sql`
      SELECT u.avatar_url
      FROM users u
      WHERE u.id = ${authUser.id}
      LIMIT 1
    `);
    const prevRows = (prevResult as unknown as { rows?: { avatar_url: string | null }[] }).rows ?? [];
    const previousUrl = prevRows[0]?.avatar_url ?? null;

    const userPrefix = prefixForProfileAvatar(req as AuthRequest);
    const key = `${userPrefix}${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;

    const client = makeOssClient();
    await client.put(key, file.buffer, {
      headers: {
        "Content-Type": file.mimetype,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });

    const avatarUrl = publicUrlForKey(key);

    await db.execute(sql`
      UPDATE users
      SET avatar_url = ${avatarUrl}, updated_at = NOW()
      WHERE id = ${authUser.id}
    `);

    if (previousUrl) {
      const oldKey = ossKeyFromAvatarPublicUrl(previousUrl);
      if (oldKey && oldKey !== key) {
        try {
          await client.delete(oldKey);
        } catch (delErr) {
          console.error(delErr);
        }
      }
    }

    res.json({ data: { avatarUrl } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/profile/avatar", async (req, res) => {
  const authUser = (req as { user?: { id: number } }).user;
  if (!authUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const prevResult = await db.execute(sql`
      SELECT u.avatar_url
      FROM users u
      WHERE u.id = ${authUser.id}
      LIMIT 1
    `);
    const prevRows = (prevResult as unknown as { rows?: { avatar_url: string | null }[] }).rows ?? [];
    const previousUrl = prevRows[0]?.avatar_url ?? null;

    await db.execute(sql`
      UPDATE users
      SET avatar_url = NULL, updated_at = NOW()
      WHERE id = ${authUser.id}
    `);

    if (previousUrl) {
      const oldKey = ossKeyFromAvatarPublicUrl(previousUrl);
      if (oldKey) {
        try {
          await makeOssClient().delete(oldKey);
        } catch (delErr) {
          console.error(delErr);
        }
      }
    }

    res.json({ data: { avatarUrl: null } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
