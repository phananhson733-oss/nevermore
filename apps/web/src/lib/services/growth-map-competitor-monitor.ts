import {
  CompetitorMonitorRepository,
  type CompetitorMonitorLibraryRow,
  type CompetitorMonitorSignalRow,
  type Executor,
  type ProjectScope,
  type WorkspaceScope,
} from "@sf/db";
import {
  CompetitorMonitorConfig,
  CompetitorMonitorResponse,
  type CompetitorMonitorItem,
  type CompetitorMonitorSignal,
  type UpdateCompetitorMonitorRequest,
} from "@sf/contracts";
import { ProblemError } from "@sf/observability";

import { getDb } from "@/lib/db";

const MAX_VISIBLE_SIGNALS_PER_RUN = 100;
const MAX_LIMITATION_LENGTH = 2_000;
const LEGACY_SIGNAL_TRUNCATION_LIMITATION =
  "该期历史动态超过 100 条；此处仅显示按发现时间稳定选择的最近 100 条，完整记录仍保留。";

function projectScope(
  scope: WorkspaceScope,
  projectId: string,
): ProjectScope {
  return { workspaceId: scope.workspaceId, projectId };
}

function corruptMonitor(): never {
  throw new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    "竞品动态监控数据暂时不可用。",
  );
}

function combineLimitations(
  ...parts: readonly (string | null | undefined)[]
): string | null {
  const unique = [
    ...new Set(parts.map((part) => part?.trim()).filter(Boolean)),
  ] as string[];
  if (unique.length === 0) return null;
  const combined = unique.join(" ");
  if (combined.length <= MAX_LIMITATION_LENGTH) return combined;
  return `${combined.slice(0, MAX_LIMITATION_LENGTH - 1).trimEnd()}…`;
}

function mapConfig(
  row: Awaited<
    ReturnType<CompetitorMonitorRepository["findSettings"]>
  >,
) {
  if (row === null) return null;
  const parsed = CompetitorMonitorConfig.safeParse({
    enabled: row.enabled,
    frequency: row.frequency,
    revision: row.revision,
    updatedAt: row.updated_at,
  });
  if (!parsed.success) return corruptMonitor();
  return parsed.data;
}

function mapSignal(row: CompetitorMonitorSignalRow): CompetitorMonitorSignal {
  const common = {
    signalId: row.id,
    competitorId: row.competitor_id,
    detectedAt: row.detected_at,
    currentSnapshotId: row.current_snapshot_id,
    previousSnapshotId: row.previous_snapshot_id,
    topicNodeId: row.topic_node_id,
    topicLabel: row.topic_label,
    limitation: row.limitation,
    opportunityUpdate: {
      state: "ready" as const,
      growthMapSection: "competitor_library" as const,
      sourceRef: `competitor_monitor_signal:${row.id}`,
    },
  };

  if (row.signal_kind === "rank_gain") {
    if (
      row.keyword_entity_id === null ||
      row.keyword === null ||
      row.previous_rank === null ||
      row.current_rank === null ||
      row.improvement === null
    ) {
      return corruptMonitor();
    }
    return {
      ...common,
      kind: "rank_gain",
      keywordId: row.keyword_entity_id,
      keyword: row.keyword,
      previousRank: row.previous_rank,
      currentRank: row.current_rank,
      improvement: row.improvement,
    };
  }

  if (
    row.content_url === null ||
    row.matched_keyword_ids === null ||
    row.overlap_ratio === null ||
    row.limitation === null
  ) {
    return corruptMonitor();
  }
  return {
    ...common,
    kind: "new_content_overlap",
    url: row.content_url,
    matchedKeywordIds: row.matched_keyword_ids,
    overlapRatio: row.overlap_ratio,
    publicationEvidence: "first_observed_in_ranked_keywords",
    limitation: row.limitation,
  };
}

function unavailableItem(
  row: CompetitorMonitorLibraryRow,
  limitation: string,
  eligibility: CompetitorMonitorItem["eligibility"] = "unavailable",
): CompetitorMonitorItem {
  return {
    competitorId: row.competitor_id,
    domain: row.domain,
    name: row.name,
    relationship: row.relationship,
    analysisScopes: row.analysis_scopes,
    eligibility,
    collectionState: "unavailable",
    evaluationState: "unavailable",
    lastCollectionAt: row.last_collection_at,
    nextCollectionAt: null,
    limitation,
    recentSignals: [],
  };
}

function mapLibraryItem(input: {
  readonly row: CompetitorMonitorLibraryRow;
  readonly signals: readonly CompetitorMonitorSignal[];
  readonly sourceAvailable: boolean;
  readonly configEnabled: boolean;
  readonly signalsTruncated: boolean;
  readonly generatedAt: string;
}): CompetitorMonitorItem {
  const { row } = input;
  const eligible =
    row.analysis_scopes.includes("content") ||
    row.analysis_scopes.includes("serp_visibility");

  if (!eligible) {
    return unavailableItem(
      row,
      "该已审核竞品未启用 Content 或 SERP visibility 分析范围。",
      "ineligible",
    );
  }
  if (!input.sourceAvailable) {
    return unavailableItem(
      row,
      "DataForSEO 数据源尚未连接，无法进行真实月度采集。",
      "eligible",
    );
  }

  const collecting =
    row.run_status === "queued" || row.run_status === "running";
  if (collecting) {
    return {
      competitorId: row.competitor_id,
      domain: row.domain,
      name: row.name,
      relationship: row.relationship,
      analysisScopes: row.analysis_scopes,
      eligibility: "eligible",
      collectionState: "collecting",
      evaluationState: "pending",
      lastCollectionAt: row.last_collection_at,
      nextCollectionAt: null,
      limitation: input.configEnabled
        ? null
        : "竞品动态监控已暂停；当前采集完成后不会继续排期。",
      recentSignals: [],
    };
  }

  const nextCollectionAt = input.configEnabled
    ? row.monitor_run_id === null
      ? input.generatedAt
      : row.next_collection_at ?? corruptMonitor()
    : null;

  if (row.monitor_run_id === null) {
    return {
      competitorId: row.competitor_id,
      domain: row.domain,
      name: row.name,
      relationship: row.relationship,
      analysisScopes: row.analysis_scopes,
      eligibility: "eligible",
      collectionState: "never_collected",
      evaluationState: "pending",
      lastCollectionAt: null,
      nextCollectionAt,
      limitation: input.configEnabled
        ? null
        : "竞品动态监控尚未启用。",
      recentSignals: [],
    };
  }

  if (row.evaluation_state === "baseline") {
    return {
      competitorId: row.competitor_id,
      domain: row.domain,
      name: row.name,
      relationship: row.relationship,
      analysisScopes: row.analysis_scopes,
      eligibility: "eligible",
      collectionState: "collected",
      evaluationState: "baseline",
      lastCollectionAt: row.last_collection_at,
      nextCollectionAt,
      limitation:
        row.evaluation_limitation ??
        "首次采集仅建立 baseline，不生成竞品动态提醒。",
      recentSignals: [],
    };
  }

  if (row.evaluation_state === "available") {
    const pausedLimitation = input.configEnabled
      ? null
      : "竞品动态监控已暂停；历史可比结果仍保留。";
    return {
      competitorId: row.competitor_id,
      domain: row.domain,
      name: row.name,
      relationship: row.relationship,
      analysisScopes: row.analysis_scopes,
      eligibility: "eligible",
      collectionState: "collected",
      evaluationState: "available",
      lastCollectionAt: row.last_collection_at,
      nextCollectionAt,
      limitation: combineLimitations(
        input.signalsTruncated
          ? LEGACY_SIGNAL_TRUNCATION_LIMITATION
          : null,
        row.evaluation_limitation,
        pausedLimitation,
      ),
      recentSignals: [...input.signals],
    };
  }

  return {
    ...unavailableItem(
      row,
      row.evaluation_limitation ??
        "最近一次采集缺少完整的历史、来源或可比时间窗口。",
      "eligible",
    ),
    lastCollectionAt: row.last_collection_at,
    nextCollectionAt,
  };
}

async function readMonitorInSnapshot(
  exec: Executor,
  scope: WorkspaceScope,
  projectId: string,
  now: Date,
) {
  const exactScope = projectScope(scope, projectId);
  const repository = new CompetitorMonitorRepository(exec);
  const [settings, context] = await Promise.all([
    repository.findSettings(exactScope),
    repository.readContext(exactScope),
  ]);
  if (context === null) {
    throw new ProblemError("NOT_FOUND", "项目或主站点不存在。");
  }

  const config = mapConfig(settings);
  const generatedAt = now.toISOString();
  const uniqueContext =
    context.market_codes.length === 1 &&
    context.language_codes.length === 1 &&
    context.topic_model_revision !== null;

  if (!uniqueContext) {
    const parsed = CompetitorMonitorResponse.safeParse({
      projectId,
      config,
      scope: null,
      availability: "unavailable",
      limitation:
        "竞品动态监控需要主站点唯一的目标市场、内容语言与 latest-confirmed Topic。",
      competitors: [],
      generatedAt,
    });
    if (!parsed.success) return corruptMonitor();
    return parsed.data;
  }

  const rows = await repository.listLibraryRows(exactScope);
  const availableRunIds = rows.flatMap((row) =>
    row.evaluation_state === "available" && row.monitor_run_id !== null
      ? [row.monitor_run_id]
      : [],
  );
  const signalRows =
    availableRunIds.length === 0
      ? []
      : await repository.listSignals(exactScope, availableRunIds);
  const signalsByRun = new Map<string, CompetitorMonitorSignal[]>();
  const truncatedRunIds = new Set<string>();
  for (const row of signalRows) {
    if (row.run_signal_count > MAX_VISIBLE_SIGNALS_PER_RUN) {
      truncatedRunIds.add(row.monitor_run_id);
    }
    const signal = mapSignal(row);
    const current = signalsByRun.get(row.monitor_run_id) ?? [];
    current.push(signal);
    signalsByRun.set(row.monitor_run_id, current);
  }

  const competitors = rows.map((row) =>
    mapLibraryItem({
      row,
      signals:
        row.monitor_run_id === null
          ? []
          : (signalsByRun.get(row.monitor_run_id) ?? []),
      sourceAvailable: context.source_available,
      configEnabled: config?.enabled === true,
      signalsTruncated:
        row.monitor_run_id !== null &&
        truncatedRunIds.has(row.monitor_run_id),
      generatedAt,
    }),
  );
  const parsed = CompetitorMonitorResponse.safeParse({
    projectId,
    config,
    scope: {
      market: context.market_codes[0],
      languageTag: context.language_codes[0],
      topicModelRevision: context.topic_model_revision,
    },
    availability: "available",
    limitation: null,
    competitors,
    generatedAt,
  });
  if (!parsed.success) return corruptMonitor();
  return parsed.data;
}

export async function getProjectAuditCompetitorMonitor(
  scope: WorkspaceScope,
  projectId: string,
  exec?: Executor,
  now = new Date(),
) {
  if (exec) {
    return readMonitorInSnapshot(exec, scope, projectId, now);
  }
  return getDb().db.transaction(
    (tx) => readMonitorInSnapshot(tx, scope, projectId, now),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export async function updateProjectAuditCompetitorMonitor(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  input: UpdateCompetitorMonitorRequest,
  exec?: Executor,
) {
  const write = async (writer: Executor) => {
    const exactScope = projectScope(scope, projectId);
    const repository = new CompetitorMonitorRepository(writer);
    const saved = await repository.saveSettings(exactScope, actorId, input);
    if (saved !== null) return mapConfig(saved);

    const current = await repository.findSettings(exactScope);
    if (current !== null) {
      throw new ProblemError(
        "VERSION_CONFLICT",
        "竞品动态监控设置已更新，请刷新后重试。",
        {
          current: {
            expectedRevision: input.expectedRevision,
            currentRevision: current.revision,
          },
        },
      );
    }
    throw new ProblemError("NOT_FOUND", "项目不存在或已归档。");
  };

  if (exec) return write(exec);
  return getDb().db.transaction(write, { isolationLevel: "serializable" });
}
