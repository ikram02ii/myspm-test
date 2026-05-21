import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { fonts } from "../../constants/fonts";

type Props = {
  matrix: number[][];
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

function formatCell(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const s = n.toFixed(2).replace(/\.?0+$/, "");
  return s;
}

export function MatrixDisplay({ matrix, compact = false, style }: Props) {
  if (matrix.length === 0 || matrix[0].length === 0) return null;

  const cellSize = compact ? 26 : 32;
  const fontSize = compact ? 15 : 17;
  const bracketSize = compact ? 28 : 34;

  return (
    <View style={[styles.root, style]} accessibilityLabel="Matrix">
      <Text style={[styles.bracket, { fontSize: bracketSize, lineHeight: bracketSize * matrix.length * 0.72 }]}>
        [
      </Text>
      <View style={styles.grid}>
        {matrix.map((row, rowIndex) => (
          <View key={`r-${rowIndex}`} style={styles.row}>
            {row.map((cell, colIndex) => (
              <View
                key={`c-${rowIndex}-${colIndex}`}
                style={[styles.cell, { minWidth: cellSize, minHeight: cellSize }]}
              >
                <Text style={[styles.cellText, { fontSize }]}>{formatCell(cell)}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
      <Text style={[styles.bracket, { fontSize: bracketSize, lineHeight: bracketSize * matrix.length * 0.72 }]}>
        ]
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  bracket: {
    fontFamily: fonts.medium,
    color: "#0F172A",
    marginHorizontal: 2,
  },
  grid: {
    alignItems: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  cell: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  cellText: {
    fontFamily: fonts.semiBold,
    color: "#0F172A",
    textAlign: "center",
  },
});
