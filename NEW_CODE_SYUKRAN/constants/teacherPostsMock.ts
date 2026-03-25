import type { TeacherFeedPost } from "../types/teacherFeedPost";

export type TeacherPost = TeacherFeedPost;

export const TEACHER_POSTS_MOCK: TeacherFeedPost[] = [
  {
    id: "1",
    title: "Welcome to MySPM",
    author: "Cikgu Hidayah",
    authorRole: "teacher",
    timeAgo: "2h ago",
    initials: "CH",
    excerpt: "Short recap for the circular motion unit.",
    content:
      "Remember that in circular motion, the acceleration is always directed towards the center. #SPMPhysics",
    categoryLabel: "Announcement",
    audienceLabel: "All audience",
    pinned: true,
  },
  {
    id: "2",
    title: "SPM focus",
    author: "Pn. Aminah",
    authorRole: "teacher",
    timeAgo: "5h ago",
    initials: "PA",
    excerpt: "",
    content:
      "For quadratic equations, always check the discriminant before deciding how many roots you have. Practice the completing-the-square method until it feels automatic.",
    categoryLabel: "Tips",
    audienceLabel: "Form 5",
    pinned: false,
  },
  {
    id: "3",
    title: "Redox reminder",
    author: "En. Raj",
    authorRole: "teacher",
    timeAgo: "1d ago",
    initials: "ER",
    excerpt: "",
    content:
      "When balancing redox in acidic medium: balance O with H2O, then H with H+, then charge with electrons. Write half-equations first, then combine.",
    categoryLabel: "Chemistry",
    audienceLabel: "All audience",
    pinned: false,
  },
  {
    id: "4",
    title: "Biology recap",
    author: "Cikgu Wei",
    authorRole: "teacher",
    timeAgo: "1d ago",
    initials: "CW",
    excerpt: "",
    content:
      "Photosynthesis light vs dark reaction: know where ATP and NADPH are made vs used. Examiners love labeling diagrams of the chloroplast.",
    categoryLabel: "Tips",
    audienceLabel: "Form 4",
    pinned: false,
  },
  {
    id: "5",
    title: "English Paper 2",
    author: "Pn. Kumar",
    authorRole: "teacher",
    timeAgo: "2d ago",
    initials: "PK",
    excerpt: "",
    content:
      "For directed writing, allocate 5 minutes to plan: audience, tone, three clear points. Your closing should mirror the purpose stated in the question.",
    categoryLabel: "Assignment",
    audienceLabel: "All audience",
    pinned: false,
  },
];
