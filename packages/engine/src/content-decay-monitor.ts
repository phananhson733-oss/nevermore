import { canonicalizeUrl } from "@sf/sources";

/**
 * Deterministic content-decay monitor.
 *
 * This projection deliberately consumes immutable GSC snapshot/observation
 * facts supplied by a repository boundary. It has no clock, database, network,
 * queue, or write side effect, so both the Overview read model and a future
 * monthly scheduler can reuse exactly the same decision semantics.
 */

export const CONTENT_DECAY_MONITOR_VERSION = "content-decay-monitor.v1";
export const CONTENT_DECAY_TRAFFIC_THRESHOLD = -0.2;
export const CONTENT_DECAY_RANK_THRESHOLD = 5;

const GSC_PROVIDER = "gsc";
const GSC_DATASET = "gsc.page_query_daily.v1";
const GSC_METHOD = "gsc.page_query_daily.v1";
const GSC_METRIC = "gsc.page.v1";
const DAY_MS = 86_400_000;
const EXPECTED_SOURCE_WINDOW_DAYS = 56;

export type ContentDecayAvailability =
  | "available"
  | "partial"
  | "unavailable";

export interface ContentDecayTimeZoneResolution {
  readonly timeZone: string;
  readonly source: "provider" | "project" | "fallback";
  readonly limitations: readonly string[];
}

export interface ContentDecayPage {
  readonly sitePageId: string;
  readonly normalizedUrl: string;
}

export interface ContentDecaySnapshotCandidate {
  readonly snapshotId: string;
  readonly provider: string;
  readonly datasetKey: string;
  readonly methodVersion: string;
  readonly availability: ContentDecayAvailability;
  readonly capturedAt: string;
  readonly sourceWindow: {
    readonly start: string;
    readonly end: string;
  };
}

export interface ContentDecayObservationCandidate {
  readonly observationId: string;
  readonly snapshotId: string;
  readonly sitePageId: string | null;
  readonly subjectRef: string;
  readonly provider: string;
  readonly metricKey: string;
  readonly availability: ContentDecayAvailability;
  readonly observedAt: string;
  readonly current28d: {
    readonly clicks: number | null;
    readonly impressions: number | null;
    readonly position: number | null;
  } | null;
}

export interface ContentDecayRankTrend {
  readonly olderMonth: string;
  readonly previousMonth: string;
  readonly currentMonth: string;
  readonly olderPosition: number;
  readonly previousPosition: number;
  readonly currentPosition: number;
  readonly firstDecline: number;
  readonly secondDecline: number;
}

export interface ContentDecayTrafficTrend {
  readonly previousMonth: string;
  readonly currentMonth: string;
  readonly previousClicks: number;
  readonly currentClicks: number;
  readonly changeRatio: number;
}

export type ContentDecayTrigger = "rank_decline" | "traffic_decline";

export interface ContentDecayAlert {
  readonly sitePageId: string;
  readonly normalizedUrl: string;
  readonly detectedAt: string;
  readonly currentMonth: string;
  readonly triggers: readonly ContentDecayTrigger[];
  readonly rankTrend: ContentDecayRankTrend | null;
  readonly trafficTrend: ContentDecayTrafficTrend | null;
  readonly sourceSnapshotIds: readonly string[];
}

export interface ContentDecayMonitor {
  readonly version: typeof CONTENT_DECAY_MONITOR_VERSION;
  readonly projectionMode: "read_time";
  readonly scheduleState: "not_configured";
  readonly status: ContentDecayAvailability;
  readonly timezone: string;
  readonly timezoneSource: ContentDecayTimeZoneResolution["source"];
  readonly latestCheckpointMonth: string | null;
  readonly limitations: readonly string[];
  readonly alerts: readonly ContentDecayAlert[];
}

interface SelectedCheckpoint extends ContentDecaySnapshotCandidate {
  readonly month: string;
}

interface CheckpointSelection {
  readonly checkpoints: readonly SelectedCheckpoint[];
  readonly latestAuthorityMonth: string | null;
  readonly authorityIncomplete: boolean;
}

interface CheckedObservation {
  readonly clicks: number;
  readonly position: number | null;
}

function validIanaTimeZone(value: string | null): value is string {
  if (!value || value !== value.trim() || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Provider reporting timezone is strongest because it defines the source
 * calendar. A separately confirmed Project timezone is the next authority.
 * Missing/invalid values fall back to UTC with an explicit limitation; market
 * and locale are never treated as timezone evidence.
 */
export function resolveContentDecayTimeZone(input: {
  readonly providerTimeZone: string | null;
  readonly projectTimeZone: string | null;
}): ContentDecayTimeZoneResolution {
  if (validIanaTimeZone(input.providerTimeZone)) {
    return {
      timeZone: input.providerTimeZone,
      source: "provider",
      limitations: [],
    };
  }
  if (validIanaTimeZone(input.projectTimeZone)) {
    return {
      timeZone: input.projectTimeZone,
      source: "project",
      limitations: [],
    };
  }
  return {
    timeZone: "UTC",
    source: "fallback",
    limitations: [
      "Provider 与 Project 均未提供有效时区；月度检查点按 UTC 解释，未根据市场或语言猜测时区。",
    ],
  };
}

function dateKeyInZone(instant: string, timeZone: string): string | null {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? null;
    const year = value("year");
    const month = value("month");
    const day = value("day");
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}

function parseCalendarDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const epoch = Date.UTC(year, month - 1, day);
  const date = new Date(epoch);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
    ? epoch
    : null;
}

function sourceWindowIsExact(
  window: ContentDecaySnapshotCandidate["sourceWindow"],
): boolean {
  const start = parseCalendarDate(window.start);
  const end = parseCalendarDate(window.end);
  return (
    start !== null &&
    end !== null &&
    end >= start &&
    (end - start) / DAY_MS + 1 === EXPECTED_SOURCE_WINDOW_DAYS
  );
}

function monthOfDate(value: string): string | null {
  return parseCalendarDate(value) === null ? null : value.slice(0, 7);
}

function previousMonth(value: string): string {
  const [yearValue, monthValue] = value.split("-");
  const year = Number(yearValue);
  const month = Number(monthValue);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return `${previous.getUTCFullYear().toString().padStart(4, "0")}-${(
    previous.getUTCMonth() + 1
  )
    .toString()
    .padStart(2, "0")}`;
}

function compareSnapshotAuthority(
  left: SelectedCheckpoint,
  right: SelectedCheckpoint,
): number {
  const end = right.sourceWindow.end.localeCompare(left.sourceWindow.end);
  if (end !== 0) return end;
  const captured =
    Date.parse(right.capturedAt) - Date.parse(left.capturedAt);
  if (captured !== 0) return captured;
  return left.snapshotId.localeCompare(right.snapshotId);
}

function selectCheckpoints(input: {
  readonly snapshots: readonly ContentDecaySnapshotCandidate[];
  readonly asOf: string;
  readonly timeZone: string;
}): CheckpointSelection {
  const asOfTime = Date.parse(input.asOf);
  const asOfDate = dateKeyInZone(input.asOf, input.timeZone);
  if (!Number.isFinite(asOfTime) || asOfDate === null) {
    return {
      checkpoints: [],
      latestAuthorityMonth: null,
      authorityIncomplete: input.snapshots.length > 0,
    };
  }

  const byMonth = new Map<string, SelectedCheckpoint[]>();
  for (const snapshot of input.snapshots) {
    const capturedAt = Date.parse(snapshot.capturedAt);
    const month = monthOfDate(snapshot.sourceWindow.end);
    if (
      snapshot.provider !== GSC_PROVIDER ||
      snapshot.datasetKey !== GSC_DATASET ||
      snapshot.methodVersion !== GSC_METHOD ||
      !Number.isFinite(capturedAt) ||
      capturedAt > asOfTime ||
      snapshot.sourceWindow.end > asOfDate ||
      month === null
    ) {
      continue;
    }
    const candidates = byMonth.get(month) ?? [];
    candidates.push({ ...snapshot, month });
    byMonth.set(month, candidates);
  }

  const canonicalByMonth = new Map<string, SelectedCheckpoint>();
  for (const [month, candidates] of byMonth) {
    const selected = [...candidates].sort(compareSnapshotAuthority)[0];
    if (selected) canonicalByMonth.set(month, selected);
  }

  const latestMonth = [...canonicalByMonth.keys()].sort().at(-1);
  if (!latestMonth) {
    return {
      checkpoints: [],
      latestAuthorityMonth: null,
      authorityIncomplete: input.snapshots.length > 0,
    };
  }
  const asOfMonth = monthOfDate(asOfDate);
  if (
    asOfMonth === null ||
    (latestMonth !== asOfMonth &&
      latestMonth !== previousMonth(asOfMonth))
  ) {
    return {
      checkpoints: [],
      latestAuthorityMonth: latestMonth,
      authorityIncomplete: true,
    };
  }
  const selected: SelectedCheckpoint[] = [];
  let expected = latestMonth;
  let authorityIncomplete = false;
  while (selected.length < 3) {
    const checkpoint = canonicalByMonth.get(expected);
    if (
      !checkpoint ||
      checkpoint.availability !== "available" ||
      !sourceWindowIsExact(checkpoint.sourceWindow)
    ) {
      authorityIncomplete = true;
      break;
    }
    selected.unshift(checkpoint);
    expected = previousMonth(expected);
  }
  return {
    checkpoints: selected,
    latestAuthorityMonth: latestMonth,
    authorityIncomplete,
  };
}

function sameInstant(left: string, right: string): boolean {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  return (
    Number.isFinite(leftTime) &&
    Number.isFinite(rightTime) &&
    leftTime === rightTime
  );
}

function nonnegativeInteger(value: number | null): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function matchesCanonicalPageSubject(
  normalizedUrl: string,
  subjectRef: string,
): boolean {
  // SitePage stores the immutable exact fetch identity, while GSC aggregates
  // the canonical subject (a non-root trailing slash is removed). Reuse the
  // governed canonical_url.v1 boundary instead of comparing those two valid
  // projections as if they had to be byte-identical.
  const canonical = canonicalizeUrl(normalizedUrl);
  return (
    canonical !== null &&
    canonical.fetchUrl === normalizedUrl &&
    canonical.subjectUrl === subjectRef
  );
}

function checkedObservation(
  checkpoint: SelectedCheckpoint,
  page: ContentDecayPage,
  observations: readonly ContentDecayObservationCandidate[],
): CheckedObservation | null {
  const rows = observations.filter(
    (observation) =>
      observation.snapshotId === checkpoint.snapshotId &&
      observation.sitePageId === page.sitePageId,
  );
  if (rows.length !== 1) return null;
  const row = rows[0]!;
  const value = row.current28d;
  if (
    row.provider !== GSC_PROVIDER ||
    row.metricKey !== GSC_METRIC ||
    !matchesCanonicalPageSubject(page.normalizedUrl, row.subjectRef) ||
    row.availability !== "available" ||
    !sameInstant(row.observedAt, checkpoint.capturedAt) ||
    value === null ||
    !nonnegativeInteger(value.clicks) ||
    !nonnegativeInteger(value.impressions)
  ) {
    return null;
  }
  const position =
    typeof value.position === "number" &&
    Number.isFinite(value.position) &&
    value.position > 0
      ? value.position
      : null;
  if (
    (value.impressions === 0 && value.position !== null) ||
    (value.impressions > 0 && position === null)
  ) {
    return null;
  }
  return { clicks: value.clicks, position };
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function compareContentDecayAlerts(
  left: ContentDecayAlert,
  right: ContentDecayAlert,
): number {
  const triggerCount = right.triggers.length - left.triggers.length;
  if (triggerCount !== 0) return triggerCount;
  const leftTraffic = left.trafficTrend?.changeRatio ?? 0;
  const rightTraffic = right.trafficTrend?.changeRatio ?? 0;
  if (leftTraffic !== rightTraffic) return leftTraffic - rightTraffic;
  const leftRank =
    (left.rankTrend?.firstDecline ?? 0) +
    (left.rankTrend?.secondDecline ?? 0);
  const rightRank =
    (right.rankTrend?.firstDecline ?? 0) +
    (right.rankTrend?.secondDecline ?? 0);
  if (leftRank !== rightRank) return rightRank - leftRank;
  return left.normalizedUrl.localeCompare(right.normalizedUrl);
}

/**
 * Build the current monitor result from immutable candidates.
 *
 * “Month” means one canonical monthly checkpoint. Its metric is explicitly the
 * snapshot's trailing 28-day GSC window, not a fabricated natural-month sum.
 * Ranking requires three consecutive checkpoints and both adjacent deltas to
 * be strictly worse by more than five positions. Traffic requires two
 * consecutive checkpoints and a latest decline strictly greater than 20%.
 */
export function buildContentDecayMonitor(input: {
  readonly asOf: string;
  readonly timeZone: ContentDecayTimeZoneResolution;
  readonly pages: readonly ContentDecayPage[];
  readonly snapshots: readonly ContentDecaySnapshotCandidate[];
  readonly observations: readonly ContentDecayObservationCandidate[];
}): ContentDecayMonitor {
  const checkpointSelection = selectCheckpoints({
    snapshots: input.snapshots,
    asOf: input.asOf,
    timeZone: input.timeZone.timeZone,
  });
  const checkpoints = checkpointSelection.checkpoints;
  const latest = checkpoints.at(-1) ?? null;
  let incompletePageFacts = false;
  const alerts: ContentDecayAlert[] = [];

  for (const page of input.pages) {
    const facts = new Map<string, CheckedObservation>();
    for (const checkpoint of checkpoints) {
      const fact = checkedObservation(
        checkpoint,
        page,
        input.observations,
      );
      if (fact) facts.set(checkpoint.snapshotId, fact);
      else incompletePageFacts = true;
    }

    const previous = checkpoints.at(-2) ?? null;
    const older = checkpoints.at(-3) ?? null;
    const currentFact = latest ? facts.get(latest.snapshotId) ?? null : null;
    const previousFact = previous
      ? facts.get(previous.snapshotId) ?? null
      : null;
    const olderFact = older ? facts.get(older.snapshotId) ?? null : null;

    let rankTrend: ContentDecayRankTrend | null = null;
    if (
      latest &&
      previous &&
      older &&
      currentFact?.position !== null &&
      currentFact?.position !== undefined &&
      previousFact?.position !== null &&
      previousFact?.position !== undefined &&
      olderFact?.position !== null &&
      olderFact?.position !== undefined
    ) {
      const firstDecline = rounded(
        previousFact.position - olderFact.position,
      );
      const secondDecline = rounded(
        currentFact.position - previousFact.position,
      );
      if (
        firstDecline > CONTENT_DECAY_RANK_THRESHOLD &&
        secondDecline > CONTENT_DECAY_RANK_THRESHOLD
      ) {
        rankTrend = {
          olderMonth: older.month,
          previousMonth: previous.month,
          currentMonth: latest.month,
          olderPosition: olderFact.position,
          previousPosition: previousFact.position,
          currentPosition: currentFact.position,
          firstDecline,
          secondDecline,
        };
      }
    }

    let trafficTrend: ContentDecayTrafficTrend | null = null;
    if (
      latest &&
      previous &&
      currentFact &&
      previousFact &&
      previousFact.clicks > 0
    ) {
      const changeRatio = rounded(
        (currentFact.clicks - previousFact.clicks) /
          previousFact.clicks,
      );
      if (changeRatio < CONTENT_DECAY_TRAFFIC_THRESHOLD) {
        trafficTrend = {
          previousMonth: previous.month,
          currentMonth: latest.month,
          previousClicks: previousFact.clicks,
          currentClicks: currentFact.clicks,
          changeRatio,
        };
      }
    }

    const triggers: ContentDecayTrigger[] = [];
    if (rankTrend) triggers.push("rank_decline");
    if (trafficTrend) triggers.push("traffic_decline");
    if (!latest || triggers.length === 0) continue;
    const usedCheckpoints =
      rankTrend === null ? checkpoints.slice(-2) : checkpoints.slice(-3);
    alerts.push({
      sitePageId: page.sitePageId,
      normalizedUrl: page.normalizedUrl,
      detectedAt: latest.capturedAt,
      currentMonth: latest.month,
      triggers,
      rankTrend,
      trafficTrend,
      sourceSnapshotIds: usedCheckpoints.map(
        (checkpoint) => checkpoint.snapshotId,
      ),
    });
  }

  const status: ContentDecayAvailability =
    checkpointSelection.latestAuthorityMonth === null
      ? "unavailable"
      : checkpointSelection.authorityIncomplete ||
          checkpoints.length < 3 ||
          incompletePageFacts
        ? "partial"
        : "available";
  return {
    version: CONTENT_DECAY_MONITOR_VERSION,
    projectionMode: "read_time",
    scheduleState: "not_configured",
    status,
    timezone: input.timeZone.timeZone,
    timezoneSource: input.timeZone.source,
    latestCheckpointMonth: checkpointSelection.latestAuthorityMonth,
    limitations: [
      ...input.timeZone.limitations,
      "月度检查点使用该月权威 GSC snapshot 的 trailing 28-day 指标，不等同于自然月汇总。",
      "GSC 只返回按 clicks 排序的 top rows，低点击页面可能缺失。",
      "任何缺失、partial 或歧义 observation 均按不可用处理，不补零。",
      "当前为概览读取时的只读投影，尚未接入月度自动任务或主动推送。",
    ],
    alerts: alerts.sort(compareContentDecayAlerts),
  };
}
