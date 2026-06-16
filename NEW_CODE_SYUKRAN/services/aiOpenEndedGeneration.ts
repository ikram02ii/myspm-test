import { ragApiPost } from "./ragApi";
import type { PracticeSetQuestion } from "./mobilePracticeSets";

export type OpenEndedStepApiQuestion = {
  id?: number;
  sortOrder?: number;
  questionText?: string;
  questionType?: string;
  difficulty?: string;
  explanation?: string | null;
  maxMarks?: number;
  questionForGrade?: string;
  rubricId?: string;
  modelAnswer?: string;
  rubricIdeas?: PracticeSetQuestion["rubricIdeas"];
};

export type OpenEndedStepResponse = {
  question: OpenEndedStepApiQuestion | null;
  generationContextId: string;
  questionIndex: number;
  totalQuestions: number;
};

export type OpenEndedGenerationRequest = {
  query: string;
  subject: string;
  form: string;
  topK?: number;
  chapterHint?: string;
  chapterFilter?: string;
};

export type OpenEndedBackgroundJob = OpenEndedGenerationRequest & {
  generationContextId: string;
  totalQuestions: number;
  nextQuestionIndex: number;
  priorStems: string[];
};

export function mapOpenEndedStepToPracticeQuestion(
  item: OpenEndedStepApiQuestion,
  sortOrder: number,
): PracticeSetQuestion {
  return {
    id: typeof item.id === "number" ? item.id : sortOrder,
    sortOrder: typeof item.sortOrder === "number" ? item.sortOrder : sortOrder,
    questionText: typeof item.questionText === "string" ? item.questionText : "",
    questionType: typeof item.questionType === "string" ? item.questionType : "short_answer",
    difficulty: typeof item.difficulty === "string" ? item.difficulty : "mixed",
    options: [],
    correctAnswer: "",
    explanation: typeof item.explanation === "string" ? item.explanation : null,
    maxMarks: typeof item.maxMarks === "number" ? item.maxMarks : undefined,
    questionForGrade: typeof item.questionForGrade === "string" ? item.questionForGrade : undefined,
    rubricId: typeof item.rubricId === "string" ? item.rubricId : undefined,
    modelAnswer: typeof item.modelAnswer === "string" ? item.modelAnswer : undefined,
    rubricIdeas: Array.isArray(item.rubricIdeas) ? item.rubricIdeas : undefined,
  };
}

export async function fetchOpenEndedQuestionStep(params: {
  request: OpenEndedGenerationRequest;
  questionIndex: number;
  totalQuestions: number;
  priorStems: string[];
  generationContextId?: string;
}): Promise<OpenEndedStepResponse> {
  return ragApiPost<OpenEndedStepResponse>("/rag/generate-open-ended-step", {
    ...params.request,
    questionIndex: params.questionIndex,
    totalQuestions: params.totalQuestions,
    priorStems: params.priorStems,
    generationContextId: params.generationContextId,
  });
}
