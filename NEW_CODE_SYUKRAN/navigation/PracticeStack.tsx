import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";
import PracticeScreen from "../screens/PracticeScreen";
import AddPracticeSubjectScreen from "../screens/AddPracticeSubjectScreen";

export type PracticeStackParamList = {
  PracticeIndex: { addedSubjectId?: string } | undefined;
  AddPracticeSubject: { currentSubjectIds: string[] };
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
      <Stack.Screen name="PracticeIndex" component={PracticeScreen} />
      <Stack.Screen
        name="AddPracticeSubject"
        component={AddPracticeSubjectScreen}
        options={{
          headerShown: true,
          title: "Add subject",
          headerBackTitle: "Back",
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
