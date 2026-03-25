import { useEffect } from "react";
import { Text, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import {
  useFonts,
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
  Geist_800ExtraBold,
} from "@expo-google-fonts/geist";

import { fonts } from "./constants/fonts";
import { POST_LOGIN_ONBOARDING_STORAGE_KEY } from "./constants/storageKeys";
import WelcomeScreen from "./screens/WelcomeScreen";
import LoginScreen from "./screens/LoginScreen";
import SignUpScreen from "./screens/SignUpScreen";
import ForgotPasswordScreen from "./screens/ForgotPasswordScreen";
import ResetPasswordScreen from "./screens/ResetPasswordScreen";
import MainTabs from "./navigation/MainTabs";
import PostLoginOnboardingScreen from "./screens/PostLoginOnboardingScreen";
import { configureGoogleSignIn } from "./services/googleSignIn";

export type RootStackParamList = {
  Welcome: undefined;
  Login: undefined;
  SignUp: undefined;
  ForgotPassword: undefined;
  ResetPassword: { token?: string };
  PostLoginOnboarding: undefined;
  Main: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

let globalFontApplied = false;

function applyGlobalFonts() {
  if (globalFontApplied) return;
  globalFontApplied = true;
  const T = Text as typeof Text & { defaultProps?: { style?: object } };
  T.defaultProps = T.defaultProps || {};
  T.defaultProps.style = { fontFamily: fonts.regular };
  const TI = TextInput as typeof TextInput & { defaultProps?: { style?: object } };
  TI.defaultProps = TI.defaultProps || {};
  TI.defaultProps.style = { fontFamily: fonts.regular };
}

export default function App() {
  const [loaded] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    Geist_800ExtraBold,
  });

  useEffect(() => {
    configureGoogleSignIn();
    if (__DEV__) {
      AsyncStorage.removeItem(POST_LOGIN_ONBOARDING_STORAGE_KEY).catch(() => {});
    }
  }, []);

  if (!loaded) {
    return <View style={{ flex: 1, backgroundColor: "#F8F9FB" }} />;
  }
  applyGlobalFonts();

  return (
    <NavigationContainer>
      <StatusBar style="auto" />
      <Stack.Navigator
        initialRouteName="Welcome"
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Welcome" component={WelcomeScreen} />
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="SignUp" component={SignUpScreen} />
        <Stack.Screen name="PostLoginOnboarding" component={PostLoginOnboardingScreen} />
        <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
        <Stack.Screen
          name="ResetPassword"
          component={ResetPasswordScreen}
          initialParams={{ token: "mock" }}
        />
        <Stack.Screen name="Main" component={MainTabs} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
