import { mobileApiGet, mobileApiPost } from "./mobileApi";

export type MobileSubjectFavourite = {
  code: string;
  name: string;
};

export type MobileProfileData = {
  id: number;
  name: string;
  email: string;
  role: string;
  formLevel: number | null;
  schoolName: string | null;
  totalXp: number;
  streakDays: number;
  questionsAnswered: number;
  subjectFavourites: MobileSubjectFavourite[];
};

type ProfileResponse = {
  data?: MobileProfileData;
  error?: string;
};

export async function fetchMobileProfile(): Promise<MobileProfileData> {
  const res = await mobileApiGet<ProfileResponse>("/profile");
  const data = res.data;
  if (!data) {
    throw new Error("Invalid profile response");
  }
  return {
    ...data,
    subjectFavourites: data.subjectFavourites ?? [],
  };
}

type AddSubjectResponse = {
  data?: { ok: boolean };
  error?: string;
};

export async function addProfileSubjectFavourite(subjectCode: string): Promise<void> {
  await mobileApiPost<AddSubjectResponse>("/profile/subject-favourites", { subjectCode });
}
