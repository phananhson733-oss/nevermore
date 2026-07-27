import { describe, expect, it } from "vitest";
import {
  CreateMeasurementWindowRequest,
  MeasurementState,
  MeasurementWindow,
  MeasurementWindowAccepted,
  MeasurementWindowHistoryResponse,
  MeasurementWindowInterval,
} from "./measurement.ts";

const ids = {
  action: "90000000-0000-4000-8000-000000000001",
  artifact: "90000000-0000-4000-8000-000000000002",
  artifactRevision: "90000000-0000-4000-8000-000000000003",
  asyncRun: "90000000-0000-4000-8000-000000000004",
  changeReceipt: "90000000-0000-4000-8000-000000000005",
  deliveryReceipt: "90000000-0000-4000-8000-000000000006",
  directDefinition: "90000000-0000-4000-8000-000000000007",
  assistedDefinition: "90000000-0000-4000-8000-000000000008",
  ga4Baseline: "90000000-0000-4000-8000-000000000009",
  ga4Outcome: "90000000-0000-4000-8000-000000000010",
  ga4Source: "90000000-0000-4000-8000-000000000011",
  geoBaseline: "90000000-0000-4000-8000-000000000012",
  geoOutcome: "90000000-0000-4000-8000-000000000013",
  geoSource: "90000000-0000-4000-8000-000000000014",
  gscBaseline: "90000000-0000-4000-8000-000000000015",
  gscOutcome: "90000000-0000-4000-8000-000000000016",
  gscSource: "90000000-0000-4000-8000-000000000017",
  measurement: "90000000-0000-4000-8000-000000000018",
  project: "90000000-0000-4000-8000-000000000019",
  publicationAttempt: "90000000-0000-4000-8000-000000000020",
  site: "90000000-0000-4000-8000-000000000021",
  sitePage: "90000000-0000-4000-8000-000000000022",
  technicalRecheck: "90000000-0000-4000-8000-000000000023",
  utm: "90000000-0000-4000-8000-000000000024",
} as const;

const artifactContentHash = "a".repeat(64);
const contentChecksum = "b".repeat(64);
const otherHash = "c".repeat(64);
const beforeWindow = {
  startAt: "2026-06-01T00:00:00Z",
  endAt: "2026-06-15T00:00:00Z",
} as const;
const afterWindow = {
  startAt: "2026-07-01T00:00:00Z",
  endAt: "2026-07-15T00:00:00Z",
} as const;

const deliveryReceipt = {
  id: ids.deliveryReceipt,
  providerKind: "github" as const,
  providerRequestId: "github-request-1",
  remoteScopeRef: "installation:42/repository:relayops",
  remoteObjectId: "pull-request-17",
  remoteRevision: "head-sha",
  deliveryUrl: "https://github.com/example/relayops/pull/17",
  artifactContentHash,
  contentChecksum,
  remoteFacts: { repository: "example/relayops", pullRequest: 17 },
  observedAt: "2026-06-20T10:00:00Z",
  receiptKind: "delivery_receipt" as const,
  predecessorDeliveryReceiptId: null,
  remoteObjectKind: "github_pull_request" as const,
  liveCanonicalUrl: null,
  verificationState: "provider_accepted" as const,
  evidenceRefs: [],
  limitation: null,
};

const changeReceipt = {
  id: ids.changeReceipt,
  providerKind: "github" as const,
  providerRequestId: "github-request-2",
  remoteScopeRef: "installation:42/repository:relayops",
  remoteObjectId: "merge-17",
  remoteRevision: "merge-sha",
  deliveryUrl: "https://github.com/example/relayops/pull/17",
  artifactContentHash,
  contentChecksum,
  remoteFacts: { repository: "example/relayops", mergedPullRequest: 17 },
  observedAt: "2026-06-20T12:00:00Z",
  receiptKind: "change_receipt" as const,
  predecessorDeliveryReceiptId: ids.deliveryReceipt,
  remoteObjectKind: "github_merge" as const,
  liveCanonicalUrl:
    "https://relayops.example/blog/customer-onboarding-automation/",
  verificationState: "verified_live" as const,
  evidenceRefs: ["evidence://github/merge/17"],
  limitation: null,
};

function source(
  provider: "gsc" | "ga4" | "geo",
  sourceRef: string,
  snapshotId: string,
  coveredWindow: typeof beforeWindow | typeof afterWindow,
) {
  return {
    provider,
    sourceRef,
    snapshotId,
    coveredWindow,
    observedAt:
      coveredWindow === beforeWindow
        ? "2026-06-16T00:00:00Z"
        : "2026-07-16T00:00:00Z",
    freshness: "current" as const,
  };
}

const observedGsc = {
  provider: "gsc" as const,
  state: "observed" as const,
  baselineSource: source(
    "gsc",
    ids.gscSource,
    ids.gscBaseline,
    beforeWindow,
  ),
  outcomeSource: source(
    "gsc",
    ids.gscSource,
    ids.gscOutcome,
    afterWindow,
  ),
  sampleSize: {
    baseline: 4200,
    outcome: 5100,
    unit: "impressions" as const,
    coverage: "complete" as const,
  },
  limitation: null,
  metrics: {
    clicks: { baseline: 210, outcome: 248 },
    impressions: { baseline: 4200, outcome: 5100 },
    ctr: { baseline: 0.05, outcome: 0.0486 },
    averagePosition: { baseline: 14.2, outcome: 12.8 },
  },
};

const observedGa4 = {
  provider: "ga4" as const,
  state: "observed" as const,
  baselineSource: source(
    "ga4",
    ids.ga4Source,
    ids.ga4Baseline,
    beforeWindow,
  ),
  outcomeSource: source(
    "ga4",
    ids.ga4Source,
    ids.ga4Outcome,
    afterWindow,
  ),
  sampleSize: {
    baseline: 360,
    outcome: 440,
    unit: "sessions" as const,
    coverage: "complete" as const,
  },
  limitation:
    "GA4 attribution is observational and may include cross-channel effects.",
  directConversionDefinition: {
    conversionDefinitionId: ids.directDefinition,
    kind: "direct" as const,
    eventNames: ["request_demo"],
    countingMethod: "once_per_event" as const,
    attributionBoundary: "ga4_reported_primary_touchpoint" as const,
    lookbackWindowDays: 30,
  },
  assistedConversionDefinition: {
    conversionDefinitionId: ids.assistedDefinition,
    kind: "assisted" as const,
    eventNames: ["request_demo"],
    countingMethod: "once_per_event" as const,
    attributionBoundary: "path_touchpoint_not_primary" as const,
    lookbackWindowDays: 30,
  },
  metrics: {
    sessions: { baseline: 360, outcome: 440 },
    engagedSessions: { baseline: 240, outcome: 305 },
    directConversions: { baseline: 12, outcome: 16 },
    assistedConversions: { baseline: 7, outcome: 9 },
  },
  campaigns: [
    {
      identity: {
        utmIdentityId: ids.utm,
        source: "linkedin",
        medium: "paid-social",
        campaign: "customer-onboarding-guide",
        content: "operations-lead-carousel",
      },
      metrics: {
        sessions: { baseline: 120, outcome: 155 },
        directConversions: { baseline: 5, outcome: 6 },
        assistedConversions: { baseline: 3, outcome: 4 },
      },
    },
  ],
};

const insufficientGeo = {
  provider: "geo" as const,
  state: "insufficient_data" as const,
  baselineSource: source(
    "geo",
    ids.geoSource,
    ids.geoBaseline,
    beforeWindow,
  ),
  outcomeSource: source(
    "geo",
    ids.geoSource,
    ids.geoOutcome,
    afterWindow,
  ),
  sampleSize: {
    baseline: 4,
    outcome: 4,
    unit: "tracked_queries" as const,
    coverage: "partial" as const,
  },
  limitation:
    "Only four governed prompts were observed in each window; no causal conclusion is supported.",
  metrics: {
    trackedQueries: { baseline: 4, outcome: 4 },
    citedQueries: { baseline: null, outcome: null },
    citations: { baseline: null, outcome: null },
    citationRate: { baseline: null, outcome: null },
  },
};

function measurementWindow() {
  return {
    measurementWindowId: ids.measurement,
    projectId: ids.project,
    siteId: ids.site,
    target: {
      kind: "url" as const,
      targetRef:
        "site-page://relayops/blog/customer-onboarding-automation",
      sitePageId: ids.sitePage,
    },
    actionId: ids.action,
    artifactId: ids.artifact,
    artifactRevisionId: ids.artifactRevision,
    artifactRevision: 3,
    artifactContentHash,
    publicationAttemptId: ids.publicationAttempt,
    verifiedChangeReceipt: changeReceipt,
    timelineDeliveryReceipt: deliveryReceipt,
    beforeWindow,
    afterWindow,
    timezone: "America/New_York",
    url: "https://relayops.example/blog/customer-onboarding-automation/?ref=launch",
    canonicalUrl:
      "https://relayops.example/blog/customer-onboarding-automation/",
    interpretation: "observational_non_causal" as const,
    state: "observed" as const,
    technicalVerificationRef: ids.technicalRecheck,
    limitation:
      "Observed values are reported by their providers and do not prove action-attributed growth.",
    dimensions: {
      gsc: observedGsc,
      ga4: observedGa4,
      geo: insufficientGeo,
    },
    recordedAt: "2026-07-16T01:00:00Z",
  };
}

describe("measurement create boundary", () => {
  it("accepts only a verified Change Receipt reference and idempotency key", () => {
    const request = {
      changeReceiptId: ids.changeReceipt,
      idempotencyKey: "measurement-window-1",
    };

    expect(CreateMeasurementWindowRequest.parse(request)).toEqual(request);
  });

  it.each([
    ["target", measurementWindow().target],
    ["actionId", ids.action],
    ["artifactRevisionId", ids.artifactRevision],
    ["beforeWindow", beforeWindow],
    ["afterWindow", afterWindow],
    ["timezone", "America/New_York"],
    ["canonicalUrl", measurementWindow().canonicalUrl],
    ["snapshotId", ids.gscBaseline],
    ["state", "observed"],
    ["metrics", observedGsc.metrics],
    ["recordedAt", "2026-07-16T01:00:00Z"],
    ["deliveryReceiptId", ids.deliveryReceipt],
    ["provider", "gsc"],
  ])("rejects browser-authored server fact %s", (field, value) => {
    expect(
      CreateMeasurementWindowRequest.safeParse({
        changeReceiptId: ids.changeReceipt,
        idempotencyKey: "measurement-window-1",
        [field]: value,
      }).success,
    ).toBe(false);
  });

  it("returns a strict pending acceptance without outcome facts", () => {
    const accepted = {
      measurementWindowId: ids.measurement,
      asyncRunId: ids.asyncRun,
      state: "pending" as const,
      replayed: false,
    };

    expect(MeasurementWindowAccepted.parse(accepted)).toEqual(accepted);
    expect(
      MeasurementWindowAccepted.safeParse({
        ...accepted,
        result: measurementWindow(),
      }).success,
    ).toBe(false);
  });
});

describe("immutable measurement window", () => {
  it("uses only the five honest final result states", () => {
    expect(MeasurementState.options).toEqual([
      "technical_verified",
      "observed",
      "insufficient_data",
      "unavailable",
      "regressed",
    ]);
    expect(MeasurementState.safeParse("improved").success).toBe(false);
    expect(MeasurementState.safeParse("lifted").success).toBe(false);
    expect(MeasurementState.safeParse("pending").success).toBe(false);
  });

  it("accepts exact immutable lineage, windows, sources and dimensions", () => {
    const record = measurementWindow();

    expect(MeasurementWindow.parse(record)).toEqual(record);
  });

  it("requires absolute non-empty intervals", () => {
    expect(MeasurementWindowInterval.parse(beforeWindow)).toEqual(
      beforeWindow,
    );
    expect(
      MeasurementWindowInterval.safeParse({
        startAt: beforeWindow.endAt,
        endAt: beforeWindow.startAt,
      }).success,
    ).toBe(false);
    expect(
      MeasurementWindowInterval.safeParse({
        startAt: "2026-06-01",
        endAt: beforeWindow.endAt,
      }).success,
    ).toBe(false);
  });

  it("binds the exact Artifact identity hash and canonical URL to the verified Change Receipt", () => {
    const base = measurementWindow();

    for (const changed of [
      { artifactContentHash: otherHash },
      {
        verifiedChangeReceipt: {
          ...base.verifiedChangeReceipt,
          artifactContentHash: otherHash,
        },
      },
      { canonicalUrl: "https://relayops.example/another-page/" },
      {
        verifiedChangeReceipt: {
          ...base.verifiedChangeReceipt,
          verificationState: "pending",
        },
      },
      {
        verifiedChangeReceipt: {
          ...base.verifiedChangeReceipt,
          receiptKind: "delivery_receipt",
        },
      },
    ]) {
      expect(
        MeasurementWindow.safeParse({ ...base, ...changed }).success,
      ).toBe(false);
    }
  });

  it("allows Delivery Receipt lineage only as an optional matching timeline predecessor", () => {
    const base = measurementWindow();

    expect(
      MeasurementWindow.safeParse({
        ...base,
        timelineDeliveryReceipt: null,
      }).success,
    ).toBe(true);
    expect(
      MeasurementWindow.safeParse({
        ...base,
        timelineDeliveryReceipt: {
          ...base.timelineDeliveryReceipt,
          id: ids.ga4Baseline,
        },
      }).success,
    ).toBe(false);
    expect(
      MeasurementWindow.safeParse({
        ...base,
        timelineDeliveryReceipt: {
          ...base.timelineDeliveryReceipt,
          artifactContentHash: otherHash,
        },
      }).success,
    ).toBe(false);
    expect(
      MeasurementWindow.safeParse({
        ...base,
        timelineDeliveryReceipt: {
          ...base.timelineDeliveryReceipt,
          contentChecksum: otherHash,
        },
      }).success,
    ).toBe(false);
    expect(
      MeasurementWindow.safeParse({
        ...base,
        timelineDeliveryReceipt: {
          ...base.timelineDeliveryReceipt,
          observedAt: base.verifiedChangeReceipt.observedAt,
        },
      }).success,
    ).toBe(false);
    expect(
      MeasurementWindow.safeParse({
        ...base,
        measurementAnchorReceiptId: ids.deliveryReceipt,
      }).success,
    ).toBe(false);
  });

  it("places before and after windows on opposite sides of the Change Receipt with optional cooling time", () => {
    const base = measurementWindow();

    expect(
      MeasurementWindow.safeParse({
        ...base,
        beforeWindow: {
          ...base.beforeWindow,
          endAt: "2026-06-20T12:00:01Z",
        },
      }).success,
    ).toBe(false);
    expect(
      MeasurementWindow.safeParse({
        ...base,
        afterWindow: {
          ...base.afterWindow,
          startAt: "2026-06-20T11:59:59Z",
        },
      }).success,
    ).toBe(false);
    expect(
      MeasurementWindow.safeParse({
        ...base,
        afterWindow: {
          startAt: "2026-06-14T00:00:00Z",
          endAt: "2026-06-19T00:00:00Z",
        },
      }).success,
    ).toBe(false);
  });

  it("requires a valid IANA timezone and plain HTTP(S) URLs", () => {
    const base = measurementWindow();

    for (const changed of [
      { timezone: "GMT+08:00" },
      { timezone: "Not/A_Real_Zone" },
      { url: "javascript:alert(1)" },
      { canonicalUrl: "https://user:secret@relayops.example/blog/" },
    ]) {
      expect(
        MeasurementWindow.safeParse({ ...base, ...changed }).success,
      ).toBe(false);
    }
  });

  it("requires baseline and outcome Snapshot IDs to differ within every matching provider dimension", () => {
    const base = measurementWindow();

    for (const dimension of ["gsc", "ga4", "geo"] as const) {
      expect(
        MeasurementWindow.safeParse({
          ...base,
          dimensions: {
            ...base.dimensions,
            [dimension]: {
              ...base.dimensions[dimension],
              outcomeSource: {
                ...base.dimensions[dimension].outcomeSource,
                snapshotId:
                  base.dimensions[dimension].baselineSource.snapshotId,
              },
            },
          },
        }).success,
      ).toBe(false);
    }

    expect(
      MeasurementWindow.safeParse({
        ...base,
        dimensions: {
          ...base.dimensions,
          gsc: {
            ...base.dimensions.gsc,
            baselineSource: {
              ...base.dimensions.gsc.baselineSource,
              provider: "ga4",
            },
          },
        },
      }).success,
    ).toBe(false);
  });

  it("requires source coverage windows and observations to match the fixed baseline/outcome windows", () => {
    const base = measurementWindow();

    expect(
      MeasurementWindow.safeParse({
        ...base,
        dimensions: {
          ...base.dimensions,
          gsc: {
            ...base.dimensions.gsc,
            baselineSource: {
              ...base.dimensions.gsc.baselineSource,
              coveredWindow: {
                startAt: "2026-06-02T00:00:00Z",
                endAt: "2026-06-15T00:00:00Z",
              },
            },
          },
        },
      }).success,
    ).toBe(false);
    expect(
      MeasurementWindow.safeParse({
        ...base,
        dimensions: {
          ...base.dimensions,
          gsc: {
            ...base.dimensions.gsc,
            outcomeSource: {
              ...base.dimensions.gsc.outcomeSource,
              observedAt: "2026-07-14T23:59:59Z",
            },
          },
        },
      }).success,
    ).toBe(false);
  });

  it("keeps GSC, GA4, and GEO metrics separate and rejects unknown causal fields", () => {
    const base = measurementWindow();

    expect(
      MeasurementWindow.safeParse({
        ...base,
        dimensions: {
          ...base.dimensions,
          gsc: {
            ...base.dimensions.gsc,
            metrics: {
              ...base.dimensions.gsc.metrics,
              sessions: { baseline: 1, outcome: 2 },
            },
          },
        },
      }).success,
    ).toBe(false);
    expect(
      MeasurementWindow.safeParse({
        ...base,
        causalLift: 0.2,
      }).success,
    ).toBe(false);
    expect(
      MeasurementWindow.safeParse({
        ...base,
        dimensions: {
          ...base.dimensions,
          ga4: {
            ...base.dimensions.ga4,
            upliftPercent: 22,
          },
        },
      }).success,
    ).toBe(false);
  });

  it("keeps UTM source, medium, campaign, and content as unique exact identities", () => {
    const base = measurementWindow();
    const campaign = base.dimensions.ga4.campaigns[0]!;

    for (const field of ["source", "medium", "campaign", "content"] as const) {
      expect(
        MeasurementWindow.safeParse({
          ...base,
          dimensions: {
            ...base.dimensions,
            ga4: {
              ...base.dimensions.ga4,
              campaigns: [
                {
                  ...campaign,
                  identity: {
                    ...campaign.identity,
                    [field]: " ",
                  },
                },
              ],
            },
          },
        }).success,
      ).toBe(false);
    }

    expect(
      MeasurementWindow.safeParse({
        ...base,
        dimensions: {
          ...base.dimensions,
          ga4: {
            ...base.dimensions.ga4,
            campaigns: [campaign, campaign],
          },
        },
      }).success,
    ).toBe(false);
  });

  it("allows an honest empty campaign list when no UTM campaign applies", () => {
    const base = measurementWindow();

    expect(
      MeasurementWindow.safeParse({
        ...base,
        dimensions: {
          ...base.dimensions,
          ga4: {
            ...base.dimensions.ga4,
            campaigns: [],
          },
        },
      }).success,
    ).toBe(true);
  });

  it("preserves zero as an observed value instead of confusing it with unavailable", () => {
    const base = measurementWindow();
    const withMeasuredZero = {
      ...base,
      dimensions: {
        ...base.dimensions,
        ga4: {
          ...base.dimensions.ga4,
          metrics: {
            ...base.dimensions.ga4.metrics,
            directConversions: { baseline: 0, outcome: 0 },
          },
        },
      },
    };

    expect(MeasurementWindow.safeParse(withMeasuredZero).success).toBe(true);
  });

  it("requires unavailable metrics and samples to be explicit nulls with a limitation", () => {
    const base = measurementWindow();
    const unavailable = {
      ...base.dimensions.gsc,
      state: "unavailable" as const,
      sampleSize: {
        baseline: null,
        outcome: null,
        unit: "impressions" as const,
        coverage: "none" as const,
      },
      limitation: "GSC permission was unavailable for both windows.",
      metrics: {
        clicks: { baseline: null, outcome: null },
        impressions: { baseline: null, outcome: null },
        ctr: { baseline: null, outcome: null },
        averagePosition: { baseline: null, outcome: null },
      },
    };

    expect(
      MeasurementWindow.safeParse({
        ...base,
        dimensions: { ...base.dimensions, gsc: unavailable },
      }).success,
    ).toBe(true);
    expect(
      MeasurementWindow.safeParse({
        ...base,
        dimensions: {
          ...base.dimensions,
          gsc: { ...unavailable, limitation: null },
        },
      }).success,
    ).toBe(false);
    expect(
      MeasurementWindow.safeParse({
        ...base,
        dimensions: {
          ...base.dimensions,
          gsc: {
            ...unavailable,
            metrics: {
              ...unavailable.metrics,
              clicks: { baseline: 0, outcome: 0 },
            },
          },
        },
      }).success,
    ).toBe(false);
    const { clicks: _clicks, ...missingClicks } = unavailable.metrics;
    expect(
      MeasurementWindow.safeParse({
        ...base,
        dimensions: {
          ...base.dimensions,
          gsc: { ...unavailable, metrics: missingClicks },
        },
      }).success,
    ).toBe(false);
  });

  it("requires insufficient data to carry partial/none coverage and a limitation", () => {
    const base = measurementWindow();

    expect(
      MeasurementWindow.safeParse({
        ...base,
        dimensions: {
          ...base.dimensions,
          geo: { ...base.dimensions.geo, limitation: null },
        },
      }).success,
    ).toBe(false);
    expect(
      MeasurementWindow.safeParse({
        ...base,
        dimensions: {
          ...base.dimensions,
          geo: {
            ...base.dimensions.geo,
            sampleSize: {
              ...base.dimensions.geo.sampleSize,
              coverage: "complete",
            },
          },
        },
      }).success,
    ).toBe(false);
  });

  it("requires none coverage to have null samples and null metrics even when state is insufficient_data", () => {
    const base = measurementWindow();
    const noneCoverage = {
      ...base.dimensions.geo,
      sampleSize: {
        baseline: null,
        outcome: null,
        unit: "tracked_queries" as const,
        coverage: "none" as const,
      },
      metrics: {
        trackedQueries: { baseline: null, outcome: null },
        citedQueries: { baseline: null, outcome: null },
        citations: { baseline: null, outcome: null },
        citationRate: { baseline: null, outcome: null },
      },
    };

    expect(
      MeasurementWindow.safeParse({
        ...base,
        dimensions: {
          ...base.dimensions,
          geo: noneCoverage,
        },
      }).success,
    ).toBe(true);
    expect(
      MeasurementWindow.safeParse({
        ...base,
        dimensions: {
          ...base.dimensions,
          geo: {
            ...noneCoverage,
            sampleSize: {
              ...noneCoverage.sampleSize,
              baseline: 4,
              outcome: 4,
            },
          },
        },
      }).success,
    ).toBe(false);
    expect(
      MeasurementWindow.safeParse({
        ...base,
        dimensions: {
          ...base.dimensions,
          geo: {
            ...noneCoverage,
            metrics: {
              ...noneCoverage.metrics,
              trackedQueries: { baseline: 4, outcome: 4 },
            },
          },
        },
      }).success,
    ).toBe(false);
  });

  it("requires observed/regressed dimensions to have positive samples and at least one comparable metric", () => {
    const base = measurementWindow();

    expect(
      MeasurementWindow.safeParse({
        ...base,
        dimensions: {
          ...base.dimensions,
          gsc: {
            ...base.dimensions.gsc,
            sampleSize: {
              ...base.dimensions.gsc.sampleSize,
              outcome: 0,
            },
          },
        },
      }).success,
    ).toBe(false);
    expect(
      MeasurementWindow.safeParse({
        ...base,
        dimensions: {
          ...base.dimensions,
          gsc: {
            ...base.dimensions.gsc,
            metrics: {
              clicks: { baseline: null, outcome: null },
              impressions: { baseline: null, outcome: null },
              ctr: { baseline: null, outcome: null },
              averagePosition: { baseline: null, outcome: null },
            },
          },
        },
      }).success,
    ).toBe(false);
  });

  it("requires a stale or unknown provider source to explain its limitation", () => {
    const base = measurementWindow();

    expect(
      MeasurementWindow.safeParse({
        ...base,
        dimensions: {
          ...base.dimensions,
          gsc: {
            ...base.dimensions.gsc,
            baselineSource: {
              ...base.dimensions.gsc.baselineSource,
              freshness: "stale",
            },
          },
        },
      }).success,
    ).toBe(false);
    expect(
      MeasurementWindow.safeParse({
        ...base,
        dimensions: {
          ...base.dimensions,
          gsc: {
            ...base.dimensions.gsc,
            baselineSource: {
              ...base.dimensions.gsc.baselineSource,
              freshness: "stale",
            },
            limitation: "The baseline source exceeded its freshness SLA.",
          },
        },
      }).success,
    ).toBe(true);
  });

  it("binds direct and assisted conversion definitions to distinct explicit attribution boundaries", () => {
    const base = measurementWindow();

    expect(
      MeasurementWindow.safeParse({
        ...base,
        dimensions: {
          ...base.dimensions,
          ga4: {
            ...base.dimensions.ga4,
            assistedConversionDefinition: {
              ...base.dimensions.ga4.assistedConversionDefinition,
              attributionBoundary: "ga4_reported_primary_touchpoint",
            },
          },
        },
      }).success,
    ).toBe(false);
    expect(
      MeasurementWindow.safeParse({
        ...base,
        dimensions: {
          ...base.dimensions,
          ga4: {
            ...base.dimensions.ga4,
            directConversionDefinition:
              base.dimensions.ga4.assistedConversionDefinition,
          },
        },
      }).success,
    ).toBe(false);
  });

  it("ties the aggregate observed/regressed state to an observed/regressed provider dimension", () => {
    const base = measurementWindow();

    expect(
      MeasurementWindow.safeParse({
        ...base,
        state: "regressed",
      }).success,
    ).toBe(false);
    expect(
      MeasurementWindow.safeParse({
        ...base,
        state: "regressed",
        dimensions: {
          ...base.dimensions,
          gsc: { ...base.dimensions.gsc, state: "regressed" },
        },
      }).success,
    ).toBe(true);
    expect(
      MeasurementWindow.safeParse({
        ...base,
        state: "technical_verified",
        technicalVerificationRef: null,
      }).success,
    ).toBe(false);
  });

  it.each(["observed", "technical_verified"] as const)(
    "does not allow aggregate %s to hide a regressed provider dimension",
    (state) => {
      const base = measurementWindow();

      expect(
        MeasurementWindow.safeParse({
          ...base,
          state,
          dimensions: {
            ...base.dimensions,
            geo: {
              ...base.dimensions.geo,
              state: "regressed",
            },
          },
        }).success,
      ).toBe(false);
    },
  );
});

describe("historical projection", () => {
  it("returns bounded, unique immutable windows newest-first for one target", () => {
    const newest = measurementWindow();
    const older = {
      ...measurementWindow(),
      measurementWindowId: "90000000-0000-4000-8000-000000000025",
      recordedAt: "2026-07-16T00:30:00Z",
    };
    const response = {
      projectId: ids.project,
      target: newest.target,
      windows: [newest, older],
      generatedAt: "2026-07-16T02:00:00Z",
    };

    expect(MeasurementWindowHistoryResponse.parse(response)).toEqual(
      response,
    );
    expect(
      MeasurementWindowHistoryResponse.safeParse({
        ...response,
        windows: [older, newest],
      }).success,
    ).toBe(false);
    expect(
      MeasurementWindowHistoryResponse.safeParse({
        ...response,
        windows: [newest, newest],
      }).success,
    ).toBe(false);
    expect(
      MeasurementWindowHistoryResponse.safeParse({
        ...response,
        projectId: ids.site,
      }).success,
    ).toBe(false);
    expect(
      MeasurementWindowHistoryResponse.safeParse({
        ...response,
        target: { ...response.target, sitePageId: ids.site },
      }).success,
    ).toBe(false);
  });
});
