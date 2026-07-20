"use client";

/**
 * Sources data-hub client view (spec §4.2, §7). Renders the five fixed source
 * cards (crawl, gsc, ga4, csv, dataforseo) with honest state: `connected` is not
 * `available`, so a card with no usable snapshot says "no snapshot yet" rather
 * than faking a number (`unavailable != 0`, spec §1.3). Status is always carried
 * by a text label, never colour alone (spec §4.4).
 *
 * TanStack Query owns all server-state (spec §3.2). After a collect/import 202 we
 * poll the run and, on a terminal status, refetch the sources + snapshots so the
 * card reflects the freshly committed snapshot. On refresh the active run id is
 * re-derived from the server projection, so polling recovers (spec §11.2).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  BarChart3,
  Database,
  FileUp,
  Globe2,
  Search,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { uniqueCursorItems } from "@/lib/api/cursor-pages";
import {
  Button,
  Field,
  Panel,
  Spinner,
  StatusPill,
  TextInput,
  cx,
  type StatusTone,
} from "@/components/ui";
import {
  isTerminalRunStatus,
  useConnectSource,
  useCreateCollectionRun,
  useDisconnectSource,
  useImportCsv,
  useProjectRun,
  useProjectSnapshots,
  useProjectSources,
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
  deriveSourcesReadiness,
  sourceAcquisitionMode,
  type SourceAcquisitionMode,
} from "./_sources-readiness.ts";
import styles from "./sources.module.css";

/** Per-provider glyph for the card logo (visual language from the Artifact). */
const PROVIDER_ICON: Record<Provider, LucideIcon> = {
  crawl: Globe2,
  gsc: Search,
  ga4: BarChart3,
  csv: FileUp,
  dataforseo: Database,
};

interface SourcesPresentationCopy {
  readonly readinessEyebrow: string;
  readonly readinessTitle: string;
  readonly readinessDescription: string;
  readonly readinessComplete: string;
  readonly readinessPartial: string;
  readonly readinessUnavailable: string;
  readonly families: string;
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
  readonly partialSnapshot: string;
  readonly noUsableSnapshot: string;
  readonly missingFamily: string;
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
  readonly mode: Readonly<Record<SourceAcquisitionMode, string>>;
  readonly footerAria: string;
  readonly snapshotsExact: (count: number) => string;
  readonly snapshotsPartial: (count: number) => string;
  readonly immutablePolicy: string;
  readonly credentialsPolicy: string;
}

const EN_SOURCES_COPY: SourcesPresentationCopy = {
  readinessEyebrow: "Evidence coverage",
  readinessTitle: "Source readiness",
  readinessDescription:
    "Counts come from canonical source slots and their latest snapshots. Connections alone never count as usable data.",
  readinessComplete: "Enabled sources usable",
  readinessPartial: "Coverage has gaps",
  readinessUnavailable: "No usable snapshots yet",
  families: "Canonical families",
  connected: "Connected",
  usable: "Usable",
  partial: "Partial",
  unavailable: "Unavailable",
  immutableSnapshots: "Immutable snapshots",
  historyUnavailable: "History unavailable",
  coverageGap: "Coverage gap",
  coverageGapDescription:
    "Enabled families without a fully usable latest snapshot:",
  coverageComplete: "Every enabled source family has a usable snapshot.",
  noUsableSnapshots: "No usable snapshots yet",
  partialSnapshot: "Partial snapshot",
  noUsableSnapshot: "No usable snapshot",
  missingFamily: "Canonical family missing",
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
  readinessEyebrow: "证据覆盖",
  readinessTitle: "数据源就绪度",
  readinessDescription:
    "计数仅来自规范数据源槽位及其最新快照。仅有连接绝不计为可用数据。",
  readinessComplete: "已启用数据源均可用",
  readinessPartial: "覆盖仍有缺口",
  readinessUnavailable: "尚无可用快照",
  families: "规范数据源类别",
  connected: "已连接",
  usable: "可用",
  partial: "部分可用",
  unavailable: "不可用",
  immutableSnapshots: "不可变快照",
  historyUnavailable: "历史暂不可用",
  coverageGap: "覆盖缺口",
  coverageGapDescription: "以下已启用类别尚无完全可用的最新快照：",
  coverageComplete: "每个已启用的数据源类别都有可用快照。",
  noUsableSnapshots: "尚无可用快照",
  partialSnapshot: "部分可用快照",
  noUsableSnapshot: "无可用快照",
  missingFamily: "缺少规范数据源类别",
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

  if (!snap) {
    return (
      <div className={styles.freshEmpty}>
        <strong>{t("noSnapshot")}</strong>
        <span>{copy.provenanceUnavailable}</span>
      </div>
    );
  }

  return (
    <section
      className={styles.provenance}
      aria-label={copy.latestImmutableSnapshot}
    >
      <div className={styles.provenanceHead}>
        <h3 className={styles.provenanceTitle}>
          {copy.latestImmutableSnapshot}
        </h3>
        <span className={styles.metaLabel}>{t("availabilityLabel")}</span>
        <StatusPill tone={availabilityTone(snap.availability)}>
          {tState(snap.availability)}
        </StatusPill>
        {source.state === "stale" ? (
          <StatusPill tone="warning">{tState("stale")}</StatusPill>
        ) : null}
        {snapshotCount === null ? (
          <span className={styles.snapHistory}>
            {t("snapshotHistoryUnavailable")}
          </span>
        ) : snapshotCount > 0 ? (
          <span className={styles.snapHistory}>
            {snapshotHistoryComplete
              ? t("snapshotHistory", { count: snapshotCount })
              : t("snapshotHistoryPartial", { count: snapshotCount })}
          </span>
        ) : null}
      </div>

      <dl className={styles.provenanceGrid}>
        <div className={styles.provenanceItem}>
          <dt>{copy.dataset}</dt>
          <dd data-testid="source-provenance-dynamic">{snap.datasetKey}</dd>
        </div>
        <div className={styles.provenanceItem}>
          <dt>{copy.schema}</dt>
          <dd data-testid="source-provenance-dynamic">{snap.schemaVersion}</dd>
        </div>
        <div className={styles.provenanceItem}>
          <dt>{copy.method}</dt>
          <dd data-testid="source-provenance-dynamic">{snap.methodVersion}</dd>
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
          <dt>{t("rows")}</dt>
          <dd
            className={styles.provenanceRows}
            data-testid="source-provenance-dynamic"
          >
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
    </section>
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
      <Button variant="primary" onClick={start} disabled={busy || runActive}>
        {busy ? t("collecting") : t(sourceCollectLabelKey(sourceState))}
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
}: {
  readonly projectId: string;
  readonly provider: GoogleProvider;
  readonly intent: PropertySelectionPhase;
  readonly onDone: () => void;
}) {
  const t = useTranslations("sources");
  const tCommon = useTranslations("common");
  const connect = useConnectSource(projectId);
  const [selected, setSelected] = useState<string>(
    intent.properties[0]?.id ?? "",
  );
  const [keyEvents, setKeyEvents] = useState<string>("");
  const busy = connect.isPending;
  const selectId = `${provider}-property`;

  const confirm = () => {
    const events =
      provider === "ga4"
        ? Array.from(
            new Set(
              keyEvents
                .split(",")
                .map((value) => value.trim())
                .filter((value) => value.length > 0),
            ),
          ).slice(0, 20)
        : [];
    const request =
      events.length > 0
        ? {
            phase: "select_property" as const,
            oauthIntentId: intent.oauthIntentId,
            externalPropertyId: selected,
            keyEventNames: events,
          }
        : {
            phase: "select_property" as const,
            oauthIntentId: intent.oauthIntentId,
            externalPropertyId: selected,
          };
    connect.mutate(
      { provider, request },
      {
        onSuccess: (data) => {
          if (data.phase === "connected") onDone();
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
      {provider === "ga4" ? (
        <Field label={t("keyEvents")} help={t("keyEventsHelp")}>
          <TextInput
            value={keyEvents}
            onChange={(event) => setKeyEvents(event.target.value)}
            placeholder={t("keyEventsPlaceholder")}
          />
        </Field>
      ) : null}
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
        <Button variant="primary" onClick={authorize} disabled={busy}>
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
      <Button variant="primary" onClick={start} disabled={busy || runActive}>
        {busy ? t("collecting") : t(sourceCollectLabelKey(source.state))}
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
  );
}

// ----------------------------------------------------------- Disabled + disconnect --

function DisabledControls() {
  const t = useTranslations("sources");
  return <p className={styles.disabledNote}>{t("notAvailable")}</p>;
}

function DataForSeoControls({
  source,
  projectId,
  onStarted,
  runActive,
}: {
  readonly source: SourceConnection;
  readonly projectId: string;
  readonly onStarted: (runId: string) => void;
  readonly runActive: boolean;
}) {
  const t = useTranslations("sources");
  const mutation = useCreateCollectionRun(projectId);
  const start = () => {
    mutation.mutate(
      {
        provider: "dataforseo",
        ...(source.id === null ? {} : { sourceConnectionId: source.id }),
      },
      { onSuccess: (data) => onStarted(data.run.id) },
    );
  };

  return (
    <div className={styles.dataForSeoControls}>
      <p className={styles.dataForSeoScope}>{t("dataForSeoScope")}</p>
      <div className={styles.controls}>
        <Button
          variant="primary"
          onClick={start}
          disabled={mutation.isPending || runActive}
        >
          {mutation.isPending
            ? t("collecting")
            : source.latestSnapshot === null
              ? t("collectDataForSeo")
              : t("recollectDataForSeo")}
        </Button>
      </div>
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
      return source.featureEnabled ? (
        <DataForSeoControls
          source={source}
          projectId={projectId}
          onStarted={onStarted}
          runActive={runActive}
        />
      ) : (
        <DisabledControls />
      );
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

  return (
    <Panel padding="lg" className={styles.card} aria-labelledby={titleId}>
      <div className={styles.cardHead}>
        <span className={styles.sourceLogo} aria-hidden="true">
          <ProviderIcon size={20} strokeWidth={1.8} />
        </span>
        <div className={styles.cardHeadText}>
          <h2 id={titleId} className={styles.cardTitle}>
            {providerLabel}
          </h2>
          <p className={styles.cardDesc}>
            {t(`description.${source.provider}`)}
          </p>
        </div>
        <div className={styles.cardStatuses}>
          <StatusPill
            tone={
              acquisitionMode === "live"
                ? "info"
                : acquisitionMode === "manual"
                  ? "warning"
                  : "neutral"
            }
          >
            {copy.mode[acquisitionMode]}
          </StatusPill>
          <StatusPill tone={stateTone(source.state)}>
            {tState(source.state)}
          </StatusPill>
        </div>
      </div>

      <Freshness
        source={source}
        snapshotCount={snapshotCount}
        snapshotHistoryComplete={snapshotHistoryComplete}
      />

      <p className={styles.limitation}>
        <span className={styles.metaLabel}>{t("limitationLabel")}</span>
        <span>{sourceLimitationForDisplay(source)}</span>
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

      <div className={styles.cardFooter}>
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
  const readiness = deriveSourcesReadiness(sources);
  const sourceByProvider = new Map(
    sources.map((source) => [source.provider, source] as const),
  );
  const hasGaps =
    readiness.gapProviders.length > 0 ||
    readiness.missingProviders.length > 0;
  const hasUsableSnapshots = readiness.usableCount > 0;
  const overallLabel = !hasUsableSnapshots
    ? copy.readinessUnavailable
    : hasGaps
      ? copy.readinessPartial
      : copy.readinessComplete;
  const overallTone: StatusTone = !hasUsableSnapshots
    ? "danger"
    : hasGaps
      ? "warning"
      : "success";
  const historyValue =
    snapshotCount === null
      ? "—"
      : snapshotHistoryComplete
        ? String(snapshotCount)
        : `≥ ${snapshotCount}`;

  return (
    <Panel
      padding="lg"
      className={styles.readiness}
      aria-labelledby="source-readiness-title"
    >
      <div className={styles.readinessHead}>
        <div className={styles.readinessLead}>
          <span className="sf-eyebrow">{copy.readinessEyebrow}</span>
          <h2 id="source-readiness-title" className={styles.readinessTitle}>
            {copy.readinessTitle}
          </h2>
          <p className={styles.readinessDescription}>
            {copy.readinessDescription}
          </p>
        </div>
        <StatusPill tone={overallTone}>{overallLabel}</StatusPill>
      </div>

      <dl className={styles.readinessMetrics}>
        <div className={styles.readinessMetric}>
          <dt>{copy.families}</dt>
          <dd data-testid="source-readiness-dynamic">
            {readiness.familyCount} / {readiness.expectedFamilyCount}
          </dd>
        </div>
        <div className={styles.readinessMetric}>
          <dt>{copy.connected}</dt>
          <dd data-testid="source-readiness-dynamic">
            {readiness.connectedCount}
          </dd>
        </div>
        <div className={styles.readinessMetric}>
          <dt>{copy.usable}</dt>
          <dd data-testid="source-readiness-dynamic">{readiness.usableCount}</dd>
        </div>
        <div className={styles.readinessMetric}>
          <dt>{copy.partial}</dt>
          <dd data-testid="source-readiness-dynamic">
            {readiness.partialCount}
          </dd>
        </div>
        <div className={styles.readinessMetric}>
          <dt>{copy.unavailable}</dt>
          <dd data-testid="source-readiness-dynamic">
            {readiness.unavailableCount}
          </dd>
        </div>
        <div className={styles.readinessMetric}>
          <dt>{copy.immutableSnapshots}</dt>
          <dd data-testid="source-readiness-dynamic">{historyValue}</dd>
          {snapshotCount === null ? <small>{copy.historyUnavailable}</small> : null}
        </div>
      </dl>

      {hasGaps ? (
        <aside
          className={styles.gapCallout}
          role="note"
          aria-label={copy.coverageGap}
        >
          <div className={styles.gapCopy}>
            <strong>{copy.coverageGap}</strong>
            <p>
              {!hasUsableSnapshots
                ? copy.noUsableSnapshots
                : copy.coverageGapDescription}
            </p>
          </div>
          <ul className={styles.gapList}>
            {readiness.gapProviders.map((provider) => {
              const availability =
                sourceByProvider.get(provider)?.latestSnapshot?.availability;
              return (
                <li key={provider}>
                  <span>{tProvider(provider)}</span>
                  <StatusPill
                    tone={availability === "partial" ? "warning" : "neutral"}
                  >
                    {availability === "partial"
                      ? copy.partialSnapshot
                      : copy.noUsableSnapshot}
                  </StatusPill>
                </li>
              );
            })}
            {readiness.missingProviders.map((provider) => (
              <li key={`missing-${provider}`}>
                <span>{tProvider(provider)}</span>
                <StatusPill tone="danger">{copy.missingFamily}</StatusPill>
              </li>
            ))}
          </ul>
        </aside>
      ) : (
        <p className={styles.coverageComplete}>{copy.coverageComplete}</p>
      )}
    </Panel>
  );
}

function SnapshotPolicyFootline({
  snapshotCount,
  snapshotHistoryComplete,
}: {
  readonly snapshotCount: number | null;
  readonly snapshotHistoryComplete: boolean;
}) {
  const locale = useLocale();
  const copy = sourcesPresentationCopy(locale);
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
    >
      <Database size={18} strokeWidth={1.8} aria-hidden="true" />
      <div className={styles.footlineCopy}>
        <p>
          <strong data-testid="source-provenance-dynamic">{countLabel}</strong>
          <span>{copy.immutablePolicy}</span>
        </p>
        <p>{copy.credentialsPolicy}</p>
      </div>
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
  const queryClient = useQueryClient();

  const sources = useProjectSources(projectId);
  const snapshots = useProjectSnapshots(projectId);
  const connect = useConnectSource(projectId);

  const [intent, setIntent] = useState<PropertySelectionPhase | null>(null);
  const [topAlert, setTopAlert] = useState<string | null>(null);
  const handledCallback = useRef(false);

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
    const strip = () =>
      window.history.replaceState(null, "", window.location.pathname);

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

  const refetchSources = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["sources", projectId] });
    void queryClient.invalidateQueries({ queryKey: ["snapshots", projectId] });
  }, [queryClient, projectId]);

  const loadedSnapshots = useMemo(
    () => uniqueCursorItems(snapshots.data),
    [snapshots.data],
  );
  const snapshotCounts = useMemo(() => {
    const counts = new Map<Provider, number>();
    for (const snapshot of loadedSnapshots) {
      counts.set(snapshot.provider, (counts.get(snapshot.provider) ?? 0) + 1);
    }
    return counts;
  }, [loadedSnapshots]);
  const snapshotHistoryAvailable = snapshots.data !== undefined;
  const snapshotHistoryCount = snapshotHistoryAvailable
    ? loadedSnapshots.length
    : null;
  const snapshotHistoryComplete =
    snapshotHistoryAvailable &&
    !snapshots.hasNextPage &&
    !snapshots.isError &&
    !snapshots.isFetchNextPageError;
  const snapshotHistoryLoadError =
    snapshots.isError || snapshots.isFetchNextPageError;

  const ordered = useMemo(() => {
    const list = sources.data ?? [];
    return SOURCE_PROVIDER_ORDER.map((provider) =>
      list.find((source) => source.provider === provider),
    ).filter((source): source is SourceConnection => source !== undefined);
  }, [sources.data]);

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

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroText}>
          <span className="sf-eyebrow">{t("title")}</span>
          <h1 className={styles.title}>{t("title")}</h1>
          <p className={styles.subtitle}>{t("subtitle")}</p>
        </div>
      </header>

      <ReadinessSummary
        sources={sources.data}
        snapshotCount={snapshotHistoryCount}
        snapshotHistoryComplete={snapshotHistoryComplete}
      />

      {topAlert !== null ? (
        <p className={styles.alert} role="alert">
          {topAlert}
        </p>
      ) : null}

      <div className={styles.cards}>
        {ordered.map((source) => (
          <SourceCard
            key={source.provider}
            source={source}
            projectId={projectId}
            snapshotCount={
              snapshotHistoryAvailable
                ? (snapshotCounts.get(source.provider) ?? 0)
                : null
            }
            snapshotHistoryComplete={snapshotHistoryComplete}
            onRefetch={refetchSources}
            intent={intent?.provider === source.provider ? intent : null}
            onClearIntent={() => setIntent(null)}
          />
        ))}
      </div>

      {snapshots.isLoading ||
      snapshotHistoryLoadError ||
      snapshots.hasNextPage ? (
        <div className={styles.pagination} aria-live="polite">
          {snapshots.isLoading ? (
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
          {!snapshots.isLoading &&
          (snapshots.hasNextPage || snapshotHistoryLoadError) ? (
            <Button
              variant="secondary"
              onClick={() => {
                if (snapshots.isFetchNextPageError) {
                  void snapshots.fetchNextPage();
                } else if (snapshotHistoryLoadError) {
                  void snapshots.refetch();
                } else {
                  void snapshots.fetchNextPage();
                }
              }}
              disabled={snapshots.isFetchingNextPage || snapshots.isFetching}
            >
              {snapshots.isFetchingNextPage || snapshots.isFetching
                ? tCommon("loadingMore")
                : snapshotHistoryLoadError
                  ? tCommon("retry")
                  : t("loadMoreHistory")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <SnapshotPolicyFootline
        snapshotCount={snapshotHistoryCount}
        snapshotHistoryComplete={snapshotHistoryComplete}
      />
    </div>
  );
}
