/**
 * Cheap heuristic: OCR sometimes concatenates an unrelated subject's working
 * onto the real answer (e.g. physics kinematics + chemistry moles).
 */

export type TopicBleedHit = {
  mixed: boolean;
  warning?: string;
};

const PHYSICS_Q =
  /\b(velocity|acceleration|displacement|kinematics|m\/s|m\s*s\^-?1|u\s*\+\s*at|v\s*=\s*u|s\s*=\s*ut|at\^?2|daya|halaju|pecutan|sesaran)\b/i;
const PHYSICS_A =
  /\b(v\s*=\s*u\s*\+\s*at|s\s*=\s*u|a\s*=\s*[\d.]+\s*m\/s|m\/s(?:\u00b2|\^2)?|halaju|pecutan|sesaran)\b/i;

const CHEM_Q =
  /\b(mol(?:e)?s?|titration|molar|dm\u00b3|dm3|H\u2082|H2SO4|asid|alkali|stoichiometr|isipadu gas|bil\s*mol)\b/i;
const CHEM_A =
  /\b(bil\s*mol|mol\s+HA|mol\s+H[\u2082]|mol\s+H2|dm\u00b3(?:\s*mol)?|isipadu\s+gas|0\.\d+\s*mol|→\s*\d+\s*mol)\b/i;

const BIO_Q = /\b(cell|enzyme|photosynthesis|mesophyll|petiole|organisma|sel|enzim|fotosintesis)\b/i;
const BIO_A =
  /\b(mesophyll|petiole|kloroplas|fotosintesis|enzim|mitokondria|tisu|sel\s+penjaga)\b/i;

function scoreFlags(text: string, patterns: RegExp[]): number {
  return patterns.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
}

/**
 * Returns a student-facing warning when answer looks like a different subject
 * than the question, or clearly mixes two subjects.
 */
export function detectOcrTopicBleed(params: {
  question: string;
  studentAnswer: string;
  subject?: string;
}): TopicBleedHit {
  const question = (params.question || "").trim();
  const answer = (params.studentAnswer || "").trim();
  if (!question || !answer) return { mixed: false };

  const subject = (params.subject || "").toLowerCase();
  const qPhys = PHYSICS_Q.test(question) || /physics|fizik/.test(subject);
  const qChem = CHEM_Q.test(question) || /chem|kimia/.test(subject);
  const qBio = BIO_Q.test(question) || /bio|biologi/.test(subject);

  const aPhys = scoreFlags(answer, [PHYSICS_A, /\b[vVsS]\s*=\s*u\b/, /\bat\^2\b/]);
  const aChem = scoreFlags(answer, [CHEM_A, /\bmol\b/i, /dm\u00b3|dm3/i]);
  const aBio = scoreFlags(answer, [BIO_A]);

  // Clear dual-block: physics working + chemistry moles in one transcription
  if (aPhys >= 1 && aChem >= 2) {
    return {
      mixed: true,
      warning:
        "The scan mixes physics and chemistry working. Photo only the answer for this question, then try again.",
    };
  }
  if (aChem >= 1 && aBio >= 2) {
    return {
      mixed: true,
      warning:
        "The scan mixes chemistry and biology text. Photo only the answer for this question, then try again.",
    };
  }

  if (qPhys && !qChem && aChem >= 2 && aPhys === 0) {
    return {
      mixed: true,
      warning:
        "This looks like chemistry working, but the question is physics. Check the photo and try again.",
    };
  }
  if (qChem && !qPhys && aPhys >= 2 && aChem === 0) {
    return {
      mixed: true,
      warning:
        "This looks like physics working, but the question is chemistry. Check the photo and try again.",
    };
  }
  if (qBio && !qChem && aChem >= 2 && aBio === 0) {
    return {
      mixed: true,
      warning:
        "This looks like chemistry working, but the question is biology. Check the photo and try again.",
    };
  }

  return { mixed: false };
}
