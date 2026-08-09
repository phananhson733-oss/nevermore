import { describe, expect, it } from "vitest";
import {
  type DataSnapshotRow,
  type ObservationRow,
} from "@sf/db";
import {
  createDataForSeoCollectionScope,
  createDataForSeoSearchLandscapeScope,
  createDataForSeoSearchLandscapeV2Scope,
  createDataForSeoSearchLandscapeV3Scope,
} from "@sf/sources";
import { deriveKeywordOccurrenceInputs } from "./keyword-library-projection.ts";

const snapshotId = "00000000-0000-4000-8000-000000000003";
const observationId = "00000000-0000-4000-8000-000000000004";
const collectedAt = "2026-07-22T08:00:00.000Z";

function snapshot(
  overrides: Partial<DataSnapshotRow> = {},
): DataSnapshotRow {
  return {
    id: snapshotId,
    workspace_id: "00000000-0000-4000-8000-000000000001",
    project_id: "00000000-0000-4000-8000-000000000002",
    site_id: "00000000-0000-4000-8000-000000000005",
    collection_run_id: "00000000-0000-4000-8000-000000000006",
    source_connection_id: null,
    provider: "csv",
    dataset_key: "csv.keyword_gap.v1",
    schema_version: "0.2.0",
    method_version: "csv.keyword_gap.v1",
    captured_at: collectedAt,
    source_window: { start: null, end: null },
    availability: "available",
    limitation: "Canonical keyword projection fixture.",
    raw_object_key: "snapshot-raw/project/run/object",
    row_count: 1,
    checksum: "checksum",
    summary: {},
    created_at: collectedAt,
    ...overrides,
  };
}

function observation(
  overrides: Partial<ObservationRow> = {},
): ObservationRow {
  return {
    id: observationId,
    workspace_id: "00000000-0000-4000-8000-000000000001",
    project_id: "00000000-0000-4000-8000-000000000002",
    snapshot_id: snapshotId,
    site_page_id: null,
    provider: "csv",
    metric_key: "csv.keyword_gap.v1",
    subject_type: "keyword_cluster",
    subject_ref: "customer-onboarding",
    observed_at: collectedAt,
    availability: "available",
    value_numeric: null,
    value_text: null,
    value_json: {
      keyword: "Customer Onboarding Software",
      clusterKey: "customer-onboarding",
      searchVolume: 2_400,
      currentUrl: null,
      currentRank: null,
      competitorDomain: null,
      competitorRank: null,
      marketCode: "US",
      languageCode: "en-US",
    },
    unit: null,
    origin: "user_provided",
    method: "observed",
    grade: "C",
    support: "supports",
    limitation: "Canonical keyword projection fixture.",
    ...overrides,
  };
}

describe("deriveKeywordOccurrenceInputs", () => {
  it("projects a CSV keyword from its canonical Observation pointer with user-provided scope", () => {
    expect(
      deriveKeywordOccurrenceInputs(snapshot(), observation()),
    ).toEqual([
      {
        manualEntryId: null,
        dataSnapshotId: snapshotId,
        normalizedObservationId: observationId,
        displayKeyword: "Customer Onboarding Software",
        normalizedKeyword: "customer onboarding software",
        market: "US",
        languageTag: "en-US",
        queryKind: "search_query",
        sourceKind: "csv_import",
        scopeBasis: "user_provided",
        sourcePointer: "/valueJson/keyword",
        sourceRef: `observation:${observationId}#/valueJson/keyword`,
        collectedAt,
        providerDataAsOf: null,
      },
    ]);
  });

  it("uses the DataForSEO Snapshot dataset and full frozen scope while retaining the shared CSV metric", () => {
    const collectionScope = createDataForSeoCollectionScope({
      target: "example.com",
      marketCode: "CA",
      locationName: "Canada",
      languageTag: "fr-CA",
      limit: 50,
    });
    const dataForSeoSnapshot = snapshot({
      provider: "dataforseo",
      dataset_key: "dataforseo.ranked_keywords.v1",
      schema_version: "dataforseo.ranked_keywords.v1",
      method_version: "dataforseo.ranked_keywords.v1",
      summary: {
        collectionScope,
        timing: {
          collectedAt,
          dataAsOf: null,
          observedAt: null,
          freshness: "unknown",
        },
      },
    });
    const dataForSeoObservation = observation({
      provider: "dataforseo",
      origin: "vendor_observation",
      grade: "B",
      value_json: {
        ...(observation().value_json as Record<string, unknown>),
        marketCode: "CA",
        languageCode: "fr",
      },
    });

    expect(
      deriveKeywordOccurrenceInputs(
        dataForSeoSnapshot,
        dataForSeoObservation,
      ),
    ).toEqual([
      expect.objectContaining({
        dataSnapshotId: snapshotId,
        normalizedObservationId: observationId,
        market: "CA",
        languageTag: "fr-CA",
        sourceKind: "dataforseo_ranked",
        scopeBasis: "provider_collection_scope",
        sourcePointer: "/valueJson/keyword",
        providerDataAsOf: null,
      }),
    ]);
  });

  it("fails closed when DataForSEO lacks its exact frozen collection scope or dataset", () => {
    expect(() =>
      deriveKeywordOccurrenceInputs(
        snapshot({
          provider: "dataforseo",
          dataset_key: "dataforseo.ranked_keywords.v1",
          schema_version: "dataforseo.ranked_keywords.v1",
          method_version: "dataforseo.ranked_keywords.v1",
          summary: {},
        }),
        observation({ provider: "dataforseo" }),
      ),
    ).toThrow(/frozen.*collection scope/i);
    expect(() =>
      deriveKeywordOccurrenceInputs(
        snapshot({
          provider: "dataforseo",
          dataset_key: "csv.keyword_gap.v1",
          summary: {},
        }),
        observation({ provider: "dataforseo" }),
      ),
    ).toThrow(/dataset/i);
  });

  it("projects ranked keywords from the composite Search Landscape Snapshot without changing occurrence semantics", () => {
    const collectionScope = createDataForSeoSearchLandscapeScope({
      target: "example.com",
      marketCode: "GB",
      locationName: "United Kingdom",
      languageTag: "en-GB",
      rankedKeywordsLimit: 37,
      competitorsDomainLimit: 19,
    });
    const compositeSnapshot = snapshot({
      provider: "dataforseo",
      dataset_key: "dataforseo.search_landscape.v1",
      schema_version: "dataforseo.search_landscape.v1",
      method_version: "dataforseo.search_landscape.v1",
      summary: {
        collectionScope,
        timing: {
          collectedAt,
          dataAsOf: null,
          observedAt: null,
          freshness: "unknown",
        },
      },
    });
    const rankedObservation = observation({
      provider: "dataforseo",
      origin: "vendor_observation",
      grade: "B",
      value_json: {
        ...(observation().value_json as Record<string, unknown>),
        marketCode: "GB",
        languageCode: "en",
      },
    });

    expect(
      deriveKeywordOccurrenceInputs(compositeSnapshot, rankedObservation),
    ).toEqual([
      expect.objectContaining({
        displayKeyword: "Customer Onboarding Software",
        market: "GB",
        languageTag: "en-GB",
        sourceKind: "dataforseo_ranked",
        scopeBasis: "provider_collection_scope",
        sourcePointer: "/valueJson/keyword",
        providerDataAsOf: null,
      }),
    ]);
  });

  it("projects ranked keywords from Search Landscape v2 into the current library", () => {
    const collectionScope = createDataForSeoSearchLandscapeV2Scope({
      target: "example.com",
      marketCode: "US",
      locationName: "United States",
      languageTag: "en-US",
      seeds: [
        {
          keyword: "Customer Onboarding Software",
          sourceKind: "gsc_top_query",
          sourceRef: `observation:${observationId}`,
        },
      ],
    });
    const v2Snapshot = snapshot({
      provider: "dataforseo",
      dataset_key: "dataforseo.search_landscape.v2",
      schema_version: "dataforseo.search_landscape.v2",
      method_version: "dataforseo.search_landscape.v2",
      summary: { collectionScope },
    });

    expect(
      deriveKeywordOccurrenceInputs(
        v2Snapshot,
        observation({ provider: "dataforseo" }),
      ),
    ).toEqual([
      expect.objectContaining({
        displayKeyword: "Customer Onboarding Software",
        market: "US",
        languageTag: "en-US",
        sourceKind: "dataforseo_ranked",
        scopeBasis: "provider_collection_scope",
      }),
    ]);
  });

  it("projects ranked keywords from Search Landscape v3 without changing occurrence semantics", () => {
    const collectionScope = createDataForSeoSearchLandscapeV3Scope({
      target: "example.com",
      marketCode: "US",
      locationName: "United States",
      languageTag: "en-US",
      seeds: [],
      aiCitations: { state: "disabled" },
    });
    const v3Snapshot = snapshot({
      provider: "dataforseo",
      dataset_key: "dataforseo.search_landscape.v3",
      schema_version: "dataforseo.search_landscape.v3",
      method_version: "dataforseo.search_landscape.v3",
      summary: { collectionScope },
    });

    expect(
      deriveKeywordOccurrenceInputs(
        v3Snapshot,
        observation({ provider: "dataforseo" }),
      ),
    ).toEqual([
      expect.objectContaining({
        displayKeyword: "Customer Onboarding Software",
        market: "US",
        languageTag: "en-US",
        sourceKind: "dataforseo_ranked",
        scopeBasis: "provider_collection_scope",
      }),
    ]);
  });

  it("projects every GSC top query only from explicitly frozen project context", () => {
    const gscSnapshot = snapshot({
      provider: "gsc",
      dataset_key: "gsc.page_query_daily.v1",
      method_version: "gsc.search_analytics.v1",
      summary: {
        keywordLibraryContext: {
          basis: "project_context",
          marketCode: "GB",
          languageTag: "en-GB",
        },
      },
    });
    const gscObservation = observation({
      provider: "gsc",
      metric_key: "gsc.page.v1",
      subject_type: "url",
      subject_ref: "https://example.com/pricing",
      origin: "first_party",
      grade: "A",
      value_json: {
        current28d: { clicks: 20, impressions: 100, position: 8.5 },
        previous28d: { clicks: 10, impressions: 80, position: 10.2 },
        topQueries: [
          { query: "Customer Onboarding", clicks: 12 },
          { query: "Onboarding Automation", clicks: 8 },
        ],
      },
    });

    expect(
      deriveKeywordOccurrenceInputs(gscSnapshot, gscObservation),
    ).toEqual([
      expect.objectContaining({
        displayKeyword: "Customer Onboarding",
        normalizedKeyword: "customer onboarding",
        market: "GB",
        languageTag: "en-GB",
        sourceKind: "gsc_top_query",
        scopeBasis: "project_context",
        sourcePointer: "/valueJson/topQueries/0/query",
        sourceRef: `observation:${observationId}#/valueJson/topQueries/0/query`,
      }),
      expect.objectContaining({
        displayKeyword: "Onboarding Automation",
        normalizedKeyword: "onboarding automation",
        sourcePointer: "/valueJson/topQueries/1/query",
        sourceRef: `observation:${observationId}#/valueJson/topQueries/1/query`,
      }),
    ]);
  });

  it("does not create GSC occurrences without explicit frozen context and rejects malformed explicit context", () => {
    const gscObservation = observation({
      provider: "gsc",
      metric_key: "gsc.page.v1",
      value_json: { topQueries: [{ query: "Customer Onboarding" }] },
    });

    expect(
      deriveKeywordOccurrenceInputs(
        snapshot({
          provider: "gsc",
          dataset_key: "gsc.page_query_daily.v1",
          summary: {},
        }),
        gscObservation,
      ),
    ).toEqual([]);
    expect(() =>
      deriveKeywordOccurrenceInputs(
        snapshot({
          provider: "gsc",
          dataset_key: "gsc.page_query_daily.v1",
          summary: {
            keywordLibraryContext: {
              basis: "provider_collection_scope",
              marketCode: "US",
              languageTag: "en-US",
            },
          },
        }),
        gscObservation,
      ),
    ).toThrow(/keywordLibraryContext/i);
  });

  it("never invents occurrences for unavailable or unrelated observations", () => {
    expect(
      deriveKeywordOccurrenceInputs(
        snapshot(),
        observation({ availability: "unavailable", value_json: null }),
      ),
    ).toEqual([]);
    expect(
      deriveKeywordOccurrenceInputs(
        snapshot(),
        observation({ metric_key: "csv.unrelated.v1" }),
      ),
    ).toEqual([]);
  });
});
