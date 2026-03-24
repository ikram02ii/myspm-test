import { palette, theme } from "./palette";

export { palette, theme };

export const colors = {
  primary: theme.brand,
  secondary: theme.brandSecondary,
  accent: theme.brand,
  success: "#34C759",
  error: "#E53935",
  warning: "#FF9500",
  gray: "#D1D5DB",
  lightGray: "#F3F4F6",
  darkGray: "#6B7280",
  darkText: palette.navy,
  lightText: "#9CA3AF",
  text: palette.navy,
  textSecondary: "#6B7280",
  textTertiary: "#9CA3AF",
  textInverse: "#FFFFFF",
  /** Main tab / scroll screen canvas */
  screenBackground: theme.screenBackground,
  background: "#FFFFFF",
  border: "#E5E7EB",
  borderLight: "#F3F4F6",
  surface: "#F9FAFB",
  surfaceAlt: "#F3F4F6",
  primaryLight: theme.brandSoft,
  streak: "#F59E0B",
  xp: palette.sage,
  gold: "#EAB308",
  silver: "#94A3B8",
  bronze: "#B45309",
  /** Brand shortcuts (same as `theme`, for `colors.*` usage) */
  brand: theme.brand,
  brandDeep: theme.brandDeep,
  brandSecondary: theme.brandSecondary,
  brandSoft: theme.brandSoft,
  brandSoftSage: theme.brandSoftSage,
};
