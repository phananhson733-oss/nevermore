import { z } from "zod";
import { SourceFreshness } from "./audit.ts";
import { IdempotencyKey, IsoDateTime, Uuid } from "./common.ts";
import { PublicationChecksum } from "./artifact-approval.ts";
import { PublicationHttpUrl } from "./delivery-connections.ts";
import {
  PublicationChangeReceipt,
  PublicationDeliveryReceipt,
} from "./publication.ts";

const MAX_SAFE_REVISION = Number.MAX_SAFE_INTEGER;
const PositiveRevision = z
  .number()
  .int()
  .positive()
  .max(MAX_SAFE_REVISION);
const BoundedRef = z.string().trim().min(1).max(2048);
const BoundedIdentity = z.string().trim().min(1).max(500);
const BoundedLimitation = z.string().trim().min(1).max(4000);
const NullableLimitation = BoundedLimitation.nullable();
const NonNegativeInteger = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const PositiveInteger = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const PositiveNumber = z.number().finite().positive();
const Ratio = z.number().finite().min(0).max(1);

function parsedAt(value: string): number {
  return Date.parse(value);
}

function equalInterval(
  left: { startAt: string; endAt: string },
  right: { startAt: string; endAt: string },
): boolean {
  return left.startAt === right.startAt && left.endAt === right.endAt;
}

function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const MeasurementState = z.enum([
  "technical_verified",
  "observed",
  "insufficient_data",
  "unavailable",
  "regressed",
]);
export type MeasurementState = z.infer<typeof MeasurementState>;

export const MeasurementObservationState = z.enum([
  "observed",
  "insufficient_data",
  "unavailable",
  "regressed",
]);
export type MeasurementObservationState = z.infer<
  typeof MeasurementObservationState
>;

export const MeasurementWindowInterval = z
  .object({
    startAt: IsoDateTime,
    endAt: IsoDateTime,
  })
  .strict()
  .superRefine((interval, ctx) => {
    if (parsedAt(interval.startAt) >= parsedAt(interval.endAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["endAt"],
        message: "Measurement interval endAt must be later than startAt",
      });
    }
  });
export type MeasurementWindowInterval = z.infer<
  typeof MeasurementWindowInterval
>;

export const MeasurementTimezone = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(isIanaTimezone, "Must be a valid IANA timezone");
export type MeasurementTimezone = z.infer<typeof MeasurementTimezone>;

export const MeasurementTarget = z
  .object({
    kind: z.literal("url"),
    targetRef: BoundedRef,
    sitePageId: Uuid,
  })
  .strict();
export type MeasurementTarget = z.infer<typeof MeasurementTarget>;

export const MeasurementSourceProvider = z.enum(["gsc", "ga4", "geo"]);
export type MeasurementSourceProvider = z.infer<
  typeof MeasurementSourceProvider
>;

function measurementSourceSnapshot<
  TProvider extends MeasurementSourceProvider,
>(provider: TProvider) {
  return z
    .object({
      provider: z.literal(provider),
      sourceRef: Uuid,
      snapshotId: Uuid,
      coveredWindow: MeasurementWindowInterval,
      observedAt: IsoDateTime,
      freshness: SourceFreshness,
    })
    .strict();
}

export const GscMeasurementSourceSnapshot =
  measurementSourceSnapshot("gsc");
export type GscMeasurementSourceSnapshot = z.infer<
  typeof GscMeasurementSourceSnapshot
>;

export const Ga4MeasurementSourceSnapshot =
  measurementSourceSnapshot("ga4");
export type Ga4MeasurementSourceSnapshot = z.infer<
  typeof Ga4MeasurementSourceSnapshot
>;

export const GeoMeasurementSourceSnapshot =
  measurementSourceSnapshot("geo");
export type GeoMeasurementSourceSnapshot = z.infer<
  typeof GeoMeasurementSourceSnapshot
>;

const CountMetricPair = z
  .object({
    baseline: NonNegativeInteger.nullable(),
    outcome: NonNegativeInteger.nullable(),
  })
  .strict();

const RatioMetricPair = z
  .object({
    baseline: Ratio.nullable(),
    outcome: Ratio.nullable(),
  })
  .strict();

const PositiveMetricPair = z
  .object({
    baseline: PositiveNumber.nullable(),
    outcome: PositiveNumber.nullable(),
  })
  .strict();

type MetricPair = {
  readonly baseline: number | null;
  readonly outcome: number | null;
};

type CommonDimensionValue = {
  readonly state: MeasurementObservationState;
  readonly baselineSource: {
    readonly sourceRef: string;
    readonly snapshotId: string;
    readonly freshness: z.infer<typeof SourceFreshness>;
  };
  readonly outcomeSource: {
    readonly sourceRef: string;
    readonly snapshotId: string;
    readonly freshness: z.infer<typeof SourceFreshness>;
  };
  readonly sampleSize: {
    readonly baseline: number | null;
    readonly outcome: number | null;
    readonly coverage: "complete" | "partial" | "none";
  };
  readonly limitation: string | null;
};

function addDimensionIssues(
  dimension: CommonDimensionValue,
  metricPairs: readonly MetricPair[],
  ctx: z.RefinementCtx,
): void {
  if (
    dimension.baselineSource.snapshotId ===
    dimension.outcomeSource.snapshotId
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["outcomeSource", "snapshotId"],
      message:
        "Baseline and outcome Snapshot identities must be different",
    });
  }

  if (
    dimension.baselineSource.sourceRef !==
    dimension.outcomeSource.sourceRef
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["outcomeSource", "sourceRef"],
      message:
        "Baseline and outcome must compare the same canonical source",
    });
  }

  const degradedSource =
    dimension.baselineSource.freshness !== "current" ||
    dimension.outcomeSource.freshness !== "current";
  if (degradedSource && dimension.limitation === null) {
    ctx.addIssue({
      code: "custom",
      path: ["limitation"],
      message: "Stale or unknown source freshness requires a limitation",
    });
  }

  if (
    dimension.sampleSize.coverage === "partial" &&
    dimension.limitation === null
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["limitation"],
      message: "Partial sample coverage requires a limitation",
    });
  }

  if (dimension.sampleSize.coverage === "none") {
    if (
      dimension.sampleSize.baseline !== null ||
      dimension.sampleSize.outcome !== null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["sampleSize"],
        message: "No sample coverage requires explicit null sample sizes",
      });
    }
    metricPairs.forEach((pair, index) => {
      if (pair.baseline !== null || pair.outcome !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["metrics", index],
          message:
            "No sample coverage requires explicit null metric values",
        });
      }
    });
  }

  if (dimension.state === "unavailable") {
    if (dimension.limitation === null) {
      ctx.addIssue({
        code: "custom",
        path: ["limitation"],
        message: "Unavailable measurement data requires a limitation",
      });
    }
    if (
      dimension.sampleSize.coverage !== "none"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["sampleSize"],
        message:
          "Unavailable measurement data requires no sample coverage",
      });
    }
    return;
  }

  if (dimension.state === "insufficient_data") {
    if (dimension.limitation === null) {
      ctx.addIssue({
        code: "custom",
        path: ["limitation"],
        message: "Insufficient measurement data requires a limitation",
      });
    }
    if (dimension.sampleSize.coverage === "complete") {
      ctx.addIssue({
        code: "custom",
        path: ["sampleSize", "coverage"],
        message:
          "Insufficient data must identify partial or absent sample coverage",
      });
    }
    return;
  }

  if (
    dimension.sampleSize.baseline === null ||
    dimension.sampleSize.baseline <= 0 ||
    dimension.sampleSize.outcome === null ||
    dimension.sampleSize.outcome <= 0 ||
    dimension.sampleSize.coverage === "none"
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["sampleSize"],
      message:
        "Observed and regressed dimensions require positive comparable samples",
    });
  }

  if (
    !metricPairs.some(
      (pair) => pair.baseline !== null && pair.outcome !== null,
    )
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["metrics"],
      message:
        "Observed and regressed dimensions require at least one comparable metric",
    });
  }
}

const GscSampleSize = z
  .object({
    baseline: NonNegativeInteger.nullable(),
    outcome: NonNegativeInteger.nullable(),
    unit: z.literal("impressions"),
    coverage: z.enum(["complete", "partial", "none"]),
  })
  .strict();

const GscMetrics = z
  .object({
    clicks: CountMetricPair,
    impressions: CountMetricPair,
    ctr: RatioMetricPair,
    averagePosition: PositiveMetricPair,
  })
  .strict();

export const GscMeasurementDimension = z
  .object({
    provider: z.literal("gsc"),
    state: MeasurementObservationState,
    baselineSource: GscMeasurementSourceSnapshot,
    outcomeSource: GscMeasurementSourceSnapshot,
    sampleSize: GscSampleSize,
    limitation: NullableLimitation,
    metrics: GscMetrics,
  })
  .strict()
  .superRefine((dimension, ctx) => {
    addDimensionIssues(
      dimension,
      Object.values(dimension.metrics),
      ctx,
    );
  });
export type GscMeasurementDimension = z.infer<
  typeof GscMeasurementDimension
>;

export const MeasurementCountingMethod = z.enum([
  "once_per_event",
  "once_per_session",
  "once_per_user",
]);
export type MeasurementCountingMethod = z.infer<
  typeof MeasurementCountingMethod
>;

const ConversionEventNames = z
  .array(BoundedIdentity)
  .min(1)
  .max(50)
  .refine(
    (values) => new Set(values).size === values.length,
    "Conversion event names must be unique",
  );

export const DirectConversionDefinition = z
  .object({
    conversionDefinitionId: Uuid,
    kind: z.literal("direct"),
    eventNames: ConversionEventNames,
    countingMethod: MeasurementCountingMethod,
    attributionBoundary: z.literal(
      "ga4_reported_primary_touchpoint",
    ),
    lookbackWindowDays: PositiveInteger.max(90),
  })
  .strict();
export type DirectConversionDefinition = z.infer<
  typeof DirectConversionDefinition
>;

export const AssistedConversionDefinition = z
  .object({
    conversionDefinitionId: Uuid,
    kind: z.literal("assisted"),
    eventNames: ConversionEventNames,
    countingMethod: MeasurementCountingMethod,
    attributionBoundary: z.literal("path_touchpoint_not_primary"),
    lookbackWindowDays: PositiveInteger.max(90),
  })
  .strict();
export type AssistedConversionDefinition = z.infer<
  typeof AssistedConversionDefinition
>;

export const MeasurementUtmIdentity = z
  .object({
    utmIdentityId: Uuid,
    source: BoundedIdentity,
    medium: BoundedIdentity,
    campaign: BoundedIdentity,
    content: BoundedIdentity,
  })
  .strict();
export type MeasurementUtmIdentity = z.infer<
  typeof MeasurementUtmIdentity
>;

const Ga4SampleSize = z
  .object({
    baseline: NonNegativeInteger.nullable(),
    outcome: NonNegativeInteger.nullable(),
    unit: z.literal("sessions"),
    coverage: z.enum(["complete", "partial", "none"]),
  })
  .strict();

const Ga4Metrics = z
  .object({
    sessions: CountMetricPair,
    engagedSessions: CountMetricPair,
    directConversions: CountMetricPair,
    assistedConversions: CountMetricPair,
  })
  .strict();

const Ga4CampaignMetrics = z
  .object({
    sessions: CountMetricPair,
    directConversions: CountMetricPair,
    assistedConversions: CountMetricPair,
  })
  .strict();

export const Ga4CampaignMeasurement = z
  .object({
    identity: MeasurementUtmIdentity,
    metrics: Ga4CampaignMetrics,
  })
  .strict();
export type Ga4CampaignMeasurement = z.infer<
  typeof Ga4CampaignMeasurement
>;

export const Ga4MeasurementDimension = z
  .object({
    provider: z.literal("ga4"),
    state: MeasurementObservationState,
    baselineSource: Ga4MeasurementSourceSnapshot,
    outcomeSource: Ga4MeasurementSourceSnapshot,
    sampleSize: Ga4SampleSize,
    limitation: NullableLimitation,
    directConversionDefinition: DirectConversionDefinition,
    assistedConversionDefinition: AssistedConversionDefinition,
    metrics: Ga4Metrics,
    campaigns: z.array(Ga4CampaignMeasurement).max(100),
  })
  .strict()
  .superRefine((dimension, ctx) => {
    const metricPairs = [
      ...Object.values(dimension.metrics),
      ...dimension.campaigns.flatMap((campaign) =>
        Object.values(campaign.metrics),
      ),
    ];
    addDimensionIssues(dimension, metricPairs, ctx);

    if (
      dimension.directConversionDefinition.conversionDefinitionId ===
      dimension.assistedConversionDefinition.conversionDefinitionId
    ) {
      ctx.addIssue({
        code: "custom",
        path: [
          "assistedConversionDefinition",
          "conversionDefinitionId",
        ],
        message:
          "Direct and assisted conversion definitions require distinct identities",
      });
    }

    const identities = new Set<string>();
    const tuples = new Set<string>();
    dimension.campaigns.forEach((campaign, index) => {
      const { identity } = campaign;
      if (identities.has(identity.utmIdentityId)) {
        ctx.addIssue({
          code: "custom",
          path: ["campaigns", index, "identity", "utmIdentityId"],
          message: "UTM identities must be unique",
        });
      }
      identities.add(identity.utmIdentityId);

      const tuple = JSON.stringify([
        identity.source,
        identity.medium,
        identity.campaign,
        identity.content,
      ]);
      if (tuples.has(tuple)) {
        ctx.addIssue({
          code: "custom",
          path: ["campaigns", index, "identity"],
          message: "UTM source/medium/campaign/content tuples must be unique",
        });
      }
      tuples.add(tuple);
    });
  });
export type Ga4MeasurementDimension = z.infer<
  typeof Ga4MeasurementDimension
>;

const GeoSampleSize = z
  .object({
    baseline: NonNegativeInteger.nullable(),
    outcome: NonNegativeInteger.nullable(),
    unit: z.literal("tracked_queries"),
    coverage: z.enum(["complete", "partial", "none"]),
  })
  .strict();

const GeoMetrics = z
  .object({
    trackedQueries: CountMetricPair,
    citedQueries: CountMetricPair,
    citations: CountMetricPair,
    citationRate: RatioMetricPair,
  })
  .strict();

export const GeoMeasurementDimension = z
  .object({
    provider: z.literal("geo"),
    state: MeasurementObservationState,
    baselineSource: GeoMeasurementSourceSnapshot,
    outcomeSource: GeoMeasurementSourceSnapshot,
    sampleSize: GeoSampleSize,
    limitation: NullableLimitation,
    metrics: GeoMetrics,
  })
  .strict()
  .superRefine((dimension, ctx) => {
    addDimensionIssues(
      dimension,
      Object.values(dimension.metrics),
      ctx,
    );
  });
export type GeoMeasurementDimension = z.infer<
  typeof GeoMeasurementDimension
>;

export const MeasurementDimensions = z
  .object({
    gsc: GscMeasurementDimension,
    ga4: Ga4MeasurementDimension,
    geo: GeoMeasurementDimension,
  })
  .strict();
export type MeasurementDimensions = z.infer<
  typeof MeasurementDimensions
>;

/**
 * The browser identifies only the verified Change Receipt that starts the
 * measurement lifecycle. Target, revision, timestamps, source snapshots and
 * results are all resolved and persisted by the server.
 */
export const CreateMeasurementWindowRequest = z
  .object({
    changeReceiptId: Uuid,
    idempotencyKey: IdempotencyKey,
  })
  .strict();
export type CreateMeasurementWindowRequest = z.infer<
  typeof CreateMeasurementWindowRequest
>;

export const MeasurementWindowAccepted = z
  .object({
    measurementWindowId: Uuid,
    asyncRunId: Uuid,
    state: z.literal("pending"),
    replayed: z.boolean(),
  })
  .strict();
export type MeasurementWindowAccepted = z.infer<
  typeof MeasurementWindowAccepted
>;

const MeasurementWindowObject = z
  .object({
    measurementWindowId: Uuid,
    projectId: Uuid,
    siteId: Uuid,
    target: MeasurementTarget,
    actionId: Uuid,
    artifactId: Uuid,
    artifactRevisionId: Uuid,
    artifactRevision: PositiveRevision,
    artifactContentHash: PublicationChecksum,
    publicationAttemptId: Uuid,
    verifiedChangeReceipt: PublicationChangeReceipt,
    /**
     * Display/audit lineage only. It never starts the outcome clock and may be
     * absent from a historical projection.
     */
    timelineDeliveryReceipt: PublicationDeliveryReceipt.nullable(),
    beforeWindow: MeasurementWindowInterval,
    afterWindow: MeasurementWindowInterval,
    timezone: MeasurementTimezone,
    url: PublicationHttpUrl,
    canonicalUrl: PublicationHttpUrl,
    interpretation: z.literal("observational_non_causal"),
    state: MeasurementState,
    technicalVerificationRef: Uuid.nullable(),
    limitation: NullableLimitation,
    dimensions: MeasurementDimensions,
    recordedAt: IsoDateTime,
  })
  .strict();

type MeasurementWindowValue = z.infer<typeof MeasurementWindowObject>;

function addLineageIssues(
  window: MeasurementWindowValue,
  ctx: z.RefinementCtx,
): void {
  const change = window.verifiedChangeReceipt;
  if (window.artifactContentHash !== change.artifactContentHash) {
    ctx.addIssue({
      code: "custom",
      path: ["artifactContentHash"],
      message:
        "Measurement Artifact identity must match the verified Change Receipt",
    });
  }
  if (window.canonicalUrl !== change.liveCanonicalUrl) {
    ctx.addIssue({
      code: "custom",
      path: ["canonicalUrl"],
      message:
        "Measurement canonical URL must match the verified live Change Receipt URL",
    });
  }

  const delivery = window.timelineDeliveryReceipt;
  if (delivery !== null) {
    if (delivery.id !== change.predecessorDeliveryReceiptId) {
      ctx.addIssue({
        code: "custom",
        path: ["timelineDeliveryReceipt", "id"],
        message:
          "Timeline Delivery Receipt must be the Change Receipt predecessor",
      });
    }
    if (
      delivery.providerKind !== change.providerKind ||
      delivery.remoteScopeRef !== change.remoteScopeRef ||
      delivery.artifactContentHash !== change.artifactContentHash ||
      delivery.contentChecksum !== change.contentChecksum
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["timelineDeliveryReceipt"],
        message:
          "Timeline Delivery and Change Receipt lineage must match",
      });
    }
    if (parsedAt(delivery.observedAt) >= parsedAt(change.observedAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["timelineDeliveryReceipt", "observedAt"],
        message:
          "Timeline Delivery Receipt must precede the verified Change Receipt",
      });
    }
  }
}

function addWindowIssues(
  window: MeasurementWindowValue,
  ctx: z.RefinementCtx,
): void {
  const changeAt = parsedAt(window.verifiedChangeReceipt.observedAt);
  if (parsedAt(window.beforeWindow.endAt) > changeAt) {
    ctx.addIssue({
      code: "custom",
      path: ["beforeWindow", "endAt"],
      message:
        "Baseline window must end at or before the verified Change Receipt",
    });
  }
  if (parsedAt(window.afterWindow.startAt) < changeAt) {
    ctx.addIssue({
      code: "custom",
      path: ["afterWindow", "startAt"],
      message:
        "Outcome window must start at or after the verified Change Receipt",
    });
  }
  if (
    parsedAt(window.afterWindow.startAt) <
    parsedAt(window.beforeWindow.endAt)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["afterWindow", "startAt"],
      message:
        "Outcome window must be later than and cannot overlap the baseline window",
    });
  }

  const snapshots: string[] = [];
  for (const [dimensionName, dimension] of Object.entries(
    window.dimensions,
  )) {
    snapshots.push(
      dimension.baselineSource.snapshotId,
      dimension.outcomeSource.snapshotId,
    );
    for (const [phase, source, expectedWindow] of [
      ["baselineSource", dimension.baselineSource, window.beforeWindow],
      ["outcomeSource", dimension.outcomeSource, window.afterWindow],
    ] as const) {
      if (!equalInterval(source.coveredWindow, expectedWindow)) {
        ctx.addIssue({
          code: "custom",
          path: ["dimensions", dimensionName, phase, "coveredWindow"],
          message:
            "Provider Snapshot coverage must match its immutable measurement window",
        });
      }
      if (
        parsedAt(source.observedAt) <
        parsedAt(source.coveredWindow.endAt)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["dimensions", dimensionName, phase, "observedAt"],
          message:
            "Provider Snapshot cannot be observed before its covered window ends",
        });
      }
    }
  }
  if (new Set(snapshots).size !== snapshots.length) {
    ctx.addIssue({
      code: "custom",
      path: ["dimensions"],
      message:
        "Every provider baseline/outcome Snapshot requires a distinct immutable identity",
    });
  }

  const latestSourceObservedAt = Math.max(
    ...Object.values(window.dimensions).flatMap((dimension) => [
      parsedAt(dimension.baselineSource.observedAt),
      parsedAt(dimension.outcomeSource.observedAt),
    ]),
  );
  if (
    parsedAt(window.recordedAt) < parsedAt(window.afterWindow.endAt) ||
    parsedAt(window.recordedAt) < latestSourceObservedAt
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["recordedAt"],
      message:
        "A final measurement record cannot predate its outcome window or source observations",
    });
  }
}

function addAggregateStateIssues(
  window: MeasurementWindowValue,
  ctx: z.RefinementCtx,
): void {
  const states = Object.values(window.dimensions).map(
    (dimension) => dimension.state,
  );

  if (
    (window.state === "unavailable" ||
      window.state === "insufficient_data") &&
    window.limitation === null
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["limitation"],
      message: `${window.state} measurement state requires a limitation`,
    });
  }
  if (
    window.state === "technical_verified" &&
    window.technicalVerificationRef === null
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["technicalVerificationRef"],
      message:
        "technical_verified requires an immutable technical recheck reference",
    });
  }
  if (
    states.includes("regressed") &&
    window.state !== "regressed"
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["state"],
      message:
        "Any regressed provider dimension requires a regressed aggregate state",
    });
  }
  if (
    window.state === "observed" &&
    !states.includes("observed")
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["state"],
      message: "Observed aggregate state requires an observed dimension",
    });
  }
  if (
    window.state === "regressed" &&
    !states.includes("regressed")
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["state"],
      message: "Regressed aggregate state requires a regressed dimension",
    });
  }
  if (
    window.state === "unavailable" &&
    !states.every((state) => state === "unavailable")
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["state"],
      message:
        "Unavailable aggregate state requires every provider dimension to be unavailable",
    });
  }
  if (
    window.state === "insufficient_data" &&
    (!states.some((state) => state === "insufficient_data") ||
      states.some(
        (state) => state === "observed" || state === "regressed",
      ))
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["state"],
      message:
        "Insufficient aggregate state requires insufficient/unavailable provider dimensions only",
    });
  }
}

/**
 * Immutable, server-authored measurement result. All comparisons preserve
 * baseline/outcome values and source lineage; no field attributes causal lift
 * to an Action or Artifact.
 */
export const MeasurementWindow = MeasurementWindowObject.superRefine(
  (window, ctx) => {
    addLineageIssues(window, ctx);
    addWindowIssues(window, ctx);
    addAggregateStateIssues(window, ctx);
  },
);
export type MeasurementWindow = z.infer<typeof MeasurementWindow>;

export const MeasurementWindowHistoryResponse = z
  .object({
    projectId: Uuid,
    target: MeasurementTarget,
    windows: z.array(MeasurementWindow).max(100),
    generatedAt: IsoDateTime,
  })
  .strict()
  .superRefine((response, ctx) => {
    const identities = new Set<string>();
    response.windows.forEach((window, index) => {
      if (identities.has(window.measurementWindowId)) {
        ctx.addIssue({
          code: "custom",
          path: ["windows", index, "measurementWindowId"],
          message:
            "Historical measurement window identities must be unique",
        });
      }
      identities.add(window.measurementWindowId);

      if (window.projectId !== response.projectId) {
        ctx.addIssue({
          code: "custom",
          path: ["windows", index, "projectId"],
          message:
            "Historical measurement windows cannot cross project scope",
        });
      }
      if (
        window.target.kind !== response.target.kind ||
        window.target.targetRef !== response.target.targetRef ||
        window.target.sitePageId !== response.target.sitePageId
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["windows", index, "target"],
          message:
            "Historical measurement windows must share the requested exact target",
        });
      }
      if (parsedAt(window.recordedAt) > parsedAt(response.generatedAt)) {
        ctx.addIssue({
          code: "custom",
          path: ["generatedAt"],
          message:
            "Historical projection cannot be generated before a projected record",
        });
      }
      if (
        index > 0 &&
        parsedAt(response.windows[index - 1]!.recordedAt) <
          parsedAt(window.recordedAt)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["windows", index, "recordedAt"],
          message:
            "Historical measurement windows must be ordered newest-first",
        });
      }
    });
  });
export type MeasurementWindowHistoryResponse = z.infer<
  typeof MeasurementWindowHistoryResponse
>;
