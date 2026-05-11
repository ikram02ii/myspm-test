import { chatCompletion, generateImage } from "./llmProvider";
import { retrieveChunks } from "../rag/retrievalService";
import { enrichMathAnswerWithSvg } from "./mathSvg";

export type GenerateRagInput = {
  /** Natural language: topic + what to generate (BM/EN). */
  query: string;
  subject?: string | null;
  topK?: number;
  generateImage?: boolean;
  imagePrompt?: string | null;
};

export type GenerateRagResult = {
  answer: string;
  sources: Array<{
    documentId: number;
    chunkIndex: number;
    title: string | null;
    subject: string | null;
    sourceType: string;
    excerpt: string;
    distance: number;
  }>;
  /** Page PNGs from retrieved source PDFs (diagrams / layout). */
  sourcePageImages: Array<{
    documentId: number;
    title: string | null;
    pageNumber: number;
    url: string;
  }>;
  generatedImages: Array<{
    url: string;
    prompt: string;
  }>;
};

const SYSTEM_PROMPT_BASE = `You are an assistant for Malaysian SPM exam preparation.
Use ONLY the provided context excerpts when stating specific facts. If context is insufficient, say so in one short sentence.
{{LANGUAGE_RULE}}
Do not copy long passages verbatim from the context; paraphrase into original question stems.

When generating objective (A–D) questions, follow this EXACT layout for EVERY item (no extra sections, no preamble about "aras kognitif" unless the user explicitly asks):

Soalan 1
<soalan dalam satu atau dua ayat>
A. <pilihan>
B. <pilihan>
C. <pilihan>
D. <pilihan>

Jawapan: <satu huruf A/B/C/D sahaja>
Penjelasan: <satu ayat ringkas isi sahaja; jangan rujuk sumber>

Soalan 2
... (same pattern)

Strict bans (violation = wrong answer):
- No "Rujuk", "rujuk", "#1", "#2", "doc=", "chunk=", "[1]", "konteks", "bersumber", "eksplisit", "lihat #", "berdasarkan konteks di".
- No emojis (no ✅ etc.), no italics used only for meta-commentary, no footnotes, no "Jawapan betul" — use the exact label "Jawapan:" only.
- No invented exam paper numbers like "28." or "14." before the question unless the user pasted that number and asked you to keep it.
- No horizontal rules made of many dashes unless the user asked for separators; use a single blank line between soalan only.
- Do not explain your process or list command words you used; output questions and answers only.

When the user request is for subject **Math** (Mathematics), each soalan stem must be bilingual:
- Line 1: EN: <stem in English>
- Line 2: BM: <same meaning in Bahasa Melayu>
Then A–D (option text may stay in English only if clearer; do not duplicate four long bilingual blocks).`;

const LANGUAGE_RULE_DEFAULT =
  "Respond in the same language as the user's request (Bahasa Melayu or English) unless asked otherwise.";

const LANGUAGE_RULE_FORCE_BM =
  "For this subject, respond entirely in Bahasa Melayu (standard SPM). If the user's request is in English or mixed, still write the whole answer in BM only.";

function parseForceBmSubjects(): Set<string> {
  const raw = process.env.RAG_FORCE_BM_SUBJECTS?.trim();
  const parts = raw
    ? raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : ["sejarah"];
  return new Set(parts);
}

function isForceBmSubject(subject: string | null | undefined): boolean {
  const s = subject?.trim().toLowerCase();
  if (!s) return false;
  return parseForceBmSubjects().has(s);
}

function systemPromptForSubject(subject: string | null | undefined): string {
  const rule = isForceBmSubject(subject) ? LANGUAGE_RULE_FORCE_BM : LANGUAGE_RULE_DEFAULT;
  return SYSTEM_PROMPT_BASE.replace("{{LANGUAGE_RULE}}", rule);
}

function mathBilingualReminder(subject: string | null | undefined): string {
  if (subject?.trim() !== "Math") return "";
  return `

Subject is **Math**: use bilingual stems for every soalan (EN: then BM:), then options A–D, then Jawapan: and Penjelasan: as usual. Penjelasan should be in Bahasa Melayu when the rest is mixed EN/BM.
If the user requests a diagram, prefer returning a JSON field "rajah_spec" (deterministic shape spec) and optionally "rajah_svg". Supported rajah_spec kinds are:
- {"kind":"triangle","points":[{"x":0,"y":0,"label":"A"},{"x":4,"y":0,"label":"B"},{"x":1,"y":3,"label":"C"}],"title":"..."}
- {"kind":"cartesian_line","xMin":0,"xMax":10,"yMin":0,"yMax":20,"points":[{"x":0,"y":0,"label":"P"},{"x":5,"y":10,"label":"Q"}],"title":"..."}
`;
}

function shouldPostProcessMathSvg(subject: string | null | undefined): boolean {
  return subject?.trim() === "Math";
}

export async function generateWithRag(
  input: GenerateRagInput,
): Promise<GenerateRagResult> {
  const topK = input.topK ?? 8;
  const retrieval = await retrieveChunks({
    query: input.query,
    subject: input.subject ?? undefined,
    topK,
  });
  const hits = retrieval.chunks;

  if (hits.length === 0) {
    const answerRaw = await chatCompletion([
      { role: "system", content: systemPromptForSubject(input.subject) },
      {
        role: "user",
        content: `${input.query}\n\n(Note: No knowledge-base chunks were retrieved. Answer from general knowledge and clearly label uncertainty.)${mathBilingualReminder(input.subject)}`,
      },
    ], { subject: input.subject, query: input.query });
    const answer = shouldPostProcessMathSvg(input.subject)
      ? enrichMathAnswerWithSvg(answerRaw)
      : answerRaw;
    const generatedImages: GenerateRagResult["generatedImages"] = [];
    if (input.generateImage) {
      const prompt =
        input.imagePrompt?.trim() ||
        `Create a clean education-style diagram for this math question context: ${input.query}`;
      const urls = await generateImage(prompt);
      generatedImages.push(...urls.map((url) => ({ url, prompt })));
    }
    return { answer, sources: [], sourcePageImages: [], generatedImages };
  }

  const contextBlocks = hits.map((h, i) => {
    const n = i + 1;
    return `[${n}]\n${h.content}`;
  });

  const userContent = `Below are short excerpts from the syllabus/material (numbered for your use only; never show these numbers or any reference to them in your reply):\n\n${contextBlocks.join("\n\n---\n\n")}\n\nUser request:\n${input.query}\n\nFollow the Soalan / A–D / Jawapan: / Penjelasan: template from the system message.${mathBilingualReminder(input.subject)}`;

  const answerRaw = await chatCompletion([
    { role: "system", content: systemPromptForSubject(input.subject) },
    { role: "user", content: userContent },
  ], { subject: input.subject, query: input.query });
  const answer = shouldPostProcessMathSvg(input.subject)
    ? enrichMathAnswerWithSvg(answerRaw)
    : answerRaw;

  const sourcePageImages: GenerateRagResult["sourcePageImages"] = [];
  const generatedImages: GenerateRagResult["generatedImages"] = [];
  if (input.generateImage) {
    const prompt =
      input.imagePrompt?.trim() ||
      `Create a clean education-style diagram for this ${input.subject ?? "SPM"} question context: ${input.query}`;
    const urls = await generateImage(prompt);
    generatedImages.push(...urls.map((url) => ({ url, prompt })));
  }

  return {
    answer,
    sources: hits.map((h) => ({
      documentId: Number(h.textbookId) || 0,
      chunkIndex: h.chunkIndex,
      title: h.title ?? null,
      subject: h.subject ?? null,
      sourceType: h.sourceType,
      excerpt: h.content.slice(0, 400) + (h.content.length > 400 ? "…" : ""),
      distance: h.score ?? 0,
    })),
    sourcePageImages,
    generatedImages,
  };
}
