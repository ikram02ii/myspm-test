import React, { useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { colors } from "../../constants/colors";
import { fonts } from "../../constants/fonts";
import {
  looksLikeCalculationWorking,
  parseCalculationModelAnswer,
  parseWorkingDisplayRows,
  prepareCalculationModelAnswerDisplay,
  type WorkingDisplayRow,
} from "../../utils/parseCalculationSteps";
import { MathExpressionText } from "./MathExpressionText";
import { MathFormattedText } from "./MathFormattedText";

type Props = {
  text: string;
};

const MONO = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
});

function FormulaBox({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;

  return (
    <View style={styles.sectionWrap}>
      <Text style={styles.sectionLabel}>Formula</Text>
      <View style={styles.formulaBox}>
        {lines.map((line, index) => (
          <MathExpressionText key={`f-${index}`} style={styles.formulaText}>
            {line}
          </MathExpressionText>
        ))}
      </View>
    </View>
  );
}

function EquationRow({ row }: { row: WorkingDisplayRow & { type: "equation" } }) {
  if (row.isContinuation) {
    return (
      <View style={styles.equationRow}>
        <View style={styles.lhsSpacer} />
        <Text style={styles.eqSign}>=</Text>
        <View style={styles.rhsCol}>
          <MathExpressionText style={styles.equationText}>{row.rhs}</MathExpressionText>
        </View>
      </View>
    );
  }

  if (!row.rhs) {
    return (
      <MathExpressionText style={styles.equationText}>{row.lhs}</MathExpressionText>
    );
  }

  return (
    <View style={styles.equationRow}>
      <View style={styles.lhsCol}>
        <MathExpressionText style={[styles.equationText, styles.lhsText]}>
          {row.lhs}
        </MathExpressionText>
      </View>
      <Text style={styles.eqSign}>=</Text>
      <View style={styles.rhsCol}>
        <MathExpressionText style={styles.equationText}>{row.rhs}</MathExpressionText>
      </View>
    </View>
  );
}

function WorkingSection({ lines }: { lines: string[] }) {
  const rows = useMemo(() => parseWorkingDisplayRows(lines), [lines]);

  if (rows.length === 0) return null;

  return (
    <View style={styles.sectionWrap}>
      <Text style={styles.sectionLabel}>Working</Text>
      <View style={styles.workingContent}>
        {rows.map((row, index) => {
          if (row.type === "given") {
            return (
              <View key={`given-${index}`} style={styles.givenRow}>
                <Text style={styles.givenLabel} numberOfLines={3}>
                  {row.label}
                </Text>
                <View style={styles.givenValueWrap}>
                  <Text style={styles.eqSign}>=</Text>
                  <MathExpressionText style={styles.givenValue}>{row.value}</MathExpressionText>
                </View>
              </View>
            );
          }
          return <EquationRow key={`eq-${index}`} row={row} />;
        })}
      </View>
    </View>
  );
}

function FinalAnswerBox({ lines }: { lines: string[] }) {
  const content = lines.join(" ").trim();
  if (!content) return null;

  const unitMatch = content.match(/^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+(.+)$/i);
  const value = unitMatch?.[1]?.trim() ?? content;
  const unit = unitMatch?.[2]?.trim();

  return (
    <View style={styles.sectionWrap}>
      <Text style={styles.sectionLabel}>Final answer</Text>
      <View style={styles.finalBox}>
        <MathExpressionText bold style={styles.finalValue}>
          {value}
        </MathExpressionText>
        {unit ? (
          <View style={styles.unitChip}>
            <MathExpressionText style={styles.unitText}>{unit}</MathExpressionText>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function TheoryPointsSection({ points }: { points: string[] }) {
  if (points.length === 0) return null;

  return (
    <View style={styles.theorySection}>
      <Text style={styles.sectionLabel}>Explanation</Text>
      {points.map((point, index) => (
        <Text key={index} style={styles.theoryPointText}>
          {point}
        </Text>
      ))}
    </View>
  );
}

export function CalculationStepsView({ text }: Props) {
  const prepared = useMemo(() => prepareCalculationModelAnswerDisplay(text), [text]);
  const layout = useMemo(
    () => parseCalculationModelAnswer(prepared.structuredText),
    [prepared.structuredText],
  );
  const isCalc = looksLikeCalculationWorking(text) || looksLikeCalculationWorking(prepared.structuredText);

  const hasContent =
    layout.formulaLines.length > 0 ||
    layout.workingLines.length > 0 ||
    layout.finalLines.length > 0;

  if (!isCalc || !hasContent) {
    return (
      <MathFormattedText textStyle={styles.fallbackText}>{text}</MathFormattedText>
    );
  }

  return (
    <View style={styles.container}>
      <FormulaBox lines={layout.formulaLines} />
      <WorkingSection lines={layout.workingLines} />
      <FinalAnswerBox lines={layout.finalLines} />
      <TheoryPointsSection points={prepared.theoryPoints} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 14,
    marginTop: 4,
  },
  sectionWrap: {
    gap: 6,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: fonts.bold,
    color: "#7F8C8D",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  formulaBox: {
    backgroundColor: "#F5F2E9",
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(180, 136, 60, 0.12)",
  },
  formulaText: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.text,
    fontFamily: MONO,
    textAlign: "center",
  },
  workingContent: {
    gap: 12,
    paddingTop: 2,
  },
  givenRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  givenLabel: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
    color: colors.text,
    fontFamily: fonts.regular,
  },
  givenValueWrap: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    maxWidth: "48%",
    gap: 4,
  },
  givenValue: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.text,
    fontFamily: MONO,
    flexShrink: 1,
  },
  equationRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  lhsSpacer: {
    flex: 1,
    maxWidth: "38%",
  },
  lhsCol: {
    flex: 1,
    maxWidth: "38%",
    alignItems: "flex-end",
    paddingTop: 1,
  },
  lhsText: {
    textAlign: "right",
  },
  eqSign: {
    fontFamily: MONO,
    fontSize: 14,
    lineHeight: 21,
    color: colors.text,
    width: 14,
    flexShrink: 0,
    paddingTop: 1,
  },
  rhsCol: {
    flex: 1,
    minWidth: 0,
  },
  equationText: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.text,
    fontFamily: MONO,
    flexWrap: "wrap",
  },
  fallbackText: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.text,
    fontFamily: fonts.regular,
  },
  finalBox: {
    alignSelf: "flex-start",
    backgroundColor: "#E8F5E9",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(46, 125, 50, 0.18)",
  },
  finalValue: {
    fontSize: 18,
    lineHeight: 26,
    color: "#2E7D32",
    fontFamily: MONO,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  unitChip: {
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(46, 125, 50, 0.15)",
  },
  unitText: {
    fontSize: 13,
    color: "#2E7D32",
    fontFamily: fonts.semiBold,
  },
  theorySection: {
    gap: 6,
    marginTop: 2,
  },
  theoryPointText: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.text,
    fontFamily: fonts.regular,
  },
});
