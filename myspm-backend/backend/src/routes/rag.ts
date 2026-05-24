import { Router, type IRouter, type Request, type RequestHandler, type Response } from "express";
import multer from "multer";
import { authMiddleware, type AuthRequest } from "../middlewares/auth";
import { extractTextFromPdfBuffer } from "../services/rag/pdfTextExtract";
import { gradeSubmission } from "../services/rag/gradeService";
import { buildGradingContextPayload, retrieveChunks } from "../services/rag/retrievalService";
import { listTextbooks, registerTextbook } from "../services/rag/textbookService";
import { generateWithRag } from "../services/ai gen/generateFromRag";
import { listTextbookChaptersForSubjectForm } from "../services/rag/textbookChaptersService";
import { createRubricsFromTextbookChunks } from "../services/rag/rubricFromTextbookChunksService";
import { gradeSpeakingPhase } from "../services/rag/speakingGradeService";
import { transcribeSpeakingAudio } from "../services/rag/speakingTranscribeService";

const router: IRouter = Router();
const disableRagAuth = process.env["DISABLE_RAG_AUTH"] === "true";
if (!disableRagAuth) {
  router.use(authMiddleware as RequestHandler);
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
});
const gradeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});
const speakingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function imageBufferToDataUrl(buffer: Buffer, mime: string | undefined): string {
  const rawMime = (mime || "").toLowerCase();
  const safeMime = rawMime.startsWith("image/") ? rawMime : "image/jpeg";
  return `data:${safeMime};base64,${buffer.toString("base64")}`;
}

async function handleRegisterTextbook(req: Request, res: Response) {
  try {
    const creatorIdRaw = (req as AuthRequest).user?.id;
    const creatorId = typeof creatorIdRaw === "string" ? Number(creatorIdRaw) : Number.NaN;
    const createdByUserId = Number.isFinite(creatorId) ? creatorId : undefined;

    const result = await registerTextbook({
      subject: typeof req.body?.subject === "string" ? req.body.subject : "",
      form: typeof req.body?.form === "string" ? req.body.form : "",
      title: typeof req.body?.title === "string" ? req.body.title : "",
      sourceName: typeof req.body?.sourceName === "string" ? req.body.sourceName : undefined,
      text: typeof req.body?.text === "string" ? req.body.text : "",
      chunkConfig: {
        chunkSizeChars: Number(req.body?.chunkSizeChars),
        overlapChars: Number(req.body?.overlapChars),
      },
      createdByUserId,
    });

    return res.status(201).json({
      textbookId: result.textbookId,
      chunkCount: result.chunkCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create textbook knowledge base";
    const statusCode =
      message === "subject, form, and title are required" ||
      message === "text is required" ||
      message === "No chunks produced from textbook text"
        ? 400
        : 500;
    console.error("[rag] create textbook failed", error);
    return res.status(statusCode).json({ error: message });
  }
}

function queryParamString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

router.post("/textbooks", handleRegisterTextbook);

router.post("/textbooks/register", handleRegisterTextbook);

router.post("/textbooks/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file?.buffer) {
      return res.status(400).json({ error: "Missing PDF file. Use multipart/form-data with file field 'file'." });
    }

    const hasPdfMime = (file.mimetype || "").toLowerCase().includes("pdf");
    const hasPdfExt = (file.originalname || "").toLowerCase().endsWith(".pdf");
    if (!hasPdfMime && !hasPdfExt) {
      return res.status(400).json({ error: "Only PDF files are supported." });
    }

    const creatorIdRaw = (req as AuthRequest).user?.id;
    const creatorId = typeof creatorIdRaw === "string" ? Number(creatorIdRaw) : Number.NaN;
    const createdByUserId = Number.isFinite(creatorId) ? creatorId : undefined;
    const extractedText = await extractTextFromPdfBuffer(file.buffer);

    const result = await registerTextbook({
      subject: typeof req.body?.subject === "string" ? req.body.subject : "",
      form: typeof req.body?.form === "string" ? req.body.form : "",
      title: typeof req.body?.title === "string" ? req.body.title : "",
      sourceName:
        typeof req.body?.sourceName === "string" && req.body.sourceName.trim().length > 0
          ? req.body.sourceName
          : file.originalname,
      text: extractedText,
      chunkConfig: {
        chunkSizeChars: Number(req.body?.chunkSizeChars),
        overlapChars: Number(req.body?.overlapChars),
      },
      createdByUserId,
    });

    return res.status(201).json({
      textbookId: result.textbookId,
      chunkCount: result.chunkCount,
      sourceName: file.originalname,
      extractedCharCount: extractedText.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to upload textbook PDF";
    const statusCode =
      message.includes("Missing PDF file") ||
      message.includes("Only PDF files are supported") ||
      message === "PDF extraction produced empty text" ||
      message === "subject, form, and title are required" ||
      message === "No chunks produced from textbook text"
        ? 400
        : 500;

    console.error("[rag] upload textbook failed", error);
    return res.status(statusCode).json({ error: message });
  }
});

router.get("/textbooks", async (_req, res) => {
  try {
    const items = await listTextbooks();
    return res.json({ items });
  } catch (error) {
    console.error("[rag] list textbooks failed", error);
    return res.status(500).json({ error: "Failed to list textbook knowledge base" });
  }
});

/** Distinct chunk `chapter` strings for a subject+form (matches DB ingest labels). */
router.get("/textbook-chapters", async (req, res) => {
  try {
    const subject = queryParamString(req.query.subject);
    const form = queryParamString(req.query.form);
    if (!subject || !form) {
      return res.status(400).json({ error: "Query parameters \"subject\" and \"form\" are required." });
    }
    const chapters = await listTextbookChaptersForSubjectForm(subject, form);
    return res.json({ chapters });
  } catch (error) {
    console.error("[rag] textbook chapters list failed", error);
    return res.status(500).json({ error: "Failed to list textbook chapters" });
  }
});

router.post("/retrieve", async (req, res) => {
  try {
    const result = await retrieveChunks({
      query: typeof req.body?.query === "string" ? req.body.query : "",
      subject: typeof req.body?.subject === "string" ? req.body.subject : undefined,
      form: typeof req.body?.form === "string" ? req.body.form : undefined,
      topK: Number(req.body?.topK),
    });
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to retrieve textbook chunks";
    const statusCode = message === "query is required" ? 400 : 500;
    console.error("[rag] retrieve failed", error);
    return res.status(statusCode).json({ error: message });
  }
});

router.post("/grading-context", async (req, res) => {
  try {
    const retrieval = await retrieveChunks({
      query: typeof req.body?.query === "string" ? req.body.query : "",
      subject: typeof req.body?.subject === "string" ? req.body.subject : undefined,
      form: typeof req.body?.form === "string" ? req.body.form : undefined,
      topK: Number(req.body?.topK),
    });

    const payload = buildGradingContextPayload(retrieval);
    return res.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build grading context";
    const statusCode = message === "query is required" ? 400 : 500;
    console.error("[rag] grading context build failed", error);
    return res.status(statusCode).json({ error: message });
  }
});

router.post("/generate", async (req, res) => {
  try {
    const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
    if (!query) {
      return res.status(400).json({ error: "Body must include non-empty string \"query\"" });
    }

    const subject = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
    if (!subject) {
      return res.status(400).json({ error: "Body must include non-empty string \"subject\"" });
    }

    const topK =
      typeof req.body?.topK === "number" && Number.isFinite(req.body.topK)
        ? req.body.topK
        : 8;

    const generateImage = req.body?.generateImage === true;
    const imagePrompt =
      typeof req.body?.imagePrompt === "string" ? req.body.imagePrompt : null;

    const chapterFilterRaw =
      typeof req.body?.chapterFilter === "string" ? req.body.chapterFilter.trim() : "";
    const chapterHintRaw =
      typeof req.body?.chapterHint === "string" ? req.body.chapterHint.trim() : "";
    const formRaw = typeof req.body?.form === "string" ? req.body.form.trim() : "";

    const result = await generateWithRag({
      query,
      subject,
      form: formRaw || null,
      topK,
      generateImage,
      imagePrompt,
      chapterFilter: chapterFilterRaw || null,
      chapterHint: chapterHintRaw || null,
      createOpenEndedRubrics: req.body?.createOpenEndedRubrics === true,
      skipRetrieval: req.body?.skipRetrieval === true,
      englishSpeaking: req.body?.englishSpeaking === true,
      englishSpeakingPdfPath:
        typeof req.body?.englishSpeakingPdfPath === "string"
          ? req.body.englishSpeakingPdfPath.trim()
          : undefined,
    });

    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate questions";
    console.error("[rag] generate failed", error);
    return res.status(500).json({ error: message });
  }
});

router.post("/rubrics/from-textbook-chunks", async (req, res) => {
  try {
    const textbookId = typeof req.body?.textbookId === "string" ? req.body.textbookId.trim() : "";
    const subject = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
    const form = typeof req.body?.form === "string" ? req.body.form.trim() : "";
    if (!textbookId && (!subject || !form)) {
      return res.status(400).json({
        error: 'Provide "textbookId" or both "subject" and "form".',
      });
    }

    const maxChunks =
      typeof req.body?.maxChunks === "number" && Number.isFinite(req.body.maxChunks)
        ? req.body.maxChunks
        : undefined;
    const offset =
      typeof req.body?.offset === "number" && Number.isFinite(req.body.offset) ? req.body.offset : undefined;
    const maxMarks =
      typeof req.body?.maxMarks === "number" && Number.isFinite(req.body.maxMarks)
        ? req.body.maxMarks
        : undefined;
    const concurrency =
      typeof req.body?.concurrency === "number" && Number.isFinite(req.body.concurrency)
        ? req.body.concurrency
        : undefined;
    const chapterFilter =
      typeof req.body?.chapterFilter === "string" ? req.body.chapterFilter.trim() : undefined;

    const result = await createRubricsFromTextbookChunks({
      textbookId: textbookId || undefined,
      subject: subject || undefined,
      form: form || undefined,
      chapterFilter: chapterFilter || undefined,
      maxChunks,
      offset,
      maxMarks,
      concurrency,
      skipExisting: req.body?.skipExisting !== false,
    });

    return res.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create rubrics from textbook chunks";
    const statusCode =
      message.includes("not found") || message.includes("Provide textbookId") ? 400 : 500;
    console.error("[rag] rubrics from textbook chunks failed", error);
    return res.status(statusCode).json({ error: message });
  }
});

router.post("/grade", gradeUpload.single("diagramImage"), async (req, res) => {
  try {
    const userIdRaw = (req as AuthRequest).user?.id;
    const userId = typeof userIdRaw === "string" ? Number(userIdRaw) : Number.NaN;
    const diagramImageFile = req.file;
    const diagramImageBase64FromFile = diagramImageFile?.buffer?.length
      ? imageBufferToDataUrl(diagramImageFile.buffer, diagramImageFile.mimetype)
      : undefined;

    const result = await gradeSubmission({
      question: typeof req.body?.question === "string" ? req.body.question : "",
      studentAnswer: typeof req.body?.studentAnswer === "string" ? req.body.studentAnswer : "",
      subject: typeof req.body?.subject === "string" ? req.body.subject : undefined,
      form: typeof req.body?.form === "string" ? req.body.form : undefined,
      topK: Number(req.body?.topK),
      maxScore: Number(req.body?.maxScore),
      rubricId: typeof req.body?.rubricId === "string" ? req.body.rubricId : undefined,
      rubricVersion: typeof req.body?.rubricVersion === "string" ? req.body.rubricVersion : undefined,
      diagramImageUrl: typeof req.body?.diagramImageUrl === "string" ? req.body.diagramImageUrl : undefined,
      diagramImageBase64: diagramImageBase64FromFile
        || (typeof req.body?.diagramImageBase64 === "string" ? req.body.diagramImageBase64 : undefined),
      submissionId: typeof req.body?.submissionId === "string" ? req.body.submissionId : undefined,
      userId: Number.isFinite(userId) ? userId : null,
    });

    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to grade submission";
    const statusCode =
      message === "question is required" || message === "studentAnswer is required"
        ? 400
        : 500;

    console.error("[rag] grade failed", error);
    return res.status(statusCode).json({ error: message });
  }
});

router.post("/speaking/transcribe", speakingUpload.single("audio"), async (req, res) => {
  try {
    const file = req.file;
    if (!file?.buffer?.length) {
      return res.status(400).json({ error: "audio file is required" });
    }
    const result = await transcribeSpeakingAudio({
      buffer: file.buffer,
      mimeType: file.mimetype,
      originalName: file.originalname,
    });
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to transcribe audio";
    console.error("[rag] speaking transcribe failed", error);
    return res.status(500).json({ error: message });
  }
});

router.post("/speaking/grade", async (req, res) => {
  try {
    const phase = req.body?.phase === "speak" ? "speak" : "prepare";
    const cueCard = typeof req.body?.cueCard === "string" ? req.body.cueCard : "";
    const transcript = typeof req.body?.transcript === "string" ? req.body.transcript : "";
    if (!cueCard.trim()) {
      return res.status(400).json({ error: "cueCard is required" });
    }
    const result = await gradeSpeakingPhase({
      phase,
      cueCard,
      transcript,
      subject: typeof req.body?.subject === "string" ? req.body.subject : undefined,
      form: typeof req.body?.form === "string" ? req.body.form : undefined,
      durationSeconds: Number(req.body?.durationSeconds),
    });
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to grade speaking";
    console.error("[rag] speaking grade failed", error);
    return res.status(500).json({ error: message });
  }
});

export default router;
