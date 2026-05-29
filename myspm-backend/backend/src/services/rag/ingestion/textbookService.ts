import { randomUUID } from "node:crypto";
import { desc } from "drizzle-orm";
import { ragDb, ragTextbookChunksTable, ragTextbooksTable } from "../../../lib/ragDb";
import { chunkText, normalizeChunkConfig } from "./chunking";
import type { RegisterTextbookInput, TextbookListItem } from "../types";

export async function registerTextbook(input: RegisterTextbookInput): Promise<{
  textbookId: string;
  chunkCount: number;
}> {
  const subject = input.subject.trim();
  const form = input.form.trim();
  const title = input.title.trim();
  const text = input.text.trim();
  const sourceName = input.sourceName?.trim() || undefined;

  if (!subject || !form || !title) {
    throw new Error("subject, form, and title are required");
  }
  if (!text) {
    throw new Error("text is required");
  }

  const normalized = normalizeChunkConfig(
    input.chunkConfig?.chunkSizeChars,
    input.chunkConfig?.overlapChars,
  );
  const chunks = chunkText(text, normalized.chunkSizeChars, normalized.overlapChars);
  if (chunks.length === 0) {
    throw new Error("No chunks produced from textbook text");
  }

  const textbookId = `tb-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const inserted = await ragDb
    .insert(ragTextbooksTable)
    .values({
      textbookId,
      subject,
      form,
      title,
      sourceName,
      chunkSizeChars: normalized.chunkSizeChars,
      overlapChars: normalized.overlapChars,
      createdByUserId: input.createdByUserId ?? null,
    })
    .returning({ id: ragTextbooksTable.id });

  const textbookDbId = inserted[0]?.id;
  if (!textbookDbId) {
    throw new Error("Failed to create textbook record");
  }

  await ragDb.insert(ragTextbookChunksTable).values(
    chunks.map((c) => ({
      textbookDbId,
      chunkId: c.id,
      chunkIndex: c.index,
      content: c.content,
    })),
  );

  return {
    textbookId,
    chunkCount: chunks.length,
  };
}

export async function listTextbooks(): Promise<TextbookListItem[]> {
  const chunkCountsRaw = await ragDb
    .select({
      textbookDbId: ragTextbookChunksTable.textbookDbId,
      count: ragTextbookChunksTable.id,
    })
    .from(ragTextbookChunksTable);

  const chunkCountMap = new Map<number, number>();
  for (const row of chunkCountsRaw) {
    const current = chunkCountMap.get(row.textbookDbId) ?? 0;
    chunkCountMap.set(row.textbookDbId, current + 1);
  }

  const dbRows = await ragDb
    .select({
      id: ragTextbooksTable.id,
      textbookId: ragTextbooksTable.textbookId,
      subject: ragTextbooksTable.subject,
      form: ragTextbooksTable.form,
      title: ragTextbooksTable.title,
      sourceName: ragTextbooksTable.sourceName,
      uploadedAt: ragTextbooksTable.uploadedAt,
    })
    .from(ragTextbooksTable)
    .orderBy(desc(ragTextbooksTable.uploadedAt));

  return dbRows.map((row) => ({
    textbookId: row.textbookId,
    subject: row.subject,
    form: row.form,
    title: row.title,
    sourceName: row.sourceName ?? undefined,
    uploadedAt: row.uploadedAt.toISOString(),
    chunkCount: chunkCountMap.get(row.id) ?? 0,
  }));
}
