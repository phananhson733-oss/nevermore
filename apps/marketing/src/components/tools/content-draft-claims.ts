// @input  -- one contract Sentence (claim state + evidence references)
// @output -- which source layer, if any, underlines it on screen
// @pos    -- the single claim-to-colour rule; the doc and the legend both read it,
//            and neither names a colour token itself

import type { Sentence } from "@sf/public-tools/content-brief/contract";

/**
 * `first` / `third` are the two source layers of handoff §7; `gap` is the
 * error colour; `null` draws nothing (a connective sentence asserts nothing).
 *
 * A bound sentence is third-party when it cites at least one competitor
 * observation (a `C*` reference), first-party when it cites only profile
 * facts. The references themselves decide, not the server's `support_count`:
 * the colour must follow what the sentence actually cites, and a count that
 * disagreed with the references would otherwise colour it by the wrong
 * layer. A stance cites only profile facts by contract, so it is first-party.
 */
export type ClaimTone = "first" | "third" | "gap" | null;

const CRAWL_REF = /^C\d+$/u;

export function citesCompetitorPage(refs: readonly string[]): boolean {
  return refs.some((ref) => CRAWL_REF.test(ref));
}

export function claimTone(
  sentence: Pick<Sentence, "claim" | "evidence_refs">,
): ClaimTone {
  switch (sentence.claim) {
    case "bound":
      return citesCompetitorPage(sentence.evidence_refs) ? "third" : "first";
    case "stance":
      return "first";
    case "gap":
      return "gap";
    case "no_claim":
      return null;
  }
}
