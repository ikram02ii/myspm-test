import type { ChainWalkResult } from "../scoring/coverageChainScorer";

/** Shared deterministic grading artifacts consumed by scoring and feedback. */
export type GradingContext = {
  chainWalk?: ChainWalkResult;
};
