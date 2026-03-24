import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import ProfileScreen from "../screens/ProfileScreen";
import ProfileSettingsScreen from "../screens/ProfileSettingsScreen";

export type ProfileStackParamList = {
  ProfileIndex: undefined;
  ProfileSettings: undefined;
};

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export default function ProfileStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.screenBackground },
      }}
    >
      <Stack.Screen name="ProfileIndex" component={ProfileScreen} />
      <Stack.Screen
        name="ProfileSettings"
        component={ProfileSettingsScreen}
        options={{
          headerShown: true,
          title: "Settings",
          headerBackTitle: "Back",
          headerTitleStyle: { fontFamily: fonts.semiBold },
          headerBackTitleStyle: { fontFamily: fonts.medium },
        }}
      />
    </Stack.Navigator>
  );
}
