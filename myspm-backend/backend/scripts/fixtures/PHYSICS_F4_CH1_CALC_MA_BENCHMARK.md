# Physics Form 4 Chapter 1 — Calculation model-answer quality

Checks **Formula / Working / Final answer** quality (not marking scores).

## Files
- `scripts/fixtures/physicsF4Ch1Calc30.json` — 30 calc questions (01–15 original + 16–30 new)
- `scripts/runPhysicsF4Ch1CalcModelAnswerBenchmark.ts`
- Report: `scripts/output/physicsF4Ch1CalcModelAnswerBenchmark.json`

## Run

```bash
cd myspm-backend/backend

# List questions
npm run test:physics-f4-ch1-calc-ma:dry

# Smoke (3 questions)
npm run test:physics-f4-ch1-calc-ma:smoke

# Full 15
npm run test:physics-f4-ch1-calc-ma
```

## Pass rules (each question)
1. Has **Formula:** + **Working:** + **Final answer:** with content  
2. No dirty LaTeX / `\n` junk  
3. Final number matches expected (±tolerance)  
4. Unit cue present  
5. Formula/conversion hint appears in text  
