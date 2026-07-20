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
 * `outputLocale` requests the report methodology/export locale independently of
 * the UI locale. Canonical findings, actions, and artifacts keep their recorded
 * content locale, which this view labels explicitly. Print uses a `@media print`
 * block in the CSS module; there is deliberately no PDF export (forbidden in the
 * MVP, spec §10.4).
 */

import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowRight,
  FileCheck2,
  Globe2,
  Languages,
  MapPin,
  Route,
  ScanSearch,
  Target,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Badge,
  Button,
  EmptyState,
  Panel,
  Spinner,
  StatusPill,
  TextInput,
  cx,
  type BadgeTone,
  type StatusTone,
} from "@/components/ui";
import type { Coverage } from "@/lib/api";
import {
  isTerminalRun,
  normalizeOutputLocale,
  useCreateExport,
  useProjectExport,
  useProjectReport,
  type Action,
  type Artifact,
  type EvidenceGrade,
  type ExportBundle,
  type ExportKind,
  type Finding,
  type PriorityBand,
  type Report,
  type Severity,
} from "@/lib/api/hooks-report";
import {
  evidenceForFinding,
  reportFooterLimitations,
  uniqueStrings,
} from "../_view-model.ts";
import { ProblemNotice, ProblemState } from "../_problem-display";
import { exportErrorMessageKey } from "../_frontend-error-state.ts";
import styles from "./report.module.css";

/** The five diagnosis domains, in the spec's canonical order (spec §4.2). */
const DOMAIN_KEYS = [
  "technical_seo",
  "search_performance",
  "content_intent",
  "conversion_journey",
  "geo_ai",
] as const;

const ROADMAP_LANES = ["now", "next", "later"] as const;

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

function localeSuggestions(
  report: Report | undefined,
  committedLocale: string | undefined,
  draftLocale: string,
): readonly string[] {
  const values = new Set<string>();
  if (report) {
    values.add(report.project.defaultDeliveryLocale);
    for (const code of report.project.site.languageCodes) values.add(code);
  }
  if (committedLocale !== undefined) values.add(committedLocale);
  const draft = normalizeOutputLocale(draftLocale);
  if (draft !== undefined) values.add(draft);
  return [...values];
}

function reportUrlWithLocale(
  pathname: string,
  searchParams: { readonly toString: () => string },
  outputLocale: string | undefined,
): string {
  const next = new URLSearchParams(searchParams.toString());
  if (outputLocale === undefined) next.delete("outputLocale");
  else next.set("outputLocale", outputLocale);
  const query = next.toString();
  return query.length > 0 ? `${pathname}?${query}` : pathname;
}

/**
 * Resolve the locale used by an export click from the current input render.
 * This deliberately does not wait for `router.replace`: browser click ordering
 * fires the input blur before the button click, while the URL transition is
 * asynchronous. A blank draft means "use the project delivery locale"; a
 * non-empty invalid draft keeps the last committed locale.
 */
function exportLocaleForDraft(
  draftLocale: string,
  committedLocale: string,
  defaultDeliveryLocale: string,
): string {
  if (draftLocale.trim().length === 0) return defaultDeliveryLocale;
  return normalizeOutputLocale(draftLocale) ?? committedLocale;
}

function OutputLocaleSelect({
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

// ------------------------------------------------------------- Header --------

function DeliveryHero({ report }: { readonly report: Report }) {
  const t = useTranslations("report");
  return (
    <header
      className={cx(styles.deliveryHero, styles.noPrint)}
      data-report-page-hero=""
    >
      <div className={styles.deliveryHeroText}>
        <span className="sf-eyebrow">
          {t("title")} · {report.project.clientName}
        </span>
        <p className={styles.deliveryTitle} data-report-delivery-title="">
          {t("heroTitle")}
        </p>
        <p className={styles.deliverySubtitle}>{t("subtitle")}</p>
      </div>
      <div className={styles.deliveryIdentity}>
        <Globe2 aria-hidden="true" size={18} />
        <div>
          <span>{t("reportFor")}</span>
          <strong>{report.project.site.host}</strong>
        </div>
      </div>
    </header>
  );
}

function ReportHeader({ report }: { readonly report: Report }) {
  const t = useTranslations("report");
  const uiLocale = useLocale();
  const { project } = report;
  return (
    <header className={styles.header} data-report-cover="">
      <div className={styles.headerText}>
        <span className="sf-eyebrow">{project.clientName}</span>
        <h1 className={styles.title}>{project.projectName}</h1>
        <p className={styles.host}>{project.site.host}</p>
        <p className={styles.subtitle}>{t("subtitle")}</p>
        <p
          className={styles.reportDate}
          data-testid="report-dynamic-value"
        >
          {t("reportDate")}: {formatDate(report.generatedAt, uiLocale)}
        </p>
      </div>
      <div className={styles.coverLocale}>
        <span className={styles.coverLocaleLabel}>{t("outputLocale")}</span>
        <strong>{report.outputLocale}</strong>
      </div>
    </header>
  );
}

function ReportSectionTitle({
  number,
  id,
  children,
}: {
  readonly number: string;
  readonly id: string;
  readonly children: ReactNode;
}) {
  return (
    <div className={styles.sectionTitleGroup}>
      <span
        className={styles.sectionNumber}
        data-report-section-number=""
        aria-hidden="true"
      >
        {number}
      </span>
      <h2 id={id} className={styles.panelTitle}>
        {children}
      </h2>
    </div>
  );
}

// --------------------------------------------------- Executive + context ----

function ExecutiveSummarySection({ report }: { readonly report: Report }) {
  const t = useTranslations("report");
  const readyDeliverables = report.artifacts.filter(
    (artifact) => artifact.status === "ready",
  ).length;
  return (
    <Panel
      className={styles.panel}
      padding="lg"
      aria-labelledby="sf-executive-title"
      data-report-section="executive"
    >
      <div className={styles.panelHead}>
        <ReportSectionTitle number="01" id="sf-executive-title">
          {t("executiveSummary")}
        </ReportSectionTitle>
      </div>
      <p className={styles.panelNote}>{t("executiveSummaryNote")}</p>
      <div className={styles.decisionGrid}>
        <article className={styles.decisionCard}>
          <span>{t("evidenceFrame")}</span>
          <strong>{t("evidenceFrameValue", { count: report.findings.length })}</strong>
        </article>
        <article className={styles.decisionCard}>
          <span>{t("programShape")}</span>
          <strong>{t("programShapeValue", { count: report.actions.length })}</strong>
        </article>
        <article className={styles.decisionCard}>
          <span>{t("deliveryState")}</span>
          <strong>{t("deliveryStateValue", { count: readyDeliverables })}</strong>
        </article>
      </div>
    </Panel>
  );
}

function ClientContextSection({ report }: { readonly report: Report }) {
  const t = useTranslations("report");
  const { project } = report;
  return (
    <Panel
      className={styles.panel}
      padding="lg"
      aria-labelledby="sf-client-context-title"
      data-report-section="context"
    >
      <div className={styles.panelHead}>
        <ReportSectionTitle number="02" id="sf-client-context-title">
          {t("clientContext")}
        </ReportSectionTitle>
      </div>
      <p className={styles.panelNote}>
        {t("clientContextNote", { host: project.site.host })}
      </p>
      <div className={styles.contextGrid}>
        <article className={styles.contextCard}>
          <MapPin aria-hidden="true" size={18} />
          <span>{t("primaryMarkets")}</span>
          <strong>
            {project.site.marketCodes.length > 0
              ? project.site.marketCodes.join(", ")
              : t("notAvailable")}
          </strong>
        </article>
        <article className={styles.contextCard}>
          <Languages aria-hidden="true" size={18} />
          <span>{t("siteLanguages")}</span>
          <strong>
            {project.site.languageCodes.length > 0
              ? project.site.languageCodes.join(", ")
              : t("notAvailable")}
          </strong>
        </article>
        <article className={styles.contextCard}>
          <Target aria-hidden="true" size={18} />
          <span>{t("deliveryLocale")}</span>
          <strong>{project.defaultDeliveryLocale}</strong>
        </article>
      </div>
    </Panel>
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
      data-report-section="coverage"
    >
      <div className={styles.panelHead}>
        <ReportSectionTitle number="03" id="sf-coverage-title">
          {t("dataCoverage")}
        </ReportSectionTitle>
        <StatusPill tone={overall.tone}>
          {tCoverage(overall.labelKey)}
        </StatusPill>
      </div>
      <p className={styles.panelNote}>{t("dataCoverageNote")}</p>
      <ul className={styles.domainList} data-report-coverage-grid="">
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
            {uniqueStrings(coverage.limitations).map((text, index) => (
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
    <li className={styles.evidenceRow} data-report-evidence-row="">
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

function FindingCard({
  finding,
  index,
}: {
  readonly finding: Finding;
  readonly index: number;
}) {
  const t = useTranslations("report");
  const tDomain = useTranslations("domain");
  const scope = finding.subjectRefs[0];
  const keyEvidence = evidenceForFinding(finding.evidence).slice(0, 3);
  return (
    <article
      className={styles.findingCard}
      data-report-finding-id={finding.id}
    >
      <span className={styles.findingOrdinal} aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className={styles.findingBody}>
        <div className={styles.cardHead}>
          <span className="sf-eyebrow">{tDomain(finding.domain)}</span>
          <StatusPill tone={bandTone(finding.severity)}>
            {t(`severity.${finding.severity}`)}
          </StatusPill>
        </div>
        <span className={styles.contentLocale}>
          {t("summaryContentLocale", { locale: finding.summaryLocale })}
        </span>
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
      </div>
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
      data-report-section="findings"
    >
      <div className={styles.panelHead}>
        <ReportSectionTitle number="04" id="sf-findings-title">
          {t("findings")}
        </ReportSectionTitle>
      </div>
      <p className={styles.panelNote}>{t("findingsNote")}</p>
      <div className={styles.cardList} data-report-findings-list="">
        {findings.map((finding, index) => (
          <FindingCard key={finding.id} finding={finding} index={index} />
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
    <article className={styles.actionCard} data-report-action-id={action.id}>
      <div className={styles.cardHead}>
        <h3 className={styles.actionTitle}>{action.title}</h3>
        <StatusPill tone={bandTone(action.priorityBand)}>
          {tPriority(action.priorityBand)}
        </StatusPill>
      </div>
      <span className={styles.contentLocale}>
        {t("actionContentLocale", { locale: action.contentLocale })}
      </span>
      <p className={styles.cardSummary}>{action.description}</p>
      <p className={styles.outcome}>
        <span className={styles.outcomeLabel}>{t("expectedOutcome")}:</span>{" "}
        {action.expectedOutcome}
      </p>
    </article>
  );
}

function PlanSection({ actions }: { readonly actions: readonly Action[] }) {
  const t = useTranslations("report");
  const tLane = useTranslations("lane");
  const activeLanes = ROADMAP_LANES.filter((lane) =>
    actions.some((action) => action.roadmapLane === lane),
  );
  const laneLayout = activeLanes.join("-");
  return (
    <Panel
      className={styles.panel}
      padding="lg"
      aria-labelledby="sf-plan-title"
      data-report-section="plan"
    >
      <div className={styles.panelHead}>
        <ReportSectionTitle number="05" id="sf-plan-title">
          {t("plan")}
        </ReportSectionTitle>
      </div>
      <p className={styles.panelNote}>{t("planNote")}</p>
      <div
        className={styles.roadmapLegend}
        data-report-active-lanes={activeLanes.length}
        aria-hidden="true"
      >
        {activeLanes.map((lane) => (
          <div
            key={lane}
            className={styles.roadmapLegendItem}
            data-report-roadmap-legend-item={lane}
          >
            <span>
              {String(ROADMAP_LANES.indexOf(lane) + 1).padStart(2, "0")}
            </span>
            <strong>{tLane(lane)}</strong>
            <small>{t(`laneCaption.${lane}`)}</small>
          </div>
        ))}
      </div>
      <div
        className={styles.lanes}
        data-report-roadmap=""
        data-report-active-lanes={activeLanes.length}
        data-report-lane-layout={laneLayout}
      >
        {actions.map((action) => (
          <div
            className={styles.lane}
            key={action.id}
            data-report-roadmap-lane={action.roadmapLane}
            role="group"
            aria-label={`${tLane(action.roadmapLane)} · ${t(
              `laneCaption.${action.roadmapLane}`,
            )}`}
          >
            <div className={styles.laneHead}>
              <span className={styles.laneTitle}>
                {tLane(action.roadmapLane)}
              </span>
              <span className={styles.laneCaption}>
                {t(`laneCaption.${action.roadmapLane}`)}
              </span>
            </div>
            <ActionCard action={action} />
          </div>
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
      data-report-section="artifacts"
    >
      <div className={styles.panelHead}>
        <ReportSectionTitle number="06" id="sf-artifacts-title">
          {t("artifacts")}
        </ReportSectionTitle>
      </div>
      <p className={styles.panelNote}>{t("artifactsNote")}</p>
      {ready.length > 0 ? (
        <ul className={styles.artifactList} data-report-output-list="">
          {ready.map((artifact) => (
            <li
              key={artifact.id}
              className={styles.artifactRow}
              data-report-artifact-id={artifact.id}
            >
              <div className={styles.artifactMeta}>
                <Badge tone="violet">
                  {t(`artifactType.${artifact.artifactType}`)}
                </Badge>
                <span className={styles.artifactRevision}>
                  {t("revision", { n: artifact.currentRevision })}
                </span>
                <span className={styles.contentLocale}>
                  {t("artifactContentLocale", {
                    locale: artifact.outputLocale,
                  })}
                </span>
              </div>
              <span
                className={styles.artifactDate}
                data-testid="report-dynamic-value"
              >
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
  const firstWindowActions = report.actions.filter(
    (action) => action.roadmapLane === "now",
  ).length;
  const footerLimitations = reportFooterLimitations(
    report.coverage.limitations,
    report.limitations,
  );
  const paragraphs = report.methodology
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  return (
    <Panel
      className={cx(styles.panel, styles.footerPanel)}
      padding="lg"
      aria-labelledby="sf-methodology-title"
      data-report-section="methodology"
    >
      <div className={styles.panelHead}>
        <ReportSectionTitle number="07" id="sf-methodology-title">
          {t("methodology")}
        </ReportSectionTitle>
      </div>
      {paragraphs.map((text, index) => (
        <p
          key={`${index}:${text.slice(0, 24)}`}
          className={styles.methodologyText}
        >
          {text}
        </p>
      ))}
      {footerLimitations.length > 0 ? (
        <div className={styles.limitations}>
          <p className={styles.limitationsLabel}>{t("limitations")}</p>
          <ul className={styles.bulletList}>
            {footerLimitations.map((text, index) => (
              <li key={`${index}:${text}`} className={styles.bulletItem}>
                {text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className={styles.nextStep}>
        <div className={styles.nextStepHead}>
          <span>{t("nextStep")}</span>
          <ArrowRight aria-hidden="true" size={19} />
        </div>
        <strong>{t("nextStepLead", { count: firstWindowActions })}</strong>
        <p>{t("nextStepBody")}</p>
      </div>
      <p
        className={styles.noPromise}
        role="note"
        data-report-decision-close=""
      >
        {t("noPromise")}
      </p>
    </Panel>
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
          <p className={styles.manifestDescription}>
            {t("manifestDescription")}
          </p>
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
          className={cx(
            styles.manifestFactValue,
            styles.manifestChecksum,
          )}
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
                {MANIFEST_ITEM_KEYS.has(key)
                  ? t(`manifestItems.${key}`)
                  : key}
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
          <span
            className={styles.expiresAt}
            data-testid="report-dynamic-value"
          >
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

function ExportSection({
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

// --------------------------------------------------------- Composition -------

function ReportContent({
  projectId,
  report,
  outputLocale,
  exportOutputLocale,
  outputLocaleSuggestions,
  onOutputLocaleChange,
  onOutputLocaleCommit,
  onOutputLocaleReset,
}: {
  readonly projectId: string;
  readonly report: Report;
  readonly outputLocale: string;
  readonly exportOutputLocale: string;
  readonly outputLocaleSuggestions: readonly string[];
  readonly onOutputLocaleChange: (locale: string) => void;
  readonly onOutputLocaleCommit: () => void;
  readonly onOutputLocaleReset: () => void;
}): ReactNode {
  const t = useTranslations("report");
  const isEmpty =
    report.findings.length === 0 &&
    report.actions.length === 0 &&
    report.artifacts.length === 0;
  const readyDeliverables = report.artifacts.filter(
    (artifact) => artifact.status === "ready",
  ).length;

  return (
    <div className={styles.page} data-report-page="">
      <DeliveryHero report={report} />
      <div className={styles.workspace} data-report-workspace="">
        <article className={styles.document} data-report-document="">
          <ReportHeader report={report} />
          {!isEmpty ? (
            <section
              className={styles.summaryStrip}
              aria-label={t("summaryTitle")}
              data-report-cover-summary=""
            >
              <div className={styles.summaryCard}>
                <span className={styles.summaryIcon}>
                  <ScanSearch aria-hidden="true" size={19} />
                </span>
                <span className={styles.summaryBody}>
                  <span className={styles.summaryMetric}>
                    {report.findings.length}
                  </span>
                  <span className={styles.summaryLabel}>
                    {t("summaryFindings")}
                  </span>
                </span>
              </div>
              <div className={styles.summaryCard}>
                <span
                  className={cx(styles.summaryIcon, styles.summaryIconAmber)}
                >
                  <Route aria-hidden="true" size={19} />
                </span>
                <span className={styles.summaryBody}>
                  <span className={styles.summaryMetric}>
                    {report.actions.length}
                  </span>
                  <span className={styles.summaryLabel}>
                    {t("summaryActions")}
                  </span>
                </span>
              </div>
              <div className={styles.summaryCard}>
                <span className={cx(styles.summaryIcon, styles.summaryIconMint)}>
                  <FileCheck2 aria-hidden="true" size={19} />
                </span>
                <span className={styles.summaryBody}>
                  <span className={styles.summaryMetric}>{readyDeliverables}</span>
                  <span className={styles.summaryLabel}>
                    {t("summaryDeliverables")}
                  </span>
                </span>
              </div>
            </section>
          ) : null}
          <div
            className={styles.documentSections}
            data-report-document-sections=""
          >
            <ExecutiveSummarySection report={report} />
            <ClientContextSection report={report} />
            <CoverageSection coverage={report.coverage} />
            {isEmpty ? (
              <Panel className={styles.emptyPanel} padding="lg">
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
              </>
            )}
            <MethodologySection report={report} />
          </div>
        </article>
        <aside
          className={cx(styles.manifestRail, styles.noPrint)}
          data-report-manifest-rail=""
          aria-label={t("export")}
        >
          <ExportSection
            projectId={projectId}
            exportOutputLocale={exportOutputLocale}
            outputLocale={outputLocale}
            outputLocaleSuggestions={outputLocaleSuggestions}
            onOutputLocaleChange={onOutputLocaleChange}
            onOutputLocaleCommit={onOutputLocaleCommit}
            onOutputLocaleReset={onOutputLocaleReset}
            onPrint={() => window.print()}
          />
        </aside>
      </div>
    </div>
  );
}

/**
 * Report entry: owns the `report` query (locale-parameterised) and renders the
 * loading / error / ready states. The project shell layout provides the chrome;
 * this renders content only.
 */
export function ReportClient({
  projectId,
  initialOutputLocale,
}: {
  readonly projectId: string;
  readonly initialOutputLocale?: string | undefined;
}) {
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialLocale = normalizeOutputLocale(initialOutputLocale);
  const rawSearchLocale = searchParams.get("outputLocale");
  const outputLocale = normalizeOutputLocale(rawSearchLocale) ?? initialLocale;
  const invalidSearchLocale =
    rawSearchLocale !== null && normalizeOutputLocale(rawSearchLocale) === undefined;
  const query = useProjectReport(projectId, outputLocale);
  const [draftLocale, setDraftLocale] = useState<string>(outputLocale ?? "");
  const [draftDirty, setDraftDirty] = useState<boolean>(false);

  useEffect(() => {
    if (!invalidSearchLocale) return;
    router.replace(reportUrlWithLocale(pathname, searchParams, undefined), {
      scroll: false,
    });
  }, [invalidSearchLocale, pathname, router, searchParams]);

  useEffect(() => {
    if (draftDirty) return;
    const canonical = outputLocale ?? query.data?.outputLocale ?? "";
    if (draftLocale !== canonical) setDraftLocale(canonical);
  }, [draftDirty, draftLocale, outputLocale, query.data?.outputLocale]);

  const outputLocaleSuggestions = useMemo(
    () => localeSuggestions(query.data, outputLocale, draftLocale),
    [draftLocale, outputLocale, query.data],
  );

  function replaceOutputLocale(nextLocale: string | undefined): void {
    router.replace(reportUrlWithLocale(pathname, searchParams, nextLocale), {
      scroll: false,
    });
  }

  function commitOutputLocale(): void {
    const trimmedDraft = draftLocale.trim();
    setDraftDirty(false);
    if (trimmedDraft.length === 0) {
      const fallback =
        query.data?.project.defaultDeliveryLocale ??
        query.data?.outputLocale ??
        "";
      setDraftLocale(fallback);
      if (rawSearchLocale !== null || outputLocale !== undefined) {
        replaceOutputLocale(undefined);
      }
      return;
    }

    const nextLocale = normalizeOutputLocale(trimmedDraft);
    if (nextLocale === undefined) {
      const fallback = outputLocale ?? query.data?.outputLocale ?? "";
      setDraftLocale(fallback);
      return;
    }
    setDraftLocale(nextLocale);
    if (nextLocale !== outputLocale) replaceOutputLocale(nextLocale);
  }

  function resetOutputLocale(): void {
    setDraftDirty(false);
    setDraftLocale(outputLocale ?? query.data?.outputLocale ?? "");
  }

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
        <ProblemState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const committedOutputLocale = outputLocale ?? query.data.outputLocale;
  const exportOutputLocale = exportLocaleForDraft(
    draftLocale,
    committedOutputLocale,
    query.data.project.defaultDeliveryLocale,
  );

  return (
    <ReportContent
      projectId={projectId}
      report={query.data}
      outputLocale={draftLocale}
      exportOutputLocale={exportOutputLocale}
      outputLocaleSuggestions={outputLocaleSuggestions}
      onOutputLocaleChange={(locale) => {
        setDraftLocale(locale);
        setDraftDirty(true);
      }}
      onOutputLocaleCommit={commitOutputLocale}
      onOutputLocaleReset={resetOutputLocale}
    />
  );
}
