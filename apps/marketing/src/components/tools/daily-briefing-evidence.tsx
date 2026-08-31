"use client";

import { useTranslations } from "next-intl";
import type { DailyBriefingWindows, DailyBriefingVerification, DailyBriefingQueryObservation } from "@sf/public-tools";
import { dailyBriefingGscLink, type DailyBriefingMetricScope } from "../../lib/tools/daily-briefing-gsc-link";

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
    <details data-gsc-evidence data-metric-scope={scope} className="mt-2 text-[11px] leading-[1.55] text-text-dark-secondary">
      <summary className="cursor-pointer font-medium text-brand-accent-text">{t(`sourceEvidence.scopes.${scope}`)}</summary>
      {verified ? <p data-api-evidence="verified" className="mt-2 text-brand-accent-text">{t(currentOnlyVerification ? "sourceEvidence.exactVerifiedCurrent" : "sourceEvidence.exactVerified")}</p> : null}
      <p className="mt-2 break-all">{property} · {t("sourceEvidence.web")}</p>
      <p>{t(scope === "query" || scope === "property" ? "sourceEvidence.byProperty" : "sourceEvidence.byPage")}</p>
      {periods.map((period) => (
        <div key={period.id} className="mt-2">
          <p>{t(`sourceEvidence.${period.id}`)} · {period.window === undefined ? t("kpis.unavailable") : `${period.window.startDate} – ${period.window.endDate} (PT)`}</p>
          <p>{period.metrics === null
            ? t(period.id === "previous" ? previousMessage : "sourceEvidence.noRecord")
            : t("sourceEvidence.metrics", {
              clicks: period.metrics.clicks,
              impressions: period.metrics.impressions,
              ctr: period.metrics.impressions > 0 ? `${(period.metrics.clicks / period.metrics.impressions * 100).toFixed(1)}%` : t("kpis.unavailable"),
              position: period.metrics.position === null ? t("kpis.unavailable") : period.metrics.position.toFixed(1),
            })}</p>
          {period.href === null ? null : <a data-gsc-period={period.id} href={period.href} target="_blank" rel="noopener noreferrer" className="inline-flex mt-1 underline underline-offset-4">{t(`sourceEvidence.open${period.id === "current" ? "Current" : "Previous"}`)}</a>}
        </div>
      ))}
      <p className="mt-2">{t("sourceEvidence.websiteNote")}</p>
    </details>
  );
}
