// @input  -- one confirmed Website Profile and the immutable reference naming its snapshot
// @output -- the v3 `profileRef`: the 13 fields GEO reads, by value, under a digest of those exact bytes
// @pos    -- pure projection; it reads no store, issues no request and hashes only what it returns

/**
 * The constructor `GeoProfileRefV3` never had.
 *
 * `kb-profile-subset.ts` decides *which* 13 Profile fields GEO reads. Nothing
 * assembled them into the reference a v3 draft stores, so no v3 draft could be
 * built at all. This is that assembly, and it is deliberately the only place
 * the two halves meet: the reference proves which confirmed revision the values
 * came from, and the values are carried so a frozen version renders without
 * re-reading the Profile.
 *
 * Two decisions worth stating, because both are first-of-their-kind here:
 *
 *   `subsetHash` is the digest of the subset this object stores, not of
 *   `geoProfileSubset()`'s output. The two differ: the stored subset carries a
 *   narrower provenance shape (see below), and a hash naming bytes nobody
 *   stores can never be checked by anyone. It is a corruption check, not an
 *   authorisation one -- what proves the subset belongs to the confirmed
 *   Profile is the database comparing the reference against the website's
 *   current confirmed snapshot, which is where that check already lives
 *   (`marketing_geo_generation_input_current`, v3 branch).
 *
 *   Provenance is projected, not copied. A Profile entry carries seven fields;
 *   `geoProfileRefSchema` admits four, and one of them is a single
 *   `evidenceUrl` where the Profile holds a list. The first URL is kept and the
 *   rest are dropped -- they are not lost, because the full entry stays in
 *   `marketing_website_profile_snapshots` under this `snapshotId`, which is the
 *   same argument that justified dropping the other 15 Profile fields.
 */
import type {
  MarketingWebsiteProfileV1,
  WebsiteProfileReferenceV1,
} from "../account-websites/contracts.ts";
import { geoProfileSubset } from "./kb-profile-subset.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { geoProfileRefSchema, type GeoProfileRefV3 } from "./kb-v3-contract.ts";

/**
 * A Profile GEO cannot reference, and exactly which of its fields refused.
 *
 * Refusing is the right answer rather than trimming to fit: a cut value is a
 * different value presented under a hash that claims to be the Profile's. The
 * owner can shorten it; this cannot decide to for them.
 *
 * Where the two schemas differ is worth stating, because it is not where it
 * looks. The bounds are lengths in UTF-16 code units on both sides -- that is
 * what zod's `.max()` counts, not code points -- and none of them is narrower
 * here: `productName` is `.max(160)` in the Profile too
 * (`../account-websites/contracts.ts`), and the carried lists are wider here
 * than the Profile's own. What is narrower is the character rule and the
 * reference: `geoPlainString` refuses a NUL or a lone surrogate that the
 * Profile's `boundedText` admits, and `snapshotRevision` must be a positive
 * integer. So this is a fail-closed boundary between two schemas nothing keeps
 * aligned -- and it is what would catch the Profile being widened later, which
 * is precisely when a silent trim would start happening.
 */
export type GeoProfileRefBuildV3 =
  | { readonly kind: "ok"; readonly profileRef: GeoProfileRefV3 }
  | { readonly kind: "unusable"; readonly fields: readonly string[] };

/** The provenance shape a v3 reference stores, projected from the Profile's. */
function projectProvenance(subset: ReturnType<typeof geoProfileSubset>) {
  return subset.fieldProvenance.map((entry) => ({
    path: entry.path,
    derivation: entry.derivation,
    observedAt: entry.observedAt,
    evidenceUrl: entry.evidenceUrls[0] ?? null,
  }));
}

/** Failing field paths, deduplicated and bounded, in the order zod reported them. */
function refusedFields(issues: readonly { readonly path: readonly PropertyKey[] }[]): readonly string[] {
  const seen = new Set<string>();
  for (const issue of issues) {
    seen.add(`/${issue.path.map(String).join("/")}`);
    if (seen.size >= 16) break;
  }
  return [...seen];
}

export function buildGeoProfileRefV3(
  reference: WebsiteProfileReferenceV1,
  profile: MarketingWebsiteProfileV1,
): GeoProfileRefBuildV3 {
  const projected = geoProfileSubset(profile);
  const { fieldProvenance: _profileProvenance, ...values } = projected;
  const subset = { ...values, fieldProvenance: projectProvenance(projected) };
  const parsed = geoProfileRefSchema.safeParse({
    websiteId: reference.websiteId,
    snapshotId: reference.snapshotId,
    // The contract stores the revision as a string: the payload's hash domain
    // has no number type, so a revision carried as a number could not be hashed.
    snapshotRevision: String(reference.snapshotRevision),
    profileHash: reference.profileHash,
    subsetHash: geoV2Digest(subset),
    subset,
  });
  return parsed.success
    ? { kind: "ok", profileRef: parsed.data }
    : { kind: "unusable", fields: refusedFields(parsed.error.issues) };
}
