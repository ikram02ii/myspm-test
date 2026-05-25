import { generateImage } from "./llmProvider";

import { extractGeneratedQuestionStems } from "./extractQuestionStems";



export type GeneratedEducationalDiagram = {

  url: string;

  prompt: string;

  questionIndex: number;

};



const SCIENCE_DIAGRAM_SUBJECTS = new Set(["biology", "chemistry", "physics", "science"]);



/** Suppress fake/garbled labels — qwen-image is tuned for text posters. */

export const EDUCATIONAL_DIAGRAM_NEGATIVE_PROMPT =

  "text, letters, alphabet, words, writing, typography, font, label, caption, title, subtitle, annotation, " +

  "arrow with text, callout, watermark, logo, numbers, symbols, speech bubble, question, sentence, " +

  "english, malay, bahasa, chinese, korean, japanese, arabic, gibberish, misspelled, garbled, nonsense characters";



export function isScienceDiagramSubject(subject: string | null | undefined): boolean {

  const s = subject?.trim().toLowerCase() ?? "";

  return SCIENCE_DIAGRAM_SUBJECTS.has(s);

}



export function shouldGenerateEducationalDiagrams(

  subject: string | null | undefined,

  _query: string,

  explicitFlag?: boolean,

): boolean {

  if (explicitFlag === false) return false;

  if (!isScienceDiagramSubject(subject)) return explicitFlag === true;

  return true;

}



function maxDiagramsPerRequest(): number {

  const raw = Number(process.env["RAG_SCIENCE_DIAGRAM_MAX_PER_REQUEST"] ?? "2");

  return Number.isFinite(raw) && raw >= 1 ? Math.min(5, Math.floor(raw)) : 2;

}



function combinedContext(stem: string, userQuery: string): string {

  return `${stem} ${userQuery}`.toLowerCase().replace(/\s+/g, " ");

}

/** Topic line from AI query only — avoids matching system words like "cell structure" in diagram hints. */
function topicLineFromUserQuery(userQuery: string): string {
  const m = userQuery.match(/focused on topic:\s*([^(]+)\s*\(/i);
  return (m?.[1] ?? "").trim().toLowerCase();
}

/** Short visual scene only — never pass MCQ question sentences to the image model. */

function inferVisualScene(subject: string, stem: string, userQuery: string): string {

  const subjectNorm = subject.trim().toLowerCase();
  const ctx =
    subjectNorm === "biology"
      ? combinedContext(stem, `${topicLineFromUserQuery(userQuery)} ${stem}`)
      : combinedContext(stem, topicLineFromUserQuery(userQuery));



  if (subjectNorm === "biology") {

    if (/\b(secret|golgi|endoplasmic|ribosome|rough er|smooth er|vesicle|organelle|cell|mitochondr|nucleus)\b/.test(ctx)) {

      return (

        "detailed SPM textbook black ink cross-section of one animal cell on white background: " +

        "large nucleus with nucleolus, folded rough ER with ribosome dots beside nucleus, " +

        "smooth ER tubules, stacked Golgi cisternae, multiple mitochondria with internal cristae, " +

        "small vesicles, clear double cell membrane, fine scientific line art"

      );

    }

    if (/\b(mitosis|meiosis|cell division|prophase|metaphase|anaphase|telophase)\b/.test(ctx)) {

      return "wordless row of four simple cells showing chromosome stages during division, line art only";

    }

    if (/\b(plant|turgid|turgor|distilled|osmosis|plasmolys)\b/.test(ctx)) {

      return (

        "wordless side-by-side plant cell with rigid cell wall and large central vacuole " +

        "and round animal cell with thin membrane, line art only"

      );

    }

    if (/\b(chloroplast|photosynth|leaf|palisade)\b/.test(ctx)) {

      return "wordless rectangular plant cell with cell wall, chloroplasts, vacuole, nucleus";

    }

    if (/\b(dna|gene|chromosome|inheritance)\b/.test(ctx)) {

      return "wordless double helix and chromosome pair sketch, line art only";

    }

    if (/\b(digest|alimentary|enzyme)\b/.test(ctx)) {

      return "wordless simple diagram of human digestive tract outline, line art only";

    }

    return "wordless animal cell cross-section with nucleus and major organelles, line art only";

  }



  if (subjectNorm === "chemistry") {

    if (/\b(circuit|electrolysis|electrolytic|galvanic|voltaic|electrochemical|fuel cell|half[\s-]?cell|battery)\b/.test(ctx)) {

      return "wordless electrolysis or electrochemical cell with electrodes and beakers, line art only";

    }

    if (/\b(molecule|bond|atom|ionic|covalent|isomer|polymer chain|lewis|dot[\s-]?and[\s-]?cross)\b/.test(ctx)) {

      return "wordless ball-and-stick molecules with atoms as circles, line art only";

    }

    if (/\b(titration|burette|pipette|distillation|fractional distillation|gas collection|salt preparation)\b/.test(ctx)) {

      return "wordless chemistry laboratory apparatus setup, line art only";

    }

    return "wordless simple particle or ion arrangement for the species in the stem only, no glassware, line art only";

  }



  if (subjectNorm === "physics" || subjectNorm === "science") {

    if (/\b(circuit|bulb|resistor|ammeter)\b/.test(ctx)) {

      return "wordless simple electric circuit with battery wires and bulb symbols, line art only";

    }

    if (/\b(lens|light|ray|mirror|refraction)\b/.test(ctx)) {

      return "wordless light rays through convex lens, line art only";

    }

    if (/\b(force|motion|vector|pulley)\b/.test(ctx)) {

      return "wordless block on slope with force arrows as plain arrows only, no text";

    }

    return "wordless physics schematic with simple shapes and arrows, line art only";

  }



  return "wordless educational science sketch, line art only";

}



export function buildEducationalDiagramPrompt(params: {

  subject: string;

  questionStem: string;

  userQuery: string;

  imagePrompt?: string | null;

}): string {

  const scene = inferVisualScene(params.subject, params.questionStem, params.userQuery);



  if (params.imagePrompt?.trim()) {

    return (

      `Silent monochrome textbook illustration. ${params.imagePrompt.trim()}. ` +

      `Pure drawing with zero typography anywhere.`

    ).slice(0, 500);

  }



  return (

    `SPM Malaysian biology textbook diagram only (drawing). ${scene}. ` +

    `Black ink line art on white paper, high detail, no typography: no words, letters, numbers, labels, captions, or arrows with text anywhere.`

  ).slice(0, 500);

}



export async function generateEducationalDiagramsForAnswer(params: {

  subject: string;

  query: string;

  answer: string;

  imagePrompt?: string | null;

}): Promise<GeneratedEducationalDiagram[]> {

  const subject = params.subject.trim();

  if (!isScienceDiagramSubject(subject)) return [];



  const stems = extractGeneratedQuestionStems(params.answer);

  const targets = stems.filter((item) => item.needsDiagram === true).slice(0, maxDiagramsPerRequest());

  if (targets.length === 0) {
    return [];
  }



  const results: GeneratedEducationalDiagram[] = [];



  for (const item of targets) {
    const prompt = buildEducationalDiagramPrompt({

      subject,

      questionStem: item.stem,

      userQuery: params.query,

      imagePrompt: params.imagePrompt,

    });



    try {

      const urls = await generateImage(prompt, {

        promptExtend: false,

        n: 1,

        negativePrompt: EDUCATIONAL_DIAGRAM_NEGATIVE_PROMPT,

      });

      const url = urls[0];

      if (url) {

        results.push({ url, prompt, questionIndex: item.questionIndex });

      }

    } catch (error) {

      console.error("[educational-diagram] image generation failed", {

        subject,

        questionIndex: item.questionIndex,

        message: error instanceof Error ? error.message : error,

      });

    }

  }



  if (results.length > 0) {

    console.info("[educational-diagram] generated", {

      subject,

      count: results.length,

      questionIndexes: results.map((r) => r.questionIndex),

    });

  }



  return results;

}

