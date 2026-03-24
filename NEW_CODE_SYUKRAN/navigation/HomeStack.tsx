import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import HomeScreen from "../screens/HomeScreen";
import TeacherPostsScreen from "../screens/TeacherPostsScreen";

export type HomeStackParamList = {
  HomeIndex: undefined;
  TeacherPosts: undefined;
};

const Stack = createNativeStackNavigator<HomeStackParamList>();

const BRAND = "#7B89F4";

export default function HomeStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.screenBackground },
      }}
    >
      <Stack.Screen name="HomeIndex" component={HomeScreen} />
      <Stack.Screen
        name="TeacherPosts"
        component={TeacherPostsScreen}
        options={{
          headerShown: true,
          title: "Teacher's posts",
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
