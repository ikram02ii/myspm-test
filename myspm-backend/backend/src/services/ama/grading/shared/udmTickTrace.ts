/**
 * Env-gated three-stage UDM tick tracing for theory grading investigations.
 * Enable with GRADE_UDM_TRACE=1 (or true/yes).
 */

import type { AssessmentCaseFile, UnderstandingDemonstration } from "./types";

export type UdmTickFailReason =
  | "grounded"
  | "distinctive"
  | "covers"
  | "verifier"
  | "unknown_unit"
  | null;

export type UdmTickSnapshotRow = {
  unitId: string;
  valid: boolean;
  quote: string;
  failReason: UdmTickFailReason;
};

export type UdmTraceStage = "raw" | "after_gate" | "after_reconcile";

export function isUdmTraceEnabled(): boolean {
  const v = (process.env.GRADE_UDM_TRACE || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function snapshotUdmTicks(
  acf: AssessmentCaseFile,
  udm: UnderstandingDemonstration,
  failReasons?: Map<string, UdmTickFailReason>,
): UdmTickSnapshotRow[] {
  const credit = acf.units.filter((u) => u.creditWeight > 0);
  return credit.map((unit) => {
    const demo = udm.unitsDemonstrated.find((d) => d.unitId === unit.id);
    const valid = Boolean(demo?.valid);
    return {
      unitId: unit.id,
      valid,
      quote: demo?.quote?.trim() || "",
      failReason: valid ? null : (failReasons?.get(unit.id) ?? null),
    };
  });
}

export function logUdmTraceStage(params: {
  stage: UdmTraceStage;
  caseId?: string;
  question?: string;
  rows: UdmTickSnapshotRow[];
}): void {
  if (!isUdmTraceEnabled()) return;
  console.info("[grade:udmTrace]", {
    stage: params.stage,
    caseId: params.caseId ?? null,
    questionPreview: (params.question || "").slice(0, 120),
    units: params.rows,
  });
}
