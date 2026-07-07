/**
 * SPM KSSM syllabus-aligned diagram validation rules (Agent 4 vision + text).
 * Review / edit this file to tune what the validator checks per subject.
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
    "",
    "Reject (approved: false) when:",
    "- Question contradicts RAG or invents wrong facts.",
    "- Diagram would illustrate the WRONG structure, organism, apparatus, or graph type.",
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

/** Full static syllabus rules per subject (vision validator). */
export const BIOLOGY_VISION_SYLLABUS_RULES = `Biology (KSSM SPM) — reject if diagram contradicts the question:

CELL & MOLECULES
- Plant cell: cell wall + (usually) chloroplasts + large central vacuole; NOT Paramecium, Euglena, or generic ciliate.
- Animal cell: cell membrane, nucleus, mitochondria; NO cell wall, NO chloroplasts (unless stem says hybrid/plant-like).
- Bacteria: simple cell, cell wall, no membrane-bound nucleus (no true nucleus) when prokaryote is asked.
- Organelles: match named organelle (mitochondrion, chloroplast, Golgi, ER, ribosome, vacuole, nucleus).
- Osmosis/plasmolysis/turgid: plant cell state must match (flaccid/turgid/plasmolysed).

CELL DIVISION & GENETICS
- Mitosis vs meiosis: correct stage if named (prophase, metaphase, anaphase, telophase); meiosis shows homologous pairing/crossing over when relevant.
- Chromosome / DNA: helix or chromosome structure when genetics/inheritance is asked — not unrelated cell.

TISSUES & ANATOMY
- Plant tissues: xylem (vessels, lignin), phloem (sieve tubes), epidermis, meristem — match tissue named in stem.
- Animal tissues / organs: digestive tract, heart, lung, kidney, reproductive organs — correct organ, not wrong system.
- Transverse/cross-section: must match organ/tissue in question (e.g. root vs stem vs leaf).

SYSTEMS & PHYSIOLOGY
- Digestive, respiratory, circulatory, excretory systems: outline must match system asked.
- Transport: active transport, diffusion, osmosis — correct mechanism context (e.g. root hair, alveolus).

ECOLOGY & OTHERS
- Food web / pyramid / carbon cycle — match ecosystem topic if named.
- Enzyme action, nutrition classes — schematic must fit topic.
- Wrong kingdom/organism (e.g. fungus diagram for plant question) → relevant: false.`;

export const PHYSICS_VISION_SYLLABUS_RULES = `Physics (KSSM SPM) — reject if diagram contradicts the question:

HEAT & THERMODYNAMICS
- Cooling curve / freezing / heat removed → temperature-time graph trends DOWNWARD (may have plateau); upward heating curve is WRONG.
- Heating curve / melting / boiling / heat added → graph trends UPWARD; downward cooling curve is WRONG.
- Latent heat plateau direction must match heating vs cooling.

MECHANICS & MOTION
- distance-time, speed-time, acceleration-time graphs: shape must match motion described (uniform, accelerating, decelerating, at rest).
- Forces: vectors point in correct direction; free-body / inclined plane / pulley matches setup in stem.
- Momentum, work, energy bar/transfer diagrams must match context.

WAVES & OPTICS
- Light: ray diagrams — convex/concave lens or mirror, correct image type (real/virtual) when implied.
- Reflection/refraction: rays bend correctly at boundary.
- Wave: crest/trough, wavelength pattern if wave topic.

ELECTRICITY & MAGNETISM
- Circuit: series/parallel, components (cell, bulb, resistor, ammeter/voltmeter placement) match question.
- Electromagnetism: field pattern or motor/generator schematic must fit stem.

PRESSURE, FLUIDS, OTHER
- Hydraulic/pneumatic, atmospheric pressure setups must match.
- Radioactivity: decay curve or penetration diagram if topic named.
- Generic unrelated sketch when specific apparatus/graph is required → relevant: false.`;

export const CHEMISTRY_VISION_SYLLABUS_RULES = `Chemistry (KSSM SPM) — reject if diagram contradicts the question:

STRUCTURE & BONDING
- Ionic vs covalent: correct dot-and-cross or ball-and-stick for species named.
- Isomers, polymers: connectivity matches molecule in stem.

APPARATUS & EXPERIMENTS
- Titration: burette, pipette, conical flask — correct setup.
- Distillation / fractional distillation / gas collection / salt preparation — apparatus matches experiment.
- Electrolysis / electrochemical cell: electrodes, electrolyte, ion flow direction plausible for stem.

PERIODIC TABLE & REACTIONS
- Reactivity series, electrolysis products — schematic fits metals/ions named.
- Rate of reaction: graph (concentration/time) or apparatus (Marble chips + acid) must match.

Wrong apparatus for experiment, or wrong molecule/ion → relevant: false.`;

export const SCIENCE_VISION_SYLLABUS_RULES = `Science (integrated KSSM) — apply Biology, Physics, or Chemistry rules above whichever matches the question topic. Reject cross-topic mismatch (e.g. circuit diagram for nutrition question).`;

export const MATH_VISION_SYLLABUS_RULES = `Mathematics / Additional Mathematics (SPM) — reject if diagram contradicts the question:

GRAPHS & FUNCTIONS
- Linear/quadratic/reciprocal/exponential: curve shape matches equation or description.
- Coordinate geometry: points/lines/curves in correct relative positions; gradient sign matches.
- Distance-time / speed-time only if physics context — same shape rules as Physics.

GEOMETRY & GRAPH THEORY
- Triangles, circles, angles, tangents, chords — construction matches problem.
- Discrete graphs (vertices/edges) match described network/tree/path.
- Matrices / transformations: diagram reflects translation, reflection, rotation if named.

Do not approve graphs with wrong slope, wrong intercept, or wrong shape for the given function/motion.`;

export const GENERAL_VISION_SYLLABUS_RULES = `General — diagram must directly illustrate the named concept in the question. Reject decorative, unrelated, or opposite-concept images.`;

/** Dynamic physics temperature-curve addendum from stem keywords. */
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
      "→ Temperature-time graph MUST trend downward left-to-right. Upward heating curve = relevant: false.",
    ].join("\n");
  }
  if (dir === "heating") {
    return [
      "",
      "STEM-SPECIFIC (critical): This question describes HEATING / melting / heat ADDED.",
      "→ Temperature-time graph MUST trend upward left-to-right. Downward cooling curve = relevant: false.",
    ].join("\n");
  }
  return "";
}

export function resolveVisionSyllabusRules(subject: string, stem: string, curveDir: TemperatureCurveDirection): string {
  const s = subject.trim().toLowerCase();
  const blocks: string[] = [];

  if (s === "biology") {
    blocks.push(BIOLOGY_VISION_SYLLABUS_RULES);
  } else if (s === "physics") {
    blocks.push(PHYSICS_VISION_SYLLABUS_RULES);
    blocks.push(buildPhysicsTemperatureCurveAddendum(stem, curveDir));
  } else if (s === "chemistry") {
    blocks.push(CHEMISTRY_VISION_SYLLABUS_RULES);
  } else if (s === "science") {
    blocks.push(SCIENCE_VISION_SYLLABUS_RULES);
    blocks.push(buildPhysicsTemperatureCurveAddendum(stem, curveDir));
  } else if (s === "math" || s === "additional math") {
    blocks.push(MATH_VISION_SYLLABUS_RULES);
  } else {
    blocks.push(GENERAL_VISION_SYLLABUS_RULES);
  }

  return blocks.filter(Boolean).join("\n\n");
}

export function buildDiagramVisionCheckPromptBody(subject: string, questionStem: string, curveDir: TemperatureCurveDirection): string {
  const stem = questionStem.slice(0, 500);
  const syllabusRules = resolveVisionSyllabusRules(subject, stem, curveDir);

  return [
    `Subject: ${subject}`,
    `Question: ${stem}`,
    "",
    "You are a strict SPM (KSSM) diagram checker for Malaysian secondary school.",
    "The image must match the EXACT concept, structure, apparatus, or graph type in the question.",
    "Use the syllabus checklist below. If the image shows the wrong topic, wrong organism, wrong apparatus, wrong graph shape/direction, or an unrelated sketch → relevant: false.",
    "",
    syllabusRules,
    "",
    "Does this diagram correctly illustrate what the question describes?",
    'Reply JSON only: {"relevant": true|false, "reason": "short phrase naming the mismatch if false"}',
  ].join("\n");
}
