/**
 * Deterministic post-checks for calculation UDM from the LLM evaluator.
 * Fixes common failure modes: wrong final accepted, spurious formula credit, unit errors.
 */

import { answersAgree } from "./calculationAnswerVerification";
import {
  detectUnitMismatch,
  extractComparableFinalAnswer,
  findCalculationStageUnitId,
  findFinalStageUnitId,
  findFormulaStageUnitId,
  findSubstitutionStageUnitId,
  quoteLooksLikeFormula,
  quoteLooksLikeSubstitution,
  studentAnswerMatchesReference,
} from "./calculationNumericMatch";
import { isCalculationIntent } from "./calculationAcfPolicy";
import { isPhysicsCalculation } from "./calculationSubjectPolicy";
import type { AssessmentCaseFile, UnderstandingDemonstration } from "./types";

function invalidateUnit(
  udm: UnderstandingDemonstration,
  unitId: string,
  quote: string,
  reason: string,
): UnderstandingDemonstration {
  const unitsDemonstrated = udm.unitsDemonstrated.map((d) =>
    d.unitId === unitId ? { ...d, valid: false } : d,
  );
  const invalidClaims = [...udm.invalidClaims];
  if (!invalidClaims.some((c) => c.text === quote && c.reason === reason)) {
    invalidClaims.push({ text: quote, reason });
  }
  return { ...udm, unitsDemonstrated, invalidClaims };
}

function invalidateDownstreamStages(
  udm: UnderstandingDemonstration,
  creditUnits: Array<{ id: string; content: string }>,
  fromUnitId: string,
  reason: string,
): UnderstandingDemonstration {
  const fromIdx = creditUnits.findIndex((u) => u.id === fromUnitId);
  if (fromIdx < 0) return udm;

  let result = udm;
  for (const unit of creditUnits.slice(fromIdx + 1)) {
    const demo = result.unitsDemonstrated.find((d) => d.unitId === unit.id && d.valid);
    if (demo) {
      result = invalidateUnit(result, unit.id, demo.quote, reason);
    }
  }
  return result;
}

function formulaMarkedWrong(udm: UnderstandingDemonstration, formulaId: string): boolean {
  const formulaDemo = udm.unitsDemonstrated.find((d) => d.unitId === formulaId);
  if (formulaDemo && formulaDemo.valid === false) return true;
  if (
    formulaDemo &&
    udm.invalidClaims.some(
      (c) =>
        c.text === formulaDemo.quote &&
        /wrong|incorrect|invalid/i.test(c.reason) &&
        /formula|equation/i.test(c.reason),
    )
  ) {
    return true;
  }
  return udm.invalidClaims.some((c) =>
    /wrong formula|incorrect (formula|equation)|formula.*wrong|equation.*wrong/i.test(c.reason),
  );
}

function pickFinalLineFromStudent(studentAnswer: string): string {
  const lines = studentAnswer
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/\d/.test(lines[i]!)) return lines[i]!;
  }
  return studentAnswer.trim();
}

/** Restore final-stage credit when the student answer is numerically correct but the LLM rejected it. */
function ensureCorrectFinalCredited(params: {
  question: string;
  studentAnswer: string;
  finalId: string;
  reference: string;
  udm: UnderstandingDemonstration;
}): UnderstandingDemonstration {
  const extracted = extractComparableFinalAnswer(params.reference);
  if (!extracted) return params.udm;

  const student = params.studentAnswer.trim();
  const finalDemo = params.udm.unitsDemonstrated.find((d) => d.unitId === params.finalId);
  const quote = finalDemo?.quote?.trim() || pickFinalLineFromStudent(student);

  const matches =
    studentAnswerMatchesReference(quote, params.reference, { question: params.question }) ||
    studentAnswerMatchesReference(student, params.reference, { question: params.question });

  if (!matches) return params.udm;

  const unitsDemonstrated = params.udm.unitsDemonstrated.filter((d) => d.unitId !== params.finalId);
  unitsDemonstrated.push({ unitId: params.finalId, quote, valid: true });
  const invalidClaims = params.udm.invalidClaims.filter(
    (c) => !answersAgree(c.text, quote) && !answersAgree(c.text, student),
  );

  return { ...params.udm, unitsDemonstrated, invalidClaims };
}

export function reconcileCalculationDemonstration(params: {
  question: string;
  studentAnswer: string;
  acf: AssessmentCaseFile;
  udm: UnderstandingDemonstration;
  referenceModelAnswer?: string;
}): UnderstandingDemonstration {
  if (!isCalculationIntent(params.acf)) return params.udm;

  const reference =
    params.referenceModelAnswer?.trim() ||
    params.acf.referenceModelAnswer?.trim() ||
    "";

  const creditUnits = params.acf.units
    .filter((u) => u.creditWeight > 0)
    .map((u) => ({ id: u.id, content: u.content }));

  const finalId = findFinalStageUnitId(creditUnits);
  const formulaId = findFormulaStageUnitId(creditUnits);
  const substitutionId = findSubstitutionStageUnitId(creditUnits);
  const calculationId = findCalculationStageUnitId(creditUnits);
  const showWorking = params.acf.markRule.calcPolicy === "show_working";
  const physicsCalc = isPhysicsCalculation(params.acf);
  const comparableRef = reference ? extractComparableFinalAnswer(reference) : "";

  let udm = params.udm;

  // --- Final answer vs reference ---
  if (reference && finalId) {
    const finalDemo = udm.unitsDemonstrated.find((d) => d.unitId === finalId && d.valid);
    if (finalDemo) {
      const candidate = finalDemo.quote.trim() || params.studentAnswer.trim();
      if (
        !studentAnswerMatchesReference(candidate, reference, { question: params.question })
      ) {
        udm = invalidateUnit(
          udm,
          finalId,
          finalDemo.quote,
          `Final answer does not match the expected result (${comparableRef || reference}).`,
        );
      } else {
        const unitIssue = detectUnitMismatch(candidate, reference, { question: params.question });
        if (unitIssue) {
          udm = invalidateUnit(udm, finalId, finalDemo.quote, unitIssue);
        }
      }
    }
  }

  // --- Stage shape validation (LLM often credits bare numbers as "formula") ---
  if (showWorking && formulaId) {
    const formulaDemo = udm.unitsDemonstrated.find((d) => d.unitId === formulaId && d.valid);
    if (formulaDemo && !quoteLooksLikeFormula(formulaDemo.quote)) {
      udm = invalidateUnit(
        udm,
        formulaId,
        formulaDemo.quote,
        "No formula or equation shown — a bare number does not earn the formula mark.",
      );
    }
  }

  if (showWorking && substitutionId) {
    const subDemo = udm.unitsDemonstrated.find((d) => d.unitId === substitutionId && d.valid);
    if (subDemo && !quoteLooksLikeSubstitution(subDemo.quote)) {
      udm = invalidateUnit(
        udm,
        substitutionId,
        subDemo.quote,
        "No substitution or arithmetic working shown for this stage.",
      );
    }
  }

  if (showWorking && calculationId) {
    const calcDemo = udm.unitsDemonstrated.find((d) => d.unitId === calculationId && d.valid);
    if (calcDemo && !quoteLooksLikeSubstitution(calcDemo.quote)) {
      udm = invalidateUnit(
        udm,
        calculationId,
        calcDemo.quote,
        "No calculation working shown for this stage.",
      );
    }
  }

  // Physics: wrong formula invalidates all downstream stages.
  if (showWorking && physicsCalc && formulaId && formulaMarkedWrong(udm, formulaId)) {
    udm = invalidateDownstreamStages(
      udm,
      creditUnits,
      formulaId,
      "Wrong formula — substitution, calculation, and final cannot be credited.",
    );
  }

  // --- Wrong final credited without reference: scan invalidClaims from LLM + strip orphan final ---
  if (!reference && finalId) {
    const finalDemo = udm.unitsDemonstrated.find((d) => d.unitId === finalId && d.valid);
    if (finalDemo && udm.invalidClaims.some((c) => /wrong|incorrect|mismatch/i.test(c.reason))) {
      udm = invalidateUnit(udm, finalId, finalDemo.quote, "Calculation error noted in the answer.");
    }
  }

  if (reference && finalId) {
    udm = ensureCorrectFinalCredited({
      question: params.question,
      studentAnswer: params.studentAnswer,
      finalId,
      reference,
      udm,
    });
  }

  return udm;
}

export type CalcAuditCase = {
  id: string;
  category: "wrong_final" | "missing_formula" | "unit_error" | "valid_working" | "long_reference";
  description: string;
  question: string;
  maxScore: number;
  referenceModelAnswer: string;
  studentAnswer: string;
  /** Simulated overly-permissive LLM UDM */
  llmUdm: UnderstandingDemonstration;
  expectedScore: number;
};

export function buildCalcAuditFixtures(): CalcAuditCase[] {
  const baseUdm = (): UnderstandingDemonstration => ({
    unitsDemonstrated: [],
    relationsDemonstrated: [],
    unitsMissing: [],
    relationsMissing: [],
    invalidClaims: [],
  });

  const longRef =
    "Formula: Mass = Molar mass × Number of moles\nWorking: Molar mass of NaCl = 58.5 g/mol\nNumber of moles = 1 mol\nMass = 58.5 g/mol × 1 mol = 58.5 g\nFinal answer: 58.5 g";

  return [
    {
      id: "wrong_final_accepted",
      category: "wrong_final",
      description: "LLM credits final with 5 mol but reference is 2 mol",
      question: "Calculate the number of moles of gas at r.t.p. when volume is 48 dm3. (3 marks)",
      maxScore: 3,
      referenceModelAnswer: "2 mol",
      studentAnswer: "n = V/24\nn = 48/24 = 2\n5 mol",
      llmUdm: {
        ...baseUdm(),
        unitsDemonstrated: [
          { unitId: "calc_s1", quote: "n = V/24", valid: true },
          { unitId: "calc_s2", quote: "n = 48/24 = 2", valid: true },
          { unitId: "calc_s3", quote: "5 mol", valid: true },
        ],
      },
      expectedScore: 2,
    },
    {
      id: "missing_formula_hallucinated",
      category: "missing_formula",
      description: "LLM credits formula stage for a bare number with no equation",
      question: "Calculate the mass of NaCl produced. (2 marks)",
      maxScore: 2,
      referenceModelAnswer: "58.5 g",
      studentAnswer: "58.5 g",
      llmUdm: {
        ...baseUdm(),
        unitsDemonstrated: [
          { unitId: "calc_s1", quote: "58.5", valid: true },
          { unitId: "calc_s2", quote: "58.5 g", valid: true },
        ],
      },
      expectedScore: 1,
    },
    {
      id: "unit_error_same_number",
      category: "unit_error",
      description: "Correct number but wrong unit (g instead of mol)",
      question: "Calculate the moles of gas. (1 mark)",
      maxScore: 1,
      referenceModelAnswer: "2 mol",
      studentAnswer: "2 g",
      llmUdm: {
        ...baseUdm(),
        unitsDemonstrated: [{ unitId: "calc_final", quote: "2 g", valid: true }],
      },
      expectedScore: 0,
    },
    {
      id: "valid_full_working",
      category: "valid_working",
      description: "Correct sequential working should retain full marks",
      question: "Calculate moles of gas at r.t.p. (3 marks)",
      maxScore: 3,
      referenceModelAnswer: "2 mol",
      studentAnswer: "n = V/24\nn = 48/24 = 2\n2 mol",
      llmUdm: {
        ...baseUdm(),
        unitsDemonstrated: [
          { unitId: "calc_s1", quote: "n = V/24", valid: true },
          { unitId: "calc_s2", quote: "n = 48/24 = 2", valid: true },
          { unitId: "calc_s3", quote: "2 mol", valid: true },
        ],
      },
      expectedScore: 3,
    },
    {
      id: "long_reference_final_preserved",
      category: "long_reference",
      description: "Long reference blob must not reject correct final 58.5 g",
      question: "Calculate the mass of sodium chloride when 1 mole of NaCl is formed. (2 marks)",
      maxScore: 2,
      referenceModelAnswer: longRef,
      studentAnswer: "Mass = n × Mr\nMass = 1 × 58.5 = 58.5 g",
      llmUdm: {
        ...baseUdm(),
        unitsDemonstrated: [
          { unitId: "calc_s1", quote: "Mass = n × Mr", valid: true },
          { unitId: "calc_s2", quote: "Mass = 1 × 58.5 = 58.5 g", valid: true },
        ],
      },
      expectedScore: 2,
    },
    {
      id: "answer_only_one_mol",
      category: "valid_working",
      description: "1 mol must match reference 1.0 mol for 1-mark answer-only",
      question: "Calculate the number of moles of magnesium in 24 g of magnesium. [Ar = 24] (1 mark)",
      maxScore: 1,
      referenceModelAnswer: "Final answer: 1.0 mol",
      studentAnswer: "1 mol",
      llmUdm: {
        ...baseUdm(),
        unitsDemonstrated: [{ unitId: "calc_final", quote: "1 mol", valid: false }],
        invalidClaims: [
          {
            text: "1 mol",
            reason: "Must be 1.0 mol for precision",
          },
        ],
      },
      expectedScore: 1,
    },
  ];
}
