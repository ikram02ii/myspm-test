import type { EnglishSpeakingPart } from "../constants/englishSpeaking";
import type { PracticeSetQuestion } from "../services/mobilePracticeSets";

function normalizeNewlines(s: string): string {
  return (s ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function buildEnglishSpeakingQuery(params: {
  form: string;
  part: EnglishSpeakingPart;
  topicCategory: string;
  questionCount: number;
}): string {
  const form = params.form.trim();
  const topic = params.topicCategory.trim();
  const randomNote =
    topic.toLowerCase() === "random"
      ? "Pick varied, realistic SPM-style topics suitable for Malaysian students."
      : `Focus on the topic category: ${topic}.`;

  if (params.part === "part3") {
    const n = Math.max(2, Math.min(6, params.questionCount));
    return [
      `Generate ${n} SPM English Speaking Part 3 (Group Discussion) practice prompts for Malaysian ${form} students.`,
      randomNote,
      "Part 3 = examiner-led group discussion; each prompt should invite opinion, reasons, and interaction.",
      "Requirements:",
      "- Questions suitable for 30–60 seconds of speech each in a practice session.",
      "- Align with official SPM Part 3 discussion style from the syllabus PDF.",
      "- Do NOT use Part 2 cue-card format.",
      "Output format exactly:",
      "Soalan 1",
      "<discussion question>",
      "Sample answer:",
      "<2–3 short sentences a strong student might say>",
      "Soalan 2",
      "...",
    ].join("\n");
  }

  if (params.part === "part1") {
    const n = Math.max(3, Math.min(12, params.questionCount));
    return [
      `Generate ${n} SPM English Speaking Part 1 (Short Q&A) practice prompts for Malaysian ${form} students.`,
      randomNote,
      "Part 1 = short personal questions an examiner would ask in an oral interview.",
      "Requirements:",
      "- Use clear, natural Malaysian classroom English (not too formal).",
      "- Questions must be answerable in 15–30 seconds of speech each.",
      "- Do NOT include Part 2 cue-card format.",
      "Output format exactly:",
      "Soalan 1",
      "<interviewer question on its own line>",
      "Sample answer:",
      "<2–3 short sentences a strong student might say>",
      "Soalan 2",
      "...",
    ].join("\n");
  }

  return [
    "Generate 1 SPM English Speaking Part 2 (Individual Long Turn) cue card for Malaysian " +
      form +
      " students.",
    randomNote,
    "Part 2 = one cue card with a main topic and bullet prompts; student speaks 1–2 minutes.",
    "Requirements:",
    "- Include preparation time (1 minute) and speaking time (1–2 minutes) in the instructions.",
    "- Use bullet points starting with hyphen (-).",
    "- Do NOT include Part 1 short Q&A questions.",
    "Output format exactly:",
    "Soalan 1",
    "Topic: <short title>",
    "You should talk about:",
    "- <prompt 1>",
    "- <prompt 2>",
    "- <prompt 3>",
    "(add 2–4 more bullets if helpful)",
    "Instructions: Preparation time 1 minute. Speaking time 1–2 minutes.",
    "Sample outline:",
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

  if (blocks.length === 0) {
    const trimmed = text.trim();
    if (!trimmed) return [];
    return [
      {
        id: 1,
        sortOrder: 1,
        questionText: trimmed,
        questionType:
          part === "part1"
            ? "speaking_part1"
            : part === "part3"
              ? "speaking_part3"
              : "speaking_part2",
        difficulty: "mixed",
        options: [],
        correctAnswer: "",
        explanation: null,
        questionForGrade: trimmed,
      },
    ];
  }

  const questionType =
    part === "part1" ? "speaking_part1" : part === "part3" ? "speaking_part3" : "speaking_part2";

  return blocks.map((block, idx) => {
    const body = block.body;
    let questionText = body;
    let explanation: string | null = null;

    if (part === "part1" || part === "part3") {
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
    };
  });
}
