// @input  -- the gate values the V2 editor already computes
// @output -- one ordered, named progress model instead of scattered hints
// @pos    -- presentation of existing gates; it never relaxes or reorders one
export const GEO_KB_V2_STEPS = ["save", "sources", "roles", "prepare", "freeze"] as const;
export type GeoKbV2StepId = (typeof GEO_KB_V2_STEPS)[number];
export type GeoKbV2StepState = "done" | "ready" | "blocked";
export type GeoKbV2StepReason = "unsaved" | "copyStale" | "review" | "noCandidate" | "staleCandidate" | "notReviewed" | "busy";

export interface GeoKbV2Step {
  readonly id: GeoKbV2StepId;
  readonly state: GeoKbV2StepState;
  readonly reason: GeoKbV2StepReason | null;
}

export interface GeoKbV2StepInput {
  readonly busy: boolean;
  readonly dirty: boolean;
  readonly requiresSave: boolean;
  readonly copyStale: boolean;
  readonly needsReview: boolean;
  readonly canGenerate: boolean;
  readonly canPrepare: boolean;
  readonly canFreeze: boolean;
  readonly hasSourceReceipt: boolean;
  readonly hasRoleProposal: boolean;
  readonly hasCandidate: boolean;
  readonly candidateStale: boolean;
  readonly reviewed: boolean;
}

/**
 * Why a step is blocked is decided in the same order the editor decides it, so
 * the visible reason is the one that actually has to be resolved first.
 */
function blockedBecause(input: GeoKbV2StepInput): GeoKbV2StepReason {
  if (input.busy) return "busy";
  if (input.dirty || input.requiresSave) return "unsaved";
  if (input.copyStale) return "copyStale";
  return "review";
}

export function geoKbV2Steps(input: GeoKbV2StepInput): readonly GeoKbV2Step[] {
  const saved = !input.dirty && !input.requiresSave;
  const step = (id: GeoKbV2StepId, done: boolean, ready: boolean, reason: GeoKbV2StepReason): GeoKbV2Step =>
    done ? { id, state: "done", reason: null }
      : ready ? { id, state: "ready", reason: null }
        : { id, state: "blocked", reason };
  return [
    step("save", saved, true, "busy"),
    step("sources", input.hasSourceReceipt, input.canGenerate, blockedBecause(input)),
    step("roles", input.hasRoleProposal, input.canGenerate, blockedBecause(input)),
    // Preparing is the one step the review gate guards, so an outstanding
    // review is named here even when everything else is saved and current.
    step("prepare", input.hasCandidate && !input.candidateStale, input.canPrepare, input.needsReview && !input.busy && saved && !input.copyStale ? "review" : blockedBecause(input)),
    step("freeze", false, input.canFreeze, !input.hasCandidate ? "noCandidate" : input.candidateStale ? "staleCandidate" : !input.reviewed ? "notReviewed" : "busy"),
  ];
}
