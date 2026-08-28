// @input  -- exact confirmed website snapshots and the GEO target selected by the visitor
// @output -- proof only a same-site, hash-valid snapshot becomes a local GEO proposal
// @pos    -- focused tests for the website-profile to GEO context boundary

import { describe, expect, it } from "vitest";

import {
  MARKETING_WEBSITE_PROFILE_VERSION,
  WEBSITE_PROFILE_REFERENCE_VERSION,
  emptyMarketingWebsiteProfile,
  profileSha256,
  type MarketingWebsiteProfileV1,
  type WebsiteDetails,
} from "./contracts.ts";
import {
  projectWebsiteProfileHiddenContext,
  referenceWebsiteProfileForGeo,
} from "./geo-context-bridge.ts";

const WEBSITE_ID = "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6";
const SNAPSHOT_ID = "a53f4ddb-7cd6-42da-af53-88cc68b41987";
const NOW = "2026-08-28T00:00:00.000Z";

function profile(): MarketingWebsiteProfileV1 {
  return {
    ...emptyMarketingWebsiteProfile(),
    productName: "Acme Analytics",
    categories: ["AI visibility tracking", "SEO reporting"],
    primaryIcp: "Growth teams",
    buyer: "Marketing leaders",
    user: "Growth and content leads",
    jtbd: "Know whether assistants cite the site when buyers ask.",
    useCases: ["Track assistant citations", "Compare against rivals"],
    outcomes: ["Appear in assistant answers"],
    barriers: ["No visibility into assistant answers"],
    directCompetitors: ["Profound", "Peec AI"],
    indirectAlternatives: ["Manual spot checks"],
    country: "US",
    locale: "en-US",
  };
}

async function details(
  overrides: {
    readonly host?: string;
    readonly profile?: MarketingWebsiteProfileV1;
    readonly profileHash?: string;
    readonly confirmed?: boolean;
  } = {},
): Promise<WebsiteDetails> {
  const savedProfile = overrides.profile ?? profile();
  const hash = overrides.profileHash ?? (await profileSha256(savedProfile));
  const host = overrides.host ?? "acme.test";
  const confirmed = overrides.confirmed ?? true;
  return {
    websiteId: WEBSITE_ID,
    origin: `https://${host}`,
    submittedUrl: `https://${host}/`,
    host,
    canonicalSiteKey: host,
    displayName: "Acme",
    isPrimary: true,
    profileState: confirmed ? "confirmed" : "draft",
    confirmedSnapshotId: confirmed ? SNAPSHOT_ID : null,
    confirmedSnapshotRevision: confirmed ? 3 : null,
    confirmedAt: confirmed ? NOW : null,
    createdAt: NOW,
    updatedAt: NOW,
    draft: {
      draftVersion: 4,
      updatedAt: NOW,
      profileHash: hash,
      profile: savedProfile,
    },
    currentConfirmedSnapshot: confirmed
      ? {
          schemaVersion: WEBSITE_PROFILE_REFERENCE_VERSION,
          websiteId: WEBSITE_ID,
          snapshotId: SNAPSHOT_ID,
          snapshotRevision: 3,
          profileSchemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
          profileHash: hash,
          confirmedAt: NOW,
          profile: savedProfile,
        }
      : null,
  };
}

describe("referenceWebsiteProfileForGeo", () => {
  it("exposes one deterministic bounded hidden projection for client and server reuse", () => {
    const projected = projectWebsiteProfileHiddenContext(profile());

    expect(projected).toEqual({
      user: "Growth and content leads",
      useCases: ["Track assistant citations", "Compare against rivals"],
      outcomes: ["Appear in assistant answers"],
      barriers: ["No visibility into assistant answers"],
      indirectAlternatives: ["Manual spot checks"],
      sourceProfileVersion: MARKETING_WEBSITE_PROFILE_VERSION,
      sourceSummary: [
        {
          field: "user",
          source: "saved_website_profile",
          limitationCode: "pinned_snapshot",
        },
        {
          field: "use_cases",
          source: "saved_website_profile",
          limitationCode: "pinned_snapshot",
        },
        {
          field: "outcomes",
          source: "saved_website_profile",
          limitationCode: "pinned_snapshot",
        },
        {
          field: "barriers",
          source: "saved_website_profile",
          limitationCode: "pinned_snapshot",
        },
        {
          field: "indirect_alternatives",
          source: "saved_website_profile",
          limitationCode: "pinned_snapshot",
        },
      ],
    });
  });

  it("omits out-of-bounds hidden values instead of silently truncating their text", () => {
    const projected = projectWebsiteProfileHiddenContext({
      ...profile(),
      user: "u".repeat(301),
      useCases: [
        "kept",
        "x".repeat(121),
        "kept",
        ...Array.from({ length: 20 }, (_unused, index) => `use case ${index}`),
      ],
    });

    expect(projected.user).toBe("");
    expect(projected.useCases).toHaveLength(12);
    expect(projected.useCases[0]).toBe("kept");
    expect(projected.useCases).not.toContain("x".repeat(121));
    expect(projected.sourceSummary.some((entry) => entry.field === "user")).toBe(
      false,
    );
  });

  it("maps only reusable Product and ICP fields into unconfirmed GEO proposals", async () => {
    const projected = await referenceWebsiteProfileForGeo({
      targetUrl: "https://www.acme.test/pricing",
      website: await details(),
    });

    expect(projected).toMatchObject({
      targetUrl: "https://www.acme.test/pricing",
      productName: "Acme Analytics",
      category: "AI visibility tracking",
      categoryConfirmed: false,
      buyer: "Marketing leaders",
      user: "Growth and content leads",
      jtbd: "Know whether assistants cite the site when buyers ask.",
      useCases: ["Track assistant citations", "Compare against rivals"],
      outcomes: ["Appear in assistant answers"],
      barriers: ["No visibility into assistant answers"],
      directCompetitors: ["Profound", "Peec AI"],
      indirectAlternatives: ["Manual spot checks"],
      marketCode: "US",
      sourceProfileVersion: MARKETING_WEBSITE_PROFILE_VERSION,
      websiteProfileReference: {
        schemaVersion: WEBSITE_PROFILE_REFERENCE_VERSION,
        websiteId: WEBSITE_ID,
        snapshotId: SNAPSHOT_ID,
        snapshotRevision: 3,
        profileSchemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
      },
    });
    expect(projected.brandAliases.length).toBeGreaterThan(0);
    expect(
      projected.brandAliases.every((candidate) => !candidate.confirmed),
    ).toBe(true);
    expect(projected.sourceSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "product_name",
          source: "saved_website_profile",
        }),
        expect.objectContaining({
          field: "category",
          source: "saved_website_profile_candidate",
        }),
        expect.objectContaining({
          field: "user",
          source: "saved_website_profile",
        }),
        expect.objectContaining({
          field: "use_cases",
          source: "saved_website_profile",
        }),
        expect.objectContaining({
          field: "outcomes",
          source: "saved_website_profile",
        }),
        expect.objectContaining({
          field: "barriers",
          source: "saved_website_profile",
        }),
        expect.objectContaining({
          field: "indirect_alternatives",
          source: "saved_website_profile",
        }),
      ]),
    );
    expect(Object.keys(projected)).not.toContain("oneLinePositioning");
    expect(Object.keys(projected)).not.toContain("valueProposition");
    expect(Object.keys(projected)).not.toContain("coreFeatures");
  });

  it.each(["", "   "])(
    "falls back to the primary ICP when the buyer field is %j",
    async (buyer) => {
      const savedProfile = { ...profile(), buyer };

      await expect(
        referenceWebsiteProfileForGeo({
          targetUrl: "https://acme.test/",
          website: await details({ profile: savedProfile }),
        }),
      ).resolves.toMatchObject({ buyer: "Growth teams" });
    },
  );

  it("refuses a draft-only website", async () => {
    await expect(
      referenceWebsiteProfileForGeo({
        targetUrl: "https://acme.test/",
        website: await details({ confirmed: false }),
      }),
    ).rejects.toThrow(/confirmed/iu);
  });

  it("refuses a profile whose canonical SHA does not match the exact reference", async () => {
    await expect(
      referenceWebsiteProfileForGeo({
        targetUrl: "https://acme.test/",
        website: await details({ profileHash: "0".repeat(64) }),
      }),
    ).rejects.toThrow(/hash/iu);
  });

  it("refuses a confirmed profile from a different canonical host", async () => {
    await expect(
      referenceWebsiteProfileForGeo({
        targetUrl: "https://other.test/",
        website: await details(),
      }),
    ).rejects.toThrow(/host/iu);
  });

  it("fails closed on malformed website identity", async () => {
    const malformed = {
      ...(await details()),
      currentConfirmedSnapshot: {
        ...(await details()).currentConfirmedSnapshot!,
        websiteId: "4f13cb4c-e67a-4b87-adf8-e43360457d2d",
      },
    };

    await expect(
      referenceWebsiteProfileForGeo({
        targetUrl: "https://acme.test/",
        website: malformed,
      }),
    ).rejects.toThrow();
  });
});
