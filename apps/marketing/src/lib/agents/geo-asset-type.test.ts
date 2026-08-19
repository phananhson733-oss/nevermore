// @input  -- the leaf asset-type taxonomy
// @output -- proof the order is pinned and the guard admits exactly the members
// @pos    -- focused tests for the shared GEO asset-type leaf

import { describe, expect, it } from "vitest";

import {
  canonicalGeoAssetTypes,
  compareGeoAssetTypes,
  GEO_ASSET_TYPES,
  isGeoAssetType,
  type GeoAssetType,
} from "./geo-asset-type.ts";

describe("GEO_ASSET_TYPES", () => {
  /**
   * Pinned as a literal, not described by a rule.
   *
   * The array order is the canonical sort order inside the query-set content
   * fingerprint, so reordering it silently changes every hash the product has
   * ever produced. That is a schema change; this assertion is what makes it
   * announce itself.
   */
  it("is the exact declared order", () => {
    expect([...GEO_ASSET_TYPES]).toEqual([
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
    ]);
  });

  it("has no duplicates", () => {
    expect(new Set(GEO_ASSET_TYPES).size).toBe(GEO_ASSET_TYPES.length);
  });

  it("admits every member and nothing else", () => {
    for (const assetType of GEO_ASSET_TYPES) {
      expect(isGeoAssetType(assetType)).toBe(true);
    }
    for (const other of [
      "",
      "blog",
      "BLOG_GUIDE",
      " blog_guide",
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isGeoAssetType(other)).toBe(false);
    }
  });

  it("sorts by declaration order rather than alphabetically", () => {
    const shuffled: readonly GeoAssetType[] = [
      "technical_fix",
      "blog_guide",
      "existing_page_enhancement",
    ];

    expect([...shuffled].sort(compareGeoAssetTypes)).toEqual([
      "existing_page_enhancement",
      "blog_guide",
      "technical_fix",
    ]);
  });

  it("dedupes and canonicalizes for the hash projection", () => {
    expect(
      canonicalGeoAssetTypes([
        "comparison_page",
        "blog_guide",
        "comparison_page",
      ]),
    ).toEqual(["blog_guide", "comparison_page"]);
  });

  /** Two clients that listed the same asset types differently must hash alike. */
  it("produces one canonical form for any input order", () => {
    const a = canonicalGeoAssetTypes([
      "public_tool",
      "pricing_page",
      "blog_guide",
    ]);
    const b = canonicalGeoAssetTypes([
      "blog_guide",
      "public_tool",
      "pricing_page",
    ]);

    expect(a).toEqual(b);
  });
});
