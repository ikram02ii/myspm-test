import type { AssessmentCaseFile, UnderstandingDemonstration } from "./types";

export interface ChainWalkResult {
  creditedUnits: string[];
  matchedUnits: string[];
  satisfiedRelations: string[];
  blockedUnits: string[];
  score: number;
}

type ForwardEdge = {
  to: string;
  relationId: string;
  requiredForMarks: boolean;
};

function unitByIdMap(acf: AssessmentCaseFile) {
  return new Map(acf.units.map((u) => [u.id, u]));
}

export function unitDemonstrated(udm: UnderstandingDemonstration, unitId: string): boolean {
  return udm.unitsDemonstrated.some((d) => d.unitId === unitId && d.valid);
}

export function relationDemonstrated(udm: UnderstandingDemonstration, relationId: string): boolean {
  return udm.relationsDemonstrated.some((d) => d.relationId === relationId);
}

function buildForwardEdges(acf: AssessmentCaseFile): Map<string, ForwardEdge[]> {
  const edges = new Map<string, ForwardEdge[]>();
  for (const relation of acf.relations) {
    const list = edges.get(relation.from) ?? [];
    list.push({
      to: relation.to,
      relationId: relation.id,
      requiredForMarks: relation.requiredForMarks,
    });
    edges.set(relation.from, list);
  }
  return edges;
}

/** Credit-bearing units with no incoming relation edge (chain roots). */
export function findChainRootUnitIds(acf: AssessmentCaseFile): string[] {
  const creditIds = acf.units.filter((u) => u.creditWeight > 0).map((u) => u.id);
  if (creditIds.length === 0) return [];

  const incoming = new Set(acf.relations.map((r) => r.to));
  const roots = creditIds.filter((id) => !incoming.has(id));
  if (roots.length > 0) return roots;

  return [creditIds[0]!];
}

function supportUnitsSatisfied(
  unitId: string,
  units: ReturnType<typeof unitByIdMap>,
  udm: UnderstandingDemonstration,
): boolean {
  const unit = units.get(unitId);
  if (!unit?.supports?.length) return true;
  return unit.supports.every((supportId) => unitDemonstrated(udm, supportId));
}

export function assertZeroCreditWeightInvariant(unitId: string, creditWeight: number, scoreContribution: number): void {
  if (creditWeight === 0 && scoreContribution !== 0) {
    throw new Error(
      `[coverage_chain] zero-weight invariant violated for unit ${unitId}: creditWeight=0 but scoreContribution=${scoreContribution}`,
    );
  }
}

/**
 * Walk coverage chains from each root. Credit only a continuous prefix where each unit is
 * demonstrated, support prerequisites hold, and required relations on the path are satisfied.
 */
export function scoreCoverageChain(
  acf: AssessmentCaseFile,
  udm: UnderstandingDemonstration,
): ChainWalkResult {
  const maxMarks = acf.maxScore;
  const units = unitByIdMap(acf);
  const edges = buildForwardEdges(acf);
  const roots = findChainRootUnitIds(acf);

  const creditedUnits: string[] = [];
  const matchedUnits: string[] = [];
  const satisfiedRelations: string[] = [];
  const blockedUnits: string[] = [];
  const creditedSet = new Set<string>();
  const blockedSet = new Set<string>();

  for (const id of acf.units.map((u) => u.id)) {
    if (unitDemonstrated(udm, id) && !matchedUnits.includes(id)) {
      matchedUnits.push(id);
    }
  }

  function creditUnit(unitId: string): number {
    const unit = units.get(unitId);
    if (!unit) return 0;
    assertZeroCreditWeightInvariant(unitId, unit.creditWeight, unit.creditWeight > 0 ? unit.creditWeight : 0);
    if (unit.creditWeight <= 0) return 0;
    if (creditedSet.has(unitId)) return 0;
    creditedSet.add(unitId);
    creditedUnits.push(unitId);
    return unit.creditWeight;
  }

  function markBlocked(unitId: string): void {
    if (!blockedSet.has(unitId)) {
      blockedSet.add(unitId);
      blockedUnits.push(unitId);
    }
  }

  function walkFrom(unitId: string, chainActive: boolean): void {
    const unit = units.get(unitId);
    if (!unit) return;

    const demonstrated = unitDemonstrated(udm, unitId);

    if (!chainActive) {
      if (demonstrated) markBlocked(unitId);
      for (const edge of edges.get(unitId) ?? []) {
        walkFrom(edge.to, false);
      }
      return;
    }

    if (!demonstrated || !supportUnitsSatisfied(unitId, units, udm)) {
      markBlocked(unitId);
      for (const edge of edges.get(unitId) ?? []) {
        walkFrom(edge.to, false);
      }
      return;
    }

    creditUnit(unitId);

    for (const edge of edges.get(unitId) ?? []) {
      if (edge.requiredForMarks && !relationDemonstrated(udm, edge.relationId)) {
        markBlocked(edge.to);
        walkFrom(edge.to, false);
        continue;
      }
      if (edge.requiredForMarks && relationDemonstrated(udm, edge.relationId)) {
        if (!satisfiedRelations.includes(edge.relationId)) {
          satisfiedRelations.push(edge.relationId);
        }
      }
      walkFrom(edge.to, true);
    }
  }

  for (const rootId of roots) {
    walkFrom(rootId, true);
  }

  let score = creditedUnits.reduce((sum, id) => {
    const weight = units.get(id)?.creditWeight ?? 0;
    assertZeroCreditWeightInvariant(id, weight, weight);
    return sum + weight;
  }, 0);
  score = Math.max(0, Math.min(maxMarks, score));

  return {
    creditedUnits,
    matchedUnits,
    satisfiedRelations,
    blockedUnits,
    score,
  };
}

export function chainWalkToFeedbackGaps(
  acf: AssessmentCaseFile,
  udm: UnderstandingDemonstration,
  chainWalk: ChainWalkResult,
): {
  creditedLabels: string[];
  blockedLabels: string[];
  missingChainLabels: string[];
  relationGapLabels: string[];
} {
  const units = unitByIdMap(acf);
  const creditedLabels = chainWalk.creditedUnits.map((id) => units.get(id)?.content ?? id);
  const blockedLabels = chainWalk.blockedUnits.map((id) => units.get(id)?.content ?? id);

  const missingChainLabels: string[] = [];
  for (const unit of acf.units.filter((u) => u.creditWeight > 0)) {
    if (chainWalk.creditedUnits.includes(unit.id)) continue;
    if (chainWalk.blockedUnits.includes(unit.id)) continue;
    missingChainLabels.push(unit.content);
  }

  const relationGapLabels = udm.relationsMissing.map((g) => g.label);

  return { creditedLabels, blockedLabels, missingChainLabels, relationGapLabels };
}
