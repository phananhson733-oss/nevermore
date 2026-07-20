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
  Database,
  FileCheck2,
  ListTodo,
  SearchCheck,
  Target,
  type LucideIcon,
} from "lucide-react";
import {
  Badge,
  DarkPanel,
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

function snapshotTone(
  availability: NonNullable<OverviewView["latestSnapshot"]>["availability"],
): StatusTone {
  switch (availability) {
    case "available":
      return "success";
    case "partial":
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
  readonly icon: LucideIcon;
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
    <header className={styles.hero} data-overview-hero="">
      <div className={styles.heroText}>
        <div className={styles.heroKicker}>
          <span className={styles.projectIdentityLine}>
            <span className="sf-eyebrow">{project.projectName}</span>
            <span className={styles.kickerSeparator} aria-hidden="true">
              ·
            </span>
            <span className={styles.host}>{project.site.host}</span>
          </span>
          <span className={styles.metaRow}>
            <span className={styles.metaItem}>
              <span className={styles.metaLabel}>
                {tShell("projectStage")}
              </span>
              <Badge>{tStage(project.stage)}</Badge>
            </span>
            <span className={styles.metaItem}>
              <span className={styles.metaLabel}>{tNav("context")}</span>
              <StatusPill tone={contextTone(project.contextStatus)}>
                {tContextStatus(project.contextStatus)}
              </StatusPill>
            </span>
          </span>
        </div>
        <h1 className={styles.heroTitle}>{t("heroTitle")}</h1>
        <p className={styles.subtitle}>
          {t("subtitle", { client: project.clientName })}
        </p>
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
  const coveredDomainCount = DOMAIN_KEYS.filter(
    (key) => domainStatusMeta(view.coverage.domains[key]).labelKey !== "missing",
  ).length;
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
      icon: SearchCheck,
      label: t("metrics.coverage"),
      value: `${coveredDomainCount} / ${DOMAIN_KEYS.length}`,
      detail: tCoverage(overall.labelKey),
      empty: view.coverage.overall === "unavailable",
    },
    {
      key: "freshness",
      tone: "mint",
      icon: Database,
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
      icon: ListTodo,
      label: t("metrics.roadmap"),
      value: topAction ? tActionStatus(topAction.status) : t("noData"),
      empty: topAction === null,
    },
    {
      key: "delivery",
      tone: "coral",
      icon: FileCheck2,
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
    <dl className={styles.metrics} data-overview-metrics="">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <div
            key={metric.key}
            data-overview-metric={metric.key}
            className={cx(styles.metric, METRIC_TONE_CLASS[metric.tone])}
          >
            <dt className={styles.metricHead}>
              <span className={styles.metricLabel}>{metric.label}</span>
              <Icon
                className={styles.metricIcon}
                aria-hidden="true"
                size={18}
                strokeWidth={1.7}
              />
            </dt>
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
          </div>
        );
      })}
    </dl>
  );
}

interface SignalStep {
  readonly key: "context" | "sources" | "diagnosis" | "plan" | "delivery";
  readonly href: string;
  readonly label: string;
  readonly detail: string;
  readonly tone: StatusTone;
  readonly available: boolean;
  readonly icon: LucideIcon;
}

function SignalRail({
  projectId,
  view,
}: {
  readonly projectId: string;
  readonly view: OverviewView;
}) {
  const t = useTranslations("overview");
  const tNav = useTranslations("nav");
  const tContextStatus = useTranslations("contextStatus");
  const tCoverage = useTranslations("coverage");
  const tActionStatus = useTranslations("actionStatus");
  const tStudio = useTranslations("studio");
  const overall = coverageOverallMeta(view.coverage.overall);
  const action = view.topActions[0] ?? null;
  const snapshot = view.latestSnapshot;
  const steps: readonly SignalStep[] = [
    {
      key: "context",
      href: `/p/${projectId}/context`,
      label: tNav("context"),
      tone: contextTone(view.project.contextStatus),
      available: view.project.contextStatus === "complete",
      detail: tContextStatus(view.project.contextStatus),
      icon: Target,
    },
    {
      key: "sources",
      href: `/p/${projectId}/sources`,
      label: tNav("sources"),
      tone: snapshot ? snapshotTone(snapshot.availability) : "neutral",
      available: snapshot !== null && snapshot.availability !== "unavailable",
      detail: snapshot
        ? snapshot.availability === "available"
          ? t("available")
          : snapshot.availability === "partial"
            ? tCoverage("partial")
            : t("unavailable")
        : t("unavailable"),
      icon: Database,
    },
    {
      key: "diagnosis",
      href: `/p/${projectId}/diagnosis`,
      label: t("signalRail.diagnosis"),
      tone: overall.tone,
      available: view.coverage.overall !== "unavailable",
      detail:
        view.coverage.overall !== "unavailable"
          ? tCoverage(overall.labelKey)
          : t("signalRail.noDiagnosis"),
      icon: SearchCheck,
    },
    {
      key: "plan",
      href: `/p/${projectId}/plan`,
      label: tNav("plan"),
      tone: action ? ACTION_STATUS_TONE[action.status] : "neutral",
      available: action !== null,
      detail: action ? tActionStatus(action.status) : t("signalRail.noAction"),
      icon: ListTodo,
    },
    {
      key: "delivery",
      href: `/p/${projectId}/studio`,
      label: t("signalRail.delivery"),
      tone: view.deliveryFocus
        ? artifactStatusTone(view.deliveryFocus.status)
        : "neutral",
      available: view.deliveryFocus !== null,
      detail: view.deliveryFocus
        ? tStudio(`status.${view.deliveryFocus.status}`)
        : t("signalRail.noDelivery"),
      icon: FileCheck2,
    },
  ];

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
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <li
              key={step.key}
              className={cx(
                styles.signalStep,
                !step.available && styles.signalStepUnavailable,
              )}
            >
              <Link href={step.href} className={styles.signalLink}>
                <span className={styles.signalNumber} aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className={styles.signalTrack} aria-hidden="true">
                  <span className={styles.signalIcon}>
                    <Icon size={18} strokeWidth={1.8} />
                  </span>
                </span>
                <span className={styles.signalCopy}>
                  <span className={styles.signalLabel}>{step.label}</span>
                  <strong className={styles.signalDetail}>{step.detail}</strong>
                </span>
                <StatusPill tone={step.tone}>{step.detail}</StatusPill>
              </Link>
            </li>
          );
        })}
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
    <DarkPanel
      padding="lg"
      className={styles.actionPanel}
      aria-labelledby="sf-highest-action-title"
    >
      <span className={styles.actionOrbit} aria-hidden="true" />
      <div className={styles.sectionHead}>
        <div>
          <span className={styles.actionEyebrow}>
            {t("highestAction.eyebrow")}
          </span>
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
        <div className={styles.actionEmpty}>
          <p className={styles.unavailableCopy}>{t("highestAction.empty")}</p>
          <Link
            href={`/p/${projectId}/diagnosis`}
            className={styles.inlineLink}
          >
            {t("reviewDiagnosis")}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      )}
    </DarkPanel>
  );
}

function EvidenceFocusPanel({
  projectId,
  evidence,
  coverage,
}: {
  readonly projectId: string;
  readonly evidence: readonly OverviewEvidence[];
  readonly coverage: Coverage;
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
          <div className={styles.focusSummary}>
            <div>
              <strong className={styles.focusValue}>
                {t("evidenceFocus.count", { count: evidence.length })}
              </strong>
              {observed && latestIso ? (
                <p
                  className={styles.focusMeta}
                  data-testid="overview-dynamic-value"
                >
                  {t("evidenceFocus.latestObserved", { date: observed })}
                </p>
              ) : null}
            </div>
            <span className={styles.badgeRow}>
              {providers.map((provider) => (
                <Badge key={provider} tone="accent">
                  {providerLabel(provider, tProvider)}
                </Badge>
              ))}
            </span>
          </div>
          <ul className={styles.evidenceList}>
            {evidence.map((item) => {
              const itemDate = formatDate(item.observedAt, locale);
              return (
                <li key={item.id} className={styles.evidenceItem}>
                  <span
                    className={cx(
                      styles.evidenceMark,
                      item.availability === "available" &&
                        styles.evidenceMarkReady,
                    )}
                    aria-hidden="true"
                  />
                  <div className={styles.evidenceCopy}>
                    <span className={styles.evidenceMeta}>
                      {providerLabel(item.sourceProvider, tProvider)}
                      {itemDate ? (
                        <span data-testid="overview-dynamic-value">
                          {` · ${itemDate}`}
                        </span>
                      ) : null}
                    </span>
                    <strong>{item.claim}</strong>
                    <span>{item.method}</span>
                  </div>
                  <Badge>{item.grade}</Badge>
                </li>
              );
            })}
          </ul>
          <Link
            href={`/p/${projectId}/diagnosis`}
            className={styles.inlineLink}
          >
            {t("reviewDiagnosis")}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      ) : (
        <div className={styles.focusEmpty}>
          <p className={styles.unavailableCopy}>{t("evidenceFocus.empty")}</p>
          <Link
            href={`/p/${projectId}/diagnosis`}
            className={styles.inlineLink}
          >
            {t("reviewDiagnosis")}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      )}
      <CoverageSummary coverage={coverage} />
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
      className={cx(styles.focusPanel, styles.deliveryPanel)}
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
          <div className={styles.deliveryCard}>
            <span className={styles.deliveryMark} aria-hidden="true">
              <FileCheck2 size={19} strokeWidth={1.8} />
            </span>
            <div className={styles.deliveryCopy}>
              <strong className={styles.focusValue}>
                {tStudio(`artifactType.${delivery.artifactType}`)}
              </strong>
              {updated ? (
                <p
                  className={styles.focusMeta}
                  data-testid="overview-dynamic-value"
                >
                  {t("deliveryFocus.updated", { date: updated })}
                </p>
              ) : null}
            </div>
          </div>
          <Link href={`/p/${projectId}/studio`} className={styles.inlineLink}>
            {t("deliveryFocus.openStudio")}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      ) : (
        <div className={styles.focusEmpty}>
          <p className={styles.unavailableCopy}>{t("deliveryFocus.empty")}</p>
          <Link href={`/p/${projectId}/studio`} className={styles.inlineLink}>
            {t("deliveryFocus.openStudio")}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      )}
    </Panel>
  );
}

function CoverageSummary({ coverage }: { readonly coverage: Coverage }) {
  const t = useTranslations("overview");
  const tCoverage = useTranslations("coverage");
  const tDomain = useTranslations("domain");
  const overall = coverageOverallMeta(coverage.overall);
  return (
    <section
      className={styles.coverageSummary}
      aria-labelledby="sf-coverage-title"
    >
      <div className={styles.coverageSummaryHead}>
        <h3 id="sf-coverage-title" className={styles.coverageTitle}>
          {t("metrics.coverage")}
        </h3>
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
    </section>
  );
}

function EvidenceFooter({ view }: { readonly view: OverviewView }) {
  const t = useTranslations("overview");
  const locale = useLocale();
  const snapshot = view.latestSnapshot;
  const windowStart = snapshot?.sourceWindow.start
    ? formatDate(snapshot.sourceWindow.start, locale)
    : null;
  const windowEnd = snapshot?.sourceWindow.end
    ? formatDate(snapshot.sourceWindow.end, locale)
    : null;
  const captured = snapshot ? formatDate(snapshot.capturedAt, locale) : null;
  const limitations = [
    ...view.coverage.limitations,
    ...(snapshot?.limitation ? [snapshot.limitation] : []),
  ].filter((value, index, values) => {
    const normalized = value.trim();
    return normalized.length > 0 && values.indexOf(value) === index;
  });

  return (
    <footer
      className={styles.evidenceFooter}
      data-testid="overview-evidence-footer"
    >
      <div className={styles.footerFact}>
        <span className={styles.footerLabel}>
          {t("footer.analysisWindow")}
        </span>
        <strong className={styles.footerValue}>
          {windowStart || windowEnd ? (
            <>
              {windowStart && snapshot?.sourceWindow.start ? (
                <time dateTime={snapshot.sourceWindow.start}>{windowStart}</time>
              ) : null}
              {windowStart && windowEnd ? (
                <span aria-hidden="true"> — </span>
              ) : null}
              {windowEnd && snapshot?.sourceWindow.end ? (
                <time dateTime={snapshot.sourceWindow.end}>{windowEnd}</time>
              ) : null}
            </>
          ) : (
            t("unavailable")
          )}
        </strong>
      </div>
      <div className={styles.footerFact}>
        <span className={styles.footerLabel}>
          {t("footer.latestSnapshot")}
        </span>
        <strong className={styles.footerValue}>
          {captured && snapshot ? (
            <time dateTime={snapshot.capturedAt}>{captured}</time>
          ) : (
            t("unavailable")
          )}
        </strong>
      </div>
      <div className={cx(styles.footerFact, styles.footerLimitations)}>
        <span className={styles.footerLabel}>{t("footer.limitations")}</span>
        {limitations.length > 0 ? (
          <ul className={styles.footerLimitationList}>
            {limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        ) : (
          <strong className={styles.footerValue}>{t("unavailable")}</strong>
        )}
      </div>
    </footer>
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
      <div className={styles.narrativeGrid} data-overview-primary-grid="">
        <SignalRail projectId={projectId} view={view} />
        <HighestActionPanel
          projectId={projectId}
          action={view.topActions[0] ?? null}
          evidenceCount={view.topActionEvidence.length}
        />
      </div>
      <div className={styles.focusGrid} data-overview-support-grid="">
        <EvidenceFocusPanel
          projectId={projectId}
          evidence={view.topActionEvidence}
          coverage={view.coverage}
        />
        <DeliveryFocusPanel
          projectId={projectId}
          delivery={view.deliveryFocus}
        />
      </div>
      <EvidenceFooter view={view} />
    </div>
  );
}

export function OverviewClient({
  projectId,
  initialView,
}: {
  readonly projectId: string;
  readonly initialView?: OverviewView;
}) {
  const tCommon = useTranslations("common");
  const query = useWorkspaceView(projectId, "overview", initialView);

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
