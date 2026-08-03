import { describe, expect, it } from "vitest";
import { contentHash, type DataSnapshotRow } from "@sf/db";
import {
  parseGovernanceProjectionV1,
  PROMPT_SET_VERSION,
  RULE_SET_VERSION,
} from "@sf/engine";
import {
  dataForSeoConnectionConfig,
  dataForSeoLimitation,
  dataForSeoSearchLandscapeScopeForSite,
  deriveDataForSeoSearchLandscapeSeeds,
  keywordLibraryContextForSite,
} from "./collection-context.ts";
import {
  buildAnalysisRefreshDiagnosticFrozenInput,
  growthAuditCapabilityManifestHash,
} from "./frozen-input.ts";
import { parseAnalysisRefreshRequestPayload } from "./payload.ts";

const IDS = {
  workspace: "00000000-0000-4000-8000-000000000001",
  project: "00000000-0000-4000-8000-000000000002",
  site: "00000000-0000-4000-8000-000000000003",
  icp: "00000000-0000-4000-8000-000000000004",
  crawl: "00000000-0000-4000-8000-000000000005",
  snapshotA: "00000000-0000-4000-8000-000000000011",
  snapshotB: "00000000-0000-4000-8000-000000000010",
} as const;

const PAYLOAD = {
  siteId: IDS.site,
  icpProfile: {
    id: IDS.icp,
    version: 7,
    contentHash: "a".repeat(64),
  },
  outputLocale: "en-US",
  sourceConnectionIds: {
    crawl: IDS.crawl,
    gsc: null,
    ga4: null,
  },
  dataForSeo: {
    enabled: true,
    maxKeywords: 100,
    maxCompetitors: 40,
  },
} as const;

describe("Analysis Refresh frozen helpers", () => {
  it("accepts only the strict, secret-free nested parent payload", () => {
    expect(parseAnalysisRefreshRequestPayload(PAYLOAD)).toEqual(PAYLOAD);
    expect(() =>
      parseAnalysisRefreshRequestPayload({
        ...PAYLOAD,
        sourceConnectionIds: {
          ...PAYLOAD.sourceConnectionIds,
          accessToken: "must-never-persist",
        },
      }),
    ).toThrow();
    expect(() =>
      parseAnalysisRefreshRequestPayload({
        ...PAYLOAD,
        outputLocale: "not_a_locale",
      }),
    ).toThrow();
    expect(() =>
      parseAnalysisRefreshRequestPayload({
        ...PAYLOAD,
        dataForSeo: {
          ...PAYLOAD.dataForSeo,
          maxCompetitors: 1_001,
        },
      }),
    ).toThrow();
  });

  it("uses canonical one-market/one-language context without inventing authority", () => {
    expect(
      keywordLibraryContextForSite({
        market_codes: ["us"],
        language_codes: ["en-us"],
      }),
    ).toEqual({
      basis: "project_context",
      marketCode: "US",
      languageTag: "en-US",
    });
    expect(
      keywordLibraryContextForSite({
        market_codes: ["US", "CA"],
        language_codes: ["en-US"],
      }),
    ).toBeNull();

    const scope = dataForSeoSearchLandscapeScopeForSite(
      {
        host: "www.example.test",
        market_codes: ["US"],
        language_codes: ["en-US"],
      },
      87,
      31,
    );
    expect(scope).toMatchObject({
      schemaVersion: "dataforseo.search-landscape-scope.v2",
      queryKind: "search_landscape",
      target: "example.test",
      marketCode: "US",
      providerLanguageCode: "en",
      rankedKeywords: {
        limit: 87,
        rankGroup: { minimum: 1, maximum: 100 },
      },
      competitorsDomain: {
        limit: 31,
        maxRankGroup: 100,
        excludeDomains: ["example.test"],
      },
      serpCompetitors: {
        limit: 31,
        fallbackWhenDomainOverlapEmpty: true,
        seeds: [],
      },
    });
    expect(scope?.location).toEqual({ kind: "code", code: 2840 });
    expect(dataForSeoConnectionConfig(scope!)).toEqual({
      target: "example.test",
      marketCode: "US",
      locationName: "United States",
      languageCode: "en",
      maxKeywords: 87,
      maxCompetitors: 31,
      maxSerpCompetitors: 31,
    });
    expect(dataForSeoLimitation(dataForSeoConnectionConfig(scope!))).toContain(
      "positions 1–100",
    );
    expect(dataForSeoLimitation(dataForSeoConnectionConfig(scope!))).toContain(
      "integer keyword-intersection count, not a percentage",
    );
    // A site declared in a language DataForSEO Labs does not serve for its
    // market must still be researched in a language it does serve. Sending the
    // declared tag produced task status 40501 and a permanent failure.
    const zhSiteScope = dataForSeoSearchLandscapeScopeForSite(
      {
        host: "www.example.test",
        market_codes: ["US"],
        language_codes: ["zh-CN"],
      },
      87,
      31,
    );
    expect(zhSiteScope?.providerLanguageCode).toBe("en");

    // A declared language the provider does serve there is honoured.
    expect(
      dataForSeoSearchLandscapeScopeForSite(
        {
          host: "www.example.test",
          market_codes: ["US"],
          language_codes: ["es-MX"],
        },
        87,
        31,
      )?.providerLanguageCode,
    ).toBe("es");

    // Labs serves 92 countries. The rest must be skipped, not enqueued.
    expect(
      dataForSeoSearchLandscapeScopeForSite(
        {
          host: "www.example.test",
          market_codes: ["VA"],
          language_codes: ["it-IT"],
        },
        87,
        31,
      ),
    ).toBeNull();

    expect(
      dataForSeoSearchLandscapeScopeForSite(
        {
          host: "www.example.test",
          market_codes: [],
          language_codes: ["en-US"],
        },
        87,
        31,
      ),
    ).toBeNull();
    expect(
      dataForSeoSearchLandscapeScopeForSite(
        {
          host: "www.example.test",
          market_codes: ["US", "CA"],
          language_codes: ["en-US"],
        },
        87,
        31,
      ),
    ).toBeNull();
    expect(
      dataForSeoSearchLandscapeScopeForSite(
        {
          host: "www.example.test",
          market_codes: ["US"],
          language_codes: ["en-US", "es-US"],
        },
        87,
        31,
      ),
    ).toBeNull();
  });

  it("orders GSC seeds by real demand and retains Crawler provenance without relabelling it", () => {
    const seeds = deriveDataForSeoSearchLandscapeSeeds({
      observations: [
        {
          id: "crawl-observation",
          provider: "crawl",
          metric_key: "crawl.page.v1",
          availability: "available",
          value_json: { title: "SEO Automation", h1: ["Growth Analytics"] },
        },
        {
          id: "gsc-observation",
          provider: "gsc",
          metric_key: "gsc.page.v1",
          availability: "available",
          value_json: {
            topQueries: [
              { query: "low demand", impressions: 10, clicks: 1 },
              { query: "high demand", impressions: 1000, clicks: 5 },
            ],
          },
        },
      ],
      productProfile: null,
    });

    expect(seeds).toEqual([
      {
        keyword: "high demand",
        sourceKind: "gsc_top_query",
        sourceRef: "observation:gsc-observation#/valueJson/topQueries/1/query",
      },
      {
        keyword: "low demand",
        sourceKind: "gsc_top_query",
        sourceRef: "observation:gsc-observation#/valueJson/topQueries/0/query",
      },
      {
        keyword: "Growth Analytics",
        sourceKind: "crawler_page_text",
        sourceRef: "observation:crawl-observation#/valueJson/h1/0",
      },
      {
        keyword: "SEO Automation",
        sourceKind: "crawler_page_text",
        sourceRef: "observation:crawl-observation#/valueJson/title",
      },
    ]);
  });

  it("freezes exact snapshots in canonical ID order with real rule, prompt, ICP, locale, and governance facts", () => {
    const governance = parseGovernanceProjectionV1({
      projectionVersion: "growth-governance.1.0.0",
      keywordClusters: [],
      competitors: [],
    });
    const first = snapshot(IDS.snapshotA, "gsc", {
      capturedAt: "2026-07-29T08:30:00+08:00",
      collectionRunId: "00000000-0000-4000-8000-000000000021",
    });
    const second = snapshot(IDS.snapshotB, "crawl", {
      capturedAt: "2026-07-29T00:15:00Z",
      collectionRunId: "00000000-0000-4000-8000-000000000022",
    });

    const frozen = buildAnalysisRefreshDiagnosticFrozenInput({
      projectId: IDS.project,
      siteId: IDS.site,
      icp: PAYLOAD.icpProfile,
      snapshots: [first, second],
      outputLocale: PAYLOAD.outputLocale,
      governance,
    });

    expect(frozen.manifest).toMatchObject({
      projectId: IDS.project,
      siteId: IDS.site,
      icp: PAYLOAD.icpProfile,
      ruleSetVersion: RULE_SET_VERSION,
      promptSetVersion: PROMPT_SET_VERSION,
      deliveryLocale: "en-US",
      governance,
    });
    expect(
      (frozen.manifest["snapshots"] as Array<Record<string, unknown>>).map(
        (entry) => entry["snapshotId"],
      ),
    ).toEqual([IDS.snapshotB, IDS.snapshotA]);
    expect(
      (frozen.manifest["snapshots"] as Array<Record<string, unknown>>)[1]?.[
        "capturedAt"
      ],
    ).toBe("2026-07-29T00:30:00.000Z");
    expect(frozen.inputHash).toBe(contentHash(frozen.manifest as never));
  });

  it("keeps capability snapshot addressing in server-owned plan order", () => {
    const forward = growthAuditCapabilityManifestHash({
      projectId: IDS.project,
      siteId: IDS.site,
      icpProfileId: IDS.icp,
      selectedSnapshotIds: [IDS.snapshotA, IDS.snapshotB],
      outputLocale: "en-US",
    });
    const reversed = growthAuditCapabilityManifestHash({
      projectId: IDS.project,
      siteId: IDS.site,
      icpProfileId: IDS.icp,
      selectedSnapshotIds: [IDS.snapshotB, IDS.snapshotA],
      outputLocale: "en-US",
    });
    expect(forward).not.toBe(reversed);
  });
});

function snapshot(
  id: string,
  provider: string,
  input: {
    readonly capturedAt: string;
    readonly collectionRunId: string;
  },
): DataSnapshotRow {
  return {
    id,
    workspace_id: IDS.workspace,
    project_id: IDS.project,
    site_id: IDS.site,
    collection_run_id: input.collectionRunId,
    source_connection_id: IDS.crawl,
    provider,
    dataset_key:
      provider === "crawl"
        ? "crawl.site_graph.v1"
        : "gsc.page_query_daily.v1",
    schema_version: "1.0.0",
    method_version:
      provider === "crawl"
        ? "crawl.site_graph.v1"
        : "gsc.page_query_daily.v1",
    captured_at: input.capturedAt,
    source_window: {},
    availability: "available",
    limitation: "fixture",
    raw_object_key: null,
    row_count: 1,
    checksum: "b".repeat(64),
    summary: {},
    created_at: input.capturedAt,
  };
}
