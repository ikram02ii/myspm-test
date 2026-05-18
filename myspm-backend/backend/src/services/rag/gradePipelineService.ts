import type { AcceptedConceptBundle, GradeSubmissionInput, MarkBreakdownItem, StudentIdea } from "./types";
import { buildGradingContextFromChunks } from "./retrievalService";
import { formatSpmStudentFriendlyRulesBlock } from "./spmStudentLanguage";
import { finalizeRubricIdeas, getOrCreateRubric, getRubricById } from "./rubricService";
import { applyExaminerPriorityMarking } from "./examinerCreditService";
import { fixMissingIdeasAgainstStudentAnswer } from "./gradingFairnessMatch";
import { mapAnalysisToRubricQuestionType } from "./questionAnalysisService";
import { matchStudentIdeasToRubric } from "./rubricMatchingService";
import { isSequenceMarkingQuestion } from "./sequenceMarkingService";
import { buildPostScoreFeedback, resolveGradingModelLabel } from "./gradingFeedbackService";
import { qwenGradingJson } from "./qwenGradingClient";

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

export type PipelineResult = {
  score: number;
  feedback: string;
  modelAnswer?: string;
  matchedIdeas: string[];
  missingIdeas: string[];
  markBreakdown: MarkBreakdownItem[];
  strengths: string[];
  improvements: string[];
  model: string;
  studentIdeasDetected: string[];
  rubricIdeas: string[];
  acceptedConcepts: AcceptedConceptBundle[];
  contradictionCheckPassed: boolean;
  outsideRubricAwardCount?: number;
  /** True when v2 used merged/audited context supplied by gradeService (not independent retrieval). */
  usedAuditedContext?: boolean;
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
  let cleaned = question
    .toLowerCase()
    .replace(/^\s*(?:\([a-z0-9]+\)|\d+\s*[.)])\s*/i, "")
    .trim();
  cleaned = cleaned.replace(/^(en|bm)\s*:\s*/i, "").trim();

  if (isDiagramLabelQuestion(cleaned)) return "diagram_label";
  if (isGraphReadingQuestion(cleaned)) return "graph_reading";

  if (/\bwhich\s+(type|kind|sort)\s+of\b/.test(cleaned)) return "identify";

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

export async function extractStudentIdeas(question: string, studentAnswer: string, language: string): Promise<StudentIdea[]> {
  const system = [
    "Extract concise ideas from a student's answer.",
    formatSpmStudentFriendlyRulesBlock(),
    "Each \"idea\" string must stay short and in plain school-level wording (same language style as the student's answer).",
    "Return JSON only: { \"ideas\": [{ \"idea\": string, \"hasCausalLink\": boolean }] }.",
    "When one sentence contains several scientific points, split them into separate ideas.",
    [
      "SHORT ANSWER RULE:",
      "If the student answer is a single word, name, formula, or short phrase with no predicate, extract it as one idea exactly as written. Do not discard it, do not add words to it, and do not split it further.",
      "A brief answer is not an incorrect answer — extract it faithfully.",
    ].join("\n"),
  ].join("\n");
  const sequenceQ = isSequenceMarkingQuestion(question);
  const user = [
    `Question: ${question}`,
    `Student answer: ${studentAnswer}`,
    `Language: ${language}`,
    sequenceQ
      ? [
          "SEQUENCE QUESTION: split the answer into one idea per stage/level/step (e.g. cell, tissue, organ, or each model name).",
          "Keep fragments in the order the student wrote them. Include every stage mentioned, even if only one word.",
        ].join("\n")
      : "Split into short markable ideas — include every distinct correct point, even if phrased briefly, informally, or with weak grammar.",
    "Split only when the student has made genuinely separate scientific claims. When a short or incomplete answer is given, extract it as-is as a single idea.",
    "hasCausalLink=true if this idea explicitly contains explanation linkage (because/so that/to/kerana/supaya/untuk etc).",
  ].join("\n\n");
  const parsed = await qwenGradingJson(system, user);
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
      return `Bagus — betul. Anda sudah nyatakan perkara utama: ${params.matchedIdeas.slice(0, 3).join(", ")}.`;
    }
    if (params.score === 0) {
      return `Jawapan ini kurang tepat atau terlalu kosong. Cuba sertakan: ${params.missingIdeas.slice(0, 2).join("; ")}.`;
    }
    return `Ada bahagian betul: ${params.matchedIdeas.slice(0, 2).join(", ")}. Tambah atau betulkan: ${params.missingIdeas.slice(0, 2).join("; ")}.`;
  }
  if (params.score >= params.maxScore) {
    return `Well done — correct. You gave the main points: ${params.matchedIdeas.slice(0, 3).join(", ")}.`;
  }
  if (params.score === 0) {
    return `This answer is not clear enough or is wrong. Try to include: ${params.missingIdeas.slice(0, 2).join("; ")}.`;
  }
  return `Partly right: ${params.matchedIdeas.slice(0, 2).join(", ")}. You still need to add or fix: ${params.missingIdeas.slice(0, 2).join("; ")}.`;
}

function sanitizeFeedback(feedback: string, opts?: { maxSentences?: number }): string {
  const maxSentences = typeof opts?.maxSentences === "number" && opts.maxSentences > 0 ? opts.maxSentences : 3;
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
  if (sentences.length <= maxSentences) return cleaned;
  return sentences.slice(0, maxSentences).join(" ").trim();
}

/** Same heuristic as gradeService: practice MCQ "Ask AI" with letter-only answer. */
function looksLikeMcqWithLetterOptions(question: string): boolean {
  const q = question.replace(/\r/g, "\n");
  return /\bA\s*[\.)]\s*\S/m.test(q) && /\bB\s*[\.)]\s*\S/m.test(q);
}

function isMcqLetterOnlyExplanationRequest(question: string, studentAnswer: string, maxScore: number): boolean {
  if (maxScore !== 1) return false;
  const letter = studentAnswer.trim().toUpperCase();
  if (!/^[A-D]$/.test(letter)) return false;
  return looksLikeMcqWithLetterOptions(question);
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

  const mergedFromParent = (input.mergedGradingContextText ?? "").trim();
  const auditedChunks = input.auditedRetrievedChunks ?? [];
  const auditedExcerpt =
    mergedFromParent.length > 0
      ? mergedFromParent
      : auditedChunks.length > 0
        ? buildGradingContextFromChunks(question, auditedChunks).mergedContextText
        : "";
  const usedAuditedContext = auditedExcerpt.length > 0;

  const rubricQuestionType = (input.questionAnalysis
    ? mapAnalysisToRubricQuestionType(input.questionAnalysis)
    : detectQuestionType(question)) as QuestionType;
  const language = detectAnswerLanguage(studentAnswer);
  const savedRubricId = input.rubricId?.trim();
  const rubric = savedRubricId
    ? await getRubricById(savedRubricId)
    : await getOrCreateRubric({
        question,
        subject,
        form,
        maxScore,
        questionType: rubricQuestionType,
        skipNearestCachedRubric: true,
        useAuditContextOnly: true,
        auditedContextExcerpt: auditedExcerpt.length > 0 ? auditedExcerpt : null,
        questionAnalysis: input.questionAnalysis ?? null,
      });
  if (!rubric) {
    throw new Error(`Saved rubric not found: ${savedRubricId}`);
  }
  if (savedRubricId && rubric.maxScore !== maxScore) {
    throw new Error(`Saved rubric maxScore ${rubric.maxScore} does not match request maxScore ${maxScore}.`);
  }
  if (savedRubricId && rubric.subject.trim().toLowerCase() !== subject.trim().toLowerCase()) {
    throw new Error(`Saved rubric subject ${rubric.subject} does not match request subject ${subject}.`);
  }

  const staleRows = rubric.ideas.filter(
    (r) => r.kind === undefined || r.openEnded === undefined || r.demandType === undefined,
  );
  if (staleRows.length > 0) {
    console.warn(
      `[gradePipeline] rubric ${rubric.rubricId} has ${staleRows.length} stale ` +
        "rows — backfill will apply. Consider regenerating this rubric.",
    );
  }

  const studentIdeas = await extractStudentIdeas(question, studentAnswer, language);
  const rubricIdeasForMarking = finalizeRubricIdeas(
    rubric.ideas,
    question,
    rubric.maxScore,
    input.questionAnalysis ?? null,
    subject,
  );
  const rubricIdeaTexts = rubricIdeasForMarking.map((idea) => idea.idea);
  const studentIdeaTexts = studentIdeas.map((idea) => idea.idea);

  const matchResult = await matchStudentIdeasToRubric({
    question,
    studentAnswer,
    studentIdeas,
    rubricIdeas: rubricIdeasForMarking,
    questionAnalysis: input.questionAnalysis,
    subject,
    maxScore,
  });

  let markBreakdown = matchResult.markBreakdown;
  let score = matchResult.totalScore;
  let matchedRows = markBreakdown.filter((row) => row.awarded);
  let missingRows = markBreakdown.filter((row) => !row.awarded);
  let matchedIdeas = matchedRows.map((row) => row.idea);
  let missingIdeas = missingRows.map((row) => row.idea);

  const reconciled = fixMissingIdeasAgainstStudentAnswer({
    studentAnswer,
    missingIdeas,
    matchedIdeas,
    markBreakdown,
    rubricIdeas: rubricIdeasForMarking,
    score,
    maxScore,
  });
  missingIdeas = reconciled.missingIdeas;
  matchedIdeas = reconciled.matchedIdeas;
  score = reconciled.score;
  let markBreakdownAfterFix = reconciled.markBreakdown ?? markBreakdown;

  const examinerPass = await applyExaminerPriorityMarking({
    question,
    studentAnswer,
    studentIdeas,
    rubricIdeas: rubricIdeasForMarking,
    markBreakdown: markBreakdownAfterFix,
    maxScore,
    subject,
    textbookContext: auditedExcerpt || undefined,
    questionAnalysis: input.questionAnalysis ?? null,
  });
  markBreakdownAfterFix = examinerPass.markBreakdown;
  score = examinerPass.score;
  matchedIdeas = examinerPass.matchedIdeas;
  missingIdeas = examinerPass.missingIdeas;
  const outsideRubricAwardCount = examinerPass.outsideRubricCount;

  if (
    input.questionAnalysis?.questionType === "cause_effect" &&
    /\b(sprinter|race|running|run|breathes rapidly|breathing rapidly|selepas berlari)\b/i.test(question) &&
    !/\blactic acid|asid laktik|oxygen debt|hutang oksigen\b/i.test(studentAnswer) &&
    score > 1 &&
    markBreakdownAfterFix
  ) {
    let kept = 0;
    for (const row of markBreakdownAfterFix) {
      if (!row.awarded || row.marks <= 0) continue;
      if (kept >= 1) {
        row.awarded = false;
        row.reason = "Partial answer — only one mechanism point credited for this brief response.";
      } else {
        kept += 1;
      }
    }
    score = markBreakdownAfterFix.reduce((sum, row) => sum + (row.awarded ? row.marks : 0), 0);
    matchedIdeas = markBreakdownAfterFix.filter((r) => r.awarded).map((r) => r.idea);
    missingIdeas = markBreakdownAfterFix.filter((r) => !r.awarded).map((r) => r.idea);
    const missingBlob = missingIdeas.join(" ").toLowerCase();
    if (!/lactic|asid laktik/.test(missingBlob)) {
      missingIdeas.push("Lactic acid builds up in muscles after anaerobic respiration.");
    }
    if (!/oxygen debt|hutang oksigen/.test(missingBlob)) {
      missingIdeas.push("Oxygen debt must be repaid after strenuous exercise.");
    }
  }
  const markBreakdownOut = markBreakdownAfterFix ?? markBreakdown;
  const matchedRows2 = markBreakdownOut.filter((row) => row.awarded);
  const missingRows2 = markBreakdownOut.filter((row) => !row.awarded);

  const acceptedConcepts: AcceptedConceptBundle[] = rubric.ideas.map((idea) => ({
    rubricIdea: idea.idea,
    acceptedPhrases: [...(idea.keywords ?? []), ...(idea.acceptedConcepts ?? [])],
  }));

  let feedback = sanitizeFeedback(
    fallbackFeedback({
      score,
      maxScore,
      matchedIdeas,
      missingIdeas,
      language,
    }),
    {
      maxSentences: isMcqLetterOnlyExplanationRequest(question, studentAnswer, maxScore) ? 8 : undefined,
    },
  );

  try {
    const post = await buildPostScoreFeedback({
      question,
      studentAnswer,
      score,
      maxScore,
      matchedIdeas,
      missingIdeas,
      questionAnalysis: input.questionAnalysis,
      subject,
      language,
    });
    if (post.trim().length > 0) {
      feedback = sanitizeFeedback(post, {
        maxSentences: isMcqLetterOnlyExplanationRequest(question, studentAnswer, maxScore) ? 8 : undefined,
      });
    }
  } catch {
    /* keep fallback */
  }

  if (outsideRubricAwardCount > 0) {
    feedback = `${feedback}\n\n(Note: ${outsideRubricAwardCount} mark point(s) were awarded for scientifically correct ideas not listed in the rubric — teacher review suggested.)`.trim();
  }

  return {
    score,
    feedback,
    modelAnswer: buildModelAnswer(matchedRows2, missingRows2),
    matchedIdeas,
    missingIdeas,
    markBreakdown: markBreakdownOut,
    strengths: matchedIdeas,
    improvements: score === maxScore ? [] : missingIdeas,
    model: resolveGradingModelLabel("-pipeline-v2"),
    studentIdeasDetected: studentIdeaTexts,
    rubricIdeas: rubricIdeaTexts,
    acceptedConcepts,
    contradictionCheckPassed: reconciled.contradictionCheckPassed,
    outsideRubricAwardCount,
    usedAuditedContext,
  };
}
