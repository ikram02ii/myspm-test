/**
 * Core swatches — change these hex values to retheme the app.
 * UI tokens in `theme` are derived from here.
 */
export const palette = {
  tan: "#C2B280",
  coral: "#E35336",
  sage: "#98A869",
  navy: "#272757",
} as const;

/**
 * Semantic colors built from `palette`. Prefer importing `theme` in screens
 * for brand gradients and tints; use `colors` from `./colors` for neutrals.
 */
export const theme = {
  brand: palette.coral,
  brandDeep: palette.navy,
  brandSecondary: palette.sage,
  /** Light surfaces tinted from tan */
  brandSoft: "#EDE8DC",
  /** Light surfaces tinted from sage */
  brandSoftSage: "#E8EDE0",
  surfaceHighlight: "#F0EBE3",
  screenBackground: "#F7F5F2",
  authBackground: "#F8F9FB",
  /** Login / sign-up screen wash */
  authGradient: ["#E3E9DA", "#F8F9FB", "#EDE8DC"] as const,
  authGlowTop: "rgba(227, 83, 54, 0.38)",
  authGlowBottom: "rgba(152, 168, 105, 0.26)",
  /** Floating tab bar pill */
  tabBarGradient: ["#E5EAD8", "#FFFFFF", "#F9F6F0"] as const,
  /** Primary buttons: dark → accent */
  gradientCta: [palette.navy, palette.coral] as const,
  /** Hero / logo blobs: accent → dark */
  gradientHero: [palette.coral, palette.navy] as const,
  shadowBrand: palette.coral,
  pillBorderBrand: "rgba(227, 83, 54, 0.14)",
} as const;
