import React from "react";
import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";

import { fonts } from "../../constants/fonts";

/** Lightweight chem/math typography — subscripts, superscripts, symbols (no WebView). */
const SUBSCRIPT_MAP: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
  "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
};
const SUPERSCRIPT_MAP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻",
};

function formatChemFormula(segment: string): string {
  return segment.replace(/([A-Z][a-z]?)(\d+)/g, (_, sym: string, digits: string) => {
    const sub = digits.split("").map((d) => SUBSCRIPT_MAP[d] ?? d).join("");
    return sym + sub;
  });
}

function formatSuperscripts(segment: string): string {
  return segment.replace(/\^([0-9+\-]+)/g, (_, exp: string) => {
    return exp.split("").map((c) => SUPERSCRIPT_MAP[c] ?? c).join("");
  }).replace(/(\d+)\s*(mol⁻¹|mol-1|g\s*mol⁻¹|dm⁻³|cm⁻³|s⁻¹)/gi, (_, num, unit) => {
    const u = unit
      .replace(/-1/g, "⁻¹")
      .replace(/-2/g, "⁻²")
      .replace(/-3/g, "⁻³");
    return num + " " + u;
  });
}

export function formatMathExpression(text: string): string {
  let out = text.replace(/×/g, "×").replace(/\*/g, "×");
  out = out.replace(/\bg\s*\/\s*mol\b/gi, "g mol⁻¹");
  out = formatChemFormula(out);
  out = formatSuperscripts(out);
  out = out.replace(/->|→/g, "→");
  return out;
}

type Props = {
  children: string;
  style?: StyleProp<TextStyle>;
  bold?: boolean;
};

export function MathExpressionText({ children, style, bold }: Props) {
  const formatted = formatMathExpression(children);
  return (
    <Text
      style={[styles.base, bold && styles.bold, style]}
      selectable
    >
      {formatted}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    fontFamily: fonts.medium,
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.2,
  },
  bold: {
    fontFamily: fonts.bold,
  },
});
