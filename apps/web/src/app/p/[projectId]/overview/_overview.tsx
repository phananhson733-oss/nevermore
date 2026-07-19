"use client";

/**
 * Overview client view (spec §4.2): stage, evidence coverage, and the honest
 * "next step" for a project. TanStack Query owns the server state (never copied
 * into a hand-rolled store, spec §3.2). For a fresh project every metric is
 * genuinely empty — cards show `noData` / `missing`, never a fabricated number
 * (unavailable != 0, spec §1.3). Diagnosis and report are real project screens,
 * so the hero actions are navigable even while their content is not populated.
 */

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Panel,
  Spinner,
  StatusPill,
  cx,
  type CardTone,
  type StatusTone,
} from "@/components/ui";
import { useWorkspaceView } from "@/lib/api";
import type { Coverage, OverviewView, Project } from "@/lib/api";
import styles from "./overview.module.css";

/** The five diagnosis domains, in the spec's canonical order (spec §4.2). */
const DOMAIN_KEYS = [
  "technical_seo",
  "search_performance",
  "content_intent",
  "conversion_journey",
  "geo_ai",
] as const;

/** `coverage.*` message key (label text is never conveyed by color alone). */
type CoverageLabelKey = "ready" | "degraded" | "partial" | "missing";

interface CoverageMeta {
  readonly tone: StatusTone;
  readonly labelKey: CoverageLabelKey;
}

/** Domain-level status → pill tone + label. Unknown/undefined → neutral missing. */
function domainStatusMeta(status: string | undefined): CoverageMeta {
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
function coverageOverallMeta(overall: Coverage["overall"]): CoverageMeta {
  switch (overall) {
    case "complete":
      return { tone: "success", labelKey: "ready" };
    case "partial":
      return { tone: "warning", labelKey: "partial" };
    default:
      return { tone: "neutral", labelKey: "missing" };
  }
}

/** Context status → pill tone (missing neutral, draft warning, complete success). */
function contextTone(status: Project["contextStatus"]): StatusTone {
  switch (status) {
    case "complete":
      return "success";
    case "draft":
      return "warning";
    default:
      return "neutral";
  }
}

interface MetricItem {
  readonly key: string;
  readonly tone: CardTone;
  readonly label: string;
  readonly value: string;
  readonly empty: boolean;
}

/** Tone → corner-accent modifier class for a metric card. */
const METRIC_TONE_CLASS: Record<string, string | undefined> = {
  cobalt: styles.metricCobalt,
  mint: styles.metricMint,
  amber: styles.metricAmber,
  coral: styles.metricCoral,
};

function HeroSection({ project }: { readonly project: Project }) {
  const t = useTranslations("overview");
  const tNav = useTranslations("nav");
  const tShell = useTranslations("appShell");
  const tStage = useTranslations("projectStage");
  const tContextStatus = useTranslations("contextStatus");
  return (
    <header className={styles.hero}>
      <div className={styles.heroText}>
        <span className="sf-eyebrow">{project.clientName}</span>
        <h1 className={styles.heroTitle}>{project.projectName}</h1>
        <p className={styles.host}>{project.site.host}</p>
        <p className={styles.subtitle}>{t("subtitle")}</p>
        <div className={styles.metaRow}>
          <span className={styles.metaItem}>
            <span className={styles.metaLabel}>{tShell("projectStage")}</span>
            <Badge>{tStage(project.stage)}</Badge>
          </span>
          <span className={styles.metaItem}>
            <span className={styles.metaLabel}>{tNav("context")}</span>
            <StatusPill tone={contextTone(project.contextStatus)}>
              {tContextStatus(project.contextStatus)}
            </StatusPill>
          </span>
        </div>
      </div>
      <div className={styles.heroActions}>
        <div className={styles.heroButtons}>
          <Link
            href={`/p/${project.id}/report`}
            className={cx(styles.heroLink, styles.heroLinkSecondary)}
          >
            {t("previewReport")}
          </Link>
          <Link
            href={`/p/${project.id}/diagnosis`}
            className={cx(styles.heroLink, styles.heroLinkPrimary)}
          >
            {t("reviewDiagnosis")}
          </Link>
        </div>
      </div>
    </header>
  );
}

function NextStepBanner({
  projectId,
  contextStatus,
}: {
  readonly projectId: string;
  readonly contextStatus: Project["contextStatus"];
}) {
  const t = useTranslations("overview");
  const tNav = useTranslations("nav");
  const tContextStatus = useTranslations("contextStatus");
  return (
    <Panel tone="cobalt" padding="lg" className={styles.nextStep}>
      <div className={styles.nextStepText}>
        <span className="sf-eyebrow">{tNav("context")}</span>
        <StatusPill tone={contextTone(contextStatus)}>
          {tContextStatus(contextStatus)}
        </StatusPill>
      </div>
      <Link
        href={`/p/${projectId}/context`}
        className={styles.cta}
        aria-label={`${t("nextStep")} — ${tNav("context")}`}
      >
        <span>{t("nextStep")}</span>
        <span aria-hidden="true">→</span>
      </Link>
    </Panel>
  );
}

function MetricStrip({
  project,
  coverage,
  roadmapCount,
}: {
  readonly project: Project;
  readonly coverage: Coverage;
  readonly roadmapCount: number;
}) {
  const t = useTranslations("overview");
  const tCoverage = useTranslations("coverage");
  const overall = coverageOverallMeta(coverage.overall);
  const metrics: readonly MetricItem[] = [
    {
      key: "coverage",
      tone: "cobalt",
      label: t("metrics.coverage"),
      value: tCoverage(overall.labelKey),
      empty: coverage.overall === "unavailable",
    },
    {
      key: "freshness",
      tone: "mint",
      label: t("metrics.freshness"),
      value: t("noData"),
      empty: true,
    },
    {
      key: "roadmap",
      tone: "amber",
      label: t("metrics.roadmap"),
      value: roadmapCount > 0 ? String(roadmapCount) : t("noData"),
      empty: roadmapCount === 0,
    },
    {
      key: "delivery",
      tone: "coral",
      label: t("metrics.delivery"),
      value: project.defaultDeliveryLocale.toUpperCase(),
      empty: false,
    },
  ];
  return (
    <dl className={styles.metrics}>
      {metrics.map((metric) => (
        <Card
          key={metric.key}
          tone={metric.tone}
          padding="md"
          className={cx(styles.metric, METRIC_TONE_CLASS[metric.tone])}
        >
          <dt className={styles.metricLabel}>{metric.label}</dt>
          <dd
            className={cx(
              styles.metricValue,
              metric.empty && styles.metricValueEmpty,
            )}
          >
            {metric.value}
          </dd>
        </Card>
      ))}
    </dl>
  );
}

function CoveragePanel({ coverage }: { readonly coverage: Coverage }) {
  const t = useTranslations("overview");
  const tCoverage = useTranslations("coverage");
  const tDomain = useTranslations("domain");
  const overall = coverageOverallMeta(coverage.overall);
  return (
    <Panel
      className={styles.panel}
      padding="lg"
      aria-labelledby="sf-coverage-title"
    >
      <div className={styles.panelHead}>
        <h2 id="sf-coverage-title" className={styles.panelTitle}>
          {t("metrics.coverage")}
        </h2>
        <StatusPill tone={overall.tone}>
          {tCoverage(overall.labelKey)}
        </StatusPill>
      </div>
      <ul className={styles.domainList}>
        {DOMAIN_KEYS.map((key) => {
          const meta = domainStatusMeta(coverage.domains[key]);
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
          <ul className={styles.limitationList}>
            {coverage.limitations.map((text, index) => (
              <li key={`${index}:${text}`} className={styles.limitationItem}>
                {text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

function OverviewContent({
  projectId,
  view,
}: {
  readonly projectId: string;
  readonly view: OverviewView;
}) {
  return (
    <div className={styles.page}>
      <HeroSection project={view.project} />
      {view.project.contextStatus !== "complete" ? (
        <NextStepBanner
          projectId={projectId}
          contextStatus={view.project.contextStatus}
        />
      ) : null}
      <MetricStrip
        project={view.project}
        coverage={view.coverage}
        roadmapCount={view.topActions.length}
      />
      <CoveragePanel coverage={view.coverage} />
    </div>
  );
}

/**
 * Overview entry: owns the `overview` workspace query and renders the loading /
 * error / ready states. The project shell layout provides the chrome; this
 * renders content only.
 */
export function OverviewClient({ projectId }: { readonly projectId: string }) {
  const tCommon = useTranslations("common");
  const query = useWorkspaceView(projectId, "overview");

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

  return <OverviewContent projectId={projectId} view={query.data} />;
}
