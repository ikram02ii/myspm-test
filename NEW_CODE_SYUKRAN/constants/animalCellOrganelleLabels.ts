import type { OrganelleId } from "../utils/biologyDiagramHighlights";

export type OrganelleLabelPair = {
  bm: string;
  en: string;
};

export const ANIMAL_CELL_ORGANELLE_LABELS: Record<OrganelleId, OrganelleLabelPair> = {
  cellMembrane: { bm: "Membran sel", en: "Cell membrane" },
  nucleus: { bm: "Nukleus", en: "Nucleus" },
  nucleolus: { bm: "Nukleolus", en: "Nucleolus" },
  roughEr: { bm: "RE kasar", en: "Rough ER" },
  smoothEr: { bm: "RE lisc", en: "Smooth ER" },
  golgi: { bm: "Badan Golgi", en: "Golgi apparatus" },
  mitochondrion: { bm: "Mitokondrion", en: "Mitochondrion" },
  vesicle: { bm: "Vesikel", en: "Vesicle" },
};

/** SPM-style bilingual label: Malay first, English in parentheses */
export function bilingualOrganelleLabel(id: OrganelleId): string {
  const pair = ANIMAL_CELL_ORGANELLE_LABELS[id];
  return `${pair.bm} (${pair.en})`;
}
