import { describe, expect, it } from "vitest";

import {
  canonicalProfileJson,
  emptyMarketingWebsiteProfile,
  isMarketingWebsiteProfileReady,
  MARKETING_WEBSITE_PROFILE_VERSION,
  normalizeAccountWebsiteUrl,
  normalizeNewAccountWebsiteUrl,
  parseMarketingWebsiteProfile,
  parseWebsiteDetails,
  parseWebsiteList,
  parseWebsiteProfileReference,
  parseWebsiteSummary,
  profileSha256,
  profileState,
  WEBSITE_PROFILE_REFERENCE_VERSION,
  type MarketingWebsiteProfileV1,
} from "./contracts.ts";

describe("normalizeAccountWebsiteUrl", () => {
  it("adds https and keeps the submitted page while deriving a site identity", () => {
    expect(
      normalizeAccountWebsiteUrl(" Example.com/pricing?utm_source=test#hero "),
    ).toEqual({
      submittedUrl: "https://example.com/pricing?utm_source=test",
      origin: "https://example.com",
      host: "example.com",
      canonicalSiteKey: "example.com",
    });
  });

  it("treats www and apex URLs as the same account website", () => {
    expect(
      normalizeAccountWebsiteUrl("https://www.Example.com.:443/path")
        ?.canonicalSiteKey,
    ).toBe("example.com");
    expect(
      normalizeAccountWebsiteUrl("https://example.com/other")
        ?.canonicalSiteKey,
    ).toBe("example.com");
  });

  it("removes both HTTP and HTTPS default ports", () => {
    expect(normalizeAccountWebsiteUrl("http://example.com:80/path")).toMatchObject({
      submittedUrl: "http://example.com/path",
      origin: "http://example.com",
    });
    expect(
      normalizeAccountWebsiteUrl("https://example.com:443/path"),
    ).toMatchObject({
      submittedUrl: "https://example.com/path",
      origin: "https://example.com",
    });
  });

  it("keeps meaningful subdomains distinct", () => {
    expect(
      normalizeAccountWebsiteUrl("https://docs.example.com/guide")
        ?.canonicalSiteKey,
    ).toBe("docs.example.com");
  });

  it("canonicalizes internationalized domains to ASCII", () => {
    expect(
      normalizeAccountWebsiteUrl("https://例え.テスト/商品")?.host,
    ).toBe("xn--r8jz45g.xn--zckzah");
  });

  it("drops only the fragment and default port from the submitted page URL", () => {
    expect(
      normalizeAccountWebsiteUrl("https://example.com:443/pricing?utm=x#hero"),
    ).toEqual({
      submittedUrl: "https://example.com/pricing?utm=x",
      origin: "https://example.com",
      host: "example.com",
      canonicalSiteKey: "example.com",
    });
  });

  it.each([
    "",
    "ftp://example.com",
    "https://user:secret@example.com",
    "http://localhost",
    "http://10.0.0.1",
    "http://192.168.1.1",
    "http://169.254.169.254/latest/meta-data",
    "http://192.0.2.1",
    "http://192.31.196.1",
    "http://192.52.193.1",
    "http://192.175.48.1",
    "http://198.51.100.2",
    "http://203.0.113.3",
    "http://[fd00::1]/",
    "http://[fec0::1]/",
    "http://[ff02::1]/",
    "http://[2001:db8::1]/",
    "http://[2620:4f:8000::1]/",
    `https://example.com/${"a".repeat(2_049)}`,
  ])("rejects an unsafe or unusable website URL: %s", (input) => {
    expect(normalizeAccountWebsiteUrl(input)).toBeNull();
  });
});

function completeProfile(): MarketingWebsiteProfileV1 {
  return {
    schemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
    productName: "GenGrowth",
    oneLinePositioning: "Evidence-led organic growth operations",
    valueProposition: "Turn search evidence into governed actions.",
    coreFeatures: ["SEO Agent", "Growth Map"],
    categories: ["SEO software"],
    businessModel: "SaaS",
    primaryCta: "Run an audit",
    trustSignals: ["Source-labelled evidence"],
    primaryIcp: "B2B growth teams with complex organic-search workflows",
    buyer: "Head of Growth",
    user: "SEO operator",
    triggerPain: "Audits do not become governed work",
    icpInterests: ["SEO", "GEO"],
    icpPain: "Fragmented tools and unverifiable recommendations",
    icpBehavior: "Reviews evidence before approving work",
    icpPositioning: "A governed growth operating layer",
    jtbd: "Prioritize and execute evidence-backed organic growth work",
    useCases: ["Website diagnosis"],
    outcomes: ["A reviewable action plan"],
    barriers: ["Incomplete source data"],
    qualificationSignals: ["Uses Search Console"],
    disqualifiers: ["Wants guaranteed rankings"],
    directCompetitors: ["example-competitor.com"],
    indirectAlternatives: ["Spreadsheets"],
    excludedAlternatives: [],
    firstOutcome: "See the highest-confidence next action",
    country: "US",
    locale: "en-US",
    fieldProvenance: [
      {
        path: "/productName",
        derivation: "declared",
        confidence: "high",
        source: "user_edit",
        limitation: null,
        observedAt: null,
        evidenceUrls: [],
      },
      {
        path: "/valueProposition",
        derivation: "inferred",
        confidence: "medium",
        source: "public_page",
        limitation: "Public positioning may omit sales context.",
        observedAt: "2026-08-27T08:00:00.000Z",
        evidenceUrls: ["https://gengrowth.ai/"],
      },
    ],
  };
}

describe("Marketing website profile contract", () => {
  it("creates an explicitly empty, unconfirmed reusable profile", () => {
    const profile = emptyMarketingWebsiteProfile();

    expect(profile.schemaVersion).toBe("marketing-website-profile.v1");
    expect(profile.productName).toBe("");
    expect(profile.coreFeatures).toEqual([]);
    expect(profile.fieldProvenance).toEqual([]);
    expect(isMarketingWebsiteProfileReady(profile)).toBe(false);
  });

  it("accepts a complete profile and identifies the confirmation gate", () => {
    const profile = parseMarketingWebsiteProfile(completeProfile());

    expect(profile).toEqual(completeProfile());
    expect(isMarketingWebsiteProfileReady(profile)).toBe(true);
  });

  it.each([
    ["productName"],
    ["oneLinePositioning"],
    ["valueProposition"],
    ["primaryIcp"],
    ["locale"],
  ] as const)("keeps a profile with no %s in draft state", (field) => {
    const profile = { ...completeProfile(), [field]: "" };

    expect(isMarketingWebsiteProfileReady(parseMarketingWebsiteProfile(profile))).toBe(
      false,
    );
  });

  it("rejects run-only fields instead of persisting them by accident", () => {
    expect(() =>
      parseMarketingWebsiteProfile({
        ...completeProfile(),
        agent: "seo",
        device: "desktop",
        pageType: "homepage",
        targetQuery: "seo agent",
        auditScope: "site-first",
      }),
    ).toThrow();
  });

  it("rejects duplicate provenance paths and unknown keys", () => {
    expect(() =>
      parseMarketingWebsiteProfile({
        ...completeProfile(),
        unexpected: true,
      }),
    ).toThrow();
    expect(() =>
      parseMarketingWebsiteProfile({
        ...completeProfile(),
        fieldProvenance: [
          completeProfile().fieldProvenance[0],
          {
            ...completeProfile().fieldProvenance[0],
            another: "key",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      parseMarketingWebsiteProfile({
        ...completeProfile(),
        fieldProvenance: [
          completeProfile().fieldProvenance[0],
          {
            ...completeProfile().fieldProvenance[0],
            confidence: "medium",
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects non-canonical locale and timestamp values", () => {
    expect(() =>
      parseMarketingWebsiteProfile({ ...completeProfile(), locale: "EN-us" }),
    ).toThrow();
    expect(() =>
      parseMarketingWebsiteProfile({
        ...completeProfile(),
        fieldProvenance: [
          {
            ...completeProfile().fieldProvenance[1],
            observedAt: "2026-08-27 08:00:00",
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects oversized strings and lists", () => {
    expect(() =>
      parseMarketingWebsiteProfile({
        ...completeProfile(),
        productName: "x".repeat(161),
      }),
    ).toThrow();
    expect(() =>
      parseMarketingWebsiteProfile({
        ...completeProfile(),
        coreFeatures: Array.from({ length: 33 }, (_, index) => `feature-${index}`),
      }),
    ).toThrow();
  });

  it("rejects private or malformed evidence URLs", () => {
    for (const evidenceUrl of [
      "http://localhost/private",
      "http://10.0.0.1/private",
      "http://192.168.1.1/private",
      "http://169.254.169.254/latest/meta-data",
      "http://192.0.2.1/private",
      "http://192.31.196.1/private",
      "http://192.52.193.1/private",
      "http://192.175.48.1/private",
      "http://198.51.100.2/private",
      "http://203.0.113.3/private",
      "http://[fd00::1]/private",
      "http://[fec0::1]/private",
      "http://[ff02::1]/private",
      "http://[2001:db8::1]/private",
      "http://[2620:4f:8000::1]/private",
    ]) {
      expect(() =>
        parseMarketingWebsiteProfile({
          ...completeProfile(),
          fieldProvenance: [
            {
              ...completeProfile().fieldProvenance[1],
              evidenceUrls: [evidenceUrl],
            },
          ],
        }),
      ).toThrow();
    }
  });

  it("serializes equivalent objects identically without reordering lists", () => {
    const profile = completeProfile();
    const reversedKeys = Object.fromEntries(
      Object.entries(profile).reverse(),
    ) as unknown as MarketingWebsiteProfileV1;

    expect(canonicalProfileJson(reversedKeys)).toBe(canonicalProfileJson(profile));
    expect(canonicalProfileJson(profile)).toContain(
      '"coreFeatures":["SEO Agent","Growth Map"]',
    );
  });

  it("hashes provenance as a path-keyed ledger while preserving content-list order", async () => {
    const profile = completeProfile();
    const reversedProvenance = {
      ...profile,
      fieldProvenance: [...profile.fieldProvenance].reverse(),
    };
    const reversedFeatures = {
      ...profile,
      coreFeatures: [...profile.coreFeatures].reverse(),
    };

    expect(await profileSha256(reversedProvenance)).toBe(
      await profileSha256(profile),
    );
    expect(await profileSha256(reversedFeatures)).not.toBe(
      await profileSha256(profile),
    );
  });

  it("rejects provenance that contradicts its source authority", () => {
    expect(() =>
      parseMarketingWebsiteProfile({
        ...completeProfile(),
        productName: "A claimed product",
        fieldProvenance: [
          {
            path: "/productName",
            derivation: "declared",
            confidence: "high",
            source: "not_available",
            limitation: null,
            observedAt: null,
            evidenceUrls: ["https://example.com/"],
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      parseMarketingWebsiteProfile({
        ...completeProfile(),
        fieldProvenance: [
          {
            path: "/productName",
            derivation: "missing",
            confidence: "unknown",
            source: "user_edit",
            limitation: "Unknown",
            observedAt: "2026-08-27T08:00:00.000Z",
            evidenceUrls: ["https://example.com/"],
          },
        ],
      }),
    ).toThrow();
  });

  it("allows not-available provenance only for an empty field", () => {
    expect(() =>
      parseMarketingWebsiteProfile({
        ...completeProfile(),
        buyer: "Still populated",
        fieldProvenance: [
          {
            path: "/buyer",
            derivation: "missing",
            confidence: "unknown",
            source: "not_available",
            limitation: "No buyer role was observed.",
            observedAt: "2026-08-27T08:00:00.000Z",
            evidenceUrls: [],
          },
        ],
      }),
    ).toThrow();
  });

  it("derives the four account-facing profile states from exact hashes", () => {
    expect(profileState(null, null)).toBe("not_generated");
    expect(profileState("a".repeat(64), null)).toBe("draft");
    expect(profileState("a".repeat(64), "a".repeat(64))).toBe("confirmed");
    expect(profileState("a".repeat(64), "b".repeat(64))).toBe(
      "unconfirmed_changes",
    );
  });
});

function websiteSummary() {
  return {
    websiteId: "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6",
    origin: "https://example.com",
    host: "example.com",
    canonicalSiteKey: "example.com",
    displayName: "Example",
    isPrimary: true,
    profileState: "confirmed" as const,
    confirmedSnapshotId: "a53f4ddb-7cd6-42da-af53-88cc68b41987",
    confirmedSnapshotRevision: 2,
    confirmedAt: "2026-08-27T08:00:00.000Z",
    createdAt: "2026-08-27T07:00:00.000Z",
    updatedAt: "2026-08-27T09:00:00.000Z",
  };
}

describe("account website read DTOs", () => {
  it("parses a strict summary and a list with exactly one primary website", () => {
    expect(parseWebsiteSummary(websiteSummary())).toEqual(websiteSummary());
    expect(
      parseWebsiteList([
        websiteSummary(),
        {
          ...websiteSummary(),
          websiteId: "fe621e26-c970-4614-a316-0fcefc3ae30d",
          origin: "https://docs.example.com",
          host: "docs.example.com",
          canonicalSiteKey: "docs.example.com",
          displayName: null,
          isPrimary: false,
          profileState: "not_generated",
          confirmedSnapshotId: null,
          confirmedSnapshotRevision: null,
          confirmedAt: null,
        },
      ]),
    ).toHaveLength(2);
  });

  it("rejects an ambiguous list or partial confirmed identity", () => {
    expect(() =>
      parseWebsiteList([
        websiteSummary(),
        {
          ...websiteSummary(),
          websiteId: "fe621e26-c970-4614-a316-0fcefc3ae30d",
        },
      ]),
    ).toThrow();
    expect(() =>
      parseWebsiteSummary({
        ...websiteSummary(),
        confirmedSnapshotId: null,
      }),
    ).toThrow();
    expect(() =>
      parseWebsiteSummary({
        ...websiteSummary(),
        origin: "https://other.example",
      }),
    ).toThrow();
  });

  it("parses detail only when draft and confirmed snapshot identities agree", async () => {
    const draftProfile = completeProfile();
    const confirmedProfile = {
      ...completeProfile(),
      productName: "Previously confirmed example",
    };
    const details = {
      ...websiteSummary(),
      submittedUrl: "https://www.example.com/pricing?utm_source=account",
      profileState: "unconfirmed_changes" as const,
      draft: {
        draftVersion: 4,
        updatedAt: "2026-08-27T09:00:00.000Z",
        profileHash: await profileSha256(draftProfile),
        profile: draftProfile,
      },
      currentConfirmedSnapshot: {
        schemaVersion: WEBSITE_PROFILE_REFERENCE_VERSION,
        websiteId: websiteSummary().websiteId,
        snapshotId: websiteSummary().confirmedSnapshotId,
        snapshotRevision: websiteSummary().confirmedSnapshotRevision,
        profileSchemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
        profileHash: await profileSha256(confirmedProfile),
        confirmedAt: websiteSummary().confirmedAt,
        profile: confirmedProfile,
      },
    };

    await expect(parseWebsiteDetails(details)).resolves.toEqual(details);
    await expect(
      parseWebsiteDetails({
        ...details,
        currentConfirmedSnapshot: {
          ...details.currentConfirmedSnapshot,
          websiteId: "fe621e26-c970-4614-a316-0fcefc3ae30d",
        },
      }),
    ).rejects.toThrow();
    await expect(
      parseWebsiteDetails({
        ...details,
        profileState: "draft",
        draft: null,
        confirmedSnapshotId: null,
        confirmedSnapshotRevision: null,
        confirmedAt: null,
        currentConfirmedSnapshot: null,
      }),
    ).rejects.toThrow();
    await expect(
      parseWebsiteDetails({
        ...details,
        profileState: "confirmed",
      }),
    ).rejects.toThrow();
  });

  it("rejects detail hashes that do not authenticate the embedded profiles", async () => {
    const profile = completeProfile();
    const realHash = await profileSha256(profile);
    const details = {
      ...websiteSummary(),
      submittedUrl: "https://example.com/",
      profileState: "confirmed" as const,
      draft: {
        draftVersion: 1,
        updatedAt: "2026-08-27T09:00:00.000Z",
        profileHash: realHash,
        profile: { ...profile, productName: "Tampered draft" },
      },
      currentConfirmedSnapshot: {
        schemaVersion: WEBSITE_PROFILE_REFERENCE_VERSION,
        websiteId: websiteSummary().websiteId,
        snapshotId: websiteSummary().confirmedSnapshotId,
        snapshotRevision: websiteSummary().confirmedSnapshotRevision,
        profileSchemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
        profileHash: realHash,
        confirmedAt: websiteSummary().confirmedAt,
        profile,
      },
    };

    await expect(parseWebsiteDetails(details)).rejects.toThrow(
      /profile hash/i,
    );
  });
});

describe("website profile reference contract", () => {
  it("accepts an exact immutable snapshot reference", () => {
    expect(
      parseWebsiteProfileReference({
        schemaVersion: WEBSITE_PROFILE_REFERENCE_VERSION,
        websiteId: "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6",
        snapshotId: "a53f4ddb-7cd6-42da-af53-88cc68b41987",
        snapshotRevision: 3,
        profileSchemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
        profileHash: "a".repeat(64),
      }),
    ).toEqual({
      schemaVersion: "website-profile-reference.v1",
      websiteId: "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6",
      snapshotId: "a53f4ddb-7cd6-42da-af53-88cc68b41987",
      snapshotRevision: 3,
      profileSchemaVersion: "marketing-website-profile.v1",
      profileHash: "a".repeat(64),
    });
  });

  it("rejects a mutable or ambiguous reference", () => {
    expect(() =>
      parseWebsiteProfileReference({
        schemaVersion: WEBSITE_PROFILE_REFERENCE_VERSION,
        websiteId: "not-a-uuid",
        snapshotId: "a53f4ddb-7cd6-42da-af53-88cc68b41987",
        snapshotRevision: 0,
        profileSchemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
        profileHash: "unknown",
        latest: true,
      }),
    ).toThrow();
  });
});

describe("normalizeNewAccountWebsiteUrl", () => {
  it("refuses a host with no registrable domain, which nothing could ever scan", () => {
    // The reported case: a site added as a bare label. It parses, it stores,
    // and then every scan fails with no reachable homepage.
    expect(normalizeAccountWebsiteUrl("dramashortstv")?.host).toBe("dramashortstv");
    expect(normalizeNewAccountWebsiteUrl("dramashortstv")).toBeNull();
    expect(normalizeNewAccountWebsiteUrl("https://dramashortstv")).toBeNull();
    expect(normalizeNewAccountWebsiteUrl("https://dramashortstv/shows")).toBeNull();
  });
  it("accepts the same site once it carries a domain", () => {
    expect(normalizeNewAccountWebsiteUrl("dramashortstv.com")?.host).toBe("dramashortstv.com");
    expect(normalizeNewAccountWebsiteUrl("https://www.dramashortstv.com/")?.canonicalSiteKey).toBe("dramashortstv.com");
  });
  it("keeps a public IPv6 literal, which has no dot but is a real address", () => {
    expect(normalizeNewAccountWebsiteUrl("https://[2606:4700::1111]/")?.host).toBe("[2606:4700::1111]");
    expect(normalizeNewAccountWebsiteUrl("https://[::1]/")).toBeNull();
  });
  it("still refuses everything the shared normalizer refuses", () => {
    for (const input of ["", "localhost", "http://127.0.0.1", "ftp://example.com", "not a url"]) {
      expect(normalizeNewAccountWebsiteUrl(input)).toBeNull();
    }
  });
});
