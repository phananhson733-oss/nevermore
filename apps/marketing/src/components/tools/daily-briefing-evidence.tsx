"use client";

import { useLocale, useTranslations } from "next-intl";
import type { DailyBriefingWindows, DailyBriefingVerification, DailyBriefingQueryObservation } from "@sf/public-tools";
import { dailyBriefingGscLink, type DailyBriefingMetricScope } from "../../lib/tools/daily-briefing-gsc-link";
import { formatPropertyLabel } from "../../lib/tools/property-label";
import styles from "./daily-briefing-evidence.module.css";

interface Metrics {
  readonly clicks: number;
  readonly impressions: number;
  readonly position: number | null;
}

/** A missing row and a missing read are distinct evidence states. */
export function previousEvidenceMessage(state: DailyBriefingQueryObservation["previousEvidence"]): string {
  switch (state) {
    case "not_observed": return "changes.notObserved";
    case "below_floor": return "review.priorBelowFloor";
    case "not_compared": return "sourceEvidence.notCompared";
    case "unavailable":
    case "observed": return "sourceEvidence.previousUnavailable";
  }
}

/** Keeps a displayed measurement attached to its actual filters and dates. */
export function DailyBriefingEvidence({ property, windows, scope, query = null, page = null, current, previous, comparisonEligible, verification, previousEvidence }: {
  readonly property: string;
  readonly windows: DailyBriefingWindows | null;
  readonly scope: DailyBriefingMetricScope;
  readonly query?: string | null;
  readonly page?: string | null;
  readonly current: Metrics | null;
  readonly previous: Metrics | null;
  readonly comparisonEligible: boolean;
  readonly verification: DailyBriefingVerification | null;
  readonly previousEvidence?: DailyBriefingQueryObservation["previousEvidence"];
}) {
  const t = useTranslations("tools.dailyBriefing");
  const locale = useLocale();
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const verified = verification?.items.some((item) =>
    item.status === "verified" && item.metricScope === scope &&
    item.query === (scope === "query" || scope === "query_page" ? query : null) &&
    item.page === (scope === "page" || scope === "query_page" ? page : null),
  ) === true;
  const currentHref = dailyBriefingGscLink({ property, window: windows?.current7Days ?? null, scope, query, page });
  const previousHref = dailyBriefingGscLink({ property, window: windows?.previous7Days ?? null, scope, query, page });
  const previousMeasured = previousEvidence === undefined
    ? comparisonEligible : previousEvidence === "observed";
  const previousMessage = previousEvidence === undefined
    ? comparisonEligible ? "sourceEvidence.noRecord" : "sourceEvidence.notCompared"
    : previousEvidenceMessage(previousEvidence);
  const currentOnlyVerification = previousEvidence === undefined
    ? !comparisonEligible
    : previousEvidence !== "observed" && previousEvidence !== "not_observed";
  const periods = [
    { id: "current", href: currentHref, window: windows?.current7Days, metrics: current },
    { id: "previous", href: previousHref, window: windows?.previous7Days, metrics: previousMeasured ? previous : null },
  ] as const;
  return (
    <details data-gsc-evidence data-metric-scope={scope} className={styles.evidence}>
      <summary className={styles.summary}>{t(`sourceEvidence.scopes.${scope}`)}</summary>
      <div className={styles.body}>
        <div className={styles.context}>
          <span className={styles.site}>{formatPropertyLabel(property)}</span>
          {verified ? <span data-api-evidence="verified" className={styles.verified}>{t(currentOnlyVerification ? "sourceEvidence.exactVerifiedCurrent" : "sourceEvidence.exactVerified")}</span> : null}
        </div>
        <div className={styles.scope}>{t("sourceEvidence.web")}</div>
        <div data-evidence-periods className={styles.periods}>
          {periods.map((period) => (
            <section key={period.id} data-evidence-period={period.id} className={styles.period} aria-label={t(`sourceEvidence.${period.id}`)}>
              <h4 className={styles.periodTitle}>{t(`sourceEvidence.${period.id}`)}</h4>
              <div className={styles.dates}>{period.window === undefined ? t("kpis.unavailable") : <>
                <time dateTime={period.window.startDate}>{period.window.startDate}</time>
                <span> – </span>
                <time dateTime={period.window.endDate}>{period.window.endDate}</time>
              </>}</div>
              {period.metrics === null ? (
                <div data-evidence-unavailable className={styles.unavailable}>{t(period.id === "previous" ? previousMessage : "sourceEvidence.noRecord")}</div>
              ) : (
                <dl className={styles.metrics}>
                  {([
                    ["clicks", number.format(period.metrics.clicks)],
                    ["impressions", number.format(period.metrics.impressions)],
                    ["ctr", period.metrics.impressions > 0 ? `${(period.metrics.clicks / period.metrics.impressions * 100).toFixed(1)}%` : t("kpis.unavailable")],
                    ["position", period.metrics.position === null ? t("kpis.unavailable") : period.metrics.position.toFixed(1)],
                  ] as const).map(([metric, value]) => (
                    <div key={metric} data-evidence-metric={metric} className={styles.metric}>
                      <dt className={styles.label}>{t(`trend.metrics.${metric}`)}</dt>
                      <dd className={styles.value}>{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {period.href === null ? null : <a data-gsc-period={period.id} href={period.href} target="_blank" rel="noopener noreferrer" className={styles.link}>{t(`sourceEvidence.open${period.id === "current" ? "Current" : "Previous"}`)}<span aria-hidden="true">↗</span></a>}
            </section>
          ))}
        </div>
        <div data-evidence-source className={styles.source} title={t("sourceEvidence.websiteNote")}>{t("sourceEvidence.sourceLine")}</div>
      </div>
    </details>
  );
}
