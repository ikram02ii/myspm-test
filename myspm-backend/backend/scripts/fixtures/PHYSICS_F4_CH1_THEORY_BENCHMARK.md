# Physics Form 4 — Chapter 1 Measurement (30-question marking accuracy bank)

Use this set to check:
1. **Marking points** (count ≈ marks, independent ideas)
2. **Score accuracy** (full / partial / junk)
3. **Model answer cards** (one clean card per mark)

## Topics covered

| # | Focus |
|---|--------|
| 01–05 | Base / derived quantities, SI units |
| 06–10 | Scalar vs vector, distance/displacement, speed/velocity |
| 11–18 | Base-unit derivation, prefixes, mass/weight, force/pressure |
| 19–25 | Scientific investigation, graphs, pendulum variables |
| 26–30 | Accuracy/precision, compound define + why |

## Files

- Fixture: `myspm-backend/backend/scripts/fixtures/physicsF4Ch1Theory30.json`
- Runner: `myspm-backend/backend/scripts/runPhysicsF4Ch1TheoryBenchmark.ts`
- Report: `myspm-backend/backend/scripts/output/physicsF4Ch1TheoryBenchmark.json` (after run)

## Commands

```bash
cd myspm-backend/backend

# List all 30 questions + expected marking points (no API)
npx tsx ./scripts/runPhysicsF4Ch1TheoryBenchmark.ts --dry

# Smoke test first 3 questions (all trials)
npx tsx ./scripts/runPhysicsF4Ch1TheoryBenchmark.ts --limit 3

# Structure only: one full trial per question — check model-answer point count
npx tsx ./scripts/runPhysicsF4Ch1TheoryBenchmark.ts --structureOnly --limit 10

# Full bank (~80–90 live grades — needs RAG DB + Qwen)
npm run test:physics-f4-ch1-theory

# Single question
npx tsx ./scripts/runPhysicsF4Ch1TheoryBenchmark.ts --question P4C1-26
```

## What “good” looks like

| Check | Pass rule |
|-------|-----------|
| Score | `actualScore === expectedScore` for full / partial / junk trials |
| Points | Model answer has **exactly `maxScore`** cards (or gold point count) |
| Zero junk | Feedback for `"8"` / `"idk"` does **not** say “right track / needs more detail” |

Each question includes trials:

- **full** → expect full marks  
- **partial** → expect mid score  
- **junk/wrong** → expect 0
