import {
  capitalizeFirstChar,
  formatRelativeTime,
  formatTeacherPostAudience,
  getInitialsFromName,
} from "../utils/display";
import type { TeacherFeedPost } from "../types/teacherFeedPost";
import { mobileApiGet } from "./mobileApi";

type DashboardPostApi = {
  id: number;
  title: string;
  excerpt: string | null;
  content: string | null;
  category: string;
  audience: string;
  pinned: boolean;
  createdAt: string;
  authorName: string;
  authorRole: string;
};

type DashboardResponse = {
  data?: {
    greetingName: string;
    streakDays: number;
    totalXp: number;
    teacherPosts: DashboardPostApi[];
  };
  error?: string;
};

const EXCERPT_MAX = 400;
const CONTENT_MAX = 1200;

function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function normalizeExcerptAndContent(
  excerptRaw: string,
  contentRaw: string
): { excerpt: string; content: string } {
  let excerpt = excerptRaw.trim();
  let content = contentRaw.trim();
  if (excerpt && content) {
    if (excerpt === content) {
      excerpt = "";
    } else if (content.startsWith(excerpt)) {
      excerpt = "";
    }
  }
  return {
    excerpt: excerpt ? clipText(excerpt, EXCERPT_MAX) : "",
    content: content ? clipText(content, CONTENT_MAX) : "",
  };
}

function mapPost(row: DashboardPostApi): TeacherFeedPost {
  const { excerpt, content } = normalizeExcerptAndContent(
    row.excerpt ?? "",
    row.content ?? ""
  );
  return {
    id: String(row.id),
    title: row.title?.trim() ?? "",
    author: row.authorName,
    authorRole: row.authorRole,
    timeAgo: formatRelativeTime(row.createdAt),
    initials: getInitialsFromName(row.authorName),
    excerpt,
    content,
    categoryLabel: capitalizeFirstChar(row.category),
    audienceLabel: formatTeacherPostAudience(row.audience),
    pinned: Boolean(row.pinned),
  };
}

export type MobileDashboardData = {
  greetingName: string;
  streakDays: number;
  totalXp: number;
  teacherPosts: TeacherFeedPost[];
};

export async function fetchMobileDashboard(postsLimit = 10): Promise<MobileDashboardData> {
  const qs = postsLimit !== 10 ? `?postsLimit=${postsLimit}` : "";
  const res = await mobileApiGet<DashboardResponse>(`/dashboard${qs}`);
  const data = res.data;
  if (!data) {
    throw new Error("Invalid dashboard response");
  }
  return {
    greetingName: data.greetingName,
    streakDays: data.streakDays,
    totalXp: data.totalXp,
    teacherPosts: (data.teacherPosts ?? []).map(mapPost),
  };
}
