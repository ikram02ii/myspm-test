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
  /** Case-insensitive substring match on `rag_textbook_chunks.chapter` (strict filter). */
  chapterFilter?: string;
  /** Soft boost in ranking when chunk.chapter contains this substring (topic / chapter headings). */
  chapterHint?: string;
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
  /** Past-paper chunk label, e.g. Q7(a). */
  questionRef?: string;
  /** Typical mark weight from past-paper / mark-scheme chunks (question generation hints). */
  maxMarks?: number | null;
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

/** Command word detected from the stem (deterministic). */
export type QuestionCommandWord =
  | "state"
  | "name"
  | "list"
  | "give"
  | "define"
  | "explain"
  | "describe"
  | "compare"
  | "calculate"
  | "identify"
  | "discuss"
  | "general";

export type DemandType =
  | "recall"
  | "definition"
  | "explanation"
  | "comparison"
  | "calculation"
  | "example"
  | "application"
  | "equation"
  | "diagram_label"
  | "essay";

export type EquationType = "word" | "symbol" | "ionic" | "half" | null;

export type VerifierMode =
  | "meaning"
  | "membership"
  | "reasoning"
  | "method"
  | "paired"
  | "equation"
  | "sequence";

/** High-level demand shape for scoring policy. */
export type QuestionAnalysisQuestionType =
  | "fixed_answer"
  | "open_ended_example"
  | "function_purpose"
  | "structure_description"
  | "cause_effect"
  | "compare_contrast"
  | "calculation"
  | "mcq"
  | "sequence_order"
  | "general";

export type QuestionAnalysis = {
  subject: string;
  topicKeywords: string[];
  commandWord: QuestionCommandWord;
  questionType: QuestionAnalysisQuestionType;
  demandType: DemandType;
  compoundDemandTypes?: DemandType[];
  isEquationQuestion: boolean;
  equationType: EquationType;
  isOpenEnded: boolean;
  isCompoundQuestion: boolean;
  expectedAnswerStyle: string;
  suggestedMaxScore: number;
  requiresCausalLink: boolean;
  requiresFeatureFunction: boolean;
};

export type GradeSubmissionInput = {
  question: string;
  studentAnswer: string;
  subject?: string;
  form?: string;
  topK?: number;
  maxScore?: number;
  /** Optional saved rubric from AI Practice generation; marking should reuse this exact rubric. */
  rubricId?: string;
  rubricVersion?: string;
  diagramImageUrl?: string;
  diagramImageBase64?: string;
  /** Structured vision parse of an attached figure (rubric context only at mark time). */
  diagramContextStructured?: DiagramContext | null;
  submissionId?: string;
  userId?: number | null;
  /** Pipeline v2: merged audited context (same as v1 grader). Do not retrieve independently in the pipeline. */
  mergedGradingContextText?: string;
  /** Pipeline v2: chunks that passed context audit (may be empty). */
  auditedRetrievedChunks?: RetrievedChunk[];
  pipelineContextAudit?: ContextAuditResult;
  gradingLowConfidence?: boolean;
  gradingContextWarning?: string | null;
  /** Pre-computed analysis from gradeService (optional). */
  questionAnalysis?: QuestionAnalysis;
};

export type MatchMethod =
  | "exact"
  | "synonym"
  | "acceptedConcept"
  | "embedding"
  | "llmVerifier"
  | "openEndedCategory";

export type MarkBreakdownItem = {
  idea: string;
  awarded: boolean;
  marks: number;
  reason: string;
  /** How this row was matched (pipeline v2). */
  matchMethod?: MatchMethod;
  /** Stable id from rubric JSON when present. */
  rubricId?: string;
  /** Matching strategy used for this row (pipeline v2). */
  matchStrategy?: string;
  /** True when marks were awarded for correct science not anticipated by the rubric row (teacher review). */
  awardedOutsideRubric?: boolean;
};

export type RubricIdeaKind =
  | "feature"
  | "function"
  | "point"
  | "step"
  | "comparison"
  | "knowledge"
  | "explanation"
  | "example"
  | "use"
  | "calculation"
  | "definition"
  | "method"
  | "accuracy"
  | "equation"
  | "application";

export type RubricIdea = {
  id: string;
  idea: string;
  marks: number;
  kind: RubricIdeaKind;
  /** For Explain/Describe: a "function" idea is linked to a "feature" idea so we can render pairs. */
  linkedToId?: string;
  /** Optional keyword hints used by the embedding/LLM matcher. */
  keywords?: string[];
  /** When true, accept scientifically valid alternatives (not a single textbook phrase). */
  openEnded?: boolean;
  /** Extra accepted paraphrases beyond keywords (SPM-level). */
  acceptedConcepts?: string[];
  /** If true, withhold explanation marks unless a causal link appears in the student idea. */
  requiresCausalLink?: boolean;
  demandType?: DemandType;
  equationType?: EquationType;
  /** Accuracy row depends on its method row being awarded first. */
  dependsOnRowId?: string;
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

export type AcceptedConceptBundle = {
  rubricIdea: string;
  acceptedPhrases: string[];
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
  /** Client-requested cap before stem-based adjustment (optional). */
  originalMaxScore?: number;
  /** Same as `maxScore` when adjusted downward from the client value. */
  adjustedMaxScore?: number;
  maxScoreAdjustedReason?: string;
  studentIdeasDetected?: string[];
  rubricIdeas?: string[];
  acceptedConcepts?: AcceptedConceptBundle[];
  contradictionCheckPassed?: boolean;
  /** Count of markBreakdown rows with awardedOutsideRubric (for teacher review). */
  outsideRubricAwardCount?: number;
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
  topicConsistencyPassed?: boolean;
  topicConsistencyWarning?: string;
  /** Structured pre-grade analysis (command word, demand type, suggested marks). */
  questionAnalysis?: QuestionAnalysis;
  /** Qualitative retrieval confidence for clients (e.g. high | medium | low). */
  retrievalConfidence?: "high" | "medium" | "low";
};
