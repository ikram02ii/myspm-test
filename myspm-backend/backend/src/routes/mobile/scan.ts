import { Router, type IRouter, type RequestHandler } from "express";
import { authMiddleware, type AuthRequest } from "../../middlewares/auth";
import multer from "multer";
import OSS from "ali-oss";

const router: IRouter = Router();

router.use(authMiddleware as RequestHandler);

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
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

function prefixForUser(req: AuthRequest): string {
  const email = req.user?.email?.trim();
  if (!email) {
    throw new Error("Missing user email");
  }
  const folder = safeUserFolderFromEmail(email);
  return `myspm/mobile/scans/${folder}/`;
}

router.get("/scan/history", async (req, res) => {
  try {
    const userPrefix = prefixForUser(req as AuthRequest);
    const client = makeOssClient();
    const result = await client.list(
      {
        prefix: userPrefix,
        "max-keys": 60,
      },
      {}
    );

    const objects = (result.objects ?? [])
      .filter((o) => typeof o.name === "string" && o.name.length > 0)
      .map((o) => ({
        key: o.name as string,
        url: publicUrlForKey(o.name as string),
        uploadedAt: o.lastModified ? new Date(o.lastModified).toISOString() : null,
        size: typeof o.size === "number" ? o.size : null,
      }))
      .sort((a, b) => (a.uploadedAt && b.uploadedAt ? b.uploadedAt.localeCompare(a.uploadedAt) : 0));

    res.status(200).json({ items: objects });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
    return;
  }
});

router.post("/scan/upload", upload.single("image"), async (req, res) => {
  try {
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

    const userPrefix = prefixForUser(req as AuthRequest);
    const key = `${userPrefix}${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;

    const client = makeOssClient();
    await client.put(key, file.buffer, {
      headers: {
        "Content-Type": file.mimetype,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });

    res.status(200).json({
      key,
      url: publicUrlForKey(key),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
    return;
  }
});

export default router;

