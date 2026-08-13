/**
 * Subject-specific OCR profiles for student answer scans.
 * One shared pipeline; only extraction + repair emphasis changes per subject.
 */

export type OcrSubjectId = "chemistry" | "physics" | "biology" | "math" | "general";

export type OcrSubjectProfile = {
  id: OcrSubjectId;
  /** Prompt sent with the image to the vision OCR model. */
  extractionPrompt: string;
  /** Extra repair rules appended to the shared OCR repair system prompt. */
  repairRules: string[];
  /**
   * equation: emphasize formulas / chem / calc steps.
   * prose: emphasize written paragraphs (biology-style).
   * mixed: both (default / unknown subject).
   */
  normalizeMode: "equation" | "prose" | "mixed";
};

const SHARED_EXTRACTION_RULES = [
  "Transcribe the STUDENT'S ANSWER or working from this image — not the exam question.",
  "Output clean plain text only — suitable for a student answer box.",
  "If the image shows a question at the top and an answer below, transcribe ONLY the answer/working area.",
  "NEVER output bilingual question stems (lines starting with EN: or BM:), Soalan text, or the question sentence.",
  "Skip question numbers, Soalan labels, EN:/BM: stems, and (N marks) in question headers.",
  "Do NOT use LaTeX, \\(, \\), \\[, \\], $, \\frac, \\displaylines, markdown, or code fences.",
  "Copy numbers and words exactly; do not solve or invent steps not visible in the image.",
  "Transcribe ONLY what is visible in THIS image.",
  "No commentary before or after the transcription.",
];

function buildExtractionPrompt(subjectLines: string[]): string {
  return [...SHARED_EXTRACTION_RULES, ...subjectLines].join("\n");
}

const CHEMISTRY_PROFILE: OcrSubjectProfile = {
  id: "chemistry",
  normalizeMode: "equation",
  extractionPrompt: buildExtractionPrompt([
    "Subject focus: Chemistry.",
    "Preserve chemical equations and formulas carefully (e.g. H2SO4, C2H5OH, CH3COOH) — not C_{2}H_{5}OH.",
    "Keep reaction arrows as → or ⇌ when shown; keep state symbols (s), (l), (g), (aq).",
    "Keep coefficients and mole calculations; one equation or step per line.",
    "Fractions: 1/2 or (1/2). Powers: ^ (e.g. 10^-3). Units: mol, g, dm3, cm3.",
  ]),
  repairRules: [
    "CHEMISTRY: Prefer correct formula tokens (H2SO4, not H2S04 / H2804).",
    "CHEMISTRY: Keep → / ⇌ and (aq)/(s)/(l)/(g); do not turn equations into prose.",
    "CHEMISTRY: Keep mole / titration / concentration working on separate lines.",
    "CHEMISTRY: Do not invent missing products or balance the equation if not written.",
  ],
};

const PHYSICS_PROFILE: OcrSubjectProfile = {
  id: "physics",
  normalizeMode: "equation",
  extractionPrompt: buildExtractionPrompt([
    "Subject focus: Physics.",
    "Preserve equations and calculation steps (e.g. V = u + at, F = ma, a = 2 m/s²).",
    "One step / equation per line, in writing order.",
    "Fractions: 1/2 or (1/2). Powers: ^ (e.g. 10^2). Multiplication: × or x as shown.",
    "Keep units with numbers (m/s, m/s², N, J, W, kg).",
  ]),
  repairRules: [
    "PHYSICS: Keep kinematics / force / energy equations intact (V = u + at, etc.).",
    "PHYSICS: Preserve units (m/s, m/s², N); fix OCR unit glitches without changing values.",
    "PHYSICS: Keep substitution and final-answer lines as separate steps.",
    "PHYSICS: Do not invent missing formula lines the student did not write.",
  ],
};

const BIOLOGY_PROFILE: OcrSubjectProfile = {
  id: "biology",
  normalizeMode: "prose",
  extractionPrompt: buildExtractionPrompt([
    "Subject focus: Biology.",
    "Preserve written explanations and scientific terms (cells, enzymes, photosynthesis, etc.).",
    "Keep the student's sentence order and paragraph/line breaks.",
    "Do NOT force equation formatting unless the student clearly wrote an equation or list.",
    "Fix only clear OCR letter confusions in biological terms when unambiguous from the image text.",
  ]),
  repairRules: [
    "BIOLOGY: Prefer readable prose / bullet points over equation reformatting.",
    "BIOLOGY: Do not convert sentences into fake math or chem equations.",
    "BIOLOGY: Keep scientific names and process terms; fix only obvious OCR typos.",
    "BIOLOGY: Preserve list structure if the student wrote numbered or bulleted points.",
  ],
};

const MATH_PROFILE: OcrSubjectProfile = {
  id: "math",
  normalizeMode: "equation",
  extractionPrompt: buildExtractionPrompt([
    "Subject focus: Mathematics / Additional Mathematics.",
    "Preserve algebra, fractions, powers, and lined working exactly.",
    "One step / equation per line.",
    "Fractions: 1/2 or (1/2). Powers: ^ (e.g. x^2). Roots as sqrt(...) if written that way.",
    "Keep =, ≠, ≤, ≥, and signs (+/−) exactly as written.",
  ]),
  repairRules: [
    "MATH: Keep algebraic steps and equals signs; one step per line.",
    "MATH: Fractions as 1/2 or (a+b)/c — never LaTeX \\frac.",
    "MATH: Do not simplify or solve beyond what the student wrote.",
    "MATH: Preserve variables and indices (x1, x^2) carefully.",
  ],
};

const GENERAL_PROFILE: OcrSubjectProfile = {
  id: "general",
  normalizeMode: "mixed",
  extractionPrompt: buildExtractionPrompt([
    "Subject focus: general SPM answer.",
    "One step / equation / sentence per line when that matches the writing.",
    "Write math as plain text: V = u + at, a = 2 m/s², S = (1/2)at^2.",
    "Fractions: 1/2 or (1/2). Powers: ^. Chemical formulas: C2H5OH, H2SO4 (not LaTeX subscripts).",
    "Keep units with numbers (mol, g, cm, m/s, etc.).",
  ]),
  repairRules: [
    "Keep both prose and equations as written; do not invent content.",
    "Remove stray LaTeX; write fractions as 1/2; keep units with numbers.",
  ],
};

/** Resolve OCR profile from practice subject string (Biology, Chemistry, …). */
export function resolveOcrSubjectProfile(subject?: string | null): OcrSubjectProfile {
  const s = (subject ?? "").trim().toLowerCase();
  if (!s) return GENERAL_PROFILE;

  if (/chem|kimia/.test(s)) return CHEMISTRY_PROFILE;
  if (/phys|fizik/.test(s)) return PHYSICS_PROFILE;
  if (/bio|biologi/.test(s)) return BIOLOGY_PROFILE;
  if (/add\s*math|additional\s*math|matematik|math/.test(s)) return MATH_PROFILE;

  return GENERAL_PROFILE;
}
