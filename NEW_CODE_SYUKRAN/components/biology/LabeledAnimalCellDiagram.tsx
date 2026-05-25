import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Ellipse, G, Path, Polygon, Text as SvgText } from "react-native-svg";

import { colors } from "../../constants/colors";
import { fonts } from "../../constants/fonts";
import { bilingualOrganelleLabel } from "../../constants/animalCellOrganelleLabels";
import type { OrganelleId } from "../../utils/biologyDiagramHighlights";

type Props = {
  highlights?: OrganelleId[];
  height?: number;
};

/** SPM workbook palette — black ink on white, orange only for question focus */
const HIGHLIGHT = "#E85D04";
const INK = "#1A1A1A";
const INK_LIGHT = "#525252";
const FILL_CYTO = "#FFFFFF";
const FILL_NUC = "#FFFFFF";
const CHROMATIN = "#E5E5E5";

const VB_W = 500;
const VB_H = 390;

type CalloutSpec = {
  id: OrganelleId;
  label: string;
  tx: number;
  ty: number;
  lx: number;
  ly: number;
  anchor: "start" | "end" | "middle";
};

function fixArrowHead(tx: number, ty: number, fromX: number, fromY: number, size = 7): string {
  const a = Math.atan2(ty - fromY, tx - fromX);
  const x1 = tx - size * Math.cos(a - 0.42);
  const y1 = ty - size * Math.sin(a - 0.42);
  const x2 = tx - size * Math.cos(a + 0.42);
  const y2 = ty - size * Math.sin(a + 0.42);
  return `${tx},${ty} ${x1},${y1} ${x2},${y2}`;
}

function TextbookLeader({ callout, active }: { callout: CalloutSpec; active: boolean }) {
  const lineColor = active ? HIGHLIGHT : INK;
  const textColor = active ? HIGHLIGHT : INK;
  const sw = active ? 2 : 1.4;
  const elbowX = callout.anchor === "end" ? callout.lx - 32 : callout.lx + 32;

  return (
    <G>
      <Path
        d={`M ${callout.lx} ${callout.ly} L ${elbowX} ${callout.ly} L ${callout.tx} ${callout.ty}`}
        fill="none"
        stroke={lineColor}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Polygon points={fixArrowHead(callout.tx, callout.ty, elbowX, callout.ly)} fill={lineColor} />
      <SvgText
        x={callout.lx}
        y={callout.ly - 4}
        fill={textColor}
        fontSize={10.5}
        fontWeight={active ? "700" : "500"}
        textAnchor={callout.anchor}
      >
        {callout.label}
      </SvgText>
    </G>
  );
}

/** Classic SPM mitochondrion — oval with zigzag cristae */
function TextbookMitochondrion({
  cx,
  cy,
  rot,
  active,
}: {
  cx: number;
  cy: number;
  rot: number;
  active: boolean;
}) {
  const s = active ? HIGHLIGHT : INK;
  const w = active ? 2 : 1.6;
  return (
    <G transform={`rotate(${rot}, ${cx}, ${cy})`}>
      <Ellipse cx={cx} cy={cy} rx={30} ry={15} fill={FILL_CYTO} stroke={s} strokeWidth={w} />
      {[ -10, -3, 4, 11 ].map((dx) => (
        <Path
          key={dx}
          d={`M ${cx + dx - 8} ${cy - 4} L ${cx + dx} ${cy} L ${cx + dx + 8} ${cy + 4}`}
          fill="none"
          stroke={s}
          strokeWidth={1.1}
        />
      ))}
    </G>
  );
}

/** SPM-style nested Golgi cisternae (concave stack facing nucleus) */
function TextbookGolgi({ active }: { active: boolean }) {
  const s = active ? HIGHLIGHT : INK;
  const w = active ? 2 : 1.6;
  const baseX = 318;
  const baseY = 200;
  const curves = [
    "M 302 218 Q 335 205 368 218 Q 335 232 302 218",
    "M 306 210 Q 335 198 364 210 Q 335 222 306 210",
    "M 310 202 Q 335 192 360 202 Q 335 212 310 202",
    "M 314 194 Q 335 186 356 194 Q 335 202 314 194",
    "M 318 186 Q 335 180 352 186 Q 335 192 318 186",
  ];
  return (
    <G>
      {curves.map((d, i) => (
        <Path key={i} d={d} fill="none" stroke={s} strokeWidth={w * (i === 2 ? 1 : 0.9)} />
      ))}
    </G>
  );
}

/** RER sacs cupping the nucleus (textbook layout) */
function TextbookRoughER({ active }: { active: boolean }) {
  const s = active ? HIGHLIGHT : INK;
  const w = active ? 2 : 1.6;
  const rib = active ? HIGHLIGHT : INK;
  const dots: [number, number][] = [
    [268, 132], [276, 136], [284, 140], [272, 146], [280, 150], [288, 144],
    [260, 140], [268, 148],
  ];
  return (
    <G>
      {/* Outer nuclear envelope extension — RER membranes */}
      <Path
        d="M 252 125 C 268 112, 298 115, 312 132 C 320 145, 308 158, 288 156 C 270 152, 258 142, 252 125"
        fill="none"
        stroke={s}
        strokeWidth={w}
      />
      <Path
        d="M 256 132 C 270 122, 294 125, 306 138 C 312 148, 302 152, 286 150"
        fill="none"
        stroke={s}
        strokeWidth={w * 0.9}
      />
      <Path
        d="M 248 138 C 255 148, 248 158, 238 152 C 228 145, 235 135, 248 138"
        fill="none"
        stroke={s}
        strokeWidth={w * 0.85}
      />
      {dots.map(([x, y], i) => (
        <Circle key={i} cx={x} cy={y} r={2.2} fill={rib} />
      ))}
    </G>
  );
}

export function LabeledAnimalCellDiagram({ highlights = [], height = 360 }: Props) {
  const active = useMemo(() => new Set(highlights), [highlights]);
  const isOn = (id: OrganelleId) => active.size === 0 || active.has(id);
  const stroke = (id: OrganelleId) => (isOn(id) ? HIGHLIGHT : INK);
  const sw = (id: OrganelleId) => (isOn(id) ? 2.2 : 1.8);

  const callouts: CalloutSpec[] = [
    { id: "cellMembrane", label: bilingualOrganelleLabel("cellMembrane"), tx: 250, ty: 58, lx: 250, ly: 18, anchor: "middle" },
    { id: "nucleus", label: bilingualOrganelleLabel("nucleus"), tx: 218, ty: 182, lx: 42, ly: 168, anchor: "end" },
    { id: "nucleolus", label: bilingualOrganelleLabel("nucleolus"), tx: 228, ty: 192, lx: 42, ly: 188, anchor: "end" },
    { id: "roughEr", label: bilingualOrganelleLabel("roughEr"), tx: 298, ty: 132, lx: 455, ly: 96, anchor: "end" },
    { id: "smoothEr", label: bilingualOrganelleLabel("smoothEr"), tx: 158, ty: 252, lx: 455, ly: 236, anchor: "end" },
    { id: "golgi", label: bilingualOrganelleLabel("golgi"), tx: 335, ty: 210, lx: 455, ly: 296, anchor: "end" },
    { id: "mitochondrion", label: bilingualOrganelleLabel("mitochondrion"), tx: 108, ty: 268, lx: 42, ly: 306, anchor: "end" },
    { id: "vesicle", label: bilingualOrganelleLabel("vesicle"), tx: 298, ty: 188, lx: 455, ly: 152, anchor: "end" },
  ];

  return (
    <View style={styles.wrap}>
      <Text style={styles.figureTitle}>
        Rajah: Struktur sel haiwan (keratan rentas) / Animal cell structure (cross-section)
      </Text>
      <Svg width="100%" height={height} viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid meet">
        {/* Cytoplasm */}
        <Ellipse cx={250} cy={195} rx={165} ry={125} fill={FILL_CYTO} />

        {/* Double membrane (SPM textbook) */}
        <Ellipse
          cx={250}
          cy={195}
          rx={168}
          ry={128}
          fill="none"
          stroke={stroke("cellMembrane")}
          strokeWidth={sw("cellMembrane")}
        />
        <Ellipse
          cx={250}
          cy={195}
          rx={162}
          ry={122}
          fill="none"
          stroke={stroke("cellMembrane")}
          strokeWidth={sw("cellMembrane") * 0.65}
        />

        {/* Smooth ER — tubules (lower left) */}
        <G>
          <Path
            d="M 138 242 C 152 228, 170 235, 178 252 C 186 268, 168 278, 152 268 C 140 258, 132 252, 138 242"
            fill="none"
            stroke={stroke("smoothEr")}
            strokeWidth={sw("smoothEr")}
          />
          <Path
            d="M 145 250 L 165 248 L 172 262 L 158 270 Z"
            fill="none"
            stroke={stroke("smoothEr")}
            strokeWidth={sw("smoothEr") * 0.85}
          />
        </G>

        {/* Nucleus + chromatin texture */}
        <Circle cx={218} cy={182} r={52} fill={FILL_NUC} stroke={stroke("nucleus")} strokeWidth={sw("nucleus")} />
        <Path
          d="M 188 175 Q 205 168 218 178 Q 232 188 248 180 Q 238 192 218 195 Q 198 192 188 175"
          fill="none"
          stroke={CHROMATIN}
          strokeWidth={1.2}
        />
        <Path
          d="M 195 188 Q 210 182 225 190 Q 215 200 200 198"
          fill="none"
          stroke={CHROMATIN}
          strokeWidth={1}
        />
        <Circle
          cx={230}
          cy={188}
          r={14}
          fill={INK}
          fillOpacity={0.12}
          stroke={stroke("nucleolus")}
          strokeWidth={sw("nucleolus")}
        />
        <Circle cx={230} cy={188} r={9} fill={INK} fillOpacity={0.2} />

        <TextbookRoughER active={isOn("roughEr")} />
        <TextbookGolgi active={isOn("golgi")} />

        <TextbookMitochondrion cx={108} cy={268} rot={-12} active={isOn("mitochondrion")} />
        <TextbookMitochondrion cx={338} cy={122} rot={18} active={isOn("mitochondrion")} />

        {/* Vesicles / lysosomes */}
        <Circle cx={298} cy={188} r={8} fill={FILL_CYTO} stroke={stroke("vesicle")} strokeWidth={sw("vesicle")} />
        <Circle cx={272} cy={278} r={6} fill={FILL_CYTO} stroke={stroke("vesicle")} strokeWidth={1.4} />
        <Circle cx={355} cy={255} r={5} fill={FILL_CYTO} stroke={stroke("vesicle")} strokeWidth={1.2} />

        {/* Free ribosomes in cytoplasm (textbook detail) */}
        {[
          [145, 195],
          [155, 210],
          [380, 200],
          [365, 265],
        ].map(([x, y], i) => (
          <Circle key={`free-${i}`} cx={x} cy={y} r={1.8} fill={INK_LIGHT} />
        ))}

        {callouts.map((c) => (
          <TextbookLeader key={c.id} callout={c} active={isOn(c.id)} />
        ))}
      </Svg>
      {highlights.length > 0 ? (
        <Text style={styles.hint}>
          Orange labels / Label oren = struktur berkaitan soalan ini.
        </Text>
      ) : (
        <Text style={styles.hint}>
          Rujuk rajah untuk organel utama / Refer to diagram for main organelles.
        </Text>
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
    paddingTop: 10,
    paddingHorizontal: 6,
  },
  figureTitle: {
    fontSize: 12,
    fontFamily: fonts.semiBold,
    color: INK,
    textAlign: "center",
    marginBottom: 4,
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
