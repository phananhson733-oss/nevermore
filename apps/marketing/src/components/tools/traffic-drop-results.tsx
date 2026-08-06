// @input  -- TrafficDropResult, its daily series, and the shared limitation disclosure
// @output -- fixed windows, layered findings, actions, checks, and compact evidence boundaries
// @pos    -- report surface of /[locale]/tools/traffic-drop-diagnosis
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useTranslations } from "next-intl";
import type {
  TrafficAction,
  TrafficCheck,
  TrafficDailyPoint,
  TrafficDropResult,
  TrafficFinding,
  TrafficMeasure,
  TrafficWindow,
} from "@sf/public-tools";
import { TrafficDropChart } from "./traffic-drop-chart";
import { TrafficDropSiteSignals } from "./traffic-drop-site-signals";
import { LimitationHint } from "../ui/limitation-hint";

const TIER_STYLE: Record<TrafficFinding["tier"], string> = {
  observed: "text-brand-series-2 bg-[rgba(79,134,200,0.14)]",
  hypothesis: "text-brand-warning bg-[rgba(212,168,67,0.13)]",
  data_boundary: "text-text-dark-secondary bg-[rgba(155,150,144,0.13)]",
};

const RAIL_STYLE: Record<TrafficFinding["tier"], string> = {
  observed: "bg-brand-error",
  hypothesis: "bg-brand-warning",
  data_boundary: "bg-text-dark-secondary/50",
};

const ACTION_STYLE: Record<TrafficAction["kind"], string> = {
  do: "bg-brand-accent text-white",
  external_data: "text-brand-warning bg-[rgba(212,168,67,0.13)]",
  avoid: "text-text-dark-secondary border border-brand-border",
};

const CHECK_STYLE: Record<TrafficCheck["status"], string> = {
  hit: "text-brand-error",
  clear: "text-brand-success",
  not_available: "text-text-dark-secondary",
};

const WINDOW_RAIL: Record<TrafficWindow["id"], string> = {
  peak: "border-l-brand-success",
  mid: "border-l-brand-warning",
  recent: "border-l-brand-error",
};

interface TrafficDropResultsProps {
  readonly result: TrafficDropResult;
  readonly series: readonly TrafficDailyPoint[];
  readonly locale: string;
}

export function TrafficDropResults({
  result,
  series,
  locale,
}: TrafficDropResultsProps) {
  const t = useTranslations("tools.trafficDrop");
  const numbers = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US");

  /** Ratios render as signed percentages; counts as counts; nulls as "not available". */
  function formatMeasure(measure: TrafficMeasure): string {
    if (measure.value === null) return t("notAvailable");
    if (typeof measure.value === "string") return measure.value;
    if (measure.key.endsWith("_change")) {
      const percent = (measure.value * 100).toFixed(0);
      return measure.value > 0 ? `+${percent}%` : `${percent}%`;
    }
    if (measure.key.endsWith("ctr"))
      return `${(measure.value * 100).toFixed(2)}%`;
    return numbers.format(measure.value);
  }

  function formatCtr(window: TrafficWindow): string {
    return window.ctr === null
      ? t("notAvailable")
      : `${(window.ctr * 100).toFixed(2)}%`;
  }

  return (
    <div className="space-y-4">
      {/*
       * Before the chart, deliberately. A manual action or a security issue is
       * the only thing in this report with a definite answer and a defined
       * path back, and a visitor who has one open should not have to scroll
       * past a change-point analysis to find that out.
       */}
      <TrafficDropSiteSignals signals={result.siteSignals} locale={locale} />

      <section className="rounded-2xl border border-brand-border/70 bg-brand-bg-alt/35 p-5 md:p-6">
        <h2 className="text-[16px] font-semibold text-text-dark-primary">
          {t("chartTitle")}
        </h2>
        <p className="mt-1 mb-4 text-[12.5px] leading-relaxed text-text-dark-secondary">
          {t(`states.${result.changePoint.state}.summary`)}
        </p>

        <TrafficDropChart
          series={series}
          windows={result.changePoint.windows}
          locale={locale}
        />

        {result.changePoint.windows.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {result.changePoint.windows.map((window) => (
              <span
                key={window.id}
                className={`rounded-lg border border-brand-border border-l-[3px] bg-brand-bg px-3 py-1 text-[12px] tabular-nums text-text-dark-secondary ${WINDOW_RAIL[window.id]}`}
              >
                <b className="font-semibold text-text-dark-primary">
                  {t(`windows.${window.id}.label`)} {window.startDate} →{" "}
                  {window.endDate}
                </b>{" "}
                · {numbers.format(window.clicks)} {t("clicks")} ·{" "}
                {numbers.format(window.impressions)} {t("impressions")} · CTR{" "}
                {formatCtr(window)}
              </span>
            ))}
            <p className="mt-1 w-full text-[12px] leading-relaxed text-text-dark-secondary/80">
              {t("windowsFixedExplainer")}
            </p>
          </div>
        ) : null}

        {result.changePoint.limitation ? (
          <LimitationHint
            className="mt-4"
            label={t("limitationLabel")}
            limitations={[t(`limitations.${result.changePoint.limitation}`)]}
          />
        ) : null}
      </section>

      {result.findings.length > 0 ? (
        <section className="rounded-2xl border border-brand-border/70 bg-brand-bg-alt/35 p-5 md:p-6">
          <h2 className="text-[16px] font-semibold text-text-dark-primary">
            {t("findingsTitle", { count: result.findings.length })}
          </h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-text-dark-secondary">
            {t("findingsIntro")}
          </p>

          <div className="mt-3">
            {result.findings.map((finding) => (
              <article
                key={finding.id}
                className="flex gap-3.5 border-t border-brand-border/40 py-4 first:border-t-0"
              >
                <span
                  aria-hidden="true"
                  className={`my-1 w-2 shrink-0 rounded ${RAIL_STYLE[finding.tier]}`}
                />
                <div className="min-w-0">
                  <h3 className="text-[14px] font-semibold text-text-dark-primary">
                    {t(`findings.${finding.id}.title`)}{" "}
                    <span
                      className={`ml-1 inline-block rounded-full px-2 py-0.5 align-middle text-[11px] font-bold ${TIER_STYLE[finding.tier]}`}
                    >
                      {t(`tiers.${finding.tier}`)}
                    </span>
                  </h3>
                  <p className="mt-1 max-w-[52em] text-[13px] leading-relaxed text-text-dark-secondary">
                    {t(`findings.${finding.id}.body`)}
                  </p>

                  {finding.measures.length > 0 ? (
                    <dl className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5">
                      {finding.measures.map((measure) => (
                        <div key={measure.key} className="text-[12.5px]">
                          <dt className="inline text-text-dark-secondary">
                            {t(`measures.${measure.key}`)}:{" "}
                          </dt>
                          <dd className="inline font-semibold tabular-nums text-text-dark-primary">
                            {formatMeasure(measure)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}

                  {finding.queries.length > 0 ? (
                    <ul className="mt-2.5 flex list-none flex-wrap gap-2 p-0">
                      {finding.queries.map((query) => (
                        <li
                          key={query}
                          className="rounded-full border border-brand-border bg-brand-bg px-3 py-0.5 text-[12px] text-text-dark-secondary"
                        >
                          {query}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {finding.hypothesis ? (
                    <p className="mt-2.5 max-w-[52em] text-[13px] leading-relaxed text-text-dark-secondary">
                      <span
                        className={`mr-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${TIER_STYLE.hypothesis}`}
                      >
                        {t("tiers.hypothesis")}
                      </span>
                      {t(`hypotheses.${finding.hypothesis}`)}
                    </p>
                  ) : null}

                  {finding.limitation ? (
                    <LimitationHint
                      className="mt-2"
                      label={t("limitationLabel")}
                      limitations={[t(`limitations.${finding.limitation}`)]}
                    />
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {result.actions.length > 0 ? (
        <section className="rounded-2xl border border-brand-border/70 bg-brand-bg-alt/35 p-5 md:p-6">
          <h2 className="text-[16px] font-semibold text-text-dark-primary">
            {t("actionsTitle", { count: result.actions.length })}
          </h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-text-dark-secondary">
            {t("actionsIntro")}
          </p>

          <div className="mt-3">
            {result.actions.map((action) => (
              <article
                key={action.id}
                className="flex gap-3.5 border-t border-brand-border/40 py-4 first:border-t-0"
              >
                <span
                  className={`mt-0.5 shrink-0 self-start rounded-lg px-2.5 py-1 text-[11px] font-bold ${ACTION_STYLE[action.kind]}`}
                >
                  {t(`actionKinds.${action.kind}`)}
                </span>
                <div className="min-w-0">
                  <h3 className="text-[14px] font-semibold text-text-dark-primary">
                    {t(`actions.${action.id}.title`)}
                  </h3>
                  <p className="mt-1 max-w-[52em] text-[13px] leading-relaxed text-text-dark-secondary">
                    {t(`actions.${action.id}.body`)}
                  </p>
                  {/*
                   * Two namespaces, because the two kinds of basis are two
                   * different kinds of thing: a finding is something we
                   * measured, a site signal is an observation whose lineage
                   * may be the visitor's own. Merging them into one list of
                   * ids would have this line guessing which namespace to
                   * look in.
                   */}
                  <p className="mt-1.5 text-[12px] text-text-dark-secondary/80">
                    {t("basisLabel")}:{" "}
                    {[
                      ...action.basis.map((id) => t(`findings.${id}.title`)),
                      ...action.signalBasis.map((id) =>
                        t(`siteSignals.${id}.label`),
                      ),
                    ].join(" · ")}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <details className="rounded-2xl border border-brand-border/70 bg-brand-bg-alt/25 px-5 md:px-6">
        <summary className="cursor-pointer py-4 text-[13px] text-text-dark-secondary">
          {t("checksSummary", {
            total: result.checks.length,
            hits: result.checks.filter((check) => check.status === "hit")
              .length,
          })}
        </summary>
        <ul className="list-none p-0 pb-4">
          {result.checks.map((check) => (
            <li
              key={check.id}
              className="flex flex-wrap gap-x-3 gap-y-1 border-t border-brand-border/40 py-2 text-[12.5px] first:border-t-0"
            >
              <span
                className={`w-20 shrink-0 font-bold ${CHECK_STYLE[check.status]}`}
              >
                {t(`checkStatus.${check.status}`)}
              </span>
              <span className="w-44 shrink-0 text-text-dark-primary">
                {t(`checks.${check.id}`)}
              </span>
              <span className="min-w-[14rem] flex-1 text-text-dark-secondary">
                {check.unavailableReason
                  ? t(`unavailableReasons.${check.unavailableReason}`)
                  : t(`checkOutcomes.${check.id}.${check.status}`)}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
