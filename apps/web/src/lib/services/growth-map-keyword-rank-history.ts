import {
  GrowthMapKeywordRankHistory as GrowthMapKeywordRankHistorySchema,
  type GrowthMapCoverage,
  type GrowthMapKeywordRankHistory,
  type GrowthMapKeywordRankSeries,
} from "@sf/contracts";
import {
  KeywordRankHistoryIntegrityError,
  KeywordRankHistoryRepository,
  type Executor,
  type KeywordRankObservationFact,
  type ProjectScope,
  type WorkspaceScope,
} from "@sf/db";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { getProjectAuditKeyword } from "./growth-map-keywords";

const HISTORY_DAYS = 90;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;
const HISTORY_MILLISECONDS = HISTORY_DAYS * DAY_MILLISECONDS;

const NO_RANK_HISTORY =
  "No canonical rank observations are available in the exact trailing 90-day UTC window.";
const NO_CANONICAL_PAGE =
  "This Keyword is not mapped to one canonical existing page, so verified content-change markers are unavailable.";
const SINGLE_POINT =
  "At least one rank series has fewer than two observations, so a trend cannot yet be established.";
const MISSING_PROVIDER_DATA_AS_OF =
  "At least one rank observation has no provider data-as-of timestamp.";
const DATAFORSEO_LIMITATION =
  "DataForSEO rank is an absolute provider observation and does not include a provider data-as-of timestamp.";
const GSC_LIMITATION =
  "GSC position is a rolling 28-day impression-weighted average, not an absolute SERP rank.";
const DATAFORSEO_INTERPRETATION =
  "Absolute Google organic rank observed by DataForSEO.";
const GSC_INTERPRETATION =
  "GSC rolling 28-day impression-weighted average position; it is not an absolute SERP rank.";

function corruptRankHistory(): never {
  throw new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    "The Keyword rank-history authority failed its integrity checks.",
  );
}

function canonicalNow(now: Date): string {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    return corruptRankHistory();
  }
  return now.toISOString();
}

function seriesFrom(
  observations: readonly KeywordRankObservationFact[],
): GrowthMapKeywordRankSeries[] {
  const dataForSeo = observations.filter(
    (observation) =>
      observation.provider === "dataforseo" &&
      observation.metric === "absolute_rank",
  );
  const gsc = observations.filter(
    (observation) =>
      observation.provider === "gsc" &&
      observation.metric === "gsc_28d_average_position",
  );
  if (dataForSeo.length + gsc.length !== observations.length) {
    return corruptRankHistory();
  }

  const series: GrowthMapKeywordRankSeries[] = [];
  if (dataForSeo.length > 0) {
    series.push({
      provider: "dataforseo",
      metric: "absolute_rank",
      points: dataForSeo,
      interpretation: DATAFORSEO_INTERPRETATION,
    });
  }
  if (gsc.length > 0) {
    series.push({
      provider: "gsc",
      metric: "gsc_28d_average_position",
      points: gsc,
      interpretation: GSC_INTERPRETATION,
    });
  }
  return series;
}

function coverageFor(
  series: readonly GrowthMapKeywordRankSeries[],
  mappedPageAvailable: boolean,
): GrowthMapCoverage {
  if (series.length === 0) {
    return {
      availability: "unavailable",
      limitations: [
        NO_RANK_HISTORY,
        ...(mappedPageAvailable ? [] : [NO_CANONICAL_PAGE]),
      ],
    };
  }

  const limitations = new Set<string>();
  let partial = false;
  for (const rankSeries of series) {
    limitations.add(
      rankSeries.provider === "dataforseo"
        ? DATAFORSEO_LIMITATION
        : GSC_LIMITATION,
    );
    if (
      rankSeries.points.some((point) => point.providerDataAsOf === null)
    ) {
      partial = true;
    }
    if (rankSeries.points.length < 2) partial = true;
  }
  if (series.some((rankSeries) => rankSeries.points.length < 2)) {
    limitations.add(SINGLE_POINT);
  }
  if (
    series.some((rankSeries) =>
      rankSeries.points.some((point) => point.providerDataAsOf === null),
    )
  ) {
    limitations.add(MISSING_PROVIDER_DATA_AS_OF);
  }
  if (!mappedPageAvailable) {
    partial = true;
    limitations.add(NO_CANONICAL_PAGE);
  }
  return {
    availability: partial ? "partial" : "available",
    limitations: [...limitations],
  };
}

async function historyInSnapshot(
  exec: Executor,
  scope: WorkspaceScope,
  projectId: string,
  keywordId: string,
  endedAt: string,
): Promise<GrowthMapKeywordRankHistory> {
  const detail = await getProjectAuditKeyword(
    scope,
    projectId,
    keywordId,
    exec,
  );
  if (
    detail.projectId !== projectId ||
    detail.data.projectId !== projectId ||
    detail.data.keywordId !== keywordId
  ) {
    return corruptRankHistory();
  }

  const startedAt = new Date(
    Date.parse(endedAt) - HISTORY_MILLISECONDS,
  ).toISOString();
  const window = { startedAt, endedAt };
  const projectScope: ProjectScope = {
    workspaceId: scope.workspaceId,
    projectId,
  };
  const repository = new KeywordRankHistoryRepository(exec);

  try {
    const observations = await repository.listRankObservations(
      projectScope,
      keywordId,
      window,
    );
    const series = seriesFrom(observations);
    const mappedPage =
      detail.data.mappedTarget.kind === "existing_page"
        ? {
            sitePageId: detail.data.mappedTarget.sitePageId,
            normalizedUrl: detail.data.mappedTarget.normalizedUrl,
          }
        : null;
    const changeMarkers =
      mappedPage === null
        ? []
        : await repository.listContentChanges(projectScope, {
            ...window,
            sitePageId: mappedPage.sitePageId,
            normalizedUrl: mappedPage.normalizedUrl,
          });

    if (
      mappedPage !== null &&
      changeMarkers.some(
        (marker) => marker.liveCanonicalUrl !== mappedPage.normalizedUrl,
      )
    ) {
      return corruptRankHistory();
    }

    const parsed = GrowthMapKeywordRankHistorySchema.safeParse({
      projectId,
      keywordId,
      mappedPage,
      window: { ...window, days: HISTORY_DAYS },
      series,
      changeMarkers,
      coverage: coverageFor(series, mappedPage !== null),
      generatedAt: endedAt,
    });
    if (!parsed.success) return corruptRankHistory();
    return parsed.data;
  } catch (error) {
    if (error instanceof KeywordRankHistoryIntegrityError) {
      return corruptRankHistory();
    }
    throw error;
  }
}

/**
 * Return immutable rank observations for one governed Keyword inside Growth
 * Map. The endpoint always uses one exact trailing 90-day UTC window; callers
 * cannot alter the time range or mix absolute rank with GSC average position.
 */
export async function getProjectAuditKeywordRankHistory(
  scope: WorkspaceScope,
  projectId: string,
  keywordId: string,
  exec?: Executor,
  now: Date = new Date(),
): Promise<GrowthMapKeywordRankHistory> {
  const endedAt = canonicalNow(now);
  if (exec) {
    return historyInSnapshot(
      exec,
      scope,
      projectId,
      keywordId,
      endedAt,
    );
  }
  return getDb().db.transaction(
    (tx) =>
      historyInSnapshot(
        tx,
        scope,
        projectId,
        keywordId,
        endedAt,
      ),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
