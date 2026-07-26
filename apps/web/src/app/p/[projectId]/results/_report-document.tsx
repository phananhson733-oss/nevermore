"use client";

/**
 * Pure client-report rendering (spec §4.2, §10.4): header + report date,
 * evidence coverage/limitations, confirmed findings' client-readable summaries
 * + key evidence, the 30/60/90 plan (actions by lane), READY artifact
 * summaries, and an honest methodology/limitations footer that promises no
 * ranking or revenue outcome. This module renders a `Report` it is given and
 * owns no query state (R3 blueprint D2): `_report-section.tsx` owns the report
 * query and mounts this document next to the export rail. All model/artifact
 * text renders as TEXT — React escapes by default, no raw HTML injection.
 */

import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  ArrowRight,
  FileCheck2,
  Languages,
  MapPin,
  Route,
  ScanSearch,
  Target,
} from "lucide-react";
import {
  Badge,
  EmptyState,
  Panel,
  StatusPill,
  cx,
  type BadgeTone,
  type StatusTone,
} from "@/components/ui";
import type { Coverage } from "@/lib/api";
import type {
  Action,
  Artifact,
  EvidenceGrade,
  Finding,
  PriorityBand,
  Report,
  Severity,
} from "@/lib/api/hooks-report";
import {
  evidenceForFinding,
  reportFooterLimitations,
  uniqueStrings,
} from "../_view-model.ts";
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

// ------------------------------------------------------------- Header --------

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
        <p className={styles.reportDate} data-testid="report-dynamic-value">
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
          <strong>
            {t("evidenceFrameValue", { count: report.findings.length })}
          </strong>
        </article>
        <article className={styles.decisionCard}>
          <span>{t("programShape")}</span>
          <strong>
            {t("programShapeValue", { count: report.actions.length })}
          </strong>
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
        <StatusPill tone={overall.tone}>{tCoverage(overall.labelKey)}</StatusPill>
      </div>
      <p className={styles.panelNote}>{t("dataCoverageNote")}</p>
      <ul className={styles.domainList} data-report-coverage-grid="">
        {DOMAIN_KEYS.map((key) => {
          const meta = domainMeta(coverage.domains[key]);
          return (
            <li key={key} className={styles.domainRow}>
              <span className={styles.domainName}>{tDomain(key)}</span>
              <StatusPill tone={meta.tone}>{tCoverage(meta.labelKey)}</StatusPill>
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
    <article className={styles.findingCard} data-report-finding-id={finding.id}>
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
            <span>{String(ROADMAP_LANES.indexOf(lane) + 1).padStart(2, "0")}</span>
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
              <span className={styles.laneTitle}>{tLane(action.roadmapLane)}</span>
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
        <p key={`${index}:${text.slice(0, 24)}`} className={styles.methodologyText}>
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
      <p className={styles.noPromise} role="note" data-report-decision-close="">
        {t("noPromise")}
      </p>
    </Panel>
  );
}

// ----------------------------------------------------------- Document --------

/**
 * The client-facing report document: cover header, at-a-glance strip, and the
 * numbered sections. Renders inside `[data-report-document]`, which the print
 * stylesheet keeps while the shell chrome and the Results screen chrome hide.
 */
export function ReportDocument({ report }: { readonly report: Report }) {
  const t = useTranslations("report");
  const isEmpty =
    report.findings.length === 0 &&
    report.actions.length === 0 &&
    report.artifacts.length === 0;
  const readyDeliverables = report.artifacts.filter(
    (artifact) => artifact.status === "ready",
  ).length;

  return (
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
              <span className={styles.summaryLabel}>{t("summaryFindings")}</span>
            </span>
          </div>
          <div className={styles.summaryCard}>
            <span className={cx(styles.summaryIcon, styles.summaryIconAmber)}>
              <Route aria-hidden="true" size={19} />
            </span>
            <span className={styles.summaryBody}>
              <span className={styles.summaryMetric}>
                {report.actions.length}
              </span>
              <span className={styles.summaryLabel}>{t("summaryActions")}</span>
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
      <div className={styles.documentSections} data-report-document-sections="">
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
  );
}
