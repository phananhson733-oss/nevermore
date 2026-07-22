import {
  canonicalUtcTimestamptz,
  canonicalize,
  contentHash,
  isTimestamptzInstant,
  sameTimestamptzInstant,
  sha256Hex,
  type CanonicalValue,
} from "@sf/db";
import type {
  GrowthMapCoverage,
  GrowthMapUrlMetricObservation,
} from "@sf/contracts";
import { isStale } from "./source-mappers";

const MANIFEST_KEYS = [
  "deliveryLocale",
  "icp",
  "projectId",
  "promptSetVersion",
  "ruleSetVersion",
  "siteId",
  "snapshots",
] as const;
const ICP_KEYS = ["contentHash", "id", "version"] as const;
const SNAPSHOT_KEYS = [
  "availability",
  "capturedAt",
  "checksum",
  "datasetKey",
  "methodVersion",
  "provider",
  "schemaVersion",
  "snapshotId",
  "sourceWindow",
] as const;
const READABLE_RUN_STATUSES = new Set(["completed", "partial"]);
const USABLE_CRAWL_AVAILABILITIES = new Set(["available", "partial"]);
const SNAPSHOT_AVAILABILITIES = new Set([
  "available",
  "partial",
  "unavailable",
]);

export interface GrowthMapReadableRunLike {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly icp_profile_id: string;
  readonly icp_profile_version: number;
  readonly rule_set_version: string;
  readonly prompt_set_version: string;
  readonly output_locale: string;
  readonly input_manifest: Record<string, unknown>;
  readonly input_hash: string;
  readonly run_status: string;
  readonly run_completed_at: string | null;
}

export interface GrowthMapSnapshotLike {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly provider: string;
  readonly dataset_key: string;
  readonly schema_version: string;
  readonly method_version: string;
  readonly captured_at: string;
  readonly source_window: Record<string, unknown>;
  readonly availability: string;
  readonly checksum: string;
}

export interface FrozenGrowthMapRun {
  readonly runId: string;
  readonly siteId: string;
  readonly crawlSnapshotId: string;
  readonly snapshotIds: readonly string[];
  readonly snapshotsById: ReadonlyMap<string, GrowthMapSnapshotLike>;
  readonly snapshotsByProvider: ReadonlyMap<string, GrowthMapSnapshotLike>;
}

export interface GrowthMapObservationLike {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly snapshot_id: string;
  readonly site_page_id: string | null;
  readonly provider: string;
  readonly metric_key: string;
  readonly subject_type: string;
  readonly subject_ref: string;
  readonly observed_at: string;
  readonly availability: string;
  readonly value_numeric: string | null;
  readonly value_text: string | null;
  readonly value_json: unknown;
  readonly unit: string | null;
  readonly limitation: string;
  readonly origin?: string;
  readonly method?: string;
  readonly grade?: string;
  readonly support?: string;
}

export interface GrowthMapPageTitleInput {
  readonly normalizedUrl: string;
  readonly contentHash: string;
  readonly canonicalExtract: string | null;
  readonly extract: Record<string, unknown>;
}

function invalidFrozenRun(): never {
  throw new Error("Frozen Growth Map run or snapshot lineage is inconsistent.");
}

function invalidPageSnapshot(): never {
  throw new Error("Content-addressed PageSnapshot lineage is inconsistent.");
}

function invalidMetric(): never {
  throw new Error("Frozen Growth Map metric Observation lineage is inconsistent.");
}

function invalidFindingSummary(): never {
  throw new Error("Customer-facing Finding summary is missing or out of bounds.");
}

function isZhCn(locale: string): boolean {
  return locale.toLowerCase() === "zh-cn";
}

type ObservationAvailability = "available" | "partial" | "unavailable";

function availabilityCopy(
  availability: ObservationAvailability,
  outputLocale: string,
): string {
  if (!isZhCn(outputLocale)) return availability;
  if (availability === "available") return "可用";
  if (availability === "partial") return "部分可用";
  return "不可用";
}

export interface GrowthMapProjectionCopy {
  readonly partialRun: string;
  readonly priorityUnavailable: string;
  readonly deltaUnavailable: string;
  readonly staleMetricSuffix: string;
  readonly missingSnapshot: (provider: string) => string;
  readonly snapshotAvailability: (
    provider: string,
    availability: ObservationAvailability,
  ) => string;
  readonly staleSnapshot: (provider: string) => string;
  readonly missingPageSnapshot: string;
  readonly missingUrlObservation: (provider: string) => string;
  readonly urlObservationAvailability: (
    provider: string,
    availability: ObservationAvailability,
  ) => string;
}

/** Generated workbench copy follows the frozen DiagnosticRun locale. */
export function growthMapProjectionCopy(
  outputLocale: string,
): GrowthMapProjectionCopy {
  if (isZhCn(outputLocale)) {
    return {
      partialRun: "最新一次已完成的诊断仅覆盖了部分数据。",
      priorityUnavailable: "当前诊断没有指向该 URL 的 Finding。",
      deltaUnavailable: "该 URL 尚无两个不可变复查锚点，无法计算变化。",
      staleMetricSuffix: "数据快照已超过该数据源的新鲜度期限。",
      missingSnapshot: (provider) =>
        `本次诊断未冻结 ${provider.toUpperCase()} 数据快照。`,
      snapshotAvailability: (provider, availability) =>
        `冻结的 ${provider.toUpperCase()} 数据快照状态为${availabilityCopy(availability, outputLocale)}。`,
      staleSnapshot: (provider) =>
        `冻结的 ${provider.toUpperCase()} 数据快照已超过该数据源的新鲜度期限。`,
      missingPageSnapshot: "该 URL 没有可用的冻结 Crawl PageSnapshot。",
      missingUrlObservation: (provider) =>
        `该页面没有可用的冻结 ${provider.toUpperCase()} URL Observation。`,
      urlObservationAvailability: (provider, availability) =>
        `该页面的冻结 ${provider.toUpperCase()} URL Observation 状态为${availabilityCopy(availability, outputLocale)}。`,
    };
  }
  return {
    partialRun: "The latest completed diagnostic run has partial coverage.",
    priorityUnavailable: "No current-run Finding targets this URL.",
    deltaUnavailable:
      "No two immutable recheck anchors are available for this URL.",
    staleMetricSuffix: "Snapshot is stale under the provider freshness policy.",
    missingSnapshot: (provider) =>
      `No ${provider.toUpperCase()} snapshot was frozen in this diagnostic run.`,
    snapshotAvailability: (provider, availability) =>
      `The frozen ${provider.toUpperCase()} snapshot is ${availability}.`,
    staleSnapshot: (provider) =>
      `The frozen ${provider.toUpperCase()} snapshot is stale under its provider policy.`,
    missingPageSnapshot:
      "No frozen Crawl PageSnapshot is available for this URL.",
    missingUrlObservation: (provider) =>
      `No frozen ${provider.toUpperCase()} URL Observation is available for this page.`,
    urlObservationAvailability: (provider, availability) =>
      `The frozen ${provider.toUpperCase()} URL Observation is ${availability}.`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
): string {
  const candidate = value[key];
  if (
    typeof candidate !== "string" ||
    candidate.length === 0 ||
    candidate.trim() !== candidate
  ) {
    invalidFrozenRun();
  }
  return candidate;
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  try {
    return (
      canonicalize(left as CanonicalValue) ===
      canonicalize(right as CanonicalValue)
    );
  } catch {
    return false;
  }
}

/** Normalize strict PostgreSQL/ISO timestamptz text at the wire boundary. */
export function growthMapIsoInstant(value: string): string {
  try {
    return canonicalUtcTimestamptz(value);
  } catch {
    throw new Error("Growth Map timestamp is not a strict zoned instant.");
  }
}

/**
 * Revalidate the complete frozen run at the read boundary. This intentionally
 * repeats the worker's checks: a later mutable source pointer or a partially
 * matching manifest must never become Growth Map truth.
 */
export function validateGrowthMapFrozenRun(
  run: GrowthMapReadableRunLike,
  actualSnapshots: readonly GrowthMapSnapshotLike[],
  scope: { readonly workspaceId: string; readonly projectId: string },
): FrozenGrowthMapRun {
  const manifest = run.input_manifest;
  if (
    run.workspace_id !== scope.workspaceId ||
    run.project_id !== scope.projectId ||
    !READABLE_RUN_STATUSES.has(run.run_status) ||
    run.run_completed_at === null ||
    !isTimestamptzInstant(run.run_completed_at) ||
    !hasExactKeys(manifest, MANIFEST_KEYS) ||
    contentHash(manifest as CanonicalValue) !== run.input_hash ||
    manifest["projectId"] !== run.project_id ||
    manifest["siteId"] !== run.site_id ||
    manifest["ruleSetVersion"] !== run.rule_set_version ||
    manifest["promptSetVersion"] !== run.prompt_set_version ||
    manifest["deliveryLocale"] !== run.output_locale
  ) {
    invalidFrozenRun();
  }

  const rawIcp = manifest["icp"];
  if (!isRecord(rawIcp) || !hasExactKeys(rawIcp, ICP_KEYS)) {
    invalidFrozenRun();
  }
  const icpVersion = rawIcp["version"];
  if (
    requiredString(rawIcp, "id") !== run.icp_profile_id ||
    !Number.isInteger(icpVersion) ||
    (icpVersion as number) < 1 ||
    icpVersion !== run.icp_profile_version ||
    requiredString(rawIcp, "contentHash").length !== 64
  ) {
    invalidFrozenRun();
  }

  const rawSnapshots = manifest["snapshots"];
  if (!Array.isArray(rawSnapshots) || rawSnapshots.length === 0) {
    invalidFrozenRun();
  }
  const actualById = new Map(actualSnapshots.map((row) => [row.id, row]));
  if (actualById.size !== actualSnapshots.length) invalidFrozenRun();
  if (actualSnapshots.length !== rawSnapshots.length) invalidFrozenRun();

  const snapshotIds: string[] = [];
  const snapshotsByProvider = new Map<string, GrowthMapSnapshotLike>();
  let crawlSnapshotId: string | null = null;
  for (const rawSnapshot of rawSnapshots) {
    if (!isRecord(rawSnapshot) || !hasExactKeys(rawSnapshot, SNAPSHOT_KEYS)) {
      invalidFrozenRun();
    }
    const snapshotId = requiredString(rawSnapshot, "snapshotId");
    const provider = requiredString(rawSnapshot, "provider");
    const actual = actualById.get(snapshotId);
    const sourceWindow = rawSnapshot["sourceWindow"];
    const manifestCapturedAt = requiredString(rawSnapshot, "capturedAt");
    if (
      !actual ||
      snapshotsByProvider.has(provider) ||
      snapshotIds.includes(snapshotId) ||
      !isRecord(sourceWindow) ||
      actual.workspace_id !== scope.workspaceId ||
      actual.project_id !== scope.projectId ||
      actual.site_id !== run.site_id ||
      actual.provider !== provider ||
      actual.dataset_key !== requiredString(rawSnapshot, "datasetKey") ||
      actual.schema_version !== requiredString(rawSnapshot, "schemaVersion") ||
      actual.method_version !== requiredString(rawSnapshot, "methodVersion") ||
      actual.checksum !== requiredString(rawSnapshot, "checksum") ||
      !sameTimestamptzInstant(actual.captured_at, manifestCapturedAt) ||
      !SNAPSHOT_AVAILABILITIES.has(actual.availability) ||
      actual.availability !== requiredString(rawSnapshot, "availability") ||
      !sameCanonicalValue(actual.source_window, sourceWindow)
    ) {
      invalidFrozenRun();
    }
    snapshotIds.push(snapshotId);
    snapshotsByProvider.set(provider, actual);
    if (
      provider === "crawl" &&
      USABLE_CRAWL_AVAILABILITIES.has(actual.availability)
    ) {
      if (crawlSnapshotId !== null) invalidFrozenRun();
      crawlSnapshotId = snapshotId;
    }
  }

  if (crawlSnapshotId === null) invalidFrozenRun();
  return {
    runId: run.id,
    siteId: run.site_id,
    crawlSnapshotId,
    snapshotIds,
    snapshotsById: actualById,
    snapshotsByProvider,
  };
}

/** Page title is never read from mutable SitePage or an unrelated Observation. */
export function verifiedGrowthMapPageTitle(
  input: GrowthMapPageTitleInput,
): string | null {
  let canonical: string;
  try {
    canonical = canonicalize(input.extract as CanonicalValue);
  } catch {
    invalidPageSnapshot();
  }
  if (
    sha256Hex(canonical) !== input.contentHash ||
    (input.canonicalExtract !== null && input.canonicalExtract !== canonical)
  ) {
    invalidPageSnapshot();
  }
  const schemaVersion = input.extract["schemaVersion"];
  const depth = input.extract["depth"];
  const subjectUrl = input.extract["subjectUrl"];
  const projection = input.extract["projection"];
  if (
    schemaVersion !== "crawl.page-extract.v1" ||
    !Number.isInteger(depth) ||
    (depth as number) < 0 ||
    typeof subjectUrl !== "string" ||
    !isRecord(projection) ||
    projection["fetchUrl"] !== input.normalizedUrl
  ) {
    invalidPageSnapshot();
  }
  const title = projection["title"];
  if (title === null || title === undefined) return null;
  if (typeof title !== "string") invalidPageSnapshot();
  const normalized = title.trim();
  return normalized.length > 0 && normalized.length <= 500 ? normalized : null;
}

export interface GrowthMapUrlCoverageInput {
  readonly hasPageSnapshot: boolean;
  readonly analyticsAvailability: Readonly<
    Partial<Record<"gsc" | "ga4", "available" | "partial" | "unavailable">>
  >;
}

/** URL completeness takes precedence over otherwise complete-but-stale sources. */
export function projectGrowthMapUrlCoverage(
  base: GrowthMapCoverage,
  input: GrowthMapUrlCoverageInput,
  outputLocale = "en",
): GrowthMapCoverage {
  const copy = growthMapProjectionCopy(outputLocale);
  const limitations = [...base.limitations];
  let urlIsPartial = false;
  if (!input.hasPageSnapshot) {
    urlIsPartial = true;
    limitations.push(copy.missingPageSnapshot);
  }
  for (const provider of ["gsc", "ga4"] as const) {
    const availability = input.analyticsAvailability[provider];
    if (availability === undefined) {
      urlIsPartial = true;
      limitations.push(copy.missingUrlObservation(provider));
    } else if (availability !== "available") {
      urlIsPartial = true;
      limitations.push(copy.urlObservationAvailability(provider, availability));
    }
  }
  const uniqueLimitations = [...new Set(limitations)].slice(0, 100);
  if (urlIsPartial || base.availability === "partial") {
    return { availability: "partial", limitations: uniqueLimitations };
  }
  if (base.availability === "unavailable") {
    return { availability: "unavailable", limitations: uniqueLimitations };
  }
  if (base.availability === "stale") {
    return { availability: "stale", limitations: uniqueLimitations };
  }
  return { availability: "available", limitations: [] };
}

/** Internal title keys are not customer copy and must never be a fallback. */
export function assertGrowthMapFindingSummaryLocale(
  summaryLocale: string,
  outputLocale: string,
): void {
  const normalizedSummaryLocale = summaryLocale.trim().toLowerCase();
  const normalizedOutputLocale = outputLocale.trim().toLowerCase();
  if (
    normalizedSummaryLocale.length === 0 ||
    normalizedSummaryLocale !== normalizedOutputLocale
  ) {
    invalidFindingSummary();
  }
}

export function customerFacingGrowthMapFindingTitle(
  summary: string,
  summaryLocale = "en",
  outputLocale = "en",
): string {
  assertGrowthMapFindingSummaryLocale(summaryLocale, outputLocale);
  const title = summary.trim();
  if (title.length === 0 || title.length > 500) invalidFindingSummary();
  return title;
}

interface MetricRegistration {
  readonly provider: "crawl" | "gsc" | "ga4";
  readonly metricKey: "crawl.page.v1" | "gsc.page.v1" | "ga4.landing.v1";
  readonly pointers: readonly string[];
}

type RegisteredMetricIdentity =
  | { readonly provider: "crawl"; readonly metricKey: "crawl.page.v1" }
  | { readonly provider: "gsc"; readonly metricKey: "gsc.page.v1" }
  | { readonly provider: "ga4"; readonly metricKey: "ga4.landing.v1" };

const METRIC_REGISTRATIONS: readonly MetricRegistration[] = [
  {
    provider: "crawl",
    metricKey: "crawl.page.v1",
    pointers: ["/status", "/finalStatus", "/wordCount", "/responseMs"],
  },
  {
    provider: "gsc",
    metricKey: "gsc.page.v1",
    pointers: [
      "/current28d/clicks",
      "/current28d/impressions",
      "/current28d/position",
      "/previous28d/clicks",
      "/previous28d/impressions",
      "/previous28d/position",
    ],
  },
  {
    provider: "ga4",
    metricKey: "ga4.landing.v1",
    pointers: [
      "/sessions",
      "/engagedSessions",
      "/engagementRate",
      "/keyEvents",
    ],
  },
] as const;

function metricRegistration(
  observation: GrowthMapObservationLike,
): MetricRegistration | null {
  return (
    METRIC_REGISTRATIONS.find(
      (candidate) =>
        candidate.provider === observation.provider &&
        candidate.metricKey === observation.metric_key,
    ) ?? null
  );
}

function registeredMetricIdentity(
  registration: MetricRegistration,
): RegisteredMetricIdentity {
  if (
    registration.provider === "crawl" &&
    registration.metricKey === "crawl.page.v1"
  ) {
    return { provider: "crawl", metricKey: "crawl.page.v1" };
  }
  if (
    registration.provider === "gsc" &&
    registration.metricKey === "gsc.page.v1"
  ) {
    return { provider: "gsc", metricKey: "gsc.page.v1" };
  }
  if (
    registration.provider === "ga4" &&
    registration.metricKey === "ga4.landing.v1"
  ) {
    return { provider: "ga4", metricKey: "ga4.landing.v1" };
  }
  return invalidMetric();
}

const MISSING_METRIC_VALUE = Symbol("missing_growth_map_metric_value");

function pointerValue(
  root: unknown,
  pointer: string,
): unknown | typeof MISSING_METRIC_VALUE {
  let current = root;
  for (const segment of pointer.slice(1).split("/")) {
    if (!isRecord(current)) invalidMetric();
    if (!(segment in current)) return MISSING_METRIC_VALUE;
    current = current[segment];
  }
  return current;
}

/**
 * Project only the registered scalar fields. Null or missing scalars stay
 * absent; an observed zero survives because its immutable Observation ID and
 * JSON pointer distinguish it from missing data.
 */
export function projectGrowthMapMetricObservations(
  observations: readonly GrowthMapObservationLike[],
  snapshotsById: ReadonlyMap<string, GrowthMapSnapshotLike>,
  now: Date,
): GrowthMapUrlMetricObservation[] {
  const projected: GrowthMapUrlMetricObservation[] = [];
  const seenObservationIds = new Set<string>();
  for (const observation of observations) {
    const registration = metricRegistration(observation);
    if (registration === null) continue;
    const snapshot = snapshotsById.get(observation.snapshot_id);
    if (
      !snapshot ||
      snapshot.workspace_id !== observation.workspace_id ||
      snapshot.project_id !== observation.project_id ||
      snapshot.provider !== observation.provider ||
      observation.subject_type !== "url" ||
      observation.site_page_id === null ||
      !sameTimestamptzInstant(
        observation.observed_at,
        snapshot.captured_at,
      ) ||
      seenObservationIds.has(observation.id)
    ) {
      invalidMetric();
    }
    seenObservationIds.add(observation.id);
    if (
      observation.availability !== "available" &&
      observation.availability !== "partial" &&
      observation.availability !== "unavailable"
    ) {
      invalidMetric();
    }
    if (observation.availability !== "available") {
      if (
        observation.value_numeric !== null ||
        observation.value_text !== null ||
        observation.value_json !== null
      ) {
        invalidMetric();
      }
      continue;
    }
    if (
      observation.value_numeric !== null ||
      observation.value_text !== null ||
      !isRecord(observation.value_json)
    ) {
      invalidMetric();
    }

    const stale = isStale(
      observation.provider,
      snapshot.captured_at,
      now.getTime(),
    );
    for (const pointer of registration.pointers) {
      const value = pointerValue(observation.value_json, pointer);
      if (value === MISSING_METRIC_VALUE || value === null) continue;
      if (typeof value !== "number" || !Number.isFinite(value)) invalidMetric();
      const identity = registeredMetricIdentity(registration);
      const projection = {
        ...identity,
        subjectRef: observation.subject_ref,
        valueSource: { kind: "value_json", pointer },
        value,
        unit: observation.unit,
        availability: "available",
        snapshotId: observation.snapshot_id,
        observationId: observation.id,
        sitePageId: observation.site_page_id,
        observedAt: growthMapIsoInstant(observation.observed_at),
        freshness: stale ? "stale" : "current",
        // The provider limitation is immutable provenance. Freshness has its
        // own typed field (and localized coverage copy), so never concatenate
        // generated UI language into the provider's original wording.
        limitation: observation.limitation.trim() || null,
      } satisfies GrowthMapUrlMetricObservation;
      projected.push(projection);
    }
  }
  return projected;
}
