import { describe, expect, it } from "vitest";
import type { MeasurementWindow } from "@sf/contracts";

import {
  measurementMetricView,
  measurementWindowView,
  selectMeasurementWindow,
} from "./_measurement-view-model.ts";

const ids = {
  project: "10000000-0000-4000-8000-000000000001",
  site: "10000000-0000-4000-8000-000000000002",
  page: "10000000-0000-4000-8000-000000000003",
  action: "10000000-0000-4000-8000-000000000004",
  artifact: "10000000-0000-4000-8000-000000000005",
  revision: "10000000-0000-4000-8000-000000000006",
  attempt: "10000000-0000-4000-8000-000000000007",
  receipt: "10000000-0000-4000-8000-000000000008",
  predecessor: "10000000-0000-4000-8000-000000000009",
  sourceGsc: "10000000-0000-4000-8000-000000000010",
  sourceGa4: "10000000-0000-4000-8000-000000000011",
  gscBefore: "10000000-0000-4000-8000-000000000012",
  gscAfter: "10000000-0000-4000-8000-000000000013",
  ga4Before: "10000000-0000-4000-8000-000000000014",
  ga4After: "10000000-0000-4000-8000-000000000015",
  direct: "10000000-0000-4000-8000-000000000016",
  assisted: "10000000-0000-4000-8000-000000000017",
  utm: "10000000-0000-4000-8000-000000000018",
  window: "10000000-0000-4000-8000-000000000019",
} as const;

function measurementWindow(
  overrides: Partial<MeasurementWindow> = {},
): MeasurementWindow {
  const beforeWindow = {
    startAt: "2026-05-23T12:00:00.000Z",
    endAt: "2026-06-20T12:00:00.000Z",
  };
  const afterWindow = {
    startAt: "2026-06-20T12:00:00.000Z",
    endAt: "2026-07-18T12:00:00.000Z",
  };
  const contentHash = "a".repeat(64);
  const checksum = "b".repeat(64);
  return {
    measurementWindowId: ids.window,
    projectId: ids.project,
    siteId: ids.site,
    target: {
      kind: "url",
      targetRef: `site-page://${ids.page}`,
      sitePageId: ids.page,
    },
    actionId: ids.action,
    artifactId: ids.artifact,
    artifactRevisionId: ids.revision,
    artifactRevision: 2,
    artifactContentHash: contentHash,
    publicationAttemptId: ids.attempt,
    verifiedChangeReceipt: {
      id: ids.receipt,
      providerKind: "github",
      providerRequestId: "merge-42",
      remoteScopeRef: "github:repository:gengrowth/example",
      remoteObjectId: "42",
      remoteRevision: "merge-sha",
      deliveryUrl: "https://github.com/gengrowth/example/pull/42",
      artifactContentHash: contentHash,
      contentChecksum: checksum,
      remoteFacts: {},
      observedAt: "2026-06-20T12:00:00.000Z",
      receiptKind: "change_receipt",
      predecessorDeliveryReceiptId: ids.predecessor,
      remoteObjectKind: "github_merge",
      liveCanonicalUrl:
        "https://example.com/customer-onboarding/",
      verificationState: "verified_live",
      evidenceRefs: ["evidence://github/merge/42"],
      limitation: null,
    },
    timelineDeliveryReceipt: null,
    beforeWindow,
    afterWindow,
    timezone: "UTC",
    url: "https://example.com/customer-onboarding/",
    canonicalUrl: "https://example.com/customer-onboarding/",
    interpretation: "observational_non_causal",
    state: "observed",
    technicalVerificationRef: null,
    limitation:
      "该结果为固定窗口观察，不代表单一交付物造成了指标变化。",
    dimensions: {
      gsc: {
        provider: "gsc",
        state: "observed",
        baselineSource: {
          provider: "gsc",
          sourceRef: ids.sourceGsc,
          snapshotId: ids.gscBefore,
          coveredWindow: beforeWindow,
          observedAt: "2026-06-20T13:00:00.000Z",
          freshness: "current",
        },
        outcomeSource: {
          provider: "gsc",
          sourceRef: ids.sourceGsc,
          snapshotId: ids.gscAfter,
          coveredWindow: afterWindow,
          observedAt: "2026-07-18T13:00:00.000Z",
          freshness: "current",
        },
        sampleSize: {
          baseline: 12_400,
          outcome: 15_600,
          unit: "impressions",
          coverage: "complete",
        },
        limitation: null,
        metrics: {
          clicks: { baseline: 410, outcome: 574 },
          impressions: { baseline: 12_400, outcome: 15_600 },
          ctr: { baseline: 0.033, outcome: 0.0368 },
          averagePosition: { baseline: 15.2, outcome: 10.4 },
        },
      },
      ga4: {
        provider: "ga4",
        state: "observed",
        baselineSource: {
          provider: "ga4",
          sourceRef: ids.sourceGa4,
          snapshotId: ids.ga4Before,
          coveredWindow: beforeWindow,
          observedAt: "2026-06-20T13:00:00.000Z",
          freshness: "current",
        },
        outcomeSource: {
          provider: "ga4",
          sourceRef: ids.sourceGa4,
          snapshotId: ids.ga4After,
          coveredWindow: afterWindow,
          observedAt: "2026-07-18T13:00:00.000Z",
          freshness: "current",
        },
        sampleSize: {
          baseline: 350,
          outcome: 470,
          unit: "sessions",
          coverage: "complete",
        },
        limitation: null,
        directConversionDefinition: {
          conversionDefinitionId: ids.direct,
          kind: "direct",
          eventNames: ["generate_lead"],
          countingMethod: "once_per_session",
          attributionBoundary: "ga4_reported_primary_touchpoint",
          lookbackWindowDays: 30,
        },
        assistedConversionDefinition: {
          conversionDefinitionId: ids.assisted,
          kind: "assisted",
          eventNames: ["generate_lead"],
          countingMethod: "once_per_session",
          attributionBoundary: "path_touchpoint_not_primary",
          lookbackWindowDays: 30,
        },
        metrics: {
          sessions: { baseline: 350, outcome: 470 },
          engagedSessions: { baseline: 214, outcome: 302 },
          directConversions: { baseline: 18, outcome: 27 },
          assistedConversions: { baseline: 11, outcome: 19 },
        },
        campaigns: [
          {
            identity: {
              utmIdentityId: ids.utm,
              source: "google",
              medium: "organic",
              campaign: "customer-onboarding",
              content: "guide",
            },
            metrics: {
              sessions: { baseline: 118, outcome: 171 },
              directConversions: { baseline: 7, outcome: 12 },
              assistedConversions: { baseline: 3, outcome: 7 },
            },
          },
        ],
      },
      geo: {
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
        limitation: "尚未接入可验证的 GEO 引用观测来源。",
        metrics: {
          trackedQueries: { baseline: null, outcome: null },
          citedQueries: { baseline: null, outcome: null },
          citations: { baseline: null, outcome: null },
          citationRate: { baseline: null, outcome: null },
        },
      },
    },
    recordedAt: "2026-07-22T13:00:00.000Z",
    ...overrides,
  };
}

describe("Measurement results view model", () => {
  it("treats a lower average position as an improvement", () => {
    expect(
      measurementMetricView(
        "gscAveragePosition",
        { baseline: 15.2, outcome: 10.4 },
        "position",
        "zh-CN",
        "decrease",
      ),
    ).toEqual({
      key: "gscAveragePosition",
      baseline: "15.2",
      outcome: "10.4",
      delta: "−4.8",
      trend: "improved",
    });
  });

  it("does not manufacture a delta when either comparison phase is missing", () => {
    expect(
      measurementMetricView(
        "ga4Sessions",
        { baseline: 350, outcome: null },
        "count",
        "zh-CN",
      ),
    ).toEqual({
      key: "ga4Sessions",
      baseline: "350",
      outcome: null,
      delta: null,
      trend: "unavailable",
    });
  });

  it("projects before/after provider metrics and the exact UTM identity", () => {
    const view = measurementWindowView(measurementWindow(), "zh-CN");

    expect(view.canonicalUrl).toBe(
      "https://example.com/customer-onboarding/",
    );
    expect(view.gsc.metrics.find((metric) => metric.key === "gscClicks")).toMatchObject({
      baseline: "410",
      outcome: "574",
      delta: "+164",
      trend: "improved",
    });
    expect(
      view.gsc.metrics.find(
        (metric) => metric.key === "gscAveragePosition",
      ),
    ).toMatchObject({ delta: "−4.8", trend: "improved" });
    expect(view.campaigns).toEqual([
      expect.objectContaining({
        id: ids.utm,
        source: "google",
        medium: "organic",
        campaign: "customer-onboarding",
        content: "guide",
        sessions: expect.objectContaining({
          baseline: "118",
          outcome: "171",
          delta: "+53",
        }),
      }),
    ]);
    expect(view.limitations).toEqual([
      "该结果为固定窗口观察，不代表单一交付物造成了指标变化。",
      "尚未接入可验证的 GEO 引用观测来源。",
    ]);
  });

  it("keeps the current selection when it exists and otherwise chooses the newest window", () => {
    const newest = measurementWindow();
    const older = measurementWindow({
      measurementWindowId:
        "10000000-0000-4000-8000-000000000020",
      recordedAt: "2026-06-22T13:00:00.000Z",
    });

    expect(
      selectMeasurementWindow([newest, older], older.measurementWindowId),
    ).toBe(older);
    expect(
      selectMeasurementWindow([newest, older], "missing"),
    ).toBe(newest);
    expect(selectMeasurementWindow([], null)).toBeNull();
  });
});
