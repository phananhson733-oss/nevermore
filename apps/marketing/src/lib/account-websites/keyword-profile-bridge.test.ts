// @input  -- one exact confirmed Marketing website snapshot
// @output -- bounded detached or pinned keyword seed projections
// @pos    -- contract tests for the website-profile to Keyword Map boundary

import { describe, expect, it } from "vitest";

import {
  MARKETING_WEBSITE_PROFILE_VERSION,
  WEBSITE_PROFILE_REFERENCE_VERSION,
  emptyMarketingWebsiteProfile,
  profileSha256,
  type MarketingWebsiteProfileV1,
  type WebsiteDetails,
  type WebsiteProfileReferenceV1,
} from "./contracts.ts";
import {
  importWebsiteProfileForKeywords,
  mergeKeywordProfileSeeds,
  parseAcceptedKeywordProfileReference,
  projectKeywordProfileSeeds,
  referenceWebsiteProfileForKeywords,
} from "./keyword-profile-bridge.ts";

const WEBSITE_ID = "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6";
const SNAPSHOT_ID = "a53f4ddb-7cd6-42da-af53-88cc68b41987";
const NOW = "2026-08-28T00:00:00.000Z";

function profile(
  overrides: Partial<MarketingWebsiteProfileV1> = {},
): MarketingWebsiteProfileV1 {
  return {
    ...emptyMarketingWebsiteProfile(),
    productName: "Acme",
    oneLinePositioning: "Revenue operations for clinics",
    valueProposition: "Find and fix revenue leakage",
    primaryIcp: "Clinic revenue leaders",
    country: "GB",
    locale: "en-GB",
    ...overrides,
  };
}

async function details(
  savedProfile = profile(),
): Promise<WebsiteDetails> {
  const hash = await profileSha256(savedProfile);
  return {
    websiteId: WEBSITE_ID,
    origin: "https://acme.example",
    submittedUrl: "https://acme.example/",
    host: "acme.example",
    canonicalSiteKey: "acme.example",
    displayName: "Acme",
    isPrimary: true,
    profileState: "confirmed",
    confirmedSnapshotId: SNAPSHOT_ID,
    confirmedSnapshotRevision: 4,
    confirmedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    draft: {
      draftVersion: 5,
      updatedAt: NOW,
      profileHash: hash,
      profile: savedProfile,
    },
    currentConfirmedSnapshot: {
      schemaVersion: WEBSITE_PROFILE_REFERENCE_VERSION,
      websiteId: WEBSITE_ID,
      snapshotId: SNAPSHOT_ID,
      snapshotRevision: 4,
      profileSchemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
      profileHash: hash,
      confirmedAt: NOW,
      profile: savedProfile,
    },
  };
}

describe("projectKeywordProfileSeeds", () => {
  it("projects at most six normalized seeds in the approved source order", () => {
    const projected = projectKeywordProfileSeeds(
      profile({
        categories: ["  Revenue\tOperations  ", "revenue operations"],
        coreFeatures: ["Claim automation", "bad, split"],
        useCases: ["Recover denied claims"],
        icpInterests: ["Faster cash flow", "x".repeat(81)],
        primaryIcp: "Clinic finance teams",
        jtbd: "Reduce days in accounts receivable",
      }),
    );

    expect(projected).toEqual([
      "Revenue Operations",
      "Claim automation",
      "Recover denied claims",
      "Faster cash flow",
      "Clinic finance teams",
      "Reduce days in accounts receivable",
    ]);
  });

  it("omits over-bound and comma-bearing text without truncating it", () => {
    const long = "a".repeat(81);
    expect(
      projectKeywordProfileSeeds(
        profile({
          categories: [long, "valid category"],
          coreFeatures: ["two, ideas"],
          useCases: [],
          icpInterests: [],
          primaryIcp: long,
          jtbd: "one, two",
        }),
      ),
    ).toEqual(["valid category"]);
  });

  it("merges pinned seeds first and deduplicates the visitor overlay under ten", () => {
    expect(
      mergeKeywordProfileSeeds(
        ["Revenue operations", "Claim automation"],
        [" claim   automation ", "Clinic scheduling", "REVENUE OPERATIONS"],
      ),
    ).toEqual([
      "Revenue operations",
      "Claim automation",
      "Clinic scheduling",
    ]);
  });
});

describe("keyword website profile selection", () => {
  it("builds a detached editable import with no reference", async () => {
    const imported = await importWebsiteProfileForKeywords(await details());

    expect(imported).toMatchObject({
      kind: "import",
      websiteOrigin: "https://acme.example",
      canonicalSiteKey: "acme.example",
      country: "GB",
      locale: "en-GB",
      reference: null,
      editableSeeds: ["Clinic revenue leaders"],
    });
  });

  it("builds an exact pinned reference only after hash and website checks", async () => {
    const referenced = await referenceWebsiteProfileForKeywords(await details());

    expect(referenced).toMatchObject({
      kind: "reference",
      websiteOrigin: "https://acme.example",
      canonicalSiteKey: "acme.example",
      country: "GB",
      locale: "en-GB",
      pinnedSeeds: ["Clinic revenue leaders"],
      reference: {
        schemaVersion: WEBSITE_PROFILE_REFERENCE_VERSION,
        websiteId: WEBSITE_ID,
        snapshotId: SNAPSHOT_ID,
        snapshotRevision: 4,
        profileSchemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
      },
    });
  });

  it("rejects a confirmed detail whose canonical website identity is inconsistent", async () => {
    const website = await details();
    await expect(
      importWebsiteProfileForKeywords({
        ...website,
        canonicalSiteKey: "other.example",
      }),
    ).rejects.toThrow();
  });
});

describe("parseAcceptedKeywordProfileReference", () => {
  async function reference(): Promise<WebsiteProfileReferenceV1> {
    const snapshot = (await details()).currentConfirmedSnapshot;
    if (snapshot === null) throw new Error("fixture must be confirmed");
    return {
      schemaVersion: snapshot.schemaVersion,
      websiteId: snapshot.websiteId,
      snapshotId: snapshot.snapshotId,
      snapshotRevision: snapshot.snapshotRevision,
      profileSchemaVersion: snapshot.profileSchemaVersion,
      profileHash: snapshot.profileHash,
    };
  }

  it("accepts only the exact reference the client requested", async () => {
    const expected = await reference();
    expect(parseAcceptedKeywordProfileReference(expected, expected)).toEqual(
      expected,
    );
    expect(() =>
      parseAcceptedKeywordProfileReference(
        { ...expected, snapshotRevision: expected.snapshotRevision + 1 },
        expected,
      ),
    ).toThrow();
  });

  it("rejects extra fields and any reference on a detached request", async () => {
    const expected = await reference();
    expect(() =>
      parseAcceptedKeywordProfileReference(
        { ...expected, profile: "must not cross this boundary" },
        expected,
      ),
    ).toThrow();
    expect(() =>
      parseAcceptedKeywordProfileReference(expected, null),
    ).toThrow();
    expect(parseAcceptedKeywordProfileReference(undefined, null)).toBeNull();
  });
});
