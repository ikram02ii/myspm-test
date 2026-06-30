// Re-grades only the FAILED questions from the last test-marking run and
// dumps the rubric the marking agent built for each (markBreakdown + rubric
// ideas), so we can see WHY each lost a mark. Read-only analysis tool.

const FAILED = [
  // ---- THEORY fails ----
  { label: "ACID6-001", type: "theory", expected: 2, actual: 1, maxScore: 2,
    question: "State the meaning of an acid.",
    studentAnswer: "An acid is a chemical substance that ionises in water to produce hydrogen ions, H⁺." },
  { label: "ACID6-002", type: "theory", expected: 2, actual: 1, maxScore: 2,
    question: "State the meaning of an acid.",
    studentAnswer: "A substance that produces hydrogen ions in water." },
  { label: "ACID6-004", type: "theory", expected: 2, actual: 1, maxScore: 2,
    question: "State the meaning of an alkali.",
    studentAnswer: "An alkali is a base that dissolves in water to produce hydroxide ions, OH⁻." },
  { label: "ACID6-005", type: "theory", expected: 2, actual: 1, maxScore: 2,
    question: "State the meaning of an alkali.",
    studentAnswer: "A substance that produces hydroxide ions in water." },
  { label: "ACID6-007", type: "theory", expected: 2, actual: 1, maxScore: 2,
    question: "Explain the role of water in showing the acidic properties of an acid.",
    studentAnswer: "Water allows the acid to ionise to produce hydrogen ions, H⁺, which are responsible for acidic properties." },
  { label: "ACID6-009", type: "theory", expected: 2, actual: 1, maxScore: 2,
    question: "State one chemical property of an acid.",
    studentAnswer: "Acids react with reactive metals to produce salt and hydrogen gas." },
  { label: "ACID6-010", type: "theory", expected: 2, actual: 1, maxScore: 2,
    question: "State one chemical property of an alkali.",
    studentAnswer: "Alkalis react with acids to produce salt and water in a neutralisation reaction." },
  { label: "ACID6-011", type: "theory", expected: 2, actual: 1, maxScore: 2,
    question: "State what is measured by the pH scale.",
    studentAnswer: "The pH scale measures the concentration of hydrogen ions in a solution, showing how acidic or alkaline it is." },
  { label: "ACID6-018", type: "theory", expected: 2, actual: 1, maxScore: 2,
    question: "Explain why the pH value decreases as the concentration of hydrogen ions increases.",
    studentAnswer: "A higher concentration of hydrogen ions makes the solution more acidic, and a more acidic solution has a lower pH value." },
  { label: "ACID6-030", type: "theory", expected: 2, actual: 1, maxScore: 2,
    question: "Explain why ethanoic acid is a weak acid.",
    studentAnswer: "Ethanoic acid ionises only partially in water to produce a low concentration of hydrogen ions." },
  { label: "ACID6-076", type: "theory", expected: 2, actual: 1, maxScore: 2,
    question: "Write the ionic equation for a neutralisation reaction.",
    studentAnswer: "H⁺ + OH⁻ → H₂O" },
  { label: "ACID6-077", type: "theory", expected: 2, actual: 0, maxScore: 2,
    question: "State the colour change of methyl orange at the end point when an acid is titrated into an alkali.",
    studentAnswer: "From yellow to orange/red." },
  { label: "ACID6-091", type: "theory", expected: 1, actual: 0, maxScore: 1,
    question: "Name one insoluble salt.",
    studentAnswer: "Barium sulphate" },
  { label: "ACID6-093", type: "theory", expected: 2, actual: 0, maxScore: 2,
    question: "Name the method used to prepare a soluble salt of sodium.",
    studentAnswer: "Titration method (acid-alkali neutralisation)." },
  { label: "ACID6-096", type: "theory", expected: 2, actual: 1, maxScore: 2,
    question: "Explain why excess solid is used when preparing a soluble salt by reacting an acid with an insoluble base.",
    studentAnswer: "Excess solid is used to ensure all the acid has reacted, and the excess can then be filtered off." },
  { label: "ACID6-098", type: "theory", expected: 2, actual: 1, maxScore: 2,
    question: "State the meaning of the term 'precipitation' in salt preparation.",
    studentAnswer: "Mixing two solutions of soluble salts to form an insoluble salt that settles out as a solid." },

  // ---- CALCULATION fails ----
  { label: "ACID6-035", type: "calc", expected: 1, actual: 0, maxScore: 3,
    question: "Calculate the number of moles of sodium hydroxide in 500 cm³ of a 2 mol dm⁻³ solution.",
    studentAnswer: "1 mol" },
  { label: "ACID6-043", type: "calc", expected: 3, actual: 2, maxScore: 3,
    question: "Calculate the mass of sodium hydroxide required to prepare 250 cm³ of a 1 mol dm⁻³ solution. (Mr: NaOH = 40)",
    studentAnswer: "Moles = concentration × volume = 1 × 0.25 = 0.25 mol\nMass = moles × molar mass = 0.25 × 40 = 10 g" },
  { label: "ACID6-046", type: "calc", expected: 3, actual: 2, maxScore: 3,
    question: "Calculate the concentration, in mol dm⁻³, when 4 g of sodium hydroxide is dissolved in water to make 100 cm³ of solution. (Mr: NaOH = 40)",
    studentAnswer: "Moles = 4 ÷ 40 = 0.1 mol\nConcentration = 0.1 ÷ 0.1 = 1 mol dm⁻³" },
  { label: "ACID6-048", type: "calc", expected: 3, actual: 2, maxScore: 3,
    question: "Calculate the number of moles of hydrogen ions in 250 cm³ of a 0.2 mol dm⁻³ sulphuric acid solution. (H₂SO₄ is diprotic)",
    studentAnswer: "Moles of acid = 0.2 × 0.25 = 0.05 mol\nMoles of H⁺ = 2 × 0.05 = 0.1 mol" },
  { label: "ACID6-050", type: "calc", expected: 3, actual: 2, maxScore: 3,
    question: "Calculate the mass of hydrochloric acid present in 200 cm³ of a 0.5 mol dm⁻³ solution. (Mr: HCl = 36.5)",
    studentAnswer: "Moles = 0.5 × 0.2 = 0.1 mol\nMass = 0.1 × 36.5 = 3.65 g" },
  { label: "ACID6-055", type: "calc", expected: 1, actual: 0, maxScore: 3,
    question: "Calculate the volume of water that must be added to 50 cm³ of a 1 mol dm⁻³ solution to dilute it to 0.2 mol dm⁻³.",
    studentAnswer: "200 cm³" },
  { label: "ACID6-059", type: "calc", expected: 3, actual: 2, maxScore: 3,
    question: "In a titration, 25.0 cm³ of sodium hydroxide solution is neutralised by 25.0 cm³ of 0.1 mol dm⁻³ hydrochloric acid. Calculate the concentration of the sodium hydroxide solution. HCl + NaOH → NaCl + H₂O.",
    studentAnswer: "MaVa = MbVb (ratio 1:1)\n0.1 × 25 = Mb × 25\nMb = 2.5 ÷ 25 = 0.1 mol dm⁻³" },
  { label: "ACID6-061", type: "calc", expected: 3, actual: 1, maxScore: 3,
    question: "25.0 cm³ of 0.1 mol dm⁻³ sodium hydroxide is neutralised by hydrochloric acid of concentration 0.2 mol dm⁻³. Calculate the volume of acid required. HCl + NaOH → NaCl + H₂O.",
    studentAnswer: "MaVa = MbVb (ratio 1:1)\n0.2 × Va = 0.1 × 25\nVa = 2.5 ÷ 0.2 = 12.5 cm³" },
  { label: "ACID6-065", type: "calc", expected: 3, actual: 2, maxScore: 3,
    question: "20.0 cm³ of sodium hydroxide solution is neutralised by 10.0 cm³ of 0.5 mol dm⁻³ sulphuric acid. Calculate the concentration of the sodium hydroxide. H₂SO₄ + 2NaOH → Na₂SO₄ + 2H₂O.",
    studentAnswer: "Moles of acid = 0.5 × 0.010 = 0.005 mol\nMoles of NaOH = 2 × 0.005 = 0.01 mol\nConcentration = 0.01 ÷ 0.020 = 0.5 mol dm⁻³" },
  { label: "ACID6-067", type: "calc", expected: 3, actual: 2, maxScore: 3,
    question: "Calculate the volume of 0.1 mol dm⁻³ sulphuric acid needed to neutralise 20.0 cm³ of 0.1 mol dm⁻³ sodium hydroxide. H₂SO₄ + 2NaOH → Na₂SO₄ + 2H₂O.",
    studentAnswer: "Moles of NaOH = 0.1 × 0.020 = 0.002 mol\nMoles of acid = 0.002 ÷ 2 = 0.001 mol\nVolume = 0.001 ÷ 0.1 = 0.01 dm³ = 10 cm³" },
  { label: "ACID6-069", type: "calc", expected: 3, actual: 2, maxScore: 3,
    question: "30.0 cm³ of 0.2 mol dm⁻³ hydrochloric acid is neutralised by potassium hydroxide solution. Calculate the number of moles of potassium hydroxide that reacted. HCl + KOH → KCl + H₂O.",
    studentAnswer: "Moles of HCl = 0.2 × 0.030 = 0.006 mol\nRatio 1:1, so moles of KOH = 0.006 mol" },
  { label: "ACID6-071", type: "calc", expected: 3, actual: 2, maxScore: 3,
    question: "A titration uses 24.0 cm³ of 0.25 mol dm⁻³ hydrochloric acid to neutralise 25.0 cm³ of sodium hydroxide. Calculate the concentration of the sodium hydroxide. HCl + NaOH → NaCl + H₂O.",
    studentAnswer: "Moles of HCl = 0.25 × 0.024 = 0.006 mol\nMoles of NaOH = 0.006 mol (1:1)\nConcentration = 0.006 ÷ 0.025 = 0.24 mol dm⁻³" },
  { label: "ACID6-073", type: "calc", expected: 3, actual: 2, maxScore: 3,
    question: "Calculate the volume of 0.5 mol dm⁻³ hydrochloric acid required to neutralise 25.0 cm³ of 0.5 mol dm⁻³ sodium hydroxide. HCl + NaOH → NaCl + H₂O.",
    studentAnswer: "MaVa = MbVb (1:1)\n0.5 × Va = 0.5 × 25\nVa = 25 cm³" },
  { label: "ACID6-087", type: "calc", expected: 3, actual: 2, maxScore: 3,
    question: "Calculate the number of moles of carbon dioxide produced when 0.05 mol of calcium carbonate reacts completely with hydrochloric acid. CaCO₃ + 2HCl → CaCl₂ + H₂O + CO₂.",
    studentAnswer: "Mole ratio CaCO₃ : CO₂ = 1 : 1\nMoles of CO₂ = 0.05 mol" },
];

const GRADE_URL = process.env.GRADE_URL || "http://localhost:3000/api/rag/grade";

async function gradeOne(q) {
  const res = await fetch(GRADE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: q.question,
      studentAnswer: q.studentAnswer,
      subject: "Chemistry",
      form: "4",
      maxScore: q.maxScore,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

function fmtBreakdown(bd) {
  if (!Array.isArray(bd) || bd.length === 0) return "    (no markBreakdown returned)";
  return bd
    .map((r) => {
      const mark = r.awarded ? `+${r.marks}` : ` 0`;
      const tick = r.awarded ? "[AWARDED]" : "[WITHHELD]";
      return `    ${tick} ${mark}  idea: ${r.idea}\n             reason: ${r.reason ?? "(none)"}`;
    })
    .join("\n");
}

async function main() {
  console.log(`\nRetrieving rubrics for ${FAILED.length} failed questions via ${GRADE_URL}\n`);

  for (const q of FAILED) {
    try {
      const r = await gradeOne(q);
      console.log("============================================================");
      console.log(`${q.label}  [${q.type}]  expected=${q.expected}  prevActual=${q.actual}  nowScore=${r.score}/${r.maxScore}`);
      console.log(`Q: ${q.question}`);
      console.log(`A: ${q.studentAnswer.replace(/\n/g, " | ")}`);
      console.log(`Intent/type: ${r.questionAnalysis?.questionType ?? "?"}  command=${r.questionAnalysis?.commandWord ?? "?"}`);
      console.log(`Rubric ideas (${(r.rubricIdeas || []).length}):`);
      (r.rubricIdeas || []).forEach((idea, i) => console.log(`    ${i + 1}. ${idea}`));
      console.log(`Mark breakdown:`);
      console.log(fmtBreakdown(r.markBreakdown));
      console.log(`Matched: ${JSON.stringify(r.matchedIdeas || [])}`);
      console.log(`Missing: ${JSON.stringify(r.missingIdeas || [])}`);
      if (r.modelAnswer) console.log(`Model answer: ${String(r.modelAnswer).replace(/\n/g, " | ")}`);
      console.log("");
    } catch (err) {
      console.log(`${q.label}  ERROR  ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
