/**
 * Shared text-analysis utilities used by both the pipeline and the legacy
 * grading path.  All helpers here are subject-neutral and language-neutral
 * (EN / BM only).
 */

export type AnswerLanguage = "english" | "malay" | "mixed";

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

/** Malay structural / function words — subject-neutral. */
const MALAY_MARKERS = new Set([
  // function words
  "yang","ini","itu","dan","atau","tetapi","tidak","tak","ialah","adalah",
  "akan","sedang","sudah","telah","dengan","untuk","kepada","daripada","pada",
  "dalam","oleh","kerana","sebab","supaya","bagi","jika","ke","di","dari",
  // pronouns
  "saya","awak","kamu","kami","kita","mereka","dia","ia",
  // modal / auxiliary
  "ada","tiada","boleh","mesti","perlu",
  // particles / adverbs
  "lagi","juga","pun","sahaja","saja","semua","setiap","banyak","sedikit","besar","kecil",
  // instruction verbs common in SPM questions
  "nyatakan","namakan","terangkan","jelaskan","huraikan","bandingkan","bincangkan",
  "kenal","pasti","berikan","kirakan","hitungkan","lakarkan","lukiskan",
  // common question-answer words
  "jawapan","soalan","pelajar","murid","menjadi","menggunakan","menghasilkan","membentuk",
]);

/** English structural / function words — subject-neutral. */
const ENGLISH_MARKERS = new Set([
  "the","a","an","is","are","was","were","be","been","being",
  "of","to","in","on","at","for","with","by","from",
  "and","or","but","not","this","that","these","those",
  "it","its","they","them","their","there","here",
  "have","has","had","do","does","did",
  "will","would","can","could","should","must","may","might",
  "because","so","as","than","then","when","while","if",
  "into","onto","about","over","under","through",
  // common school-science English words that are unambiguously English
  "increase","decrease","cell","cells","body","reaction","reactions",
  "faster","temperature","happen","happens","activation","energy",
]);

export function detectAnswerLanguage(text: string): AnswerLanguage {
  const cleaned = (text || "").toLowerCase().replace(/[^a-z\s]/g, " ");
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "english";

  let malayHits = 0;
  let englishHits = 0;
  for (const token of tokens) {
    if (MALAY_MARKERS.has(token)) malayHits += 1;
    else if (ENGLISH_MARKERS.has(token)) englishHits += 1;
  }

  const total = malayHits + englishHits;
  if (total === 0) return "english";
  const malayRatio = malayHits / total;
  if (malayRatio >= 0.7) return "malay";
  if (malayRatio <= 0.3) return "english";
  return "mixed";
}

export function buildLanguageDirective(language: AnswerLanguage): string {
  const level =
    "Use simple, student-friendly wording for SPM Form 4/5: short sentences, common school words, no advanced jargon.";
  if (language === "malay") {
    return `OUTPUT LANGUAGE = BAHASA MELAYU. ${level} Write feedback, strengths, improvements ENTIRELY in Bahasa Melayu. Standard scientific terms may be kept. Do NOT use full English sentences.`;
  }
  if (language === "mixed") {
    return `OUTPUT LANGUAGE = ENGLISH (student wrote mixed language; default to English). ${level} Do NOT switch into full Bahasa Melayu sentences.`;
  }
  return `OUTPUT LANGUAGE = ENGLISH. ${level} Write feedback, strengths, improvements ENTIRELY in English. Do NOT use full Bahasa Melayu sentences.`;
}

// ---------------------------------------------------------------------------
// Question-type detection helpers
// ---------------------------------------------------------------------------

/**
 * True when the question asks for a label/name from a diagram (not a function
 * or explanation).  Takes the already-lowercased question text.
 */
export function isDiagramLabelQuestion(cleaned: string): boolean {
  // If the question asks for role/function/reason/how, treat it as
  // state/explain/describe — not a pure labelling task.
  const asksRoleOrFunction =
    /\b(?:role|function|purpose|importance|use|used for|adapt(?:ation|ed)?|why|how|effect|benefit|helps?)\b/.test(cleaned) ||
    /\b(?:peranan|fungsi|tujuan|kepentingan|kegunaan|untuk apa|adaptasi|mengapa|bagaimana|kesan|manfaat|membantu)\b/.test(cleaned);
  if (asksRoleOrFunction) return false;

  const enLabelVerb = /\b(?:name|identify|state|label)\b/;
  const enLabelNoun =
    /\b(?:part(?:s)?|structure(?:s)?|organ(?:s)?|tissue(?:s)?|component(?:s)?|apparatus|labelled|labeled|marked|figure|diagram)\b/;
  const enLetterRefs =
    /\b(?:labelled|labeled|marked)\s+(?:as\s+)?[A-Z](?:\s*(?:,|and|or|to)\s*[A-Z])*\b/;
  const enBasedOnDiagram = /\bbased\s+on\s+(?:the\s+)?(?:diagram|figure|rajah)\b/;

  const bmLabelVerb = /\b(?:namakan|nyatakan|kenal\s*pasti|labelkan)\b/;
  const bmLabelNoun =
    /\b(?:bahagian|struktur|organ|tisu|komponen|radas|berlabel|berdasarkan\s+rajah|rajah)\b/;
  const bmLetterRefs =
    /\bberlabel\s+[A-Z](?:\s*(?:,|dan|atau|hingga)\s*[A-Z])*\b/;

  if (enLabelVerb.test(cleaned) && enLabelNoun.test(cleaned)) return true;
  if (enLetterRefs.test(cleaned) && enLabelVerb.test(cleaned)) return true;
  if (enBasedOnDiagram.test(cleaned) && enLabelVerb.test(cleaned)) return true;
  if (bmLabelVerb.test(cleaned) && bmLabelNoun.test(cleaned)) return true;
  if (bmLetterRefs.test(cleaned) && bmLabelVerb.test(cleaned)) return true;
  return false;
}

/**
 * True when the question asks students to read/interpret a graph.
 * Takes the already-lowercased question text.
 */
// ---------------------------------------------------------------------------
// Answer text normalization (shared by fairness, sequence, sufficiency)
// ---------------------------------------------------------------------------

export function normalizeAnswerText(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeFormulaText(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[→←=]/g, "");
}

export function isGraphReadingQuestion(cleaned: string): boolean {
  const enGraphRef =
    /\b(?:from|based\s+on|using|refer(?:\s+to)?)\s+(?:the\s+)?graph\b/.test(cleaned) ||
    /\bthe\s+graph\s+(?:shows|above|below|in|illustrates)\b/.test(cleaned) ||
    /\b(?:gradient|slope)\s+of\s+(?:the\s+)?(?:graph|line|curve)\b/.test(cleaned) ||
    /\b(?:y[-\s]?intercept|x[-\s]?intercept|area\s+under\s+(?:the\s+)?(?:graph|curve)|turning\s+point)\b/.test(
      cleaned,
    ) ||
    /\b(?:read|determine|find|calculate|state)\s+(?:the\s+)?value\s+of\s+[a-z]\s+when\s+[a-z]\s*=/.test(cleaned);
  const bmGraphRef =
    /\b(?:daripada|berdasarkan)\s+graf\b/.test(cleaned) ||
    /\bgraf\s+(?:di\s+)?(?:atas|bawah|menunjukkan)\b/.test(cleaned) ||
    /\b(?:cerun|kecerunan)\s+(?:graf|garis|lengkung)\b/.test(cleaned) ||
    /\bpintasan[-\s]?[xy]\b/.test(cleaned) ||
    /\bluas\s+di\s+bawah\s+(?:graf|lengkung)\b/.test(cleaned);
  return enGraphRef || bmGraphRef;
}
