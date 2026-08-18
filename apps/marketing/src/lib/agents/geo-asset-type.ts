// @input  -- nothing; this module has no dependencies by design
// @output -- the closed set of asset types a GEO action may ever propose
// @pos    -- leaf taxonomy imported by the query contract and by the action mapping

/**
 * Why the asset types live alone in a file of their own.
 *
 * The query contract needs them — a generated question declares which asset
 * types could plausibly answer it — and so does the action mapping, which is
 * built four tasks later and pulls in report, evidence and handoff code. Naming
 * the type in the query contract by importing the action module would drag all
 * of that into the browser bundle that renders the confirm step, and naming it
 * in the action module by importing the query contract would make the two
 * mutually dependent. A leaf both sides import is the only arrangement where
 * neither owns the other.
 *
 * The order of this array is load-bearing: it is the canonical sort order for
 * `expectedAssetTypes` inside the query-set content fingerprint, so two clients
 * that listed the same asset types in different orders still hash identically.
 * Appending is safe; reordering changes every fingerprint that was ever
 * computed and is therefore a schema change, not an edit.
 */
export const GEO_ASSET_TYPES = [
  "existing_page_enhancement",
  "blog_guide",
  "use_case_landing",
  "comparison_page",
  "pricing_page",
  "integration_docs",
  "security_trust_page",
  "public_tool",
  "research_dataset",
  "offsite_authority_plan",
  "technical_fix",
] as const;

export type GeoAssetType = (typeof GEO_ASSET_TYPES)[number];

const ASSET_TYPE_RANK: ReadonlyMap<string, number> = new Map(
  GEO_ASSET_TYPES.map((assetType, index) => [assetType, index]),
);

export function isGeoAssetType(value: unknown): value is GeoAssetType {
  return typeof value === "string" && ASSET_TYPE_RANK.has(value);
}

/**
 * Canonical order for hashing and rendering.
 *
 * Declaration order rather than alphabetical: the list reads as a rough
 * escalation from "improve what exists" to "go and earn it off-site", and a
 * report that presents its options in that order is telling the reader
 * something. Alphabetical would put `blog_guide` second and bury
 * `existing_page_enhancement`, which is the one the plan wants preferred.
 */
export function compareGeoAssetTypes(a: GeoAssetType, b: GeoAssetType): number {
  return (ASSET_TYPE_RANK.get(a) ?? -1) - (ASSET_TYPE_RANK.get(b) ?? -1);
}

/** Deduped and put in {@link GEO_ASSET_TYPES} order, for the hash projection. */
export function canonicalGeoAssetTypes(
  values: readonly GeoAssetType[],
): readonly GeoAssetType[] {
  return [...new Set(values)].sort(compareGeoAssetTypes);
}
