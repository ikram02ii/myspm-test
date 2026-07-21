import { Router, type IRouter, type Request, type RequestHandler, type Response } from "express";
import multer from "multer";
import { authMiddleware } from "../middlewares/auth";
import { configuredSttModels } from "../services/stt/config";
import { parseSttLanguage, transcribeAudio } from "../services/stt/transcribe";
import type { SttModelId } from "../services/stt/types";

const router: IRouter = Router();

const disableSttAuth =
  process.env["DISABLE_STT_AUTH"] === "true" || process.env["DISABLE_RAG_AUTH"] === "true";
if (!disableSttAuth) {
  router.use(authMiddleware as RequestHandler);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

router.get("/models", (_req, res) => {
  res.json({ success: true, data: configuredSttModels() });
});

router.get("/health", (_req, res) => {
  const models = configuredSttModels();
  res.json({
    success: true,
    data: { ok: true, configured_models: models.map((m) => m.id) },
  });
});

router.post("/transcribe", upload.single("audio"), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file?.buffer?.length) {
      return res.status(400).json({ success: false, error: "No audio file uploaded" });
    }

    const modelRaw = typeof req.body?.model === "string" ? req.body.model.trim() : "";
    if (!modelRaw) {
      return res.status(400).json({ success: false, error: "model field is required" });
    }

    const model = modelRaw as SttModelId;
    const language = parseSttLanguage(
      typeof req.body?.language === "string" ? req.body.language : undefined,
    );

    const result = await transcribeAudio({
      audioBuffer: file.buffer,
      originalName: file.originalname || "audio.wav",
      mimeType: file.mimetype,
      model,
      language,
    });

    return res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcription failed";
    const statusCode =
      message.includes("not configured") ||
      message.includes("unknown") ||
      message.includes("required")
        ? 400
        : 500;
    console.error("[stt] transcribe failed", error);
    return res.status(statusCode).json({ success: false, error: message });
  }
});

export default router;
