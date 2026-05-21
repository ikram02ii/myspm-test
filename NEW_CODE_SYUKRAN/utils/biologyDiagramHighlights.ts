export type OrganelleId =
  | "cellMembrane"
  | "nucleus"
  | "nucleolus"
  | "roughEr"
  | "smoothEr"
  | "golgi"
  | "mitochondrion"
  | "vesicle";

export function shouldShowLabeledCellDiagram(text: string): boolean {
  return /\b(cell|organelle|mitochondr|chloroplast|golgi|endoplasmic|nucleus|ribosome|lysosome|vacuole|cytoplasm|membrane|er\b|secret)\b/i.test(
    text,
  );
}

export function inferOrganelleHighlights(text: string): OrganelleId[] {
  const t = text.toLowerCase();
  const highlights: OrganelleId[] = [];

  if (/\b(mitochondr|atp|aerobic respiration|cellular respiration)\b/.test(t)) {
    highlights.push("mitochondrion");
  }
  if (/\b(golgi|secret|secretion|package|modify protein)\b/.test(t)) {
    highlights.push("golgi");
  }
  if (/\b(rough er|r-er|rough endoplasmic|ribosome on er|protein synthesis)\b/.test(t)) {
    highlights.push("roughEr");
  }
  if (/\b(smooth er|s-er|smooth endoplasmic|detox|lipid|steroid|alcohol|drug|liver)\b/.test(t)) {
    highlights.push("smoothEr");
  }
  if (/\b(nucleolus)\b/.test(t)) {
    highlights.push("nucleolus");
  }
  if (/\b(nucleus|nuclear|dna|transcription)\b/.test(t)) {
    highlights.push("nucleus");
  }
  if (/\b(vesicle|transport vesicle)\b/.test(t)) {
    highlights.push("vesicle");
  }

  if (highlights.length === 0 && shouldShowLabeledCellDiagram(text)) {
    return ["nucleus", "roughEr", "smoothEr", "golgi", "mitochondrion"];
  }

  return highlights;
}

export function isBiologySubject(subject: string | undefined): boolean {
  return /^biology$/i.test(subject?.trim() ?? "");
}
