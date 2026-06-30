export type PracticeSubjectIconId =
  | "calc"
  | "landmark"
  | "sigma"
  | "flask"
  | "atom"
  | "leaf"
  | "book"
  | "languages";

export type PracticeSubjectDef = {
  id: string;
  label: string;
  topicsActive: number;
  icon: PracticeSubjectIconId;
};

export const PRACTICE_SUBJECT_CATALOG: PracticeSubjectDef[] = [
  { id: "math", label: "Mathematics", topicsActive: 12, icon: "calc" },
  { id: "history", label: "History", topicsActive: 8, icon: "landmark" },
  { id: "addmath", label: "Add Maths", topicsActive: 18, icon: "sigma" },
  { id: "physics", label: "Physics", topicsActive: 14, icon: "atom" },
  { id: "chemistry", label: "Chemistry", topicsActive: 11, icon: "flask" },
  { id: "biology", label: "Biology", topicsActive: 13, icon: "leaf" },
  { id: "english", label: "English", topicsActive: 10, icon: "book" },
  { id: "bm", label: "Bahasa Melayu", topicsActive: 9, icon: "languages" },
  { id: "pisislam", label: "Pendidikan Islam", topicsActive: 9, icon: "book" },
  { id: "pismoral", label: "Pendidikan Moral", topicsActive: 6, icon: "book" },
  { id: "perniagaan", label: "Perniagaan", topicsActive: 6, icon: "book" },
  { id: "akaun", label: "Prinsip Perakaunan", topicsActive: 6, icon: "book" },
  { id: "ekonomi", label: "Ekonomi", topicsActive: 6, icon: "book" },
  { id: "geografi", label: "Geografi", topicsActive: 6, icon: "book" },
];

export const TOPICS_BY_SUBJECT: Record<string, string[]> = {
  math: ["Algebra", "Functions", "Trigonometry", "Statistics", "Probability"],
  addmath: ["Differentiation", "Integration", "Vectors", "Matrices"],
  physics: ["Forces", "Energy", "Waves", "Electricity", "Modern Physics"],
  chemistry: ["Acids & Bases", "Organic", "Periodic Table", "Moles", "Redox"],
  biology: ["Cell", "Genetics", "Ecology", "Human Physiology", "Evolution"],
  english: ["Comprehension", "Writing", "Literature", "Grammar", "Summary"],
  bm: ["Komsas", "Karangan", "Tatabahasa", "Ramalan", "Novel"],
  pisislam: ["Akidah", "Ibadah", "Sirah", "Adab", "Al-Quran"],
  pismoral: ["Nilai murni", "Keprihatinan sosial", "Patriotisme", "Keberanian moral"],
  perniagaan: ["Pemasaran", "Kewangan", "Pengurusan", "Dokumentasi"],
  akaun: ["Jurnal", "Lejar", "Imbangan duga", "Penyata kewangan"],
  ekonomi: [
    "Pengenalan kepada Ekonomi",
    "Pasaran",
    "Wang, Bank dan Pendapatan Individu",
    "Pengeluaran",
    "Ekonomi dan Kerajaan",
    "Malaysia dan Ekonomi Global",
  ],
  geografi: ["Bentuk muka bumi", "Cuaca", "Penduduk", "Pembangunan lestari"],
};

export const DEFAULT_PRACTICE_SUBJECT_IDS: string[] = ["math", "addmath"];

export function subjectDefById(id: string): PracticeSubjectDef | undefined {
  return PRACTICE_SUBJECT_CATALOG.find((s) => s.id === id);
}
