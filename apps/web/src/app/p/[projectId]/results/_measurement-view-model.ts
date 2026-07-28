import type {
  Ga4CampaignMeasurement,
  MeasurementObservationState,
  MeasurementState,
  MeasurementWindow,
  MeasurementWindowInterval,
} from "@sf/contracts";

export type MeasurementTrend =
  | "improved"
  | "regressed"
  | "unchanged"
  | "unavailable";

export type MeasurementMetricFormat =
  | "count"
  | "percentage"
  | "position";

export type MeasurementMetricKey =
  | "gscClicks"
  | "gscImpressions"
  | "gscCtr"
  | "gscAveragePosition"
  | "ga4Sessions"
  | "ga4EngagedSessions"
  | "ga4DirectConversions"
  | "ga4AssistedConversions"
  | "geoTrackedQueries"
  | "geoCitedQueries"
  | "geoCitations"
  | "geoCitationRate";

export interface MeasurementMetricView {
  readonly key: MeasurementMetricKey;
  readonly baseline: string | null;
  readonly outcome: string | null;
  readonly delta: string | null;
  readonly trend: MeasurementTrend;
}

export interface MeasurementCampaignView {
  readonly id: string;
  readonly source: string;
  readonly medium: string;
  readonly campaign: string;
  readonly content: string;
  readonly sessions: MeasurementMetricView;
  readonly directConversions: MeasurementMetricView;
  readonly assistedConversions: MeasurementMetricView;
}

export interface MeasurementDimensionView {
  readonly state: MeasurementObservationState;
  readonly metrics: readonly MeasurementMetricView[];
  readonly limitation: string | null;
  readonly sampleBaseline: number | null;
  readonly sampleOutcome: number | null;
  readonly sampleCoverage: "complete" | "partial" | "none";
}

export interface MeasurementWindowView {
  readonly id: string;
  readonly canonicalUrl: string;
  readonly state: MeasurementState;
  readonly baselineWindow: string;
  readonly outcomeWindow: string;
  readonly changedAt: string;
  readonly recordedAt: string;
  readonly deliveryProvider: "github" | "wordpress";
  readonly deliveryUrl: string | null;
  readonly technicalVerificationRef: string | null;
  readonly gsc: MeasurementDimensionView;
  readonly ga4: MeasurementDimensionView;
  readonly geo: MeasurementDimensionView;
  readonly campaigns: readonly MeasurementCampaignView[];
  readonly limitations: readonly string[];
}

interface MetricPair {
  readonly baseline: number | null;
  readonly outcome: number | null;
}

function formatNumber(
  value: number,
  format: MeasurementMetricFormat,
  locale: string,
): string {
  if (format === "percentage") {
    return new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(value);
  }
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: format === "position" ? 1 : 0,
  }).format(value);
}

function signedDelta(
  value: number,
  format: MeasurementMetricFormat,
  locale: string,
): string {
  const absolute = formatNumber(Math.abs(value), format, locale);
  if (value === 0) return absolute;
  return `${value > 0 ? "+" : "−"}${absolute}`;
}

export function measurementMetricView(
  key: MeasurementMetricKey,
  pair: MetricPair,
  format: MeasurementMetricFormat,
  locale: string,
  betterWhen: "increase" | "decrease" = "increase",
): MeasurementMetricView {
  if (pair.baseline === null || pair.outcome === null) {
    return {
      key,
      baseline:
        pair.baseline === null
          ? null
          : formatNumber(pair.baseline, format, locale),
      outcome:
        pair.outcome === null
          ? null
          : formatNumber(pair.outcome, format, locale),
      delta: null,
      trend: "unavailable",
    };
  }

  const delta = pair.outcome - pair.baseline;
  const improved =
    betterWhen === "increase" ? delta > 0 : delta < 0;
  return {
    key,
    baseline: formatNumber(pair.baseline, format, locale),
    outcome: formatNumber(pair.outcome, format, locale),
    delta: signedDelta(delta, format, locale),
    trend:
      delta === 0 ? "unchanged" : improved ? "improved" : "regressed",
  };
}

function formatInstant(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatWindow(
  value: MeasurementWindowInterval,
  locale: string,
): string {
  const format = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  });
  return `${format.format(new Date(value.startAt))} – ${format.format(
    new Date(value.endAt),
  )}`;
}

function campaignView(
  value: Ga4CampaignMeasurement,
  locale: string,
): MeasurementCampaignView {
  return {
    id: value.identity.utmIdentityId,
    source: value.identity.source,
    medium: value.identity.medium,
    campaign: value.identity.campaign,
    content: value.identity.content,
    sessions: measurementMetricView(
      "ga4Sessions",
      value.metrics.sessions,
      "count",
      locale,
    ),
    directConversions: measurementMetricView(
      "ga4DirectConversions",
      value.metrics.directConversions,
      "count",
      locale,
    ),
    assistedConversions: measurementMetricView(
      "ga4AssistedConversions",
      value.metrics.assistedConversions,
      "count",
      locale,
    ),
  };
}

function uniqueLimitations(
  window: MeasurementWindow,
): readonly string[] {
  return [
    window.limitation,
    window.dimensions.gsc.limitation,
    window.dimensions.ga4.limitation,
    window.dimensions.geo.limitation,
  ].filter(
    (value, index, values): value is string =>
      value !== null && values.indexOf(value) === index,
  );
}

export function measurementWindowView(
  window: MeasurementWindow,
  locale: string,
): MeasurementWindowView {
  const { gsc, ga4, geo } = window.dimensions;
  return {
    id: window.measurementWindowId,
    canonicalUrl: window.canonicalUrl,
    state: window.state,
    baselineWindow: formatWindow(window.beforeWindow, locale),
    outcomeWindow: formatWindow(window.afterWindow, locale),
    changedAt: formatInstant(
      window.verifiedChangeReceipt.observedAt,
      locale,
    ),
    recordedAt: formatInstant(window.recordedAt, locale),
    deliveryProvider: window.verifiedChangeReceipt.providerKind,
    deliveryUrl: window.verifiedChangeReceipt.deliveryUrl,
    technicalVerificationRef: window.technicalVerificationRef,
    gsc: {
      state: gsc.state,
      metrics: [
        measurementMetricView(
          "gscClicks",
          gsc.metrics.clicks,
          "count",
          locale,
        ),
        measurementMetricView(
          "gscImpressions",
          gsc.metrics.impressions,
          "count",
          locale,
        ),
        measurementMetricView(
          "gscCtr",
          gsc.metrics.ctr,
          "percentage",
          locale,
        ),
        measurementMetricView(
          "gscAveragePosition",
          gsc.metrics.averagePosition,
          "position",
          locale,
          "decrease",
        ),
      ],
      limitation: gsc.limitation,
      sampleBaseline: gsc.sampleSize.baseline,
      sampleOutcome: gsc.sampleSize.outcome,
      sampleCoverage: gsc.sampleSize.coverage,
    },
    ga4: {
      state: ga4.state,
      metrics: [
        measurementMetricView(
          "ga4Sessions",
          ga4.metrics.sessions,
          "count",
          locale,
        ),
        measurementMetricView(
          "ga4EngagedSessions",
          ga4.metrics.engagedSessions,
          "count",
          locale,
        ),
        measurementMetricView(
          "ga4DirectConversions",
          ga4.metrics.directConversions,
          "count",
          locale,
        ),
        measurementMetricView(
          "ga4AssistedConversions",
          ga4.metrics.assistedConversions,
          "count",
          locale,
        ),
      ],
      limitation: ga4.limitation,
      sampleBaseline: ga4.sampleSize.baseline,
      sampleOutcome: ga4.sampleSize.outcome,
      sampleCoverage: ga4.sampleSize.coverage,
    },
    geo: {
      state: geo.state,
      metrics: [
        measurementMetricView(
          "geoTrackedQueries",
          geo.metrics.trackedQueries,
          "count",
          locale,
        ),
        measurementMetricView(
          "geoCitedQueries",
          geo.metrics.citedQueries,
          "count",
          locale,
        ),
        measurementMetricView(
          "geoCitations",
          geo.metrics.citations,
          "count",
          locale,
        ),
        measurementMetricView(
          "geoCitationRate",
          geo.metrics.citationRate,
          "percentage",
          locale,
        ),
      ],
      limitation: geo.limitation,
      sampleBaseline: geo.sampleSize.baseline,
      sampleOutcome: geo.sampleSize.outcome,
      sampleCoverage: geo.sampleSize.coverage,
    },
    campaigns: ga4.campaigns.map((campaign) =>
      campaignView(campaign, locale),
    ),
    limitations: uniqueLimitations(window),
  };
}

export function selectMeasurementWindow(
  windows: readonly MeasurementWindow[],
  selectedId: string | null,
): MeasurementWindow | null {
  if (windows.length === 0) return null;
  if (selectedId !== null) {
    const selected = windows.find(
      (window) => window.measurementWindowId === selectedId,
    );
    if (selected) return selected;
  }
  return windows[0] ?? null;
}
