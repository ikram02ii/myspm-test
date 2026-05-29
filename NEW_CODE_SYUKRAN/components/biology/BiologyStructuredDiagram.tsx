import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Ellipse, G, Path, Polygon, Rect, Text as SvgText } from "react-native-svg";

import { colors } from "../../constants/colors";
import { fonts } from "../../constants/fonts";
import type {
  BiologyCellFocusLabel,
  StructuredQuestionDiagram,
} from "../../services/mobilePracticeSets";

type Props = {
  spec: StructuredQuestionDiagram;
  height?: number;
};

const INK = "#1A1A1A";
const INK_SOFT = "#5A5A5A";
const HIGHLIGHT = "#E85D04";
const CELL_FILL = "#FFFFFF";
const NUC_FILL = "#FAFAFA";

type LabelSpec = {
  id: BiologyCellFocusLabel;
  label: string;
  tx: number;
  ty: number;
  lx: number;
  ly: number;
  anchor: "start" | "end" | "middle";
};

const BIOLOGY_LABELS: Record<BiologyCellFocusLabel, string> = {
  cellWall: "Dinding sel (Cell wall)",
  cellMembrane: "Membran sel (Cell membrane)",
  vacuole: "Vakuol (Vacuole)",
  chloroplast: "Kloroplas (Chloroplast)",
  nucleus: "Nukleus (Nucleus)",
  cytoplasm: "Sitoplasma (Cytoplasm)",
};

function figureTitle(spec: StructuredQuestionDiagram): string {
  if (spec.layout === "comparison") return "Plant vs animal cell";
  if (spec.layout === "plant") {
    if (spec.state === "hypertonic") {
      return "Rajah: Sel tumbuhan dalam larutan hipertonik / Plant cell in hypertonic solution";
    }
    if (spec.state === "hypotonic") {
      return "Rajah: Sel tumbuhan dalam larutan hipotonik / Plant cell in hypotonic solution";
    }
    return "Rajah: Struktur sel tumbuhan / Plant cell structure";
  }
  return "Rajah: Struktur sel haiwan / Animal cell structure";
}

function comparisonTitle(): string {
  return "Rajah: Perbandingan sel tumbuhan dan sel haiwan / Plant and animal cell comparison";
}

function useFocusSet(focusLabels: BiologyCellFocusLabel[] | undefined) {
  return useMemo(() => new Set(focusLabels ?? []), [focusLabels]);
}

function tone(focusSet: Set<BiologyCellFocusLabel>, label: BiologyCellFocusLabel) {
  return focusSet.has(label) ? HIGHLIGHT : INK;
}

function arrowHead(tx: number, ty: number, fromX: number, fromY: number, size = 6.5): string {
  const a = Math.atan2(ty - fromY, tx - fromX);
  const x1 = tx - size * Math.cos(a - 0.42);
  const y1 = ty - size * Math.sin(a - 0.42);
  const x2 = tx - size * Math.cos(a + 0.42);
  const y2 = ty - size * Math.sin(a + 0.42);
  return `${tx},${ty} ${x1},${y1} ${x2},${y2}`;
}

function Leader({ label, focusSet }: { label: LabelSpec; focusSet: Set<BiologyCellFocusLabel> }) {
  const color = tone(focusSet, label.id);
  const elbowX = label.anchor === "end" ? label.lx - 28 : label.anchor === "start" ? label.lx + 28 : label.lx;

  return (
    <G>
      <Path
        d={`M ${label.lx} ${label.ly} L ${elbowX} ${label.ly} L ${label.tx} ${label.ty}`}
        fill="none"
        stroke={color}
        strokeWidth={focusSet.has(label.id) ? 2 : 1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Polygon points={arrowHead(label.tx, label.ty, elbowX, label.ly)} fill={color} />
      <SvgText
        x={label.lx}
        y={label.ly - 4}
        fill={color}
        fontSize={10.5}
        fontWeight={focusSet.has(label.id) ? "700" : "500"}
        textAnchor={label.anchor}
      >
        {label.label}
      </SvgText>
    </G>
  );
}

function plantLabels(): LabelSpec[] {
  return [
    { id: "cellWall", label: BIOLOGY_LABELS.cellWall, tx: 205, ty: 56, lx: 250, ly: 18, anchor: "middle" },
    { id: "cellMembrane", label: BIOLOGY_LABELS.cellMembrane, tx: 296, ty: 92, lx: 456, ly: 76, anchor: "end" },
    { id: "vacuole", label: BIOLOGY_LABELS.vacuole, tx: 186, ty: 166, lx: 50, ly: 156, anchor: "start" },
    { id: "chloroplast", label: BIOLOGY_LABELS.chloroplast, tx: 130, ty: 100, lx: 50, ly: 88, anchor: "start" },
    { id: "nucleus", label: BIOLOGY_LABELS.nucleus, tx: 282, ty: 108, lx: 456, ly: 116, anchor: "end" },
    { id: "cytoplasm", label: BIOLOGY_LABELS.cytoplasm, tx: 122, ty: 244, lx: 50, ly: 292, anchor: "start" },
  ];
}

function animalLabels(): LabelSpec[] {
  return [
    { id: "cellMembrane", label: BIOLOGY_LABELS.cellMembrane, tx: 250, ty: 56, lx: 250, ly: 18, anchor: "middle" },
    { id: "nucleus", label: BIOLOGY_LABELS.nucleus, tx: 250, ty: 160, lx: 52, ly: 160, anchor: "start" },
    { id: "cytoplasm", label: BIOLOGY_LABELS.cytoplasm, tx: 182, ty: 236, lx: 444, ly: 276, anchor: "end" },
  ];
}

function comparisonLabels(): LabelSpec[] {
  return [
    { id: "cellWall", label: BIOLOGY_LABELS.cellWall, tx: 98, ty: 68, lx: 46, ly: 34, anchor: "start" },
    { id: "vacuole", label: BIOLOGY_LABELS.vacuole, tx: 126, ty: 172, lx: 46, ly: 154, anchor: "start" },
    { id: "chloroplast", label: BIOLOGY_LABELS.chloroplast, tx: 96, ty: 106, lx: 46, ly: 108, anchor: "start" },
    { id: "cellMembrane", label: BIOLOGY_LABELS.cellMembrane, tx: 368, ty: 82, lx: 454, ly: 58, anchor: "end" },
    { id: "nucleus", label: BIOLOGY_LABELS.nucleus, tx: 360, ty: 170, lx: 454, ly: 196, anchor: "end" },
    { id: "cytoplasm", label: BIOLOGY_LABELS.cytoplasm, tx: 314, ty: 236, lx: 454, ly: 280, anchor: "end" },
  ];
}

function PlantCell({
  x,
  y,
  width,
  height,
  state = "normal",
  focusSet,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  state?: "normal" | "hypotonic" | "hypertonic";
  focusSet: Set<BiologyCellFocusLabel>;
}) {
  const wallStroke = tone(focusSet, "cellWall");
  const membraneStroke = tone(focusSet, "cellMembrane");
  const vacuoleStroke = tone(focusSet, "vacuole");
  const nucleusStroke = tone(focusSet, "nucleus");
  const chloroplastStroke = tone(focusSet, "chloroplast");
  const cytoplasmStroke = tone(focusSet, "cytoplasm");

  const membraneInset = state === "hypertonic" ? 26 : state === "hypotonic" ? 10 : 16;
  const vacuoleInsetX = state === "hypertonic" ? 52 : state === "hypotonic" ? 24 : 34;
  const vacuoleInsetY = state === "hypertonic" ? 54 : state === "hypotonic" ? 28 : 38;

  const membraneX = x + membraneInset;
  const membraneY = y + membraneInset;
  const membraneW = width - membraneInset * 2;
  const membraneH = height - membraneInset * 2;

  return (
    <G>
      <Rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={18}
        fill={CELL_FILL}
        stroke={wallStroke}
        strokeWidth={focusSet.has("cellWall") ? 4 : 2.2}
      />
      <Rect
        x={membraneX}
        y={membraneY}
        width={membraneW}
        height={membraneH}
        rx={16}
        fill="none"
        stroke={membraneStroke}
        strokeWidth={focusSet.has("cellMembrane") ? 3 : 1.7}
      />
      <Rect
        x={membraneX + vacuoleInsetX}
        y={membraneY + vacuoleInsetY}
        width={Math.max(48, membraneW - vacuoleInsetX * 2)}
        height={Math.max(72, membraneH - vacuoleInsetY * 2)}
        rx={28}
        fill={CELL_FILL}
        stroke={vacuoleStroke}
        strokeWidth={focusSet.has("vacuole") ? 3 : 1.7}
      />
      <Circle
        cx={membraneX + membraneW - 40}
        cy={membraneY + 44}
        r={16}
        fill={NUC_FILL}
        stroke={nucleusStroke}
        strokeWidth={focusSet.has("nucleus") ? 3 : 1.7}
      />
      <Circle cx={membraneX + membraneW - 40} cy={membraneY + 44} r={6} fill="none" stroke={nucleusStroke} strokeWidth={1.4} />
      {[
        [membraneX + 28, membraneY + 42],
        [membraneX + membraneW - 74, membraneY + 102],
        [membraneX + 34, membraneY + membraneH - 48],
        [membraneX + membraneW - 66, membraneY + membraneH - 58],
      ].map(([cx, cy], index) => (
        <Ellipse
          key={index}
          cx={cx}
          cy={cy}
          rx={16}
          ry={9}
          fill="none"
          stroke={chloroplastStroke}
          strokeWidth={focusSet.has("chloroplast") ? 2.8 : 1.5}
          transform={`rotate(${index % 2 === 0 ? -18 : 22}, ${cx}, ${cy})`}
        />
      ))}
      {[
        [membraneX + 22, membraneY + 20],
        [membraneX + membraneW - 20, membraneY + 24],
        [membraneX + 20, membraneY + membraneH - 20],
        [membraneX + membraneW - 24, membraneY + membraneH - 22],
      ].map(([cx, cy], index) => (
        <Circle
          key={`cyto-${index}`}
          cx={cx}
          cy={cy}
          r={2.2}
          fill={cytoplasmStroke}
          opacity={0.8}
        />
      ))}
      {state === "hypertonic" ? (
        <Path
          d={`M ${membraneX + 20} ${membraneY + 38} C ${membraneX + 56} ${membraneY + 18}, ${membraneX + membraneW - 52} ${membraneY + 24}, ${membraneX + membraneW - 30} ${membraneY + 50}
              C ${membraneX + membraneW - 18} ${membraneY + 92}, ${membraneX + membraneW - 36} ${membraneY + membraneH - 40}, ${membraneX + membraneW - 68} ${membraneY + membraneH - 26}
              C ${membraneX + 82} ${membraneY + membraneH - 8}, ${membraneX + 20} ${membraneY + membraneH - 44}, ${membraneX + 26} ${membraneY + 88}
              C ${membraneX + 28} ${membraneY + 70}, ${membraneX + 22} ${membraneY + 54}, ${membraneX + 20} ${membraneY + 38}`}
          fill="none"
          stroke={membraneStroke}
          strokeWidth={1.8}
          opacity={0.75}
        />
      ) : null}
    </G>
  );
}

function AnimalCell({
  cx,
  cy,
  rx,
  ry,
  focusSet,
}: {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  focusSet: Set<BiologyCellFocusLabel>;
}) {
  const membraneStroke = tone(focusSet, "cellMembrane");
  const nucleusStroke = tone(focusSet, "nucleus");
  const cytoplasmStroke = tone(focusSet, "cytoplasm");

  return (
    <G>
      <Ellipse
        cx={cx}
        cy={cy}
        rx={rx}
        ry={ry}
        fill={CELL_FILL}
        stroke={membraneStroke}
        strokeWidth={focusSet.has("cellMembrane") ? 3 : 1.8}
      />
      <Circle
        cx={cx}
        cy={cy}
        r={20}
        fill={NUC_FILL}
        stroke={nucleusStroke}
        strokeWidth={focusSet.has("nucleus") ? 3 : 1.8}
      />
      <Circle cx={cx} cy={cy} r={7} fill="none" stroke={nucleusStroke} strokeWidth={1.3} />
      {[[-34, -12], [32, -18], [-28, 34], [36, 24]].map(([dx, dy], index) => (
        <Ellipse
          key={index}
          cx={cx + dx}
          cy={cy + dy}
          rx={13}
          ry={7}
          fill="none"
          stroke={INK_SOFT}
          strokeWidth={1.7}
          transform={`rotate(${index % 2 === 0 ? -20 : 28}, ${cx + dx}, ${cy + dy})`}
        />
      ))}
      {[
        [cx - 10, cy - 36],
        [cx + 48, cy - 6],
        [cx - 52, cy + 8],
        [cx + 12, cy + 42],
      ].map(([x, y], index) => (
        <Circle key={index} cx={x} cy={y} r={3.6} fill={cytoplasmStroke} opacity={0.5} />
      ))}
      <Path
        d={`M ${cx - 38} ${cy - 2} C ${cx - 22} ${cy - 24}, ${cx + 20} ${cy - 28}, ${cx + 34} ${cy - 2}
            M ${cx - 34} ${cy + 6} C ${cx - 18} ${cy - 12}, ${cx + 18} ${cy - 10}, ${cx + 30} ${cy + 8}`}
        fill="none"
        stroke={INK}
        strokeWidth={1.5}
      />
    </G>
  );
}

export function BiologyStructuredDiagram({ spec, height = 300 }: Props) {
  const focusSet = useFocusSet(spec.focusLabels);
  const title = spec.layout === "comparison" ? comparisonTitle() : figureTitle(spec);
  const labels =
    spec.layout === "comparison" ? comparisonLabels() : spec.layout === "plant" ? plantLabels() : animalLabels();

  return (
    <View style={styles.wrap}>
      <Text style={styles.figureTitle}>{title}</Text>
      <Svg width="100%" height={height} viewBox="0 0 500 320" preserveAspectRatio="xMidYMid meet">
        <Rect x={0} y={0} width={500} height={320} rx={8} fill="#FFFFFF" />
        {spec.layout === "comparison" ? (
          <>
            <SvgText x={126} y={44} fontSize="11" fontWeight="600" fill={INK} textAnchor="middle">
              Sel tumbuhan
            </SvgText>
            <SvgText x={126} y={58} fontSize="10" fill={INK_SOFT} textAnchor="middle">
              Plant cell
            </SvgText>
            <SvgText x={364} y={44} fontSize="11" fontWeight="600" fill={INK} textAnchor="middle">
              Sel haiwan
            </SvgText>
            <SvgText x={364} y={58} fontSize="10" fill={INK_SOFT} textAnchor="middle">
              Animal cell
            </SvgText>
            <PlantCell x={48} y={70} width={156} height={210} state="normal" focusSet={focusSet} />
            <AnimalCell cx={360} cy={158} rx={88} ry={92} focusSet={focusSet} />
          </>
        ) : spec.layout === "plant" ? (
          <PlantCell x={116} y={54} width={188} height={230} state={spec.state} focusSet={focusSet} />
        ) : (
          <AnimalCell cx={250} cy={170} rx={112} ry={104} focusSet={focusSet} />
        )}
        {labels.map((label) => (
          <Leader key={`${spec.layout}-${label.id}`} label={label} focusSet={focusSet} />
        ))}
      </Svg>
      {spec.focusLabels && spec.focusLabels.length > 0 ? (
        <Text style={styles.hint}>
          Label oren = struktur yang berkaitan dengan soalan ini.
        </Text>
      ) : (
        <Text style={styles.hint}>Rujuk rajah untuk struktur utama yang membantu menjawab soalan.</Text>
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
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  hint: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    textAlign: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    lineHeight: 15,
  },
});
