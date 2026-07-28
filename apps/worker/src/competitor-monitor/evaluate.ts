export interface CompetitorRankedKeywordFact {
  readonly normalizedKeyword: string;
  readonly currentRank: number | null;
  readonly currentUrl: string | null;
}

export interface ConfirmedTopicKeyword {
  readonly keywordId: string;
  readonly displayKeyword: string;
  readonly normalizedKeyword: string;
}

export interface ConfirmedTopicKeywordSet {
  readonly topicNodeId: string;
  readonly topicLabel: string;
  readonly keywords: readonly ConfirmedTopicKeyword[];
}

export interface CompetitorMonitorSnapshotFacts {
  readonly snapshotId: string;
  readonly capturedAt: string;
  readonly availability: "available" | "partial";
  readonly rows: readonly CompetitorRankedKeywordFact[];
}

export type CompetitorMonitorSignalDraft =
  | {
      readonly kind: "rank_gain";
      readonly topicNodeId: string;
      readonly topicLabel: string;
      readonly keywordId: string;
      readonly keyword: string;
      readonly previousRank: number;
      readonly currentRank: number;
      readonly improvement: number;
      readonly limitation: string | null;
    }
  | {
      readonly kind: "new_content_overlap";
      readonly topicNodeId: string;
      readonly topicLabel: string;
      readonly url: string;
      readonly matchedKeywordIds: readonly string[];
      readonly overlapRatio: number;
      readonly limitation: string;
    };

export interface CompetitorMonitorEvaluation {
  readonly evaluationState: "baseline" | "available" | "unavailable";
  readonly limitation: string | null;
  readonly signals: readonly CompetitorMonitorSignalDraft[];
}

const MIN_COMPARABLE_DAYS = 21;
const MAX_COMPARABLE_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1_000;
const MIN_CONTENT_KEYWORDS = 2;
const MIN_TOPIC_OVERLAP = 0.5;
export const COMPETITOR_MONITOR_SIGNAL_LIMIT = 100;

function instant(value: string, label: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical UTC instant`);
  }
  return time;
}

function checkedRank(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError("rank must be a positive finite number");
  }
  return value;
}

function canonicalKeyword(value: string): string {
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
  if (normalized.length < 1 || normalized.length > 500 || normalized !== value) {
    throw new TypeError("normalized keyword is not canonical");
  }
  return normalized;
}

function comparableHost(value: string): string {
  return value.toLowerCase().replace(/\.$/u, "").replace(/^www\./u, "");
}

function canonicalCompetitorUrl(
  value: string | null,
  competitorDomain: string,
): string | null {
  if (value === null) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("competitor URL is invalid");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    comparableHost(url.hostname) !== comparableHost(competitorDomain)
  ) {
    throw new TypeError("competitor URL does not belong to the approved competitor domain");
  }
  url.hash = "";
  return url.href;
}

interface IndexedRankFact {
  readonly rank: number | null;
  readonly url: string | null;
}

function indexSnapshot(
  snapshot: CompetitorMonitorSnapshotFacts,
  competitorDomain: string,
): Map<string, IndexedRankFact> {
  instant(snapshot.capturedAt, "snapshot capturedAt");
  const indexed = new Map<string, IndexedRankFact>();
  for (const row of snapshot.rows) {
    const keyword = canonicalKeyword(row.normalizedKeyword);
    if (indexed.has(keyword)) {
      throw new TypeError("duplicate provider keyword fact");
    }
    indexed.set(keyword, {
      rank: checkedRank(row.currentRank),
      url: canonicalCompetitorUrl(row.currentUrl, competitorDomain),
    });
  }
  return indexed;
}

interface TopicKeywordAuthority {
  readonly keywordId: string;
  readonly keyword: string;
  readonly topicNodeId: string;
  readonly topicLabel: string;
  readonly topicKeywordCount: number;
}

function indexTopicAuthority(
  topics: readonly ConfirmedTopicKeywordSet[],
): Map<string, TopicKeywordAuthority> {
  const indexed = new Map<string, TopicKeywordAuthority>();
  for (const topic of topics) {
    const label = topic.topicLabel.trim();
    if (label.length < 1 || label.length > 160 || label !== topic.topicLabel) {
      throw new TypeError("topic label is invalid");
    }
    const topicKeywords = new Set<string>();
    for (const keyword of topic.keywords) {
      const normalized = canonicalKeyword(keyword.normalizedKeyword);
      if (topicKeywords.has(normalized) || indexed.has(normalized)) {
        throw new TypeError("duplicate confirmed topic keyword authority");
      }
      topicKeywords.add(normalized);
      indexed.set(normalized, {
        keywordId: keyword.keywordId,
        keyword: keyword.displayKeyword,
        topicNodeId: topic.topicNodeId,
        topicLabel: topic.topicLabel,
        topicKeywordCount: topic.keywords.length,
      });
    }
  }
  return indexed;
}

function sixDecimals(value: number): number {
  return Number(value.toFixed(6));
}

export function evaluateCompetitorMonitor(input: {
  readonly competitorDomain: string;
  readonly analysisScopes: readonly string[];
  readonly current: CompetitorMonitorSnapshotFacts;
  readonly previous: CompetitorMonitorSnapshotFacts | null;
  readonly topics: readonly ConfirmedTopicKeywordSet[];
}): CompetitorMonitorEvaluation {
  const contentEnabled = input.analysisScopes.includes("content");
  const rankEnabled = input.analysisScopes.includes("serp_visibility");
  if (!contentEnabled && !rankEnabled) {
    return {
      evaluationState: "unavailable",
      limitation:
        "该已审核竞品未启用 Content 或 SERP visibility 分析范围。",
      signals: [],
    };
  }
  const authority = indexTopicAuthority(input.topics);
  const currentRows = indexSnapshot(input.current, input.competitorDomain);

  if (input.previous === null) {
    return {
      evaluationState: "baseline",
      limitation: "首次采集仅建立 baseline，不生成竞品动态提醒。",
      signals: [],
    };
  }

  const previousRows = indexSnapshot(input.previous, input.competitorDomain);
  if (authority.size === 0) {
    return {
      evaluationState: "unavailable",
      limitation: "缺少已确认 Topic（latest-confirmed）下的目标词，无法判断竞品动态。",
      signals: [],
    };
  }

  const currentAt = instant(input.current.capturedAt, "current capturedAt");
  const previousAt = instant(input.previous.capturedAt, "previous capturedAt");
  const windowDays = (currentAt - previousAt) / DAY_MS;
  if (
    currentAt <= previousAt ||
    windowDays < MIN_COMPARABLE_DAYS ||
    windowDays > MAX_COMPARABLE_DAYS
  ) {
    return {
      evaluationState: "unavailable",
      limitation: "两次采集必须间隔 21 至 45 天，才能作为月度可比窗口。",
      signals: [],
    };
  }

  const signals: CompetitorMonitorSignalDraft[] = [];
  const partial =
    input.current.availability !== "available" ||
    input.previous.availability !== "available";

  if (rankEnabled) {
    for (const [keyword, current] of currentRows) {
      const target = authority.get(keyword);
      const previous = previousRows.get(keyword);
      if (
        !target ||
        !previous ||
        current.rank === null ||
        previous.rank === null
      ) {
        continue;
      }
      const improvement = previous.rank - current.rank;
      if (improvement <= 5) continue;
      signals.push({
        kind: "rank_gain",
        topicNodeId: target.topicNodeId,
        topicLabel: target.topicLabel,
        keywordId: target.keywordId,
        keyword: target.keyword,
        previousRank: previous.rank,
        currentRank: current.rank,
        improvement,
        limitation: partial
          ? "排名提升由两个真实观测点支持；采集结果为部分数据，未观测词不作推断。"
          : null,
      });
    }
  }

  if (contentEnabled && !partial) {
    const priorUrls = new Set(
      [...previousRows.values()].flatMap((row) => (row.url ? [row.url] : [])),
    );
    const byUrlTopic = new Map<
      string,
      Map<
        string,
        {
          readonly topic: TopicKeywordAuthority;
          readonly keywordIds: Set<string>;
        }
      >
    >();
    for (const [keyword, current] of currentRows) {
      const target = authority.get(keyword);
      if (!target || !current.url || priorUrls.has(current.url)) continue;
      let byTopic = byUrlTopic.get(current.url);
      if (!byTopic) {
        byTopic = new Map();
        byUrlTopic.set(current.url, byTopic);
      }
      let group = byTopic.get(target.topicNodeId);
      if (!group) {
        group = { topic: target, keywordIds: new Set() };
        byTopic.set(target.topicNodeId, group);
      }
      group.keywordIds.add(target.keywordId);
    }
    for (const [url, byTopic] of byUrlTopic) {
      for (const group of byTopic.values()) {
        const matchedKeywordIds = [...group.keywordIds].sort();
        const overlapRatio =
          matchedKeywordIds.length / group.topic.topicKeywordCount;
        if (
          matchedKeywordIds.length < MIN_CONTENT_KEYWORDS ||
          overlapRatio < MIN_TOPIC_OVERLAP
        ) {
          continue;
        }
        signals.push({
          kind: "new_content_overlap",
          topicNodeId: group.topic.topicNodeId,
          topicLabel: group.topic.topicLabel,
          url,
          matchedKeywordIds,
          overlapRatio: sixDecimals(overlapRatio),
          limitation:
            "首次在两个完整、可比的 DataForSEO 排名采集中观察到该 URL；这不是发布日期证明。",
        });
      }
    }
  }

  signals.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
    if (left.topicNodeId !== right.topicNodeId) {
      return left.topicNodeId < right.topicNodeId ? -1 : 1;
    }
    const leftKey =
      left.kind === "rank_gain" ? left.keywordId : left.url;
    const rightKey =
      right.kind === "rank_gain" ? right.keywordId : right.url;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });

  const partialLimitation =
    partial && contentEnabled
      ? rankEnabled
        ? "部分采集仅支持已观测目标词的排名比较，不判断 URL 是否为新发现内容。"
        : "部分采集不能证明 URL 为新发现内容，本次不生成内容动态提醒。"
      : null;
  const overflowLimitation =
    signals.length > COMPETITOR_MONITOR_SIGNAL_LIMIT
      ? `本期动态超过 ${COMPETITOR_MONITOR_SIGNAL_LIMIT} 条；仅保留按类型、Topic 与证据键稳定排序后的前 ${COMPETITOR_MONITOR_SIGNAL_LIMIT} 条，完整 DataForSEO 快照仍保留。`
      : null;

  return {
    evaluationState: "available",
    limitation: [partialLimitation, overflowLimitation]
      .filter((value): value is string => value !== null)
      .join(" ") || null,
    signals: signals.slice(0, COMPETITOR_MONITOR_SIGNAL_LIMIT),
  };
}
