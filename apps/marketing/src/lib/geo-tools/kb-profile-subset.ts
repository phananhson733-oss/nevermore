// @input  -- an exact confirmed Website Profile, or a stored V1 copy of one
// @output -- the Profile fields GEO actually reads, and nothing else
// @pos    -- pure projection; it reads no snapshot and issues no request
import { createHash } from "node:crypto";
import { canonicalGeoV2Text } from "./kb-v2-json.ts";
import type { MarketingWebsiteProfileV1, WebsiteProfileFieldProvenance } from "../account-websites/contracts.ts";

/**
 * Every Profile field GEO reads, and the reason each one is here. The draft
 * used to carry all 28; the other 15 were carried, hashed, size-capped and
 * rendered as read-only inputs without a single consumer.
 *
 * The full Profile is not lost by dropping them: `marketing_website_profile_snapshots`
 * keeps each confirmed revision under an immutable-row trigger, unique on
 * (website_id, revision) and on (website_id, content_hash), so the exact bytes
 * stay retrievable by the `snapshotId` this copy references. Carrying them a
 * second time inside every GEO draft is duplication, not durability.
 */
export const GEO_PROFILE_SUBSET_FIELDS = [
  // Read by `inheritedProfileFromCopy`, and the four a frozen version keeps.
  "productName",
  "oneLinePositioning",
  "coreFeatures",
  "country",
  "locale",
  // Read by `buildGeoProfileSuggestions` to derive measurement values and a role.
  "categories",
  "buyer",
  "primaryIcp",
  "triggerPain",
  "icpPain",
  "qualificationSignals",
  "icpInterests",
  "directCompetitors",
] as const;
export type GeoProfileSubsetField = (typeof GEO_PROFILE_SUBSET_FIELDS)[number];

/** The provenance paths a frozen version reports; the rest describe fields nothing here reads. */
export const GEO_PROFILE_SUBSET_PROVENANCE_PATHS = ["/productName", "/oneLinePositioning", "/coreFeatures"] as const;

export type GeoProfileSubset = Pick<MarketingWebsiteProfileV1, GeoProfileSubsetField> & {
  readonly fieldProvenance: readonly WebsiteProfileFieldProvenance[];
};

/**
 * Project a confirmed Profile onto what GEO reads. The digest below is already
 * order-independent -- `canonicalGeoV2Text` sorts keys -- so the ordered list
 * is not what makes it stable. The list is here because it is the contract:
 * one place to read what GEO consumes, top to bottom.
 */
export function geoProfileSubset(profile: MarketingWebsiteProfileV1): GeoProfileSubset {
  const picked = Object.fromEntries(GEO_PROFILE_SUBSET_FIELDS.map(field => [field, profile[field]]));
  const paths = new Set<string>(GEO_PROFILE_SUBSET_PROVENANCE_PATHS);
  return {
    ...(picked as Pick<MarketingWebsiteProfileV1, GeoProfileSubsetField>),
    fieldProvenance: profile.fieldProvenance.filter(entry => paths.has(entry.path)),
  };
}

/**
 * A digest of the subset itself. It is a corruption check, not an
 * authorisation one: a client can always produce a consistent pair. What
 * proves the subset belongs to the confirmed Profile is the server comparing
 * it against the referenced snapshot, which is where that check already lives.
 */
export function geoProfileSubsetHash(subset: GeoProfileSubset): string {
  return createHash("sha256").update(canonicalGeoV2Text(subset), "utf8").digest("hex");
}

/** Whether a stored subset still matches the snapshot it claims to come from. */
export function geoProfileSubsetMatches(subset: GeoProfileSubset, profile: MarketingWebsiteProfileV1): boolean {
  return canonicalGeoV2Text(subset) === canonicalGeoV2Text(geoProfileSubset(profile));
}
