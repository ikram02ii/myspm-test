/** Maps onboarding LOV codes to `practice_sets.subject` strings returned by the API. */
const CODE_TO_PRACTICE_SUBJECT: Record<string, string> = {
  BM: "Bahasa Melayu",
  bm: "Bahasa Melayu",
  EN: "English",
  ENG: "English",
  english: "English",
  MATH: "Mathematics",
  MATHEMATICS: "Mathematics",
  math: "Mathematics",
  ADDMATH: "Additional Math",
  ADDMATHS: "Additional Math",
  addmath: "Additional Math",
  addmaths: "Additional Math",
  BIO: "Biology",
  BIOLOGY: "Biology",
  biology: "Biology",
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
  math: "MATH",
  addmath: "+MATH",
  addmaths: "+MATH",
  chemistry: "CHEM",
  chem: "CHEM",
  physics: "PHY",
  phy: "PHY",
  biology: "BIO",
  bio: "BIO",
  english: "ENG",
  eng: "ENG",
  bm: "BM",
  history: "SEJ",
  sejarah: "SEJ",
  perniagaan: "PERN",
  akaun: "AKAU",
  prinsipperakaunan: "AKAU",
  account: "AKAU",
  ekonomi: "EKON",
  geografi: "GEOG",
};

export function subjectTileShortLabel(code: string): string {
  const key = code.trim().toLowerCase();
  const override = TILE_SHORT_LABEL_OVERRIDES[key];
  if (override) return override;

  const t = code.trim().toUpperCase();
  return t.length <= 4 ? t : t.slice(0, 4);
}

const PRACTICE_SET_SUBJECT_ALIASES: Record<string, string[]> = {
  math: ["mathematics", "math"],
  addmath: ["additional math", "additional mathematics", "add maths"],
  biology: ["biology", "science"],
  physics: ["physics"],
  chemistry: ["chemistry"],
  english: ["english"],
  bm: ["bahasa melayu", "bm"],
};

export function practiceSetSubjectMatchesFavourite(
  practiceSetSubject: string,
  favourite: { code: string; name: string }
): boolean {
  const set = practiceSetSubject.trim().toLowerCase();
  const name = favourite.name.trim().toLowerCase();
  if (set === name) return true;

  const codeKey = favourite.code.trim().toLowerCase();
  const aliases = PRACTICE_SET_SUBJECT_ALIASES[codeKey];
  if (aliases?.some((alias) => set === alias)) return true;

  const mapped = CODE_TO_PRACTICE_SUBJECT[favourite.code] ?? CODE_TO_PRACTICE_SUBJECT[favourite.code.toUpperCase()];
  if (mapped && mapped.trim().toLowerCase() === set) return true;

  return false;
}
