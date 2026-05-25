function normalizeNewlines(s: string): string {
  return (s ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeAiText(s: string): string {
  return normalizeNewlines(s)
    .replace(/```(?:json|text)?/gi, "")
    .replace(/```/g, "")
    .replace(/\*\*/g, "")
    .trim();
}

/**
 * Extracts the student-facing oral prompt from RAG generator output.
 */
export function parseAiOralPrompt(answer: string): string | null {
  const text = normalizeAiText(answer);
  if (!text) return null;

  const promptMatch = text.match(
    /(?:^|\n)\s*(?:Prompt|Soalan|Task|Arahan(?:\s+lisan)?)\s*[:：]\s*([\s\S]*?)(?=\n\s*(?:Sample answer|Jawapan contoh|Model answer|Marking|Rubrik|Rubric)\s*[:：]|$)/i,
  );
  if (promptMatch?.[1]?.trim()) {
    return promptMatch[1].trim();
  }

  const soalanMatch = text.match(
    /(?:^|\n)\s*(?:Soalan|Question)\s+1\s*[:.)-]?\s*([\s\S]*?)(?=\n\s*(?:Sample|Jawapan|Answer)\s*[:：]|$)/i,
  );
  if (soalanMatch?.[1]?.trim()) {
    return soalanMatch[1].trim();
  }

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const filtered = lines.filter(
    (line) =>
      !/^(?:penjelasan|explanation|marking|rubrik|rubric|sample answer|jawapan contoh)\s*:/i.test(
        line,
      ) &&
      !/^Jawapan\s*:/i.test(line) &&
      !/^[A-D]\s*[\).:\-]/i.test(line),
  );
  if (filtered.length === 0) return null;

  return filtered.slice(0, 12).join("\n");
}
