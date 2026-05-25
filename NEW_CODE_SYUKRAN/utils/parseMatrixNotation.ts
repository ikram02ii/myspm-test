/** Parse SPM-style matrix literals e.g. `[3 2; 1 4]` or `[[3,2],[1,4]]`. */

function parseRowNumbers(row: string): number[] {
  const cleaned = row.replace(/^\[|\]$/g, "").trim();
  if (!cleaned) return [];

  const parts = cleaned.split(/[,\s]+/).filter(Boolean);
  const nums: number[] = [];
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isFinite(n)) return [];
    nums.push(n);
  }
  return nums;
}

function rowsSameWidth(rows: number[][]): boolean {
  if (rows.length === 0) return false;
  const w = rows[0].length;
  return w > 0 && rows.every((r) => r.length === w);
}

export function tryParseMatrixLiteral(text: string): number[][] | null {
  const raw = text.trim();
  if (!raw.startsWith("[") || !raw.endsWith("]")) return null;

  const inner = raw.slice(1, -1).trim();
  if (!inner) return null;

  let rows: number[][] = [];

  if (inner.includes(";")) {
    rows = inner.split(";").map((part) => parseRowNumbers(part.trim()));
  } else if (/\]\s*,\s*\[/.test(inner) || /^\s*\[/.test(inner)) {
    const rowParts = inner.split(/\]\s*,\s*\[/).map((part) => part.replace(/^\[|\]$/g, "").trim());
    rows = rowParts.map((part) => parseRowNumbers(part));
  } else {
    const single = parseRowNumbers(inner);
    if (single.length === 0) return null;
    rows = [single];
  }

  if (!rowsSameWidth(rows)) return null;
  return rows;
}

const MATRIX_IN_TEXT_RE = /\[[^\]\n]*;[^\]\n]*\]/g;

export type TextOrMatrixSegment =
  | { kind: "text"; value: string }
  | { kind: "matrix"; value: number[][] };

export function splitTextWithMatrices(text: string): TextOrMatrixSegment[] {
  if (!text.trim()) return [{ kind: "text", value: text }];

  const segments: TextOrMatrixSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  MATRIX_IN_TEXT_RE.lastIndex = 0;
  while ((match = MATRIX_IN_TEXT_RE.exec(text))) {
    const token = match[0];
    const start = match.index;

    if (start > lastIndex) {
      segments.push({ kind: "text", value: text.slice(lastIndex, start) });
    }

    const matrix = tryParseMatrixLiteral(token);
    if (matrix) {
      segments.push({ kind: "matrix", value: matrix });
    } else {
      segments.push({ kind: "text", value: token });
    }

    lastIndex = start + token.length;
  }

  if (lastIndex < text.length) {
    segments.push({ kind: "text", value: text.slice(lastIndex) });
  }

  if (segments.length === 0) {
    const whole = tryParseMatrixLiteral(text.trim());
    if (whole) return [{ kind: "matrix", value: whole }];
    return [{ kind: "text", value: text }];
  }

  return segments;
}

export function isMatrixOnlyOption(text: string): boolean {
  return tryParseMatrixLiteral(text.trim()) !== null;
}
