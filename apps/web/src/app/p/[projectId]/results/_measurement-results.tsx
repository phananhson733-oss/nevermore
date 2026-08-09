"use client";

import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Minus,
  MousePointerClick,
  Search,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  EmptyState,
  LimitationHint,
  Panel,
  Spinner,
  StatusPill,
  type StatusTone,
} from "@/components/ui";
import { useRecentMeasurementWindows } from "@/lib/api/hooks-results";
import type {
  MeasurementObservationState,
  MeasurementState,
} from "@sf/contracts";

import {
  measurementWindowView,
  selectMeasurementWindow,
  type MeasurementDimensionView,
  type MeasurementMetricView,
  type MeasurementTrend,
  type MeasurementWindowView,
} from "./_measurement-view-model.ts";
import { GeoCitationEvidence } from "./_geo-citation-evidence";
import { ResultsSummary } from "./_results-summary";
import { TargetKeywordRanks } from "./_target-keyword-ranks";
import styles from "./results.module.css";

const RESULT_TABS = ["summary", "pages", "campaigns"] as const;
type ResultTab = (typeof RESULT_TABS)[number];

const WINDOW_STATE_TONE: Readonly<Record<MeasurementState, StatusTone>> = {
  technical_verified: "success",
  observed: "success",
  insufficient_data: "warning",
  unavailable: "neutral",
  regressed: "danger",
};

const DIMENSION_STATE_TONE: Readonly<
  Record<MeasurementObservationState, StatusTone>
> = {
  observed: "success",
  insufficient_data: "warning",
  unavailable: "neutral",
  regressed: "danger",
};

function urlLabel(value: string): string {
  try {
    const url = new URL(value);
    return url.pathname === "/" ? url.hostname : url.pathname;
  } catch {
    return value;
  }
}

function trendIcon(trend: MeasurementTrend) {
  if (trend === "improved")
    return <TrendingUp aria-hidden="true" size={16} />;
  if (trend === "regressed")
    return <TrendingDown aria-hidden="true" size={16} />;
  return <Minus aria-hidden="true" size={16} />;
}

function MetricDelta({ metric }: { readonly metric: MeasurementMetricView }) {
  const t = useTranslations("results.measurement");
  if (metric.delta === null) {
    return <span className={styles.metricUnavailable}>{t("notAvailable")}</span>;
  }
  return (
    <span className={styles.metricDelta} data-trend={metric.trend}>
      {trendIcon(metric.trend)}
      {metric.delta}
    </span>
  );
}

function ResultKpi({
  label,
  metric,
  testId,
}: {
  readonly label: string;
  readonly metric: MeasurementMetricView;
  readonly testId?: string;
}) {
  const t = useTranslations("results.measurement");
  return (
    <div className={styles.resultKpi} data-testid={testId}>
      <dt>{label}</dt>
      <dd>
        <strong>{metric.outcome ?? t("notAvailable")}</strong>
        <span>
          {metric.baseline ?? t("notAvailable")}
          <ArrowRight aria-hidden="true" size={14} />
          {metric.outcome ?? t("notAvailable")}
        </span>
        <MetricDelta metric={metric} />
      </dd>
    </div>
  );
}

function ResultKpis({
  measurement,
}: {
  readonly measurement: MeasurementWindowView;
}) {
  const t = useTranslations("results.measurement.kpi");
  return (
    <section
      className={styles.resultKpiSection}
      aria-label={t("label")}
      data-results-kpi-strip=""
    >
      <header>
        <span>{t("eyebrow")}</span>
        <p>{t("scope", { url: urlLabel(measurement.canonicalUrl) })}</p>
      </header>
      <dl className={styles.resultKpis} data-results-kpis="">
        <ResultKpi
          label={t("organicClicks")}
          metric={measurement.summary.organicClicks}
          testId="result-kpi-organic-clicks"
        />
        <ResultKpi
          label={t("directConversions")}
          metric={measurement.summary.directConversions}
          testId="result-kpi-direct-conversions"
        />
        <ResultKpi
          label={t("aiCitations")}
          metric={measurement.summary.aiCitations}
          testId="result-kpi-ai-citations"
        />
        <ResultKpi
          label={t("utmDirectConversions")}
          metric={measurement.summary.utmDirectConversions}
          testId="result-kpi-utm-direct-conversions"
        />
      </dl>
    </section>
  );
}

function MetricTable({
  title,
  description,
  icon,
  dimension,
}: {
  readonly title: string;
  readonly description: string;
  readonly icon: ReactNode;
  readonly dimension: MeasurementDimensionView;
}) {
  const t = useTranslations("results.measurement");
  const tCommon = useTranslations("common");
  const sample =
    dimension.sampleBaseline === null && dimension.sampleOutcome === null
      ? t("sampleUnavailable")
      : t("sampleComparison", {
          baseline: dimension.sampleBaseline ?? t("notAvailable"),
          outcome: dimension.sampleOutcome ?? t("notAvailable"),
        });

  return (
    <section className={styles.metricSection}>
      <header className={styles.metricSectionHeader}>
        <span className={styles.metricSectionIcon}>{icon}</span>
        <div>
          <div className={styles.metricSectionTitle}>
            <h3>{title}</h3>
            <StatusPill tone={DIMENSION_STATE_TONE[dimension.state]}>
              {t(`observationState.${dimension.state}`)}
            </StatusPill>
          </div>
          <p>{description}</p>
        </div>
      </header>
      <div className={styles.metricTableScroll}>
        <table className={styles.metricTable}>
          <thead>
            <tr>
              <th scope="col">{t("table.metric")}</th>
              <th scope="col">{t("table.before")}</th>
              <th scope="col">{t("table.after")}</th>
              <th scope="col">{t("table.change")}</th>
            </tr>
          </thead>
          <tbody>
            {dimension.metrics.map((metric) => (
              <tr key={metric.key}>
                <th scope="row">{t(`metric.${metric.key}`)}</th>
                <td>{metric.baseline ?? t("notAvailable")}</td>
                <td>{metric.outcome ?? t("notAvailable")}</td>
                <td>
                  <MetricDelta metric={metric} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.metricMeta}>
        <span>{sample}</span>
        <span>{t(`sampleCoverage.${dimension.sampleCoverage}`)}</span>
      </div>
      {dimension.limitation ? (
        <div className={styles.inlineLimitation}>
          <LimitationHint
            label={tCommon("limitations")}
            limitations={[dimension.limitation]}
          />
        </div>
      ) : null}
    </section>
  );
}

function CampaignMetric({
  metric,
}: {
  readonly metric: MeasurementMetricView;
}) {
  const t = useTranslations("results.measurement");
  return (
    <span className={styles.campaignMetric}>
      <span>
        {metric.baseline ?? t("notAvailable")}
        <ArrowRight aria-hidden="true" size={14} />
        {metric.outcome ?? t("notAvailable")}
      </span>
      <MetricDelta metric={metric} />
    </span>
  );
}

function CampaignAudit({
  measurement,
}: {
  readonly measurement: MeasurementWindowView;
}) {
  const t = useTranslations("results.measurement");
  return (
    <section className={styles.campaignSection}>
      <header>
        <div>
          <span className={styles.measurementEyebrow}>UTM / GA4</span>
          <h3>{t("campaign.title")}</h3>
        </div>
        <span>{t("campaign.count", { count: measurement.campaigns.length })}</span>
      </header>
      <p className={styles.campaignLead}>{t("campaign.lead")}</p>
      <dl className={styles.campaignSummary}>
        <ResultKpi
          label={t("campaign.summary.sessions")}
          metric={measurement.summary.utmSessions}
        />
        <ResultKpi
          label={t("campaign.summary.directConversions")}
          metric={measurement.summary.utmDirectConversions}
        />
        <ResultKpi
          label={t("campaign.summary.assistedConversions")}
          metric={measurement.summary.utmAssistedConversions}
        />
      </dl>
      {measurement.campaigns.length === 0 ? (
        <div className={styles.campaignEmpty}>
          <CircleAlert aria-hidden="true" size={18} />
          <span>{t("campaign.empty")}</span>
        </div>
      ) : (
        <div className={styles.campaignTableScroll}>
          <table className={styles.campaignTable}>
            <thead>
              <tr>
                <th scope="col">{t("campaign.identity")}</th>
                <th scope="col">{t("metric.ga4Sessions")}</th>
                <th scope="col">{t("metric.ga4DirectConversions")}</th>
                <th scope="col">{t("metric.ga4AssistedConversions")}</th>
              </tr>
            </thead>
            <tbody>
              {measurement.campaigns.map((campaign) => (
                <tr key={campaign.id}>
                  <th scope="row">
                    <strong>{campaign.campaign}</strong>
                    <span>
                      {campaign.source} / {campaign.medium}
                    </span>
                    <code>utm_content={campaign.content}</code>
                  </th>
                  <td>
                    <CampaignMetric metric={campaign.sessions} />
                  </td>
                  <td>
                    <CampaignMetric metric={campaign.directConversions} />
                  </td>
                  <td>
                    <CampaignMetric metric={campaign.assistedConversions} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MeasurementDetail({
  projectId,
  measurement,
}: {
  readonly projectId: string;
  readonly measurement: MeasurementWindowView;
}) {
  const t = useTranslations("results.measurement");
  const tCommon = useTranslations("common");
  return (
    <article className={styles.measurementDetail}>
      <header className={styles.measurementDetailHeader}>
        <div>
          <span className={styles.measurementEyebrow}>{t("detailEyebrow")}</span>
          <h2>{urlLabel(measurement.canonicalUrl)}</h2>
          <a
            href={measurement.canonicalUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            {measurement.canonicalUrl}
            <ExternalLink aria-hidden="true" size={15} />
          </a>
        </div>
        <StatusPill tone={WINDOW_STATE_TONE[measurement.state]}>
          {t(`windowState.${measurement.state}`)}
        </StatusPill>
      </header>

      <dl className={styles.windowEvidence}>
        <div>
          <dt>{t("beforeWindow")}</dt>
          <dd>{measurement.baselineWindow}</dd>
        </div>
        <div>
          <dt>{t("afterWindow")}</dt>
          <dd>{measurement.outcomeWindow}</dd>
        </div>
        <div>
          <dt>{t("changeVerifiedAt")}</dt>
          <dd>{measurement.changedAt}</dd>
        </div>
        <div>
          <dt>{t("recordedAt")}</dt>
          <dd>{measurement.recordedAt}</dd>
        </div>
      </dl>

      <div className={styles.receiptStrip}>
        <CheckCircle2 aria-hidden="true" size={19} />
        <div>
          <strong>
            {t("receiptVerified", {
              provider: t(
                `deliveryProvider.${measurement.deliveryProvider}`,
              ),
            })}
          </strong>
          <span>{t("receiptStartsClock")}</span>
        </div>
        {measurement.deliveryUrl ? (
          <a
            href={measurement.deliveryUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            {t("openReceipt")}
            <ExternalLink aria-hidden="true" size={15} />
          </a>
        ) : null}
      </div>

      <div className={styles.metricGrid}>
        <MetricTable
          title={t("gscTitle")}
          description={t("gscDescription")}
          icon={<Search aria-hidden="true" size={20} />}
          dimension={measurement.gsc}
        />
        <MetricTable
          title={t("ga4Title")}
          description={t("ga4Description")}
          icon={<BarChart3 aria-hidden="true" size={20} />}
          dimension={measurement.ga4}
        />
      </div>

      <TargetKeywordRanks
        projectId={projectId}
        measurementWindowId={measurement.id}
      />

      <GeoCitationEvidence
        projectId={projectId}
        measurementWindowId={measurement.id}
        dimension={measurement.geo}
      />

      <footer className={styles.measurementFoot}>
        <div>
          <MousePointerClick aria-hidden="true" size={18} />
          <p>{t("nonCausal")}</p>
        </div>
        {measurement.technicalVerificationRef ? (
          <div>
            <CheckCircle2 aria-hidden="true" size={18} />
            <p>
              {t("technicalVerification")}
              <code>{measurement.technicalVerificationRef}</code>
            </p>
          </div>
        ) : null}
        {measurement.limitations.length > 0 ? (
          <LimitationHint
            label={tCommon("limitations")}
            limitations={measurement.limitations}
          />
        ) : null}
      </footer>
    </article>
  );
}

function ResultTabs({
  projectId,
  measurement,
  renderMeasurementFallback,
}: {
  readonly projectId: string;
  readonly measurement: MeasurementWindowView | null;
  readonly renderMeasurementFallback: () => ReactNode;
}) {
  const t = useTranslations("results.measurement.tabs");
  const tMeasurement = useTranslations("results.measurement");
  const [activeTab, setActiveTab] = useState<ResultTab>("summary");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectTab = (index: number) => {
    const tab = RESULT_TABS[index];
    if (!tab) return;
    setActiveTab(tab);
    tabRefs.current[index]?.focus();
  };

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % RESULT_TABS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + RESULT_TABS.length) % RESULT_TABS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = RESULT_TABS.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    selectTab(nextIndex);
  };

  return (
    <div className={styles.resultsTabsWorkspace}>
      <div
        className={styles.resultsTabs}
        role="tablist"
        aria-label={t("label")}
        data-results-tabs=""
      >
        {RESULT_TABS.map((tab, index) => {
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              id={`tab-results-${tab}`}
              type="button"
              role="tab"
              aria-controls={`panel-results-${tab}`}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              data-results-tab={tab}
              onClick={() => setActiveTab(tab)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              {t(tab)}
            </button>
          );
        })}
      </div>

      <section
        id="panel-results-summary"
        className={styles.resultsTabPanel}
        role="tabpanel"
        aria-labelledby="tab-results-summary"
        hidden={activeTab !== "summary"}
        data-results-panel="summary"
      >
        <ResultsSummary
          projectId={projectId}
          measurement={measurement}
          renderMeasurementFallback={renderMeasurementFallback}
        />
      </section>
      <section
        id="panel-results-pages"
        className={styles.resultsTabPanel}
        role="tabpanel"
        aria-labelledby="tab-results-pages"
        hidden={activeTab !== "pages"}
        data-results-panel="pages"
      >
        {measurement ? (
          <MeasurementDetail projectId={projectId} measurement={measurement} />
        ) : (
          renderMeasurementFallback()
        )}
      </section>
      <section
        id="panel-results-campaigns"
        className={styles.resultsTabPanel}
        role="tabpanel"
        aria-labelledby="tab-results-campaigns"
        hidden={activeTab !== "campaigns"}
        data-results-panel="campaigns"
      >
        {measurement ? (
          <div className={styles.campaignWorkspace}>
            <header>
              <span className={styles.measurementEyebrow}>
                {tMeasurement("detailEyebrow")}
              </span>
              <strong>{urlLabel(measurement.canonicalUrl)}</strong>
            </header>
            <CampaignAudit measurement={measurement} />
          </div>
        ) : (
          renderMeasurementFallback()
        )}
      </section>
    </div>
  );
}

export function MeasurementResultsSection({
  projectId,
}: {
  readonly projectId: string;
}) {
  const t = useTranslations("results.measurement");
  const locale = useLocale();
  const query = useRecentMeasurementWindows(projectId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const windows = query.data?.windows ?? [];
  const selected = selectMeasurementWindow(windows, selectedId);
  const selectedView = selected
    ? measurementWindowView(selected, locale)
    : null;
  const renderMeasurementFallback = () => {
    if (query.isPending) {
      return (
        <div className={styles.measurementState} role="status">
          <Spinner label={t("loading")} size="md" />
          <span>{t("loading")}</span>
        </div>
      );
    }
    if (query.isError) {
      return (
        <div className={styles.measurementState} role="alert">
          <CircleAlert aria-hidden="true" size={22} />
          <div>
            <strong>{t("errorTitle")}</strong>
            <p>{t("errorBody")}</p>
          </div>
          <button type="button" onClick={() => void query.refetch()}>
            {t("retry")}
          </button>
        </div>
      );
    }
    return <EmptyState title={t("emptyTitle")} description={t("emptyBody")} />;
  };

  return (
    <Panel
      aria-label={t("title")}
      className={`${styles.measurementPanel} ${styles.screenOnly}`}
      data-measurement-results-settled={query.isPending ? undefined : ""}
    >
      <div className={styles.measurementWorkspace}>
        {selectedView ? <ResultKpis measurement={selectedView} /> : null}
        {selectedView ? (
          <aside
            className={styles.measurementSelector}
            aria-label={t("selectorLabel")}
          >
            <div className={styles.measurementSelectorHeader}>
              <h3>{t("selectorTitle")}</h3>
              {query.data ? (
                <span className={styles.measurementCount}>
                  {t("recordCount", { count: windows.length })}
                </span>
              ) : null}
            </div>
            <p>{t("selectorLead")}</p>
            <div className={styles.measurementSelectorList}>
              {windows.map((window) => {
                const item = measurementWindowView(window, locale);
                const active =
                  window.measurementWindowId === selectedView.id;
                return (
                  <button
                    key={window.measurementWindowId}
                    type="button"
                    aria-pressed={active}
                    className={styles.measurementSelectorItem}
                    data-active={active ? "" : undefined}
                    onClick={() =>
                      setSelectedId(window.measurementWindowId)
                    }
                  >
                    <span>{urlLabel(item.canonicalUrl)}</span>
                    <strong>{item.canonicalUrl}</strong>
                    <small>
                      {t(`windowState.${item.state}`)} · {item.recordedAt}
                    </small>
                  </button>
                );
              })}
            </div>
          </aside>
        ) : null}
        <ResultTabs
          projectId={projectId}
          measurement={selectedView}
          renderMeasurementFallback={renderMeasurementFallback}
        />
      </div>
    </Panel>
  );
}
