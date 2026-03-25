import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { getFocusedRouteNameFromRoute } from "@react-navigation/native";
import {
  BottomTabBar,
  BottomTabBarProps,
  createBottomTabNavigator,
} from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import type { LucideIcon } from "lucide-react-native";
import {
  BookOpen,
  Camera,
  Home,
  Trophy,
  User,
} from "lucide-react-native";
import { colors } from "../constants/colors";
import { theme } from "../constants/palette";
import HomeStack from "./HomeStack";
import PracticeStack from "./PracticeStack";
import CameraStack from "./CameraStack";
import LeaderboardScreen from "../screens/LeaderboardScreen";
import ProfileStack from "./ProfileStack";

const BRAND = theme.brand;

export type MainTabParamList = {
  Home: undefined;
  Practice: undefined;
  Camera: undefined;
  Leaderboard: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

/** Matches `screenOptions.tabBarStyle` so per-screen overrides don’t drop positioning. */
const defaultTabBarStyle = {
  position: "absolute" as const,
  top: 28,
  backgroundColor: "transparent",
  borderTopWidth: 0,
  elevation: 0,
  shadowOpacity: 0,
  height: 0,
};

function TabBarIcon({
  focused,
  color,
  Icon,
}: {
  focused: boolean;
  color: string;
  Icon: LucideIcon;
}) {
  if (focused) {
    return (
      <View style={styles.activeIconRing}>
        <Icon size={22} color="#FFFFFF" strokeWidth={2.2} />
      </View>
    );
  }
  return <Icon size={24} color={color} strokeWidth={2} />;
}

function FloatingTabBar(props: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 12) + 6;
  const tabRoute = props.state.routes[props.state.index];
  const onPracticeTab = tabRoute?.name === "Practice";
  const onCameraTab = tabRoute?.name === "Camera";
  const practiceInner =
    onPracticeTab && tabRoute != null
      ? getFocusedRouteNameFromRoute(tabRoute) ?? "PracticeLibrary"
      : null;
  const cameraInner =
    onCameraTab && tabRoute != null
      ? getFocusedRouteNameFromRoute(tabRoute) ?? "CameraIndex"
      : null;
  if (practiceInner === "PracticeSession") {
    return null;
  }
  if (cameraInner === "CameraCapture" || cameraInner === "CameraPreview") {
    return null;
  }

  return (
    <View style={styles.floatingRoot} pointerEvents="box-none">
      <View style={[styles.floatingInner, { paddingBottom: bottomPad }]} pointerEvents="box-none">
        <View style={styles.tabBarPill}>
          <LinearGradient
            colors={[...theme.tabBarGradient]}
            locations={[0, 0.55, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <BottomTabBar {...props} style={styles.bottomTabBarInner} />
        </View>
      </View>
    </View>
  );
}

export default function MainTabs() {
  return (
    <Tab.Navigator
      sceneContainerStyle={{ flex: 1, backgroundColor: colors.screenBackground }}
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: BRAND,
        tabBarInactiveTintColor: "#94A3B8",
        tabBarItemStyle: styles.tabItem,
        tabBarStyle: defaultTabBarStyle,
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeStack}
        options={{
          title: "Home",
          tabBarIcon: ({ focused, color }) => (
            <TabBarIcon focused={focused} color={color} Icon={Home} />
          ),
        }}
      />
      <Tab.Screen
        name="Practice"
        component={PracticeStack}
        options={{
          title: "Practice",
          tabBarIcon: ({ focused, color }) => (
            <TabBarIcon focused={focused} color={color} Icon={BookOpen} />
          ),
        }}
      />
      <Tab.Screen
        name="Camera"
        component={CameraStack}
        options={{
          title: "Scan",
          tabBarIcon: ({ focused, color }) => (
            <TabBarIcon focused={focused} color={color} Icon={Camera} />
          ),
        }}
      />
      <Tab.Screen
        name="Leaderboard"
        component={LeaderboardScreen}
        options={{
          title: "Leaderboard",
          tabBarIcon: ({ focused, color }) => (
            <TabBarIcon focused={focused} color={color} Icon={Trophy} />
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileStack}
        options={{
          title: "Profile",
          tabBarIcon: ({ focused, color }) => (
            <TabBarIcon focused={focused} color={color} Icon={User} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  floatingRoot: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "transparent",
    zIndex: 100,
  },
  floatingInner: {
    paddingHorizontal: 20,
    backgroundColor: "transparent",
  },
  tabBarPill: {
    borderRadius: 28,
    minHeight: 56,
    overflow: "hidden",
    position: "relative",
    ...Platform.select({
      ios: {
        shadowColor: theme.shadowBrand,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.22,
        shadowRadius: 16,
      },
      android: { elevation: 5 },
    }),
  },
  bottomTabBarInner: {
    backgroundColor: "transparent",
    borderTopWidth: 0,
    elevation: 0,
    shadowOpacity: 0,
    minHeight: 56,
    height: 56,
    paddingTop: 4,
    paddingBottom: 0,
  },
  tabItem: {
    paddingVertical: 0,
  },
  activeIconRing: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: BRAND,
    alignItems: "center",
    justifyContent: "center",
  },
});
