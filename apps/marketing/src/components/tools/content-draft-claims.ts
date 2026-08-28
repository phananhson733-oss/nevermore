// @input  -- one contract Sentence (claim state + server-derived support count)
// @output -- which source layer, if any, underlines it on screen
// @pos    -- the single claim-to-colour rule; the doc and the legend both read it,
//            and neither names a colour token itself

import type { Sentence } from "@sf/public-tools/content-brief/contract";

/**
 * `first` / `third` are the two source layers of handoff §7; `gap` is the
 * error colour; `null` draws nothing (a connective sentence asserts nothing).
 *
 * A bound sentence is third-party when at least one competitor excerpt backs
 * it. That is read from `support_count` -- the server's distinct C* count --
 * rather than by parsing reference ids, so the colour follows the same
 * derivation the verify list uses (`support_count === 0` is `profile_only`).
 * A stance cites only profile facts by contract, so it is first-party.
 */
export type ClaimTone = "first" | "third" | "gap" | null;

export function claimTone(
  sentence: Pick<Sentence, "claim" | "support_count">,
): ClaimTone {
  switch (sentence.claim) {
    case "bound":
      return sentence.support_count > 0 ? "third" : "first";
    case "stance":
      return "first";
    case "gap":
      return "gap";
    case "no_claim":
      return null;
  }
}
