import React from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { MatrixDisplay } from "./MatrixDisplay";
import { splitTextWithMatrices } from "../../utils/parseMatrixNotation";

type Props = {
  children: string;
  textStyle?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  matrixCompact?: boolean;
};

export function MathFormattedText({
  children,
  textStyle,
  containerStyle,
  matrixCompact = false,
}: Props) {
  const segments = splitTextWithMatrices(children);

  if (segments.length === 1 && segments[0].kind === "text") {
    return <Text style={textStyle}>{children}</Text>;
  }

  if (segments.length === 1 && segments[0].kind === "matrix") {
    return (
      <View style={[styles.block, containerStyle]}>
        <MatrixDisplay matrix={segments[0].value} compact={matrixCompact} />
      </View>
    );
  }

  return (
    <View style={[styles.block, containerStyle]}>
      {segments.map((segment, index) => {
        if (segment.kind === "matrix") {
          return (
            <View key={`m-${index}`} style={styles.matrixWrap}>
              <MatrixDisplay matrix={segment.value} compact={matrixCompact} />
            </View>
          );
        }
        if (!segment.value) return null;
        return (
          <Text key={`t-${index}`} style={textStyle}>
            {segment.value}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: 6,
  },
  matrixWrap: {
    marginVertical: 4,
    alignItems: "flex-start",
  },
});
