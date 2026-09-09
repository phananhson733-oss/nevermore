// @input -- the knowledge body of a v3 draft
// @output -- one content digest per reviewable item, and the item keys in walk order
// @pos -- server-only: it digests, so the browser gets the decision state instead

/**
 * What a decision was decided against.
 *
 * `baseContentHash` exists so the next update can tell "the owner approved this
 * exact sentence" from "the owner approved something that has since been
 * rewritten". It therefore has to cover what a reader reads and nothing else:
 * the item's identity plus every claim it makes, including the competing
 * observations it is holding open. Provenance is deliberately excluded --
 * re-crawling the same sentence from a second page changes `sourceRefs` and
 * changes nothing a reader would notice, and an approval that expired on that
 * would ask the owner to re-approve text they already read.
 *
 * It is computed here rather than in the browser for two reasons: there is no
 * sha256 in a client component, and a hash supplied by the client would be a
 * claim about what was on screen that nothing could check. The save is
 * compare-and-swap on the draft version, so the item the server hashes is
 * provably the item the client rendered.
 */
import { geoV2Digest } from "./kb-v2-digest.ts";
import { geoV3Items, type GeoKnowledgeBodyV3, type GeoReviewV3 } from "./kb-v3-contract.ts";

export function geoV3ItemContentHashes(knowledge: GeoKnowledgeBodyV3 | null): ReadonlyMap<string, string> {
  const hashes = new Map<string, string>();
  for (const item of geoV3Items(knowledge)) {
    hashes.set(item.itemKey, geoV2Digest({
      module: item.module,
      identity: item.identity,
      claims: item.claims.map((claim) => claim.text),
    }));
  }
  return hashes;
}

/**
 * The decided items whose decision was made against text that has since been
 * rewritten -- section 4.4's third rule, seen from the card's side.
 *
 * The merge keeps such a decision standing on purpose: the owner did decide,
 * and re-asking them everything on every update is the thing section 4.4 exists
 * to prevent. What it leaves behind is a `baseContentHash` that no longer
 * matches, and the whole reason that is acceptable is that the row then says
 * "has a new observation" instead of presenting an approval of a sentence
 * nobody has read. Nothing else in the product reads `baseContentHash`, so this
 * function is the only thing standing between "the decision stands" and "the
 * decision was silently transferred".
 *
 * It is derived rather than stored: the two inputs are already in the draft, a
 * stored flag could disagree with them, and the browser cannot compute the
 * digest half itself. A save re-stamps the hash of every decision it changed,
 * so recomputing this over the review a save returns is what makes the row
 * stop saying it once the owner has looked.
 */
export function geoV3RestatedItemKeys(
  knowledge: GeoKnowledgeBodyV3 | null,
  review: GeoReviewV3,
): readonly string[] {
  const hashes = geoV3ItemContentHashes(knowledge);
  return review.decisions
    .filter((record) => {
      const current = hashes.get(record.itemKey);
      // An item the body no longer carries is not restated; it is gone, and
      // the merge has already accounted for it.
      return current !== undefined && current !== record.baseContentHash;
    })
    .map((record) => record.itemKey);
}
