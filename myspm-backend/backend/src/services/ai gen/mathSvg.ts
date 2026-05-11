type Point = { x: number; y: number; label?: string };

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function toCanvasXY(
  p: Point,
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  size: { w: number; h: number; pad: number },
): { cx: number; cy: number } {
  const { xMin, xMax, yMin, yMax } = bounds;
  const { w, h, pad } = size;
  const xSpan = Math.max(1e-9, xMax - xMin);
  const ySpan = Math.max(1e-9, yMax - yMin);
  const cx = pad + ((p.x - xMin) / xSpan) * (w - pad * 2);
  const cy = h - pad - ((p.y - yMin) / ySpan) * (h - pad * 2);
  return { cx, cy };
}

function svgCartesianLine(spec: {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  points: Point[];
  title?: string;
}): string {
  const w = 420;
  const h = 260;
  const pad = 30;
  const bounds = { xMin: spec.xMin, xMax: spec.xMax, yMin: spec.yMin, yMax: spec.yMax };

  const poly = spec.points
    .map((p) => toCanvasXY(p, bounds, { w, h, pad }))
    .map((p) => `${p.cx},${p.cy}`)
    .join(" ");

  const circles = spec.points
    .map((p) => {
      const c = toCanvasXY(p, bounds, { w, h, pad });
      const label = p.label
        ? `<text x="${c.cx + 6}" y="${c.cy - 6}" font-size="11" fill="#0f172a">${esc(p.label)}</text>`
        : "";
      return `<circle cx="${c.cx}" cy="${c.cy}" r="3.5" fill="#2563eb" />${label}`;
    })
    .join("");

  const title = spec.title
    ? `<text x="${w / 2}" y="18" text-anchor="middle" font-size="12" fill="#0f172a">${esc(spec.title)}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect x="0" y="0" width="${w}" height="${h}" fill="white"/>
${title}
<line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="#334155" stroke-width="1.5"/>
<line x1="${pad}" y1="${h - pad}" x2="${pad}" y2="${pad}" stroke="#334155" stroke-width="1.5"/>
<polyline points="${poly}" fill="none" stroke="#2563eb" stroke-width="2"/>
${circles}
</svg>`;
}

function svgTriangle(spec: { points: Point[]; title?: string }): string {
  const w = 420;
  const h = 260;
  const pad = 24;
  const xs = spec.points.map((p) => p.x);
  const ys = spec.points.map((p) => p.y);
  const bounds = {
    xMin: Math.min(...xs) - 1,
    xMax: Math.max(...xs) + 1,
    yMin: Math.min(...ys) - 1,
    yMax: Math.max(...ys) + 1,
  };
  const pts = spec.points.map((p) => toCanvasXY(p, bounds, { w, h, pad }));
  const poly = pts.map((p) => `${p.cx},${p.cy}`).join(" ");
  const labels = spec.points
    .map((p, i) => `<text x="${pts[i]?.cx + 6}" y="${(pts[i]?.cy ?? 0) - 6}" font-size="11" fill="#0f172a">${esc(p.label ?? "")}</text>`)
    .join("");
  const title = spec.title
    ? `<text x="${w / 2}" y="18" text-anchor="middle" font-size="12" fill="#0f172a">${esc(spec.title)}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect x="0" y="0" width="${w}" height="${h}" fill="white"/>
${title}
<polygon points="${poly}" fill="#dbeafe" stroke="#1d4ed8" stroke-width="2"/>
${pts.map((p) => `<circle cx="${p.cx}" cy="${p.cy}" r="3" fill="#1e40af"/>`).join("")}
${labels}
</svg>`;
}

function validPoints(v: unknown): Point[] {
  if (!Array.isArray(v)) return [];
  return v.filter((p): p is Point => {
    return (
      typeof p === "object" &&
      p !== null &&
      isFiniteNumber((p as Point).x) &&
      isFiniteNumber((p as Point).y)
    );
  });
}

export function generateSvgFromSpec(spec: unknown): string | null {
  if (!spec || typeof spec !== "object") return null;
  const s = spec as Record<string, unknown>;
  const kind = typeof s.kind === "string" ? s.kind.toLowerCase() : "";

  if (kind === "cartesian_line") {
    const points = validPoints(s.points);
    if (
      points.length >= 2 &&
      isFiniteNumber(s.xMin) &&
      isFiniteNumber(s.xMax) &&
      isFiniteNumber(s.yMin) &&
      isFiniteNumber(s.yMax)
    ) {
      return svgCartesianLine({
        xMin: s.xMin,
        xMax: s.xMax,
        yMin: s.yMin,
        yMax: s.yMax,
        points,
        title: typeof s.title === "string" ? s.title : undefined,
      });
    }
    return null;
  }

  if (kind === "triangle") {
    const points = validPoints(s.points);
    if (points.length === 3) {
      return svgTriangle({
        points,
        title: typeof s.title === "string" ? s.title : undefined,
      });
    }
    return null;
  }

  return null;
}

export function enrichMathAnswerWithSvg(answer: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer);
  } catch {
    return answer;
  }
  if (!Array.isArray(parsed)) return answer;

  let changed = false;
  const updated = parsed.map((item) => {
    if (!item || typeof item !== "object") return item;
    const obj = item as Record<string, unknown>;
    const hasSvg = typeof obj.rajah_svg === "string" && obj.rajah_svg.trim().startsWith("<svg");
    if (hasSvg || !obj.rajah_spec) return item;
    const svg = generateSvgFromSpec(obj.rajah_spec);
    if (!svg) return item;
    changed = true;
    return { ...obj, rajah_svg: svg };
  });

  return changed ? JSON.stringify(updated, null, 2) : answer;
}
