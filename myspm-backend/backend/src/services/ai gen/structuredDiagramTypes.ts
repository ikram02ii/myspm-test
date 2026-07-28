/**
 * Shared types for structured (non-image) question diagrams.
 * Biology cell SVG planner was removed — keep types for API / mobile compatibility.
 */

export type BiologyCellFocusLabel =
  | "cellWall"
  | "cellMembrane"
  | "vacuole"
  | "chloroplast"
  | "nucleus"
  | "cytoplasm";

export type StructuredQuestionDiagram = {
  type: "biology-cell";
  questionIndex: number;
  title?: string;
  subtitle?: string;
  layout: "plant" | "animal" | "comparison";
  state?: "normal" | "hypotonic" | "hypertonic";
  focusLabels?: BiologyCellFocusLabel[];
};
