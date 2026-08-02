"use client";

/**
 * Sources data-hub client view (spec §4.2, §7). The service keeps its five
 * canonical evidence families, while the customer-managed surface exposes only
 * GSC, GA4, and an honest planned GitHub slot. Crawl, CSV, and DataForSEO remain
 * in the unnamed readiness projection and service layer; they are not rendered
 * as customer connections. `connected` is not `available`, so a connection with
 * no usable snapshot never fakes a measurement (`unavailable != 0`, spec §1.3).
 *
 * TanStack Query owns all server-state (spec §3.2). After a collect/import 202 we
 * poll the run and, on a terminal status, refetch the sources + snapshots so the
 * card reflects the freshly committed snapshot. On refresh the active run id is
 * re-derived from the server projection, so polling recovers (spec §11.2).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  ChevronDown,
  Database,
  FileUp,
  Globe2,
  GitPullRequest,
  RefreshCw,
  Search,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { uniqueCursorItems } from "@/lib/api/cursor-pages";
import {
  Button,
  Field,
  Panel,
  Spinner,
  StatusPill,
  cx,
  type StatusTone,
} from "@/components/ui";
import {
  analysisRefreshRunIdFromError,
  invalidateAnalysisRefreshTerminalQueries,
  isTerminalRunStatus,
  readAnalysisRefreshRunId,
  useConnectSource,
  useCreateAnalysisRefreshRun,
  useCreateCollectionRun,
  useDisconnectSource,
  useImportCsv,
  useProjectRun,
  useProjectSnapshots,
  useProjectSources,
  withAnalysisRefreshRunId,
} from "@/lib/api/hooks-sources";
import type {
  Availability,
  CsvColumnMapping,
  GoogleProvider,
  Provider,
  PropertySelectionPhase,
  RunStatus,
  SnapshotWindow,
  SourceConnection,
  SourceState,
} from "@/lib/api/hooks-sources";
import {
  csvPreviewEntries,
  oauthCallbackMessageKey,
  sourceCollectLabelKey,
  sourceHintMessageKey,
  resolveSourceRunId,
  sourceRunQueryOutcome,
} from "../_frontend-error-state.ts";
import { ProblemNotice, ProblemState } from "../_problem-display";
import { sourceLimitationForDisplay } from "../_view-model.ts";
import {
  SOURCE_PROVIDER_ORDER,
  abbreviateChecksum,
  sourceAcquisitionMode,
  sourceHasUsableSnapshot,
  sourcePrimaryMetric,
  type SourceAcquisitionMode,
} from "./_sources-readiness.ts";
import {
  hasAutomaticAnalysisRefreshIntent,
  withoutAutomaticAnalysisRefreshIntent,
} from "./_analysis-refresh-auto.ts";
import styles from "./sources.module.css";

/** Per-provider glyph for the card logo (visual language from the Artifact). */
const PROVIDER_ICON: Record<Provider, LucideIcon> = {
  crawl: Globe2,
  gsc: Search,
  ga4: BarChart3,
  csv: FileUp,
  dataforseo: Database,
};

const PROVIDER_BADGE: Readonly<Record<Provider, string>> = {
  crawl: "CR",
  gsc: "GS",
  ga4: "GA",
  csv: "CSV",
  dataforseo: "DF",
};

const CUSTOMER_SOURCE_ORDER = ["gsc", "ga4"] as const satisfies readonly Provider[];

interface CustomerConnectorReadiness {
  readonly connectedCount: number;
  readonly usableCount: number;
  readonly partialCount: number;
  readonly unavailableCount: number;
  readonly enabledCount: number;
  readonly gapProviders: readonly GoogleProvider[];
  readonly coveragePercentage: number;
  readonly ready: boolean;
}

function isCustomerSource(
  source: SourceConnection,
): source is SourceConnection & { readonly provider: GoogleProvider } {
  return source.provider === "gsc" || source.provider === "ga4";
}

/**
 * Customer readiness must be explainable from the visible GSC and GA4 cards.
 * GitHub is a planned delivery connector and the three internal evidence
 * families remain in audit/service gates, so neither belongs in this UI ratio.
 */
function deriveCustomerConnectorReadiness(
  sources: readonly SourceConnection[],
): CustomerConnectorReadiness {
  const byProvider = new Map(
    sources.filter(isCustomerSource).map((source) => [source.provider, source]),
  );
  const expectedSources = CUSTOMER_SOURCE_ORDER.map((provider) =>
    byProvider.get(provider),
  );
  const usableCount = expectedSources.filter(
    (source) =>
      source?.featureEnabled === true &&
      sourceHasUsableSnapshot(source),
  ).length;
  const partialCount = expectedSources.filter(
    (source) =>
      source?.featureEnabled === true &&
      source.latestSnapshot?.availability === "partial",
  ).length;
  const enabledCount = CUSTOMER_SOURCE_ORDER.length;
  const gapProviders = CUSTOMER_SOURCE_ORDER.filter((provider) => {
    const source = byProvider.get(provider);
    return (
      source === undefined ||
      !source.featureEnabled ||
      !sourceHasUsableSnapshot(source)
    );
  });

  return {
    connectedCount: expectedSources.filter(
      (source) =>
        source?.featureEnabled === true &&
        source.id !== null &&
        source.state !== "disconnected",
    ).length,
    usableCount,
    partialCount,
    unavailableCount: enabledCount - usableCount - partialCount,
    enabledCount,
    gapProviders,
    coveragePercentage: Math.round((usableCount / enabledCount) * 100),
    ready: usableCount === enabledCount && gapProviders.length === 0,
  };
}

interface SourcesPresentationCopy {
  readonly heroEyebrow: (count: number) => string;
  readonly heroTitle: string;
  readonly heroSummary: (usable: number, partial: number) => string;
  readonly refreshAll: string;
  readonly refreshing: string;
  readonly trustNote: string;
  readonly readinessRegionLabel: string;
  readonly readinessEyebrow: string;
  readonly readinessTitle: string;
  readonly readinessDescription: string;
  readonly readinessComplete: string;
  readonly readinessPartial: string;
  readonly readinessUnavailable: string;
  readonly connected: string;
  readonly usable: string;
  readonly partial: string;
  readonly unavailable: string;
  readonly immutableSnapshots: string;
  readonly historyUnavailable: string;
  readonly coverageGap: string;
  readonly coverageGapDescription: string;
  readonly coverageComplete: string;
  readonly noUsableSnapshots: string;
  readonly noUsableSnapshot: string;
  readonly latestImmutableSnapshot: string;
  readonly provenanceUnavailable: string;
  readonly dataset: string;
  readonly schema: string;
  readonly method: string;
  readonly sourceWindow: string;
  readonly capturedAt: string;
  readonly checksum: string;
  readonly windowUnavailable: string;
  readonly windowFrom: (start: string) => string;
  readonly windowThrough: (end: string) => string;
  readonly metricLabel: Readonly<Record<Provider, string>>;
  readonly metricUnit: Readonly<Record<Provider, string>>;
  readonly metricSupporting: Readonly<
    Record<GoogleProvider, (value: number | null, pages: number) => string>
  >;
  readonly connectedNoData: string;
  readonly noDataGuidance: Readonly<Record<GoogleProvider, string>>;
  readonly rawProviderRecords: string;
  readonly providerRole: Readonly<Record<Provider, string>>;
  readonly snapshotDetails: string;
  readonly sourceHealth: string;
  readonly noMeasuredValue: string;
  readonly readyForDiagnosis: string;
  readonly notReadyForDiagnosis: string;
  readonly reviewDiagnosis: string;
  readonly reviewSourceGaps: string;
  readonly coveragePercentage: (percentage: number) => string;
  readonly mode: Readonly<Record<SourceAcquisitionMode, string>>;
  readonly footerAria: string;
  readonly snapshotsExact: (count: number) => string;
  readonly snapshotsPartial: (count: number) => string;
  readonly immutablePolicy: string;
  readonly credentialsPolicy: string;
}

const EN_SOURCES_COPY: SourcesPresentationCopy = {
  heroEyebrow: (count) =>
    `Customer connections · ${count} ${count === 1 ? "connector" : "connectors"}`,
  heroTitle: "Every recommendation starts with trusted data.",
  heroSummary: (usable, partial) =>
    `${usable} sources have fully usable evidence${partial > 0 ? ` and ${partial} are partially usable` : ""}. Connection state and snapshot availability are shown separately.`,
  refreshAll: "Refresh status",
  refreshing: "Refreshing status…",
  trustNote:
    "This page reads immutable evidence snapshots. Connections, refreshes, imports, limitations, and errors remain tied to their real provider state; credentials are never displayed.",
  readinessRegionLabel: "Source readiness",
  readinessEyebrow: "Evidence coverage",
  readinessTitle: "Coverage you can act on",
  readinessDescription:
    "Only fully usable GSC and GA4 snapshots count toward this customer-visible coverage.",
  readinessComplete: "Analysis connectors usable",
  readinessPartial: "Coverage has gaps",
  readinessUnavailable: "No usable snapshots yet",
  connected: "Connected",
  usable: "Usable",
  partial: "Partial",
  unavailable: "Unavailable",
  immutableSnapshots: "Immutable snapshots",
  historyUnavailable: "History unavailable",
  coverageGap: "Coverage gap",
  coverageGapDescription:
    "Enabled families without a fully usable latest snapshot:",
  coverageComplete: "Both visible analysis connectors have a usable snapshot.",
  noUsableSnapshots: "No usable snapshots yet",
  noUsableSnapshot: "No usable snapshot",
  latestImmutableSnapshot: "Latest immutable snapshot",
  provenanceUnavailable: "Provenance is unavailable until a snapshot is captured.",
  dataset: "Dataset",
  schema: "Schema",
  method: "Method",
  sourceWindow: "Source window",
  capturedAt: "Captured",
  checksum: "Checksum",
  windowUnavailable: "Not provided",
  windowFrom: (start) => `From ${start}`,
  windowThrough: (end) => `Through ${end}`,
  metricLabel: {
    crawl: "Captured URLs",
    gsc: "Search impressions · latest 28 days",
    ga4: "Organic sessions · latest 28 days",
    csv: "Imported keyword rows",
    dataforseo: "Ranking keyword rows",
  },
  metricUnit: {
    crawl: "URLs",
    gsc: "impressions",
    ga4: "sessions",
    csv: "rows",
    dataforseo: "keywords",
  },
  metricSupporting: {
    gsc: (value, pages) =>
      `${value ?? "Unavailable"} clicks · ${pages} landing pages`,
    ga4: (value, pages) =>
      `${value === null ? "Key events unavailable" : `${value} key events`} · ${pages} landing pages`,
  },
  connectedNoData: "Connected · no data detected",
  noDataGuidance: {
    gsc: "The connection succeeded, but the selected Search Console property returned no page/query observations for this window. Check the property and reporting window.",
    ga4: "The connection succeeded, but GA4 returned no organic landing observations. Verify the GA tag or Measurement ID, the Web Data Stream domain, hostname, and Organic Search traffic.",
  },
  rawProviderRecords: "Raw provider records",
  providerRole: {
    crawl: "Network evidence",
    gsc: "First-party search",
    ga4: "First-party analytics",
    csv: "Manual evidence",
    dataforseo: "Search intelligence",
  },
  snapshotDetails: "Snapshot details",
  sourceHealth: "Source health",
  noMeasuredValue: "No usable measurement",
  readyForDiagnosis: "Customer analysis connections are ready",
  notReadyForDiagnosis: "Customer analysis connections need attention",
  reviewDiagnosis: "Review analysis workspace",
  reviewSourceGaps: "Review connection gaps",
  coveragePercentage: (percentage) => `${percentage}% evidence coverage`,
  mode: { live: "Live", manual: "Manual", disabled: "Disabled" },
  footerAria: "Snapshot provenance policy",
  snapshotsExact: (count) =>
    `${count} immutable ${count === 1 ? "snapshot" : "snapshots"}`,
  snapshotsPartial: (count) =>
    `At least ${count} immutable ${count === 1 ? "snapshot" : "snapshots"} loaded`,
  immutablePolicy:
    "Snapshot history is append-only evidence; each capture keeps its dataset, method, window, and checksum.",
  credentialsPolicy:
    "Credentials are never rendered. Connection secrets remain outside this read model.",
};

const ZH_SOURCES_COPY: SourcesPresentationCopy = {
  heroEyebrow: (count) => `客户连接 · ${count} 个连接位`,
  heroTitle: "每一条建议，都从可信数据开始。",
  heroSummary: (usable, partial) =>
    `当前有 ${usable} 个数据来源完全可用${partial > 0 ? `，另有 ${partial} 个部分可用` : ""}；连接状态与快照可用性分别呈现。`,
  refreshAll: "刷新状态",
  refreshing: "正在刷新状态…",
  trustNote:
    "此页面读取不可变证据快照。连接、刷新、导入、限制和错误始终对应真实供应商状态；页面绝不展示连接凭据。",
  readinessRegionLabel: "数据源就绪度",
  readinessEyebrow: "证据覆盖",
  readinessTitle: "数据覆盖足以开始行动",
  readinessDescription:
    "此处仅按 GSC 与 GA4 的完全可用最新快照计算客户可见覆盖率。",
  readinessComplete: "分析连接均可用",
  readinessPartial: "覆盖仍有缺口",
  readinessUnavailable: "尚无可用快照",
  connected: "已连接",
  usable: "可用",
  partial: "部分可用",
  unavailable: "不可用",
  immutableSnapshots: "不可变快照",
  historyUnavailable: "历史暂不可用",
  coverageGap: "覆盖缺口",
  coverageGapDescription: "以下已启用类别尚无完全可用的最新快照：",
  coverageComplete: "两个客户可见分析连接均有可用快照。",
  noUsableSnapshots: "尚无可用快照",
  noUsableSnapshot: "无可用快照",
  latestImmutableSnapshot: "最新不可变快照",
  provenanceUnavailable: "捕获快照前，来源元数据不可用。",
  dataset: "数据集",
  schema: "Schema",
  method: "方法",
  sourceWindow: "数据窗口",
  capturedAt: "捕获时间",
  checksum: "校验和",
  windowUnavailable: "未提供",
  windowFrom: (start) => `自 ${start}`,
  windowThrough: (end) => `截至 ${end}`,
  metricLabel: {
    crawl: "已采集 URL",
    gsc: "近 28 天搜索曝光",
    ga4: "近 28 天自然搜索会话",
    csv: "导入关键词记录",
    dataforseo: "排名关键词记录",
  },
  metricUnit: {
    crawl: "URLs",
    gsc: "次曝光",
    ga4: "次会话",
    csv: "行",
    dataforseo: "关键词",
  },
  metricSupporting: {
    gsc: (value, pages) =>
      `${value ?? "不可用"} 次点击 · ${pages} 个落地页`,
    ga4: (value, pages) =>
      `${value === null ? "关键事件不可用" : `${value} 次关键事件`} · ${pages} 个落地页`,
  },
  connectedNoData: "已连接 · 未检测到数据",
  noDataGuidance: {
    gsc: "连接已成功，但所选 Search Console 资源在当前窗口没有返回页面/查询观察。请检查所选资源与数据窗口。",
    ga4: "连接已成功，但 GA4 没有返回自然搜索落地页观察。请检查网站 GA 标签或 Measurement ID、Web 数据流域名、主机名以及自然搜索流量。",
  },
  rawProviderRecords: "原始供应商记录",
  providerRole: {
    crawl: "网络证据",
    gsc: "第一方搜索",
    ga4: "第一方分析",
    csv: "人工证据",
    dataforseo: "搜索情报",
  },
  snapshotDetails: "快照详情",
  sourceHealth: "数据源健康度",
  noMeasuredValue: "暂无可用度量",
  readyForDiagnosis: "客户分析连接已就绪",
  notReadyForDiagnosis: "客户分析连接仍需处理",
  reviewDiagnosis: "查看分析工作区",
  reviewSourceGaps: "查看连接缺口",
  coveragePercentage: (percentage) => `${percentage}% 证据覆盖`,
  mode: { live: "实时采集", manual: "手动导入", disabled: "未启用" },
  footerAria: "快照来源策略",
  snapshotsExact: (count) => `${count} 个不可变快照`,
  snapshotsPartial: (count) => `已加载至少 ${count} 个不可变快照`,
  immutablePolicy:
    "快照历史是仅追加证据；每次捕获都保留数据集、方法、数据窗口与校验和。",
  credentialsPolicy:
    "页面绝不呈现凭据；连接密钥不属于此只读模型。",
};

function sourcesPresentationCopy(locale: string): SourcesPresentationCopy {
  return locale.toLowerCase().startsWith("zh")
    ? ZH_SOURCES_COPY
    : EN_SOURCES_COPY;
}

// ------------------------------------------------------------- Tone helpers --

function stateTone(state: SourceState): StatusTone {
  switch (state) {
    case "available":
      return "success";
    case "partial":
    case "stale":
      return "warning";
    case "connecting":
    case "connected":
    case "syncing":
      return "info";
    case "permission_denied":
    case "unavailable":
      return "danger";
    default:
      return "neutral";
  }
}

function availabilityTone(availability: Availability): StatusTone {
  switch (availability) {
    case "available":
      return "success";
    case "partial":
      return "warning";
    default:
      return "neutral";
  }
}

function runTone(status: RunStatus): StatusTone {
  switch (status) {
    case "completed":
      return "success";
    case "partial":
      return "warning";
    case "failed":
      return "danger";
    case "running":
    case "queued":
      return "info";
    default:
      return "neutral";
  }
}

function formatDateTime(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatDateOnly(value: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatSourceWindow(
  window: SnapshotWindow,
  locale: string,
  copy: SourcesPresentationCopy,
): string {
  const start =
    window.start === null ? null : formatDateOnly(window.start, locale);
  const end = window.end === null ? null : formatDateOnly(window.end, locale);
  if (start !== null && end !== null) return `${start} – ${end}`;
  if (start !== null) return copy.windowFrom(start);
  if (end !== null) return copy.windowThrough(end);
  return copy.windowUnavailable;
}

// --------------------------------------------------------------- Run watcher --

/**
 * Polls one run and reports the terminal transition exactly once. While running
 * it shows a spinner + the worker's progress; once terminal it shows the final
 * status pill (the parent then refetches and unmounts this watcher).
 */
function RunWatcher({
  projectId,
  runId,
  onSettled,
}: {
  readonly projectId: string;
  readonly runId: string;
  readonly onSettled: (
    outcome: "terminal" | "query_error",
    runId: string,
  ) => void;
}) {
  const t = useTranslations("sources");
  const tRun = useTranslations("runState");
  const query = useProjectRun(projectId, runId);
  const run = query.data;
  const settled = useRef(false);
  const outcome = sourceRunQueryOutcome(run, query.error);

  useEffect(() => {
    if (
      (outcome === "terminal" || outcome === "query_error") &&
      !settled.current
    ) {
      settled.current = true;
      onSettled(outcome, runId);
    }
  }, [outcome, onSettled, runId]);

  if (outcome === "query_error") {
    return (
      <p className={styles.runFailure} role="alert">
        {t("runStatusUnavailable")}
      </p>
    );
  }

  if (!run) {
    return (
      <div className={styles.runRow} role="status" aria-live="polite">
        <Spinner size="sm" label={t("inProgress")} />
        <span className={styles.runText}>{t("inProgress")}</span>
      </div>
    );
  }

  const running = !isTerminalRunStatus(run.status);
  const progress =
    run.progress.total !== null
      ? t("progress", {
          current: run.progress.current,
          total: run.progress.total,
        })
      : t("inProgress");
  return (
    <div className={styles.runRow} aria-live="polite">
      {running ? <Spinner size="sm" label={tRun(run.status)} /> : null}
      <StatusPill tone={runTone(run.status)}>{tRun(run.status)}</StatusPill>
      <span className={styles.runText}>{progress}</span>
      {run.lastError !== null ? (
        <span className={styles.runError}>{run.lastError.summary}</span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Freshness --

function Freshness({
  source,
  snapshotCount,
  snapshotHistoryComplete,
}: {
  readonly source: SourceConnection;
  readonly snapshotCount: number | null;
  readonly snapshotHistoryComplete: boolean;
}) {
  const t = useTranslations("sources");
  const tState = useTranslations("sourceState");
  const locale = useLocale();
  const copy = sourcesPresentationCopy(locale);
  const snap = source.latestSnapshot;
  const metric = sourcePrimaryMetric(source);
  const metricValue = metric.value;
  const historyLabel =
    snapshotCount === null
      ? t("snapshotHistoryUnavailable")
      : snapshotHistoryComplete
        ? t("snapshotHistory", { count: snapshotCount })
        : t("snapshotHistoryPartial", { count: snapshotCount });

  return (
    <div className={styles.freshness}>
      <div className={styles.primaryMetric}>
        <span className={styles.metaLabel}>
          {copy.metricLabel[source.provider]}
        </span>
        {metricValue === null ? (
          <strong className={styles.metricUnavailable}>
            {source.featureEnabled ? copy.noMeasuredValue : t("notAvailable")}
          </strong>
        ) : (
          <div className={styles.metricStack}>
            <p className={styles.metricValue}>
              <strong data-testid="source-provenance-dynamic">
                {new Intl.NumberFormat(locale, { notation: "compact" }).format(
                  metricValue,
                )}
              </strong>
              <span>{copy.metricUnit[source.provider]}</span>
            </p>
            {source.provider === "gsc" || source.provider === "ga4" ? (
              <span className={styles.metricSupporting}>
                {copy.metricSupporting[source.provider](
                  metric.supportingValue,
                  metric.landingPageCount ?? 0,
                )}
              </span>
            ) : null}
          </div>
        )}
      </div>

      <dl className={styles.snapshotFacts}>
        <div className={styles.snapshotFact}>
          <dt>{t("lastCollected")}</dt>
          <dd>
            {snap === null ? (
              "—"
            ) : (
              <time dateTime={snap.capturedAt}>
                {formatDateOnly(snap.capturedAt, locale)}
              </time>
            )}
          </dd>
        </div>
        <div className={styles.snapshotFact}>
          <dt>{t("availabilityLabel")}</dt>
          <dd>
            {snap === null ? (
              source.featureEnabled ? (
                copy.noUsableSnapshot
              ) : (
                t("notAvailable")
              )
            ) : (
              sourceHasUsableSnapshot(source) ? (
                <StatusPill tone={availabilityTone(snap.availability)}>
                  {tState(snap.availability)}
                </StatusPill>
              ) : (
                <StatusPill tone="warning">{copy.connectedNoData}</StatusPill>
              )
            )}
          </dd>
        </div>
      </dl>

      {snap === null ? (
        <div className={styles.freshEmpty}>
          <strong>{t("noSnapshot")}</strong>
          <span>{copy.provenanceUnavailable}</span>
        </div>
      ) : (
        <details className={styles.provenance}>
          <summary className={styles.provenanceSummary}>
            <span className={styles.provenanceSummaryLead}>
              <Database size={16} strokeWidth={1.8} aria-hidden="true" />
              <span>{copy.latestImmutableSnapshot}</span>
            </span>
            <span className={styles.snapHistory}>{historyLabel}</span>
            <ChevronDown
              className={styles.provenanceChevron}
              size={16}
              strokeWidth={2}
              aria-hidden="true"
            />
          </summary>
          <div className={styles.provenanceBody}>
            <div className={styles.provenanceHead}>
              <h3 className={styles.provenanceTitle}>{copy.snapshotDetails}</h3>
              {source.state === "stale" ? (
                <StatusPill tone="warning">{tState("stale")}</StatusPill>
              ) : null}
            </div>
            <dl className={styles.provenanceGrid}>
              <div className={styles.provenanceItem}>
                <dt>{copy.dataset}</dt>
                <dd data-testid="source-provenance-dynamic">{snap.datasetKey}</dd>
              </div>
              <div className={styles.provenanceItem}>
                <dt>{copy.schema}</dt>
                <dd data-testid="source-provenance-dynamic">
                  {snap.schemaVersion}
                </dd>
              </div>
              <div className={styles.provenanceItem}>
                <dt>{copy.method}</dt>
                <dd data-testid="source-provenance-dynamic">
                  {snap.methodVersion}
                </dd>
              </div>
              <div className={styles.provenanceItem}>
                <dt>{copy.sourceWindow}</dt>
                <dd data-testid="source-provenance-dynamic">
                  {formatSourceWindow(snap.sourceWindow, locale, copy)}
                </dd>
              </div>
              <div className={styles.provenanceItem}>
                <dt>{t("lastCollected")}</dt>
                <dd data-testid="source-provenance-dynamic">
                  {formatDateTime(snap.capturedAt, locale)}
                </dd>
              </div>
              <div className={styles.provenanceItem}>
                <dt>{copy.rawProviderRecords}</dt>
                <dd className={styles.provenanceRows}>
                  {new Intl.NumberFormat(locale).format(snap.rowCount)}
                </dd>
              </div>
              <div className={styles.provenanceItem}>
                <dt>{copy.checksum}</dt>
                <dd
                  className={styles.provenanceChecksum}
                  data-testid="source-provenance-dynamic"
                >
                  {abbreviateChecksum(snap.checksum)}
                </dd>
              </div>
            </dl>
          </div>
        </details>
      )}
    </div>
  );
}

// -------------------------------------------------------------- Crawl controls --

function CrawlControls({
  projectId,
  onStarted,
  runActive,
  sourceState,
}: {
  readonly projectId: string;
  readonly onStarted: (runId: string) => void;
  readonly runActive: boolean;
  readonly sourceState: SourceState;
}) {
  const t = useTranslations("sources");
  const mutation = useCreateCollectionRun(projectId);
  const busy = mutation.isPending;
  const start = () => {
    mutation.mutate(
      { provider: "crawl" },
      { onSuccess: (data) => onStarted(data.run.id) },
    );
  };
  return (
    <div className={styles.controls}>
      <Button variant="ghost" onClick={start} disabled={busy || runActive}>
        <RefreshCw size={15} strokeWidth={2} aria-hidden="true" />
        {busy || runActive
          ? t("collecting")
          : t(sourceCollectLabelKey(sourceState))}
      </Button>
      {mutation.error !== null ? (
        <ProblemNotice
          className={styles.controlError}
          error={mutation.error}
          message={t("runStatusUnavailable")}
          compact
        />
      ) : null}
    </div>
  );
}

// --------------------------------------------------------- Property selection --

function PropertySelection({
  projectId,
  provider,
  intent,
  onDone,
  onConnected,
}: {
  readonly projectId: string;
  readonly provider: GoogleProvider;
  readonly intent: PropertySelectionPhase;
  readonly onDone: () => void;
  readonly onConnected: (source: SourceConnection) => void;
}) {
  const t = useTranslations("sources");
  const tCommon = useTranslations("common");
  const connect = useConnectSource(projectId);
  const [selected, setSelected] = useState<string>(
    intent.properties[0]?.id ?? "",
  );
  const busy = connect.isPending;
  const selectId = `${provider}-property`;

  const confirm = () => {
    connect.mutate(
      {
        provider,
        request: {
          phase: "select_property",
          oauthIntentId: intent.oauthIntentId,
          externalPropertyId: selected,
        },
      },
      {
        onSuccess: (data) => {
          if (data.phase === "connected") onConnected(data.source);
        },
      },
    );
  };

  return (
    <div className={styles.property}>
      <Field
        label={t("selectProperty")}
        help={t("selectPropertyHelp")}
        htmlFor={selectId}
      >
        <select
          id={selectId}
          className={styles.select}
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          {intent.properties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.displayName}
            </option>
          ))}
        </select>
      </Field>
      <div className={styles.controls}>
        <Button
          variant="primary"
          onClick={confirm}
          disabled={busy || selected.length === 0}
        >
          {t("connectProperty")}
        </Button>
        <Button variant="secondary" onClick={onDone} disabled={busy}>
          {tCommon("cancel")}
        </Button>
      </div>
      {connect.error !== null ? (
        <ProblemNotice
          className={styles.controlError}
          error={connect.error}
          message={t("oauthError")}
          compact
        />
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------- OAuth controls --

function OAuthControls({
  source,
  provider,
  projectId,
  intent,
  onClearIntent,
  onStarted,
  runActive,
}: {
  readonly source: SourceConnection;
  readonly provider: GoogleProvider;
  readonly projectId: string;
  readonly intent: PropertySelectionPhase | null;
  readonly onClearIntent: () => void;
  readonly onStarted: (runId: string) => void;
  readonly runActive: boolean;
}) {
  const t = useTranslations("sources");
  const connect = useConnectSource(projectId);
  const collect = useCreateCollectionRun(projectId);

  if (intent) {
    return (
      <PropertySelection
        projectId={projectId}
        provider={provider}
        intent={intent}
        onDone={onClearIntent}
        onConnected={() => onClearIntent()}
      />
    );
  }

  const connected = source.id !== null && source.state !== "disconnected";

  if (!connected) {
    const busy = connect.isPending;
    const authorize = () => {
      connect.mutate(
        {
          provider,
          request: {
            phase: "authorize",
            returnPath: `/p/${projectId}/sources`,
          },
        },
        {
          onSuccess: (data) => {
            if (data.phase === "authorization") {
              window.location.href = data.authorizationUrl;
            }
          },
        },
      );
    };
    return (
      <div className={styles.controls}>
        <Button variant="ghost" onClick={authorize} disabled={busy}>
          <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
          {busy ? t("authorizing") : t("connect")}
        </Button>
        {connect.error !== null ? (
          <ProblemNotice
            className={styles.controlError}
            error={connect.error}
            message={t("oauthError")}
            compact
          />
        ) : null}
      </div>
    );
  }

  if (source.state === "permission_denied") {
    return null;
  }

  const sourceId = source.id;
  const busy = collect.isPending;
  const start = () => {
    if (sourceId === null) return;
    collect.mutate(
      { provider, sourceConnectionId: sourceId },
      { onSuccess: (data) => onStarted(data.run.id) },
    );
  };
  return (
    <div className={styles.controls}>
      <Button variant="ghost" onClick={start} disabled={busy || runActive}>
        <RefreshCw size={15} strokeWidth={2} aria-hidden="true" />
        {busy || runActive
          ? t("collecting")
          : t(sourceCollectLabelKey(source.state))}
      </Button>
      {collect.error !== null ? (
        <ProblemNotice
          className={styles.controlError}
          error={collect.error}
          message={t("runStatusUnavailable")}
          compact
        />
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------- CSV import --

type CsvFieldKey =
  | "keyword"
  | "searchVolume"
  | "cluster"
  | "currentUrl"
  | "currentRank"
  | "competitorDomain"
  | "competitorRank"
  | "marketCode"
  | "languageCode";

type CsvMappingState = Record<CsvFieldKey, string>;

const CSV_FIELDS: readonly {
  readonly key: CsvFieldKey;
  readonly required: boolean;
}[] = [
  { key: "keyword", required: true },
  { key: "searchVolume", required: true },
  { key: "marketCode", required: true },
  { key: "languageCode", required: true },
  { key: "cluster", required: false },
  { key: "currentUrl", required: false },
  { key: "currentRank", required: false },
  { key: "competitorDomain", required: false },
  { key: "competitorRank", required: false },
];

const EMPTY_CSV_MAPPING: CsvMappingState = {
  keyword: "",
  searchVolume: "",
  cluster: "",
  currentUrl: "",
  currentRank: "",
  competitorDomain: "",
  competitorRank: "",
  marketCode: "",
  languageCode: "",
};

function prefillMapping(
  detected: readonly string[],
  suggested: Readonly<Record<string, string | null>>,
): CsvMappingState {
  const pick = (key: CsvFieldKey): string => {
    const value = suggested[key];
    return typeof value === "string" && detected.includes(value) ? value : "";
  };
  return {
    keyword: pick("keyword"),
    searchVolume: pick("searchVolume"),
    cluster: pick("cluster"),
    currentUrl: pick("currentUrl"),
    currentRank: pick("currentRank"),
    competitorDomain: pick("competitorDomain"),
    competitorRank: pick("competitorRank"),
    marketCode: pick("marketCode"),
    languageCode: pick("languageCode"),
  };
}

function buildMapping(state: CsvMappingState): CsvColumnMapping | null {
  if (
    !state.keyword ||
    !state.searchVolume ||
    !state.marketCode ||
    !state.languageCode
  ) {
    return null;
  }
  const optional = (value: string): string | null =>
    value.length > 0 ? value : null;
  return {
    keyword: state.keyword,
    searchVolume: state.searchVolume,
    marketCode: state.marketCode,
    languageCode: state.languageCode,
    cluster: optional(state.cluster),
    currentUrl: optional(state.currentUrl),
    currentRank: optional(state.currentRank),
    competitorDomain: optional(state.competitorDomain),
    competitorRank: optional(state.competitorRank),
  };
}

export function CsvPreview({
  columns,
  rows,
  caption,
  rowLabel,
}: {
  readonly columns: readonly string[];
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly caption: string;
  readonly rowLabel: (rowNumber: number) => string;
}) {
  const entries = csvPreviewEntries(columns, rows);
  return (
    <>
      <div className={styles.previewWrap}>
        <table className={styles.previewTable}>
          <caption>{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => {
                return (
                  <th key={column} scope="col">
                    {column}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {columns.map((column) => {
                  const value = row[column];
                  return (
                    <td key={column}>{value == null ? "" : String(value)}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ol className={styles.previewCards} aria-label={caption}>
        {entries.map((entry) => (
          <li
            key={entry.rowNumber}
            className={styles.previewCard}
            aria-label={rowLabel(entry.rowNumber)}
          >
            <dl className={styles.previewCardFields}>
              {entry.fields.map((field) => (
                <div key={field.label} className={styles.previewCardField}>
                  <dt>{field.label}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ol>
    </>
  );
}

function MappingEditor({
  detected,
  state,
  onChange,
}: {
  readonly detected: readonly string[];
  readonly state: CsvMappingState;
  readonly onChange: (key: CsvFieldKey, value: string) => void;
}) {
  const t = useTranslations("sources");
  return (
    <div className={styles.mapGrid}>
      {CSV_FIELDS.map((field) => {
        const controlId = `csv-map-${field.key}`;
        const label = `${t(`fields.${field.key}`)}${field.required ? " *" : ""}`;
        return (
          <Field key={field.key} label={label} htmlFor={controlId}>
            <select
              id={controlId}
              className={styles.select}
              value={state[field.key]}
              onChange={(event) => onChange(field.key, event.target.value)}
            >
              <option value="">
                {field.required ? t("selectColumn") : t("mappingNone")}
              </option>
              {detected.map((column) => (
                <option key={column} value={column}>
                  {column}
                </option>
              ))}
            </select>
          </Field>
        );
      })}
    </div>
  );
}

function CsvControls({
  projectId,
  onStarted,
  runActive,
}: {
  readonly projectId: string;
  readonly onStarted: (runId: string) => void;
  readonly runActive: boolean;
}) {
  const t = useTranslations("sources");
  const tCommon = useTranslations("common");
  const importer = useImportCsv(projectId);
  const [mapping, setMapping] = useState<CsvMappingState>(EMPTY_CSV_MAPPING);
  const preview = importer.preview.data;
  const fileId = "csv-file-input";

  useEffect(() => {
    if (preview)
      setMapping(
        prefillMapping(preview.detectedColumns, preview.suggestedMapping),
      );
  }, [preview]);

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    importer.confirm.reset();
    importer.preview.mutate(file);
  };

  const confirmMapping = preview ? buildMapping(mapping) : null;
  const hasBlockingErrors = (preview?.errors.length ?? 0) > 0;
  const confirm = () => {
    if (!preview || confirmMapping === null) return;
    importer.confirm.mutate(
      { importToken: preview.importToken, mapping: confirmMapping },
      {
        onSuccess: (data) => {
          onStarted(data.run.id);
          importer.preview.reset();
          setMapping(EMPTY_CSV_MAPPING);
        },
      },
    );
  };

  return (
    <details
      className={styles.actionDrawer}
      open={
        importer.preview.isPending ||
        preview !== undefined ||
        importer.preview.error !== null
          ? true
          : undefined
      }
    >
      <summary className={styles.drawerSummary}>
        <FileUp size={16} strokeWidth={1.9} aria-hidden="true" />
        <span>{t("chooseFile")}</span>
        <ChevronDown size={15} strokeWidth={2} aria-hidden="true" />
      </summary>
      <div className={styles.drawerBody}>
        <div className={styles.csv}>
          <Field label={t("chooseFile")} htmlFor={fileId}>
            <input
              id={fileId}
              type="file"
              accept=".csv,text/csv"
              className={styles.fileInput}
              disabled={importer.preview.isPending || runActive}
              onChange={onFile}
            />
          </Field>

          {importer.preview.isPending ? (
            <div className={styles.runRow} role="status">
              <Spinner size="sm" label={t("reading")} />
              <span className={styles.runText}>{t("reading")}</span>
            </div>
          ) : null}

          {importer.preview.error !== null ? (
            <ProblemNotice
              className={styles.alert}
              error={importer.preview.error}
              message={tCommon("error")}
              compact
            />
          ) : null}

          {preview ? (
            <div className={styles.previewBlock}>
          <p className={styles.previewMeta}>
            {t("previewMeta", {
              shown: preview.previewRows.length,
              total: preview.rowCount,
            })}
          </p>
          {preview.errors.length > 0 ? (
            <ul className={cx(styles.msgList, styles.msgError)}>
              {preview.errors.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          ) : null}
          {preview.warnings.length > 0 ? (
            <ul className={cx(styles.msgList, styles.msgWarn)}>
              {preview.warnings.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          ) : null}

          <CsvPreview
            columns={preview.detectedColumns}
            rows={preview.previewRows}
            caption={t("previewTableCaption", {
              rows: preview.previewRows.length,
              columns: preview.detectedColumns.length,
            })}
            rowLabel={(rowNumber) => t("previewRow", { row: rowNumber })}
          />

          <h3 className={styles.mapTitle}>{t("columnMapping")}</h3>
          <p className={styles.mapHelp}>{t("columnMappingHelp")}</p>
          <MappingEditor
            detected={preview.detectedColumns}
            state={mapping}
            onChange={(key, value) =>
              setMapping((prev) => ({ ...prev, [key]: value }))
            }
          />

          <div className={styles.controls}>
            <Button
              variant="primary"
              onClick={confirm}
              disabled={
                importer.confirm.isPending ||
                runActive ||
                confirmMapping === null ||
                hasBlockingErrors
              }
            >
              {importer.confirm.isPending ? t("importing") : t("confirmImport")}
            </Button>
            {confirmMapping === null ? (
              <span className={styles.controlHint}>
                {t("confirmDisabledHint")}
              </span>
            ) : null}
          </div>
          {importer.confirm.error !== null ? (
            <ProblemNotice
              className={styles.controlError}
              error={importer.confirm.error}
              message={tCommon("error")}
              compact
            />
          ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </details>
  );
}

// ----------------------------------------------------------- Disabled + disconnect --

function DisabledControls() {
  const t = useTranslations("sources");
  return <p className={styles.disabledNote}>{t("notAvailable")}</p>;
}

function DisconnectButton({
  projectId,
  sourceConnectionId,
  providerLabel,
  onDone,
  disabled,
}: {
  readonly projectId: string;
  readonly sourceConnectionId: string;
  readonly providerLabel: string;
  readonly onDone: () => void;
  readonly disabled: boolean;
}) {
  const t = useTranslations("sources");
  const mutation = useDisconnectSource(projectId);
  const busy = mutation.isPending;
  const run = () => {
    mutation.mutate(sourceConnectionId, { onSuccess: () => onDone() });
  };
  return (
    <Button
      variant="ghost"
      onClick={run}
      disabled={busy || disabled}
      aria-label={`${t("disconnect")} — ${providerLabel}`}
    >
      {busy ? t("disconnecting") : t("disconnect")}
    </Button>
  );
}

// ------------------------------------------------------------------- Controls --

function SourceControls({
  source,
  projectId,
  intent,
  onClearIntent,
  onStarted,
  runActive,
}: {
  readonly source: SourceConnection;
  readonly projectId: string;
  readonly intent: PropertySelectionPhase | null;
  readonly onClearIntent: () => void;
  readonly onStarted: (runId: string) => void;
  readonly runActive: boolean;
}) {
  switch (source.provider) {
    case "crawl":
      return (
        <CrawlControls
          projectId={projectId}
          onStarted={onStarted}
          runActive={runActive}
          sourceState={source.state}
        />
      );
    case "gsc":
    case "ga4":
      return (
        <OAuthControls
          source={source}
          provider={source.provider}
          projectId={projectId}
          intent={intent}
          onClearIntent={onClearIntent}
          onStarted={onStarted}
          runActive={runActive}
        />
      );
    case "csv":
      return (
        <CsvControls
          projectId={projectId}
          onStarted={onStarted}
          runActive={runActive}
        />
      );
    case "dataforseo":
      return <DisabledControls />;
  }
}

// ---------------------------------------------------------------------- Card --

function SourceCard({
  source,
  projectId,
  snapshotCount,
  snapshotHistoryComplete,
  onRefetch,
  intent,
  onClearIntent,
}: {
  readonly source: SourceConnection;
  readonly projectId: string;
  readonly snapshotCount: number | null;
  readonly snapshotHistoryComplete: boolean;
  readonly onRefetch: () => void;
  readonly intent: PropertySelectionPhase | null;
  readonly onClearIntent: () => void;
}) {
  const t = useTranslations("sources");
  const tCommon = useTranslations("common");
  const tProvider = useTranslations("provider");
  const tState = useTranslations("sourceState");
  const locale = useLocale();
  const copy = sourcesPresentationCopy(locale);
  const [startedRunId, setStartedRunId] = useState<string | null>(null);
  const [settledRunId, setSettledRunId] = useState<string | null>(null);
  const [failedRunId, setFailedRunId] = useState<string | null>(null);

  const activeRunId = resolveSourceRunId(
    startedRunId,
    source.activeRun?.id ?? null,
    settledRunId,
  );
  const runActive = activeRunId !== null;
  const onStarted = useCallback((runId: string) => {
    setSettledRunId(null);
    setFailedRunId(null);
    setStartedRunId(runId);
  }, []);
  const onSettled = useCallback(
    (outcome: "terminal" | "query_error", runId: string) => {
      setStartedRunId(null);
      setSettledRunId(runId);
      setFailedRunId(outcome === "query_error" ? runId : null);
      onRefetch();
    },
    [onRefetch],
  );

  const titleId = `source-${source.provider}`;
  const providerLabel = tProvider(source.provider);
  const sourceId = source.id;
  const hintKey = sourceHintMessageKey(source);
  const disconnectable =
    sourceId !== null &&
    (source.connectionType === "oauth" ||
      source.connectionType === "file_import" ||
      source.connectionType === "api_key_stub") &&
    source.state !== "disconnected";
  const ProviderIcon = PROVIDER_ICON[source.provider];
  const acquisitionMode = sourceAcquisitionMode(source);
  const hasUsableSnapshot = sourceHasUsableSnapshot(source);
  const historyLabel =
    snapshotCount === null
      ? copy.historyUnavailable
      : snapshotHistoryComplete
        ? copy.snapshotsExact(snapshotCount)
        : copy.snapshotsPartial(snapshotCount);

  return (
    <Panel
      padding="none"
      className={cx(
        styles.card,
        !source.featureEnabled && styles.cardUnavailable,
      )}
      data-provider={source.provider}
      data-source-card=""
      data-customer-connector-card=""
      data-connector-state="active"
      aria-labelledby={titleId}
    >
      <header className={styles.cardHead}>
        <span className={styles.sourceLogo} aria-hidden="true">
          <ProviderIcon size={21} strokeWidth={1.85} />
          <span className={styles.sourceBadge}>
            {PROVIDER_BADGE[source.provider]}
          </span>
        </span>
        <div className={styles.cardHeadText}>
          <span className={styles.sourceMode}>
            {copy.providerRole[source.provider]} · {copy.mode[acquisitionMode]}
          </span>
          <h2 id={titleId} className={styles.cardTitle}>
            {providerLabel}
          </h2>
        </div>
        <div className={styles.cardStatuses}>
          <StatusPill
            tone={
              source.latestSnapshot !== null && !hasUsableSnapshot
                ? "warning"
                : stateTone(source.state)
            }
          >
            {source.latestSnapshot !== null && !hasUsableSnapshot
              ? copy.connectedNoData
              : tState(source.state)}
          </StatusPill>
        </div>
      </header>

      <div className={styles.cardBody}>
        <Freshness
          source={source}
          snapshotCount={snapshotCount}
          snapshotHistoryComplete={snapshotHistoryComplete}
        />

        <p className={styles.limitation}>
          <span className={styles.metaLabel}>{t("limitationLabel")}</span>
          <span>
            {source.latestSnapshot !== null &&
            !hasUsableSnapshot &&
            (source.provider === "gsc" || source.provider === "ga4")
              ? copy.noDataGuidance[source.provider]
              : sourceLimitationForDisplay(source)}
          </span>
        </p>

        {hintKey !== null ? (
          <p className={styles.controlHint}>{t(hintKey)}</p>
        ) : null}

        {runActive && activeRunId !== null ? (
          <RunWatcher
            projectId={projectId}
            runId={activeRunId}
            onSettled={onSettled}
          />
        ) : null}

        {failedRunId !== null && activeRunId === null ? (
          <div className={styles.runFailure} role="alert">
            <span>{t("runStatusUnavailable")}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setStartedRunId(failedRunId);
                setSettledRunId(null);
                setFailedRunId(null);
              }}
            >
              {tCommon("retry")}
            </Button>
          </div>
        ) : null}
      </div>

      <footer className={styles.cardFooter}>
        <span className={styles.footerHistory}>
          <Database size={16} strokeWidth={1.8} aria-hidden="true" />
          {historyLabel}
        </span>
        <div className={styles.cardActions}>
          <SourceControls
            source={source}
            projectId={projectId}
            intent={intent}
            onClearIntent={onClearIntent}
            onStarted={onStarted}
            runActive={runActive}
          />
          {disconnectable && sourceId !== null ? (
            <DisconnectButton
              projectId={projectId}
              sourceConnectionId={sourceId}
              providerLabel={providerLabel}
              onDone={onRefetch}
              disabled={runActive}
            />
          ) : null}
        </div>
      </footer>
    </Panel>
  );
}

// ------------------------------------------------ Customer / internal split --

function GithubPlannedCard() {
  const t = useTranslations("sources");
  const titleId = "source-github";

  return (
    <Panel
      padding="none"
      className={cx(styles.card, styles.cardPlanned)}
      data-provider="github"
      data-customer-connector-card=""
      data-connector-state="planned"
      aria-labelledby={titleId}
    >
      <header className={styles.cardHead}>
        <span className={styles.sourceLogo} aria-hidden="true">
          <GitPullRequest size={21} strokeWidth={1.85} />
          <span className={styles.sourceBadge}>GH</span>
        </span>
        <div className={styles.cardHeadText}>
          <span className={styles.sourceMode}>
            {t("connections.customerTitle")}
          </span>
          <h2 id={titleId} className={styles.cardTitle}>
            {t("connections.githubLabel")}
          </h2>
        </div>
        <div className={styles.cardStatuses}>
          <StatusPill tone="warning">
            {t("connections.githubStatus")}
          </StatusPill>
        </div>
      </header>

      <div className={cx(styles.cardBody, styles.plannedBody)}>
        <GitPullRequest
          className={styles.plannedIcon}
          size={28}
          strokeWidth={1.6}
          aria-hidden="true"
        />
        <p>{t("connections.githubDescription")}</p>
      </div>

      <footer className={styles.plannedFooter}>
        <span>{t("connections.githubStatus")}</span>
      </footer>
    </Panel>
  );
}

// ---------------------------------------------------------- Readiness summary --

function ReadinessSummary({
  sources,
  snapshotCount,
  snapshotHistoryComplete,
}: {
  readonly sources: readonly SourceConnection[];
  readonly snapshotCount: number | null;
  readonly snapshotHistoryComplete: boolean;
}) {
  const locale = useLocale();
  const tProvider = useTranslations("provider");
  const copy = sourcesPresentationCopy(locale);
  const readiness = deriveCustomerConnectorReadiness(sources);
  const hasGaps = readiness.gapProviders.length > 0;
  const hasUsableSnapshots = readiness.usableCount > 0;
  const overallLabel = !hasUsableSnapshots
    ? copy.readinessUnavailable
    : hasGaps
      ? copy.readinessPartial
      : copy.readinessComplete;
  const coveragePercentage = readiness.coveragePercentage;
  const historyValue =
    snapshotCount === null
      ? "—"
      : snapshotHistoryComplete
        ? String(snapshotCount)
        : `≥ ${snapshotCount}`;
  const gapLabels = readiness.gapProviders.map((provider) =>
    tProvider(provider),
  );

  return (
    <Panel
      padding="none"
      className={styles.readiness}
      id="source-readiness"
      data-source-readiness=""
      aria-label={copy.readinessRegionLabel}
    >
      <div className={styles.readinessLead} data-source-readiness-lead="">
        <div
          className={styles.coverageRing}
          role="meter"
          aria-label={copy.coveragePercentage(coveragePercentage)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={coveragePercentage}
        >
          <svg viewBox="0 0 48 48" aria-hidden="true">
            <circle cx="24" cy="24" r="20" pathLength="100" />
            <circle
              className={styles.coverageArc}
              cx="24"
              cy="24"
              r="20"
              pathLength="100"
              strokeDasharray={`${coveragePercentage} 100`}
            />
          </svg>
          <strong data-testid="source-readiness-dynamic">
            {coveragePercentage}%
          </strong>
        </div>
        <div className={styles.readinessCopy}>
          <span className={styles.readinessEyebrow}>
            {copy.readinessEyebrow}
          </span>
          <h2 className={styles.readinessTitle}>{copy.readinessTitle}</h2>
          <p className={styles.readinessDescription}>
            {copy.readinessDescription}
          </p>
          <p className={styles.familyCount}>
            <strong data-testid="source-readiness-dynamic">
              {readiness.usableCount} / {readiness.enabledCount}
            </strong>
            <span>{copy.usable}</span>
            <span aria-hidden="true">·</span>
            <span>
              {copy.immutableSnapshots}: {historyValue}
            </span>
          </p>
        </div>
      </div>

      <dl className={styles.readinessMetrics}>
        <div className={styles.readinessMetric}>
          <dt>{copy.connected}</dt>
          <dd data-testid="source-readiness-dynamic">
            {readiness.connectedCount}
            <progress
              value={readiness.connectedCount}
              max={Math.max(readiness.enabledCount, 1)}
              aria-label={copy.connected}
            />
          </dd>
        </div>
        <div className={styles.readinessMetric}>
          <dt>{copy.usable}</dt>
          <dd data-testid="source-readiness-dynamic">
            {readiness.usableCount}
            <progress
              value={readiness.usableCount}
              max={Math.max(readiness.enabledCount, 1)}
              aria-label={copy.usable}
            />
          </dd>
        </div>
        <div className={styles.readinessMetric}>
          <dt>{copy.partial}</dt>
          <dd data-testid="source-readiness-dynamic">
            {readiness.partialCount}
            <progress
              value={readiness.partialCount}
              max={Math.max(readiness.enabledCount, 1)}
              aria-label={copy.partial}
            />
          </dd>
        </div>
      </dl>

      {hasGaps ? (
        <aside
          className={styles.gapCallout}
          data-source-readiness-gap=""
          role="note"
          aria-label={copy.coverageGap}
        >
          <AlertTriangle size={20} strokeWidth={1.9} aria-hidden="true" />
          <div className={styles.gapCopy}>
            <strong>
              <span data-testid="source-readiness-dynamic">
                {readiness.unavailableCount}
              </span>{" "}
              {copy.unavailable}
            </strong>
            <span className={styles.gapLabel}>{copy.coverageGap}</span>
            <p>
              {!hasUsableSnapshots
                ? copy.noUsableSnapshots
                : copy.coverageGapDescription}
            </p>
            {gapLabels.length > 0 ? (
              <span className={styles.gapProviders}>
                {gapLabels.join(", ")}
              </span>
            ) : null}
          </div>
        </aside>
      ) : (
        <div className={styles.coverageComplete}>
          <ShieldCheck size={20} strokeWidth={1.9} aria-hidden="true" />
          <div>
            <strong>{overallLabel}</strong>
            <p>{copy.coverageComplete}</p>
          </div>
        </div>
      )}
    </Panel>
  );
}

function SnapshotPolicyFootline({
  projectId,
  sources,
  snapshotCount,
  snapshotHistoryComplete,
}: {
  readonly projectId: string;
  readonly sources: readonly SourceConnection[];
  readonly snapshotCount: number | null;
  readonly snapshotHistoryComplete: boolean;
}) {
  const locale = useLocale();
  const copy = sourcesPresentationCopy(locale);
  const readyForDiagnosis =
    deriveCustomerConnectorReadiness(sources).ready;
  const countLabel =
    snapshotCount === null
      ? copy.historyUnavailable
      : snapshotHistoryComplete
        ? copy.snapshotsExact(snapshotCount)
        : copy.snapshotsPartial(snapshotCount);

  return (
    <footer
      className={styles.footline}
      role="contentinfo"
      aria-label={copy.footerAria}
      data-source-footline=""
      data-readiness-state={readyForDiagnosis ? "ready" : "not-ready"}
    >
      <div className={styles.footlineItem}>
        <Database size={19} strokeWidth={1.8} aria-hidden="true" />
        <div className={styles.footlineCopy}>
          <strong data-testid="source-provenance-dynamic">{countLabel}</strong>
          <span>{copy.immutablePolicy}</span>
        </div>
      </div>
      <div className={styles.footlineItem}>
        {readyForDiagnosis ? (
          <ShieldCheck size={19} strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <AlertTriangle size={19} strokeWidth={1.8} aria-hidden="true" />
        )}
        <div className={styles.footlineCopy}>
          <strong>
            {readyForDiagnosis
              ? copy.readyForDiagnosis
              : copy.notReadyForDiagnosis}
          </strong>
          <span>{copy.credentialsPolicy}</span>
        </div>
      </div>
      <Link
        href={
          readyForDiagnosis
            ? `/p/${projectId}/growth-map?object=pages`
            : "#source-readiness"
        }
        className={styles.diagnosisLink}
      >
        <span>
          {readyForDiagnosis ? copy.reviewDiagnosis : copy.reviewSourceGaps}
        </span>
        <ArrowRight size={17} strokeWidth={2} aria-hidden="true" />
      </Link>
    </footer>
  );
}

// ----------------------------------------------------------------- Screen ----

/** A validated Google provider read from the OAuth-callback return query. */
function toGoogleProvider(value: string | null): GoogleProvider | null {
  return value === "gsc" || value === "ga4" ? value : null;
}

export function SourcesClient({ projectId }: { readonly projectId: string }) {
  const t = useTranslations("sources");
  const tCommon = useTranslations("common");
  const tRun = useTranslations("runState");
  const locale = useLocale();
  const copy = sourcesPresentationCopy(locale);
  const queryClient = useQueryClient();

  const sources = useProjectSources(projectId);
  const gscSnapshots = useProjectSnapshots(projectId, "gsc");
  const ga4Snapshots = useProjectSnapshots(projectId, "ga4");
  const connect = useConnectSource(projectId);
  const createAnalysisRefresh = useCreateAnalysisRefreshRun(projectId);

  const [intent, setIntent] = useState<PropertySelectionPhase | null>(null);
  const [topAlert, setTopAlert] = useState<string | null>(null);
  const [analysisRefreshRunId, setAnalysisRefreshRunId] = useState<
    string | null
  >(null);
  const [analysisRefreshRecovered, setAnalysisRefreshRecovered] =
    useState(false);
  const [analysisRefreshAdopted, setAnalysisRefreshAdopted] = useState(false);
  const [analysisRefreshTerminal, setAnalysisRefreshTerminal] = useState<{
    readonly status: RunStatus;
    readonly errorSummary: string | null;
  } | null>(null);
  const analysisRefreshRun = useProjectRun(
    projectId,
    analysisRefreshRunId ?? "",
  );
  const handledCallback = useRef(false);
  const handledAutomaticAnalysisRefresh = useRef(false);
  const handledAnalysisRefreshTerminals = useRef<Set<string>>(new Set());
  const analysisRefreshActive = analysisRefreshRunId !== null;
  const analysisRefreshSubmitting = createAnalysisRefresh.isPending;

  const replaceAnalysisRefreshRun = useCallback((runId: string | null) => {
    window.history.replaceState(
      null,
      "",
      withAnalysisRefreshRunId(window.location.href, runId),
    );
    setAnalysisRefreshRunId(runId);
  }, []);

  const startAnalysisRefresh = useCallback(async (): Promise<void> => {
    if (
      !analysisRefreshRecovered ||
      analysisRefreshActive ||
      analysisRefreshSubmitting
    ) {
      return;
    }
    setAnalysisRefreshTerminal(null);
    setAnalysisRefreshAdopted(false);
    createAnalysisRefresh.reset();
    try {
      const accepted = await createAnalysisRefresh.mutateAsync();
      replaceAnalysisRefreshRun(accepted.run.id);
    } catch (error) {
      const winnerRunId = analysisRefreshRunIdFromError(error);
      if (winnerRunId !== null) {
        createAnalysisRefresh.reset();
        setAnalysisRefreshAdopted(true);
        replaceAnalysisRefreshRun(winnerRunId);
      }
    }
  }, [
    analysisRefreshActive,
    analysisRefreshRecovered,
    analysisRefreshSubmitting,
    createAnalysisRefresh,
    replaceAnalysisRefreshRun,
  ]);

  // The durable pointer lives in the URL rather than component memory, so a
  // browser refresh resumes the exact parent run. Invalid untrusted values are
  // removed without touching OAuth or future query parameters.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const recovered = readAnalysisRefreshRunId(window.location.search);
    if (recovered !== null) {
      setAnalysisRefreshRunId(recovered);
    } else if (params.has("analysisRefreshRunId")) {
      window.history.replaceState(
        null,
        "",
        withAnalysisRefreshRunId(window.location.href, null),
      );
    }
    setAnalysisRefreshRecovered(true);
  }, []);

  // Confirmation redirects here with a one-time command intent. Consume the
  // marker before crossing the API boundary so reloads cannot enqueue a second
  // parent run. A 409 still adopts the canonical active winner below.
  useEffect(() => {
    if (
      handledAutomaticAnalysisRefresh.current ||
      !analysisRefreshRecovered ||
      analysisRefreshActive ||
      analysisRefreshSubmitting ||
      !hasAutomaticAnalysisRefreshIntent(window.location.search)
    ) {
      return;
    }
    handledAutomaticAnalysisRefresh.current = true;
    window.history.replaceState(
      null,
      "",
      withoutAutomaticAnalysisRefreshIntent(window.location.href),
    );
    void startAnalysisRefresh();
  }, [
    analysisRefreshActive,
    analysisRefreshRecovered,
    analysisRefreshSubmitting,
    startAnalysisRefresh,
  ]);

  // Recover the property-selection phase from the OAuth-callback return query
  // (spec §7.4): read `oauthIntentId` + `provider` once, fetch the candidate
  // properties, then strip the query so a refresh does not re-trigger.
  useEffect(() => {
    if (handledCallback.current) return;
    handledCallback.current = true;
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("error");
    const oauthIntentId = params.get("oauthIntentId");
    const provider = toGoogleProvider(params.get("provider"));
    const strip = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("error");
      url.searchParams.delete("oauthIntentId");
      url.searchParams.delete("provider");
      window.history.replaceState(
        null,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    };

    if (oauthError) {
      setTopAlert(t(oauthCallbackMessageKey(oauthError)));
      strip();
      return;
    }
    if (oauthIntentId && provider) {
      strip();
      connect
        .mutateAsync({
          provider,
          request: { phase: "property_selection", oauthIntentId },
        })
        .then((data) => {
          if (data.phase === "property_selection") setIntent(data);
        })
        .catch(() => setTopAlert(t("oauthError")));
    }
  }, [connect, t]);

  // Every terminal outcome refreshes all evidence and audit/growth prefixes.
  // The terminal notice is kept after polling stops so partial/failure is never
  // visually promoted to a blanket provider success.
  useEffect(() => {
    const run = analysisRefreshRun.data;
    if (
      run === undefined ||
      !isTerminalRunStatus(run.status) ||
      handledAnalysisRefreshTerminals.current.has(run.id)
    ) {
      return;
    }
    handledAnalysisRefreshTerminals.current.add(run.id);
    setAnalysisRefreshTerminal({
      status: run.status,
      errorSummary: run.lastError?.summary ?? null,
    });
    setAnalysisRefreshAdopted(false);
    replaceAnalysisRefreshRun(null);
    void invalidateAnalysisRefreshTerminalQueries(queryClient, projectId);
  }, [
    analysisRefreshRun.data,
    projectId,
    queryClient,
    replaceAnalysisRefreshRun,
  ]);

  // A UUID in the URL is only an untrusted polling pointer. If the scoped run
  // does not exist (including a run copied from another Project), remove only
  // that pointer so the customer is not permanently locked out of starting or
  // adopting the canonical active run.
  useEffect(() => {
    if (
      analysisRefreshRunId === null ||
      analysisRefreshRun.error === null ||
      analysisRefreshRun.error.status !== 404
    ) {
      return;
    }
    setAnalysisRefreshAdopted(false);
    replaceAnalysisRefreshRun(null);
    setTopAlert(t("analysisRefresh.staleRunCleared"));
  }, [
    analysisRefreshRun.error,
    analysisRefreshRunId,
    replaceAnalysisRefreshRun,
    t,
  ]);

  const refetchSources = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["sources", projectId] });
    void queryClient.invalidateQueries({ queryKey: ["snapshots", projectId] });
  }, [queryClient, projectId]);

  const loadedGscSnapshots = useMemo(
    () =>
      uniqueCursorItems(gscSnapshots.data).filter(
        (snapshot) => snapshot.provider === "gsc",
      ),
    [gscSnapshots.data],
  );
  const loadedGa4Snapshots = useMemo(
    () =>
      uniqueCursorItems(ga4Snapshots.data).filter(
        (snapshot) => snapshot.provider === "ga4",
      ),
    [ga4Snapshots.data],
  );
  const gscSnapshotHistoryAvailable = gscSnapshots.data !== undefined;
  const ga4SnapshotHistoryAvailable = ga4Snapshots.data !== undefined;
  const gscSnapshotHistoryComplete =
    gscSnapshotHistoryAvailable &&
    !gscSnapshots.hasNextPage &&
    !gscSnapshots.isError &&
    !gscSnapshots.isFetchNextPageError;
  const ga4SnapshotHistoryComplete =
    ga4SnapshotHistoryAvailable &&
    !ga4Snapshots.hasNextPage &&
    !ga4Snapshots.isError &&
    !ga4Snapshots.isFetchNextPageError;
  const snapshotHistoryAvailable =
    gscSnapshotHistoryAvailable && ga4SnapshotHistoryAvailable;
  const snapshotHistoryComplete =
    gscSnapshotHistoryComplete && ga4SnapshotHistoryComplete;
  const snapshotHistoryLoadError =
    gscSnapshots.isError ||
    gscSnapshots.isFetchNextPageError ||
    ga4Snapshots.isError ||
    ga4Snapshots.isFetchNextPageError;
  const snapshotHistoryLoading =
    gscSnapshots.isLoading || ga4Snapshots.isLoading;
  const snapshotHistoryHasNext =
    gscSnapshots.hasNextPage === true || ga4Snapshots.hasNextPage === true;
  const snapshotHistoryFetching =
    gscSnapshots.isFetching || ga4Snapshots.isFetching;
  const snapshotHistoryFetchingNext =
    gscSnapshots.isFetchingNextPage || ga4Snapshots.isFetchingNextPage;

  const ordered = useMemo(() => {
    const list = sources.data ?? [];
    return SOURCE_PROVIDER_ORDER.map((provider) =>
      list.find((source) => source.provider === provider),
    ).filter((source): source is SourceConnection => source !== undefined);
  }, [sources.data]);
  const customerSources = ordered.filter((source) =>
    isCustomerSource(source),
  );

  if (sources.isLoading) {
    return (
      <div className={styles.state}>
        <Spinner size="lg" label={tCommon("loading")} />
        <p className={styles.stateText}>{tCommon("loading")}</p>
      </div>
    );
  }

  if (sources.error !== null || sources.data === undefined) {
    return (
      <div className={styles.state}>
        <ProblemState error={sources.error} onRetry={() => void sources.refetch()} />
      </div>
    );
  }

  const pageReadiness = deriveCustomerConnectorReadiness(customerSources);
  const refreshing =
    sources.isFetching ||
    snapshotHistoryFetching ||
    (analysisRefreshRunId !== null && analysisRefreshRun.isFetching);
  const customerSnapshotHistoryCount = snapshotHistoryAvailable
    ? loadedGscSnapshots.length + loadedGa4Snapshots.length
    : null;
  const customerSnapshotHistories = {
    gsc: {
      count: gscSnapshotHistoryAvailable ? loadedGscSnapshots.length : null,
      complete: gscSnapshotHistoryComplete,
    },
    ga4: {
      count: ga4SnapshotHistoryAvailable ? loadedGa4Snapshots.length : null,
      complete: ga4SnapshotHistoryComplete,
    },
  } satisfies Readonly<
    Record<
      GoogleProvider,
      { readonly count: number | null; readonly complete: boolean }
    >
  >;
  const loadMoreCustomerSnapshots = () => {
    const customerSnapshotQueries = [gscSnapshots, ga4Snapshots] as const;
    if (snapshotHistoryLoadError) {
      void Promise.all(
        customerSnapshotQueries.flatMap((query) => {
          if (query.isFetchNextPageError) return [query.fetchNextPage()];
          if (query.isError) return [query.refetch()];
          return [];
        }),
      );
      return;
    }
    void Promise.all(
      customerSnapshotQueries.flatMap((query) =>
        query.hasNextPage ? [query.fetchNextPage()] : [],
      ),
    );
  };
  const analysisRefreshPolling = analysisRefreshRun.data;
  const analysisRefreshProgress =
    analysisRefreshPolling?.progress.total !== null &&
    analysisRefreshPolling?.progress.total !== undefined
      ? t("analysisRefresh.progress", {
          current: analysisRefreshPolling.progress.current,
          total: analysisRefreshPolling.progress.total,
        })
      : t("analysisRefresh.inProgress");
  const analysisRefreshTerminalMessage =
    analysisRefreshTerminal === null
      ? null
      : t(`analysisRefresh.terminal.${analysisRefreshTerminal.status}`);

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroText}>
          <div className={styles.heroEyebrow}>
            <h1 className={styles.pageLabel}>{t("title")}</h1>
            <span aria-hidden="true">·</span>
            <span>{copy.heroEyebrow(3)}</span>
          </div>
          <h2 className={styles.heroTitle}>{copy.heroTitle}</h2>
          <p className={styles.subtitle}>
            {copy.heroSummary(
              pageReadiness.usableCount,
              pageReadiness.partialCount,
            )}
          </p>
        </div>
        <div className={styles.heroActions}>
          <Button
            variant="primary"
            className={styles.refreshButton}
            onClick={() => void startAnalysisRefresh()}
            disabled={
              !analysisRefreshRecovered ||
              analysisRefreshActive ||
              analysisRefreshSubmitting
            }
          >
            <RefreshCw
              className={cx(
                (analysisRefreshActive || analysisRefreshSubmitting) &&
                  styles.refreshIcon,
              )}
              size={17}
              strokeWidth={2}
              aria-hidden="true"
            />
            {analysisRefreshSubmitting
              ? t("analysisRefresh.submitting")
              : analysisRefreshActive
                ? t("analysisRefresh.running")
                : t("analysisRefresh.start")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              void Promise.all([
                sources.refetch(),
                gscSnapshots.refetch(),
                ga4Snapshots.refetch(),
                ...(analysisRefreshRunId !== null
                  ? [analysisRefreshRun.refetch()]
                  : []),
              ]);
            }}
            disabled={refreshing}
          >
            <RefreshCw
              className={cx(refreshing && styles.refreshIcon)}
              size={16}
              strokeWidth={2}
              aria-hidden="true"
            />
            {refreshing ? copy.refreshing : copy.refreshAll}
          </Button>
        </div>
      </header>

      <aside className={styles.trustStrip} aria-label={copy.sourceHealth}>
        <ShieldCheck size={18} strokeWidth={1.9} aria-hidden="true" />
        <p>{copy.trustNote}</p>
      </aside>

      {analysisRefreshActive ? (
        <section
          className={styles.analysisRefreshStatus}
          aria-live="polite"
          aria-label={t("analysisRefresh.statusTitle")}
        >
          <div className={styles.analysisRefreshStatusLead}>
            {analysisRefreshRun.isError ? null : (
              <Spinner
                size="sm"
                label={t("analysisRefresh.inProgress")}
              />
            )}
            <div>
              <strong>{t("analysisRefresh.statusTitle")}</strong>
              <p>
                {analysisRefreshAdopted
                  ? t("analysisRefresh.adopted")
                  : analysisRefreshProgress}
              </p>
            </div>
          </div>
          {analysisRefreshPolling !== undefined ? (
            <StatusPill tone={runTone(analysisRefreshPolling.status)}>
              {tRun(analysisRefreshPolling.status)}
            </StatusPill>
          ) : null}
          {analysisRefreshRun.error !== null ? (
            <div className={styles.analysisRefreshError}>
              <ProblemNotice
                error={analysisRefreshRun.error}
                message={t("analysisRefresh.statusError")}
                compact
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void analysisRefreshRun.refetch()}
              >
                {t("analysisRefresh.retryStatus")}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {analysisRefreshTerminal !== null &&
      analysisRefreshTerminalMessage !== null ? (
        <section
          className={styles.analysisRefreshStatus}
          aria-live="polite"
          data-terminal-status={analysisRefreshTerminal.status}
        >
          <div className={styles.analysisRefreshStatusLead}>
            <div>
              <strong>{t("analysisRefresh.statusTitle")}</strong>
              <p>{analysisRefreshTerminalMessage}</p>
              {analysisRefreshTerminal.errorSummary !== null ? (
                <p className={styles.runError}>
                  {analysisRefreshTerminal.errorSummary}
                </p>
              ) : null}
            </div>
          </div>
          <StatusPill tone={runTone(analysisRefreshTerminal.status)}>
            {tRun(analysisRefreshTerminal.status)}
          </StatusPill>
        </section>
      ) : null}

      {!analysisRefreshActive &&
      createAnalysisRefresh.error !== null ? (
        <ProblemNotice
          className={styles.alert}
          error={createAnalysisRefresh.error}
          message={t("analysisRefresh.submitError")}
        />
      ) : null}

      <ReadinessSummary
        sources={customerSources}
        snapshotCount={customerSnapshotHistoryCount}
        snapshotHistoryComplete={snapshotHistoryComplete}
      />

      {topAlert !== null ? (
        <p className={styles.alert} role="alert">
          {topAlert}
        </p>
      ) : null}

      <section
        className={styles.customerConnections}
        aria-labelledby="customer-connections-title"
      >
        <header className={styles.connectionSectionHeader}>
          <h2 id="customer-connections-title">
            {t("connections.customerTitle")}
          </h2>
          <p>{t("connections.customerDescription")}</p>
        </header>
        <div
          className={styles.cards}
          data-source-grid=""
          data-customer-connector-grid=""
        >
          {customerSources.map((source) => (
            <SourceCard
              key={source.provider}
              source={source}
              projectId={projectId}
              snapshotCount={customerSnapshotHistories[source.provider].count}
              snapshotHistoryComplete={
                customerSnapshotHistories[source.provider].complete
              }
              onRefetch={refetchSources}
              intent={intent?.provider === source.provider ? intent : null}
              onClearIntent={() => setIntent(null)}
            />
          ))}
          <GithubPlannedCard />
        </div>
      </section>

      {snapshotHistoryLoading ||
      snapshotHistoryLoadError ||
      snapshotHistoryHasNext ? (
        <div className={styles.pagination} aria-live="polite">
          {snapshotHistoryLoading ? (
            <span className={styles.paginationStatus}>
              <Spinner size="sm" label={t("loadingHistory")} />
              {t("loadingHistory")}
            </span>
          ) : null}
          {snapshotHistoryLoadError ? (
            <p className={styles.paginationError} role="alert">
              {tCommon("loadMoreError")}
            </p>
          ) : null}
          {!snapshotHistoryLoading &&
          (snapshotHistoryHasNext || snapshotHistoryLoadError) ? (
            <Button
              variant="secondary"
              onClick={loadMoreCustomerSnapshots}
              disabled={
                snapshotHistoryFetchingNext || snapshotHistoryFetching
              }
            >
              {snapshotHistoryFetchingNext || snapshotHistoryFetching
                ? tCommon("loadingMore")
                : snapshotHistoryLoadError
                  ? tCommon("retry")
                  : t("loadMoreHistory")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <SnapshotPolicyFootline
        projectId={projectId}
        sources={customerSources}
        snapshotCount={customerSnapshotHistoryCount}
        snapshotHistoryComplete={snapshotHistoryComplete}
      />
    </div>
  );
}
