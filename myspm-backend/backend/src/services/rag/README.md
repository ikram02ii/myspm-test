# RAG services layout

| Folder | Purpose |
|--------|---------|
| **`grading/`** | Marking pipeline: grade submission, pipeline stages, policies, fairness, Qwen client, sequence marking |
| **`rubric/`** | Rubric generation, matching student ideas to rubric rows, textbook-chunk rubrics |
| **`retrieval/`** | Chunk retrieval, embeddings, context audit, past-paper filters |
| **`ingestion/`** | Textbook/past-paper PDF ingest, chunking, textbook registry |
| **`ocr/`** | Scan/OCR post-processing and answer validation |
| **`speaking/`** | English speaking assessment and transcription |
| **`types.ts`** | Shared TypeScript types for all modules |

## Common imports

```ts
import { gradeSubmission } from "../services/rag/grading/gradeService";
import type { RubricIdea } from "../services/rag/types";
import { retrieveChunks } from "../services/rag/retrieval/retrievalService";
```
