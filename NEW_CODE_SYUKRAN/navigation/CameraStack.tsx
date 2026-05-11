import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { colors } from "../constants/colors";
import { fonts } from "../constants/fonts";
import { theme } from "../constants/palette";
import CameraScreen from "../screens/CameraScreen";
import CameraCaptureScreen from "../screens/CameraCaptureScreen";
import CameraHistoryScreen from "../screens/CameraHistoryScreen";
import CameraPreviewScreen from "../screens/CameraPreviewScreen";
import type { AiScanOcrResult } from "../services/mobileScan";

export type CameraStackParamList = {
  CameraIndex: undefined;
  CameraCapture: undefined;
  CameraHistory: undefined;
  CameraPreview: { photoUri: string; aiResult?: AiScanOcrResult };
};

const Stack = createNativeStackNavigator<CameraStackParamList>();

const BRAND = theme.brand;

export default function CameraStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        contentStyle: { backgroundColor: colors.screenBackground },
        headerTintColor: BRAND,
        headerStyle: { backgroundColor: colors.screenBackground },
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: fonts.semiBold, color: colors.text },
        headerBackTitleStyle: { fontFamily: fonts.medium },
      }}
    >
      <Stack.Screen name="CameraIndex" component={CameraScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="CameraCapture"
        component={CameraCaptureScreen}
        options={{
          headerShown: true,
          title: "Scan Question",
          headerBackTitle: "Back",
        }}
      />
      <Stack.Screen
        name="CameraHistory"
        component={CameraHistoryScreen}
        options={{
          headerShown: true,
          title: "History",
          headerBackTitle: "Back",
        }}
      />
      <Stack.Screen
        name="CameraPreview"
        component={CameraPreviewScreen}
        options={{
          headerShown: true,
          title: "Preview",
          headerBackTitle: "Retake",
        }}
      />
    </Stack.Navigator>
  );
}

