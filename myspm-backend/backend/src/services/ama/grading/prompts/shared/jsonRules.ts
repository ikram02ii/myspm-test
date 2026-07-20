/**
 * Centralized JSON-only output instructions.
 * Values are exact copies of existing call-site strings — do not redesign schemas.
 */

/** Localize + assessment case reference MA (identical historical wording). */
export const MUST_RETURN_JSON_MODEL_ANSWER =
  'You MUST return JSON only: { "modelAnswer": string }';

/** Calculation worked model-answer generation (identical historical wording). */
export const RETURN_JSON_MODEL_ANSWER =
  'Return JSON only: { "modelAnswer": string }';

/** Question-type LLM classifier (identical historical wording, including trailing period). */
export const RETURN_JSON_QUESTION_TYPE =
  'Return JSON only: { "questionType": string }.';

/** Calculation chunk question generation (identical historical wording). */
export const RETURN_JSON_QUESTION_TEXT =
  'Return JSON only: { "questionText": string }';

/** Textbook chunk assessment question + MA (identical historical wording, including trailing period). */
export const RETURN_JSON_QUESTION_TEXT_AND_MODEL_ANSWER =
  'Return JSON only: { "questionText": string, "modelAnswer": string }.';
