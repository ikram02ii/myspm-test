import * as dotenv from "dotenv";

dotenv.config({ path: new URL("../.env", import.meta.url) });

async function main(): Promise<void> {
  const { retrieveChunks } = await import("../src/services/ama/retrieval/retrievalService");
  const { RAG_DB_SCHEMA_NAME } = await import("../src/lib/ragSchema");

  const query =
    "Generate 5 SPM Biology MCQ objective questions focused on topic: Chapter 2: Cell Biology and Organization (Form 4)";

  const result = await retrieveChunks({
    query,
    subject: "Biology",
    topK: 8,
  });

  console.log("schema:", RAG_DB_SCHEMA_NAME);
  console.log("retrieved:", result.count);
  for (const chunk of result.chunks) {
    console.log({
      sourceType: chunk.sourceType,
      score: Number(chunk.score.toFixed(3)),
      title: chunk.title,
      chapter: chunk.chapter,
      conceptTitle: chunk.conceptTitle,
      preview: chunk.content.slice(0, 100).replace(/\s+/g, " "),
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
