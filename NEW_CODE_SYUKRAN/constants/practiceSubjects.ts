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
];

export const TOPICS_BY_SUBJECT: Record<string, string[]> = {
  math: ["Algebra", "Functions", "Trigonometry", "Statistics", "Probability"],
  history: ["Nationalism", "World War II", "Independence", "Statehood", "Cold War"],
  addmath: ["Differentiation", "Integration", "Vectors", "Matrices"],
  physics: ["Forces", "Energy", "Waves", "Electricity", "Modern Physics"],
  chemistry: ["Acids & Bases", "Organic", "Periodic Table", "Moles", "Redox"],
  biology: ["Cell", "Genetics", "Ecology", "Human Physiology", "Evolution"],
  english: ["Comprehension", "Writing", "Literature", "Grammar", "Summary"],
  bm: ["Komsas", "Karangan", "Tatabahasa", "Ramalan", "Novel"],
};

export const DEFAULT_PRACTICE_SUBJECT_IDS: string[] = ["math", "history", "addmath"];

export function subjectDefById(id: string): PracticeSubjectDef | undefined {
  return PRACTICE_SUBJECT_CATALOG.find((s) => s.id === id);
}
