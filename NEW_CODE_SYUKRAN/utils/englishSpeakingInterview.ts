import type { PracticeSetQuestion } from "../services/mobilePracticeSets";
import {
  SPEAKING_PART1_QUESTIONS_PER_SESSION,
} from "../constants/englishSpeakingExam";
import {
  formatSpeakingGradeSummary,
  type SpeakingGradeResponse,
} from "../services/mobileSpeaking";

export type Part1InterviewTurn = {
  questionId: number;
  questionText: string;
  transcript: string;
  grade: SpeakingGradeResponse | null;
  error?: string;
};

export type Part1InterviewBlock = {
  startIndex: number;
  endIndex: number;
  questions: PracticeSetQuestion[];
};

export type Part1InterviewSessionResult = {
  turns: Part1InterviewTurn[];
  totalScore: number;
  totalMax: number;
  skipToIndex: number;
};

/** Collect consecutive speaking_part1 items containing `currentIndex`. */
export function getPart1InterviewBlock(
  questions: PracticeSetQuestion[],
  currentIndex: number,
): Part1InterviewBlock | null {
  const current = questions[currentIndex];
  if (!current || (current.questionType ?? "").toLowerCase() !== "speaking_part1") {
    return null;
  }

  let startIndex = currentIndex;
  while (startIndex > 0) {
    const prev = questions[startIndex - 1];
    if ((prev.questionType ?? "").toLowerCase() !== "speaking_part1") break;
    startIndex--;
  }

  const block: PracticeSetQuestion[] = [];
  let fullBlockEndIndex = startIndex;
  for (let i = startIndex; i < questions.length; i++) {
    const next = questions[i];
    if ((next.questionType ?? "").toLowerCase() !== "speaking_part1") break;
    block.push(next);
    fullBlockEndIndex = i;
  }

  const interviewQuestions = block.slice(0, SPEAKING_PART1_QUESTIONS_PER_SESSION);

  return {
    startIndex,
    /** Last index of the entire consecutive Part 1 block (used for skip + follower UI). */
    endIndex: fullBlockEndIndex,
    questions: interviewQuestions,
  };
}

export function isPart1InterviewActiveAt(
  questions: PracticeSetQuestion[],
  index: number,
): boolean {
  const block = getPart1InterviewBlock(questions, index);
  return block != null && block.startIndex === index;
}

export function buildPart1InterviewSessionSummary(turns: Part1InterviewTurn[]): {
  transcript: string;
  markingText: string;
  totalScore: number;
  totalMax: number;
  averageScore: number;
} {
  let totalScore = 0;
  let totalMax = 0;
  let gradedCount = 0;

  const transcriptParts: string[] = [];
  const markingParts: string[] = [];

  turns.forEach((turn, idx) => {
    transcriptParts.push(
      `Question ${idx + 1}: ${turn.questionText.trim()}`,
      `Your answer: ${turn.transcript.trim() || "(no speech detected)"}`,
    );
    if (turn.grade) {
      totalScore += turn.grade.score;
      totalMax += turn.grade.maxScore;
      gradedCount += 1;
      markingParts.push(
        `--- Question ${idx + 1} (${turn.grade.score}/${turn.grade.maxScore}) ---`,
        formatSpeakingGradeSummary(turn.grade),
      );
    } else if (turn.error) {
      markingParts.push(`--- Question ${idx + 1} ---`, turn.error);
    }
  });

  const averageScore =
    gradedCount > 0 ? Math.round((totalScore / gradedCount) * 10) / 10 : 0;

  if (gradedCount > 0) {
    markingParts.push("", `Overall (average): ${averageScore}/10`);
  }

  return {
    transcript: transcriptParts.join("\n\n"),
    markingText: markingParts.join("\n\n"),
    totalScore,
    totalMax,
    averageScore,
  };
}
