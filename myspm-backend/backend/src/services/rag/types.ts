export type ChunkConfig = {
  chunkSizeChars: number;
  overlapChars: number;
};

export type RegisterTextbookInput = {
  subject: string;
  form: string;
  title: string;
  sourceName?: string;
  text: string;
  chunkConfig?: Partial<ChunkConfig>;
  createdByUserId?: number | null;
};

export type TextbookListItem = {
  textbookId: string;
  subject: string;
  form: string;
  title: string;
  sourceName?: string;
  uploadedAt: string;
  chunkCount: number;
};

export type RetrieveChunksInput = {
  query: string;
  subject?: string;
  form?: string;
  topK?: number;
};

export type RetrievedChunkSource = "textbook" | "past_paper";

export type RetrievedChunk = {
  score: number;
  /** Logical source category. Used to render context labels for the grader. */
  sourceType: RetrievedChunkSource;
  /** Stable id of the parent record. For textbook chunks this is `textbook_id`; for past papers this is `paper_id`. */
  textbookId: string;
  subject: string;
  form: string;
  title: string;
  chunkId: string;
  chunkIndex: number;
  content: string;
  conceptTitle?: string;
  conceptSummary?: string;
  keywords?: string[];
  chapter?: string;
  pageStart?: number;
  pageEnd?: number;
  /** From past-paper ingest when available. */
  maxMarks?: number;
  questionRef?: string;
};

export type RetrieveChunksResult = {
  query: string;
  count: number;
  chunks: RetrievedChunk[];
};

export type GradingContextBlock = {
  label: string;
  /** "[TEXTBOOK CONTEXT]" or "[PAST PAPER MARK SCHEME]" — used for the LLM-facing labelled prompt. */
  contextTag: string;
  sourceType: RetrievedChunkSource;
  content: string;
  score: number;
  source: {
    textbookId: string;
    subject: string;
    form: string;
    title: string;
    chunkId: string;
    chunkIndex: number;
  };
};

export type GradingContextPayload = {
  query: string;
  contextBlocks: GradingContextBlock[];
  mergedContextText: string;
};

export type ContextAuditResult = {
  relevanceScore: number;
  isSufficientContext: boolean;
  relevantChunkIds: string[];
  irrelevantChunkIds: string[];
  reason: string;
};

export type GradeSubmissionInput = {
  question: string;
  studentAnswer: string;
  subject?: string;
  form?: string;
  topK?: number;
  maxScore?: number;
  rubricVersion?: string;
  diagramImageUrl?: string;
  diagramImageBase64?: string;
  submissionId?: string;
  userId?: number | null;
};

export type MarkBreakdownItem = {
  idea: string;
  awarded: boolean;
  marks: number;
  reason: string;
};

export type RubricIdeaKind = "feature" | "function" | "point" | "step" | "comparison";

export type RubricIdea = {
  id: string;
  idea: string;
  marks: number;
  kind: RubricIdeaKind;
  /** For Explain/Describe: a "function" idea is linked to a "feature" idea so we can render pairs. */
  linkedToId?: string;
  /** Optional keyword hints used by the embedding/LLM matcher. */
  keywords?: string[];
};

export type RubricSource = "past_paper" | "llm_generated" | "manual";

export type Rubric = {
  rubricId: string;
  questionHash: string;
  subject: string;
  form: string;
  questionText: string;
  questionType: string;
  maxScore: number;
  ideas: RubricIdea[];
  embedding?: number[];
  source: RubricSource;
  sourceRef?: string;
};

export type StudentIdea = {
  idea: string;
  hasCausalLink: boolean;
};

export type IdeaMatch = {
  rubricIdeaId: string;
  awarded: boolean;
  evidence: string;
  reason: string;
};

export type DiagramType =
  | "biology_organ"
  | "biology_process"
  | "physics_circuit"
  | "physics_ray"
  | "physics_mechanics"
  | "chemistry_apparatus"
  | "chemistry_reaction"
  | "graph"
  | "table"
  | "geometry"
  | "other";

export type DiagramLabel = {
  /** Letter or short id used in the figure (e.g. "P", "Q", "R", "X"). */
  id: string;
  /** What the label refers to in plain language (e.g. "phloem", "anode"). */
  refersTo: string;
  /** Vision-model confidence in this label, 0–1. */
  confidence: number;
};

export type DiagramAxis = {
  quantity: string;
  unit?: string;
  min?: number;
  max?: number;
};

export type DiagramAxes = {
  x?: DiagramAxis;
  y?: DiagramAxis;
};

export type DiagramDataPoint = {
  x: number | string;
  y: number | string;
};

export type DiagramArrow = {
  from: string;
  to: string;
  meaning?: string;
};

export type DiagramKeyValue = {
  name: string;
  value: number | string;
  unit?: string;
};

/**
 * Structured representation of a diagram, graph, table or figure attached to
 * a question. Built by the vision model and consumed by the grader and the
 * retrieval query so marks can be checked against typed fields rather than
 * free-form prose.
 */
export type DiagramContext = {
  diagramType: DiagramType;
  /** Short prose summary (1–2 sentences) for back-compat and quick reading. */
  summary: string;
  labels: DiagramLabel[];
  axes?: DiagramAxes;
  dataPoints?: DiagramDataPoint[];
  arrows?: DiagramArrow[];
  keyValues?: DiagramKeyValue[];
  observations: string[];
  ambiguities?: string[];
  /** Overall vision confidence, 0–1. Below ~0.5 the grader should be cautious. */
  confidence: number;
};

export type GradeSubmissionResult = {
  submissionId: string;
  score: number;
  maxScore: number;
  feedback: string;
  model: string;
  modelAnswer?: string;
  matchedIdeas?: string[];
  missingIdeas?: string[];
  markBreakdown?: MarkBreakdownItem[];
  strengths?: string[];
  improvements?: string[];
  /** Human-readable rendering of the diagram context (kept for back-compat). */
  diagramContext?: string;
  /** Structured JSON form of the diagram context (preferred for new consumers). */
  diagramContextStructured?: DiagramContext;
  diagramContextWarning?: string;
  contextUsed: number;
  filteredContextUsed: number;
  lowConfidence: boolean;
  warning?: string;
  contextAudit: ContextAuditResult;
  context: GradingContextPayload;
};
