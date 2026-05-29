import { eq, inArray, or, type SQL } from "drizzle-orm";

import { ragPastPapersTable } from "../../../lib/ragDb";

/**
 * Use one of these as `rag_past_papers.form` when a paper is a single SPM-level
 * assessment covering Form 4 + Form 5 syllabus (e.g. KMJ / trial K2). Retrieval
 * then includes these rows when the session form is `Form 4` or `Form 5`.
 */
export const PAST_PAPER_FULL_SYLLABUS_FORMS = ["Form 4 & 5", "SPM"] as const;

export function pastPaperFormWhereClause(queryForm: string | undefined | null): SQL | undefined {
  const q = queryForm?.trim();
  if (!q || q.toLowerCase() === "general") return undefined;
  const fullSyllabus = [...PAST_PAPER_FULL_SYLLABUS_FORMS] as string[];
  return or(eq(ragPastPapersTable.form, q), inArray(ragPastPapersTable.form, fullSyllabus));
}
