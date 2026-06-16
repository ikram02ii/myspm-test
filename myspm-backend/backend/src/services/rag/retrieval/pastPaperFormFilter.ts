import { eq, inArray, or, type SQL } from "drizzle-orm";

import { ragPastPapersTable, ragTextbooksTable } from "../../../lib/ragDb";

/**
 * Use one of these as `form` when a source covers the full F4+F5 syllabus (e.g. KMJ papers, DSKP).
 * Retrieval includes these rows when the session form is `Form 4` or `Form 5`.
 */
export const FULL_SYLLABUS_FORMS = ["Form 4 & 5", "SPM"] as const;

/** @deprecated Use FULL_SYLLABUS_FORMS */
export const PAST_PAPER_FULL_SYLLABUS_FORMS = FULL_SYLLABUS_FORMS;

function fullSyllabusFormClause<T extends { form: typeof ragPastPapersTable.form }>(
  table: T,
  queryForm: string | undefined | null,
): SQL | undefined {
  const q = queryForm?.trim();
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
