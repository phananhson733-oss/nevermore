import type {
  MeasurementKeywordRankTrend,
  MeasurementTargetKeywordRank,
} from "@sf/contracts";

export interface TargetKeywordRankRow {
  readonly keywordId: string;
  readonly keyword: string;
  readonly topic: string;
  readonly marketCode: string;
  readonly languageTag: string;
  readonly baselineRank: number | null;
  readonly outcomeRank: number | null;
  readonly improvement: number | null;
  readonly trend: MeasurementKeywordRankTrend;
  readonly state: MeasurementTargetKeywordRank["state"];
  readonly limitation: string | null;
}

export type TargetKeywordRankLimitationKey =
  | "noConfirmedTopicMap"
  | "noConfirmedTargets"
  | "noCompleteComparisons"
  | "partialComparisons"
  | "noProviderDataAsOf"
  | "unknown";

const TARGET_KEYWORD_RANK_LIMITATIONS: Readonly<
  Record<string, TargetKeywordRankLimitationKey>
> = {
  "No confirmed Topic Map is available, so this page has no governed target Keyword set.":
    "noConfirmedTopicMap",
  "No confirmed target Keywords are mapped to this exact page.":
    "noConfirmedTargets",
  "No target Keyword has a real DataForSEO absolute-rank observation in both measurement windows.":
    "noCompleteComparisons",
  "Some target Keywords are missing a DataForSEO absolute-rank observation in one or both measurement windows.":
    "partialComparisons",
  "DataForSEO absolute rank is compared by collection observation time because the provider does not expose a separate data-as-of timestamp.":
    "noProviderDataAsOf",
};

/** Keep locale-neutral API limitations from leaking English into zh-CN UI. */
export function targetKeywordRankLimitationKey(
  limitation: string,
): TargetKeywordRankLimitationKey {
  return TARGET_KEYWORD_RANK_LIMITATIONS[limitation] ?? "unknown";
}

export function targetKeywordRankRow(
  keyword: MeasurementTargetKeywordRank,
): TargetKeywordRankRow {
  return {
    keywordId: keyword.keywordId,
    keyword: keyword.displayKeyword,
    topic: keyword.topicLabel,
    marketCode: keyword.marketCode,
    languageTag: keyword.languageTag,
    baselineRank: keyword.baselineObservation?.value ?? null,
    outcomeRank: keyword.outcomeObservation?.value ?? null,
    improvement: keyword.rankImprovement,
    trend: keyword.trend,
    state: keyword.state,
    limitation: keyword.limitation,
  };
}

export function targetKeywordGrowthMapHref(
  projectId: string,
  keywordId: string,
): string {
  const query = new URLSearchParams({
    object: "keywords",
    selectedKeywordId: keywordId,
  });
  return `/p/${projectId}/growth-map?${query.toString()}`;
}
