import AsyncStorage from "@react-native-async-storage/async-storage";

import { MOBILE_API_BASE_URL } from "../constants/api";
import { AUTH_TOKEN_STORAGE_KEY } from "../constants/storageKeys";

export type OnboardingSubject = {
  code: string;
  name: string;
};

export type OnboardingSchool = {
  id: number;
  name: string;
  city?: string;
  state?: string;
};

export type OnboardingTeacher = {
  id: number;
  name: string;
  followerCount: number;
};

type SubjectsResponse = {
  data?: OnboardingSubject[];
  error?: string;
};

type SchoolsResponse = {
  data?: OnboardingSchool[];
  error?: string;
};

type TeacherApiRow = {
  id: number;
  name: string;
  followerCount?: unknown;
};

type TeachersResponse = {
  data?: TeacherApiRow[];
  error?: string;
};

async function getJson<T>(endpoint: string): Promise<T> {
  const token = await AsyncStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  if (!token) {
    throw new Error("Not signed in");
  }
  const url = `${MOBILE_API_BASE_URL}${endpoint}`;
  console.log("[Mobile API][Request]", { method: "GET", url });
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = (await response.json()) as T & { error?: string };
  console.log("[Mobile API][Response]", {
    method: "GET",
    url,
    status: response.status,
    ok: response.ok,
    body: data,
  });
  if (!response.ok) {
    throw new Error(data.error ?? "Failed to load onboarding data");
  }
  return data;
}

export async function fetchOnboardingData(): Promise<{
  subjects: OnboardingSubject[];
  schools: OnboardingSchool[];
  teachers: OnboardingTeacher[];
}> {
  const [subjectsRes, schoolsRes, teachersRes] = await Promise.all([
    getJson<SubjectsResponse>("/onboarding/subjects"),
    getJson<SchoolsResponse>("/onboarding/schools"),
    getJson<TeachersResponse>("/onboarding/teachers"),
  ]);

  const rawTeachers = teachersRes.data ?? [];
  const teachers: OnboardingTeacher[] = rawTeachers.map((t) => {
    const n = Number(t.followerCount);
    const followerCount = Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
    return { id: t.id, name: t.name, followerCount };
  });

  return {
    subjects: subjectsRes.data ?? [],
    schools: schoolsRes.data ?? [],
    teachers,
  };
}

export type CompleteOnboardingPayload = {
  formLevel: 4 | 5;
  schoolId: number;
  subjectCodes: string[];
  teacherIds: number[];
};

export async function completeMobileOnboarding(payload: CompleteOnboardingPayload): Promise<void> {
  const token = await AsyncStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  if (!token) {
    throw new Error("Not signed in");
  }
  const url = `${MOBILE_API_BASE_URL}/onboarding/complete`;
  console.log("[Mobile API][Request]", { method: "POST", url, body: payload });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = (await response.json()) as { data?: { ok: boolean }; error?: string };
  console.log("[Mobile API][Response]", {
    method: "POST",
    url,
    status: response.status,
    ok: response.ok,
    body: data,
  });
  if (!response.ok) {
    throw new Error(data.error ?? "Failed to save onboarding");
  }
}
