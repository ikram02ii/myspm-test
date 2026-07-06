/**
 * Shared mandatory examiner phrasing for all LLM marking prompts.
 * Prepended so softer policy blocks cannot override these rules.
 */

export const MARKING_MANDATORY_LANGUAGE_HEADER = [
  "MANDATORY EXAMINER RULES (binding — override any softer wording elsewhere in this prompt):",
  "- You MUST treat every rule below as compulsory, not advisory.",
  "- Award each rubric row independently when the student DEMONSTRATES that row's core concept.",
  "- NEVER award unless the student's own written words support the mark point.",
  "- NEVER award from the question stem, rubric text, model answer, or diagram/figure alone.",
  "- Withhold a row when its specific concept is missing or scientifically wrong — do NOT withhold other rows.",
  "- Distinguish 'concept missing' from 'concept present but incomplete': partial understanding earns partial marks across rows.",
  "- You MUST quote a short exact phrase from the student answer before any award (in match_reasoning or reason).",
  "- If uncertain about ONE row, reject THAT row only — never zero the whole answer because another row is weak.",
].join("\n");

export const MARKING_PER_TYPE_MANDATORY_RULES = [
  "PER-TYPE MANDATORY RULES (evaluate each row on its own merits):",
  "",
  "CAUSAL (requires_causal_link: true ONLY — never on core_fact rows):",
  "- ONLY award if has_causal_link is true on the matching student idea.",
  "- NEVER apply causal requirements to rows where requires_causal_link is false or rowRole is core_fact.",
  "- Withhold mechanism rows when causal language is absent; fact rows may still earn marks independently.",
  "",
  "COMPARISON (kind=comparison OR comparison_subjects non-empty):",
  "- Directional comparisons ('A is more X than B'): award when BOTH entities appear in the student idea.",
  "- Paired contrasts (while/whereas): award when BOTH entities appear in the evidence clause.",
  "- NEVER require both entities in the full answer when the student wrote a complete comparison in one clause.",
  "- ALWAYS revoke ambiguous_subject only when the row requires explicit entity pairing.",
  "",
  "DEFINITION (kind=definition OR demand_type=definition):",
  "- Award when the student states a defining property — even if the full textbook definition is incomplete.",
  "- Withhold only when the answer restates the term label with no definitional content.",
  "",
  "STRICT RECALL (demand_type=recall AND open_ended=false):",
  "- ONLY award if the student idea clearly expresses the core concept — the key action, noun, or property.",
  "- ACCEPT close paraphrases where the same core meaning is unambiguous.",
  "- ACCEPT colloquial synonyms, BM equivalents, and simplified school phrasing that convey the same SPM concept.",
  "- NEVER award when the idea is vague, off-topic, or only loosely related without naming the core concept.",
  "",
  "OPEN EXAMPLE (kind=example AND open_ended=true):",
  "- ONLY award if the example is a valid SPM-level member of the category.",
  "- NEVER award irrelevant or scientifically wrong examples.",
].join("\n");

/** Rubric rows are concept anchors for marking — not required student phrasing. */
export const CONCEPT_ANCHORED_MARKING_BLOCK = [
  "CONCEPT-ANCHORED MARKING (binding — rubric is NOT a wording checklist):",
  "- Each rubric row describes a CONCEPT or mark point an examiner looks for — not a sentence the student must copy.",
  "- ONLY award when the student's own words demonstrate that concept (semantic match).",
  "- NEVER withhold a mark because the student used different but correct SPM-level wording.",
  "- NEVER require exact matches to criterion_description, idea text, or textbook phrases.",
  "- accepted_concepts and accepted_synonyms are illustrative paraphrases — not an exclusive list.",
  "- For open_pool rows: award when the student names any valid syllabus-level member of the category, even if not listed in validMembers.",
].join("\n");

export function withMandatoryMarkingLanguage(systemPrompt: string): string {
  return [
    MARKING_MANDATORY_LANGUAGE_HEADER,
    "",
    MARKING_PER_TYPE_MANDATORY_RULES,
    "",
    CONCEPT_ANCHORED_MARKING_BLOCK,
    "",
    systemPrompt,
  ].join("\n");
}
