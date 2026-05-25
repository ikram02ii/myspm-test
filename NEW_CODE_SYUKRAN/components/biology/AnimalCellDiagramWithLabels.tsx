import React, { useMemo } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import Svg, { G, Path, Polygon, Text as SvgText } from "react-native-svg";

import { colors } from "../../constants/colors";
import { fonts } from "../../constants/fonts";
import { bilingualOrganelleLabel } from "../../constants/animalCellOrganelleLabels";
import type { OrganelleId } from "../../utils/biologyDiagramHighlights";

type Props = {
  imageUrl: string;
  highlights?: OrganelleId[];
  height?: number;
};

const HIGHLIGHT = "#E85D04";
const INK = "#1A1A1A";

/** Label positions (% of image) tuned for typical AI animal-cell cross-sections */
type LabelPin = {
  id: OrganelleId;
  label: string;
  tx: number;
  ty: number;
  lx: number;
  ly: number;
  anchor: "start" | "end" | "middle";
};

const CELL_LABELS: LabelPin[] = [
  { id: "cellMembrane", label: bilingualOrganelleLabel("cellMembrane"), tx: 50, ty: 14, lx: 50, ly: 3, anchor: "middle" },
  { id: "nucleus", label: bilingualOrganelleLabel("nucleus"), tx: 46, ty: 46, lx: 4, ly: 42, anchor: "end" },
  { id: "nucleolus", label: bilingualOrganelleLabel("nucleolus"), tx: 50, ty: 50, lx: 4, ly: 54, anchor: "end" },
  { id: "roughEr", label: bilingualOrganelleLabel("roughEr"), tx: 62, ty: 32, lx: 96, ly: 16, anchor: "end" },
  { id: "smoothEr", label: bilingualOrganelleLabel("smoothEr"), tx: 30, ty: 62, lx: 96, ly: 36, anchor: "end" },
  { id: "golgi", label: bilingualOrganelleLabel("golgi"), tx: 28, ty: 72, lx: 4, ly: 76, anchor: "end" },
  { id: "mitochondrion", label: bilingualOrganelleLabel("mitochondrion"), tx: 78, ty: 28, lx: 96, ly: 56, anchor: "end" },
  { id: "vesicle", label: bilingualOrganelleLabel("vesicle"), tx: 58, ty: 58, lx: 96, ly: 70, anchor: "end" },
];

function arrowPolygon(tx: number, ty: number, fx: number, fy: number, size = 1.8): string {
  const a = Math.atan2(ty - fy, tx - fx);
  const x1 = tx - size * Math.cos(a - 0.42);
  const y1 = ty - size * Math.sin(a - 0.42);
  const x2 = tx - size * Math.cos(a + 0.42);
  const y2 = ty - size * Math.sin(a + 0.42);
  return `${tx},${ty} ${x1},${y1} ${x2},${y2}`;
}

function LabelLeader({ pin, active }: { pin: LabelPin; active: boolean }) {
  const color = active ? HIGHLIGHT : INK;
  const sw = active ? 0.55 : 0.4;
  const elbowX = pin.anchor === "end" ? pin.lx - 8 : pin.lx + 8;

  return (
    <G>
      <Path
        d={`M ${pin.lx} ${pin.ly} L ${elbowX} ${pin.ly} L ${pin.tx} ${pin.ty}`}
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
      />
      <Polygon points={arrowPolygon(pin.tx, pin.ty, elbowX, pin.ly)} fill={color} />
      <SvgText
        x={pin.lx}
        y={pin.ly - 1.2}
        fill={color}
        fontSize={3.4}
        fontWeight={active ? "700" : "600"}
        textAnchor={pin.anchor}
      >
        {pin.label}
      </SvgText>
    </G>
  );
}

export function AnimalCellDiagramWithLabels({
  imageUrl,
  highlights = [],
  height = 300,
}: Props) {
  const active = useMemo(() => new Set(highlights), [highlights]);
  const isOn = (id: OrganelleId) => active.size === 0 || active.has(id);

  return (
    <View style={styles.wrap}>
      <Text style={styles.figureTitle}>
        Rajah: Struktur sel haiwan (keratan rentas) / Animal cell structure (cross-section)
      </Text>
      <View style={[styles.canvas, { height }]}>
        <Image source={{ uri: imageUrl }} style={styles.image} resizeMode="contain" />
        <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none" pointerEvents="none">
          {CELL_LABELS.map((pin) => (
            <LabelLeader key={pin.id} pin={pin} active={isOn(pin.id)} />
          ))}
        </Svg>
      </View>
      {highlights.length > 0 ? (
        <Text style={styles.hint}>Orange labels / Label oren = struktur berkaitan soalan ini.</Text>
      ) : (
        <Text style={styles.hint}>Label dwibahasa BM (EN) — rujuk rajah dan teks soalan di atas.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#D4D4D4",
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
    paddingTop: 8,
  },
  figureTitle: {
    fontSize: 12,
    fontFamily: fonts.semiBold,
    color: INK,
    textAlign: "center",
    marginBottom: 6,
    paddingHorizontal: 8,
  },
  canvas: {
    width: "100%",
    position: "relative",
    backgroundColor: "#FAFAFA",
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  hint: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    textAlign: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
});
