"use client";

/**
 * Overview client view. Every value comes from the canonical workspace read
 * model: snapshots drive freshness, persisted priority bands select the focus
 * Action, its source Finding supplies evidence, and its Artifact supplies the
 * delivery state. Missing links stay explicitly unavailable.
 */

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  Badge,
  Card,
  Panel,
  Spinner,
  StatusPill,
  cx,
  type CardTone,
  type StatusTone,
} from "@/components/ui";
import { useWorkspaceView } from "@/lib/api";
import type {
  Coverage,
  OverviewAction,
  OverviewActionStatus,
  OverviewDeliveryFocus,
  OverviewEvidence,
  OverviewPriorityBand,
  OverviewView,
  Project,
} from "@/lib/api";
import { ProblemState } from "../_problem-display";
import styles from "./overview.module.css";

const DOMAIN_KEYS = [
  "technical_seo",
  "search_performance",
  "content_intent",
  "conversion_journey",
  "geo_ai",
] as const;

type CoverageLabelKey = "ready" | "degraded" | "partial" | "missing";

interface CoverageMeta {
  readonly tone: StatusTone;
  readonly labelKey: CoverageLabelKey;
}

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

const PRIORITY_TONE: Readonly<Record<OverviewPriorityBand, StatusTone>> = {
  critical: "danger",
  high: "warning",
  medium: "info",
  low: "neutral",
};

const ACTION_STATUS_TONE: Readonly<Record<OverviewActionStatus, StatusTone>> = {
  candidate: "neutral",
  planned: "info",
  in_progress: "priority",
  blocked: "danger",
  done: "success",
  dismissed: "neutral",
};

function artifactStatusTone(
  status: OverviewDeliveryFocus["status"],
): StatusTone {
  switch (status) {
    case "ready":
      return "success";
    case "draft":
      return "warning";
    case "failed":
      return "danger";
    case "generating":
      return "info";
    default:
      return "neutral";
  }
}

function formatDate(iso: string, locale: string): string | null {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function latestEvidenceDate(
  evidence: readonly OverviewEvidence[],
): string | null {
  let latest: { readonly time: number; readonly iso: string } | null = null;
  for (const item of evidence) {
    const time = Date.parse(item.observedAt);
    if (Number.isNaN(time)) continue;
    if (latest === null || time > latest.time) latest = { time, iso: item.observedAt };
  }
  return latest?.iso ?? null;
}

function providerLabel(
  provider: string,
  translate: (key: "crawl" | "gsc" | "ga4" | "csv" | "dataforseo") => string,
): string {
  switch (provider) {
    case "crawl":
    case "gsc":
    case "ga4":
    case "csv":
    case "dataforseo":
      return translate(provider);
    default:
      return provider;
  }
}

interface MetricItem {
  readonly key: string;
  readonly tone: CardTone;
  readonly label: string;
  readonly value: string;
  readonly detail?: string | undefined;
  readonly dateTime?: string | undefined;
  readonly empty: boolean;
}

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

function MetricStrip({ view }: { readonly view: OverviewView }) {
  const t = useTranslations("overview");
  const tCoverage = useTranslations("coverage");
  const tActionStatus = useTranslations("actionStatus");
  const tStudio = useTranslations("studio");
  const tProvider = useTranslations("provider");
  const locale = useLocale();
  const overall = coverageOverallMeta(view.coverage.overall);
  const topAction = view.topActions[0] ?? null;
  const captured = view.latestSnapshot
    ? formatDate(view.latestSnapshot.capturedAt, locale)
    : null;
  const snapshotAvailability = view.latestSnapshot
    ? view.latestSnapshot.availability === "available"
      ? t("available")
      : view.latestSnapshot.availability === "partial"
        ? tCoverage("partial")
        : t("unavailable")
    : null;
  const metrics: readonly MetricItem[] = [
    {
      key: "coverage",
      tone: "cobalt",
      label: t("metrics.coverage"),
      value: tCoverage(overall.labelKey),
      empty: view.coverage.overall === "unavailable",
    },
    {
      key: "freshness",
      tone: "mint",
      label: t("metrics.freshness"),
      value: captured ?? t("unavailable"),
      detail: view.latestSnapshot
        ? `${t("snapshotDetail", {
            provider: providerLabel(view.latestSnapshot.provider, tProvider),
          })} · ${snapshotAvailability}`
        : undefined,
      dateTime: captured ? view.latestSnapshot?.capturedAt : undefined,
      empty: captured === null,
    },
    {
      key: "roadmap",
      tone: "amber",
      label: t("metrics.roadmap"),
      value: topAction ? tActionStatus(topAction.status) : t("noData"),
      empty: topAction === null,
    },
    {
      key: "delivery",
      tone: "coral",
      label: t("metrics.delivery"),
      value: view.deliveryFocus
        ? tStudio(`status.${view.deliveryFocus.status}`)
        : t("unavailable"),
      detail: view.deliveryFocus
        ? tStudio(`artifactType.${view.deliveryFocus.artifactType}`)
        : undefined,
      empty: view.deliveryFocus === null,
    },
  ];
  return (
    <dl className={styles.metrics}>
      {metrics.map((metric) => (
        <Card
          key={metric.key}
          tone={metric.tone}
          padding="md"
          role="group"
          aria-label={metric.label}
          className={cx(styles.metric, METRIC_TONE_CLASS[metric.tone])}
        >
          <dt className={styles.metricLabel}>{metric.label}</dt>
          <dd
            className={cx(
              styles.metricValue,
              metric.empty && styles.metricValueEmpty,
            )}
          >
            {metric.dateTime ? (
              <time dateTime={metric.dateTime}>{metric.value}</time>
            ) : (
              metric.value
            )}
          </dd>
          {metric.detail ? (
            <dd className={styles.metricDetail}>{metric.detail}</dd>
          ) : null}
        </Card>
      ))}
    </dl>
  );
}

function SignalRail({ view }: { readonly view: OverviewView }) {
  const t = useTranslations("overview");
  const tCoverage = useTranslations("coverage");
  const tActionStatus = useTranslations("actionStatus");
  const tStudio = useTranslations("studio");
  const overall = coverageOverallMeta(view.coverage.overall);
  const action = view.topActions[0] ?? null;
  const steps = [
    {
      key: "diagnosis",
      label: t("signalRail.diagnosis"),
      tone: overall.tone,
      available: view.coverage.overall !== "unavailable",
      detail:
        view.coverage.overall !== "unavailable"
          ? tCoverage(overall.labelKey)
          : t("signalRail.noDiagnosis"),
    },
    {
      key: "action",
      label: t("signalRail.action"),
      tone: action ? ACTION_STATUS_TONE[action.status] : "neutral",
      available: action !== null,
      detail: action ? tActionStatus(action.status) : t("signalRail.noAction"),
    },
    {
      key: "delivery",
      label: t("signalRail.delivery"),
      tone: view.deliveryFocus
        ? artifactStatusTone(view.deliveryFocus.status)
        : "neutral",
      available: view.deliveryFocus !== null,
      detail: view.deliveryFocus
        ? tStudio(`status.${view.deliveryFocus.status}`)
        : t("signalRail.noDelivery"),
    },
  ] as const;

  return (
    <Panel
      padding="lg"
      className={styles.signalPanel}
      aria-labelledby="sf-signal-rail-title"
    >
      <div className={styles.sectionHead}>
        <div>
          <h2 id="sf-signal-rail-title" className={styles.panelTitle}>
            {t("signalRail.title")}
          </h2>
          <p className={styles.sectionDescription}>
            {t("signalRail.description")}
          </p>
        </div>
      </div>
      <ol className={styles.signalRail}>
        {steps.map((step, index) => (
          <li
            key={step.key}
            className={cx(
              styles.signalStep,
              !step.available && styles.signalStepUnavailable,
            )}
          >
            <span className={styles.signalNumber} aria-hidden="true">
              {index + 1}
            </span>
            <div className={styles.signalCopy}>
              <span className={styles.signalLabel}>{step.label}</span>
              <StatusPill tone={step.tone}>{step.detail}</StatusPill>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function HighestActionPanel({
  projectId,
  action,
  evidenceCount,
}: {
  readonly projectId: string;
  readonly action: OverviewAction | null;
  readonly evidenceCount: number;
}) {
  const t = useTranslations("overview");
  const tActionStatus = useTranslations("actionStatus");
  const tPriority = useTranslations("priorityBand");
  return (
    <Panel
      tone="amber"
      padding="lg"
      className={styles.actionPanel}
      aria-labelledby="sf-highest-action-title"
    >
      <div className={styles.sectionHead}>
        <div>
          <span className="sf-eyebrow">{t("highestAction.eyebrow")}</span>
          <h2 id="sf-highest-action-title" className={styles.panelTitle}>
            {t("highestAction.title")}
          </h2>
          <p className={styles.sectionDescription}>
            {t("highestAction.description")}
          </p>
        </div>
        {action ? (
          <div className={styles.statusCluster}>
            <StatusPill tone={PRIORITY_TONE[action.priorityBand]}>
              {tPriority(action.priorityBand)}
            </StatusPill>
            <StatusPill tone={ACTION_STATUS_TONE[action.status]}>
              {tActionStatus(action.status)}
            </StatusPill>
          </div>
        ) : (
          <StatusPill tone="neutral">{t("unavailable")}</StatusPill>
        )}
      </div>
      {action ? (
        <div className={styles.actionBody}>
          <div className={styles.actionCopy}>
            <h3 className={styles.actionTitle}>{action.title}</h3>
            <p className={styles.actionDescription}>{action.description}</p>
            <div className={styles.outcome}>
              <span className={styles.detailLabel}>
                {t("highestAction.expectedOutcome")}
              </span>
              <p>{action.expectedOutcome}</p>
            </div>
          </div>
          <div className={styles.actionMeta}>
            <p className={styles.evidenceAssociation}>
              {evidenceCount > 0
                ? t("highestAction.evidenceCount", { count: evidenceCount })
                : t("highestAction.noEvidence")}
            </p>
            <Link href={`/p/${projectId}/plan`} className={styles.inlineLink}>
              {t("highestAction.viewPlan")}
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      ) : (
        <p className={styles.unavailableCopy}>{t("highestAction.empty")}</p>
      )}
    </Panel>
  );
}

function EvidenceFocusPanel({
  evidence,
}: {
  readonly evidence: readonly OverviewEvidence[];
}) {
  const t = useTranslations("overview");
  const tProvider = useTranslations("provider");
  const locale = useLocale();
  const providers = [
    ...new Set(evidence.map((item) => item.sourceProvider)),
  ];
  const latestIso = latestEvidenceDate(evidence);
  const observed = latestIso ? formatDate(latestIso, locale) : null;
  return (
    <Panel
      tone="mint"
      padding="lg"
      className={styles.focusPanel}
      aria-labelledby="sf-evidence-focus-title"
    >
      <div className={styles.sectionHead}>
        <div>
          <h2 id="sf-evidence-focus-title" className={styles.panelTitle}>
            {t("evidenceFocus.title")}
          </h2>
          <p className={styles.sectionDescription}>
            {t("evidenceFocus.description")}
          </p>
        </div>
        <StatusPill tone={evidence.length > 0 ? "success" : "neutral"}>
          {evidence.length > 0 ? t("available") : t("unavailable")}
        </StatusPill>
      </div>
      {evidence.length > 0 ? (
        <div className={styles.focusBody}>
          <strong className={styles.focusValue}>
            {t("evidenceFocus.count", { count: evidence.length })}
          </strong>
          {observed && latestIso ? (
            <p className={styles.focusMeta}>
              {t("evidenceFocus.latestObserved", { date: observed })}
            </p>
          ) : null}
          <div className={styles.providerRow}>
            <span className={styles.detailLabel}>
              {t("evidenceFocus.sources")}
            </span>
            <span className={styles.badgeRow}>
              {providers.map((provider) => (
                <Badge key={provider} tone="accent">
                  {providerLabel(provider, tProvider)}
                </Badge>
              ))}
            </span>
          </div>
        </div>
      ) : (
        <p className={styles.unavailableCopy}>{t("evidenceFocus.empty")}</p>
      )}
    </Panel>
  );
}

function DeliveryFocusPanel({
  projectId,
  delivery,
}: {
  readonly projectId: string;
  readonly delivery: OverviewDeliveryFocus | null;
}) {
  const t = useTranslations("overview");
  const tStudio = useTranslations("studio");
  const locale = useLocale();
  const updated = delivery ? formatDate(delivery.updatedAt, locale) : null;
  return (
    <Panel
      tone="coral"
      padding="lg"
      className={styles.focusPanel}
      aria-labelledby="sf-delivery-focus-title"
    >
      <div className={styles.sectionHead}>
        <div>
          <h2 id="sf-delivery-focus-title" className={styles.panelTitle}>
            {t("deliveryFocus.title")}
          </h2>
          <p className={styles.sectionDescription}>
            {t("deliveryFocus.description")}
          </p>
        </div>
        <StatusPill
          tone={delivery ? artifactStatusTone(delivery.status) : "neutral"}
        >
          {delivery
            ? tStudio(`status.${delivery.status}`)
            : t("unavailable")}
        </StatusPill>
      </div>
      {delivery ? (
        <div className={styles.focusBody}>
          <strong className={styles.focusValue}>
            {tStudio(`artifactType.${delivery.artifactType}`)}
          </strong>
          {updated ? (
            <p className={styles.focusMeta}>
              {t("deliveryFocus.updated", { date: updated })}
            </p>
          ) : null}
          <Link href={`/p/${projectId}/studio`} className={styles.inlineLink}>
            {t("deliveryFocus.openStudio")}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      ) : (
        <p className={styles.unavailableCopy}>{t("deliveryFocus.empty")}</p>
      )}
    </Panel>
  );
}

function CoveragePanel({ coverage }: { readonly coverage: Coverage }) {
  const t = useTranslations("overview");
  const tCoverage = useTranslations("coverage");
  const tDomain = useTranslations("domain");
  const overall = coverageOverallMeta(coverage.overall);
  const limitations = [...new Set(coverage.limitations)];
  return (
    <Panel
      className={styles.panel}
      padding="lg"
      aria-labelledby="sf-coverage-title"
    >
      <div className={styles.sectionHead}>
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
      {limitations.length > 0 ? (
        <div className={styles.limitations}>
          <ul className={styles.limitationList}>
            {limitations.map((text, index) => (
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
      <MetricStrip view={view} />
      <SignalRail view={view} />
      <HighestActionPanel
        projectId={projectId}
        action={view.topActions[0] ?? null}
        evidenceCount={view.topActionEvidence.length}
      />
      <div className={styles.focusGrid}>
        <EvidenceFocusPanel evidence={view.topActionEvidence} />
        <DeliveryFocusPanel
          projectId={projectId}
          delivery={view.deliveryFocus}
        />
      </div>
      <CoveragePanel coverage={view.coverage} />
    </div>
  );
}

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
        <ProblemState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  return <OverviewContent projectId={projectId} view={query.data} />;
}
