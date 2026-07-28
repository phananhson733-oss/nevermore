import {
  MeasurementTargetKeywordRanks as MeasurementTargetKeywordRanksSchema,
  type MeasurementDataForSeoAbsoluteRankPoint,
  type MeasurementTargetKeywordRank,
  type MeasurementTargetKeywordRanks,
  type MeasurementWindowInterval,
} from "@sf/contracts";
import {
  MeasurementTargetKeywordRankIntegrityError,
  MeasurementTargetKeywordRanksRepository,
  MeasurementWindowInvariantError,
  MeasurementWindowsRepository,
  type Executor,
  type MeasurementTargetKeywordRankObservationFact,
  type ProjectScope,
  type WorkspaceScope,
} from "@sf/db";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";

const NO_CONFIRMED_MODEL =
  "No confirmed Topic Map is available, so this page has no governed target Keyword set.";
const NO_CONFIRMED_TARGETS =
  "No confirmed target Keywords are mapped to this exact page.";
const NO_COMPLETE_COMPARISONS =
  "No target Keyword has a real DataForSEO absolute-rank observation in both measurement windows.";
const PARTIAL_COMPARISONS =
  "Some target Keywords are missing a DataForSEO absolute-rank observation in one or both measurement windows.";
const DATAFORSEO_LIMITATION =
  "DataForSEO absolute rank is compared by collection observation time because the provider does not expose a separate data-as-of timestamp.";

function notFound(): never {
  throw new ProblemError(
    "NOT_FOUND",
    "Measurement Window not found.",
  );
}

function corruptMeasurementRanks(): never {
  throw new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    "Target Keyword rank measurement failed its authority checks.",
  );
}

function inside(
  observedAt: string,
  window: MeasurementWindowInterval,
): boolean {
  const instant = Date.parse(observedAt);
  return (
    instant >= Date.parse(window.startAt) &&
    instant < Date.parse(window.endAt)
  );
}

function latestInside(
  facts: readonly MeasurementTargetKeywordRankObservationFact[],
  window: MeasurementWindowInterval,
): MeasurementTargetKeywordRankObservationFact | null {
  return (
    facts
      .filter((fact) => inside(fact.observedAt, window))
      .at(-1) ?? null
  );
}

function rankPoint(
  fact: MeasurementTargetKeywordRankObservationFact | null,
): MeasurementDataForSeoAbsoluteRankPoint | null {
  if (fact === null) return null;
  return {
    occurrenceId: fact.occurrenceId,
    snapshotId: fact.snapshotId,
    observationId: fact.observationId,
    provider: "dataforseo",
    metric: "absolute_rank",
    value: fact.value,
    valuePointer: "/valueJson/currentRank",
    observedAt: fact.observedAt,
    providerDataAsOf: null,
    grade: "B",
    limitation: fact.limitation,
  };
}

function missingLimitation(
  baseline: MeasurementTargetKeywordRankObservationFact | null,
  outcome: MeasurementTargetKeywordRankObservationFact | null,
): string | null {
  if (baseline === null && outcome === null) {
    return "No DataForSEO absolute-rank observation exists in either measurement window.";
  }
  if (baseline === null) {
    return "The baseline window has no DataForSEO absolute-rank observation.";
  }
  if (outcome === null) {
    return "The outcome window has no DataForSEO absolute-rank observation.";
  }
  return null;
}

function keywordRank(
  keyword: Awaited<
    ReturnType<
      MeasurementTargetKeywordRanksRepository["readForMeasuredPage"]
    >
  >["keywords"][number],
  beforeWindow: MeasurementWindowInterval,
  afterWindow: MeasurementWindowInterval,
): MeasurementTargetKeywordRank {
  const baseline = latestInside(
    keyword.observations,
    beforeWindow,
  );
  const outcome = latestInside(
    keyword.observations,
    afterWindow,
  );
  const state =
    baseline !== null && outcome !== null
      ? "observed"
      : baseline !== null || outcome !== null
        ? "insufficient_data"
        : "unavailable";
  const improvement =
    baseline !== null && outcome !== null
      ? baseline.value - outcome.value
      : null;
  const trend =
    improvement === null
      ? "unavailable"
      : improvement > 0
        ? "improved"
        : improvement < 0
          ? "regressed"
          : "unchanged";

  return {
    keywordId: keyword.keywordId,
    displayKeyword: keyword.displayKeyword,
    normalizedKeyword: keyword.normalizedKeyword,
    marketCode: keyword.marketCode,
    languageTag: keyword.languageTag,
    topicNodeId: keyword.topicNodeId,
    topicLabel: keyword.topicLabel,
    topicModelRevision: keyword.topicModelRevision,
    state,
    baselineObservation: rankPoint(baseline),
    outcomeObservation: rankPoint(outcome),
    rankImprovement: improvement,
    trend,
    limitation: missingLimitation(baseline, outcome),
  };
}

async function targetRanksInSnapshot(
  exec: Executor,
  scope: WorkspaceScope,
  projectId: string,
  measurementWindowId: string,
  now: Date,
): Promise<MeasurementTargetKeywordRanks> {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    return corruptMeasurementRanks();
  }
  const projectScope: ProjectScope = {
    workspaceId: scope.workspaceId,
    projectId,
  };

  try {
    const window = await new MeasurementWindowsRepository(
      exec,
    ).findById(projectScope, measurementWindowId);
    if (!window) return notFound();
    if (
      window.projectId !== projectId ||
      window.measurementWindowId !== measurementWindowId ||
      window.target.kind !== "url" ||
      window.target.sitePageId.length === 0
    ) {
      return corruptMeasurementRanks();
    }

    const authority =
      await new MeasurementTargetKeywordRanksRepository(
        exec,
      ).readForMeasuredPage(projectScope, {
        sitePageId: window.target.sitePageId,
        canonicalUrl: window.canonicalUrl,
        beforeWindow: window.beforeWindow,
        afterWindow: window.afterWindow,
      });
    if (
      authority.sitePageId !== window.target.sitePageId ||
      authority.canonicalUrl !== window.canonicalUrl
    ) {
      return corruptMeasurementRanks();
    }

    const keywords = authority.keywords.map((keyword) =>
      keywordRank(
        keyword,
        window.beforeWindow,
        window.afterWindow,
      ),
    );
    const observed = keywords.filter(
      (keyword) => keyword.state === "observed",
    ).length;
    const coverage =
      keywords.length === 0
        ? {
            availability: "unavailable" as const,
            limitations: [
              authority.topicModelRevision === null
                ? NO_CONFIRMED_MODEL
                : NO_CONFIRMED_TARGETS,
            ],
          }
        : observed === 0
          ? {
              availability: "unavailable" as const,
              limitations: [
                NO_COMPLETE_COMPARISONS,
                DATAFORSEO_LIMITATION,
              ],
            }
          : observed < keywords.length
            ? {
                availability: "partial" as const,
                limitations: [
                  PARTIAL_COMPARISONS,
                  DATAFORSEO_LIMITATION,
                ],
              }
            : {
                availability: "available" as const,
                limitations: [DATAFORSEO_LIMITATION],
              };
    const generatedAt = now.toISOString();
    const parsed =
      MeasurementTargetKeywordRanksSchema.safeParse({
        projectId,
        measurementWindowId,
        sitePageId: window.target.sitePageId,
        canonicalUrl: window.canonicalUrl,
        beforeWindow: window.beforeWindow,
        afterWindow: window.afterWindow,
        interpretation:
          "dataforseo_absolute_rank_observational_non_causal",
        keywords,
        coverage,
        generatedAt,
      });
    if (!parsed.success) return corruptMeasurementRanks();
    return parsed.data;
  } catch (error) {
    if (
      error instanceof
        MeasurementTargetKeywordRankIntegrityError ||
      error instanceof MeasurementWindowInvariantError
    ) {
      return corruptMeasurementRanks();
    }
    throw error;
  }
}

/**
 * Read one measured URL's confirmed target Keyword rank comparison. The
 * measurement windows are server-owned; callers cannot supply dates or mix a
 * GSC average-position metric into the absolute-rank comparison.
 */
export async function getProjectMeasurementTargetKeywordRanks(
  scope: WorkspaceScope,
  projectId: string,
  measurementWindowId: string,
  exec?: Executor,
  now: Date = new Date(),
): Promise<MeasurementTargetKeywordRanks> {
  if (exec) {
    return targetRanksInSnapshot(
      exec,
      scope,
      projectId,
      measurementWindowId,
      now,
    );
  }
  return getDb().db.transaction(
    (tx) =>
      targetRanksInSnapshot(
        tx,
        scope,
        projectId,
        measurementWindowId,
        now,
      ),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
