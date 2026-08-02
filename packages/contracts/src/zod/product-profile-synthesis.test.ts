import { describe, expect, it } from "vitest";
import {
  MAX_PRODUCT_PROFILE_SYNTHESIS_PAGES,
  PRODUCT_PROFILE_LEGACY_SELECTION_POLICY_VERSION,
  PRODUCT_PROFILE_SELECTION_POLICY_VERSION,
  PRODUCT_PROFILE_SYNTHESIS_LEGACY_INPUT_SCHEMA_VERSION,
  PRODUCT_PROFILE_SYNTHESIS_INPUT_SCHEMA_VERSION,
  PRODUCT_PROFILE_SYNTHESIS_VERSION,
  ProductProfileSynthesisInputManifest,
} from "./product-profile-synthesis.ts";

const ids = {
  project: "10000000-0000-4000-8000-000000000001",
  site: "10000000-0000-4000-8000-000000000002",
  baseProfile: "10000000-0000-4000-8000-000000000003",
  crawlSnapshot: "10000000-0000-4000-8000-000000000004",
  collectionRun: "10000000-0000-4000-8000-000000000005",
  sourceConnection: "10000000-0000-4000-8000-000000000006",
  otherSnapshot: "10000000-0000-4000-8000-000000000007",
} as const;

const SOURCE_PAGE_URL = "https://relayops.com/customer-onboarding/";
const CAPTURED_AT = "2026-07-22T08:00:00Z";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

function uuidFor(namespace: number, index: number): string {
  return `20000000-0000-4${namespace.toString().padStart(3, "0")}-8000-${index
    .toString()
    .padStart(12, "0")}`;
}

function page(index: number) {
  const normalizedUrl =
    index === 0
      ? SOURCE_PAGE_URL
      : `https://relayops.com/resources/page-${index}/`;
  return {
    pageSnapshotId: uuidFor(1, index + 1),
    sitePageId: uuidFor(2, index + 1),
    dataSnapshotId: ids.crawlSnapshot,
    normalizedUrl,
    normalizedUrlHash: index % 2 === 0 ? SHA_A : SHA_B,
    contentHash: index % 2 === 0 ? SHA_B : SHA_C,
    capturedAt: CAPTURED_AT,
  };
}

function manifest(pageCount = 2) {
  return {
    schemaVersion: PRODUCT_PROFILE_SYNTHESIS_INPUT_SCHEMA_VERSION,
    selectionPolicyVersion: PRODUCT_PROFILE_SELECTION_POLICY_VERSION,
    projectId: ids.project,
    siteId: ids.site,
    sourcePageUrl: SOURCE_PAGE_URL,
    outputLocale: "zh-CN",
    competitorDiscovery: null,
    baseProfile: {
      id: ids.baseProfile,
      version: 3,
      contentHash: SHA_A,
      status: "draft",
    },
    crawlSnapshot: {
      id: ids.crawlSnapshot,
      collectionRunId: ids.collectionRun,
      sourceConnectionId: ids.sourceConnection,
      provider: "crawl",
      datasetKey: "crawl.site_graph.v1",
      schemaVersion: "crawl.site-graph.0.3.0",
      methodVersion: "crawl.site_graph.v2",
      capturedAt: CAPTURED_AT,
      checksum: SHA_C,
      availability: "available",
      rowCount: pageCount,
      limitation: "Static HTML crawl; JavaScript was not executed.",
    },
    pages: Array.from({ length: pageCount }, (_, index) => page(index)),
  } as const;
}

describe("ProductProfileSynthesisInputManifest", () => {
  it("pins all public protocol versions and accepts an exact frozen manifest", () => {
    expect(PRODUCT_PROFILE_SYNTHESIS_INPUT_SCHEMA_VERSION).toBe(
      "product-profile-synthesis-input.0.3.2",
    );
    expect(PRODUCT_PROFILE_SELECTION_POLICY_VERSION).toBe(
      "product-profile-page-selection.0.3.1",
    );
    expect(PRODUCT_PROFILE_SYNTHESIS_VERSION).toBe(
      "product-profile-synthesis.0.3.0",
    );
    expect(MAX_PRODUCT_PROFILE_SYNTHESIS_PAGES).toBe(12);
    expect(ProductProfileSynthesisInputManifest.parse(manifest())).toEqual(
      manifest(),
    );
  });

  it("requires a frozen BCP-47 output locale", () => {
    const valid = manifest();
    const { outputLocale: _outputLocale, ...missing } = valid;

    expect(
      ProductProfileSynthesisInputManifest.safeParse(missing).success,
    ).toBe(false);
    expect(
      ProductProfileSynthesisInputManifest.safeParse({
        ...valid,
        outputLocale: "not_a_locale",
      }).success,
    ).toBe(false);
  });

  it("continues to parse frozen legacy manifests without adding locale data", () => {
    const current = manifest();
    const {
      outputLocale: _outputLocale,
      competitorDiscovery: _competitorDiscovery,
      schemaVersion: _schemaVersion,
      ...shared
    } = current;
    const legacy = {
      ...shared,
      schemaVersion: PRODUCT_PROFILE_SYNTHESIS_LEGACY_INPUT_SCHEMA_VERSION,
      selectionPolicyVersion:
        PRODUCT_PROFILE_LEGACY_SELECTION_POLICY_VERSION,
    } as const;

    expect(ProductProfileSynthesisInputManifest.parse(legacy)).toEqual(legacy);
    expect(
      ProductProfileSynthesisInputManifest.safeParse({
        ...legacy,
        outputLocale: "en",
      }).success,
    ).toBe(false);
  });

  it("freezes only a draft base profile and rejects a confirmed profile", () => {
    const valid = manifest();

    expect(
      ProductProfileSynthesisInputManifest.safeParse({
        ...valid,
        baseProfile: { ...valid.baseProfile, status: "complete" },
      }).success,
    ).toBe(false);
  });

  it("is strict at every level and rejects extracts, raw keys, and storage keys", () => {
    const valid = manifest();
    const invalidValues = [
      { ...valid, invented: true },
      {
        ...valid,
        baseProfile: { ...valid.baseProfile, invented: true },
      },
      {
        ...valid,
        crawlSnapshot: { ...valid.crawlSnapshot, rawObjectKey: "raw/crawl.json" },
      },
      {
        ...valid,
        pages: [
          { ...valid.pages[0], canonicalExtract: { title: "Not frozen here" } },
          valid.pages[1],
        ],
      },
      {
        ...valid,
        pages: [
          { ...valid.pages[0], storageKey: "snapshots/page.json" },
          valid.pages[1],
        ],
      },
    ];

    for (const invalid of invalidValues) {
      expect(ProductProfileSynthesisInputManifest.safeParse(invalid).success).toBe(
        false,
      );
    }
  });

  it("requires between one and twelve selected pages", () => {
    expect(
      ProductProfileSynthesisInputManifest.safeParse(manifest(0)).success,
    ).toBe(false);
    expect(
      ProductProfileSynthesisInputManifest.safeParse(
        manifest(MAX_PRODUCT_PROFILE_SYNTHESIS_PAGES),
      ).success,
    ).toBe(true);
    expect(
      ProductProfileSynthesisInputManifest.safeParse(
        manifest(MAX_PRODUCT_PROFILE_SYNTHESIS_PAGES + 1),
      ).success,
    ).toBe(false);
  });

  it("requires unique page snapshot, SitePage, and normalized URL identities", () => {
    const valid = manifest(3);
    for (const pages of [
      [
        valid.pages[0],
        valid.pages[1],
        {
          ...valid.pages[2],
          pageSnapshotId: valid.pages[1]!.pageSnapshotId,
        },
      ],
      [
        valid.pages[0],
        valid.pages[1],
        { ...valid.pages[2], sitePageId: valid.pages[1]!.sitePageId },
      ],
      [
        valid.pages[0],
        valid.pages[1],
        { ...valid.pages[2], normalizedUrl: valid.pages[1]!.normalizedUrl },
      ],
    ]) {
      expect(
        ProductProfileSynthesisInputManifest.safeParse({ ...valid, pages })
          .success,
      ).toBe(false);
    }
  });

  it("requires the exact source page first and exactly once", () => {
    const valid = manifest(3);
    const sourceSecond = [valid.pages[1], valid.pages[0], valid.pages[2]];
    const sourceMissing = [
      { ...valid.pages[0], normalizedUrl: `${SOURCE_PAGE_URL}?variant=missing` },
      valid.pages[1],
      valid.pages[2],
    ];
    const sourceRepeated = [
      valid.pages[0],
      { ...valid.pages[1], normalizedUrl: SOURCE_PAGE_URL },
      valid.pages[2],
    ];

    for (const pages of [sourceSecond, sourceMissing, sourceRepeated]) {
      expect(
        ProductProfileSynthesisInputManifest.safeParse({ ...valid, pages })
          .success,
      ).toBe(false);
    }
  });

  it("binds every selected page to the one frozen Crawl DataSnapshot", () => {
    const valid = manifest();
    expect(
      ProductProfileSynthesisInputManifest.safeParse({
        ...valid,
        pages: [
          valid.pages[0],
          { ...valid.pages[1], dataSnapshotId: ids.otherSnapshot },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts only usable Crawl snapshot availability with a positive row count", () => {
    const valid = manifest();
    expect(
      ProductProfileSynthesisInputManifest.safeParse({
        ...valid,
        crawlSnapshot: {
          ...valid.crawlSnapshot,
          sourceConnectionId: null,
          availability: "partial",
        },
      }).success,
    ).toBe(true);

    for (const crawlSnapshot of [
      { ...valid.crawlSnapshot, availability: "unavailable" },
      { ...valid.crawlSnapshot, rowCount: 0 },
    ]) {
      expect(
        ProductProfileSynthesisInputManifest.safeParse({
          ...valid,
          crawlSnapshot,
        }).success,
      ).toBe(false);
    }
  });

  it("requires lowercase 64-character sha256 values for every frozen hash", () => {
    const valid = manifest();
    const invalidValues = [
      {
        ...valid,
        baseProfile: { ...valid.baseProfile, contentHash: "a".repeat(63) },
      },
      {
        ...valid,
        crawlSnapshot: { ...valid.crawlSnapshot, checksum: "A".repeat(64) },
      },
      {
        ...valid,
        pages: [
          { ...valid.pages[0], normalizedUrlHash: "g".repeat(64) },
          valid.pages[1],
        ],
      },
      {
        ...valid,
        pages: [
          { ...valid.pages[0], contentHash: `sha256:${SHA_A}` },
          valid.pages[1],
        ],
      },
    ];

    for (const invalid of invalidValues) {
      expect(ProductProfileSynthesisInputManifest.safeParse(invalid).success).toBe(
        false,
      );
    }
  });

  it("rejects invalid base versions, status, timestamps, versions, and limitations", () => {
    const valid = manifest();
    const invalidValues = [
      { ...valid, baseProfile: { ...valid.baseProfile, version: 0 } },
      { ...valid, baseProfile: { ...valid.baseProfile, status: "confirmed" } },
      {
        ...valid,
        crawlSnapshot: { ...valid.crawlSnapshot, capturedAt: "2026-07-22" },
      },
      {
        ...valid,
        crawlSnapshot: { ...valid.crawlSnapshot, schemaVersion: "" },
      },
      {
        ...valid,
        crawlSnapshot: { ...valid.crawlSnapshot, methodVersion: "x".repeat(201) },
      },
      {
        ...valid,
        crawlSnapshot: { ...valid.crawlSnapshot, limitation: "   " },
      },
      {
        ...valid,
        pages: [
          { ...valid.pages[0], capturedAt: "2026-07-22T08:00:00+08:00" },
          valid.pages[1],
        ],
      },
    ];

    for (const invalid of invalidValues) {
      expect(ProductProfileSynthesisInputManifest.safeParse(invalid).success).toBe(
        false,
      );
    }
  });
});
