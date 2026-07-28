import {
  MeasurementDimensions as MeasurementDimensionsSchema,
  type MeasurementDimensions,
  type MeasurementWindowInterval,
} from "@sf/contracts";
import type {
  DataSnapshotRow,
  MeasurementProviderEvidence,
  ObservationRow,
} from "@sf/db";
import { z } from "zod";

const DAY_MS = 86_400_000;
const PROVIDER_FRESHNESS_MS = 3 * DAY_MS;
const GSC_METRIC_KEY = "gsc.page.v1";
const GA4_METRIC_KEY = "ga4.landing.v1";
const GEO_METRIC_KEY = "geo.page_citations.v1";

const NonNegative = z.number().finite().nonnegative();
const NullableNonNegative = NonNegative.nullable();
const GscWindowValue = z
  .object({
    clicks: NonNegative,
    impressions: NonNegative,
    position: NullableNonNegative,
  })
  .passthrough();
const GscValue = z
  .object({
    previous28d: GscWindowValue,
    current28d: GscWindowValue,
  })
  .passthrough();
const Ga4Value = z
  .object({
    sessions: NonNegative,
    engagedSessions: NullableNonNegative,
  })
  .passthrough();
const GeoValue = z
  .object({
    schemaVersion: z.literal("1"),
    marketCode: z.string().regex(/^[A-Z]{2}$/u),
    languageTag: z.string().trim().min(1).max(255),
    querySetHash: z.string().regex(/^[a-f0-9]{64}$/u),
    trackedQueries: z.number().int().positive(),
    citedQueries: z.number().int().nonnegative(),
    citations: z.number().int().nonnegative(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (value.citedQueries > value.trackedQueries) {
      ctx.addIssue({
        code: "custom",
        path: ["citedQueries"],
        message:
          "GEO cited queries cannot exceed the observed query cohort",
      });
    }
    if (value.citations < value.citedQueries) {
      ctx.addIssue({
        code: "custom",
        path: ["citations"],
        message:
          "Each cited GEO query must contribute at least one citation",
      });
    }
  });

interface ProjectionInput {
  readonly siteId: string;
  readonly sitePageId: string;
  readonly beforeWindow: MeasurementWindowInterval;
  readonly afterWindow: MeasurementWindowInterval;
  readonly recordedAt: string;
  readonly snapshots?: readonly DataSnapshotRow[];
  readonly observations?: readonly ObservationRow[];
  readonly providerEvidence?: readonly MeasurementProviderEvidence[];
}

export interface ProjectedMeasurementDimensions {
  readonly dimensions: MeasurementDimensions;
  readonly observationLineage: {
    readonly gsc: {
      readonly baselineObservationId: string | null;
      readonly outcomeObservationId: string | null;
    };
    readonly ga4: {
      readonly baselineObservationId: string | null;
      readonly outcomeObservationId: string | null;
    };
    readonly geo: {
      readonly baselineObservationId: string | null;
      readonly outcomeObservationId: string | null;
    };
  };
}

interface CanonicalPair {
  readonly snapshotId: string;
  readonly sourceConnectionId: string;
  readonly provider: "gsc" | "ga4" | "geo";
  readonly snapshotAvailability: string;
  readonly snapshotLimitation: string;
  readonly observationId: string;
  readonly observedAt: string;
  readonly observationLimitation: string;
  readonly valueJson: unknown;
  readonly sourceWindow: MeasurementWindowInterval;
}

/**
 * Pure projection from immutable collection rows. There is deliberately no
 * provider call, guessed identifier, or zero fallback in this mapper.
 */
export function projectMeasurementDimensions(
  input: ProjectionInput,
): ProjectedMeasurementDimensions {
  const pairs = canonicalPairs(input);
  const gsc = projectGsc(input, pairs.filter(isGscPair));
  const ga4 = projectGa4(input, pairs.filter(isGa4Pair));
  const geo = projectGeo(input, pairs.filter(isGeoPair));
  const dimensions = MeasurementDimensionsSchema.parse({
    gsc: gsc.dimension,
    ga4: ga4.dimension,
    geo: geo.dimension,
  });

  return {
    dimensions,
    observationLineage: {
      gsc: gsc.lineage,
      ga4: ga4.lineage,
      geo: geo.lineage,
    },
  };
}

function canonicalPairs(input: ProjectionInput): CanonicalPair[] {
  const snapshots = new Map(
    (input.snapshots ?? [])
      .filter(
        (snapshot) =>
          snapshot.site_id === input.siteId &&
          (snapshot.provider === "gsc" ||
            snapshot.provider === "ga4" ||
            snapshot.provider === "geo") &&
          snapshot.source_connection_id !== null &&
          (snapshot.availability === "available" ||
            snapshot.availability === "partial"),
      )
      .map((snapshot) => [snapshot.id, snapshot] as const),
  );

  const legacyPairs = (input.observations ?? []).flatMap(
    (observation) => {
      const snapshot = snapshots.get(observation.snapshot_id);
      if (
        !snapshot ||
        observation.site_page_id !== input.sitePageId ||
        observation.provider !== snapshot.provider ||
        observation.subject_type !== "url" ||
        observation.availability !== "available" ||
        !(
          (observation.provider === "gsc" &&
            observation.metric_key === GSC_METRIC_KEY) ||
          (observation.provider === "ga4" &&
            observation.metric_key === GA4_METRIC_KEY) ||
          (observation.provider === "geo" &&
            observation.metric_key === GEO_METRIC_KEY)
        )
      ) {
        return [];
      }
      const sourceWindow = parseSourceWindow(
        snapshot.source_window,
      );
      if (
        sourceWindow === null ||
        Date.parse(observation.observed_at) <
          Date.parse(sourceWindow.endAt)
      ) {
        return [];
      }
      return [
        {
          snapshotId: snapshot.id,
          sourceConnectionId: snapshot.source_connection_id!,
          provider: snapshot.provider as "gsc" | "ga4" | "geo",
          snapshotAvailability: snapshot.availability,
          snapshotLimitation: snapshot.limitation,
          observationId: observation.id,
          observedAt: observation.observed_at,
          observationLimitation: observation.limitation,
          valueJson: observation.value_json,
          sourceWindow,
        },
      ];
    },
  );
  const canonicalEvidence = (input.providerEvidence ?? []).flatMap(
    (evidence) => {
      if (
        evidence.sitePageId !== input.sitePageId ||
        evidence.sourceConnectionId === null ||
        (evidence.provider !== "gsc" &&
          evidence.provider !== "ga4" &&
          evidence.provider !== "geo") ||
        evidence.observationAvailability !== "available" ||
        !(
          (evidence.provider === "gsc" &&
            evidence.metricKey === GSC_METRIC_KEY) ||
          (evidence.provider === "ga4" &&
            evidence.metricKey === GA4_METRIC_KEY) ||
          (evidence.provider === "geo" &&
            evidence.metricKey === GEO_METRIC_KEY)
        ) ||
        evidence.subjectType !== "url" ||
        Date.parse(evidence.observedAt) <
          Date.parse(evidence.coveredWindow.endAt)
      ) {
        return [];
      }
      return [
        {
          snapshotId: evidence.snapshotId,
          sourceConnectionId: evidence.sourceConnectionId,
          provider: evidence.provider as
            | "gsc"
            | "ga4"
            | "geo",
          snapshotAvailability: evidence.snapshotAvailability,
          snapshotLimitation: evidence.snapshotLimitation,
          observationId: evidence.observationId,
          observedAt: evidence.observedAt,
          observationLimitation:
            evidence.observationLimitation,
          valueJson: evidence.valueJson,
          sourceWindow: evidence.coveredWindow,
        },
      ];
    },
  );
  return [...legacyPairs, ...canonicalEvidence];
}

function isGscPair(pair: CanonicalPair): boolean {
  return pair.provider === "gsc";
}

function isGa4Pair(pair: CanonicalPair): boolean {
  return pair.provider === "ga4";
}

function isGeoPair(pair: CanonicalPair): boolean {
  return pair.provider === "geo";
}

function projectGsc(
  input: ProjectionInput,
  pairs: readonly CanonicalPair[],
) {
  const parsed = pairs.flatMap((pair) => {
    const value = GscValue.safeParse(pair.valueJson);
    return value.success ? [{ ...pair, value: value.data }] : [];
  });
  const full = parsed
    .filter(
      (pair) =>
        pair.sourceWindow.startAt === input.beforeWindow.startAt &&
        pair.sourceWindow.endAt === input.afterWindow.endAt &&
        Date.parse(pair.observedAt) >=
          Date.parse(input.afterWindow.endAt),
    )
    .sort(compareCanonicalPairs)[0];

  if (full) {
    const source = sourceProjection(full, input.recordedAt, "gsc");
    const previous = full.value.previous28d;
    const current = full.value.current28d;
    const comparable =
      previous.impressions > 0 &&
      current.impressions > 0 &&
      full.snapshotAvailability === "available";
    const limitation = comparable
      ? combinedLimitation(
          full.snapshotLimitation,
          full.observationLimitation,
          source.freshness === "current"
            ? null
            : "GSC evidence is outside the current freshness policy.",
        )
      : combinedLimitation(
          "GSC has canonical evidence, but its sample or collection coverage is insufficient for a complete comparison.",
          full.snapshotLimitation,
          full.observationLimitation,
        );
    return {
      dimension: {
        provider: "gsc" as const,
        state: comparable
          ? ("observed" as const)
          : ("insufficient_data" as const),
        baselineSource: source,
        outcomeSource: source,
        sampleSize: {
          baseline: previous.impressions,
          outcome: current.impressions,
          unit: "impressions" as const,
          coverage: comparable
            ? ("complete" as const)
            : ("partial" as const),
        },
        limitation,
        metrics: {
          clicks: {
            baseline: previous.clicks,
            outcome: current.clicks,
          },
          impressions: {
            baseline: previous.impressions,
            outcome: current.impressions,
          },
          ctr: {
            baseline: ratio(previous.clicks, previous.impressions),
            outcome: ratio(current.clicks, current.impressions),
          },
          averagePosition: {
            baseline: positiveOrNull(previous.position),
            outcome: positiveOrNull(current.position),
          },
        },
      },
      lineage: {
        baselineObservationId: full.observationId,
        outcomeObservationId: full.observationId,
      },
    };
  }

  const partial = parsed
    .filter(
      (pair) =>
        overlaps(pair.sourceWindow, input.beforeWindow) ||
        overlaps(pair.sourceWindow, input.afterWindow),
    )
    .sort(compareCanonicalPairs)[0];
  if (partial) {
    const source = sourceProjection(
      partial,
      input.recordedAt,
      "gsc",
    );
    const hasBaseline = overlaps(
      partial.sourceWindow,
      input.beforeWindow,
    );
    const hasOutcome = overlaps(
      partial.sourceWindow,
      input.afterWindow,
    );
    return {
      dimension: {
        provider: "gsc" as const,
        state: "insufficient_data" as const,
        baselineSource: hasBaseline ? source : null,
        outcomeSource: hasOutcome ? source : null,
        sampleSize: {
          baseline: null,
          outcome: null,
          unit: "impressions" as const,
          coverage: "partial" as const,
        },
        limitation: combinedLimitation(
          "Canonical GSC evidence does not contain both fixed measurement phases; no phase metrics were inferred.",
          partial.snapshotLimitation,
          partial.observationLimitation,
        ),
        metrics: nullMetricPairs([
          "clicks",
          "impressions",
          "ctr",
          "averagePosition",
        ]),
      },
      lineage: {
        baselineObservationId: hasBaseline
          ? partial.observationId
          : null,
        outcomeObservationId: hasOutcome
          ? partial.observationId
          : null,
      },
    };
  }

  return {
    dimension: unavailableGsc(),
    lineage: {
      baselineObservationId: null,
      outcomeObservationId: null,
    },
  };
}

function projectGa4(
  input: ProjectionInput,
  pairs: readonly CanonicalPair[],
) {
  const parsed = pairs.flatMap((pair) => {
    const value = Ga4Value.safeParse(pair.valueJson);
    return value.success
      ? [
          {
            ...pair,
            value: value.data,
            metricWindow: trailingMetricWindow(pair.sourceWindow),
          },
        ]
      : [];
  });
  const bySource = new Map<string, typeof parsed>();
  for (const pair of parsed) {
    const sourceRef = pair.sourceConnectionId;
    bySource.set(sourceRef, [
      ...(bySource.get(sourceRef) ?? []),
      pair,
    ]);
  }

  let selected:
    | {
        baseline: (typeof parsed)[number] | null;
        outcome: (typeof parsed)[number] | null;
        score: number;
      }
    | undefined;
  for (const candidates of bySource.values()) {
    const baseline = selectGa4Phase(candidates, input.beforeWindow);
    const outcome = selectGa4Phase(
      candidates.filter(
        (candidate) =>
          candidate.snapshotId !== baseline?.snapshotId,
      ),
      input.afterWindow,
    );
    const score =
      phaseScore(baseline, input.beforeWindow) +
      phaseScore(outcome, input.afterWindow);
    if (!selected || score > selected.score) {
      selected = { baseline, outcome, score };
    }
  }

  const baseline = selected?.baseline ?? null;
  const outcome = selected?.outcome ?? null;
  if (baseline === null && outcome === null) {
    return {
      dimension: unavailableGa4(),
      lineage: {
        baselineObservationId: null,
        outcomeObservationId: null,
      },
    };
  }

  const baselineExact =
    baseline !== null &&
    contains(baseline.metricWindow, input.beforeWindow);
  const outcomeExact =
    outcome !== null &&
    contains(outcome.metricWindow, input.afterWindow);
  const baselineValue = baselineExact ? baseline!.value : null;
  const outcomeValue = outcomeExact ? outcome!.value : null;

  return {
    dimension: {
      provider: "ga4" as const,
      state: "insufficient_data" as const,
      baselineSource: baseline
        ? sourceProjection(baseline, input.recordedAt, "ga4")
        : null,
      outcomeSource: outcome
        ? sourceProjection(outcome, input.recordedAt, "ga4")
        : null,
      sampleSize: {
        baseline: baselineValue?.sessions ?? null,
        outcome: outcomeValue?.sessions ?? null,
        unit: "sessions" as const,
        coverage: "partial" as const,
      },
      limitation: combinedLimitation(
        "GA4 sessions are observational only; governed direct and assisted conversion-definition writers are not available, so conversion and Campaign results remain null.",
        baseline?.snapshotLimitation,
        baseline?.observationLimitation,
        outcome?.snapshotLimitation,
        outcome?.observationLimitation,
      ),
      directConversionDefinition: null,
      assistedConversionDefinition: null,
      metrics: {
        sessions: {
          baseline: baselineValue?.sessions ?? null,
          outcome: outcomeValue?.sessions ?? null,
        },
        engagedSessions: {
          baseline: baselineValue?.engagedSessions ?? null,
          outcome: outcomeValue?.engagedSessions ?? null,
        },
        directConversions: { baseline: null, outcome: null },
        assistedConversions: { baseline: null, outcome: null },
      },
      campaigns: [],
    },
    lineage: {
      baselineObservationId: baseline?.observationId ?? null,
      outcomeObservationId: outcome?.observationId ?? null,
    },
  };
}

function projectGeo(
  input: ProjectionInput,
  pairs: readonly CanonicalPair[],
) {
  const parsed = pairs.flatMap((pair) => {
    const value = GeoValue.safeParse(pair.valueJson);
    return value.success ? [{ ...pair, value: value.data }] : [];
  });
  const bySource = new Map<string, typeof parsed>();
  for (const pair of parsed) {
    bySource.set(pair.sourceConnectionId, [
      ...(bySource.get(pair.sourceConnectionId) ?? []),
      pair,
    ]);
  }

  let selected:
    | {
        baseline: (typeof parsed)[number] | null;
        outcome: (typeof parsed)[number] | null;
        score: number;
        sourceRef: string;
      }
    | undefined;
  for (const [sourceRef, candidates] of bySource) {
    const baseline = selectGeoPhase(candidates, input.beforeWindow);
    const outcome = selectGeoPhase(
      candidates.filter(
        (candidate) =>
          candidate.snapshotId !== baseline?.snapshotId &&
          candidate.observationId !== baseline?.observationId,
      ),
      input.afterWindow,
    );
    const comparable =
      baseline !== null &&
      outcome !== null &&
      sameGeoCohort(baseline.value, outcome.value);
    const score =
      Number(baseline !== null) * 100 +
      Number(outcome !== null) * 100 +
      Number(comparable) * 50;
    if (
      !selected ||
      score > selected.score ||
      (score === selected.score &&
        sourceRef.localeCompare(selected.sourceRef) < 0)
    ) {
      selected = { baseline, outcome, score, sourceRef };
    }
  }

  const baseline = selected?.baseline ?? null;
  const outcome = selected?.outcome ?? null;
  if (baseline === null && outcome === null) {
    return {
      dimension: unavailableGeo(),
      lineage: {
        baselineObservationId: null,
        outcomeObservationId: null,
      },
    };
  }

  const comparable =
    baseline !== null &&
    outcome !== null &&
    sameGeoCohort(baseline.value, outcome.value);
  const complete =
    comparable &&
    contains(baseline.sourceWindow, input.beforeWindow) &&
    contains(outcome.sourceWindow, input.afterWindow) &&
    baseline.snapshotAvailability === "available" &&
    outcome.snapshotAvailability === "available";
  const cohortLimitation =
    baseline !== null &&
    outcome !== null &&
    !sameGeoCohort(baseline.value, outcome.value)
      ? "Baseline and outcome GEO observations use different market, language, or query cohorts; they are shown as separate observations and are not treated as a comparable change."
      : null;

  return {
    dimension: {
      provider: "geo" as const,
      state: comparable
        ? ("observed" as const)
        : ("insufficient_data" as const),
      baselineSource: baseline
        ? sourceProjection(baseline, input.recordedAt, "geo")
        : null,
      outcomeSource: outcome
        ? sourceProjection(outcome, input.recordedAt, "geo")
        : null,
      sampleSize: {
        baseline: baseline?.value.trackedQueries ?? null,
        outcome: outcome?.value.trackedQueries ?? null,
        unit: "tracked_queries" as const,
        coverage: complete
          ? ("complete" as const)
          : ("partial" as const),
      },
      limitation: combinedLimitation(
        "GEO citations are observational point-in-time answer evidence; model, account, locale, and collection-time differences can change results and no causal attribution is claimed.",
        cohortLimitation,
        baseline?.snapshotLimitation,
        baseline?.observationLimitation,
        outcome?.snapshotLimitation,
        outcome?.observationLimitation,
      ),
      metrics: {
        trackedQueries: {
          baseline: baseline?.value.trackedQueries ?? null,
          outcome: outcome?.value.trackedQueries ?? null,
        },
        citedQueries: {
          baseline: baseline?.value.citedQueries ?? null,
          outcome: outcome?.value.citedQueries ?? null,
        },
        citations: {
          baseline: baseline?.value.citations ?? null,
          outcome: outcome?.value.citations ?? null,
        },
        citationRate: {
          baseline: baseline
            ? ratio(
                baseline.value.citedQueries,
                baseline.value.trackedQueries,
              )
            : null,
          outcome: outcome
            ? ratio(
                outcome.value.citedQueries,
                outcome.value.trackedQueries,
              )
            : null,
        },
      },
    },
    lineage: {
      baselineObservationId: baseline?.observationId ?? null,
      outcomeObservationId: outcome?.observationId ?? null,
    },
  };
}

function unavailableGsc() {
  return {
    provider: "gsc" as const,
    state: "unavailable" as const,
    baselineSource: null,
    outcomeSource: null,
    sampleSize: {
      baseline: null,
      outcome: null,
      unit: "impressions" as const,
      coverage: "none" as const,
    },
    limitation:
      "No canonical GSC snapshot and normalized page observation are available for this measurement target.",
    metrics: nullMetricPairs([
      "clicks",
      "impressions",
      "ctr",
      "averagePosition",
    ]),
  };
}

function unavailableGa4() {
  return {
    provider: "ga4" as const,
    state: "unavailable" as const,
    baselineSource: null,
    outcomeSource: null,
    sampleSize: {
      baseline: null,
      outcome: null,
      unit: "sessions" as const,
      coverage: "none" as const,
    },
    limitation:
      "No canonical GA4 snapshot and normalized landing-page observation are available for this measurement target.",
    directConversionDefinition: null,
    assistedConversionDefinition: null,
    metrics: nullMetricPairs([
      "sessions",
      "engagedSessions",
      "directConversions",
      "assistedConversions",
    ]),
    campaigns: [],
  };
}

function unavailableGeo() {
  return {
    provider: "geo" as const,
    state: "unavailable" as const,
    baselineSource: null,
    outcomeSource: null,
    sampleSize: {
      baseline: null,
      outcome: null,
      unit: "tracked_queries" as const,
      coverage: "none" as const,
    },
    limitation:
      "No canonical GEO citation snapshot and page observation are available for this measurement target.",
    metrics: nullMetricPairs([
      "trackedQueries",
      "citedQueries",
      "citations",
      "citationRate",
    ]),
  };
}

function sourceProjection(
  pair: CanonicalPair,
  recordedAt: string,
  provider: "gsc" | "ga4" | "geo",
) {
  return {
    provider,
    sourceRef: pair.sourceConnectionId,
    snapshotId: pair.snapshotId,
    coveredWindow: pair.sourceWindow,
    observedAt: canonicalInstant(pair.observedAt),
    freshness: freshness(pair.observedAt, recordedAt),
  };
}

function selectGeoPhase<T extends CanonicalPair>(
  candidates: readonly T[],
  target: MeasurementWindowInterval,
): T | null {
  return (
    [...candidates]
      .filter((candidate) => overlaps(candidate.sourceWindow, target))
      .sort((left, right) => {
        const containment =
          Number(contains(right.sourceWindow, target)) -
          Number(contains(left.sourceWindow, target));
        if (containment !== 0) return containment;
        const time =
          Date.parse(right.observedAt) -
          Date.parse(left.observedAt);
        return (
          time ||
          left.observationId.localeCompare(right.observationId)
        );
      })[0] ?? null
  );
}

function sameGeoCohort(
  baseline: z.infer<typeof GeoValue>,
  outcome: z.infer<typeof GeoValue>,
): boolean {
  return (
    baseline.marketCode === outcome.marketCode &&
    baseline.languageTag.toLowerCase() ===
      outcome.languageTag.toLowerCase() &&
    baseline.querySetHash === outcome.querySetHash
  );
}

function freshness(
  observedAt: string,
  recordedAt: string,
): "current" | "stale" | "unknown" {
  const age = Date.parse(recordedAt) - Date.parse(observedAt);
  if (!Number.isFinite(age) || age < 0) return "unknown";
  return age <= PROVIDER_FRESHNESS_MS ? "current" : "stale";
}

function selectGa4Phase<T extends CanonicalPair & {
  readonly metricWindow: MeasurementWindowInterval;
}>(
  candidates: readonly T[],
  target: MeasurementWindowInterval,
): T | null {
  return (
    [...candidates]
      .filter((candidate) => overlaps(candidate.metricWindow, target))
      .sort((left, right) => {
        const coverage =
          Number(contains(right.metricWindow, target)) -
          Number(contains(left.metricWindow, target));
        return coverage || compareCanonicalPairs(left, right);
      })[0] ?? null
  );
}

function phaseScore(
  candidate:
    | (CanonicalPair & {
        readonly metricWindow: MeasurementWindowInterval;
      })
    | null,
  target: MeasurementWindowInterval,
): number {
  if (!candidate) return 0;
  return contains(candidate.metricWindow, target) ? 100 : 1;
}

function trailingMetricWindow(
  sourceWindow: MeasurementWindowInterval,
): MeasurementWindowInterval {
  const start = Date.parse(sourceWindow.startAt);
  const end = Date.parse(sourceWindow.endAt);
  const trailingStart = Math.max(start, end - 28 * DAY_MS);
  return {
    startAt: new Date(trailingStart).toISOString(),
    endAt: new Date(end).toISOString(),
  };
}

function parseSourceWindow(
  sourceWindow: Record<string, unknown>,
): MeasurementWindowInterval | null {
  const start = sourceWindow["start"];
  const end = sourceWindow["end"];
  if (typeof start !== "string" || typeof end !== "string") return null;
  const startAt = parseBoundary(start, false);
  const endAt = parseBoundary(end, true);
  if (
    startAt === null ||
    endAt === null ||
    Date.parse(startAt) >= Date.parse(endAt)
  ) {
    return null;
  }
  return { startAt, endAt };
}

function parseBoundary(
  value: string,
  inclusiveDateEnd: boolean,
): string | null {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/u.test(value);
  const instant = Date.parse(dateOnly ? `${value}T00:00:00.000Z` : value);
  if (!Number.isFinite(instant)) return null;
  return new Date(
    instant + (dateOnly && inclusiveDateEnd ? DAY_MS : 0),
  ).toISOString();
}

function canonicalInstant(value: string): string {
  return new Date(Date.parse(value)).toISOString();
}

function contains(
  container: MeasurementWindowInterval,
  contained: MeasurementWindowInterval,
): boolean {
  return (
    Date.parse(container.startAt) <= Date.parse(contained.startAt) &&
    Date.parse(container.endAt) >= Date.parse(contained.endAt)
  );
}

function overlaps(
  left: MeasurementWindowInterval,
  right: MeasurementWindowInterval,
): boolean {
  return (
    Date.parse(left.startAt) < Date.parse(right.endAt) &&
    Date.parse(left.endAt) > Date.parse(right.startAt)
  );
}

function compareCanonicalPairs(
  left: CanonicalPair,
  right: CanonicalPair,
): number {
  const time =
    Date.parse(left.observedAt) - Date.parse(right.observedAt);
  return time || left.observationId.localeCompare(right.observationId);
}

function ratio(
  numerator: number,
  denominator: number,
): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function positiveOrNull(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

function combinedLimitation(
  ...values: readonly (string | null | undefined)[]
): string | null {
  const unique = [
    ...new Set(
      values
        .map((value) => value?.trim() ?? "")
        .filter((value) => value.length > 0),
    ),
  ];
  return unique.length === 0
    ? null
    : unique.join(" ").slice(0, 4_000);
}

function nullMetricPairs<const TKey extends string>(
  keys: readonly TKey[],
): Record<TKey, { readonly baseline: null; readonly outcome: null }> {
  return Object.fromEntries(
    keys.map((key) => [
      key,
      { baseline: null, outcome: null },
    ]),
  ) as Record<
    TKey,
    { readonly baseline: null; readonly outcome: null }
  >;
}
