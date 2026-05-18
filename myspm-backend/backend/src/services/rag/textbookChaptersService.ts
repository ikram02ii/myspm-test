import { and, eq, isNotNull, sql } from "drizzle-orm";

import { ragDb, ragTextbookChunksTable, ragTextbooksTable } from "../../lib/ragDb";

const MAX_CHAPTERS = 400;

/**
 * Distinct non-empty `rag_textbook_chunks.chapter` values for a subject+form,
 * as stored during textbook ingest (used for chapterHint / chapterFilter).
 */
export async function listTextbookChaptersForSubjectForm(
  subject: string,
  form: string,
): Promise<string[]> {
  const sub = subject.trim();
  const fo = form.trim();
  if (!sub || !fo) return [];

  const rows = await ragDb
    .select({ chapter: ragTextbookChunksTable.chapter })
    .from(ragTextbookChunksTable)
    .innerJoin(ragTextbooksTable, eq(ragTextbookChunksTable.textbookDbId, ragTextbooksTable.id))
    .where(
      and(
        eq(ragTextbooksTable.subject, sub),
        eq(ragTextbooksTable.form, fo),
        isNotNull(ragTextbookChunksTable.chapter),
        sql`trim(${ragTextbookChunksTable.chapter}) <> ''`,
      ),
    )
    .groupBy(ragTextbookChunksTable.chapter)
    .orderBy(ragTextbookChunksTable.chapter)
    .limit(MAX_CHAPTERS);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const c = r.chapter?.trim();
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}
