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
| [`agents/`](./agents/) | Question Classification Agent, theory/calc agents, intent mapping |
| [`case/`](./case/) | Assessment case (ACF), embedded schemes, model answer, grounding |
| [`extraction/`](./extraction/) | Examiner decompose, marking-point split, diagram facts |
| [`evaluation/`](./evaluation/) | LLM tick proposals (theory / calc) |
| [`matching/`](./matching/) | Clause scan, evidence gate, competitive assign, reconcile |
| [`scoring/`](./scoring/) | Score from validated demonstration |
| [`validators/`](./validators/) | Post-score guards |
| [`feedback/`](./feedback/) | Gap feedback, model-answer display |
| [`prompts/`](./prompts/) | LLM prompt text |
| [`shared/`](./shared/) | Types, stem helpers, Qwen client, config, decision logs |
| [`legacy/`](./legacy/) | Legacy pipeline (opt-in via `RAG_GRADE_PIPELINE`) |

## Pipelines

Two pipelines exist, selected by `RAG_GRADE_PIPELINE`:

- **Evidence pipeline** (default): the current agent/evidence-gate flow below.
- **Legacy pipeline**: opt in with `RAG_GRADE_PIPELINE=v1|legacy|off|false|0`.

## Marking flow (evidence pipeline)

```text
Student answer + question
  → Question Classification Agent (calculation | theory | diagram | structured | other)
  → case (intent + credit units; scheme-first if Jawapan / Marking points exist)
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
