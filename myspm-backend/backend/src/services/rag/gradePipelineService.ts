import type { GradeSubmissionInput, MarkBreakdownItem, StudentIdea } from "./types";
import { cosineSimilarity, embedTexts } from "./embeddingsService";
import { getOrCreateRubric } from "./rubricService";

type QuestionType =
  | "state"
  | "name"
  | "list"
  | "explain"
  | "describe"
  | "define"
  | "identify"
  | "compare"
  | "calculate"
  | "discuss"
  | "process"
  | "diagram_label"
  | "graph_reading"
  | "general";

type PipelineResult = {
  score: number;
  feedback: string;
  modelAnswer?: string;
  matchedIdeas: string[];
  missingIdeas: string[];
  markBreakdown: MarkBreakdownItem[];
  strengths: string[];
  improvements: string[];
  model: string;
};

function isDiagramLabelQuestion(cleaned: string): boolean {
  const asksRoleOrFunction =
    /\b(?:role|function|purpose|importance|use|used for|adapt(?:ation|ed)?|why|how|effect|benefit|helps?)\b/.test(cleaned) ||
    /\b(?:peranan|fungsi|tujuan|kepentingan|kegunaan|untuk apa|adaptasi|mengapa|bagaimana|kesan|manfaat|membantu)\b/.test(cleaned);
  if (asksRoleOrFunction) return false;

  const enLabelVerb = /\b(?:name|identify|state|label)\b/;
  const enLabelNoun =
    /\b(?:part(?:s)?|structure(?:s)?|organ(?:s)?|tissue(?:s)?|component(?:s)?|apparatus|labelled|labeled|marked|figure|diagram)\b/;
  const enLetterRefs = /\b(?:labelled|labeled|marked)\s+(?:as\s+)?[A-Z](?:\s*(?:,|and|or|to)\s*[A-Z])*\b/;
  const enBasedOnDiagram = /\bbased\s+on\s+(?:the\s+)?(?:diagram|figure|rajah)\b/;
  const bmLabelVerb = /\b(?:namakan|nyatakan|kenal\s*pasti|labelkan)\b/;
  const bmLabelNoun = /\b(?:bahagian|struktur|organ|tisu|komponen|radas|berlabel|berdasarkan\s+rajah|rajah)\b/;
  const bmLetterRefs = /\bberlabel\s+[A-Z](?:\s*(?:,|dan|atau|hingga)\s*[A-Z])*\b/;
  if (enLabelVerb.test(cleaned) && enLabelNoun.test(cleaned)) return true;
  if (enLetterRefs.test(cleaned) && enLabelVerb.test(cleaned)) return true;
  if (enBasedOnDiagram.test(cleaned) && enLabelVerb.test(cleaned)) return true;
  if (bmLabelVerb.test(cleaned) && bmLabelNoun.test(cleaned)) return true;
  if (bmLetterRefs.test(cleaned) && bmLabelVerb.test(cleaned)) return true;
  return false;
}

function isGraphReadingQuestion(cleaned: string): boolean {
  const enGraphRef =
    /\b(?:from|based\s+on|using|refer(?:\s+to)?)\s+(?:the\s+)?graph\b/.test(cleaned) ||
    /\bthe\s+graph\s+(?:shows|above|below|in|illustrates)\b/.test(cleaned) ||
    /\b(?:gradient|slope)\s+of\s+(?:the\s+)?(?:graph|line|curve)\b/.test(cleaned) ||
    /\b(?:y[-\s]?intercept|x[-\s]?intercept|area\s+under\s+(?:the\s+)?(?:graph|curve)|turning\s+point)\b/.test(cleaned) ||
    /\b(?:read|determine|find|calculate|state)\s+(?:the\s+)?value\s+of\s+[a-z]\s+when\s+[a-z]\s*=/.test(cleaned);
  const bmGraphRef =
    /\b(?:daripada|berdasarkan)\s+graf\b/.test(cleaned) ||
    /\bgraf\s+(?:di\s+)?(?:atas|bawah|menunjukkan)\b/.test(cleaned) ||
    /\b(?:cerun|kecerunan)\s+(?:graf|garis|lengkung)\b/.test(cleaned) ||
    /\bpintasan[-\s]?[xy]\b/.test(cleaned) ||
    /\bluas\s+di\s+bawah\s+(?:graf|lengkung)\b/.test(cleaned);
  return enGraphRef || bmGraphRef;
}

function detectQuestionType(question: string): QuestionType {
  const cleaned = question
    .toLowerCase()
    .replace(/^\s*(?:\([a-z0-9]+\)|\d+\s*[.)])\s*/i, "")
    .trim();

  if (isDiagramLabelQuestion(cleaned)) return "diagram_label";
  if (isGraphReadingQuestion(cleaned)) return "graph_reading";

  const startsWith = (word: string): boolean =>
    cleaned.startsWith(`${word} `) || cleaned.startsWith(`${word}:`) || cleaned === word;
  if (startsWith("state") || startsWith("nyatakan")) return "state";
  if (startsWith("name") || startsWith("namakan")) return "name";
  if (startsWith("list") || startsWith("senaraikan")) return "list";
  if (startsWith("explain") || startsWith("terangkan") || startsWith("jelaskan")) return "explain";
  if (startsWith("describe") || startsWith("huraikan") || startsWith("perihalkan")) return "describe";
  if (startsWith("define") || startsWith("takrifkan") || startsWith("definisikan")) return "define";
  if (startsWith("identify") || startsWith("kenal pasti") || startsWith("kenalpasti")) return "identify";
  if (
    startsWith("compare") ||
    startsWith("bandingkan") ||
    startsWith("differentiate") ||
    startsWith("distinguish") ||
    startsWith("bezakan")
  ) {
    return "compare";
  }
  if (startsWith("calculate") || startsWith("hitung") || startsWith("kira")) return "calculate";
  if (startsWith("discuss") || startsWith("bincangkan")) return "discuss";
  if (
    /\b(sequence|process|pathway|stages? of|steps? of|how does .* (?:process|happen|occur))\b/i.test(cleaned) ||
    /\b(urutan|proses|tatacara|peringkat|langkah(?:-langkah)?)\b/i.test(cleaned)
  ) {
    return "process";
  }
  return "general";
}

function detectAnswerLanguage(text: string): "english" | "malay" | "mixed" {
  const cleaned = (text || "").toLowerCase().replace(/[^a-zA-Z\s]/g, " ");
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "english";
  const malayMarkers = new Set(["yang", "dan", "atau", "kerana", "supaya", "untuk", "dalam", "oleh", "ia"]);
  const englishMarkers = new Set(["the", "and", "or", "because", "to", "in", "by", "it"]);
  let bm = 0;
  let en = 0;
  for (const token of tokens) {
    if (malayMarkers.has(token)) bm += 1;
    else if (englishMarkers.has(token)) en += 1;
  }
  const total = bm + en;
  if (total === 0) return "english";
  const ratio = bm / total;
  if (ratio >= 0.7) return "malay";
  if (ratio <= 0.3) return "english";
  return "mixed";
}

function resolveQwenConfig(): { apiKey: string; baseUrl: string; model: string } {
  const apiKey = process.env["QWEN_GRADING_API_KEY"]?.trim() || process.env["QWEN_OCR_API_KEY"]?.trim();
  const baseUrl =
    process.env["QWEN_GRADING_BASE_URL"]?.trim().replace(/\/+$/, "") ||
    process.env["QWEN_OCR_BASE_URL"]?.trim().replace(/\/+$/, "");
  const model = process.env["QWEN_GRADING_MODEL"]?.trim() || "qwen-plus";
  if (!apiKey || !baseUrl) throw new Error("Qwen grading is not configured.");
  return { apiKey, baseUrl, model };
}

function messageContentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) =>
        item && typeof item === "object" && "text" in item && typeof (item as { text?: unknown }).text === "string"
          ? ((item as { text: string }).text ?? "")
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
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

async function qwenJson(system: string, user: string): Promise<any> {
  const config = resolveQwenConfig();
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.1,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const rawText = await response.text();
  let parsedResponse: any;
  try {
    parsedResponse = JSON.parse(rawText);
  } catch {
    throw new Error(rawText.slice(0, 500) || `Qwen call failed (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(parsedResponse?.error?.message || parsedResponse?.message || `Qwen call failed (${response.status})`);
  }
  const content = parsedResponse?.choices?.[0]?.message?.content;
  const raw = messageContentToString(content).trim();
  const jsonText = extractJson(raw);
  return JSON.parse(jsonText);
}

async function extractStudentIdeas(question: string, studentAnswer: string, language: string): Promise<StudentIdea[]> {
  const system = [
    "Extract concise ideas from a student's answer.",
    "Return JSON only: { \"ideas\": [{ \"idea\": string, \"hasCausalLink\": boolean }] }.",
  ].join("\n");
  const user = [
    `Question: ${question}`,
    `Student answer: ${studentAnswer}`,
    `Language: ${language}`,
    "Split into short markable ideas. hasCausalLink=true if this idea explicitly contains explanation linkage (because/so that/to/kerana/supaya/untuk etc).",
  ].join("\n\n");
  const parsed = await qwenJson(system, user);
  const ideas = Array.isArray(parsed?.ideas) ? parsed.ideas : [];
  return ideas
    .map((row: any) => ({
      idea: typeof row?.idea === "string" ? row.idea.trim() : "",
      hasCausalLink:
        typeof row?.hasCausalLink === "boolean"
          ? row.hasCausalLink
          : typeof row?.hasCausalLink === "string"
            ? /^(true|yes|1)$/i.test(row.hasCausalLink)
            : false,
    }))
    .filter((row: StudentIdea) => row.idea.length > 0);
}

async function verifyMatchWithLlm(params: {
  question: string;
  rubricIdea: string;
  studentIdea: string;
  similarity: number;
}): Promise<{ awarded: boolean; reason: string }> {
  const system = "Verify if a student idea matches a rubric idea at SPM level. Return JSON only.";
  const user = [
    "Return JSON: { \"awarded\": boolean, \"reason\": string }",
    `Question: ${params.question}`,
    `Rubric idea: ${params.rubricIdea}`,
    `Student idea candidate: ${params.studentIdea}`,
    `Embedding similarity: ${params.similarity.toFixed(3)}`,
    "Award true only if meaning matches clearly.",
  ].join("\n\n");
  const parsed = await qwenJson(system, user);
  const awarded =
    typeof parsed?.awarded === "boolean"
      ? parsed.awarded
      : typeof parsed?.awarded === "string"
        ? /^(true|yes|1)$/i.test(parsed.awarded)
        : false;
  const reason = typeof parsed?.reason === "string" ? parsed.reason.trim() : "";
  return { awarded, reason };
}

function fallbackFeedback(params: {
  score: number;
  maxScore: number;
  matchedIdeas: string[];
  missingIdeas: string[];
  language: "english" | "malay" | "mixed";
}): string {
  const lang = params.language === "malay" ? "malay" : "english";
  if (lang === "malay") {
    if (params.score >= params.maxScore) {
      return `Betul. Anda sudah merangkumi poin utama: ${params.matchedIdeas.slice(0, 3).join(", ")}.`;
    }
    if (params.score === 0) {
      return `Jawapan kurang tepat. Poin utama yang perlu ada: ${params.missingIdeas.slice(0, 2).join("; ")}.`;
    }
    return `Sebahagian betul: ${params.matchedIdeas.slice(0, 2).join(", ")}. Perlu tambah: ${params.missingIdeas.slice(0, 2).join("; ")}.`;
  }
  if (params.score >= params.maxScore) {
    return `Correct. You covered the key points: ${params.matchedIdeas.slice(0, 3).join(", ")}.`;
  }
  if (params.score === 0) {
    return `Your answer is too vague/incorrect. Key idea(s) needed: ${params.missingIdeas.slice(0, 2).join("; ")}.`;
  }
  return `Partly correct: ${params.matchedIdeas.slice(0, 2).join(", ")}. You still need: ${params.missingIdeas.slice(0, 2).join("; ")}.`;
}

function sanitizeFeedback(feedback: string): string {
  const cleaned = (feedback || "")
    .replace(/\[Low-?context-?warning\][^\n]*/gi, "")
    .replace(/\[TEXTBOOK CONTEXT\]/gi, "")
    .replace(/\[PAST PAPER MARK SCHEME\]/gi, "")
    .replace(/(^|\n)\s*model answer\s*[:\-].*?(?=\n|$)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.slice(0, 3).join(" ").trim();
}

function buildModelAnswer(awardedRows: MarkBreakdownItem[], missingRows: MarkBreakdownItem[]): string {
  const ideas = [...awardedRows.map((r) => r.idea), ...missingRows.map((r) => r.idea)];
  return ideas.slice(0, 6).join("; ");
}

export async function gradeWithPipelineV2(input: GradeSubmissionInput): Promise<PipelineResult> {
  const question = input.question.trim();
  const studentAnswer = input.studentAnswer.trim();
  const maxScoreRaw = typeof input.maxScore === "number" ? input.maxScore : Number.NaN;
  const maxScore = Number.isFinite(maxScoreRaw) ? Math.max(1, Math.floor(maxScoreRaw)) : 10;
  const subject = input.subject?.trim() || "General";
  const form = input.form?.trim() || "General";

  const questionType = detectQuestionType(question);
  const language = detectAnswerLanguage(studentAnswer);
  const rubric = await getOrCreateRubric({
    question,
    subject,
    form,
    maxScore,
    questionType,
  });

  const studentIdeas = await extractStudentIdeas(question, studentAnswer, language);
  const rubricIdeaTexts = rubric.ideas.map((idea) => idea.idea);
  const studentIdeaTexts = studentIdeas.map((idea) => idea.idea);
  const vectors = await embedTexts([...rubricIdeaTexts, ...studentIdeaTexts]);
  const rubricVectors = vectors.slice(0, rubricIdeaTexts.length);
  const studentVectors = vectors.slice(rubricIdeaTexts.length);

  const markBreakdown: MarkBreakdownItem[] = [];
  for (let i = 0; i < rubric.ideas.length; i += 1) {
    const rubricIdea = rubric.ideas[i];
    const rv = rubricVectors[i];
    let bestIdx = -1;
    let bestScore = -1;
    for (let j = 0; j < studentVectors.length; j += 1) {
      const sim = cosineSimilarity(rv, studentVectors[j]);
      if (sim > bestScore) {
        bestScore = sim;
        bestIdx = j;
      }
    }

    let awarded = false;
    let reason = "";
    let evidence = "";
    if (bestIdx >= 0) {
      evidence = studentIdeas[bestIdx]?.idea ?? "";
      if (bestScore >= 0.83) {
        awarded = true;
        reason = `High embedding similarity (${bestScore.toFixed(2)}) with student idea: ${evidence}`;
      } else if (bestScore <= 0.45) {
        awarded = false;
        reason = `Low embedding similarity (${bestScore.toFixed(2)}).`;
      } else {
        const verified = await verifyMatchWithLlm({
          question,
          rubricIdea: rubricIdea.idea,
          studentIdea: evidence,
          similarity: bestScore,
        });
        awarded = verified.awarded;
        reason = verified.reason || `LLM verifier: ${awarded ? "match" : "no match"} at similarity ${bestScore.toFixed(2)}.`;
      }
    } else {
      reason = "No student idea extracted that can be compared.";
    }

    markBreakdown.push({
      idea: rubricIdea.idea,
      awarded,
      marks: rubricIdea.marks,
      reason,
    });
  }

  const rawScore = markBreakdown.reduce((sum, row) => sum + (row.awarded ? row.marks : 0), 0);
  const score = Math.max(0, Math.min(maxScore, Math.round(rawScore)));
  const matchedRows = markBreakdown.filter((row) => row.awarded);
  const missingRows = markBreakdown.filter((row) => !row.awarded);
  const matchedIdeas = matchedRows.map((row) => row.idea);
  const missingIdeas = missingRows.map((row) => row.idea);
  const feedback = sanitizeFeedback(
    fallbackFeedback({
      score,
      maxScore,
      matchedIdeas,
      missingIdeas,
      language,
    }),
  );

  return {
    score,
    feedback,
    modelAnswer: buildModelAnswer(matchedRows, missingRows),
    matchedIdeas,
    missingIdeas,
    markBreakdown,
    strengths: matchedIdeas,
    improvements: score === maxScore ? [] : missingIdeas,
    model: `${resolveQwenConfig().model}-pipeline-v2`,
  };
}
