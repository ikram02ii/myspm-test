import { eq, inArray, or, type SQL } from "drizzle-orm";

import { ragPastPapersTable, ragTextbooksTable } from "../../../lib/ragDb";

/**
 * Use one of these as `form` when a source covers the full F4+F5 syllabus (e.g. KMJ papers, DSKP).
 * Retrieval includes these rows when the session form is `Form 4` or `Form 5`.
 */
export const FULL_SYLLABUS_FORMS = ["Form 4 & 5", "SPM"] as const;

/** @deprecated Use FULL_SYLLABUS_FORMS */
export const PAST_PAPER_FULL_SYLLABUS_FORMS = FULL_SYLLABUS_FORMS;

/**
 * Normalize a free-form `form` value to the canonical `Form N` label stored in
 * the RAG tables (e.g. "4", "form 4", "FORM4" → "Form 4"). Full-syllabus labels
 * ("Form 4 & 5", "SPM") and "General" are preserved. Returns the trimmed input
 * unchanged when it does not look like a single-grade form.
 */
export function normalizeForm(rawForm: string | undefined | null): string {
  const q = (rawForm ?? "").trim();
  if (!q) return q;
  if (q.toLowerCase() === "general") return q;
  // Already a full-syllabus label — keep as-is (case-insensitive match).
  for (const full of FULL_SYLLABUS_FORMS) {
    if (q.toLowerCase() === full.toLowerCase()) return full;
  }
  // Match a single grade number, optionally prefixed by "form" (any spacing/case):
  // "4", "5", "form4", "Form 4", "FORM  5".
  const m = /^(?:form\s*)?([45])$/i.exec(q);
  if (m) return `Form ${m[1]}`;
  return q;
}

function fullSyllabusFormClause<T extends { form: typeof ragPastPapersTable.form }>(
  table: T,
  queryForm: string | undefined | null,
): SQL | undefined {
  const q = normalizeForm(queryForm);
  if (!q || q.toLowerCase() === "general") return undefined;
  const fullSyllabus = [...FULL_SYLLABUS_FORMS] as string[];
  return or(eq(table.form, q), inArray(table.form, fullSyllabus));
}

export function pastPaperFormWhereClause(queryForm: string | undefined | null): SQL | undefined {
  return fullSyllabusFormClause(ragPastPapersTable, queryForm);
}

export function textbookFormWhereClause(queryForm: string | undefined | null): SQL | undefined {
  return fullSyllabusFormClause(ragTextbooksTable, queryForm);
}
