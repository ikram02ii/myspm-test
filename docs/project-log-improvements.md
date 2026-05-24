# Project log — Improvements Made

Use this format for weekly reports (heading + bullet + screenshot).

---

## Tuesday (19/5)

### Improvements Made

- Solved the issue with OCR for mathematical equations: raw Qwen-VL output (often LaTeX or `\displaylines`) is parsed into **plain SPM working** in the answer box — fractions as `a / (b)`, arrows as `→`, subscripts as `H₂` or `H2`, one step per line.

### How it works (current codebase)

1. Student taps **Take photo** / **Upload image** in **AI Practice**.
2. `POST /api/scan` runs Qwen vision OCR, then the **OCR post-process pipeline**:
   - Math/LaTeX cleanup (`ocrTextNormalize.ts`)
   - Optional LLM repair (`OCR_PIPELINE_REPAIR` — on by default)
3. Clean text is placed in **Your answer** for **Submit for marking** (`/rag/grade` with saved `rubricId`).

### Screenshot layout (for your slide)

| Left | Right |
|------|--------|
| Mobile **AI Practice** screen showing **Your answer** with parsed working (mol calculations, `→`, fractions) | Photo of handwritten working on paper |

**Example answer text (after OCR):**

```
Bil mol HA = (0.1)(50) / 1000 = 0.005 mol
2 mol HA → 1 mol H2
0.005 mol HA → 0.0025 mol H2
Isi padu gas hidrogen = 0.0025 × 24 = 0.06 dm3 mol-1
```

### Env (backend `.env`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `OCR_POST_PROCESS` | `true` | Set `false` to return raw OCR only |
| `OCR_PIPELINE_REPAIR` | on | Set `false` to skip LLM repair (faster; math parse only) |
| `OCR_UNICODE_SUBSCRIPTS` | on | `false` → ASCII subscripts (`H2`) |

Restart `npm run dev` after changing env.

---

## Monday (18/5)

### Improvements Made

- Rubrics generated from **textbook chunks** (Biology Form 4; Chemistry uses the same script).
- Marking accepts **different wording / same meaning** (`qwenGradingClient`, `openEnded` rubric rows).
- **Sequence/order** questions use ordered stage marking (`sequenceMarkingService.ts`).

---

## Friday (15/5)

### Workflow implemented

```
AI generates question (+ rubric at generate time)
        ↓
Rubric saved in rag_rubrics
        ↓
Question carries rubricId
        ↓
Student submits answer
        ↓
/rag/grade uses exact rubricId (no new rubric during marking)
```

---

## Wednesday (20/5) — known issue (document)

### Issues identified

- For **multi-part equation** questions, if the rubric is a single 2-mark row, the agent may award **2/2** when only one part is correct. Prefer **one rubric row per mark** when generating chunk rubrics.

### Tasks still open

- [ ] Chemistry F4/F5: ingest → chapter backfill → `create:rubrics-from-chunks`
- [ ] Physics textbook ingest
- [ ] Retry failed Biology chunk rubrics (`chunk-51`, `56`, `96`, `147`)
