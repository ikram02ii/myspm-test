/** Maps onboarding LOV codes to `practice_sets.subject` strings returned by the API. */
const CODE_TO_PRACTICE_SUBJECT: Record<string, string> = {
  BM: "Bahasa Melayu",
  bm: "Bahasa Melayu",
  EN: "English",
  ENG: "English",
  ENGLISH: "English",
  english: "English",
  MATH: "Mathematics",
  MATHEMATICS: "Mathematics",
  math: "Mathematics",
  ADDMATH: "Additional Math",
  ADDMATHS: "Additional Math",
  addmath: "Additional Math",
  BIO: "Biology",
  BIOLOGY: "Biology",
  biology: "Biology",
  PHY: "Physics",
  PHYS: "Physics",
  PHYSICS: "Physics",
  physics: "Physics",
  CHEMISTRY: "Chemistry",
  chemistry: "Chemistry",
  SEJARAH: "History",
  history: "History",
  PISLAM: "Pendidikan Islam",
  pisislam: "Pendidikan Islam",
  PENDIDIKANISLAM: "Pendidikan Islam",
  PISMORAL: "Pendidikan Moral",
  pismoral: "Pendidikan Moral",
  PENDIDIKANMORAL: "Pendidikan Moral",
  PERNIAGAAN: "Perniagaan",
  perniagaan: "Perniagaan",
  AKAUN: "Prinsip Perakaunan",
  akaun: "Prinsip Perakaunan",
  ACCOUNT: "Prinsip Perakaunan",
  account: "Prinsip Perakaunan",
  PRINSIPPERAKAUNAN: "Prinsip Perakaunan",
  EKONOMI: "Ekonomi",
  ekonomi: "Ekonomi",
  ECONOMICS: "Ekonomi",
  GEOGRAFI: "Geografi",
  geografi: "Geografi",
  GEOGRAPHY: "Geografi",
};

const TILE_SHORT_LABEL_OVERRIDES: Record<string, string> = {
  history: "SEJ",
  sejarah: "SEJ",
  perniagaan: "PERN",
  akaun: "AKAU",
  prinsipperakaunan: "AKAU",
  account: "AKAU",
  ekonomi: "EKON",
  geografi: "GEOG",
};

/** Backend RAG / generate API subject string from a favourite or tile code (e.g. ENG → English). */
export function backendSubjectFromPracticeCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const raw = code.trim();
  if (!raw) return null;
  const mapped =
    CODE_TO_PRACTICE_SUBJECT[raw] ??
    CODE_TO_PRACTICE_SUBJECT[raw.toLowerCase()] ??
    CODE_TO_PRACTICE_SUBJECT[raw.toUpperCase()];
  return mapped?.trim() || null;
}

export function subjectTileShortLabel(code: string): string {
  const key = code.trim().toLowerCase();
  const override = TILE_SHORT_LABEL_OVERRIDES[key];
  if (override) return override;

  const t = code.trim().toUpperCase();
  if (t === "ADDMATH" || t === "ADDMATHS") return "+MATH";
  if (t === "PHYSICS" || t === "PHY" || t === "PHYS") return "PHYS";
  if (t === "CHEMISTRY") return "CHEM";
  if (t === "BIOLOGY") return "BIO";
  return t.length <= 4 ? t : t.slice(0, 4);
}

export function practiceSetSubjectMatchesFavourite(
  practiceSetSubject: string,
  favourite: { code: string; name: string }
): boolean {
  const set = practiceSetSubject.trim().toLowerCase();
  const name = favourite.name.trim().toLowerCase();
  if (set === name) return true;

  const codeUpper = favourite.code.trim().toUpperCase();
  if (codeUpper === "ADDMATH" || codeUpper === "ADDMATHS") {
    const addMathHints = [
      "additional mathematics",
      "additional math",
      "add maths",
      "add math",
    ];
    if (addMathHints.some((h) => set.includes(h))) return true;
  }

  const mapped = CODE_TO_PRACTICE_SUBJECT[favourite.code] ?? CODE_TO_PRACTICE_SUBJECT[favourite.code.toUpperCase()];
  if (mapped && mapped.trim().toLowerCase() === set) return true;

  return false;
}
