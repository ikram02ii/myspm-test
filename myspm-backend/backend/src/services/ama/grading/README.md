# AMA grading

Open-ended marking for `POST /api/rag/grade`.

## Entry points

| File | Role |
|------|------|
| [`gradeService.ts`](./gradeService.ts) | Public API (`gradeSubmission`) |
| [`gradeSubmissionOrchestrator.ts`](./gradeSubmissionOrchestrator.ts) | Vision, retrieval, pipeline |
| [`gradePipelineService.ts`](./gradePipelineService.ts) | Open-ended agent router |

## Layout

| Folder | Owns |
|--------|------|
| [`analysis/`](./analysis/) | Question type, intent, embedded scheme, calc-structure detect |
| [`case/`](./case/) | Assessment case (ACF), model answer, grounding |
| [`evaluation/`](./evaluation/) | LLM tick proposals (theory / calc) |
| [`matching/`](./matching/) | Clause scan, evidence gate, competitive assign, reconcile |
| [`scoring/`](./scoring/) | Score from validated demonstration |
| [`agents/`](./agents/) | Theory / calculation agents |
| [`validators/`](./validators/) | Post-score guards |
| [`feedback/`](./feedback/) | Gap feedback, model-answer display |
| [`prompts/`](./prompts/) | LLM prompt text |
| [`shared/`](./shared/) | Types, Qwen client, decision logs |
| [`legacy/`](./legacy/) | Legacy pipeline (`RAG_GRADE_PIPELINE=legacy`) |
| [`v3/`](./v3/) | Compat re-exports only — do not add logic here |

## Marking flow

```text
Student answer + question
  → analysis (intent; scheme-first if Jawapan / Marking points exist)
  → case (one credit unit per mark from scheme when embedded)
  → theory or calculation agent
      → LLM proposes evidence ticks
      → clause scan merges grounded spans (theory; reduces under-marking)
      → evidence gate (quote must appear in student text)
      → competitive assign (one quote → one unit)
      → score = sum of awarded unit weights
  → validators + feedback
```

**Rule:** a mark is awarded only for grounded student evidence that covers that unit and does not also claim sibling units.

## Tracing

| Env | What it logs |
|-----|----------------|
| (always on) | `[grade:decision]`, `[grade:clauseScan]` |
| `GRADE_UDM_TRACE=1` | Per-tick UDM stages |
| `GRADE_CALC_TRACE=1` | Calculation stage detail |
| `GRADE_VALIDATE_TRACE=1` | Validator decisions |

## Tests

```bash
npm run test:marking
```

Runs every `scripts/marking/*.test.ts` file. Chunk retrieval lives in [`../retrieval/`](../retrieval/), not under this folder.
