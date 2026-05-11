import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID } from "node:crypto";
import { extractPdfText } from "../src/services/rag/pdfTextExtract";
import { cleanText } from "../src/services/rag/pdfTextExtract";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

type Cli = {
  qPdfPath?: string;
  aPdfPath?: string;
  subject?: string;
  form?: string;
  title?: string;
  year?: number;
  paperLabel?: string;
  paperId?: string;
  topSpotCheck?: number;
};

type QaBlock = {
  questionRef: string;
  text: string;
  maxMarks?: number;
  conceptTitle?: string;
  keywords?: string[];
};

type MergedBlock = {
  questionRef: string;
  questionText: string;
  answerText: string;
  maxMarks?: number;
  conceptTitle?: string;
  keywords: string[];
};

function splitIntoChunks(text: string, chunkSize = 3200, overlap = 250): string[] {
  const normalizedSize =
    Number.isFinite(chunkSize) && chunkSize >= 400 && chunkSize <= 8000 ? Math.floor(chunkSize) : 3200;
  const normalizedOverlap =
    Number.isFinite(overlap) && overlap >= 0 && overlap < normalizedSize ? Math.floor(overlap) : 250;
  const cleaned = cleanText(text);
  if (!cleaned) return [];
  const chunks: string[] = [];
  const safeOverlap = Math.max(0, Math.min(normalizedOverlap, Math.floor(normalizedSize / 2)));
  let start = 0;
  while (start < cleaned.length) {
    const end = Math.min(cleaned.length, start + normalizedSize);
    const chunk = cleaned.slice(start, end).trim();
    if (chunk.length > 0) chunks.push(chunk);
    if (end >= cleaned.length) break;
    start = Math.max(end - safeOverlap, start + 1);
  }
  return chunks;
}

function parseArgs(argv: string[]): Cli {
  const out: Cli = { topSpotCheck: 12 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value == null) continue;
    switch (key) {
      case "--qPdfPath":
        out.qPdfPath = value;
        i += 1;
        break;
      case "--aPdfPath":
        out.aPdfPath = value;
        i += 1;
        break;
      case "--subject":
        out.subject = value;
        i += 1;
        break;
      case "--form":
        out.form = value;
        i += 1;
        break;
      case "--title":
        out.title = value;
        i += 1;
        break;
      case "--year":
        out.year = Number(value);
        i += 1;
        break;
      case "--paperLabel":
        out.paperLabel = value;
        i += 1;
        break;
      case "--paperId":
        out.paperId = value;
        i += 1;
        break;
      case "--topSpotCheck":
        out.topSpotCheck = Math.max(1, Math.min(20, Number(value) || 12));
        i += 1;
        break;
      default:
        break;
    }
  }
  return out;
}

function resolveQwenConfig(): { apiKey: string; baseUrl: string; model: string } {
  const apiKey =
    process.env["QWEN_CHUNKING_API_KEY"]?.trim() ||
    process.env["QWEN_GRADING_API_KEY"]?.trim() ||
    process.env["QWEN_OCR_API_KEY"]?.trim();
  const baseUrl =
    process.env["QWEN_CHUNKING_BASE_URL"]?.trim().replace(/\/+$/, "") ||
    process.env["QWEN_GRADING_BASE_URL"]?.trim().replace(/\/+$/, "") ||
    process.env["QWEN_OCR_BASE_URL"]?.trim().replace(/\/+$/, "");
  const model =
    process.env["QWEN_CHUNKING_MODEL"]?.trim() ||
    process.env["QWEN_GRADING_MODEL"]?.trim() ||
    process.env["QWEN_MODEL"]?.trim() ||
    "qwen-plus";
  if (!apiKey || !baseUrl) throw new Error("QWEN config missing for LLM normalization.");
  return { apiKey, baseUrl, model };
}

function messageContentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((it) =>
        it && typeof it === "object" && "text" in it && typeof (it as { text?: unknown }).text === "string"
          ? ((it as { text: string }).text ?? "")
          : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function normalizeQuestionRef(raw: string): string | null {
  let s = cleanText(String(raw || "")).toUpperCase();
  if (!s) return null;
  s = s.replace(/^QUESTION\s*/i, "").replace(/\s+/g, "");
  if (!s.startsWith("Q")) s = `Q${s}`;
  s = s.replace(/^Q0+(\d)/, "Q$1");
  const ok = /^Q\d+(?:\([A-Z0-9IVX]+\))*$/.test(s);
  return ok ? s : null;
}

function sanitizeBlock(block: any): QaBlock | null {
  const ref = normalizeQuestionRef(block?.questionRef ?? "");
  const text = cleanText(String(block?.text ?? ""));
  if (!ref || text.length < 20) return null;
  const maxMarks = Number.isFinite(Number(block?.maxMarks)) ? Number(block.maxMarks) : undefined;
  const conceptTitle = cleanText(String(block?.conceptTitle ?? "")).slice(0, 255) || undefined;
  const keywords = Array.isArray(block?.keywords)
    ? block.keywords
        .filter((k: unknown): k is string => typeof k === "string")
        .map((k) => cleanText(k))
        .filter(Boolean)
        .slice(0, 12)
    : undefined;
  return { questionRef: ref, text, maxMarks, conceptTitle, keywords };
}

async function llmParseQaWindow(params: {
  textWindow: string;
  sourceType: "question" | "answer";
  subject: string;
  form: string;
}): Promise<QaBlock[]> {
  const cfg = resolveQwenConfig();
  const url = `${cfg.baseUrl}/chat/completions`;
  const system = "Return JSON only: { blocks: [{ questionRef, text, maxMarks, conceptTitle, keywords }] }.";
  const user = [
    `Subject: ${params.subject}`,
    `Form: ${params.form}`,
    `SourceType: ${params.sourceType}`,
    "Task:",
    "- Split into minimal SPM blocks keyed by question reference (Q1, Q2(a), Q3(b)(i), etc.).",
    "- Keep text faithful; do not invent content.",
    "- questionRef must be explicit. If absent, infer nearest valid ref from context.",
    "- For answers, include maxMarks only when clearly stated.",
    "- conceptTitle short (<= 8 words), keywords concise.",
    "Text:",
    params.textWindow,
  ].join("\n\n");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      max_tokens: 1800,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const raw = await res.text();
  const parsed = JSON.parse(raw);
  if (!res.ok) throw new Error(parsed?.error?.message || parsed?.message || `LLM failed ${res.status}`);
  const content = messageContentToString(parsed?.choices?.[0]?.message?.content);
  const payload = JSON.parse(extractJson(content));
  const arr = Array.isArray(payload?.blocks) ? payload.blocks : [];
  return arr.map(sanitizeBlock).filter((b: QaBlock | null): b is QaBlock => b != null);
}

async function parseDocumentToBlocks(params: {
  fullText: string;
  sourceType: "question" | "answer";
  subject: string;
  form: string;
}): Promise<QaBlock[]> {
  const windows = splitIntoChunks(params.fullText, 3200, 250);
  const out: QaBlock[] = [];
  for (let i = 0; i < windows.length; i += 1) {
    const w = windows[i];
    try {
      const blocks = await llmParseQaWindow({
        textWindow: w,
        sourceType: params.sourceType,
        subject: params.subject,
        form: params.form,
      });
      out.push(...blocks);
    } catch (e) {
      console.warn("[ingest:past-paper-qa] window parse failed", {
        sourceType: params.sourceType,
        index: i + 1,
        total: windows.length,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
}

function mergeQaBlocks(questionBlocks: QaBlock[], answerBlocks: QaBlock[]): MergedBlock[] {
  const map = new Map<string, MergedBlock>();
  const upsert = (ref: string): MergedBlock => {
    const ex = map.get(ref);
    if (ex) return ex;
    const created: MergedBlock = { questionRef: ref, questionText: "", answerText: "", keywords: [] };
    map.set(ref, created);
    return created;
  };

  for (const q of questionBlocks) {
    const m = upsert(q.questionRef);
    m.questionText = m.questionText ? `${m.questionText}\n\n${q.text}` : q.text;
    if (!m.conceptTitle && q.conceptTitle) m.conceptTitle = q.conceptTitle;
    if (q.keywords) m.keywords.push(...q.keywords);
  }
  for (const a of answerBlocks) {
    const m = upsert(a.questionRef);
    m.answerText = m.answerText ? `${m.answerText}\n\n${a.text}` : a.text;
    if (!m.maxMarks && a.maxMarks) m.maxMarks = a.maxMarks;
    if (!m.conceptTitle && a.conceptTitle) m.conceptTitle = a.conceptTitle;
    if (a.keywords) m.keywords.push(...a.keywords);
  }

  const dedupe = (arr: string[]) => Array.from(new Set(arr.map((x) => x.trim()).filter(Boolean))).slice(0, 16);
  return Array.from(map.values())
    .map((m) => ({ ...m, keywords: dedupe(m.keywords) }))
    .filter((m) => m.questionText.length > 10 || m.answerText.length > 10)
    .sort((a, b) => a.questionRef.localeCompare(b.questionRef, undefined, { numeric: true }));
}

function renderChunkContent(row: MergedBlock): string {
  return [
    `Question Ref: ${row.questionRef}`,
    row.questionText ? `Question:\n${row.questionText}` : "Question:\n(not found)",
    row.answerText ? `Marking Scheme / Answer:\n${row.answerText}` : "Marking Scheme / Answer:\n(not found)",
  ].join("\n\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.qPdfPath || !args.aPdfPath || !args.subject || !args.form || !args.title) {
    console.error(
      "Usage: npm run ingest:past-paper-qa -- --qPdfPath <Q.pdf> --aPdfPath <A.pdf> --subject \"Biology\" --form \"Form 4\" --title \"...\" [--year 2025 --paperLabel \"Paper 2\" --paperId id]",
    );
    process.exit(1);
  }

  const qText = await extractPdfText(args.qPdfPath);
  const aText = await extractPdfText(args.aPdfPath);
  if (!qText.trim() || !aText.trim()) {
    throw new Error("Question or answer PDF extracted empty text. Use OCR for image-only PDFs.");
  }

  const qBlocks = await parseDocumentToBlocks({
    fullText: qText,
    sourceType: "question",
    subject: args.subject,
    form: args.form,
  });
  const aBlocks = await parseDocumentToBlocks({
    fullText: aText,
    sourceType: "answer",
    subject: args.subject,
    form: args.form,
  });
  const merged = mergeQaBlocks(qBlocks, aBlocks);
  if (merged.length === 0) throw new Error("No normalized Q/A blocks generated.");

  const { eq } = await import("drizzle-orm");
  const { ragDb, ragPastPaperChunksTable, ragPastPapersTable } = await import("../src/lib/ragDb");

  const paperId = args.paperId?.trim() || `pp-qa-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const inserted = await ragDb
    .insert(ragPastPapersTable)
    .values({
      paperId,
      subject: args.subject,
      form: args.form,
      year: args.year ?? null,
      paperLabel: args.paperLabel?.trim() || null,
      title: args.title,
      sourceName: `${args.qPdfPath.split(/[\\/]/).pop()} | ${args.aPdfPath.split(/[\\/]/).pop()}`,
    })
    .returning({ id: ragPastPapersTable.id });
  const pastPaperDbId = inserted[0]?.id;
  if (!pastPaperDbId) throw new Error("Failed to insert rag_past_papers");

  await ragDb.insert(ragPastPaperChunksTable).values(
    merged.map((m, idx) => ({
      pastPaperDbId,
      chunkId: `chunk-${idx + 1}`,
      chunkIndex: idx,
      questionRef: m.questionRef,
      conceptTitle: m.conceptTitle ?? `Question ${m.questionRef}`,
      conceptSummary: `SPM past paper block for ${m.questionRef}.`,
      keywords: m.keywords.join(", "),
      maxMarks: m.maxMarks ?? null,
      content: renderChunkContent(m),
    })),
  );

  const spot = await ragDb
    .select({
      chunkIndex: ragPastPaperChunksTable.chunkIndex,
      questionRef: ragPastPaperChunksTable.questionRef,
      maxMarks: ragPastPaperChunksTable.maxMarks,
      conceptTitle: ragPastPaperChunksTable.conceptTitle,
    })
    .from(ragPastPaperChunksTable)
    .where(eq(ragPastPaperChunksTable.pastPaperDbId, pastPaperDbId))
    .orderBy(ragPastPaperChunksTable.chunkIndex)
    .limit(args.topSpotCheck ?? 12);

  console.log(
    JSON.stringify(
      {
        paperId,
        pastPaperDbId,
        qBlocks: qBlocks.length,
        aBlocks: aBlocks.length,
        mergedBlocks: merged.length,
        spotCheck: spot,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("[ingest:past-paper-qa] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
