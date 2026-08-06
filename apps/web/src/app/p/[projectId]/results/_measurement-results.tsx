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
import { useState, type ReactNode } from "react";

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
import { TargetKeywordRanks } from "./_target-keyword-ranks";
import styles from "./results.module.css";

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

      <CampaignAudit measurement={measurement} />

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

  return (
    <Panel
      aria-label={t("title")}
      className={`${styles.measurementPanel} ${styles.screenOnly}`}
      data-measurement-results-settled={query.isPending ? undefined : ""}
    >
      <header className={styles.measurementHeader}>
        <div>
          <span className={styles.measurementEyebrow}>{t("eyebrow")}</span>
          <h2>{t("title")}</h2>
          <p>{t("lead")}</p>
        </div>
        {query.data ? (
          <span className={styles.measurementCount}>
            {t("recordCount", { count: windows.length })}
          </span>
        ) : null}
      </header>

      {query.isPending ? (
        <div className={styles.measurementState} role="status">
          <Spinner label={t("loading")} size="md" />
          <span>{t("loading")}</span>
        </div>
      ) : query.isError ? (
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
      ) : selectedView === null ? (
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyBody")}
        />
      ) : (
        <div className={styles.measurementWorkspace}>
          <aside
            className={styles.measurementSelector}
            aria-label={t("selectorLabel")}
          >
            <h3>{t("selectorTitle")}</h3>
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
          <MeasurementDetail
            projectId={projectId}
            measurement={selectedView}
          />
        </div>
      )}
    </Panel>
  );
}
