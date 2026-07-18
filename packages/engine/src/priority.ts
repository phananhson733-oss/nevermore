import type { Severity } from "./rule.ts";
import type { Confidence } from "./confidence.ts";

/**
 * Deterministic priority (spec §9.3). NO opaque weighted score — an ordered set
 * of rules over severity / confidence / subject relevance produces a (band, lane)
 * and, for low-confidence, a hard-gated blocked status. Lanes map to delivery
 * windows: now=0–30d, next=31–60d, later=61–90d. Human overrides are recorded
 * separately and never re-derived here.
 */

export type PriorityBand = "critical" | "high" | "medium" | "low";
export type RoadmapLane = "now" | "next" | "later";
export type ActionStatus = "candidate" | "blocked";

export interface PriorityInput {
  readonly severity: Severity;
  readonly confidence: Confidence;
  /** True when the finding hits a priority URL / offer (subject relevance). */
  readonly priorityRelevant: boolean;
}

export interface PriorityResult {
  readonly band: PriorityBand;
  readonly lane: RoadmapLane;
  readonly status: ActionStatus;
}

export function derivePriority(input: PriorityInput): PriorityResult {
  const { severity, confidence, priorityRelevant } = input;

  // 7. Low-confidence hard gate takes precedence: blocked until data/override.
  if (confidence === "low") {
    return { band: "medium", lane: "later", status: "blocked" };
  }
  // 1. Critical severity.
  if (severity === "critical") {
    return { band: "critical", lane: "now", status: "candidate" };
  }
  // 2. High severity + high confidence.
  if (severity === "high" && confidence === "high") {
    return { band: "high", lane: "now", status: "candidate" };
  }
  // 3. High severity + medium confidence.
  if (severity === "high") {
    return { band: "high", lane: "next", status: "candidate" };
  }
  // 4. Medium severity + priority relevance + high confidence.
  if (severity === "medium" && priorityRelevant && confidence === "high") {
    return { band: "high", lane: "next", status: "candidate" };
  }
  // 5. Medium severity.
  if (severity === "medium") {
    return { band: "medium", lane: "next", status: "candidate" };
  }
  // 6. Low severity.
  return { band: "low", lane: "later", status: "candidate" };
}

/** Lane → delivery window label (spec §9.3). */
export const LANE_WINDOW: Record<RoadmapLane, string> = {
  now: "0-30d",
  next: "31-60d",
  later: "61-90d",
};
