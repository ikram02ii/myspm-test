import type { QuestionAnalysis } from "../../types";

export type AssessmentIntentFamily =
  | "recall"
  | "explanation"
  | "description"
  | "comparison"
  | "effects_evaluative"
  | "process"
  | "humanities"
  | "definition"
  | "calculation"
  | "general";

export type AssessmentIntentCategory =
  | "state"
  | "name"
  | "list"
  | "identify"
  | "explain"
  | "why"
  | "describe"
  | "compare"
  | "differentiate"
  | "advantages"
  | "disadvantages"
  | "effects"
  | "process"
  | "justify"
  | "evaluate"
  | "predict"
  | "define"
  | "calculate"
  | "general";

export type EvidenceUnitType = "fact" | "stage" | "claim" | "entity" | "dimension" | "justification";

export type EvidenceUnit = {
  id: string;
  type: EvidenceUnitType;
  content: string;
  aliases: string[];
  creditWeight: number;
  /**
   * Extraction / evaluator hint: this unit is essential for a complete answer.
   * NOT used for chain-walk gating — use relations + `supports` topology instead.
   * @see requiredForCorrectness (alias during migration)
   */
  required: boolean;
  /** Optional alias for `required` — essential for correctness, not chain order. */
  requiredForCorrectness?: boolean;
  /** Parent unit ids that must be demonstrated before this unit can progress on a chain. */
  supports?: string[];
};

export type EvidenceRelationType =
  | "causes"
  | "enables"
  | "contrasts"
  | "sequence_next"
  | "justifies"
  | "predicts_from";

export type EvidenceRelation = {
  id: string;
  type: EvidenceRelationType;
  from: string;
  to: string;
  requiredForMarks: boolean;
};

export type MarkRuleKind =
  | "count_distinct_units"
  | "coverage_chain"
  | "ordered_stages"
  | "paired_entities"
  | "claim_plus_reason";

export type MarkRule = {
  kind: MarkRuleKind;
  maxMarks: number;
  openPool?: boolean;
};

export type AssessmentIntent = {
  category: AssessmentIntentCategory;
  family: AssessmentIntentFamily;
  assessedUnderstanding: string;
  isCompound: boolean;
  analysis: QuestionAnalysis;
};

export type AssessmentCaseFile = {
  v: 3;
  question: string;
  subject: string;
  form: string;
  maxScore: number;
  intent: AssessmentIntent;
  assessedUnderstanding: string;
  units: EvidenceUnit[];
  relations: EvidenceRelation[];
  markRule: MarkRule;
  referenceModelAnswer?: string;
  chunkRefs: string[];
  contextSource: "textbook" | "llm_fallback";
};

export type DemonstratedUnit = {
  unitId: string;
  quote: string;
  valid: boolean;
};

export type DemonstratedRelation = {
  relationId: string;
  quote: string;
};

export type MissingGap = {
  id: string;
  kind: "unit" | "relation";
  label: string;
  reason: string;
};

export type UnderstandingDemonstration = {
  unitsDemonstrated: DemonstratedUnit[];
  relationsDemonstrated: DemonstratedRelation[];
  unitsMissing: MissingGap[];
  relationsMissing: MissingGap[];
  invalidClaims: { text: string; reason: string }[];
};

export type { ChainWalkResult } from "./coverageChainScorer";
export type { GradingContext } from "./gradingContext";

export type AssessmentCaseSourceMeta = {
  v: 3;
  pipeline: "evidence_centric";
  contextSource: "textbook" | "llm_fallback";
  chunkRefs: string[];
  referenceModelAnswer?: string;
  intentFamily?: AssessmentIntentFamily;
  intentCategory?: AssessmentIntentCategory;
};

export type StoredAssessmentCase = {
  caseId: string;
  questionHash: string;
  subject: string;
  form: string;
  questionText: string;
  maxScore: number;
  acf: AssessmentCaseFile;
  sourceRef?: string;
};

/** DB wrapper stored in rag_rubrics.ideas column */
export type AssessmentCaseDbPayload = {
  v: 3;
  acf: AssessmentCaseFile;
};
