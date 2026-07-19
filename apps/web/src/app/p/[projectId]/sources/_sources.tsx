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
import {
  Button,
  EmptyState,
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
import { sourceLimitationForDisplay } from "../_view-model.ts";
import styles from "./sources.module.css";

/** The five providers in the spec's canonical card order (spec §4.2). */
const PROVIDER_ORDER: readonly Provider[] = [
  "crawl",
  "gsc",
  "ga4",
  "csv",
  "dataforseo",
];

/** Per-provider glyph for the card logo (visual language from the Artifact). */
const PROVIDER_ICON: Record<Provider, LucideIcon> = {
  crawl: Globe2,
  gsc: Search,
  ga4: BarChart3,
  csv: FileUp,
  dataforseo: Database,
};

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
}: {
  readonly source: SourceConnection;
  readonly snapshotCount: number;
}) {
  const t = useTranslations("sources");
  const tState = useTranslations("sourceState");
  const locale = useLocale();
  const snap = source.latestSnapshot;

  if (!snap) {
    return <p className={styles.freshEmpty}>{t("noSnapshot")}</p>;
  }

  return (
    <div className={styles.freshBlock}>
      <div className={styles.metricBig}>
        <span className={styles.metaLabel}>{t("rows")}</span>
        <strong className={styles.metricValue}>
          {new Intl.NumberFormat(locale).format(snap.rowCount)}
        </strong>
      </div>
      <div className={styles.freshRow}>
        <div className={styles.freshItem}>
          <span className={styles.metaLabel}>{t("lastCollected")}</span>
          <span className={styles.freshValue}>
            {formatDateTime(snap.capturedAt, locale)}
          </span>
        </div>
        <div className={styles.freshItem}>
          <span className={styles.metaLabel}>{t("availabilityLabel")}</span>
          <StatusPill tone={availabilityTone(snap.availability)}>
            {tState(snap.availability)}
          </StatusPill>
        </div>
        {source.state === "stale" ? (
          <StatusPill tone="warning">{tState("stale")}</StatusPill>
        ) : null}
        {snapshotCount > 0 ? (
          <span className={styles.snapHistory}>
            {t("snapshotHistory", { count: snapshotCount })}
          </span>
        ) : null}
      </div>
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
      <Button variant="primary" onClick={start} disabled={busy || runActive}>
        {busy ? t("collecting") : t(sourceCollectLabelKey(sourceState))}
      </Button>
      {mutation.error !== null ? (
        <span className={styles.controlError} role="alert">
          {mutation.error.message}
        </span>
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
        <span className={styles.controlError} role="alert">
          {connect.error.message}
        </span>
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
          <span className={styles.controlError} role="alert">
            {connect.error.message}
          </span>
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
        <span className={styles.controlError} role="alert">
          {collect.error.message}
        </span>
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
        <p className={styles.alert} role="alert">
          {importer.preview.error.message}
        </p>
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
            <span className={styles.controlError} role="alert">
              {importer.confirm.error.message}
            </span>
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
    default:
      return <DisabledControls />;
  }
}

// ---------------------------------------------------------------------- Card --

function SourceCard({
  source,
  projectId,
  snapshotCount,
  onRefetch,
  intent,
  onClearIntent,
}: {
  readonly source: SourceConnection;
  readonly projectId: string;
  readonly snapshotCount: number;
  readonly onRefetch: () => void;
  readonly intent: PropertySelectionPhase | null;
  readonly onClearIntent: () => void;
}) {
  const t = useTranslations("sources");
  const tCommon = useTranslations("common");
  const tProvider = useTranslations("provider");
  const tState = useTranslations("sourceState");
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
      source.connectionType === "file_import") &&
    source.state !== "disconnected";
  const ProviderIcon = PROVIDER_ICON[source.provider];

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
        <StatusPill tone={stateTone(source.state)}>
          {tState(source.state)}
        </StatusPill>
      </div>

      <Freshness source={source} snapshotCount={snapshotCount} />

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

  const snapshotCounts = useMemo(() => {
    const counts = new Map<Provider, number>();
    for (const snapshot of snapshots.data?.data ?? []) {
      counts.set(snapshot.provider, (counts.get(snapshot.provider) ?? 0) + 1);
    }
    return counts;
  }, [snapshots.data]);

  const ordered = useMemo(() => {
    const list = sources.data ?? [];
    return PROVIDER_ORDER.map((provider) =>
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
        <EmptyState
          title={tCommon("error")}
          description={sources.error?.message}
        >
          <Button
            variant="secondary"
            onClick={() => {
              void sources.refetch();
            }}
          >
            {tCommon("retry")}
          </Button>
        </EmptyState>
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
            snapshotCount={snapshotCounts.get(source.provider) ?? 0}
            onRefetch={refetchSources}
            intent={intent?.provider === source.provider ? intent : null}
            onClearIntent={() => setIntent(null)}
          />
        ))}
      </div>
    </div>
  );
}
