import { randomUUID } from "node:crypto";
import {
  CompetitorMonitorRepository,
  type ConfirmedTopicKeywordRow,
  type Executor,
  type ProjectScope,
} from "@sf/db";

import {
  evaluateCompetitorMonitor,
  type CompetitorMonitorSnapshotFacts,
  type ConfirmedTopicKeywordSet,
} from "./evaluate.ts";

interface ProjectionOptions {
  readonly now?: () => string;
  readonly idFactory?: () => string;
}

export type CompetitorMonitorProjectionResult =
  | { readonly isCompetitorMonitor: false }
  | {
      readonly isCompetitorMonitor: true;
      readonly evaluationState: "baseline" | "available" | "unavailable";
      readonly signalCount: number;
    };

function canonicalNow(factory: () => string): string {
  const value = factory();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError("competitor monitor evaluation time is not canonical");
  }
  return value;
}

function groupTopics(
  rows: readonly ConfirmedTopicKeywordRow[],
): ConfirmedTopicKeywordSet[] {
  const groups = new Map<string, {
    topicNodeId: string;
    topicLabel: string;
    keywords: Array<{
      keywordId: string;
      displayKeyword: string;
      normalizedKeyword: string;
    }>;
  }>();
  for (const row of rows) {
    const existing = groups.get(row.topic_node_id);
    if (existing && existing.topicLabel !== row.topic_label) {
      throw new TypeError("confirmed Topic label lineage is inconsistent");
    }
    const group =
      existing ??
      {
        topicNodeId: row.topic_node_id,
        topicLabel: row.topic_label,
        keywords: [],
      };
    group.keywords.push({
      keywordId: row.keyword_entity_id,
      displayKeyword: row.display_keyword,
      normalizedKeyword: row.normalized_keyword,
    });
    groups.set(row.topic_node_id, group);
  }
  return [...groups.values()];
}

function facts(
  snapshot: {
    readonly id: string;
    readonly captured_at: string;
    readonly availability: "available" | "partial" | "unavailable";
  },
  rows: Awaited<
    ReturnType<CompetitorMonitorRepository["listSnapshotRankFacts"]>
  >,
): CompetitorMonitorSnapshotFacts {
  if (snapshot.availability === "unavailable") {
    throw new TypeError("unavailable snapshot cannot expose rank facts");
  }
  return {
    snapshotId: snapshot.id,
    capturedAt: snapshot.captured_at,
    availability: snapshot.availability,
    rows: rows.map((row) => ({
      normalizedKeyword: row.normalized_keyword,
      currentRank: row.current_rank,
      currentUrl: row.current_url,
    })),
  };
}

/**
 * Project a canonical DataForSEO collection into the existing Growth Map
 * competitor library. A non-monitor collection returns false and keeps the
 * ordinary customer Keyword/Competitor projections authoritative.
 */
export async function projectCompetitorMonitorSnapshot(
  exec: Executor,
  scope: ProjectScope,
  collectionRunId: string,
  snapshotId: string,
  options: ProjectionOptions = {},
): Promise<CompetitorMonitorProjectionResult> {
  const repository = new CompetitorMonitorRepository(exec);
  const run = await repository.findMonitorRun(scope, collectionRunId);
  if (run === null) return { isCompetitorMonitor: false };

  const current = await repository.findSnapshotMetadata(scope, snapshotId);
  if (current === null || current.id !== snapshotId) {
    throw new TypeError("competitor monitor result snapshot is missing");
  }
  const evaluatedAt = canonicalNow(
    options.now ?? (() => new Date().toISOString()),
  );

  if (current.availability === "unavailable") {
    await repository.insertEvaluation({
      run,
      snapshotId,
      state: "unavailable",
      limitation: "本次 DataForSEO 采集不可用，未生成竞品动态判断。",
      evaluatedAt,
      signals: [],
    });
    return {
      isCompetitorMonitor: true,
      evaluationState: "unavailable",
      signalCount: 0,
    };
  }

  if (
    run.previous_monitor_run_id === null ||
    run.previous_snapshot_id === null
  ) {
    await repository.insertEvaluation({
      run,
      snapshotId,
      state: "baseline",
      limitation: "首次采集仅建立 baseline，不生成竞品动态提醒。",
      evaluatedAt,
      signals: [],
    });
    return {
      isCompetitorMonitor: true,
      evaluationState: "baseline",
      signalCount: 0,
    };
  }

  const previous = await repository.findSnapshotMetadata(
    scope,
    run.previous_snapshot_id,
  );
  if (previous === null || previous.availability === "unavailable") {
    await repository.insertEvaluation({
      run,
      snapshotId,
      state: "unavailable",
      limitation: "缺少上一期可用的 DataForSEO 快照，无法形成月度比较。",
      evaluatedAt,
      signals: [],
    });
    return {
      isCompetitorMonitor: true,
      evaluationState: "unavailable",
      signalCount: 0,
    };
  }

  const [currentRows, previousRows, topicRows] = await Promise.all([
    repository.listSnapshotRankFacts(scope, current.id),
    repository.listSnapshotRankFacts(scope, previous.id),
    repository.listConfirmedTopicKeywords(
      scope,
      run.topic_model_revision,
      run.market,
      run.language_tag,
    ),
  ]);
  const evaluation = evaluateCompetitorMonitor({
    competitorDomain: run.target_domain,
    analysisScopes: run.analysis_scopes,
    current: facts(current, currentRows),
    previous: facts(previous, previousRows),
    topics: groupTopics(topicRows),
  });
  const idFactory = options.idFactory ?? randomUUID;
  const signals = evaluation.signals.map((signal) =>
    signal.kind === "rank_gain"
      ? {
          id: idFactory(),
          kind: signal.kind,
          topicNodeId: signal.topicNodeId,
          keywordEntityId: signal.keywordId,
          contentUrl: null,
          matchedKeywordIds: null,
          overlapRatio: null,
          previousRank: signal.previousRank,
          currentRank: signal.currentRank,
          improvement: signal.improvement,
          limitation: signal.limitation,
        }
      : {
          id: idFactory(),
          kind: signal.kind,
          topicNodeId: signal.topicNodeId,
          keywordEntityId: null,
          contentUrl: signal.url,
          matchedKeywordIds: signal.matchedKeywordIds,
          overlapRatio: signal.overlapRatio,
          previousRank: null,
          currentRank: null,
          improvement: null,
          limitation: signal.limitation,
        },
  );
  await repository.insertEvaluation({
    run,
    snapshotId,
    state: evaluation.evaluationState,
    limitation: evaluation.limitation,
    evaluatedAt,
    signals,
  });
  return {
    isCompetitorMonitor: true,
    evaluationState: evaluation.evaluationState,
    signalCount: signals.length,
  };
}
