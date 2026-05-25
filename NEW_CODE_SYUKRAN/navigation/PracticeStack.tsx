import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";
import PracticeSetsLibraryScreen from "../screens/PracticeSetsLibraryScreen";
import PracticeSetDetailScreen from "../screens/PracticeSetDetailScreen";
import PracticeSessionScreen from "../screens/PracticeSessionScreen";
import OralPracticeScreen from "../screens/OralPracticeScreen";
import OralReviewScreen from "../screens/OralReviewScreen";
import type { PracticeSetQuestion } from "../services/mobilePracticeSets";
import type { SttLanguage } from "../services/oralApi";

export type PracticeStackParamList = {
  PracticeLibrary: undefined;
  PracticeSetDetail: {
    setId: number;
    title: string;
    subject: string;
    formLevel: string;
    questionCount: number;
  };
  PracticeSession:
    | { setId: number; title: string; subject?: string; formLevel?: string }
    | { title: string; questions: PracticeSetQuestion[]; subject?: string; formLevel?: string };
  OralPractice: {
    prompt: string;
    subject: string;
    formLevel: string;
    sttLanguage: SttLanguage;
  };
  OralReview: {
    prompt: string;
    transcript: string;
    subject: string;
    formLevel: string;
  };
};

const Stack = createNativeStackNavigator<PracticeStackParamList>();

const BRAND = theme.brand;

export default function PracticeStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.screenBackground },
      }}
    >
      <Stack.Screen name="PracticeLibrary" component={PracticeSetsLibraryScreen} />
      <Stack.Screen
        name="PracticeSetDetail"
        component={PracticeSetDetailScreen}
        options={{
          headerShown: true,
          title: "Practice set",
          headerBackTitle: "Sets",
          headerTintColor: BRAND,
          headerStyle: { backgroundColor: colors.screenBackground },
          headerShadowVisible: false,
          headerTitleStyle: { fontFamily: fonts.semiBold, color: colors.text },
          headerBackTitleStyle: { fontFamily: fonts.medium },
        }}
      />
      <Stack.Screen
        name="PracticeSession"
        component={PracticeSessionScreen}
        options={{
          headerShown: true,
          headerBackTitle: "Back",
          headerTintColor: BRAND,
          headerStyle: { backgroundColor: colors.screenBackground },
          headerShadowVisible: false,
          headerTitleStyle: { fontFamily: fonts.semiBold, color: colors.text },
          headerBackTitleStyle: { fontFamily: fonts.medium },
        }}
      />
      <Stack.Screen
        name="OralPractice"
        component={OralPracticeScreen}
        options={{
          headerShown: true,
          title: "Oral practice",
          headerBackTitle: "Back",
          headerTintColor: BRAND,
          headerStyle: { backgroundColor: colors.screenBackground },
          headerShadowVisible: false,
          headerTitleStyle: { fontFamily: fonts.semiBold, color: colors.text },
          headerBackTitleStyle: { fontFamily: fonts.medium },
        }}
      />
      <Stack.Screen
        name="OralReview"
        component={OralReviewScreen}
        options={{
          headerShown: true,
          title: "Review & submit",
          headerBackTitle: "Practice",
          headerTintColor: BRAND,
          headerStyle: { backgroundColor: colors.screenBackground },
          headerShadowVisible: false,
          headerTitleStyle: { fontFamily: fonts.semiBold, color: colors.text },
          headerBackTitleStyle: { fontFamily: fonts.medium },
        }}
      />
    </Stack.Navigator>
  );
}
