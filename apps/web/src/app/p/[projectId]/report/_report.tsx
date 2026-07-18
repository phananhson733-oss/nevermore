"use client";

/**
 * Report client view (spec §4.2, §10.4, §10.5): the client-facing projection of a
 * project — header + report date, evidence coverage/limitations, confirmed
 * findings' client-readable summaries + key evidence, the 30/60/90 plan (actions
 * by lane), READY artifact summaries, and an honest methodology/limitations
 * footer that promises no ranking or revenue outcome. TanStack Query owns the
 * server state (spec §3.2); the report is read-only canonical (no UI-side
 * re-ranking, spec §10.4). All model/artifact text renders as TEXT — React
 * escapes by default, no raw HTML injection.
 *
 * `outputLocale` selects the report *content* language independently of the UI
 * locale (product chrome still follows the UI locale). Print uses a `@media
 * print` block in the CSS module; there is deliberately no PDF export (forbidden
 * in the MVP, spec §10.4).
 */

import { useState } from "react";
import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { LOCALES } from "@sf/i18n/config";
import {
  Badge,
  Button,
  EmptyState,
  Panel,
  Spinner,
  StatusPill,
  cx,
  type BadgeTone,
  type StatusTone,
} from "@/components/ui";
import type { Coverage } from "@/lib/api";
import {
  isTerminalRun,
  useCreateExport,
  useProjectExport,
  useProjectReport,
  type Action,
  type Artifact,
  type EvidenceGrade,
  type ExportKind,
  type Finding,
  type PriorityBand,
  type Report,
  type RoadmapLane,
  type Severity,
} from "@/lib/api/hooks-report";
import styles from "./report.module.css";

/** The five diagnosis domains, in the spec's canonical order (spec §4.2). */
const DOMAIN_KEYS = [
  "technical_seo",
  "search_performance",
  "content_intent",
  "conversion_journey",
  "geo_ai",
] as const;

/** 30/60/90 plan lanes in order (spec §10.4). */
const LANE_ORDER: readonly RoadmapLane[] = ["now", "next", "later"];

/** `coverage.*` label key (status is never conveyed by color alone). */
type CoverageLabelKey = "ready" | "degraded" | "partial" | "missing";

interface CoverageMeta {
  readonly tone: StatusTone;
  readonly labelKey: CoverageLabelKey;
}

/** Domain-level coverage status → pill tone + label. Unknown → neutral missing. */
function domainMeta(status: string | undefined): CoverageMeta {
  switch (status) {
    case "complete":
      return { tone: "success", labelKey: "ready" };
    case "partial":
      return { tone: "warning", labelKey: "partial" };
    case "qualitative":
      return { tone: "info", labelKey: "degraded" };
    default:
      return { tone: "neutral", labelKey: "missing" };
  }
}

/** Overall coverage → pill tone + label (unavailable is the honest default). */
function overallMeta(overall: Coverage["overall"]): CoverageMeta {
  switch (overall) {
    case "complete":
      return { tone: "success", labelKey: "ready" };
    case "partial":
      return { tone: "warning", labelKey: "partial" };
    default:
      return { tone: "neutral", labelKey: "missing" };
  }
}

/** Severity / priority band → pill tone (shared 4-level scale). */
function bandTone(band: Severity | PriorityBand): StatusTone {
  switch (band) {
    case "critical":
      return "danger";
    case "high":
      return "warning";
    case "medium":
      return "info";
    default:
      return "neutral";
  }
}

/** Evidence grade → badge tone (A best → C weakest). */
function gradeTone(grade: EvidenceGrade): BadgeTone {
  switch (grade) {
    case "A":
      return "mint";
    case "B":
      return "amber";
    default:
      return "coral";
  }
}

/** Format an ISO timestamp as a locale-aware date (no fabricated precision). */
function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
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

function OutputLocaleSelect({
  value,
  onChange,
}: {
  readonly value: string | undefined;
  readonly onChange: (locale: string) => void;
}) {
  const t = useTranslations("report");
  return (
    <div className={styles.localeField}>
      <span className={styles.localeLabel} id="sf-output-locale-label">
        {t("outputLocale")}
      </span>
      <div
        className={styles.segmented}
        role="group"
        aria-labelledby="sf-output-locale-label"
      >
        {LOCALES.map((locale) => {
          const isActive = locale === value;
          return (
            <button
              key={locale}
              type="button"
              className={cx(styles.segment, isActive && styles.segmentActive)}
              aria-pressed={isActive}
              onClick={() => onChange(locale)}
            >
              {locale === "en" ? "EN" : "中"}
              <span
                className={styles.srOnly}
              >{` ${t(`locale.${locale}`)}`}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- Header --------

function ReportHeader({
  report,
  outputLocale,
  onOutputLocaleChange,
  onPrint,
}: {
  readonly report: Report;
  readonly outputLocale: string | undefined;
  readonly onOutputLocaleChange: (locale: string) => void;
  readonly onPrint: () => void;
}) {
  const t = useTranslations("report");
  const uiLocale = useLocale();
  const { project } = report;
  return (
    <div className={styles.header}>
      <div className={styles.headerText}>
        <span className="sf-eyebrow">{project.clientName}</span>
        <h1 className={styles.title}>{project.projectName}</h1>
        <p className={styles.host}>{project.site.host}</p>
        <p className={styles.subtitle}>{t("subtitle")}</p>
        <p className={styles.reportDate}>
          {t("reportDate")}: {formatDate(report.generatedAt, uiLocale)}
        </p>
      </div>
      <div className={cx(styles.headerActions, styles.noPrint)}>
        <OutputLocaleSelect
          value={outputLocale}
          onChange={onOutputLocaleChange}
        />
        <Button variant="secondary" onClick={onPrint}>
          {t("print")}
        </Button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------- Coverage --------

function CoverageSection({ coverage }: { readonly coverage: Coverage }) {
  const t = useTranslations("report");
  const tCoverage = useTranslations("coverage");
  const tDomain = useTranslations("domain");
  const overall = overallMeta(coverage.overall);
  return (
    <Panel
      className={styles.panel}
      padding="lg"
      aria-labelledby="sf-coverage-title"
    >
      <div className={styles.panelHead}>
        <h2 id="sf-coverage-title" className={styles.panelTitle}>
          {t("dataCoverage")}
        </h2>
        <StatusPill tone={overall.tone}>
          {tCoverage(overall.labelKey)}
        </StatusPill>
      </div>
      <p className={styles.panelNote}>{t("dataCoverageNote")}</p>
      <ul className={styles.domainList}>
        {DOMAIN_KEYS.map((key) => {
          const meta = domainMeta(coverage.domains[key]);
          return (
            <li key={key} className={styles.domainRow}>
              <span className={styles.domainName}>{tDomain(key)}</span>
              <StatusPill tone={meta.tone}>
                {tCoverage(meta.labelKey)}
              </StatusPill>
            </li>
          );
        })}
      </ul>
      {coverage.limitations.length > 0 ? (
        <div className={styles.limitations}>
          <p className={styles.limitationsLabel}>{t("limitations")}</p>
          <ul className={styles.bulletList}>
            {coverage.limitations.map((text, index) => (
              <li key={`${index}:${text}`} className={styles.bulletItem}>
                {text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

// ----------------------------------------------------------- Findings --------

function EvidenceRow({
  claim,
  grade,
  limitation,
}: {
  readonly claim: string;
  readonly grade: EvidenceGrade;
  readonly limitation: string;
}) {
  const t = useTranslations("report");
  return (
    <li className={styles.evidenceRow}>
      <div className={styles.evidenceHead}>
        <Badge tone={gradeTone(grade)}>{t("gradeLabel", { grade })}</Badge>
        <span className={styles.evidenceClaim}>{claim}</span>
      </div>
      {limitation.length > 0 ? (
        <p className={styles.evidenceLimitation}>
          {t("limitation")}: {limitation}
        </p>
      ) : null}
    </li>
  );
}

function FindingCard({ finding }: { readonly finding: Finding }) {
  const t = useTranslations("report");
  const tDomain = useTranslations("domain");
  const scope = finding.subjectRefs[0];
  const keyEvidence = finding.evidence.slice(0, 3);
  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <span className="sf-eyebrow">{tDomain(finding.domain)}</span>
        <StatusPill tone={bandTone(finding.severity)}>
          {t(`severity.${finding.severity}`)}
        </StatusPill>
      </div>
      <p className={styles.cardSummary}>{finding.summary}</p>
      {scope !== undefined ? (
        <p className={styles.scope}>
          {t("scope")}: <span className={styles.mono}>{scope.value}</span>
        </p>
      ) : null}
      {keyEvidence.length > 0 ? (
        <div className={styles.evidence}>
          <p className={styles.evidenceLabel}>{t("keyEvidence")}</p>
          <ul className={styles.evidenceList}>
            {keyEvidence.map((item) => (
              <EvidenceRow
                key={item.id}
                claim={item.claim}
                grade={item.grade}
                limitation={item.limitation}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

function FindingsSection({
  findings,
}: {
  readonly findings: readonly Finding[];
}) {
  const t = useTranslations("report");
  return (
    <Panel
      className={styles.panel}
      padding="lg"
      aria-labelledby="sf-findings-title"
    >
      <div className={styles.panelHead}>
        <h2 id="sf-findings-title" className={styles.panelTitle}>
          {t("findings")}
        </h2>
      </div>
      <p className={styles.panelNote}>{t("findingsNote")}</p>
      <div className={styles.cardList}>
        {findings.map((finding) => (
          <FindingCard key={finding.id} finding={finding} />
        ))}
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------- Plan ----------

function ActionCard({ action }: { readonly action: Action }) {
  const t = useTranslations("report");
  const tPriority = useTranslations("priorityBand");
  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <h4 className={styles.actionTitle}>{action.title}</h4>
        <StatusPill tone={bandTone(action.priorityBand)}>
          {tPriority(action.priorityBand)}
        </StatusPill>
      </div>
      <p className={styles.cardSummary}>{action.description}</p>
      <p className={styles.outcome}>
        <span className={styles.outcomeLabel}>{t("expectedOutcome")}:</span>{" "}
        {action.expectedOutcome}
      </p>
    </article>
  );
}

function PlanLane({
  lane,
  actions,
}: {
  readonly lane: RoadmapLane;
  readonly actions: readonly Action[];
}) {
  const t = useTranslations("report");
  const tLane = useTranslations("lane");
  return (
    <div className={styles.lane}>
      <div className={styles.laneHead}>
        <h3 className={styles.laneTitle}>{tLane(lane)}</h3>
        <span className={styles.laneCaption}>{t(`laneCaption.${lane}`)}</span>
      </div>
      <div className={styles.cardList}>
        {actions.map((action) => (
          <ActionCard key={action.id} action={action} />
        ))}
      </div>
    </div>
  );
}

function PlanSection({ actions }: { readonly actions: readonly Action[] }) {
  const t = useTranslations("report");
  const lanes = LANE_ORDER.map((lane) => ({
    lane,
    items: actions.filter((action) => action.roadmapLane === lane),
  })).filter((group) => group.items.length > 0);
  return (
    <Panel
      className={styles.panel}
      padding="lg"
      aria-labelledby="sf-plan-title"
    >
      <div className={styles.panelHead}>
        <h2 id="sf-plan-title" className={styles.panelTitle}>
          {t("plan")}
        </h2>
      </div>
      <p className={styles.panelNote}>{t("planNote")}</p>
      <div className={styles.lanes}>
        {lanes.map((group) => (
          <PlanLane key={group.lane} lane={group.lane} actions={group.items} />
        ))}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------- Artifacts --------

function ArtifactsSection({
  artifacts,
}: {
  readonly artifacts: readonly Artifact[];
}) {
  const t = useTranslations("report");
  const uiLocale = useLocale();
  const ready = artifacts.filter((artifact) => artifact.status === "ready");
  return (
    <Panel
      className={styles.panel}
      padding="lg"
      aria-labelledby="sf-artifacts-title"
    >
      <div className={styles.panelHead}>
        <h2 id="sf-artifacts-title" className={styles.panelTitle}>
          {t("artifacts")}
        </h2>
      </div>
      <p className={styles.panelNote}>{t("artifactsNote")}</p>
      {ready.length > 0 ? (
        <ul className={styles.artifactList}>
          {ready.map((artifact) => (
            <li key={artifact.id} className={styles.artifactRow}>
              <div className={styles.artifactMeta}>
                <Badge tone="violet">
                  {t(`artifactType.${artifact.artifactType}`)}
                </Badge>
                <span className={styles.artifactRevision}>
                  {t("revision", { n: artifact.currentRevision })}
                </span>
              </div>
              <span className={styles.artifactDate}>
                {formatDate(artifact.updatedAt, uiLocale)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.mutedNote}>{t("artifactsNone")}</p>
      )}
    </Panel>
  );
}

// -------------------------------------------------------- Methodology --------

function MethodologySection({ report }: { readonly report: Report }) {
  const t = useTranslations("report");
  const paragraphs = report.methodology
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  return (
    <Panel
      className={cx(styles.panel, styles.footerPanel)}
      padding="lg"
      aria-labelledby="sf-methodology-title"
    >
      <div className={styles.panelHead}>
        <h2 id="sf-methodology-title" className={styles.panelTitle}>
          {t("methodology")}
        </h2>
      </div>
      {paragraphs.map((text, index) => (
        <p
          key={`${index}:${text.slice(0, 24)}`}
          className={styles.methodologyText}
        >
          {text}
        </p>
      ))}
      {report.limitations.length > 0 ? (
        <div className={styles.limitations}>
          <p className={styles.limitationsLabel}>{t("limitations")}</p>
          <ul className={styles.bulletList}>
            {report.limitations.map((text, index) => (
              <li key={`${index}:${text}`} className={styles.bulletItem}>
                {text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className={styles.noPromise} role="note">
        {t("noPromise")}
      </p>
    </Panel>
  );
}

// ------------------------------------------------------------- Export --------

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
    return <p className={styles.exportError}>{t("exportFailed")}</p>;
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
    return (
      <p className={styles.exportError}>
        {bundle.run.lastError?.summary ?? t("exportFailed")}
      </p>
    );
  }
  return (
    <div className={styles.exportReady}>
      <a
        className={styles.downloadLink}
        href={bundle.downloadUrl}
        download
        rel="noreferrer"
      >
        {t("download", { kind: t(`kind.${bundle.kind}`) })}
      </a>
      {bundle.downloadExpiresAt !== null ? (
        <span className={styles.expiresAt}>
          {t("expiresAt")}: {formatDateTime(bundle.downloadExpiresAt, uiLocale)}
        </span>
      ) : null}
    </div>
  );
}

interface ActiveExport {
  readonly id: string;
  readonly kind: ExportKind;
}

function ExportSection({
  projectId,
  outputLocale,
}: {
  readonly projectId: string;
  readonly outputLocale: string;
}) {
  const t = useTranslations("report");
  const createExport = useCreateExport(projectId);
  const [active, setActive] = useState<ActiveExport | null>(null);

  function start(kind: ExportKind): void {
    createExport.mutate(
      { kind, outputLocale },
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
      className={cx(styles.panel, styles.noPrint)}
      padding="lg"
      aria-labelledby="sf-export-title"
    >
      <div className={styles.panelHead}>
        <h2 id="sf-export-title" className={styles.panelTitle}>
          {t("export")}
        </h2>
      </div>
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
          <p className={styles.exportError}>{t("exportFailed")}</p>
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

// --------------------------------------------------------- Composition -------

function ReportContent({
  projectId,
  report,
  outputLocale,
  onOutputLocaleChange,
}: {
  readonly projectId: string;
  readonly report: Report;
  readonly outputLocale: string | undefined;
  readonly onOutputLocaleChange: (locale: string) => void;
}): ReactNode {
  const t = useTranslations("report");
  const resolvedLocale = outputLocale ?? report.outputLocale;
  const isEmpty =
    report.findings.length === 0 &&
    report.actions.length === 0 &&
    report.artifacts.length === 0;

  return (
    <div className={styles.page}>
      <ReportHeader
        report={report}
        outputLocale={resolvedLocale}
        onOutputLocaleChange={onOutputLocaleChange}
        onPrint={() => window.print()}
      />
      <CoverageSection coverage={report.coverage} />
      {isEmpty ? (
        <Panel className={styles.panel} padding="lg">
          <EmptyState title={t("emptyTitle")} description={t("emptyHint")} />
        </Panel>
      ) : (
        <>
          {report.findings.length > 0 ? (
            <FindingsSection findings={report.findings} />
          ) : null}
          {report.actions.length > 0 ? (
            <PlanSection actions={report.actions} />
          ) : null}
          <ArtifactsSection artifacts={report.artifacts} />
          <ExportSection projectId={projectId} outputLocale={resolvedLocale} />
        </>
      )}
      <MethodologySection report={report} />
    </div>
  );
}

/**
 * Report entry: owns the `report` query (locale-parameterised) and renders the
 * loading / error / ready states. The project shell layout provides the chrome;
 * this renders content only.
 */
export function ReportClient({ projectId }: { readonly projectId: string }) {
  const tCommon = useTranslations("common");
  const [outputLocale, setOutputLocale] = useState<string | undefined>(
    undefined,
  );
  const query = useProjectReport(projectId, outputLocale);

  if (query.isLoading) {
    return (
      <div className={styles.state}>
        <Spinner size="lg" label={tCommon("loading")} />
        <p className={styles.stateText}>{tCommon("loading")}</p>
      </div>
    );
  }

  if (query.error !== null || query.data === undefined) {
    return (
      <div className={styles.state}>
        <EmptyState title={tCommon("error")}>
          <Button
            variant="secondary"
            onClick={() => {
              void query.refetch();
            }}
          >
            {tCommon("retry")}
          </Button>
        </EmptyState>
      </div>
    );
  }

  return (
    <ReportContent
      projectId={projectId}
      report={query.data}
      outputLocale={outputLocale}
      onOutputLocaleChange={setOutputLocale}
    />
  );
}
