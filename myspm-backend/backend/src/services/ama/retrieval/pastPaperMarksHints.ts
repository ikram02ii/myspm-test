import type { RetrievedChunk } from "../types";

/** Extract SPM-style mark values from chunk text (e.g. [3], 4 markah, Markah: 2). */
export function extractMarksFromText(text: string): number[] {
  const marks = new Set<number>();
  const patterns = [
    /\[(\d{1,2})\s*(?:marks?|markah|m)\b[^\]]*\]/gi,
    /\((\d{1,2})\s*(?:marks?|markah)\)/gi,
    /\b(\d{1,2})\s*markah\b/gi,
    /\b(\d{1,2})\s*marks?\b/gi,
    /Markah\s*[:：]\s*(\d{1,2})/gi,
    /Marks?\s*[:：]\s*(\d{1,2})/gi,
  ];

  for (const pattern of patterns) {
    let m: RegExpExecArray | null;
    const re = new RegExp(pattern.source, pattern.flags);
    while ((m = re.exec(text))) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 1 && n <= 20) marks.add(n);
    }
  }

  return [...marks];
}

export function collectPastPaperMarkSamples(chunks: RetrievedChunk[]): number[] {
  const samples: number[] = [];
  for (const chunk of chunks) {
    if (chunk.sourceType !== "past_paper") continue;
    if (typeof chunk.maxMarks === "number" && chunk.maxMarks >= 1) {
      samples.push(chunk.maxMarks);
    }
    for (const m of extractMarksFromText(chunk.content)) {
      samples.push(m);
    }
  }
  return samples;
}

export function summarizePastPaperMarkDistribution(samples: number[]): string | null {
  if (samples.length === 0) return null;

  const freq = new Map<number, number>();
  for (const m of samples) {
    freq.set(m, (freq.get(m) ?? 0) + 1);
  }
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 6).map(([mark, count]) => `${mark} mark${mark === 1 ? "" : "s"} (${count}× in retrieved past-paper excerpts)`);
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const median = samples.slice().sort((a, b) => a - b)[Math.floor(samples.length / 2)] ?? samples[0];

  return [
    "Past-paper mark patterns from retrieved excerpts (use these to calibrate Markah: per generated question):",
    `- Common totals: ${top.join("; ")}`,
    `- Range seen: ${min}–${max} marks; typical ~${median} marks per item`,
    "- Match question depth: short recall ≈ 1–2 marks; explain/compare ≈ 3–4; KBAT/essay-style ≈ 5–8 when context shows similar weight.",
  ].join("\n");
}

export function buildPastPaperMarksGuidance(chunks: RetrievedChunk[]): string {
  const samples = collectPastPaperMarkSamples(chunks);
  return summarizePastPaperMarkDistribution(samples) ?? "";
}

export function isSubjectiveGenerationQuery(query: string): boolean {
  return /\bsubjective\b|essay|karangan|open[- ]?ended|structured\s+question|marking\s+points?|short\s+answer(?!\s+[A-D])/i.test(
    query,
  );
}

export function isMcqGenerationQuery(query: string): boolean {
  if (isSubjectiveGenerationQuery(query)) return false;
  return /\bMCQ\b|objektif|multiple[- ]choice|A[-–]D\b|A-D options/i.test(query);
}
