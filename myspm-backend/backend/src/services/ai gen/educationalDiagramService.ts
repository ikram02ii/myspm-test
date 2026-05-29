import { chatCompletion, generateImage } from "./llmProvider";
import { extractGeneratedQuestionStems } from "./extractQuestionStems";

export type GeneratedEducationalDiagram = {
  url: string;
  prompt: string;
  questionIndex: number;
};

type PlannedEducationalDiagram = {
  questionIndex: number;
  needDiagram: boolean;
  imagePrompt: string;
};

const SCIENCE_DIAGRAM_SUBJECTS = new Set(["biology", "chemistry", "physics", "science", "math", "additional math"]);
const DETERMINISTIC_MATH_SUBJECTS = new Set(["math", "additional math"]);

/** Suppress fake/garbled labels — qwen-image is tuned for text posters. */
export const EDUCATIONAL_DIAGRAM_NEGATIVE_PROMPT =
  "text, letters, alphabet, words, writing, typography, font, label, caption, title, subtitle, annotation, " +
  "arrow with text, callout, watermark, logo, numbers, symbols, speech bubble, question, sentence, " +
  "english, malay, bahasa, chinese, korean, japanese, arabic, gibberish, misspelled, garbled, nonsense characters";

export function isScienceDiagramSubject(subject: string | null | undefined): boolean {
  const s = subject?.trim().toLowerCase() ?? "";
  return SCIENCE_DIAGRAM_SUBJECTS.has(s);
}

function isDeterministicMathSubject(subject: string | null | undefined): boolean {
  const s = subject?.trim().toLowerCase() ?? "";
  return DETERMINISTIC_MATH_SUBJECTS.has(s);
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

function topicLineFromUserQuery(userQuery: string): string {
  const m = userQuery.match(/focused on topic:\s*([^(]+)\s*\(/i);
  return (m?.[1] ?? "").trim().toLowerCase();
}

function inferVisualScene(subject: string, stem: string, userQuery: string): string {
  const subjectNorm = subject.trim().toLowerCase();
  const ctx =
    subjectNorm === "biology"
      ? combinedContext(stem, `${topicLineFromUserQuery(userQuery)} ${stem}`)
      : combinedContext(stem, topicLineFromUserQuery(userQuery));

  if (subjectNorm === "biology") {
    if (/\b(cytoskeleton|microtubule|microfilament|filament|shape|movement|support)\b/.test(ctx)) {
      return (
        "wordless textbook sketch of cytoskeleton fibres inside a cell, showing support, internal transport, and cell movement, black ink line art only"
      );
    }

    if (/\b(compare|comparison|different|difference|plant cell and animal cell|plant vs animal)\b/.test(ctx)) {
      return "wordless side-by-side plant cell and animal cell comparison, black ink line art only";
    }

    if (/\b(plant|turgid|turgor|distilled|osmosis|plasmolys|hypertonic|hypotonic)\b/.test(ctx)) {
      return "wordless single plant cell showing cell wall, membrane, vacuole, and osmosis-related state, black ink line art only";
    }

    if (/\b(secret|golgi|endoplasmic|ribosome|rough er|smooth er|vesicle|organelle|mitochondr|nucleus|animal cell)\b/.test(ctx)) {
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

    if (/\b(chloroplast|photosynth|leaf|palisade)\b/.test(ctx)) {
      return "wordless rectangular plant cell with cell wall, chloroplasts, vacuole, nucleus";
    }

    if (/\b(dna|gene|chromosome|inheritance)\b/.test(ctx)) {
      return "wordless double helix and chromosome pair sketch, line art only";
    }

    if (/\b(digest|alimentary|enzyme)\b/.test(ctx)) {
      return "wordless simple diagram of human digestive tract outline, line art only";
    }

    return "wordless biology textbook diagram focused on the exact structure named in the question, black ink line art only";
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

  if (subjectNorm === "math" || subjectNorm === "additional math") {
    const hasExplicitCoordinatePairs = /\b[A-Za-z]\s*\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/.test(stem);
    if (/\b(vertex|vertices|edge|edges|node|nodes|network|tree|path|graph theory|graf)\b/.test(ctx)) {
      return "wordless discrete graph with dots and connecting edges only, line art only";
    }
    if (hasExplicitCoordinatePairs) {
      return (
        "wordless coordinate-plane sketch with points plotted in the same geometric arrangement implied by the question, " +
        "dots and connecting segments only, no point names, no coordinate numbers, no text labels"
      );
    }
    if (/\b(coordinate|cartesian|x-axis|y-axis|axis|line graph|linear|function|gradient|slope|intercept|plot)\b/.test(ctx)) {
      return "wordless coordinate-plane graph with axes and plotted line or curve matching the question, line art only";
    }
    if (/\b(geometry|triangle|circle|angle|polygon|quadrilateral|tangent|chord)\b/.test(ctx)) {
      return "wordless geometry diagram with clean points and construction lines, line art only";
    }
    return "wordless mathematics diagram that matches the exact question context, line art only";
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
    `SPM Malaysian ${params.subject} textbook diagram only (drawing). ${scene}. ` +
    `Black ink line art on white paper, high detail, no typography: no words, letters, numbers, labels, captions, or arrows with text anywhere. ` +
    `For coordinate-geometry questions, never write point names like A/B/C and never print coordinate pairs on the image.`
  ).slice(0, 500);
}

function normalizePlannerJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withoutFences = trimmed.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const candidates = [withoutFences];

  const arrStart = withoutFences.indexOf("[");
  const arrEnd = withoutFences.lastIndexOf("]");
  if (arrStart >= 0 && arrEnd > arrStart) {
    candidates.push(withoutFences.slice(arrStart, arrEnd + 1));
  }

  const objStart = withoutFences.indexOf("{");
  const objEnd = withoutFences.lastIndexOf("}");
  if (objStart >= 0 && objEnd > objStart) {
    candidates.push(withoutFences.slice(objStart, objEnd + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // try next candidate
    }
  }

  return null;
}

function normalizePlannerItems(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).plans)) {
    return (raw as Record<string, unknown>).plans as unknown[];
  }
  return [];
}

function shouldHeuristicallyNeedDiagram(subject: string, stem: string, query: string): boolean {
  const ctx = combinedContext(stem, query);
  const subjectNorm = subject.trim().toLowerCase();

  if (subjectNorm === "biology") {
    return /\b(cell|organelle|osmosis|plasmolys|turgid|hypertonic|hypotonic|mitosis|meiosis|chloroplast|nucleus|cytoskeleton|microscope|compare)\b/.test(
      ctx,
    );
  }

  if (subjectNorm === "chemistry") {
    return /\b(electrolysis|cell|molecule|bond|atom|ionic|covalent|titration|apparatus|distillation|chromatography)\b/.test(
      ctx,
    );
  }

  if (subjectNorm === "physics" || subjectNorm === "science") {
    return /\b(circuit|lens|light|ray|mirror|force|pulley|vector|apparatus|pressure|wave)\b/.test(ctx);
  }

  if (subjectNorm === "math" || subjectNorm === "additional math") {
    return /\b(graph|graf|plot|coordinate|cartesian|line|linear|function|curve|vertex|vertices|edge|edges|node|nodes|network|tree|geometry|triangle|circle|angle|polygon)\b/.test(
      ctx,
    );
  }

  return false;
}

type CartesianPoint = { label?: string; x: number; y: number };
type LinearEquation = { m: number; c: number; display: string };
type GraphTheorySpec = { vertices: number; edges: number };
type QuadraticEquation = { a: number; b: number; c: number; display: string };
type CircleEquation = { h: number; k: number; r: number; display: string };
type RectangleFacts = { lengthExpr: string; widthExpr: string };

function parseCoordinatePoints(stem: string): CartesianPoint[] {
  const points: CartesianPoint[] = [];
  const seen = new Set<string>();
  const re = /([A-Za-z])?\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g;
  let m: RegExpExecArray | null = re.exec(stem);
  while (m) {
    const label = m[1]?.toUpperCase();
    const x = Number(m[2]);
    const y = Number(m[3]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const key = `${label ?? ""}:${x},${y}`;
      if (!seen.has(key)) {
        points.push({ label, x, y });
        seen.add(key);
      }
    }
    m = re.exec(stem);
  }
  return points;
}

function parseLinearEquation(stem: string): LinearEquation | null {
  const normalized = stem.replace(/−/g, "-");
  const match = normalized.match(
    /(?:y|f\s*\(\s*x\s*\))\s*=\s*([+-]?\s*(?:\d+(?:\.\d+)?|\.\d+)?\s*)x(?!\s*\^)(?:\s*([+-])\s*(\d+(?:\.\d+)?))?/i,
  );
  if (!match) return null;

  const rawSlope = (match[1] ?? "").replace(/\s+/g, "");
  let m = 1;
  if (rawSlope === "-" || rawSlope === "-1") {
    m = -1;
  } else if (rawSlope === "" || rawSlope === "+" || rawSlope === "1") {
    m = 1;
  } else {
    const parsedSlope = Number(rawSlope);
    if (!Number.isFinite(parsedSlope)) return null;
    m = parsedSlope;
  }

  const sign = match[2] ?? "+";
  const rawIntercept = match[3];
  const cAbs = rawIntercept ? Number(rawIntercept) : 0;
  if (!Number.isFinite(cAbs)) return null;
  const c = sign === "-" ? -cAbs : cAbs;

  const display = `y = ${m === 1 ? "" : m === -1 ? "-" : m}x${c === 0 ? "" : c > 0 ? ` + ${c}` : ` - ${Math.abs(c)}`}`;
  return { m, c, display };
}

function parseQuadraticEquation(stem: string): QuadraticEquation | null {
  const normalized = stem.replace(/−/g, "-").replace(/\s+/g, "");
  const match = normalized.match(/(?:y|f\(x\))=((?:[+-]?\d*(?:\.\d+)?)x\^2)((?:[+-]\d*(?:\.\d+)?)x)?([+-]\d+(?:\.\d+)?)?/i);
  if (!match) return null;

  const parseCoeff = (token: string | undefined, fallbackPower?: "x2" | "x"): number => {
    if (!token) return 0;
    let raw = token;
    if (fallbackPower === "x2") raw = raw.replace(/x\^2/i, "");
    if (fallbackPower === "x") raw = raw.replace(/x/i, "");
    if (raw === "" || raw === "+") return 1;
    if (raw === "-") return -1;
    const n = Number(raw);
    return Number.isFinite(n) ? n : Number.NaN;
  };

  const a = parseCoeff(match[1], "x2");
  const b = parseCoeff(match[2], "x");
  const c = match[3] ? Number(match[3]) : 0;
  if (![a, b, c].every((n) => Number.isFinite(n)) || a === 0) return null;
  const display = `y = ${a === 1 ? "" : a === -1 ? "-" : a}x^2${b === 0 ? "" : b > 0 ? ` + ${b}x` : ` - ${Math.abs(b)}x`}${c === 0 ? "" : c > 0 ? ` + ${c}` : ` - ${Math.abs(c)}`}`;
  return { a, b, c, display };
}

function parseCircleEquation(stem: string): CircleEquation | null {
  const normalized = stem.replace(/−/g, "-").replace(/\s+/g, "");
  const rhs = normalized.match(/\(x([+-]\d+(?:\.\d+)?)\)\^2\+\(y([+-]\d+(?:\.\d+)?)\)\^2=(\d+(?:\.\d+)?)/i);
  if (rhs) {
    const h = -Number(rhs[1]);
    const k = -Number(rhs[2]);
    const r2 = Number(rhs[3]);
    const r = Math.sqrt(r2);
    if ([h, k, r].every((n) => Number.isFinite(n)) && r > 0) {
      const display = `(x ${h < 0 ? "+" : "-"} ${Math.abs(h)})^2 + (y ${k < 0 ? "+" : "-"} ${Math.abs(k)})^2 = ${r2}`;
      return { h, k, r, display };
    }
  }

  const centerRadius = normalized.match(/center\(([-]?\d+(?:\.\d+)?),([-]?\d+(?:\.\d+)?)\).*radius(?:=|is)?(\d+(?:\.\d+)?)/i);
  if (!centerRadius) return null;
  const h = Number(centerRadius[1]);
  const k = Number(centerRadius[2]);
  const r = Number(centerRadius[3]);
  if (![h, k, r].every((n) => Number.isFinite(n)) || r <= 0) return null;
  const display = `(x - ${h})^2 + (y - ${k})^2 = ${r * r}`;
  return { h, k, r, display };
}

function parseGraphTheorySpec(stem: string): GraphTheorySpec | null {
  const normalized = stem.toLowerCase().replace(/−/g, "-");
  const vertexMatch = normalized.match(
    /(\d+)\s*(?:vertices|vertex|nodes|node|bucu|vertexes)\b/,
  );
  const edgeMatch = normalized.match(
    /(\d+)\s*(?:edges|edge|sisi|garis)\b/,
  );
  if (!vertexMatch || !edgeMatch) return null;
  const vertices = Number(vertexMatch[1]);
  const edges = Number(edgeMatch[1]);
  if (!Number.isInteger(vertices) || !Number.isInteger(edges) || vertices < 2 || edges < 1) return null;
  const maxSimpleEdges = (vertices * (vertices - 1)) / 2;
  return { vertices, edges: Math.min(edges, maxSimpleEdges) };
}

function normalizeExpr(expr: string): string {
  return expr.replace(/\s+/g, "").toLowerCase();
}

function parseRectangleFacts(stem: string): RectangleFacts | null {
  const text = stem.replace(/−/g, "-");

  const lengthParen = text.match(/(?:length|panjang)[^()\n]*\(\s*([^)\n]+?)\s*\)/i);
  const widthParen = text.match(/(?:width|lebar)[^()\n]*\(\s*([^)\n]+?)\s*\)/i);
  if (lengthParen?.[1] && widthParen?.[1]) {
    return {
      lengthExpr: lengthParen[1].trim(),
      widthExpr: widthParen[1].trim(),
    };
  }

  const lengthEq = text.match(/(?:length|panjang)\s*(?:=|ialah|is)\s*([A-Za-z0-9+\-*/^().]+)/i);
  const widthEq = text.match(/(?:width|lebar)\s*(?:=|ialah|is)\s*([A-Za-z0-9+\-*/^().]+)/i);
  if (lengthEq?.[1] && widthEq?.[1]) {
    return {
      lengthExpr: lengthEq[1].trim(),
      widthExpr: widthEq[1].trim(),
    };
  }

  return null;
}

function parseRectangleMetadataFromPrompt(prompt: string): RectangleFacts | null {
  const m = prompt.match(/deterministic-math-rectangle-svg\|L=([^|]+)\|W=([^|]+)/i);
  if (!m?.[1] || !m?.[2]) return null;
  return { lengthExpr: m[1], widthExpr: m[2] };
}

function isDiagramMetadataConsistent(facts: RectangleFacts | null, prompt: string): boolean {
  if (!facts) return true;
  const meta = parseRectangleMetadataFromPrompt(prompt);
  if (meta) {
    return (
      normalizeExpr(meta.lengthExpr) === normalizeExpr(facts.lengthExpr) &&
      normalizeExpr(meta.widthExpr) === normalizeExpr(facts.widthExpr)
    );
  }
  const promptNorm = normalizeExpr(prompt);
  return (
    promptNorm.includes(normalizeExpr(facts.lengthExpr)) &&
    promptNorm.includes(normalizeExpr(facts.widthExpr))
  );
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function buildCoordinateSvg(points: CartesianPoint[]): string {
  const width = 900;
  const height = 640;
  const pad = 80;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);

  const minX = Math.min(0, ...xs);
  const maxX = Math.max(0, ...xs);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(0, ...ys);

  const dx = Math.max(1, maxX - minX);
  const dy = Math.max(1, maxY - minY);

  const scaleX = (width - pad * 2) / dx;
  const scaleY = (height - pad * 2) / dy;

  const toPx = (x: number, y: number) => ({
    px: pad + (x - minX) * scaleX,
    py: height - pad - (y - minY) * scaleY,
  });

  const axisY = toPx(0, 0).py;
  const axisX = toPx(0, 0).px;
  const linePoints = points.map((p) => toPx(p.x, p.y));

  const polylinePoints = linePoints.map((p) => `${p.px},${p.py}`).join(" ");
  const closeShape = points.length === 3 ? `${polylinePoints} ${linePoints[0].px},${linePoints[0].py}` : polylinePoints;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`,
    `<line x1="${pad}" y1="${axisY}" x2="${width - pad}" y2="${axisY}" stroke="#374151" stroke-width="2"/>`,
    `<line x1="${axisX}" y1="${pad}" x2="${axisX}" y2="${height - pad}" stroke="#374151" stroke-width="2"/>`,
    `<polyline points="${closeShape}" fill="none" stroke="#ef4444" stroke-width="4"/>`,
    ...points.map((p, i) => {
      const m = linePoints[i];
      const label = p.label ?? `P${i + 1}`;
      return [
        `<circle cx="${m.px}" cy="${m.py}" r="6" fill="#111827"/>`,
        `<text x="${m.px + 10}" y="${m.py - 10}" font-size="28" fill="#111827" font-family="Arial, sans-serif">${label}(${p.x},${p.y})</text>`,
      ].join("");
    }),
    `</svg>`,
  ].join("");
}

function buildLinearFunctionSvg(eq: LinearEquation): string {
  const width = 900;
  const height = 640;
  const pad = 80;
  const minX = -10;
  const maxX = 10;
  const ys = [eq.m * minX + eq.c, eq.m * maxX + eq.c, 0, eq.c];
  const minY = Math.min(...ys) - 2;
  const maxY = Math.max(...ys) + 2;
  const dx = maxX - minX;
  const dy = Math.max(1, maxY - minY);
  const scaleX = (width - pad * 2) / dx;
  const scaleY = (height - pad * 2) / dy;

  const toPx = (x: number, y: number) => ({
    px: pad + (x - minX) * scaleX,
    py: height - pad - (y - minY) * scaleY,
  });

  const axisY = toPx(0, 0).py;
  const axisX = toPx(0, 0).px;
  const p1 = toPx(minX, eq.m * minX + eq.c);
  const p2 = toPx(maxX, eq.m * maxX + eq.c);
  const yIntercept = toPx(0, eq.c);
  const xInterceptValue = eq.m !== 0 ? -eq.c / eq.m : null;
  const xIntercept = xInterceptValue !== null ? toPx(xInterceptValue, 0) : null;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`,
    `<line x1="${pad}" y1="${axisY}" x2="${width - pad}" y2="${axisY}" stroke="#374151" stroke-width="2"/>`,
    `<line x1="${axisX}" y1="${pad}" x2="${axisX}" y2="${height - pad}" stroke="#374151" stroke-width="2"/>`,
    `<line x1="${p1.px}" y1="${p1.py}" x2="${p2.px}" y2="${p2.py}" stroke="#ef4444" stroke-width="4"/>`,
    `<circle cx="${yIntercept.px}" cy="${yIntercept.py}" r="6" fill="#111827"/>`,
    xIntercept ? `<circle cx="${xIntercept.px}" cy="${xIntercept.py}" r="6" fill="#111827"/>` : "",
    `<text x="${pad}" y="${pad - 20}" font-size="30" fill="#111827" font-family="Arial, sans-serif">${eq.display}</text>`,
    `</svg>`,
  ].join("");
}

function buildQuadraticFunctionSvg(eq: QuadraticEquation): string {
  const width = 900;
  const height = 640;
  const pad = 80;
  const minX = -10;
  const maxX = 10;
  const step = 0.25;
  const xs: number[] = [];
  for (let x = minX; x <= maxX + 1e-9; x += step) xs.push(Number(x.toFixed(4)));
  const ys = xs.map((x) => eq.a * x * x + eq.b * x + eq.c);
  const minY = Math.min(0, ...ys) - 2;
  const maxY = Math.max(0, ...ys) + 2;
  const dx = maxX - minX;
  const dy = Math.max(1, maxY - minY);
  const scaleX = (width - pad * 2) / dx;
  const scaleY = (height - pad * 2) / dy;

  const toPx = (x: number, y: number) => ({
    px: pad + (x - minX) * scaleX,
    py: height - pad - (y - minY) * scaleY,
  });

  const axisY = toPx(0, 0).py;
  const axisX = toPx(0, 0).px;
  const polyline = xs.map((x) => {
    const p = toPx(x, eq.a * x * x + eq.b * x + eq.c);
    return `${p.px},${p.py}`;
  }).join(" ");

  const xv = -eq.b / (2 * eq.a);
  const yv = eq.a * xv * xv + eq.b * xv + eq.c;
  const v = toPx(xv, yv);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`,
    `<line x1="${pad}" y1="${axisY}" x2="${width - pad}" y2="${axisY}" stroke="#374151" stroke-width="2"/>`,
    `<line x1="${axisX}" y1="${pad}" x2="${axisX}" y2="${height - pad}" stroke="#374151" stroke-width="2"/>`,
    `<polyline points="${polyline}" fill="none" stroke="#ef4444" stroke-width="4"/>`,
    `<circle cx="${v.px}" cy="${v.py}" r="6" fill="#111827"/>`,
    `<text x="${pad}" y="${pad - 20}" font-size="30" fill="#111827" font-family="Arial, sans-serif">${eq.display}</text>`,
    `</svg>`,
  ].join("");
}

function buildCircleSvg(eq: CircleEquation): string {
  const width = 900;
  const height = 640;
  const pad = 80;
  const minX = Math.min(0, eq.h - eq.r - 2);
  const maxX = Math.max(0, eq.h + eq.r + 2);
  const minY = Math.min(0, eq.k - eq.r - 2);
  const maxY = Math.max(0, eq.k + eq.r + 2);
  const dx = Math.max(1, maxX - minX);
  const dy = Math.max(1, maxY - minY);
  const scaleX = (width - pad * 2) / dx;
  const scaleY = (height - pad * 2) / dy;
  const scale = Math.min(scaleX, scaleY);

  const toPx = (x: number, y: number) => ({
    px: pad + (x - minX) * scale,
    py: height - pad - (y - minY) * scale,
  });

  const axisY = toPx(0, 0).py;
  const axisX = toPx(0, 0).px;
  const c = toPx(eq.h, eq.k);
  const rr = eq.r * scale;
  const edge = toPx(eq.h + eq.r, eq.k);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`,
    `<line x1="${pad}" y1="${axisY}" x2="${width - pad}" y2="${axisY}" stroke="#374151" stroke-width="2"/>`,
    `<line x1="${axisX}" y1="${pad}" x2="${axisX}" y2="${height - pad}" stroke="#374151" stroke-width="2"/>`,
    `<circle cx="${c.px}" cy="${c.py}" r="${rr}" fill="none" stroke="#ef4444" stroke-width="4"/>`,
    `<line x1="${c.px}" y1="${c.py}" x2="${edge.px}" y2="${edge.py}" stroke="#111827" stroke-width="3"/>`,
    `<circle cx="${c.px}" cy="${c.py}" r="6" fill="#111827"/>`,
    `<text x="${pad}" y="${pad - 20}" font-size="30" fill="#111827" font-family="Arial, sans-serif">${eq.display}</text>`,
    `</svg>`,
  ].join("");
}

function buildRectangleDimensionSvg(facts: RectangleFacts): string {
  const width = 900;
  const height = 640;
  const rx = 220;
  const ry = 160;
  const x = (width - rx * 2) / 2;
  const y = (height - ry * 2) / 2;
  const l = facts.lengthExpr;
  const w = facts.widthExpr;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`,
    `<rect x="${x}" y="${y}" width="${rx * 2}" height="${ry * 2}" fill="none" stroke="#111827" stroke-width="6"/>`,
    `<text x="${width / 2}" y="${y - 20}" text-anchor="middle" font-size="34" fill="#111827" font-family="Arial, sans-serif">(${l})</text>`,
    `<text x="${width / 2}" y="${y + ry * 2 + 45}" text-anchor="middle" font-size="34" fill="#111827" font-family="Arial, sans-serif">(${l})</text>`,
    `<text x="${x - 24}" y="${height / 2}" text-anchor="end" dominant-baseline="middle" font-size="34" fill="#111827" font-family="Arial, sans-serif">(${w})</text>`,
    `<text x="${x + rx * 2 + 24}" y="${height / 2}" dominant-baseline="middle" font-size="34" fill="#111827" font-family="Arial, sans-serif">(${w})</text>`,
    `</svg>`,
  ].join("");
}

function buildSimpleGraphTheorySvg(spec: GraphTheorySpec): string {
  const width = 900;
  const height = 640;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.32;

  const points = Array.from({ length: spec.vertices }, (_v, i) => {
    const angle = (-Math.PI / 2) + (2 * Math.PI * i) / spec.vertices;
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });

  const candidateEdges: Array<[number, number]> = [];
  for (let i = 0; i < spec.vertices; i += 1) {
    candidateEdges.push([i, (i + 1) % spec.vertices]);
  }
  for (let i = 0; i < spec.vertices; i += 1) {
    for (let j = i + 2; j < spec.vertices; j += 1) {
      if (i === 0 && j === spec.vertices - 1) continue;
      candidateEdges.push([i, j]);
    }
  }

  const uniq = new Set<string>();
  const chosen: Array<[number, number]> = [];
  for (const [a, b] of candidateEdges) {
    if (chosen.length >= spec.edges) break;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (!uniq.has(key)) {
      uniq.add(key);
      chosen.push([a, b]);
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`,
    ...chosen.map(([a, b]) => {
      const p1 = points[a];
      const p2 = points[b];
      return `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#111827" stroke-width="6"/>`;
    }),
    ...points.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="16" fill="#ffffff" stroke="#111827" stroke-width="6"/>`),
    `</svg>`,
  ].join("");
}

function buildDeterministicMathDiagrams(answer: string): GeneratedEducationalDiagram[] {
  const stems = extractGeneratedQuestionStems(answer);
  if (stems.length === 0) return [];

  const results: GeneratedEducationalDiagram[] = [];
  for (const item of stems) {
    const rectangleFacts = parseRectangleFacts(item.stem);
    const points = parseCoordinatePoints(item.stem);
    let svg: string | null = null;
    let prompt = "";
    if (rectangleFacts) {
      svg = buildRectangleDimensionSvg(rectangleFacts);
      prompt = `deterministic-math-rectangle-svg|L=${normalizeExpr(rectangleFacts.lengthExpr)}|W=${normalizeExpr(rectangleFacts.widthExpr)}`;
    } else if (points.length >= 2) {
      svg = buildCoordinateSvg(points);
      prompt = "deterministic-math-coordinate-svg";
    } else {
      const graphSpec = parseGraphTheorySpec(item.stem);
      if (graphSpec) {
        svg = buildSimpleGraphTheorySvg(graphSpec);
        prompt = "deterministic-math-graph-theory-svg";
      } else {
        const circle = parseCircleEquation(item.stem);
        if (circle) {
          svg = buildCircleSvg(circle);
          prompt = "deterministic-math-circle-svg";
        } else {
          const quadratic = parseQuadraticEquation(item.stem);
          if (quadratic) {
            svg = buildQuadraticFunctionSvg(quadratic);
            prompt = "deterministic-math-quadratic-function-svg";
          } else {
            const eq = parseLinearEquation(item.stem);
            if (eq) {
              svg = buildLinearFunctionSvg(eq);
              prompt = "deterministic-math-linear-function-svg";
            }
          }
        }
      }
    }
    if (!svg) continue;
    results.push({
      url: svgDataUri(svg),
      prompt,
      questionIndex: item.questionIndex,
    });
  }
  return results;
}

function fallbackPlanForStem(params: {
  subject: string;
  query: string;
  questionIndex: number;
  stem: string;
  imagePrompt?: string | null;
}): PlannedEducationalDiagram {
  const needDiagram = shouldHeuristicallyNeedDiagram(params.subject, params.stem, params.query);
  return {
    questionIndex: params.questionIndex,
    needDiagram,
    imagePrompt: needDiagram
      ? buildEducationalDiagramPrompt({
          subject: params.subject,
          questionStem: params.stem,
          userQuery: params.query,
          imagePrompt: params.imagePrompt,
        })
      : "",
  };
}

function normalizePlannedEducationalDiagram(
  raw: unknown,
  allowedIndexes: Set<number>,
  subject: string,
  query: string,
  stemsByIndex: Map<number, string>,
  imagePrompt?: string | null,
): PlannedEducationalDiagram | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const questionIndex = Number(obj.questionIndex);
  if (!Number.isInteger(questionIndex) || !allowedIndexes.has(questionIndex)) return undefined;

  const needDiagram =
    typeof obj.needDiagram === "boolean"
      ? obj.needDiagram
      : /^(true|yes|ya|1)$/i.test(String(obj.needDiagram ?? "").trim());

  if (!needDiagram) {
    return { questionIndex, needDiagram: false, imagePrompt: "" };
  }

  const stem = stemsByIndex.get(questionIndex) ?? "";
  const prompt =
    typeof obj.imagePrompt === "string" && obj.imagePrompt.trim()
      ? obj.imagePrompt.trim().slice(0, 500)
      : buildEducationalDiagramPrompt({
          subject,
          questionStem: stem,
          userQuery: query,
          imagePrompt,
        });

  return { questionIndex, needDiagram: true, imagePrompt: prompt };
}

async function planEducationalDiagramsForAnswer(params: {
  subject: string;
  query: string;
  answer: string;
  imagePrompt?: string | null;
}): Promise<PlannedEducationalDiagram[]> {
  const stems = extractGeneratedQuestionStems(params.answer);
  if (stems.length === 0) return [];

  const allowedIndexes = new Set(stems.map((item) => item.questionIndex));
  const stemsByIndex = new Map(stems.map((item) => [item.questionIndex, item.stem]));
  const fallback = stems.map((item) =>
    fallbackPlanForStem({
      subject: params.subject,
      query: params.query,
      questionIndex: item.questionIndex,
      stem: item.stem,
      imagePrompt: params.imagePrompt,
    }),
  );

  try {
    const plannerRaw = await chatCompletion(
      [
        {
          role: "system",
          content:
            "You are a diagram-planning assistant for Malaysian SPM science questions. " +
            "The questions are already finalized. Decide per question whether a diagram is genuinely useful. " +
            'Return JSON only. Preferred shape: {"plans":[{"questionIndex":1,"needDiagram":true,"imagePrompt":"..."}]}. ' +
            "If a question does not need a diagram, return needDiagram=false and imagePrompt as an empty string. " +
            "When needDiagram=true, write one short specific prompt for an image model. " +
            "The prompt must match the exact question, avoid generic repeated cell diagrams, and say no labels/text, black ink line art on white background. " +
            "Use comparison diagrams only when the question explicitly compares two things. " +
            "For plant-cell osmosis questions, prefer a single plant cell showing the correct state rather than plant+animal side by side. " +
            "For math coordinate-geometry, prefer unlabeled geometric shapes/points and do not request rendered coordinate text or point letters.",
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              subject: params.subject,
              originalQuery: params.query,
              questions: stems.map((item) => ({
                questionIndex: item.questionIndex,
                questionStem: item.stem,
              })),
            },
            null,
            2,
          ),
        },
      ],
      { subject: params.subject, query: `${params.query} educational diagram planner` },
    );

    const parsed = normalizePlannerJson(plannerRaw);
    const normalized = normalizePlannerItems(parsed)
      .map((item) =>
        normalizePlannedEducationalDiagram(
          item,
          allowedIndexes,
          params.subject,
          params.query,
          stemsByIndex,
          params.imagePrompt,
        ),
      )
      .filter((item): item is PlannedEducationalDiagram => Boolean(item));

    if (normalized.length === 0) return fallback;

    const byIndex = new Map<number, PlannedEducationalDiagram>();
    for (const item of fallback) byIndex.set(item.questionIndex, item);
    for (const item of normalized) byIndex.set(item.questionIndex, item);
    return [...byIndex.values()].sort((a, b) => a.questionIndex - b.questionIndex);
  } catch {
    return fallback;
  }
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
  const rectangleFactsByIndex = new Map<number, RectangleFacts>();
  for (const s of stems) {
    const facts = parseRectangleFacts(s.stem);
    if (facts) rectangleFactsByIndex.set(s.questionIndex, facts);
  }
  if (isDeterministicMathSubject(subject)) {
    const deterministic = buildDeterministicMathDiagrams(params.answer);
    if (deterministic.length > 0) return deterministic;
  }

  const plans = await planEducationalDiagramsForAnswer(params);
  const targets = plans
    .filter((item) => item.needDiagram && item.imagePrompt.trim())
    .slice(0, maxDiagramsPerRequest());
  if (targets.length === 0) {
    return [];
  }

  const results: GeneratedEducationalDiagram[] = [];
  for (const item of targets) {
    try {
      const facts = rectangleFactsByIndex.get(item.questionIndex) ?? null;
      if (facts && !isDiagramMetadataConsistent(facts, item.imagePrompt)) {
        const svg = buildRectangleDimensionSvg(facts);
        results.push({
          url: svgDataUri(svg),
          prompt: `deterministic-math-rectangle-svg|L=${normalizeExpr(facts.lengthExpr)}|W=${normalizeExpr(facts.widthExpr)}`,
          questionIndex: item.questionIndex,
        });
        continue;
      }
      const urls = await generateImage(item.imagePrompt, {
        promptExtend: false,
        n: 1,
        negativePrompt: EDUCATIONAL_DIAGRAM_NEGATIVE_PROMPT,
      });

      const url = urls[0];
      if (url) {
        results.push({ url, prompt: item.imagePrompt, questionIndex: item.questionIndex });
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
