import { mobileApiGet } from "./mobileApi";

export type PracticeSetSummary = {
  id: number;
  title: string;
  subject: string;
  formLevel: string;
  questionCount: number;
  difficultyLevel: string;
};

export type PracticeSetQuestion = {
  id: number;
  sortOrder: number;
  questionText: string;
  questionType: string;
  difficulty: string;
  options: string[];
  correctAnswer: string;
  explanation: string | null;
  /** When set (e.g. from API), used as /rag/grade maxScore for open-ended items. */
  maxMarks?: number;
  /** Saved backend rubric from AI Practice generation; reused for exact marking. */
  rubricId?: string;
  /** Optional model answer generated together with an AI Practice open-ended question. */
  modelAnswer?: string;
  /** Optional saved rubric points for debugging/display. */
  rubricIdeas?: Array<{ id: string; idea: string; marks: number; kind?: string }>;
  /** Optional: include full question text (e.g., with A-D options) for /api/rag/grade. */
  questionForGrade?: string;
};

/**
 * Read total marks from common SPM/BM phrasing in the stem, e.g. "(4 marks)", "[6 markah]".
 * Returns null if nothing reliable is found.
 */
export function inferQuestionMaxMarks(questionText: string): number | null {
  const t = (questionText || "").trim();
  if (!t) return null;
  const patterns: RegExp[] = [
    /\((\d{1,2})\s*marks?\)/i,
    /\((\d{1,2})\s*markah\)/i,
    /\[(\d{1,2})\s*marks?\]/i,
    /\[(\d{1,2})\s*markah\]/i,
    /\((\d{1,2})\s*m\)\s*$/im,
    /\b(\d{1,2})\s*marks?\b/i,
    /\b(\d{1,2})\s*markah\b/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 20) return n;
    }
  }
  return null;
}

const MARKS_AT_END_RE = /\(\s*(\d{1,2})\s*(?:marks?|markah)\s*\)\s*$/i;

export function stemAlreadyHasMarksAtEnd(questionText: string): boolean {
  return MARKS_AT_END_RE.test((questionText || "").trim());
}

/** Total marks for display and grading (API field, stem, or sensible default). */
export function resolveQuestionMarks(
  q: PracticeSetQuestion,
  questionForGrade?: string,
): number {
  if (typeof q.maxMarks === "number" && Number.isFinite(q.maxMarks)) {
    const n = Math.floor(q.maxMarks);
    if (n >= 1 && n <= 20) return n;
  }
  const inferred =
    inferQuestionMaxMarks(questionForGrade ?? q.questionText) ??
    inferQuestionMaxMarks(q.questionText);
  if (inferred !== null) return inferred;
  const isMcq =
    (q.options?.length ?? 0) > 0 ||
    /multiple_choice|mcq|choice/i.test(q.questionType ?? "");
  return isMcq ? 1 : 5;
}

/** Show SPM-style mark allocation at the end of the stem when missing. */
export function formatQuestionWithMarksAtEnd(questionText: string, marks: number): string {
  const stem = (questionText || "").trim();
  if (!stem) return "";
  if (stemAlreadyHasMarksAtEnd(stem)) return stem;
  const safe = Math.max(1, Math.min(20, Math.floor(marks)));
  return `${stem} (${safe} mark${safe === 1 ? "" : "s"})`;
}

function optionsArrayFromParsed(parsed: unknown): string[] | null {
  if (!Array.isArray(parsed)) return null;
  return parsed.map((x) => String(x).trim()).filter((s) => s.length > 0);
}

/** DB/text often stores JSON arrays with escaped quotes: `[\"3\", \"4\", \"5\", \"6\"]` or double-encoded strings. */
function parseOptionsFromString(input: string, depth = 0): string[] | null {
  if (depth > 6) return null;
  const t = input.trim();
  if (!t) return [];

  const candidates: string[] = [];
  const push = (s: string) => {
    if (!candidates.includes(s)) candidates.push(s);
  };
  push(t);
  push(t.replace(/\\"/g, '"'));
  if (t.startsWith('"') && t.endsWith('"')) {
    push(t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const arr = optionsArrayFromParsed(parsed);
      if (arr !== null) return arr;
      if (typeof parsed === "string") {
        const nested = parseOptionsFromString(parsed, depth + 1);
        if (nested !== null && nested.length > 0) return nested;
      }
    } catch {
      /* try next */
    }
  }

  const braced = (x: string) => x.trim().startsWith("[") && x.trim().endsWith("]");
  if (braced(t)) {
    for (const rawInner of [t, t.replace(/\\"/g, '"')]) {
      const inner = rawInner.trim().slice(1, -1);
      const parts: string[] = [];
      const re = /"((?:[^"\\]|\\.)*)"/g;
      let m: RegExpExecArray | null;
      for (m = re.exec(inner); m !== null; m = re.exec(inner)) {
        parts.push(m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
      }
      if (parts.length > 0) {
        return parts.map((p) => p.trim()).filter(Boolean);
      }
    }
  }

  return null;
}

function normalizeQuestionOptions(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x).trim()).filter((s) => s.length > 0);
  }
  if (typeof raw === "string") {
    return parseOptionsFromString(raw) ?? [];
  }
  return [];
}

function coercePracticeQuestion(row: unknown): PracticeSetQuestion {
  const r = row as Record<string, unknown>;
  const optSource =
    r.options ??
    r.questionOptions ??
    r["question_options"] ??
    r["questionOptions"];

  const options = normalizeQuestionOptions(optSource);

  const rawMarks =
    r.maxMarks ?? r.marks ?? r.max_marks ?? r.question_marks ?? r["maxMarks"] ?? r["questionMarks"];
  let maxMarks: number | undefined;
  if (typeof rawMarks === "number" && Number.isFinite(rawMarks)) {
    const n = Math.floor(rawMarks);
    if (n >= 1 && n <= 20) maxMarks = n;
  } else if (typeof rawMarks === "string" && rawMarks.trim()) {
    const n = Math.floor(Number(rawMarks.trim()));
    if (n >= 1 && n <= 20) maxMarks = n;
  }

  return {
    id: Number(r.id ?? r.question_id ?? 0),
    sortOrder: Number(r.sortOrder ?? r.sort_order ?? 0),
    questionText: String(r.questionText ?? r.question_text ?? ""),
    questionType: String(r.questionType ?? r.question_type ?? ""),
    difficulty: String(r.difficulty ?? ""),
    options,
    correctAnswer: String(r.correctAnswer ?? r.correct_answer ?? ""),
    explanation:
      r.explanation === undefined || r.explanation === null
        ? null
        : String(r.explanation),
    ...(maxMarks !== undefined ? { maxMarks } : {}),
  };
}

type ListResponse = {
  data?: {
    sets: Array<
      Omit<PracticeSetSummary, "difficultyLevel"> & {
        difficultyLevel?: string | null;
      }
    >;
  };
  error?: string;
};

type DetailResponse = {
  data?: {
    set: {
      id: number;
      title: string;
      subject: string;
      formLevel: string;
      questionCount: number;
    };
    questions: PracticeSetQuestion[];
  };
  error?: string;
};

export async function fetchPracticeSetList(): Promise<PracticeSetSummary[]> {
  const res = await mobileApiGet<ListResponse>("/practice-sets");
  const sets = res.data?.sets;
  if (!sets) {
    throw new Error("Invalid practice sets response");
  }
  return sets.map((set) => ({
    ...set,
    difficultyLevel: (set.difficultyLevel ?? "mixed").toString(),
  }));
}

export async function fetchPracticeSetDetail(setId: number): Promise<{
  set: {
    id: number;
    title: string;
    subject: string;
    formLevel: string;
    questionCount: number;
  };
  questions: PracticeSetQuestion[];
}> {
  const res = await mobileApiGet<DetailResponse>(`/practice-sets/${setId}`);
  const data = res.data;
  if (!data?.set || !Array.isArray(data.questions)) {
    throw new Error("Invalid practice set detail response");
  }
  const questions: PracticeSetQuestion[] = data.questions.map((row) => coercePracticeQuestion(row));
  return { set: data.set, questions };
}
