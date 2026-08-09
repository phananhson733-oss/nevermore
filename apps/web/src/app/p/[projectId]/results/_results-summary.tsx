"use client";

import { CheckCircle2, CircleAlert, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import {
  Badge,
  EmptyState,
  LimitationHint,
  Spinner,
  StatusPill,
  type StatusTone,
} from "@/components/ui";
import { useProjectResults } from "@/lib/api/hooks-results";
import type {
  ActionRecheckResultsResponse,
  ActionRecheckRuleComparison,
  RecheckComparisonState,
} from "@sf/contracts";

import type { MeasurementWindowView } from "./_measurement-view-model.ts";
import styles from "./results.module.css";

const STATE_TONE: Readonly<Record<RecheckComparisonState, StatusTone>> = {
  verified: "success",
  observed: "warning",
  insufficient_data: "neutral",
};

function ObservedWindow({
  results,
}: {
  readonly results: ActionRecheckResultsResponse;
}) {
  const t = useTranslations("results");
  return (
    <dl className={styles.window}>
      <div>
        <dt>{t("priorLabel")}</dt>
        <dd>
          <time
            dateTime={results.priorObservedAt}
            data-testid="results-dynamic-value"
          >
            {results.priorObservedAt}
          </time>
        </dd>
      </div>
      <div>
        <dt>{t("currentLabel")}</dt>
        <dd>
          <time
            dateTime={results.currentObservedAt}
            data-testid="results-dynamic-value"
          >
            {results.currentObservedAt}
          </time>
        </dd>
      </div>
    </dl>
  );
}

function RuleComparisonRow({
  rule,
}: {
  readonly rule: ActionRecheckRuleComparison;
}) {
  const t = useTranslations("results");
  return (
    <li className={styles.rule}>
      <div className={styles.ruleHead}>
        <span className={styles.ruleId}>{rule.ruleId}</span>
        <StatusPill tone={STATE_TONE[rule.state]}>{rule.label}</StatusPill>
      </div>
      <div className={styles.ruleTransition}>
        <Badge>{t(`ruleStatus.${rule.priorStatus}`)}</Badge>
        <span aria-hidden="true">→</span>
        <Badge>{t(`ruleStatus.${rule.currentStatus}`)}</Badge>
      </div>
      <details className={styles.ruleDetail}>
        <summary>{t("detailLabel")}</summary>
        <dl>
          <div>
            <dt>{t("dispositionLabel")}</dt>
            <dd>{t(`disposition.${rule.disposition}`)}</dd>
          </div>
        </dl>
      </details>
    </li>
  );
}

function ResultsComparison({
  results,
}: {
  readonly results: ActionRecheckResultsResponse;
}) {
  const t = useTranslations("results");
  return (
    <div className={styles.comparison}>
      <ObservedWindow results={results} />
      {results.rules.length === 0 ? (
        <EmptyState title={t("noRulesTitle")} description={t("noRulesBody")} />
      ) : (
        <ul className={styles.rules}>
          {results.rules.map((rule) => (
            <RuleComparisonRow key={rule.ruleId} rule={rule} />
          ))}
        </ul>
      )}
      {results.limitations.length > 0 ? (
        <div className={styles.limitations}>
          <LimitationHint
            label={t("limitationsTitle")}
            limitations={results.limitations}
          />
        </div>
      ) : null}
    </div>
  );
}

function TechnicalRecheck({ projectId }: { readonly projectId: string }) {
  const t = useTranslations("results");
  const tSummary = useTranslations("results.measurement.summary");
  const query = useProjectResults(projectId);

  return (
    <section
      className={styles.summarySection}
      aria-label={t("title")}
      data-results-recheck-settled={query.isPending ? undefined : ""}
    >
      <header className={styles.summarySectionHeader}>
        <span>{tSummary("technicalEyebrow")}</span>
        <h2 className={styles.summaryHeading}>{t("title")}</h2>
        <p>{t("lead")}</p>
      </header>
      {query.isPending ? (
        <div className={styles.summaryState} role="status">
          <Spinner />
        </div>
      ) : query.isError ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        <ResultsComparison results={query.data} />
      )}
    </section>
  );
}

function ResultBoundaries() {
  const t = useTranslations("results.measurement.summary");
  const boundaries = ["verified", "observed", "insufficient", "receipt"] as const;

  return (
    <section className={styles.summarySection}>
      <header className={styles.summarySectionHeader}>
        <span>{t("boundaryEyebrow")}</span>
        <h2 className={styles.summaryHeading}>{t("boundaryTitle")}</h2>
      </header>
      <ul className={styles.boundaryList}>
        {boundaries.map((boundary) => (
          <li key={boundary} className={styles.boundaryCard}>
            <strong>{t(`boundary.${boundary}.title`)}</strong>
            <p>{t(`boundary.${boundary}.body`)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ResultsTimeline({
  measurement,
}: {
  readonly measurement: MeasurementWindowView;
}) {
  const t = useTranslations("results.measurement");
  const tSummary = useTranslations("results.measurement.summary");

  return (
    <section className={styles.timelineSection} data-results-timeline="">
      <header className={styles.summarySectionHeader}>
        <span>{tSummary("timelineEyebrow")}</span>
        <h2 className={styles.summaryHeading}>{tSummary("timelineTitle")}</h2>
        <p>{tSummary("timelineLead")}</p>
      </header>
      <div className={styles.timelineGrid}>
        <article className={styles.timelineColumn}>
          <h3>{tSummary("actionTimelineTitle")}</h3>
          <div className={styles.timelineEvent}>
            <CheckCircle2 aria-hidden="true" size={18} />
            <div>
              <strong>
                {t("receiptVerified", {
                  provider: t(
                    `deliveryProvider.${measurement.deliveryProvider}`,
                  ),
                })}
              </strong>
              <span>{measurement.changedAt}</span>
              <p>{tSummary("actionReceiptBody")}</p>
              {measurement.deliveryUrl ? (
                <a
                  href={measurement.deliveryUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {t("openReceipt")}
                  <ExternalLink aria-hidden="true" size={14} />
                </a>
              ) : null}
            </div>
          </div>
        </article>
        <article className={styles.timelineColumn}>
          <h3>{tSummary("resultTimelineTitle")}</h3>
          <div className={styles.timelineEvent}>
            <CircleAlert aria-hidden="true" size={18} />
            <div>
              <strong>{tSummary("windowComparisonTitle")}</strong>
              <span>
                {measurement.baselineWindow} → {measurement.outcomeWindow}
              </span>
              <p>{tSummary("windowComparisonBody")}</p>
            </div>
          </div>
          <div className={styles.timelineEvent}>
            <CheckCircle2 aria-hidden="true" size={18} />
            <div>
              <strong>{tSummary("observationRecordedTitle")}</strong>
              <span>{measurement.recordedAt}</span>
              <p>{tSummary("observationRecordedBody")}</p>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

export function ResultsSummary({
  projectId,
  measurement,
  renderMeasurementFallback,
}: {
  readonly projectId: string;
  readonly measurement: MeasurementWindowView | null;
  readonly renderMeasurementFallback: () => ReactNode;
}) {
  const t = useTranslations("results.measurement.summary");
  return (
    <div className={styles.resultsSummary}>
      <div className={styles.summaryGrid} data-results-summary-overview="">
        <TechnicalRecheck projectId={projectId} />
        <ResultBoundaries />
      </div>
      {measurement ? (
        <ResultsTimeline measurement={measurement} />
      ) : (
        <section className={styles.timelineSection} data-results-timeline="">
          <header className={styles.summarySectionHeader}>
            <span>{t("timelineEyebrow")}</span>
            <h2 className={styles.summaryHeading}>{t("timelineTitle")}</h2>
          </header>
          {renderMeasurementFallback()}
        </section>
      )}
    </div>
  );
}
