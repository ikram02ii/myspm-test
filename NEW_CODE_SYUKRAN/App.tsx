import React, { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as Notifications from "expo-notifications";
import { GestureHandlerRootView, TapGestureHandler } from "react-native-gesture-handler";
import {
  useFonts,
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
  Geist_800ExtraBold,
} from "@expo-google-fonts/geist";

import { fonts } from "./constants/fonts";
import WelcomeScreen from "./screens/WelcomeScreen";
import LoginScreen from "./screens/LoginScreen";
import SignUpScreen from "./screens/SignUpScreen";
import ForgotPasswordScreen from "./screens/ForgotPasswordScreen";
import ResetPasswordScreen from "./screens/ResetPasswordScreen";
import MainTabs from "./navigation/MainTabs";
import PostLoginOnboardingScreen from "./screens/PostLoginOnboardingScreen";
import { configureGoogleSignIn } from "./services/googleSignIn";
import { NetworkLogOverlay } from "./components/ui/NetworkLogOverlay";

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
  const [netLogOpen, setNetLogOpen] = useState(false);

  useEffect(() => {
    configureGoogleSignIn();
  }, []);

  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: false,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  }, []);

  if (!loaded) {
    return <View style={{ flex: 1, backgroundColor: "#F8F9FB" }} />;
  }
  applyGlobalFonts();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <TapGestureHandler
        numberOfTaps={2}
        minPointers={2}
        onActivated={() => setNetLogOpen(true)}
      >
        <View style={{ flex: 1 }}>
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

          <NetworkLogOverlay visible={netLogOpen} onClose={() => setNetLogOpen(false)} />
        </View>
      </TapGestureHandler>
    </GestureHandlerRootView>
  );
}
