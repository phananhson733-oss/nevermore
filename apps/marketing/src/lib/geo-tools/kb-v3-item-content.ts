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
import { geoV3Items, type GeoKnowledgeBodyV3 } from "./kb-v3-contract.ts";

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
