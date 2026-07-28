import { describe, expect, it } from "vitest";
import { MeasurementDimensions } from "@sf/contracts";
import type {
  DataSnapshotRow,
  ObservationRow,
} from "@sf/db";
import { projectMeasurementDimensions } from "./project-measurement.ts";

const SITE_ID = "00000000-0000-4000-8000-000000000001";
const PAGE_ID = "00000000-0000-4000-8000-000000000002";
const GSC_SOURCE_ID = "00000000-0000-4000-8000-000000000003";
const GA4_SOURCE_ID = "00000000-0000-4000-8000-000000000004";
const GEO_SOURCE_ID = "00000000-0000-4000-8000-00000000000b";
const GSC_SNAPSHOT_ID = "00000000-0000-4000-8000-000000000005";
const GA4_BASELINE_SNAPSHOT_ID =
  "00000000-0000-4000-8000-000000000006";
const GA4_OUTCOME_SNAPSHOT_ID =
  "00000000-0000-4000-8000-000000000007";
const GSC_OBSERVATION_ID =
  "00000000-0000-4000-8000-000000000008";
const GA4_BASELINE_OBSERVATION_ID =
  "00000000-0000-4000-8000-000000000009";
const GA4_OUTCOME_OBSERVATION_ID =
  "00000000-0000-4000-8000-00000000000a";
const GEO_BASELINE_SNAPSHOT_ID =
  "00000000-0000-4000-8000-00000000000c";
const GEO_OUTCOME_SNAPSHOT_ID =
  "00000000-0000-4000-8000-00000000000d";
const GEO_BASELINE_OBSERVATION_ID =
  "00000000-0000-4000-8000-00000000000e";
const GEO_OUTCOME_OBSERVATION_ID =
  "00000000-0000-4000-8000-00000000000f";

const beforeWindow = {
  startAt: "2026-01-01T00:00:00.000Z",
  endAt: "2026-01-29T00:00:00.000Z",
};
const afterWindow = {
  startAt: "2026-01-29T00:00:00.000Z",
  endAt: "2026-02-26T00:00:00.000Z",
};

describe("projectMeasurementDimensions", () => {
  it("never converts missing provider rows into zero-valued evidence", () => {
    const projected = projectMeasurementDimensions({
      siteId: SITE_ID,
      sitePageId: PAGE_ID,
      beforeWindow,
      afterWindow,
      recordedAt: "2026-03-01T00:00:00.000Z",
      snapshots: [],
      observations: [],
    });

    expect(MeasurementDimensions.parse(projected.dimensions)).toEqual(
      projected.dimensions,
    );
    expect(projected.dimensions.gsc).toMatchObject({
      state: "unavailable",
      baselineSource: null,
      outcomeSource: null,
      sampleSize: {
        baseline: null,
        outcome: null,
        coverage: "none",
      },
      metrics: {
        clicks: { baseline: null, outcome: null },
        impressions: { baseline: null, outcome: null },
      },
    });
    expect(projected.dimensions.ga4.metrics.sessions).toEqual({
      baseline: null,
      outcome: null,
    });
    expect(projected.observationLineage).toEqual({
      gsc: {
        baselineObservationId: null,
        outcomeObservationId: null,
      },
      ga4: {
        baselineObservationId: null,
        outcomeObservationId: null,
      },
      geo: {
        baselineObservationId: null,
        outcomeObservationId: null,
      },
    });
  });

  it("uses one real GSC observation for its canonical previous/current halves and preserves observed zero clicks", () => {
    const snapshot = dataSnapshot({
      id: GSC_SNAPSHOT_ID,
      provider: "gsc",
      sourceConnectionId: GSC_SOURCE_ID,
      sourceWindow: { start: "2026-01-01", end: "2026-02-25" },
      capturedAt: "2026-02-27T00:00:00.000Z",
    });
    const observation = normalizedObservation({
      id: GSC_OBSERVATION_ID,
      snapshotId: snapshot.id,
      provider: "gsc",
      metricKey: "gsc.page.v1",
      observedAt: snapshot.captured_at,
      valueJson: {
        previous28d: {
          clicks: 0,
          impressions: 100,
          position: 12.5,
        },
        current28d: {
          clicks: 20,
          impressions: 200,
          position: 8,
        },
        topQueries: [],
      },
    });

    const projected = projectMeasurementDimensions({
      siteId: SITE_ID,
      sitePageId: PAGE_ID,
      beforeWindow,
      afterWindow,
      recordedAt: "2026-03-01T00:00:00.000Z",
      snapshots: [snapshot],
      observations: [observation],
    });

    expect(MeasurementDimensions.parse(projected.dimensions)).toEqual(
      projected.dimensions,
    );
    expect(projected.dimensions.gsc).toMatchObject({
      state: "observed",
      baselineSource: {
        snapshotId: GSC_SNAPSHOT_ID,
        coveredWindow: {
          startAt: "2026-01-01T00:00:00.000Z",
          endAt: "2026-02-26T00:00:00.000Z",
        },
      },
      outcomeSource: { snapshotId: GSC_SNAPSHOT_ID },
      sampleSize: {
        baseline: 100,
        outcome: 200,
        coverage: "complete",
      },
      metrics: {
        clicks: { baseline: 0, outcome: 20 },
        impressions: { baseline: 100, outcome: 200 },
        ctr: { baseline: 0, outcome: 0.1 },
      },
    });
    expect(projected.observationLineage.gsc).toEqual({
      baselineObservationId: GSC_OBSERVATION_ID,
      outcomeObservationId: GSC_OBSERVATION_ID,
    });
  });

  it("preserves only the actual GSC phase when coverage is insufficient", () => {
    const snapshot = dataSnapshot({
      id: GSC_SNAPSHOT_ID,
      provider: "gsc",
      sourceConnectionId: GSC_SOURCE_ID,
      sourceWindow: { start: "2026-01-01", end: "2026-01-28" },
      capturedAt: "2026-01-30T00:00:00.000Z",
    });
    const observation = normalizedObservation({
      id: GSC_OBSERVATION_ID,
      snapshotId: snapshot.id,
      provider: "gsc",
      metricKey: "gsc.page.v1",
      observedAt: snapshot.captured_at,
      valueJson: {
        previous28d: {
          clicks: 5,
          impressions: 50,
          position: 10,
        },
        current28d: {
          clicks: 10,
          impressions: 100,
          position: 8,
        },
      },
    });

    const projected = projectMeasurementDimensions({
      siteId: SITE_ID,
      sitePageId: PAGE_ID,
      beforeWindow,
      afterWindow,
      recordedAt: "2026-03-01T00:00:00.000Z",
      snapshots: [snapshot],
      observations: [observation],
    });

    expect(projected.dimensions.gsc).toMatchObject({
      state: "insufficient_data",
      baselineSource: { snapshotId: GSC_SNAPSHOT_ID },
      outcomeSource: null,
      metrics: {
        clicks: { baseline: null, outcome: null },
      },
    });
    expect(projected.observationLineage.gsc).toEqual({
      baselineObservationId: GSC_OBSERVATION_ID,
      outcomeObservationId: null,
    });
  });

  it("does not label a wider GSC source window as the exact fixed comparison", () => {
    const snapshot = dataSnapshot({
      id: GSC_SNAPSHOT_ID,
      provider: "gsc",
      sourceConnectionId: GSC_SOURCE_ID,
      sourceWindow: { start: "2025-12-31", end: "2026-02-25" },
      capturedAt: "2026-02-27T00:00:00.000Z",
    });
    const observation = normalizedObservation({
      id: GSC_OBSERVATION_ID,
      snapshotId: snapshot.id,
      provider: "gsc",
      metricKey: "gsc.page.v1",
      observedAt: snapshot.captured_at,
      valueJson: {
        previous28d: {
          clicks: 5,
          impressions: 50,
          position: 10,
        },
        current28d: {
          clicks: 10,
          impressions: 100,
          position: 8,
        },
      },
    });

    const projected = projectMeasurementDimensions({
      siteId: SITE_ID,
      sitePageId: PAGE_ID,
      beforeWindow,
      afterWindow,
      recordedAt: "2026-03-01T00:00:00.000Z",
      snapshots: [snapshot],
      observations: [observation],
    });

    expect(projected.dimensions.gsc.state).toBe(
      "insufficient_data",
    );
    expect(projected.dimensions.gsc.metrics.clicks).toEqual({
      baseline: null,
      outcome: null,
    });
  });

  it("keeps real GA4 phase facts but remains insufficient without governed conversion definitions", () => {
    const baselineSnapshot = dataSnapshot({
      id: GA4_BASELINE_SNAPSHOT_ID,
      provider: "ga4",
      sourceConnectionId: GA4_SOURCE_ID,
      sourceWindow: { start: "2026-01-01", end: "2026-01-28" },
      capturedAt: "2026-01-30T00:00:00.000Z",
    });
    const outcomeSnapshot = dataSnapshot({
      id: GA4_OUTCOME_SNAPSHOT_ID,
      provider: "ga4",
      sourceConnectionId: GA4_SOURCE_ID,
      sourceWindow: { start: "2026-01-29", end: "2026-02-25" },
      capturedAt: "2026-02-27T00:00:00.000Z",
    });
    const baselineObservation = normalizedObservation({
      id: GA4_BASELINE_OBSERVATION_ID,
      snapshotId: baselineSnapshot.id,
      provider: "ga4",
      metricKey: "ga4.landing.v1",
      observedAt: baselineSnapshot.captured_at,
      valueJson: {
        sessions: 0,
        engagedSessions: 0,
        engagementRate: null,
        keyEvents: null,
        keyEventUnavailableReason: "No governed conversion definition.",
      },
    });
    const outcomeObservation = normalizedObservation({
      id: GA4_OUTCOME_OBSERVATION_ID,
      snapshotId: outcomeSnapshot.id,
      provider: "ga4",
      metricKey: "ga4.landing.v1",
      observedAt: outcomeSnapshot.captured_at,
      valueJson: {
        sessions: 40,
        engagedSessions: 25,
        engagementRate: 0.625,
        keyEvents: null,
        keyEventUnavailableReason: "No governed conversion definition.",
      },
    });

    const projected = projectMeasurementDimensions({
      siteId: SITE_ID,
      sitePageId: PAGE_ID,
      beforeWindow,
      afterWindow,
      recordedAt: "2026-03-01T00:00:00.000Z",
      snapshots: [baselineSnapshot, outcomeSnapshot],
      observations: [baselineObservation, outcomeObservation],
    });

    expect(MeasurementDimensions.parse(projected.dimensions)).toEqual(
      projected.dimensions,
    );
    expect(projected.dimensions.ga4).toMatchObject({
      state: "insufficient_data",
      baselineSource: { snapshotId: GA4_BASELINE_SNAPSHOT_ID },
      outcomeSource: { snapshotId: GA4_OUTCOME_SNAPSHOT_ID },
      sampleSize: {
        baseline: 0,
        outcome: 40,
        coverage: "partial",
      },
      directConversionDefinition: null,
      assistedConversionDefinition: null,
      metrics: {
        sessions: { baseline: 0, outcome: 40 },
        engagedSessions: { baseline: 0, outcome: 25 },
        directConversions: { baseline: null, outcome: null },
        assistedConversions: { baseline: null, outcome: null },
      },
      campaigns: [],
    });
    expect(projected.observationLineage.ga4).toEqual({
      baselineObservationId: GA4_BASELINE_OBSERVATION_ID,
      outcomeObservationId: GA4_OUTCOME_OBSERVATION_ID,
    });
  });

  it("reports GEO unavailable without canonical GEO lineage and never borrows another provider", () => {
    const projected = projectMeasurementDimensions({
      siteId: SITE_ID,
      sitePageId: PAGE_ID,
      beforeWindow,
      afterWindow,
      recordedAt: "2026-03-01T00:00:00.000Z",
      snapshots: [],
      observations: [],
    });

    expect(projected.dimensions.geo).toEqual({
      provider: "geo",
      state: "unavailable",
      baselineSource: null,
      outcomeSource: null,
      sampleSize: {
        baseline: null,
        outcome: null,
        unit: "tracked_queries",
        coverage: "none",
      },
      limitation:
        "No canonical GEO citation snapshot and page observation are available for this measurement target.",
      metrics: {
        trackedQueries: { baseline: null, outcome: null },
        citedQueries: { baseline: null, outcome: null },
        citations: { baseline: null, outcome: null },
        citationRate: { baseline: null, outcome: null },
      },
    });
  });

  it("preserves one-sided GEO evidence as insufficient data without filling the missing outcome with zero", () => {
    const projected = projectMeasurementDimensions({
      siteId: SITE_ID,
      sitePageId: PAGE_ID,
      beforeWindow,
      afterWindow,
      recordedAt: "2026-03-01T00:00:00.000Z",
      providerEvidence: [
        geoEvidence({
          snapshotId: GEO_BASELINE_SNAPSHOT_ID,
          observationId: GEO_BASELINE_OBSERVATION_ID,
          sourceWindow: {
            startAt: "2026-01-15T00:00:00.000Z",
            endAt: "2026-01-16T00:00:00.000Z",
          },
          observedAt: "2026-01-16T00:00:00.000Z",
          trackedQueries: 12,
          citedQueries: 3,
          citations: 4,
          querySetHash: "a".repeat(64),
        }),
      ],
    });

    expect(projected.dimensions.geo).toMatchObject({
      state: "insufficient_data",
      baselineSource: {
        snapshotId: GEO_BASELINE_SNAPSHOT_ID,
      },
      outcomeSource: null,
      sampleSize: {
        baseline: 12,
        outcome: null,
        coverage: "partial",
      },
      metrics: {
        trackedQueries: { baseline: 12, outcome: null },
        citedQueries: { baseline: 3, outcome: null },
        citations: { baseline: 4, outcome: null },
        citationRate: { baseline: 0.25, outcome: null },
      },
    });
    expect(projected.observationLineage.geo).toEqual({
      baselineObservationId: GEO_BASELINE_OBSERVATION_ID,
      outcomeObservationId: null,
    });
  });

  it("projects comparable real GEO baseline/outcome evidence as an observed partial sample", () => {
    const cohortHash = "a".repeat(64);
    const projected = projectMeasurementDimensions({
      siteId: SITE_ID,
      sitePageId: PAGE_ID,
      beforeWindow,
      afterWindow,
      recordedAt: "2026-03-01T00:00:00.000Z",
      providerEvidence: [
        geoEvidence({
          snapshotId: GEO_BASELINE_SNAPSHOT_ID,
          observationId: GEO_BASELINE_OBSERVATION_ID,
          sourceWindow: {
            startAt: "2026-01-15T00:00:00.000Z",
            endAt: "2026-01-16T00:00:00.000Z",
          },
          observedAt: "2026-01-16T00:00:00.000Z",
          trackedQueries: 12,
          citedQueries: 3,
          citations: 4,
          querySetHash: cohortHash,
        }),
        geoEvidence({
          snapshotId: GEO_OUTCOME_SNAPSHOT_ID,
          observationId: GEO_OUTCOME_OBSERVATION_ID,
          sourceWindow: {
            startAt: "2026-02-14T00:00:00.000Z",
            endAt: "2026-02-15T00:00:00.000Z",
          },
          observedAt: "2026-02-15T00:00:00.000Z",
          trackedQueries: 12,
          citedQueries: 5,
          citations: 7,
          querySetHash: cohortHash,
        }),
      ],
    });

    expect(MeasurementDimensions.parse(projected.dimensions)).toEqual(
      projected.dimensions,
    );
    expect(projected.dimensions.geo).toMatchObject({
      state: "observed",
      baselineSource: {
        sourceRef: GEO_SOURCE_ID,
        snapshotId: GEO_BASELINE_SNAPSHOT_ID,
      },
      outcomeSource: {
        sourceRef: GEO_SOURCE_ID,
        snapshotId: GEO_OUTCOME_SNAPSHOT_ID,
      },
      sampleSize: {
        baseline: 12,
        outcome: 12,
        coverage: "partial",
      },
      metrics: {
        trackedQueries: { baseline: 12, outcome: 12 },
        citedQueries: { baseline: 3, outcome: 5 },
        citations: { baseline: 4, outcome: 7 },
        citationRate: { baseline: 0.25, outcome: 5 / 12 },
      },
    });
    expect(projected.dimensions.geo.limitation).toContain(
      "observational",
    );
    expect(projected.observationLineage.geo).toEqual({
      baselineObservationId: GEO_BASELINE_OBSERVATION_ID,
      outcomeObservationId: GEO_OUTCOME_OBSERVATION_ID,
    });
  });

  it("does not claim a comparable GEO result when query cohorts differ", () => {
    const projected = projectMeasurementDimensions({
      siteId: SITE_ID,
      sitePageId: PAGE_ID,
      beforeWindow,
      afterWindow,
      recordedAt: "2026-03-01T00:00:00.000Z",
      providerEvidence: [
        geoEvidence({
          snapshotId: GEO_BASELINE_SNAPSHOT_ID,
          observationId: GEO_BASELINE_OBSERVATION_ID,
          sourceWindow: {
            startAt: "2026-01-15T00:00:00.000Z",
            endAt: "2026-01-16T00:00:00.000Z",
          },
          observedAt: "2026-01-16T00:00:00.000Z",
          trackedQueries: 12,
          citedQueries: 3,
          citations: 4,
          querySetHash: "a".repeat(64),
        }),
        geoEvidence({
          snapshotId: GEO_OUTCOME_SNAPSHOT_ID,
          observationId: GEO_OUTCOME_OBSERVATION_ID,
          sourceWindow: {
            startAt: "2026-02-14T00:00:00.000Z",
            endAt: "2026-02-15T00:00:00.000Z",
          },
          observedAt: "2026-02-15T00:00:00.000Z",
          trackedQueries: 12,
          citedQueries: 5,
          citations: 7,
          querySetHash: "b".repeat(64),
        }),
      ],
    });

    expect(projected.dimensions.geo.state).toBe(
      "insufficient_data",
    );
    expect(projected.dimensions.geo.limitation).toContain(
      "query cohort",
    );
  });
});

function dataSnapshot(input: {
  id: string;
  provider: "gsc" | "ga4";
  sourceConnectionId: string;
  sourceWindow: Record<string, unknown>;
  capturedAt: string;
}): DataSnapshotRow {
  return {
    id: input.id,
    workspace_id: "00000000-0000-4000-8000-000000000010",
    project_id: "00000000-0000-4000-8000-000000000011",
    site_id: SITE_ID,
    collection_run_id: "00000000-0000-4000-8000-000000000012",
    source_connection_id: input.sourceConnectionId,
    provider: input.provider,
    dataset_key: `${input.provider}.fixture`,
    schema_version: "1",
    method_version: "1",
    captured_at: input.capturedAt,
    source_window: input.sourceWindow,
    availability: "available",
    limitation: "",
    raw_object_key: null,
    row_count: 1,
    checksum: "a".repeat(64),
    summary: {},
    created_at: input.capturedAt,
  };
}

function normalizedObservation(input: {
  id: string;
  snapshotId: string;
  provider: "gsc" | "ga4";
  metricKey: "gsc.page.v1" | "ga4.landing.v1";
  observedAt: string;
  valueJson: unknown;
}): ObservationRow {
  return {
    id: input.id,
    workspace_id: "00000000-0000-4000-8000-000000000010",
    project_id: "00000000-0000-4000-8000-000000000011",
    snapshot_id: input.snapshotId,
    site_page_id: PAGE_ID,
    provider: input.provider,
    metric_key: input.metricKey,
    subject_type: "url",
    subject_ref: "https://example.com/page",
    observed_at: input.observedAt,
    availability: "available",
    value_numeric: null,
    value_text: null,
    value_json: input.valueJson,
    unit: null,
    origin: "first_party",
    method: "observed",
    grade: "A",
    support: "direct",
    limitation: "",
  };
}

function geoEvidence(input: {
  snapshotId: string;
  observationId: string;
  sourceWindow: {
    startAt: string;
    endAt: string;
  };
  observedAt: string;
  trackedQueries: number;
  citedQueries: number;
  citations: number;
  querySetHash: string;
}) {
  return {
    snapshotId: input.snapshotId,
    sourceConnectionId: GEO_SOURCE_ID,
    provider: "geo",
    datasetKey: "geo.answer_citations.v1",
    schemaVersion: "1",
    methodVersion: "geo-citation-authority-v1",
    capturedAt: input.observedAt,
    sourceWindow: input.sourceWindow,
    coveredWindow: input.sourceWindow,
    snapshotAvailability: "available",
    snapshotLimitation:
      "Point-in-time AI answer observation.",
    observationId: input.observationId,
    sitePageId: PAGE_ID,
    metricKey: "geo.page_citations.v1",
    subjectType: "url",
    subjectRef: "https://example.com/page",
    observedAt: input.observedAt,
    observationAvailability: "available",
    valueJson: {
      schemaVersion: "1",
      marketCode: "US",
      languageTag: "en-US",
      querySetHash: input.querySetHash,
      trackedQueries: input.trackedQueries,
      citedQueries: input.citedQueries,
      citations: input.citations,
    },
    unit: "tracked_queries",
    origin: "vendor_observation",
    method: "observed",
    grade: "B",
    support: "context",
    observationLimitation:
      "This evidence is observational and does not establish causality.",
  };
}
