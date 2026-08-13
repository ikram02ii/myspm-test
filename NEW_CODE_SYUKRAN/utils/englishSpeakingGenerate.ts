/**
 * Build LLM queries for SPM English speaking practice (Part 1 / Part 2 only).
 * Fixed structure: Part 1 = 5 questions, Part 2 = 1 long task. No Part 3.
 */

import type { EnglishSpeakingPart } from "../constants/englishSpeaking";
import { SPEAKING_PART1_QUESTIONS_PER_SESSION } from "../constants/englishSpeakingExam";
import type { PracticeSetQuestion } from "../services/mobilePracticeSets";

function normalizeNewlines(s: string): string {
  return (s ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function newVariationSeed(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/** Light angle hints so each Part 1 run steers away from the last common set. */
const PART1_ANGLE_HINTS = [
  "after-school routines",
  "weekend habits",
  "friends and family time",
  "favourite school subjects",
  "sports or outdoor activities",
  "food and eating habits",
  "reading or watching shows",
  "helping at home",
  "using phones / the internet carefully",
  "plans for the near future",
  "a memorable school event",
  "travelling within Malaysia",
  "healthy living",
  "hobbies you enjoy alone",
  "group projects at school",
] as const;

function pickPart1AngleHints(count = 3): string[] {
  const pool = [...PART1_ANGLE_HINTS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, count);
}

const SPM_SPEAKING_QUALITY_RULES = [
  "QUALITY (mandatory — official SPM English Speaking Test standard):",
  "- Target Malaysian Form 4/5 students (ages 16–17), CEFR B1–B2.",
  "- Sound like an SPM oral examiner: warm, clear, natural spoken English.",
  "- Avoid childish yes/no-only prompts AND avoid long IELTS-style academic questions.",
  "- Encourage short personal answers with a reason or example (about 20–40 seconds).",
  "- Age-appropriate Malaysian school life topics only.",
  "- Every generation MUST be freshly worded — never recycle the same set.",
].join("\n");

export function buildEnglishSpeakingQuery(params: {
  form: string;
  part: EnglishSpeakingPart;
  topicCategory: string;
}): string {
  const form = params.form.trim();
  const topic = params.topicCategory.trim() || "Random";
  const seed = newVariationSeed();
  const isRandom = topic.toLowerCase() === "random";
  const topicRule = isRandom
    ? "Vary topics across realistic SPM Part 1 themes for Malaysian teens (school, hobbies, family, friends, food, sports, free time, technology, health, future plans)."
    : `Focus on the topic category: ${topic}. Every question MUST clearly fit "${topic}".`;

  if (params.part === "part1") {
    const n = SPEAKING_PART1_QUESTIONS_PER_SESSION;
    const angles = pickPart1AngleHints(4).join("; ");
    return [
      `Generate exactly ${n} ORIGINAL SPM English Speaking Part 1 interview questions for Malaysian ${form} students.`,
      topicRule,
      `Unique run ID (must change the wording vs any other run): ${seed}`,
      `This run MUST cover these angle hints (one question per hint where possible; do not list them as titles): ${angles}`,
      SPM_SPEAKING_QUALITY_RULES,
      "",
      "What real SPM Part 1 sounds like:",
      "- Short personal interview questions asked one by one by the examiner.",
      "- Simple, conversational, and easy to understand when heard aloud.",
      "- Everyday Malaysian teen life — but choose DIFFERENT everyday angles each Unique run ID.",
      "- Mix openers across the set (do not reuse the same opener five times).",
      "",
      "BANNED stock questions (never output these or near-paraphrases):",
      "- Tell me about your school.",
      "- What do you usually do after school?",
      "- Do you prefer studying alone or with friends? Why?",
      "- What is your favourite subject, and why do you like it?",
      "- Tell me about a festival or celebration you enjoy.",
      "- What are your hobbies?",
      "- Tell me about your family.",
      "",
      "AVOID:",
      "- Long multi-clause questions with dashes or brand lists (e.g. 'like Google Classroom or Zoom').",
      "- Abstract / university / IELTS discussion prompts.",
      "- Childish one-word questions with no room to explain.",
      "- Repeating the same stem shape five times.",
      "- Recycling the same five questions whenever the topic is School Life or Random.",
      "",
      "Requirements:",
      `- Exactly ${n} questions — no more, no fewer.`,
      "- Each question: one or two short sentences max; invite ~20–40 seconds of speech.",
      "- Mix question shapes across the set.",
      "- Require a reason, preference, or brief personal example — not yes/no only.",
      "- Do NOT use Part 2 cue-card format.",
      "- All five questions must be clearly different from each other AND from the banned list.",
      `- Mentally tag this set with Unique run ID ${seed} — change concrete details (activity, place, person, habit) so another run would not match.`,
      "",
      "Output format exactly:",
      "Soalan 1",
      "<one short examiner question on its own line>",
      "Sample answer:",
      "<3–5 short sentences a strong SPM student might say aloud>",
      "Soalan 2",
      "...",
    ].join("\n");
  }

  return [
    `Generate exactly 1 ORIGINAL SPM English Speaking Part 2 (Individual Long Turn) cue card for Malaysian ${form} students.`,
    topicRule,
    `Unique run ID (must change the wording vs any other run): ${seed}`,
    SPM_SPEAKING_QUALITY_RULES,
    "Part 2 = one cue card; student speaks for about 1.5–2 minutes after 1 minute preparation.",
    "Requirements:",
    "- Exactly one task — must NOT be answerable in only a few sentences.",
    "- Student must describe, explain, compare, justify opinions, give reasons, and examples.",
    "- Include preparation time (1 minute) and speaking time (1.5–2 minutes) in the instructions.",
    "- Use bullet points starting with hyphen (-).",
    "- Do NOT include Part 1 short Q&A questions.",
    "- Create a fresh topic and prompts for this Unique run ID.",
    "Output format exactly:",
    "Soalan 1",
    "Topic: <short title>",
    "You should talk about:",
    "- <prompt 1>",
    "- <prompt 2>",
    "- <prompt 3>",
    "- <prompt 4>",
    "- <prompt 5>",
    "Instructions: Preparation time 1 minute. Speaking time 1.5–2 minutes.",
    "Sample outline:",
    "- <brief sample point>",
    "- <brief sample point>",
    "- <brief sample point>",
  ].join("\n");
}

export type SpeakingPart2CueCard = {
  bookletCode: string;
  mainQuestion: string;
  bullets: string[];
};

/** Turn stored Part 2 question text into cue-card fields for the UI. */
export function parseSpeakingPart2CueCard(questionText: string, sortOrder = 1): SpeakingPart2CueCard {
  const raw = normalizeNewlines(questionText).trim();
  const bookletCode = `TC${Math.max(1, Math.floor(sortOrder))}`;

  if (!raw) {
    return { bookletCode, mainQuestion: "Talk about the topic on the cue card.", bullets: [] };
  }

  let working = raw;
  const topicMatch = working.match(/(?:^|\n)\s*Topic\s*:\s*(.+?)(?=\n|You should talk|$)/i);
  const topicTitle = topicMatch?.[1]?.trim();

  const talkAboutIdx = working.search(/you\s+should\s+talk\s+about\s*:?/i);
  if (talkAboutIdx >= 0) {
    working = working.slice(talkAboutIdx);
  }

  const instructionsIdx = working.search(/\n\s*instructions\s*:/i);
  const sampleIdx = working.search(/\n\s*sample\s+outline\s*:/i);
  let cueBody = working;
  const cutIdx = [instructionsIdx, sampleIdx].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (cutIdx !== undefined && cutIdx >= 0) {
    cueBody = working.slice(0, cutIdx);
  }

  const lines = cueBody
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const bullets: string[] = [];
  let mainQuestion = "";

  for (const line of lines) {
    const bullet = line.replace(/^[-•*e]\s+/i, "").trim();
    if (/^you\s+should\s+talk\s+about/i.test(line)) continue;
    if (/^[-•*]/.test(line) || /^e\s+/i.test(line)) {
      if (bullet.length > 0) bullets.push(bullet);
      continue;
    }
    if (/^talk\s+about/i.test(line)) {
      mainQuestion = bullet || line;
      continue;
    }
    if (!mainQuestion && line.length > 8 && !/^topic\s*:/i.test(line)) {
      mainQuestion = line.replace(/^topic\s*:\s*/i, "").trim();
    }
  }

  if (!mainQuestion && topicTitle) {
    mainQuestion = `Talk about ${topicTitle}.`;
  }
  if (!mainQuestion) {
    const talkLine = raw.match(/talk\s+about[^.\n]+[.\n]?/i)?.[0]?.trim();
    mainQuestion = talkLine || raw.split(/\n/)[0]?.trim() || "Talk about the topic below.";
  }

  if (bullets.length === 0) {
    const inlineBullets = raw.match(/(?:^|\s)-\s+([^-\n]+)/g);
    if (inlineBullets) {
      for (const b of inlineBullets) {
        const t = b.replace(/^[\s-]+/, "").trim();
        if (t.length > 2) bullets.push(t);
      }
    }
  }

  return {
    bookletCode,
    mainQuestion: mainQuestion.replace(/\s+/g, " ").trim(),
    bullets,
  };
}

/** Parse generator output into practice session items. */
export function parseEnglishSpeakingAnswer(
  answer: string,
  part: EnglishSpeakingPart,
): PracticeSetQuestion[] {
  const text = normalizeNewlines(answer);
  if (!text.trim()) return [];

  const blocks: Array<{ index: number; body: string }> = [];
  const re = /(?:Soalan|Question)\s+(\d+)\s*([\s\S]*?)(?=(?:Soalan|Question)\s+\d+\s*|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const index = Number(m[1]);
    const body = (m[2] ?? "").trim();
    if (body) blocks.push({ index, body });
  }

  const questionType = part === "part1" ? "speaking_part1" : "speaking_part2";
  const maxPart1 = SPEAKING_PART1_QUESTIONS_PER_SESSION;

  if (blocks.length === 0) {
    const trimmed = text.trim();
    if (!trimmed) return [];
    return [
      {
        id: 1,
        sortOrder: 1,
        questionText: trimmed,
        questionType,
        difficulty: "mixed",
        options: [],
        correctAnswer: "",
        explanation: null,
        questionForGrade: trimmed,
        maxMarks: part === "part1" ? 10 : undefined,
      },
    ];
  }

  const limited = part === "part1" ? blocks.slice(0, maxPart1) : blocks.slice(0, 1);

  return limited.map((block, idx) => {
    const body = block.body;
    let questionText = body;
    let explanation: string | null = null;

    if (part === "part1") {
      const sampleIdx = body.search(/\n\s*Sample answer\s*:/i);
      if (sampleIdx >= 0) {
        questionText = body.slice(0, sampleIdx).trim();
        explanation = body
          .slice(sampleIdx)
          .replace(/^\s*Sample answer\s*:\s*/i, "")
          .trim();
      } else {
        const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
        questionText = lines[0] ?? body;
        explanation = lines.slice(1).join("\n").trim() || null;
      }
    } else {
      questionText = body;
      const outlineIdx = body.search(/\n\s*Sample outline\s*:/i);
      if (outlineIdx >= 0) {
        questionText = body.slice(0, outlineIdx).trim();
        explanation = body.slice(outlineIdx).replace(/^\s*Sample outline\s*:\s*/i, "").trim();
      }
    }

    const storedText =
      part === "part2" ? questionText.trim() || body : questionText.replace(/\s+/g, " ").trim() || body;

    return {
      id: idx + 1,
      sortOrder: block.index,
      questionText: storedText,
      questionType,
      difficulty: "mixed",
      options: [],
      correctAnswer: "",
      explanation: explanation || null,
      questionForGrade: storedText.replace(/\s+/g, " ").trim() || storedText,
      maxMarks: part === "part1" ? 10 : undefined,
    };
  });
}
