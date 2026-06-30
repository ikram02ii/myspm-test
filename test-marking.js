const QUESTIONS = [

  // =====================================================
  // CHAPTER 6: ACIDS, BASES AND SALTS (Form 4 Chemistry)
  // 100 questions — mix of CALCULATION and THEORY to test the
  // marking agent across question types.
  // Answer quality varies: full working (full marks),
  // answer-only (partial), wrong method / wrong answer (0).
  // =====================================================

  // ---------- A. Meaning of acids and alkalis (theory) ----------
  {
  label: "ACID6-001",
  question: "State the meaning of an acid.",
  studentAnswer: "An acid is a chemical substance that ionises in water to produce hydrogen ions, H⁺.",
  expectedScore: 2,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-002",
  question: "State the meaning of an acid.",
  studentAnswer: "A substance that produces hydrogen ions in water.",
  expectedScore: 2,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-003",
  question: "State the meaning of an acid.",
  studentAnswer: "A substance that produces hydroxide ions in water.",
  expectedScore: 0,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-004",
  question: "State the meaning of an alkali.",
  studentAnswer: "An alkali is a base that dissolves in water to produce hydroxide ions, OH⁻.",
  expectedScore: 2,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-005",
  question: "State the meaning of an alkali.",
  studentAnswer: "A substance that produces hydroxide ions in water.",
  expectedScore: 2,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-006",
  question: "State the meaning of an alkali.",
  studentAnswer: "A substance that produces hydrogen ions in water.",
  expectedScore: 0,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-007",
  question: "Explain the role of water in showing the acidic properties of an acid.",
  studentAnswer: "Water allows the acid to ionise to produce hydrogen ions, H⁺, which are responsible for acidic properties.",
  expectedScore: 2,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-008",
  question: "Explain the role of water in showing the acidic properties of an acid.",
  studentAnswer: "Without water the acid cannot ionise, so it cannot show acidic properties.",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-009",
  question: "State one chemical property of an acid.",
  studentAnswer: "Acids react with reactive metals to produce salt and hydrogen gas.",
  expectedScore: 2,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-010",
  question: "State one chemical property of an alkali.",
  studentAnswer: "Alkalis react with acids to produce salt and water in a neutralisation reaction.",
  expectedScore: 2,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  // ---------- B. pH scale and indicators (theory) ----------
  {
  label: "ACID6-011",
  question: "State what is measured by the pH scale.",
  studentAnswer: "The pH scale measures the concentration of hydrogen ions in a solution, showing how acidic or alkaline it is.",
  expectedScore: 2,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-012",
  question: "State the pH value of a neutral solution.",
  studentAnswer: "7",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 1,
  },

  {
  label: "ACID6-013",
  question: "State the pH value of a neutral solution.",
  studentAnswer: "14",
  expectedScore: 0,
  subject: "Chemistry",
  form: "4",
  maxScore: 1,
  },

  {
  label: "ACID6-014",
  question: "A solution has a pH of 2. State whether it is acidic, neutral or alkaline.",
  studentAnswer: "Acidic",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 1,
  },

  {
  label: "ACID6-015",
  question: "A solution has a pH of 13. State whether it is acidic, neutral or alkaline.",
  studentAnswer: "Alkaline",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 1,
  },

  {
  label: "ACID6-016",
  question: "State the colour of red litmus paper in an alkaline solution.",
  studentAnswer: "Blue",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 1,
  },

  {
  label: "ACID6-017",
  question: "State the colour of blue litmus paper in an acidic solution.",
  studentAnswer: "Red",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 1,
  },

  {
  label: "ACID6-018",
  question: "Explain why the pH value decreases as the concentration of hydrogen ions increases.",
  studentAnswer: "A higher concentration of hydrogen ions makes the solution more acidic, and a more acidic solution has a lower pH value.",
  expectedScore: 2,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-019",
  question: "Name a suitable indicator that gives different colours in acid and alkali.",
  studentAnswer: "Phenolphthalein",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 1,
  },

  {
  label: "ACID6-020",
  question: "State the colour of phenolphthalein in an alkaline solution.",
  studentAnswer: "Pink",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 1,
  },

  // ---------- C. Strength vs concentration (theory) ----------
  {
  label: "ACID6-021",
  question: "State the difference between a strong acid and a weak acid.",
  studentAnswer: "A strong acid ionises completely in water, while a weak acid ionises only partially in water.",
  expectedScore: 2,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-022",
  question: "State the difference between a strong acid and a weak acid.",
  studentAnswer: "A strong acid ionises completely while a weak acid only ionises a little.",
  expectedScore: 2,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-023",
  question: "State the difference between a strong acid and a weak acid.",
  studentAnswer: "A strong acid is more concentrated than a weak acid.",
  expectedScore: 0,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-024",
  question: "Name one example of a strong acid.",
  studentAnswer: "Hydrochloric acid",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 1,
  },

  {
  label: "ACID6-025",
  question: "Name one example of a weak acid.",
  studentAnswer: "Ethanoic acid",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 1,
  },

  {
  label: "ACID6-026",
  question: "Explain the meaning of a concentrated acid.",
  studentAnswer: "A concentrated acid has a large amount of acid dissolved in a small volume of water, giving a high number of moles of acid per dm³.",
  expectedScore: 2,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-027",
  question: "State the meaning of a monoprotic acid.",
  studentAnswer: "An acid that produces one mole of hydrogen ions from one mole of acid molecules.",
  expectedScore: 2,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-028",
  question: "State the basicity of sulphuric acid, H₂SO₄.",
  studentAnswer: "2",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 1,
  },

  {
  label: "ACID6-029",
  question: "State the basicity of hydrochloric acid, HCl.",
  studentAnswer: "1",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 1,
  },

  {
  label: "ACID6-030",
  question: "Explain why ethanoic acid is a weak acid.",
  studentAnswer: "Ethanoic acid ionises only partially in water to produce a low concentration of hydrogen ions.",
  expectedScore: 2,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  // ---------- D. Concentration calculations (calc) ----------
  {
  label: "ACID6-031",
  question: "Calculate the concentration, in mol dm⁻³, of a solution containing 0.5 mol of hydrochloric acid in 250 cm³ of solution.",
  studentAnswer: "Concentration = number of moles ÷ volume (dm³)\n= 0.5 ÷ 0.25\n= 2 mol dm⁻³",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-032",
  question: "Calculate the concentration, in mol dm⁻³, of a solution containing 0.5 mol of hydrochloric acid in 250 cm³ of solution.",
  studentAnswer: "2 mol dm⁻³",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-033",
  question: "Calculate the concentration, in mol dm⁻³, of a solution containing 0.5 mol of hydrochloric acid in 250 cm³ of solution.",
  studentAnswer: "0.5 ÷ 250 = 0.002 mol dm⁻³",
  expectedScore: 0,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-034",
  question: "Calculate the number of moles of sodium hydroxide in 500 cm³ of a 2 mol dm⁻³ solution.",
  studentAnswer: "Number of moles = concentration × volume (dm³)\n= 2 × 0.5\n= 1 mol",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-035",
  question: "Calculate the number of moles of sodium hydroxide in 500 cm³ of a 2 mol dm⁻³ solution.",
  studentAnswer: "1 mol",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-036",
  question: "Calculate the concentration, in g dm⁻³, of a 2 mol dm⁻³ sodium hydroxide solution. (Mr: NaOH = 40)",
  studentAnswer: "Concentration (g dm⁻³) = concentration (mol dm⁻³) × molar mass\n= 2 × 40\n= 80 g dm⁻³",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-037",
  question: "Calculate the concentration, in g dm⁻³, of a 2 mol dm⁻³ sodium hydroxide solution. (Mr: NaOH = 40)",
  studentAnswer: "80 g dm⁻³",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-038",
  question: "Calculate the concentration, in g dm⁻³, of a 2 mol dm⁻³ sodium hydroxide solution. (Mr: NaOH = 40)",
  studentAnswer: "2 ÷ 40 = 0.05 g dm⁻³",
  expectedScore: 0,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-039",
  question: "Calculate the concentration, in mol dm⁻³, of a sodium hydroxide solution that has a concentration of 80 g dm⁻³. (Mr: NaOH = 40)",
  studentAnswer: "Concentration (mol dm⁻³) = concentration (g dm⁻³) ÷ molar mass\n= 80 ÷ 40\n= 2 mol dm⁻³",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-040",
  question: "Calculate the concentration, in mol dm⁻³, of a sodium hydroxide solution that has a concentration of 80 g dm⁻³. (Mr: NaOH = 40)",
  studentAnswer: "2 mol dm⁻³",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-041",
  question: "Calculate the number of moles of solute in 250 cm³ of a 0.1 mol dm⁻³ hydrochloric acid solution.",
  studentAnswer: "Number of moles = concentration × volume (dm³)\n= 0.1 × 0.25\n= 0.025 mol",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-042",
  question: "Calculate the number of moles of solute in 250 cm³ of a 0.1 mol dm⁻³ hydrochloric acid solution.",
  studentAnswer: "0.025 mol",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-043",
  question: "Calculate the mass of sodium hydroxide required to prepare 250 cm³ of a 1 mol dm⁻³ solution. (Mr: NaOH = 40)",
  studentAnswer: "Moles = concentration × volume = 1 × 0.25 = 0.25 mol\nMass = moles × molar mass = 0.25 × 40 = 10 g",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-044",
  question: "Calculate the mass of sodium hydroxide required to prepare 250 cm³ of a 1 mol dm⁻³ solution. (Mr: NaOH = 40)",
  studentAnswer: "10 g",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-045",
  question: "Calculate the mass of sodium hydroxide required to prepare 250 cm³ of a 1 mol dm⁻³ solution. (Mr: NaOH = 40)",
  studentAnswer: "1 × 40 = 40 g",
  expectedScore: 0,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-046",
  question: "Calculate the concentration, in mol dm⁻³, when 4 g of sodium hydroxide is dissolved in water to make 100 cm³ of solution. (Mr: NaOH = 40)",
  studentAnswer: "Moles = 4 ÷ 40 = 0.1 mol\nConcentration = 0.1 ÷ 0.1 = 1 mol dm⁻³",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-047",
  question: "Calculate the concentration, in mol dm⁻³, when 4 g of sodium hydroxide is dissolved in water to make 100 cm³ of solution. (Mr: NaOH = 40)",
  studentAnswer: "1 mol dm⁻³",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-048",
  question: "Calculate the number of moles of hydrogen ions in 250 cm³ of a 0.2 mol dm⁻³ sulphuric acid solution. (H₂SO₄ is diprotic)",
  studentAnswer: "Moles of acid = 0.2 × 0.25 = 0.05 mol\nMoles of H⁺ = 2 × 0.05 = 0.1 mol",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-049",
  question: "Calculate the number of moles of hydrogen ions in 250 cm³ of a 0.2 mol dm⁻³ sulphuric acid solution. (H₂SO₄ is diprotic)",
  studentAnswer: "0.1 mol",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-050",
  question: "Calculate the mass of hydrochloric acid present in 200 cm³ of a 0.5 mol dm⁻³ solution. (Mr: HCl = 36.5)",
  studentAnswer: "Moles = 0.5 × 0.2 = 0.1 mol\nMass = 0.1 × 36.5 = 3.65 g",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  // ---------- E. Dilution (calc) ----------
  {
  label: "ACID6-051",
  question: "Calculate the concentration of the diluted solution when 25 cm³ of a 2 mol dm⁻³ hydrochloric acid is diluted with water to 100 cm³.",
  studentAnswer: "M₁V₁ = M₂V₂\n2 × 25 = M₂ × 100\nM₂ = 50 ÷ 100 = 0.5 mol dm⁻³",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-052",
  question: "Calculate the concentration of the diluted solution when 25 cm³ of a 2 mol dm⁻³ hydrochloric acid is diluted with water to 100 cm³.",
  studentAnswer: "0.5 mol dm⁻³",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-053",
  question: "Calculate the concentration of the diluted solution when 25 cm³ of a 2 mol dm⁻³ hydrochloric acid is diluted with water to 100 cm³.",
  studentAnswer: "2 × 100 = 200 mol dm⁻³",
  expectedScore: 0,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-054",
  question: "Calculate the volume of water that must be added to 50 cm³ of a 1 mol dm⁻³ solution to dilute it to 0.2 mol dm⁻³.",
  studentAnswer: "M₁V₁ = M₂V₂\n1 × 50 = 0.2 × V₂\nV₂ = 50 ÷ 0.2 = 250 cm³\nWater added = 250 − 50 = 200 cm³",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-055",
  question: "Calculate the volume of water that must be added to 50 cm³ of a 1 mol dm⁻³ solution to dilute it to 0.2 mol dm⁻³.",
  studentAnswer: "200 cm³",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-056",
  question: "Calculate the final concentration when 100 cm³ of a 0.4 mol dm⁻³ solution is diluted to 200 cm³.",
  studentAnswer: "M₁V₁ = M₂V₂\n0.4 × 100 = M₂ × 200\nM₂ = 40 ÷ 200 = 0.2 mol dm⁻³",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-057",
  question: "Calculate the final concentration when 100 cm³ of a 0.4 mol dm⁻³ solution is diluted to 200 cm³.",
  studentAnswer: "0.2 mol dm⁻³",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-058",
  question: "Calculate the volume of a 2 mol dm⁻³ stock solution needed to prepare 250 cm³ of a 0.1 mol dm⁻³ solution.",
  studentAnswer: "M₁V₁ = M₂V₂\n2 × V₁ = 0.1 × 250\nV₁ = 25 ÷ 2 = 12.5 cm³",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  // ---------- F. Titration / neutralisation (calc) ----------
  {
  label: "ACID6-059",
  question: "In a titration, 25.0 cm³ of sodium hydroxide solution is neutralised by 25.0 cm³ of 0.1 mol dm⁻³ hydrochloric acid. Calculate the concentration of the sodium hydroxide solution. HCl + NaOH → NaCl + H₂O.",
  studentAnswer: "MaVa = MbVb (ratio 1:1)\n0.1 × 25 = Mb × 25\nMb = 2.5 ÷ 25 = 0.1 mol dm⁻³",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-060",
  question: "In a titration, 25.0 cm³ of sodium hydroxide solution is neutralised by 25.0 cm³ of 0.1 mol dm⁻³ hydrochloric acid. Calculate the concentration of the sodium hydroxide solution. HCl + NaOH → NaCl + H₂O.",
  studentAnswer: "0.1 mol dm⁻³",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-061",
  question: "25.0 cm³ of 0.1 mol dm⁻³ sodium hydroxide is neutralised by hydrochloric acid of concentration 0.2 mol dm⁻³. Calculate the volume of acid required. HCl + NaOH → NaCl + H₂O.",
  studentAnswer: "MaVa = MbVb (ratio 1:1)\n0.2 × Va = 0.1 × 25\nVa = 2.5 ÷ 0.2 = 12.5 cm³",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-062",
  question: "25.0 cm³ of 0.1 mol dm⁻³ sodium hydroxide is neutralised by hydrochloric acid of concentration 0.2 mol dm⁻³. Calculate the volume of acid required. HCl + NaOH → NaCl + H₂O.",
  studentAnswer: "12.5 cm³",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-063",
  question: "Calculate the number of moles of hydrochloric acid in 25.0 cm³ of a 0.1 mol dm⁻³ solution.",
  studentAnswer: "Moles = concentration × volume (dm³)\n= 0.1 × 0.025\n= 0.0025 mol",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-064",
  question: "Calculate the number of moles of hydrochloric acid in 25.0 cm³ of a 0.1 mol dm⁻³ solution.",
  studentAnswer: "0.0025 mol",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-065",
  question: "20.0 cm³ of sodium hydroxide solution is neutralised by 10.0 cm³ of 0.5 mol dm⁻³ sulphuric acid. Calculate the concentration of the sodium hydroxide. H₂SO₄ + 2NaOH → Na₂SO₄ + 2H₂O.",
  studentAnswer: "Moles of acid = 0.5 × 0.010 = 0.005 mol\nMoles of NaOH = 2 × 0.005 = 0.01 mol\nConcentration = 0.01 ÷ 0.020 = 0.5 mol dm⁻³",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-066",
  question: "20.0 cm³ of sodium hydroxide solution is neutralised by 10.0 cm³ of 0.5 mol dm⁻³ sulphuric acid. Calculate the concentration of the sodium hydroxide. H₂SO₄ + 2NaOH → Na₂SO₄ + 2H₂O.",
  studentAnswer: "0.5 mol dm⁻³",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-067",
  question: "Calculate the volume of 0.1 mol dm⁻³ sulphuric acid needed to neutralise 20.0 cm³ of 0.1 mol dm⁻³ sodium hydroxide. H₂SO₄ + 2NaOH → Na₂SO₄ + 2H₂O.",
  studentAnswer: "Moles of NaOH = 0.1 × 0.020 = 0.002 mol\nMoles of acid = 0.002 ÷ 2 = 0.001 mol\nVolume = 0.001 ÷ 0.1 = 0.01 dm³ = 10 cm³",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-068",
  question: "Calculate the volume of 0.1 mol dm⁻³ sulphuric acid needed to neutralise 20.0 cm³ of 0.1 mol dm⁻³ sodium hydroxide. H₂SO₄ + 2NaOH → Na₂SO₄ + 2H₂O.",
  studentAnswer: "10 cm³",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-069",
  question: "30.0 cm³ of 0.2 mol dm⁻³ hydrochloric acid is neutralised by potassium hydroxide solution. Calculate the number of moles of potassium hydroxide that reacted. HCl + KOH → KCl + H₂O.",
  studentAnswer: "Moles of HCl = 0.2 × 0.030 = 0.006 mol\nRatio 1:1, so moles of KOH = 0.006 mol",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-070",
  question: "30.0 cm³ of 0.2 mol dm⁻³ hydrochloric acid is neutralised by potassium hydroxide solution. Calculate the number of moles of potassium hydroxide that reacted. HCl + KOH → KCl + H₂O.",
  studentAnswer: "0.006 mol",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-071",
  question: "A titration uses 24.0 cm³ of 0.25 mol dm⁻³ hydrochloric acid to neutralise 25.0 cm³ of sodium hydroxide. Calculate the concentration of the sodium hydroxide. HCl + NaOH → NaCl + H₂O.",
  studentAnswer: "Moles of HCl = 0.25 × 0.024 = 0.006 mol\nMoles of NaOH = 0.006 mol (1:1)\nConcentration = 0.006 ÷ 0.025 = 0.24 mol dm⁻³",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-072",
  question: "A titration uses 24.0 cm³ of 0.25 mol dm⁻³ hydrochloric acid to neutralise 25.0 cm³ of sodium hydroxide. Calculate the concentration of the sodium hydroxide. HCl + NaOH → NaCl + H₂O.",
  studentAnswer: "0.24 mol dm⁻³",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-073",
  question: "Calculate the volume of 0.5 mol dm⁻³ hydrochloric acid required to neutralise 25.0 cm³ of 0.5 mol dm⁻³ sodium hydroxide. HCl + NaOH → NaCl + H₂O.",
  studentAnswer: "MaVa = MbVb (1:1)\n0.5 × Va = 0.5 × 25\nVa = 25 cm³",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-074",
  question: "Calculate the volume of 0.5 mol dm⁻³ hydrochloric acid required to neutralise 25.0 cm³ of 0.5 mol dm⁻³ sodium hydroxide. HCl + NaOH → NaCl + H₂O.",
  studentAnswer: "25 cm³",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-075",
  question: "State the meaning of neutralisation.",
  studentAnswer: "A chemical reaction between an acid and a base to produce salt and water.",
  expectedScore: 2,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-076",
  question: "Write the ionic equation for a neutralisation reaction.",
  studentAnswer: "H⁺ + OH⁻ → H₂O",
  expectedScore: 2,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-077",
  question: "State the colour change of methyl orange at the end point when an acid is titrated into an alkali.",
  studentAnswer: "From yellow to orange/red.",
  expectedScore: 2,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-078",
  question: "Name the apparatus used to measure the volume of acid added during a titration.",
  studentAnswer: "Burette",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 1,
  },

  // ---------- G. Reacting masses / mass of salt (calc) ----------
  {
  label: "ACID6-079",
  question: "Calculate the mass of sodium chloride formed when 0.1 mol of hydrochloric acid reacts completely with sodium hydroxide. HCl + NaOH → NaCl + H₂O. (Mr: NaCl = 58.5)",
  studentAnswer: "Mole ratio HCl : NaCl = 1 : 1\nMoles of NaCl = 0.1 mol\nMass = 0.1 × 58.5 = 5.85 g",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-080",
  question: "Calculate the mass of sodium chloride formed when 0.1 mol of hydrochloric acid reacts completely with sodium hydroxide. HCl + NaOH → NaCl + H₂O. (Mr: NaCl = 58.5)",
  studentAnswer: "5.85 g",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-081",
  question: "Calculate the mass of copper(II) oxide needed to react completely with 0.2 mol of sulphuric acid. CuO + H₂SO₄ → CuSO₄ + H₂O. (Mr: CuO = 80)",
  studentAnswer: "Mole ratio CuO : H₂SO₄ = 1 : 1\nMoles of CuO = 0.2 mol\nMass = 0.2 × 80 = 16 g",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-082",
  question: "Calculate the mass of copper(II) oxide needed to react completely with 0.2 mol of sulphuric acid. CuO + H₂SO₄ → CuSO₄ + H₂O. (Mr: CuO = 80)",
  studentAnswer: "16 g",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-083",
  question: "Calculate the mass of zinc sulphate formed when 0.1 mol of zinc reacts completely with sulphuric acid. Zn + H₂SO₄ → ZnSO₄ + H₂. (Mr: ZnSO₄ = 161)",
  studentAnswer: "Mole ratio Zn : ZnSO₄ = 1 : 1\nMoles of ZnSO₄ = 0.1 mol\nMass = 0.1 × 161 = 16.1 g",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-084",
  question: "Calculate the mass of zinc sulphate formed when 0.1 mol of zinc reacts completely with sulphuric acid. Zn + H₂SO₄ → ZnSO₄ + H₂. (Mr: ZnSO₄ = 161)",
  studentAnswer: "16.1 g",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-085",
  question: "Calculate the volume of hydrogen gas, in dm³, produced at room conditions when 0.1 mol of magnesium reacts completely with excess hydrochloric acid. Mg + 2HCl → MgCl₂ + H₂. (Molar volume = 24 dm³ mol⁻¹)",
  studentAnswer: "Mole ratio Mg : H₂ = 1 : 1\nMoles of H₂ = 0.1 mol\nVolume = 0.1 × 24 = 2.4 dm³",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-086",
  question: "Calculate the volume of hydrogen gas, in dm³, produced at room conditions when 0.1 mol of magnesium reacts completely with excess hydrochloric acid. Mg + 2HCl → MgCl₂ + H₂. (Molar volume = 24 dm³ mol⁻¹)",
  studentAnswer: "2.4 dm³",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-087",
  question: "Calculate the number of moles of carbon dioxide produced when 0.05 mol of calcium carbonate reacts completely with hydrochloric acid. CaCO₃ + 2HCl → CaCl₂ + H₂O + CO₂.",
  studentAnswer: "Mole ratio CaCO₃ : CO₂ = 1 : 1\nMoles of CO₂ = 0.05 mol",
  expectedScore: 3,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  {
  label: "ACID6-088",
  question: "Calculate the number of moles of carbon dioxide produced when 0.05 mol of calcium carbonate reacts completely with hydrochloric acid. CaCO₃ + 2HCl → CaCl₂ + H₂O + CO₂.",
  studentAnswer: "0.05 mol",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 3,
  },

  // ---------- H. Salt preparation & solubility (theory) ----------
  {
  label: "ACID6-089",
  question: "State the meaning of a salt.",
  studentAnswer: "A salt is a compound formed when the hydrogen ion of an acid is replaced by a metal ion or ammonium ion.",
  expectedScore: 2,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-090",
  question: "Name one soluble salt.",
  studentAnswer: "Sodium chloride",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 1,
  },

  {
  label: "ACID6-091",
  question: "Name one insoluble salt.",
  studentAnswer: "Barium sulphate",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 1,
  },

  {
  label: "ACID6-092",
  question: "State whether all nitrate salts are soluble in water.",
  studentAnswer: "Yes, all nitrate salts are soluble in water.",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 1,
  },

  {
  label: "ACID6-093",
  question: "Name the method used to prepare a soluble salt of sodium.",
  studentAnswer: "Titration method (acid-alkali neutralisation).",
  expectedScore: 2,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-094",
  question: "Name the method used to prepare an insoluble salt.",
  studentAnswer: "Precipitation method (double decomposition).",
  expectedScore: 2,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-095",
  question: "State one method to prepare a soluble salt that is not a salt of sodium, potassium or ammonium.",
  studentAnswer: "React excess insoluble base, metal or carbonate with acid, then filter off the excess.",
  expectedScore: 2,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-096",
  question: "Explain why excess solid is used when preparing a soluble salt by reacting an acid with an insoluble base.",
  studentAnswer: "Excess solid is used to ensure all the acid has reacted, and the excess can then be filtered off.",
  expectedScore: 2,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-097",
  question: "State the steps to obtain pure dry crystals of a soluble salt from its solution.",
  studentAnswer: "Heat the solution to evaporate until saturated, allow it to cool for crystals to form, filter the crystals, then dry them between filter papers.",
  expectedScore: 2,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-098",
  question: "State the meaning of the term 'precipitation' in salt preparation.",
  studentAnswer: "Mixing two solutions of soluble salts to form an insoluble salt that settles out as a solid.",
  expectedScore: 2,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  },

  {
  label: "ACID6-099",
  question: "Name the gas produced when a metal carbonate reacts with a dilute acid.",
  studentAnswer: "Carbon dioxide",
  expectedScore: 1,
  subject: "Chemistry",
  form: "4",
  maxScore: 1,
  },

  {
  label: "ACID6-100",
  question: "State the test to confirm the gas produced when a carbonate reacts with an acid.",
  studentAnswer: "Bubble the gas through limewater; it turns the limewater cloudy/milky, confirming carbon dioxide.",
  expectedScore: 2,
  subject: "Chemistry",
  form: "4",
  maxScore: 2,
  }

  ];

const GRADE_URL = process.env.GRADE_URL || "http://localhost:3000/api/rag/grade";

async function gradeOne(q) {
  const res = await fetch(GRADE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: q.question,
      studentAnswer: q.studentAnswer,
      subject: q.subject,
      form: q.form,
      maxScore: q.maxScore,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  const data = await res.json();
  return Number(data.score ?? 0);
}

async function main() {
  let correctlyMarked = 0;
  let totalMarkError = 0;
  let failures = 0;

  console.log(`\nMarking ${QUESTIONS.length} questions via ${GRADE_URL}\n`);

  for (const q of QUESTIONS) {
    try {
      const actual = await gradeOne(q);
      const expected = q.expectedScore;
      const exact = actual === expected;
      const markError = Math.abs(actual - expected);

      if (exact) correctlyMarked += 1;
      totalMarkError += markError;

      const status = exact ? "PASS" : "FAIL";
      console.log(
        `${q.label}  ${status}  expected=${expected}  actual=${actual}  max=${q.maxScore}`,
      );
      if (!exact) {
        console.log(`         Q: ${q.question}`);
        console.log(`         A: ${q.studentAnswer}`);
      }
    } catch (err) {
      failures += 1;
      console.log(`${q.label}  ERROR  ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const graded = QUESTIONS.length - failures;
  const accuracy = graded > 0 ? (correctlyMarked / graded) * 100 : 0;
  const mae = graded > 0 ? totalMarkError / graded : 0;

  console.log("\n========== ACCURACY REPORT ==========");
  console.log(`Questions: ${QUESTIONS.length}`);
  console.log(`Graded: ${graded}`);
  console.log(`HTTP errors: ${failures}`);
  console.log(`Exact Accuracy: ${accuracy.toFixed(2)}%`);
  console.log(`Mean Mark Error: ${mae.toFixed(2)}`);
  console.log("=====================================\n");

  if (failures > 0 || correctlyMarked < graded) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
