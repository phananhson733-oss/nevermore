// @input  -- the gate values and the actual action availability the editor computes
// @output -- one ordered, named progress model instead of scattered hints
// @pos    -- presentation of existing gates; it never relaxes or reorders one
export const GEO_KB_V2_STEPS = ["save", "sources", "roles", "prepare", "freeze"] as const;
export type GeoKbV2StepId = (typeof GEO_KB_V2_STEPS)[number];
export type GeoKbV2StepState = "done" | "ready" | "blocked";
export type GeoKbV2StepReason = "unsaved" | "copyStale" | "review" | "running" | "noCandidate" | "staleCandidate" | "notReviewed" | "busy" | "unavailable";

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
  /**
   * Whether each button is actually operable, taken from the same expression
   * the button uses. A gate value alone is not enough: a dispatched generation
   * leaves `canGenerate` true while its button is read-only.
   */
  readonly sourcesActionable: boolean;
  readonly rolesActionable: boolean;
  readonly prepareActionable: boolean;
  readonly canFreeze: boolean;
  readonly generationRunning: boolean;
  /** Present AND usable against the current draft, not merely present. */
  readonly hasUsableSourceReceipt: boolean;
  readonly hasUsableRoleProposal: boolean;
  readonly hasCandidate: boolean;
  readonly candidateStale: boolean;
  readonly reviewed: boolean;
  readonly frozenAtCurrentDraft: boolean;
}

/**
 * Why a step is blocked, decided in the order the editor decides it, so the
 * visible reason is the one that has to be resolved first. When none of the
 * conditions this model knows about applies, it says so rather than naming the
 * last one on the list and being wrong.
 */
function blockedBecause(input: GeoKbV2StepInput, review: boolean): GeoKbV2StepReason {
  if (input.busy) return "busy";
  // A stale Profile copy comes before "unsaved": every write is refused with
  // context_stale until the copy is adopted, so telling the visitor to save
  // first would name a step that cannot succeed.
  if (input.copyStale) return "copyStale";
  if (input.dirty || input.requiresSave) return "unsaved";
  if (input.generationRunning) return "running";
  if (review && input.needsReview) return "review";
  return "unavailable";
}

export function geoKbV2Steps(input: GeoKbV2StepInput): readonly GeoKbV2Step[] {
  const saved = !input.dirty && !input.requiresSave;
  const step = (id: GeoKbV2StepId, done: boolean, ready: boolean, reason: GeoKbV2StepReason): GeoKbV2Step =>
    done ? { id, state: "done", reason: null }
      : ready ? { id, state: "ready", reason: null }
        : { id, state: "blocked", reason };
  return [
    step("save", saved, !input.busy && !input.copyStale, input.busy ? "busy" : "copyStale"),
    step("sources", input.hasUsableSourceReceipt, input.sourcesActionable, blockedBecause(input, false)),
    step("roles", input.hasUsableRoleProposal, input.rolesActionable, blockedBecause(input, false)),
    step("prepare", input.hasCandidate && !input.candidateStale, input.prepareActionable, blockedBecause(input, true)),
    step("freeze", input.frozenAtCurrentDraft, input.canFreeze,
      !input.hasCandidate ? "noCandidate" : input.candidateStale ? "staleCandidate" : !input.reviewed ? "notReviewed" : blockedBecause(input, false)),
  ];
}
