/**
 * Central configuration surface for the AMA grading pipeline.
 *
 * Every value the marking pipeline treats as tunable — model identifiers,
 * sampling temperatures, and decision thresholds — is declared here so that
 * grading behaviour can be reasoned about and adjusted from a single place
 * instead of being rediscovered as literals scattered across the module.
 *
 * These constants document the DEFAULTS only. Each value remains overridable
 * at runtime through the environment variables named alongside it; the call
 * sites keep their existing precedence rules, and the defaults below apply
 * solely when no override is present.
 */

/**
 * Default Qwen chat model for text grading calls (idea extraction, borderline
 * verification, feedback). Override with `QWEN_GRADING_MODEL`.
 */
export const DEFAULT_QWEN_GRADING_MODEL = "qwen-plus";

/**
 * Default Qwen vision model for diagram/figure fact extraction, which enriches
 * grading context but never awards marks. Override with `QWEN_VISION_MODEL`
 * (or `QWEN_GRADING_VISION_MODEL`).
 */
export const DEFAULT_QWEN_VISION_MODEL = "qwen-vl-plus";

/**
 * Sampling temperature for grading JSON calls. Kept low so marking is
 * repeatable and defensible. Individual calls may override it — most notably
 * the borderline meaning verifier, which locks to {@link DETERMINISTIC_TEMPERATURE}.
 */
export const GRADING_JSON_TEMPERATURE = 0.1;

/**
 * Fully deterministic sampling. Required by the Half B borderline meaning
 * verifier, whose award decisions must not vary between identical inputs.
 */
export const DETERMINISTIC_TEMPERATURE = 0;

/**
 * Fraction of a marking unit's core-concept tokens that a student clause must
 * cover before the evidence gate accepts the clause as grounding for that unit.
 * Override with `GRADE_UDM_COVER_RATIO`.
 */
export const DEFAULT_UDM_COVER_HIT_RATIO = 0.72;

/**
 * Maximum completion tokens requested from the vision model during diagram fact
 * extraction. Override with `QWEN_VISION_MAX_TOKENS` (positive integers only).
 */
export const DEFAULT_QWEN_VISION_MAX_TOKENS = 900;
