/** Strict mandatory mark-scheme rules for AI subjective question generation prompts. */
export const STRICT_MARK_SCHEME_PROMPT_HINT =
  "MANDATORY marking scheme rules: Markah MUST equal the count of distinct necessary scientific ideas ONLY (2 ideas = 2 marks — NEVER inflate). " +
  "NEVER use semantic repetition — each Mark N bullet MUST be a new idea, NEVER a restatement. " +
  "Each mark MUST be independently earnable without repeating another bullet's wording. " +
  "You MUST format each bullet as: Mark 1: [Core Idea] — specific credit criteria. " +
  "CALCULATION: 1 mark → final only; 2 marks → formula + final with unit; 3 marks → formula + substitution/working + final with unit. " +
  "Unit is NEVER a separate mark. Marking points count MUST equal Markah.";

/** Jawapan depth by stem command word — mirrors backend modelAnswerFeedbackFormatPolicy. */
export const JAWAPAN_VERB_FORMAT_PROMPT_HINT =
  "JAWAPAN FORMAT BY COMMAND WORD (binding): " +
  "State/Identify/List/Name stems → Jawapan MUST be exactly [Markah] bullet points, each ≤10 words, no elaboration. " +
  "Explain/Describe/Discuss stems → Jawapan MUST be exactly [Markah] marking points; each = [Point/Fact] + [Reasoning/Application/Impact] in one sentence (~15–25 words). " +
  "Calculation stems → Jawapan MUST show only the mark stages for that Markah (2 marks = formula + final; 3 marks = formula + working + final). " +
  "Jawapan MUST use KSSM SPM textbook wording (simple because/so/therefore) — NOT examiner or A-Level terms like 'catalytic capacity' or 'collision frequency'. " +
  "Jawapan MUST read as a full-marks student exemplar — NOT rubric shorthand or 'Mark N:' labels.";
