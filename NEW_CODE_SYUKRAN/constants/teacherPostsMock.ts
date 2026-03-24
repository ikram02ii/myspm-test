export type TeacherPost = {
  id: string;
  author: string;
  role: string;
  timeAgo: string;
  initials: string;
  body: string;
};

export const TEACHER_POSTS_MOCK: TeacherPost[] = [
  {
    id: "1",
    author: "Cikgu Hidayah",
    role: "Senior Physics Educator",
    timeAgo: "2h ago",
    initials: "CH",
    body:
      "Remember that in circular motion, the acceleration is always directed towards the center. #SPMPhysics",
  },
  {
    id: "2",
    author: "Pn. Aminah",
    role: "Mathematics · Form 5",
    timeAgo: "5h ago",
    initials: "PA",
    body:
      "For quadratic equations, always check the discriminant before deciding how many roots you have. Practice the completing-the-square method until it feels automatic.",
  },
  {
    id: "3",
    author: "En. Raj",
    role: "Chemistry",
    timeAgo: "1d ago",
    initials: "ER",
    body:
      "When balancing redox in acidic medium: balance O with H2O, then H with H+, then charge with electrons. Write half-equations first, then combine.",
  },
  {
    id: "4",
    author: "Cikgu Wei",
    role: "Biology · SPM",
    timeAgo: "1d ago",
    initials: "CW",
    body:
      "Photosynthesis light vs dark reaction: know where ATP and NADPH are made vs used. Examiners love labeling diagrams of the chloroplast.",
  },
  {
    id: "5",
    author: "Pn. Kumar",
    role: "English Paper 2",
    timeAgo: "2d ago",
    initials: "PK",
    body:
      "For directed writing, allocate 5 minutes to plan: audience, tone, three clear points. Your closing should mirror the purpose stated in the question.",
  },
];
