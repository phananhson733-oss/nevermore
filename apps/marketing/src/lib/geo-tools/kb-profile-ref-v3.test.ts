import { describe, expect, it } from "vitest";

import {
  emptyMarketingWebsiteProfile,
  type MarketingWebsiteProfileV1,
  type WebsiteProfileReferenceV1,
} from "../account-websites/contracts.ts";
import { geoProfileSubset } from "./kb-profile-subset.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { buildGeoProfileRefV3 } from "./kb-profile-ref-v3.ts";

const REFERENCE: WebsiteProfileReferenceV1 = {
  schemaVersion: "website-profile-reference.v1",
  websiteId: "11111111-1111-8111-8111-111111111114",
  snapshotId: "11111111-1111-8111-8111-111111111115",
  snapshotRevision: 3,
  profileSchemaVersion: "marketing-website-profile.v1",
  profileHash: "a".repeat(64),
};

function profile(overrides: Partial<MarketingWebsiteProfileV1> = {}): MarketingWebsiteProfileV1 {
  return {
    ...emptyMarketingWebsiteProfile(),
    productName: "AstrologyWiki",
    oneLinePositioning: "Charts for astrologers.",
    coreFeatures: ["birth charts"],
    categories: ["astrology software"],
    country: "US",
    locale: "en",
    ...overrides,
  };
}

function built(overrides: Partial<MarketingWebsiteProfileV1> = {}) {
  const result = buildGeoProfileRefV3(REFERENCE, profile(overrides));
  if (result.kind !== "ok") throw new Error(`expected a usable Profile, got ${result.fields.join(",")}`);
  return result.profileRef;
}

describe("buildGeoProfileRefV3", () => {
  it("names the confirmed revision it came from, with the revision as a string", () => {
    const profileRef = built();

    expect(profileRef.websiteId).toBe(REFERENCE.websiteId);
    expect(profileRef.snapshotId).toBe(REFERENCE.snapshotId);
    expect(profileRef.profileHash).toBe(REFERENCE.profileHash);
    // A number here could not be hashed: the v3 payload's hash domain has no
    // number type at all.
    expect(profileRef.snapshotRevision).toBe("3");
  });

  it("carries the 13 fields GEO reads and none of the other 15", () => {
    const profileRef = built({ businessModel: "freemium", jtbd: "understand my chart" });

    expect(profileRef.subset.productName).toBe("AstrologyWiki");
    expect(profileRef.subset.categories).toEqual(["astrology software"]);
    expect(Object.keys(profileRef.subset)).not.toContain("businessModel");
    expect(Object.keys(profileRef.subset)).not.toContain("jtbd");
    // The 13 fields plus fieldProvenance, and nothing else.
    expect(Object.keys(profileRef.subset).sort()).toEqual(
      [...Object.keys(geoProfileSubset(profile()))].sort(),
    );
  });

  it("digests the subset it stores, not a differently-shaped projection of the same Profile", () => {
    const profileRef = built({
      fieldProvenance: [
        {
          path: "/productName",
          derivation: "observed",
          confidence: "high",
          source: "public_page",
          limitation: null,
          observedAt: "2026-09-01T00:00:00.000Z",
          evidenceUrls: ["https://example.com/a", "https://example.com/b"],
        },
      ],
    });

    // The stored bytes are what the hash names. Hashing `geoProfileSubset()`'s
    // output instead would name bytes nothing stores, and no reader could ever
    // check it.
    expect(profileRef.subsetHash).toBe(geoV2Digest(profileRef.subset));
    expect(profileRef.subsetHash).not.toBe(
      geoV2Digest(geoProfileSubset(profile({
        fieldProvenance: [
          {
            path: "/productName",
            derivation: "observed",
            confidence: "high",
            source: "public_page",
            limitation: null,
            observedAt: "2026-09-01T00:00:00.000Z",
            evidenceUrls: ["https://example.com/a", "https://example.com/b"],
          },
        ],
      }))),
    );
  });

  it("projects provenance onto the four fields v3 stores, keeping the first evidence URL", () => {
    const profileRef = built({
      fieldProvenance: [
        {
          path: "/productName",
          derivation: "observed",
          confidence: "high",
          source: "public_page",
          limitation: "sampled",
          observedAt: "2026-09-01T00:00:00.000Z",
          evidenceUrls: ["https://example.com/a", "https://example.com/b"],
        },
        // A path v3 does not report; `geoProfileSubset` drops it.
        {
          path: "/jtbd",
          derivation: "inferred",
          confidence: "low",
          source: "local_inference",
          limitation: null,
          observedAt: null,
          evidenceUrls: [],
        },
      ],
    });

    expect(profileRef.subset.fieldProvenance).toEqual([
      {
        path: "/productName",
        derivation: "observed",
        observedAt: "2026-09-01T00:00:00.000Z",
        evidenceUrl: "https://example.com/a",
      },
    ]);
  });

  it("moves its digest when a carried field changes and not when a dropped one does", () => {
    const before = built({ coreFeatures: ["birth charts"] }).subsetHash;

    expect(built({ coreFeatures: ["something else"] }).subsetHash).not.toBe(before);
    expect(built({ coreFeatures: ["birth charts"], businessModel: "changed" }).subsetHash).toBe(before);
  });

  it("refuses a Profile field the reference cannot hold, and names it", () => {
    // Both schemas bound `productName` at 160 UTF-16 code units today, so this
    // is the projection refusing a value its own contract cannot hold rather
    // than a gap between the two. It is written as a refusal and not as a trim
    // because a cut name is a different name under a hash claiming to be this
    // Profile's -- and because the day the Profile is widened, this is what
    // fails instead of silently storing the cut.
    const result = buildGeoProfileRefV3(REFERENCE, profile({ productName: "x".repeat(161) }));

    expect(result.kind).toBe("unusable");
    if (result.kind !== "unusable") return;
    expect(result.fields).toContain("/subset/productName");
    // The control. Without it this case could be refused for anything else the
    // fixture happens to carry, and the assertion above would not be about
    // length at all.
    expect(buildGeoProfileRefV3(REFERENCE, profile({ productName: "x".repeat(160) })).kind).toBe("ok");
  });

  it("refuses characters the Profile's own schema admits and this one cannot store", () => {
    // The place the two schemas really differ. `boundedText` is a bare
    // `.max()`, so a lone surrogate satisfies it; `geoPlainString` refuses one,
    // because it has no `jsonb::text` representation at all -- a subset
    // carrying it would be hashed here and then refused, or mangled, on the way
    // into the column the hash is supposed to describe.
    const result = buildGeoProfileRefV3(REFERENCE, profile({ oneLinePositioning: "Charts \ud800 for astrologers." }));

    expect(result.kind).toBe("unusable");
    if (result.kind !== "unusable") return;
    expect(result.fields).toContain("/subset/oneLinePositioning");
    // The control: the same sentence with a whole character instead of half of
    // one is accepted, so what was refused is the surrogate and not the field.
    expect(
      buildGeoProfileRefV3(REFERENCE, profile({ oneLinePositioning: "Charts \ud83d\udd2e for astrologers." })).kind,
    ).toBe("ok");
  });

  it("refuses a reference whose revision is not a positive integer", () => {
    const result = buildGeoProfileRefV3({ ...REFERENCE, snapshotRevision: 0 }, profile());

    expect(result.kind).toBe("unusable");
    if (result.kind !== "unusable") return;
    expect(result.fields).toContain("/snapshotRevision");
  });
});
