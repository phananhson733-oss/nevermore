"use client";

/**
 * Export rail (spec §10.5): the output-locale control, print trigger, and the
 * service/client bundle export flow with its manifest + signed download link.
 * Rendered in the report block's side rail on the Results screen (R3 blueprint
 * D1/D2). There is deliberately no PDF export (forbidden in the MVP, spec
 * §10.4).
 */

import { useState } from "react";
import type { KeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Panel,
  Spinner,
  TextInput,
  cx,
} from "@/components/ui";
import {
  isTerminalRun,
  useCreateExport,
  useProjectExport,
  type ExportBundle,
  type ExportKind,
} from "@/lib/api/hooks-report";
import { ProblemNotice } from "../_problem-display";
import { exportErrorMessageKey } from "../_frontend-error-state.ts";
import styles from "./report.module.css";

const MANIFEST_ITEM_ORDER = [
  "projects",
  "contexts",
  "sources",
  "snapshots",
  "observations",
  "findings",
  "evidence",
  "actions",
  "artifacts",
  "artifactRevisions",
] as const;
const MANIFEST_ITEM_KEYS: ReadonlySet<string> = new Set(MANIFEST_ITEM_ORDER);

function manifestItemEntries(
  itemCounts: Readonly<Record<string, number>>,
): readonly (readonly [string, number])[] {
  const rank = new Map<string, number>(
    MANIFEST_ITEM_ORDER.map((key, index) => [key, index]),
  );
  return Object.entries(itemCounts).sort(([left], [right]) => {
    const leftRank = rank.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rank.get(right) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank || left.localeCompare(right);
  });
}

/** Format an ISO timestamp as a locale-aware date + time. */
function formatDateTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// -------------------------------------------------------- Output locale ------

export function OutputLocaleSelect({
  value,
  suggestions,
  onChange,
  onCommit,
  onReset,
}: {
  readonly value: string;
  readonly suggestions: readonly string[];
  readonly onChange: (locale: string) => void;
  readonly onCommit: () => void;
  readonly onReset: () => void;
}) {
  const t = useTranslations("report");
  const listId = "sf-report-output-locale-options";
  const helpId = "sf-report-output-locale-help";

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      event.preventDefault();
      onCommit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onReset();
    }
  }

  return (
    <div className={styles.localeField}>
      <label className={styles.localeLabel} htmlFor="sf-report-output-locale">
        {t("outputLocale")}
      </label>
      <TextInput
        id="sf-report-output-locale"
        value={value}
        list={suggestions.length > 0 ? listId : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        onKeyDown={onKeyDown}
        aria-describedby={helpId}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      {suggestions.length > 0 ? (
        <datalist id={listId}>
          {suggestions.map((locale) => (
            <option key={locale} value={locale} />
          ))}
        </datalist>
      ) : null}
      <p id={helpId} className={styles.localeHelp}>
        {t("outputLocaleHelp")}
      </p>
    </div>
  );
}

// ------------------------------------------------------------- Export --------

function ExportManifest({
  bundle,
  uiLocale,
}: {
  readonly bundle: ExportBundle;
  readonly uiLocale: string;
}) {
  const t = useTranslations("report");
  const titleId = `sf-export-manifest-${bundle.id}`;
  const isClient = bundle.kind === "client_bundle";

  return (
    <section className={styles.manifest} aria-labelledby={titleId}>
      <div className={styles.manifestHead}>
        <div>
          <h3 id={titleId} className={styles.manifestTitle}>
            {t("manifestTitle")}
          </h3>
          <p className={styles.manifestDescription}>{t("manifestDescription")}</p>
        </div>
        <Badge tone="neutral">{t(`kind.${bundle.kind}`)}</Badge>
      </div>

      <dl className={styles.manifestFacts}>
        <dt className={styles.manifestFactTerm}>{t("schemaVersion")}</dt>
        <dd className={styles.manifestFactValue}>{bundle.schemaVersion}</dd>
        <dt className={styles.manifestFactTerm}>{t("bundleLocale")}</dt>
        <dd className={styles.manifestFactValue}>{bundle.outputLocale}</dd>
        <dt className={styles.manifestFactTerm}>{t("createdAt")}</dt>
        <dd
          className={styles.manifestFactValue}
          data-testid="report-dynamic-value"
        >
          {formatDateTime(bundle.createdAt, uiLocale)}
        </dd>
        <dt className={styles.manifestFactTerm}>{t("checksum")}</dt>
        <dd
          className={cx(styles.manifestFactValue, styles.manifestChecksum)}
          data-testid="report-dynamic-value"
        >
          {bundle.checksum === null ? (
            t("notAvailable")
          ) : (
            <code title={bundle.checksum}>{bundle.checksum}</code>
          )}
        </dd>
      </dl>

      <div className={styles.manifestBoundary}>
        <div>
          <span className={styles.manifestBoundaryLabel}>{t("included")}</span>
          <p>{t(isClient ? "clientIncluded" : "serviceIncluded")}</p>
        </div>
        <div>
          <span className={styles.manifestBoundaryLabel}>{t("excluded")}</span>
          <p>{t(isClient ? "clientExcluded" : "serviceExcluded")}</p>
        </div>
      </div>

      <div>
        <h4 className={styles.manifestItemsTitle}>{t("itemCounts")}</h4>
        <ul className={styles.manifestItems}>
          {manifestItemEntries(bundle.itemCounts).map(([key, count]) => (
            <li key={key}>
              <span>
                {MANIFEST_ITEM_KEYS.has(key) ? t(`manifestItems.${key}`) : key}
              </span>
              <strong data-testid="report-dynamic-value">{count}</strong>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ExportStatus({
  projectId,
  exportId,
}: {
  readonly projectId: string;
  readonly exportId: string;
}) {
  const t = useTranslations("report");
  const tRun = useTranslations("runState");
  const uiLocale = useLocale();
  const query = useProjectExport(projectId, exportId);
  const bundle = query.data;

  if (query.error !== null) {
    return (
      <div className={styles.exportReady} role="alert">
        <ProblemNotice
          className={styles.exportError}
          error={query.error}
          message={t(exportErrorMessageKey(query.error))}
          onRetry={() => void query.refetch()}
          retryLabel={t("retryExportStatus")}
          compact
        />
      </div>
    );
  }
  if (bundle === undefined) {
    return (
      <span className={styles.exportBusy}>
        <Spinner size="sm" label={t("preparing")} />
        <span>{t("preparing")}</span>
      </span>
    );
  }

  const { status } = bundle.run;
  if (!isTerminalRun(status)) {
    return (
      <span className={styles.exportBusy}>
        <Spinner size="sm" label={tRun(status)} />
        <span>{tRun(status)}</span>
      </span>
    );
  }
  if (
    status === "failed" ||
    status === "cancelled" ||
    bundle.downloadUrl === null
  ) {
    return <p className={styles.exportError}>{t("exportFailed")}</p>;
  }
  return (
    <div className={styles.exportReady}>
      <ExportManifest bundle={bundle} uiLocale={uiLocale} />
      <div className={styles.exportDownload}>
        <a
          className={styles.downloadLink}
          href={bundle.downloadUrl}
          download
          rel="noreferrer"
        >
          {t("download", { kind: t(`kind.${bundle.kind}`) })}
        </a>
        {bundle.downloadExpiresAt !== null ? (
          <span className={styles.expiresAt} data-testid="report-dynamic-value">
            {t("expiresAt")}: {formatDateTime(bundle.downloadExpiresAt, uiLocale)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

interface ActiveExport {
  readonly id: string;
  readonly kind: ExportKind;
}

export function ExportSection({
  projectId,
  exportOutputLocale,
  outputLocale,
  outputLocaleSuggestions,
  onOutputLocaleChange,
  onOutputLocaleCommit,
  onOutputLocaleReset,
  onPrint,
}: {
  readonly projectId: string;
  readonly exportOutputLocale: string;
  readonly outputLocale: string;
  readonly outputLocaleSuggestions: readonly string[];
  readonly onOutputLocaleChange: (locale: string) => void;
  readonly onOutputLocaleCommit: () => void;
  readonly onOutputLocaleReset: () => void;
  readonly onPrint: () => void;
}) {
  const t = useTranslations("report");
  const createExport = useCreateExport(projectId);
  const [active, setActive] = useState<ActiveExport | null>(null);

  function start(kind: ExportKind): void {
    setActive(null);
    createExport.mutate(
      { kind, outputLocale: exportOutputLocale },
      {
        onSuccess: (data) => {
          if (data.resourceRef !== null) {
            setActive({ id: data.resourceRef.id, kind });
          }
        },
      },
    );
  }

  return (
    <Panel
      className={cx(styles.panel, styles.exportPanel)}
      padding="lg"
      aria-labelledby="sf-export-title"
    >
      <div className={styles.panelHead}>
        <h2 id="sf-export-title" className={styles.panelTitle}>
          {t("export")}
        </h2>
      </div>
      <div className={styles.deliveryControls} data-report-controls="">
        <OutputLocaleSelect
          value={outputLocale}
          suggestions={outputLocaleSuggestions}
          onChange={onOutputLocaleChange}
          onCommit={onOutputLocaleCommit}
          onReset={onOutputLocaleReset}
        />
        <Button variant="secondary" onClick={onPrint}>
          {t("print")}
        </Button>
      </div>
      <div className={styles.exportDivider} />
      <div className={styles.exportButtons}>
        <Button
          variant="primary"
          onClick={() => start("service_bundle")}
          disabled={createExport.isPending}
        >
          {t("exportServiceBundle")}
        </Button>
        <Button
          variant="secondary"
          onClick={() => start("client_bundle")}
          disabled={createExport.isPending}
        >
          {t("exportClientBundle")}
        </Button>
      </div>
      <p className={styles.clientBundleNote}>{t("clientBundleNote")}</p>
      <div className={styles.exportStatus} aria-live="polite">
        {createExport.isError ? (
          <ProblemNotice
            className={styles.exportError}
            error={createExport.error}
            message={t(exportErrorMessageKey(createExport.error))}
            compact
          />
        ) : null}
        {createExport.isPending && active === null ? (
          <span className={styles.exportBusy}>
            <Spinner size="sm" label={t("preparing")} />
            <span>{t("preparing")}</span>
          </span>
        ) : null}
        {active !== null ? (
          <ExportStatus projectId={projectId} exportId={active.id} />
        ) : null}
      </div>
    </Panel>
  );
}
