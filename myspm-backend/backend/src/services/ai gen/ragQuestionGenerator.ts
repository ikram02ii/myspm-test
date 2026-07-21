import { chatCompletion } from "./llmProvider";
import { formatGeneratorContextBlock, buildGenerationReminders } from "./generateFromRagEnhancements";
import {
  buildPastPaperMarksGuidance,
  isMcqGenerationQuery,
  isSubjectiveGenerationQuery,
} from "../rag/retrieval/pastPaperMarksHints";
import type { RetrievedChunk } from "../rag/types";

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
- No emojis, no footnotes, no "Jawapan betul" — use the exact label "Jawapan:" only.
- Do NOT decide diagram needs or write "Perlu rajah" — a separate diagram agent handles visuals later.
- Output questions and answers only.`;

const LANGUAGE_RULE_DEFAULT =
  "Respond in the same language as the user's request (Bahasa Melayu or English) unless asked otherwise.";

const LANGUAGE_RULE_FORCE_BM =
  "For this subject, respond entirely in Bahasa Melayu (standard SPM). If the user's request is in English or mixed, still write the whole answer in BM only.";

function parseForceBmSubjects(): Set<string> {
  const raw = process.env.RAG_FORCE_BM_SUBJECTS?.trim();
  const parts = raw
    ? raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : ["sejarah", "pendidikan islam", "pendidikan moral"];
  return new Set(parts);
}

function isForceBmSubject(subject: string | null | undefined): boolean {
  const s = subject?.trim().toLowerCase();
  if (!s) return false;
  return parseForceBmSubjects().has(s);
}

const BM_ONLY_SUBJECT_FORMAT_APPEND = `

BM-only subject rules (override any bilingual instruction above):
- Write every soalan stem, option, Jawapan, Penjelasan, Marking points, and model answer in Bahasa Melayu only.
- Do NOT use EN: or BM: prefixes. Do not include any English question stem.
- For MCQ: Soalan N → BM stem → A. B. C. D. → Jawapan: → Penjelasan:
- For subjective: Soalan N → BM stem → Markah: → Jawapan: → Marking points:`;

function systemPromptForSubject(subject: string | null | undefined): string {
  const rule = isForceBmSubject(subject) ? LANGUAGE_RULE_FORCE_BM : LANGUAGE_RULE_DEFAULT;
  const base = SYSTEM_PROMPT_BASE.replace("{{LANGUAGE_RULE}}", rule);
  return isForceBmSubject(subject) ? `${base}${BM_ONLY_SUBJECT_FORMAT_APPEND}` : base;
}

function isPhysicsSubject(subject: string | null | undefined): boolean {
  return /^physics$/i.test(subject?.trim() ?? "");
}

function isPhysicsGraphTopicQuery(query: string): boolean {
  return /\b(graph|motion|kinematics|velocity|speed|distance|time|gradient|slope)\b/i.test(query);
}

function graphJsonReminder(subject: string | null | undefined, query: string): string {
  if (!isPhysicsSubject(subject) || !isPhysicsGraphTopicQuery(query)) return "";
  return `

For Physics motion/graph questions, append after all Soalan blocks:
DIAGRAM_JSON_START
{"diagrams":[{"questionIndex":1,"type":"line-chart","title":"...","xAxisLabel":"x","yAxisLabel":"y","points":[{"x":0,"y":0},{"x":1,"y":2}]}]}
DIAGRAM_JSON_END`;
}

function mcqFormatReminder(query: string, subject?: string | null): string {
  if (!isMcqGenerationQuery(query)) return "";
  const mcqLine = isForceBmSubject(subject)
    ? "Soalan 1 → BM stem only (no EN:) → A. B. C. D. → Jawapan: <one letter> → Penjelasan:"
    : "Soalan 1 → EN: / BM: (two lines) → A. B. C. D. → Jawapan: <one letter> → Penjelasan:";
  return `

The user wants objective MCQ (A–D) ONLY. Use this pattern:
${mcqLine}
Do NOT use Markah:, Marking points:, or Perlu rajah lines.`;
}

function subjectiveGenerationReminder(query: string, hits: RetrievedChunk[], subject?: string | null): string {
  if (!isSubjectiveGenerationQuery(query)) return "";
  const marksGuide = buildPastPaperMarksGuidance(hits);
  return `

The user wants subjective questions. Use Markah: calibrated from past-paper excerpts.
${marksGuide ? `\n${marksGuide}\n` : ""}`;
}

/** When user did not pick a topic, spread questions across multiple syllabus chapters. */
function generalSyllabusSpreadReminder(query: string, hits: RetrievedChunk[]): string {
  if (/focused on(?:\s+topic)?:/i.test(query)) return "";
  const chapters = [...new Set(hits.map((h) => h.chapter?.trim()).filter(Boolean))];
  if (chapters.length < 2) return "";
  const preview = chapters.slice(0, 8).join("; ");
  return `

General syllabus mode: excerpts span ${chapters.length} different chapters (${preview}).
Write exactly one question per excerpt where possible — each Soalan must use a DIFFERENT excerpt/chapter as its main basis.
Do NOT write every Soalan from the same chapter or repeat the same concept (e.g. cell hierarchy, bar charts, voluntary action) across multiple questions.`;
}

export type RagQuestionGeneratorInput = {
  query: string;
  subject?: string | null;
  /** Validation failures from prior pipeline attempts — agent 1 regenerates with this feedback. */
  retryFeedback?: string[];
};

/** Agent 1 — generate question text grounded in RAG chunks (no diagram decisions). */
export async function generateQuestionFromRagContext(
  hits: RetrievedChunk[],
  input: RagQuestionGeneratorInput,
): Promise<string> {
  const contextBlocks = hits.map((h, i) => formatGeneratorContextBlock(h, i + 1));
  const retryBlock =
    input.retryFeedback && input.retryFeedback.length > 0
      ? `\n\nPrior attempts failed quality validation. Fix these issues and generate NEW questions:\n${input.retryFeedback.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n`
      : "";

  const userContent = `Below are short excerpts from the syllabus/material (numbered for your use only; never show these numbers or any reference to them in your reply):

${contextBlocks.join("\n\n---\n\n")}

User request:
${input.query}
${retryBlock}
Follow the appropriate template from the system message (MCQ vs subjective).${graphJsonReminder(input.subject, input.query)}${mcqFormatReminder(input.query, input.subject)}${subjectiveGenerationReminder(input.query, hits, input.subject)}${generalSyllabusSpreadReminder(input.query, hits)}`;

  return chatCompletion(
    [
      { role: "system", content: systemPromptForSubject(input.subject) },
      { role: "user", content: userContent },
    ],
    { subject: input.subject, query: input.query },
  );
}
