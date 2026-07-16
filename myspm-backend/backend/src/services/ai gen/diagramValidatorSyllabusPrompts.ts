/**
 * SPM KSSM diagram validation prompts (Agent 4 text + vision).
 * Vision uses ONE examiner-style prompt per subject+question — no per-chapter prompts.
 */

export type TemperatureCurveDirection = "cooling" | "heating" | "neutral";

/** Agent 4 text validator — system prompt (all subjects; subject passed in user message). */
export function buildAgent4TextValidatorSystemPrompt(): string {
  return [
    "You are Agent 4: strict validator for Malaysian SPM (KSSM) AI-generated practice.",
    "",
    "Check ALL of the following:",
    "1) Questions are grounded in the RAG excerpts (no fabricated syllabus facts).",
    "2) MCQ format is parseable (Soalan, stems, A–D, Jawapan, Penjelasan).",
    "3) Each question topic matches the user request (chapter/topic/general syllabus).",
    "4) Diagram plans: if needDiagram=true, the imagePrompt must match the question stem topic.",
    "5) Subject-specific diagram logic (reject obvious mismatches):",
    buildSyllabusDiagramChecklistForTextValidator(),
    "6) Answer-leak check: the diagram is a QUESTION STIMULUS, not an answer key. The imagePrompt must NOT reveal, highlight, label, circle, or point to the correct answer, and must NOT draw the very thing the student is asked to identify/choose/predict.",
    "",
    "Reject (approved: false) when:",
    "- Question contradicts RAG or invents wrong facts.",
    "- Diagram would illustrate the WRONG structure, organism, apparatus, or graph type.",
    "- Diagram REVEALS the answer (e.g. 'Which graph shows cooling?' with a cooling curve drawn, or an 'identify the organelle' question with that organelle labelled/highlighted).",
    "- Physics: cooling/freezing question paired with heating-curve direction or vice versa.",
    "- Biology: plant-cell question paired with protozoan/animal-only cell; wrong tissue/organ.",
    "- Chemistry: wrong apparatus or wrong molecule type for the stem.",
    "- Math: graph shape contradicts equation or motion description.",
    "",
    'Return JSON only: {"approved": boolean, "score": 0-1, "feedback": "actionable fix for Agent 1", "issues": ["..."]}',
  ].join("\n");
}

function buildSyllabusDiagramChecklistForTextValidator(): string {
  return [
    "   Biology: cell ultrastructure, mitosis/meiosis, tissues (xylem/phloem/epidermis), organs/systems (digestive, respiratory, circulatory, excretory, reproductive), transport (osmosis/diffusion/active transport), nutrition, enzymes, genetics/DNA, ecology, microorganisms.",
    "   Physics: heat & phase change curves, motion graphs (s-t, v-t, a-t), forces & vectors, pressure, waves, light (lens/ray), electricity & circuits, electromagnetism, radioactivity, energy & power, simple machines.",
    "   Chemistry: atomic structure, bonding diagrams, apparatus (titration, distillation, gas collection, electrolysis cell), periodic table trends, acids/bases/salts, rates of reaction setup, carbon compounds, polymers.",
    "   Science: same checks as Biology/Physics/Chemistry topics when the stem names them.",
    "   Math/Add Math: coordinate graphs, functions, geometry figures, graph theory — shape must match the question.",
  ].join("\n");
}

/** Dynamic physics temperature-curve addendum from stem keywords (common failure case). */
export function buildPhysicsTemperatureCurveAddendum(
  stem: string,
  dir: TemperatureCurveDirection,
): string {
  const graphCtx = /\b(curve|graph|cooling|heating|phase change|melting|freezing|boiling|plateau|temperature)\b/i.test(
    stem,
  );
  if (!graphCtx && dir === "neutral") return "";

  if (dir === "cooling") {
    return [
      "",
      "STEM-SPECIFIC (critical): This question describes COOLING / freezing / heat REMOVED.",
      "→ Temperature-time graph MUST trend downward left-to-right. Upward heating curve = is_valid: false.",
    ].join("\n");
  }
  if (dir === "heating") {
    return [
      "",
      "STEM-SPECIFIC (critical): This question describes HEATING / melting / heat ADDED.",
      "→ Temperature-time graph MUST trend upward left-to-right. Downward cooling curve = is_valid: false.",
    ].join("\n");
  }
  return "";
}

/**
 * ONE shared vision QA prompt for all chapters.
 * Topic/chapter is optional context only — do not maintain separate prompts per chapter.
 */
export function buildDiagramVisionCheckPromptBody(
  subject: string,
  questionStem: string,
  curveDir: TemperatureCurveDirection,
  topicName?: string | null,
): string {
  const stem = questionStem.slice(0, 500);
  const topic = topicName?.trim() || "Infer from the question text";
  const physicsAddendum = buildPhysicsTemperatureCurveAddendum(stem, curveDir);

  return [
    `You are an expert KSSM ${subject} Examiner acting as a Quality Assurance (QA) Vision Validator.`,
    "",
    "I have attached an AI-generated image representing a syllabus diagram, along with the text of the exam question it belongs to.",
    "",
    "--- CONTEXT ---",
    `Subject: ${subject}`,
    `Topic / Chapter: ${topic}`,
    `Question Text: ${stem}`,
    "--- END CONTEXT ---",
    "",
    "You do NOT need chapter-specific rules. Judge ONLY from the attached image + the question text above.",
    "",
    "CRITERIA FOR VISUAL VALIDATION:",
    "1. Relevance: Does the attached image accurately depict the specific structure, apparatus, graph, or scenario mentioned in the question text?",
    "2. Scientific Accuracy: Are structures, proportions, graph direction/shape, and visual features scientifically correct for SPM/KSSM level?",
    "   Examples: plant cell has wall + large vacuole; animal cell does not; RBC lacks nucleus and is biconcave; cooling curve trends downward; heating curve trends upward.",
    "3. Hallucinations: Reject weird AI artifacts, illegible/gibberish text, extra limbs/parts, or decorative sketches that would confuse a student.",
    "4. Answer-leak: This image is a QUESTION STIMULUS, not an answer key. If it reveals, highlights, labels, circles, or points to the correct answer — or draws the exact thing the student must identify/choose/predict — is_valid must be false (error_reason: \"reveals answer\").",
    "5. Style: Prefer clean monochrome textbook line art. Heavy colour fills or unrelated scenery are weak but only fail if they also break criteria 1–4.",
    physicsAddendum,
    "",
    "OUTPUT FORMAT:",
    "Return a strict JSON object only (no markdown):",
    "{",
    '  "is_valid": boolean,',
    '  "error_reason": "If false, explain exactly what visual error exists in the image. If true, empty string.",',
    '  "new_image_prompt": "If false, write ONE better highly detailed silent monochrome textbook line-art prompt to regenerate the diagram (question stimulus only; no labels; do NOT reveal the answer). If true, empty string."',
    "}",
    "",
    "Also accept legacy keys if needed: relevant (=is_valid), reason (=error_reason).",
  ].join("\n");
}
