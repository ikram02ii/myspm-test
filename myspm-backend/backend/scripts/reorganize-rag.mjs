/**
 * One-off: move rag/*.ts into subfolders and rewrite relative imports.
 * Run: node scripts/reorganize-rag.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ragRoot = path.resolve(__dirname, "../src/services/rag");

const FILE_FOLDER = {
  // grading
  gradeService: "grading",
  gradePipelineService: "grading",
  questionAnalysisService: "grading",
  gradingPolicy: "grading",
  gradingEvidencePolicy: "grading",
  gradingFairness: "grading",
  gradingTextUtils: "grading",
  gradingStages: "grading",
  gradingChecks: "grading",
  sequenceMarkingService: "grading",
  qwenGradingClient: "grading",
  // rubric
  rubricService: "rubric",
  rubricHelpers: "rubric",
  rubricMatchingService: "rubric",
  rubricFromTextbookChunksService: "rubric",
  // retrieval
  retrievalService: "retrieval",
  contextAuditService: "retrieval",
  embeddingsService: "retrieval",
  pastPaperFormFilter: "retrieval",
  pastPaperMarksHints: "retrieval",
  // ingestion
  ingestionService: "ingestion",
  textbookService: "ingestion",
  textbookChaptersService: "ingestion",
  conceptChunkingService: "ingestion",
  chunking: "ingestion",
  pdfService: "ingestion",
  pdfTextExtract: "ingestion",
  syllabusChapterSort: "ingestion",
  // ocr
  ocrPipelineService: "ocr",
  ocrAnswerFilter: "ocr",
  ocrTextNormalize: "ocr",
  ocrRepairService: "ocr",
  ocrAnswerValidateService: "ocr",
  // speaking
  speakingGradeService: "speaking",
  speakingTranscribeService: "speaking",
  speakingAssessmentPolicy: "speaking",
  englishSpeakingPdfService: "speaking",
  englishSpeakingTypes: "speaking",
};

function moduleId(spec) {
  const m = spec.match(/^\.\/(.+?)(?:\.js)?$/);
  return m ? m[1] : null;
}

function resolveDotImport(importerFolder, spec) {
  const id = moduleId(spec);
  if (!id) return spec;
  if (id === "types") return "../types";
  const targetFolder = FILE_FOLDER[id];
  if (!targetFolder) {
    console.warn(`Unknown module id: ${id} (importer ${importerFolder})`);
    return spec;
  }
  if (targetFolder === importerFolder) return `./${id}`;
  return `../${targetFolder}/${id}`;
}

function rewriteFileImports(filePath, importerFolder) {
  let text = fs.readFileSync(filePath, "utf8");
  const original = text;

  text = text.replace(/from (['"])(\.\/[^'"]+)\1/g, (_m, q, spec) => {
    return `from ${q}${resolveDotImport(importerFolder, spec)}${q}`;
  });
  text = text.replace(/export \{([^}]+)\} from (['"])(\.\/[^'"]+)\2/g, (_m, exports, q, spec) => {
    return `export {${exports}} from ${q}${resolveDotImport(importerFolder, spec)}${q}`;
  });

  if (importerFolder) {
    text = text.replace(/from (['"])\.\.\/\.\.\/lib\//g, "from $1../../../lib/");
    text = text.replace(/from (['"])\.\.\/ai gen\//g, "from $1../../ai gen/");
  }

  if (text !== original) fs.writeFileSync(filePath, text, "utf8");
}

function moveFiles() {
  for (const [base, folder] of Object.entries(FILE_FOLDER)) {
    const src = path.join(ragRoot, `${base}.ts`);
    const destDir = path.join(ragRoot, folder);
    const dest = path.join(destDir, `${base}.ts`);
    if (!fs.existsSync(src)) {
      console.warn(`Skip missing: ${base}.ts`);
      continue;
    }
    fs.mkdirSync(destDir, { recursive: true });
    fs.renameSync(src, dest);
    console.log(`Moved ${base}.ts -> ${folder}/`);
  }
}

function rewriteAllRagFiles() {
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.endsWith(".ts")) continue;
      const rel = path.relative(ragRoot, full).replace(/\\/g, "/");
      const importerFolder = rel.includes("/") ? rel.split("/")[0] : "";
      rewriteFileImports(full, importerFolder);
    }
  };
  walk(ragRoot);
}

function rewriteExternalImports(root) {
  const replacements = [
    [/from (['"])(\.\.\/)+services\/rag\/types\1/g, (m, q, dots) => {
      const depth = (dots.match(/\.\.\//g) || []).length;
      return `from ${q}${"../".repeat(depth)}services/rag/types${q}`;
    }],
  ];

  const pathMap = Object.entries(FILE_FOLDER).map(([base, folder]) => [
    new RegExp(`from (['"])(\\.\\./)+services/rag/${base}\\1`, "g"),
    (m, q, dots) => {
      const prefix = dots || "../";
      const depth = (prefix.match(/\.\.\//g) || []).length;
      return `from ${q}${"../".repeat(depth)}services/rag/${folder}/${base}${q}`;
    },
  ]);

  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (name === "node_modules" || name === "dist") continue;
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.endsWith(".ts") && !name.endsWith(".mjs")) continue;
      if (full.includes(`${path.sep}services${path.sep}rag${path.sep}`) && !full.includes("reorganize-rag")) {
        // skip rag internals (already done)
        if (path.relative(ragRoot, full).split(path.sep).length > 1 || name !== "types.ts") {
          if (!full.endsWith("types.ts") || path.dirname(full) !== ragRoot) {
            if (path.dirname(full).startsWith(ragRoot)) continue;
          }
        }
      }
      let text = fs.readFileSync(full, "utf8");
      let changed = false;
      for (const [base, folder] of Object.entries(FILE_FOLDER)) {
        const patterns = [
          `services/rag/${base}`,
          `services\\\\rag\\\\${base}`,
        ];
        for (const pat of patterns) {
          if (text.includes(pat) && !text.includes(`services/rag/${folder}/${base}`)) {
            text = text.split(`services/rag/${base}`).join(`services/rag/${folder}/${base}`);
            text = text.split(`services\\rag\\${base}`).join(`services\\rag\\${folder}\\${base}`);
            changed = true;
          }
        }
      }
      if (changed) {
        fs.writeFileSync(full, text, "utf8");
        console.log(`Updated external: ${path.relative(root, full)}`);
      }
    }
  };
  walk(path.resolve(root, "src"));
  walk(path.resolve(root, "scripts"));
}

moveFiles();
rewriteAllRagFiles();
rewriteExternalImports(path.resolve(__dirname, ".."));
console.log("Done.");
