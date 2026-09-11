// @input  -- a stored v3 draft and one owner gesture about one rival in its locked input
// @output -- the draft re-locked around that gesture, or the reason it does not apply
// @pos    -- pure: it decides what the competitor route writes and reaches no store; the digest keeps it server-side

/**
 * The confirm gesture `competitorsFromProfile` promised.
 *
 * Which rivals exist is the Profile's answer, recomputed on every re-lock.
 * Whether a rival is CONFIRMED is the owner's, and until this file nothing in
 * the product wrote `confirmed: true` into a v3 input -- so no run ever fetched
 * a competitor page, and the comparisons module was `not_applicable` on every
 * knowledge base that has ever been updated.
 *
 * A confirmation changes what the NEXT update reads. It does not change what
 * this update read, nor what the owner decided about what it produced, so the
 * knowledge body and the review stay. What goes is the four `runRef` ids:
 * `marketing_geo_save_kb_draft` admits a moved `generationInputHash` only when
 * every id is cleared in the same write, and clearing them is also the truth --
 * a body assembled under the old input is no longer backed by a record made
 * for the new one, and publish already treats a null `knowledgeGenerationId`
 * as "nothing to reuse" rather than as a fault. This is narrower than the
 * re-lock on purpose: that one discards the body and the review because the
 * Profile revision beneath every item moved; here no item's content moves.
 *
 * The domain is matched exactly. `competitorsFromProfile` writes the bare host
 * the Profile named, and a gesture that folded case or a `www.` would confirm
 * a row the owner was not looking at.
 */
import { geoV2Digest } from "./kb-v2-digest.ts";
import { GEO_KB_V3_RELEASED_REFS, type GeoKbV3ReleasedRef } from "./kb-v3-draft-create.ts";
import { parseGeoKbPayloadV3, type GeoGenerationInputV3, type GeoKbPayloadV3 } from "./kb-v3-contract.ts";

export type GeoKbV3CompetitorGesture =
  | {
      readonly kind: "confirm";
      readonly domain: string;
      readonly brandName: string;
      readonly aliases: readonly string[];
    }
  | { readonly kind: "unconfirm"; readonly domain: string };

export type GeoKbV3CompetitorGestureOutcome =
  | {
      readonly kind: "ok";
      readonly payload: GeoKbPayloadV3;
      /** False when the rival already held that state; the payload is then the stored one, untouched. */
      readonly changed: boolean;
      /** The paid records the draft may no longer reuse, by the field that named them. */
      readonly released: readonly GeoKbV3ReleasedRef[];
    }
  /** No domain-keyed rival of that exact spelling is in the locked input. */
  | { readonly kind: "unknown_competitor" }
  /** The contract cannot hold what was asked: a confirmation with no name. */
  | { readonly kind: "invalid" };

type Competitor = GeoGenerationInputV3["competitors"][number];

const ALIAS_LIMIT = 12;

function cleanText(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

/** Distinct, non-empty, never the name itself; compared case-insensitively, kept as first written. */
function cleanAliases(values: readonly string[], brandName: string): string[] {
  const seen = new Set<string>([brandName.toLocaleLowerCase("en")]);
  const kept: string[] = [];
  for (const value of values) {
    const alias = cleanText(value);
    const key = alias.toLocaleLowerCase("en");
    if (alias === "" || seen.has(key)) continue;
    seen.add(key);
    kept.push(alias);
  }
  return kept.slice(0, ALIAS_LIMIT);
}

function nextRow(row: Competitor, gesture: GeoKbV3CompetitorGesture): Competitor | "invalid" {
  if (gesture.kind === "unconfirm") return { ...row, confirmed: false };
  const brandName = cleanText(gesture.brandName);
  if (brandName === "") return "invalid";
  const aliases = cleanAliases(gesture.aliases, brandName);
  return {
    domain: row.domain,
    brandName,
    confirmed: true,
    ...(aliases.length === 0 ? {} : { aliases }),
  };
}

function sameRow(left: Competitor, right: Competitor): boolean {
  return left.domain === right.domain
    && left.brandName === right.brandName
    && left.confirmed === right.confirmed
    && JSON.stringify(left.aliases ?? null) === JSON.stringify(right.aliases ?? null);
}

export function applyGeoKbV3CompetitorGesture(
  stored: GeoKbPayloadV3,
  gesture: GeoKbV3CompetitorGesture,
): GeoKbV3CompetitorGestureOutcome {
  const rows = stored.generationInput.competitors;
  const index = gesture.domain === "" ? -1 : rows.findIndex((row) => row.domain === gesture.domain);
  const current = rows[index];
  if (current === undefined) return { kind: "unknown_competitor" };
  const replaced = nextRow(current, gesture);
  if (replaced === "invalid") return { kind: "invalid" };
  if (sameRow(current, replaced)) return { kind: "ok", payload: stored, changed: false, released: [] };

  const generationInput: GeoGenerationInputV3 = {
    ...stored.generationInput,
    competitors: rows.map((row, position) => (position === index ? replaced : row)),
  };
  const payload = parseGeoKbPayloadV3({
    ...stored,
    generationInput,
    runRef: {
      runId: null,
      generationInputHash: geoV2Digest(generationInput),
      rolesGenerationId: null,
      knowledgeGenerationId: null,
      questionsGenerationId: null,
    },
  });
  return {
    kind: "ok",
    payload,
    changed: true,
    released: GEO_KB_V3_RELEASED_REFS.filter((field) => stored.runRef[field] !== null),
  };
}
