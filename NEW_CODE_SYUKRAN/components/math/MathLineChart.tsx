import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";

import { colors } from "../../constants/colors";
import { fonts } from "../../constants/fonts";
import { theme } from "../../constants/palette";

export type MathChartPoint = {
  x: number;
  y: number;
  label?: string;
};

type MathLineChartProps = {
  title?: string;
  subtitle?: string;
  points?: MathChartPoint[];
  xAxisLabel?: string;
  yAxisLabel?: string;
  equationLabel?: string;
  height?: number;
  lineColor?: string;
};

export const MATH_LINE_CHART_SAMPLE_POINTS: MathChartPoint[] = [
  { x: -2, y: -3 },
  { x: -1, y: -1 },
  { x: 0, y: 1, label: "y-intercept" },
  { x: 1, y: 3 },
  { x: 2, y: 5 },
  { x: 3, y: 7 },
];

const CHART_PADDING = {
  top: 24,
  right: 22,
  bottom: 38,
  left: 42,
};

const VIEWBOX_WIDTH = 340;

function getRange(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);

  if (min === max) {
    return { min: min - 1, max: max + 1 };
  }

  const padding = (max - min) * 0.12;
  return { min: min - padding, max: max + padding };
}

function formatTick(value: number) {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

export function MathLineChart({
  title = "Linear Function",
  subtitle = "Sample graph for Math: y = 2x + 1",
  points = MATH_LINE_CHART_SAMPLE_POINTS,
  xAxisLabel = "x",
  yAxisLabel = "y",
  equationLabel = "y = 2x + 1",
  height = 260,
  lineColor = theme.brand,
}: MathLineChartProps) {
  const safePoints = points.length >= 2 ? points : MATH_LINE_CHART_SAMPLE_POINTS;
  const xRange = getRange(safePoints.map((point) => point.x));
  const yRange = getRange(safePoints.map((point) => point.y));
  const plotWidth = VIEWBOX_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
  const plotHeight = height - CHART_PADDING.top - CHART_PADDING.bottom;

  const xScale = (x: number) =>
    CHART_PADDING.left + ((x - xRange.min) / (xRange.max - xRange.min)) * plotWidth;

  const yScale = (y: number) =>
    CHART_PADDING.top + plotHeight - ((y - yRange.min) / (yRange.max - yRange.min)) * plotHeight;

  const path = safePoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${xScale(point.x)} ${yScale(point.y)}`)
    .join(" ");

  const xTicks = [xRange.min, (xRange.min + xRange.max) / 2, xRange.max];
  const yTicks = [yRange.min, (yRange.min + yRange.max) / 2, yRange.max];
  const axisY = yRange.min <= 0 && yRange.max >= 0 ? yScale(0) : yScale(yRange.min);
  const axisX = xRange.min <= 0 && xRange.max >= 0 ? xScale(0) : xScale(xRange.min);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <View style={styles.equationPill}>
          <Text style={styles.equationText}>{equationLabel}</Text>
        </View>
      </View>

      <Svg width="100%" height={height} viewBox={`0 0 ${VIEWBOX_WIDTH} ${height}`}>
        {yTicks.map((tick) => {
          const y = yScale(tick);
          return (
            <React.Fragment key={`y-${tick}`}>
              <Line
                x1={CHART_PADDING.left}
                x2={VIEWBOX_WIDTH - CHART_PADDING.right}
                y1={y}
                y2={y}
                stroke={colors.border}
                strokeDasharray="4 6"
              />
              <SvgText
                x={CHART_PADDING.left - 10}
                y={y + 4}
                fill={colors.textSecondary}
                fontFamily={fonts.medium}
                fontSize="10"
                textAnchor="end"
              >
                {formatTick(tick)}
              </SvgText>
            </React.Fragment>
          );
        })}

        {xTicks.map((tick) => {
          const x = xScale(tick);
          return (
            <React.Fragment key={`x-${tick}`}>
              <Line
                x1={x}
                x2={x}
                y1={CHART_PADDING.top}
                y2={height - CHART_PADDING.bottom}
                stroke={colors.borderLight}
                strokeDasharray="3 8"
              />
              <SvgText
                x={x}
                y={height - CHART_PADDING.bottom + 20}
                fill={colors.textSecondary}
                fontFamily={fonts.medium}
                fontSize="10"
                textAnchor="middle"
              >
                {formatTick(tick)}
              </SvgText>
            </React.Fragment>
          );
        })}

        <Line
          x1={CHART_PADDING.left}
          x2={VIEWBOX_WIDTH - CHART_PADDING.right}
          y1={axisY}
          y2={axisY}
          stroke={colors.darkText}
          strokeWidth="1.4"
        />
        <Line
          x1={axisX}
          x2={axisX}
          y1={CHART_PADDING.top}
          y2={height - CHART_PADDING.bottom}
          stroke={colors.darkText}
          strokeWidth="1.4"
        />

        <Path d={path} fill="none" stroke={lineColor} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />

        {safePoints.map((point) => (
          <React.Fragment key={`${point.x}-${point.y}`}>
            <Circle cx={xScale(point.x)} cy={yScale(point.y)} r="4.5" fill={lineColor} />
            {point.label ? (
              <SvgText
                x={xScale(point.x) + 8}
                y={yScale(point.y) - 8}
                fill={colors.text}
                fontFamily={fonts.semiBold}
                fontSize="10"
              >
                {point.label}
              </SvgText>
            ) : null}
          </React.Fragment>
        ))}

        <SvgText
          x={VIEWBOX_WIDTH - CHART_PADDING.right}
          y={axisY - 8}
          fill={colors.text}
          fontFamily={fonts.bold}
          fontSize="12"
          textAnchor="end"
        >
          {xAxisLabel}
        </SvgText>
        <SvgText x={axisX + 8} y={CHART_PADDING.top + 12} fill={colors.text} fontFamily={fonts.bold} fontSize="12">
          {yAxisLabel}
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
    shadowColor: theme.shadowBrand,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
  },
  equationPill: {
    backgroundColor: theme.brandSoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  equationText: {
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 12,
  },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    marginBottom: 8,
  },
  subtitle: {
    color: colors.textSecondary,
    fontFamily: fonts.medium,
    fontSize: 13,
    marginTop: 4,
  },
  title: {
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 18,
  },
});
