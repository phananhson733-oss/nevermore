// @input  -- TrafficDropResult, its daily series, and the shared limitation disclosure
// @output -- fixed windows, findings collapsed by evidence tier, actions with their
//            next-step links, the where-to-go-next card, and compact evidence boundaries
// @pos    -- report surface of /[locale]/tools/traffic-drop-diagnosis
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import Link from "next/link";
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
// Relative, not the `@/` alias: the shared Vitest config maps `@/` to apps/web
// only, so an aliased import would not resolve under this file's tests.
import { localePath } from "../../lib/locale-path";
import {
  trafficDropActionLink,
  trafficDropCheckLink,
  type TrafficDropLink,
} from "../../lib/tools/traffic-drop-links";
import { TrafficDropChart } from "./traffic-drop-chart";
import {
  TrafficDropSiteSignals,
  TrafficDropUncheckedSignals,
  uncheckedSignalBlockCount,
} from "./traffic-drop-site-signals";
import { LimitationHint } from "../ui/limitation-hint";

/** Status chips: mono, 4px radius, tinted at 15%. */
const CHIP =
  "rounded font-mono text-[9.5px] tracking-[0.08em] uppercase px-2 py-[3px]";

const TIER_STYLE: Record<TrafficFinding["tier"], string> = {
  observed: "bg-brand-info/15 text-brand-info",
  hypothesis: "bg-brand-warning/15 text-brand-warning",
  data_boundary: "border border-brand-border-strong text-text-dark-secondary",
};

const RAIL_STYLE: Record<TrafficFinding["tier"], string> = {
  observed: "bg-brand-error",
  hypothesis: "bg-brand-warning",
  data_boundary: "bg-brand-border-strong",
};

const ACTION_STYLE: Record<TrafficAction["kind"], string> = {
  do: "bg-brand-accent text-brand-on-accent",
  external_data: "bg-brand-info/15 text-brand-info",
  avoid: "border border-brand-border-strong text-text-dark-secondary",
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

const CARD =
  "rounded-card border border-brand-border-card bg-brand-panel p-[22px] md:p-[26px]";

/** 「去别处」型导航链接走次强调色，避免和页面主强调抢。 */
const NAV_LINK =
  "inline-flex items-center gap-1.5 text-[13px] text-brand-accent-2 transition-colors hover:text-brand-info";

interface TrafficDropResultsProps {
  readonly result: TrafficDropResult;
  readonly series: readonly TrafficDailyPoint[];
  readonly locale: string;
  /**
   * The Search Console property this report is about, when the caller passes
   * it. The tool surface does not yet, so the decline-concentration link
   * cannot name a resource and falls back to the console's entry page —
   * `trafficDropCheckLink` builds the deep link the moment this arrives.
   */
  readonly property?: string;
}

/**
 * Colour follows the DIRECTION of a change and nothing else.
 *
 * Counts and rates stay neutral: a large number is not a good number, and
 * tinting one green is a judgement this surface does not make.
 */
function measureTone(measure: TrafficMeasure): string {
  if (measure.value === null || typeof measure.value === "string") {
    return "text-text-dark-primary";
  }
  if (!measure.key.endsWith("_change")) return "text-text-dark-primary";
  if (measure.value < 0) return "text-brand-error";
  if (measure.value > 0) return "text-brand-accent";
  return "text-text-dark-primary";
}

/**
 * A next-step link INSIDE the report item whose text motivates it (交办 5a).
 * The item wrote the step; this is the step's address, not a new claim.
 */
function ToolLinkLine({ link }: { readonly link: TrafficDropLink }) {
  const body = (
    <>
      <span aria-hidden="true">→</span>
      {link.label}
    </>
  );
  return (
    <p className="mt-2.5 text-[13px] leading-[1.6]">
      {link.external ? (
        <a
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className={NAV_LINK}
        >
          {body}
        </a>
      ) : (
        <Link href={link.href} className={NAV_LINK}>
          {body}
        </Link>
      )}
      {link.detail ? (
        <span className="mt-1 block max-w-[52em] text-[12.5px] leading-[1.6] text-text-dark-secondary">
          {link.detail}
        </span>
      ) : null}
    </p>
  );
}

export function TrafficDropResults({
  result,
  series,
  locale,
  property,
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

  /*
   * Collapse state binds to the evidence tag each block already carries
   * (交办 5c). Observed stays open, hypothesis folds in place, and everything
   * tagged as a boundary or an unrun check gathers into one counted region.
   * Nothing is deleted — every sentence keeps rendering, collapsed or not.
   */
  const surfacedFindings = result.findings.filter(
    (finding) => finding.tier !== "data_boundary",
  );
  const boundaryFindings = result.findings.filter(
    (finding) => finding.tier === "data_boundary",
  );
  const uncheckedCount =
    uncheckedSignalBlockCount(result.siteSignals) + boundaryFindings.length;

  function findingTitle(finding: TrafficFinding) {
    return (
      <h3 className="inline text-[15.5px] font-semibold text-text-dark-primary">
        {t(`findings.${finding.id}.title`)}{" "}
        <span
          className={`ml-1.5 inline-block align-middle ${CHIP} ${TIER_STYLE[finding.tier]}`}
        >
          {t(`tiers.${finding.tier}`)}
        </span>
      </h3>
    );
  }

  function findingBody(finding: TrafficFinding) {
    return (
      <>
        <p className="mt-1.5 max-w-[52em] text-[13px] leading-[1.6] text-text-dark-secondary">
          {t(`findings.${finding.id}.body`)}
        </p>

        {/*
          The measures read as a table, not as a sentence: a 1px gap
          over the divider colour, one cell each, and the number in
          mono at a size the eye lands on before the label.
        */}
        {finding.measures.length > 0 ? (
          <dl className="mt-3.5 grid gap-px overflow-hidden rounded-card border border-brand-border-card bg-brand-border-card [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
            {finding.measures.map((measure) => (
              <div
                key={measure.key}
                className="bg-brand-panel-sunken px-5 py-4"
              >
                <dt className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
                  {t(`measures.${measure.key}`)}
                </dt>
                <dd
                  className={`mt-2 font-mono text-[22px] tabular-nums ${measureTone(measure)}`}
                >
                  {formatMeasure(measure)}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {finding.queries.length > 0 ? (
          <ul className="mt-3 flex list-none flex-wrap gap-2 p-0">
            {finding.queries.map((query) => (
              <li
                key={query}
                className="rounded-full border border-brand-border-strong bg-brand-panel-sunken px-3 py-1 font-mono text-[11px] text-text-dark-secondary"
              >
                {query}
              </li>
            ))}
          </ul>
        ) : null}

        {/*
          Folded behind its own tag (交办 5c): the chip stays visible where the
          paragraph used to spread out, the full text opens under it.
        */}
        {finding.hypothesis ? (
          <details className="mt-3">
            <summary className="inline-flex cursor-pointer items-center">
              <span className={`${CHIP} ${TIER_STYLE.hypothesis}`}>
                {t("tiers.hypothesis")}
              </span>
            </summary>
            <p className="mt-2 max-w-[52em] text-[13px] leading-[1.6] text-text-dark-secondary">
              {t(`hypotheses.${finding.hypothesis}`)}
            </p>
          </details>
        ) : null}

        {finding.limitation ? (
          <LimitationHint
            className="mt-2"
            label={t("limitationLabel")}
            limitations={[t(`limitations.${finding.limitation}`)]}
          />
        ) : null}
      </>
    );
  }

  function findingArticle(finding: TrafficFinding) {
    return (
      <article
        key={finding.id}
        className="flex gap-3.5 border-t border-brand-border-faint py-5 first:border-t-0"
      >
        <span
          aria-hidden="true"
          className={`my-1 w-[3px] shrink-0 rounded-full ${RAIL_STYLE[finding.tier]}`}
        />
        <div className="min-w-0 flex-1">
          {finding.tier === "hypothesis" ? (
            <details>
              <summary className="cursor-pointer">
                {findingTitle(finding)}
              </summary>
              {findingBody(finding)}
            </details>
          ) : (
            <>
              {findingTitle(finding)}
              {findingBody(finding)}
            </>
          )}
        </div>
      </article>
    );
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

      <section className={CARD}>
        <h2 className="text-[16.5px] font-semibold text-text-dark-primary">
          {t("chartTitle")}
        </h2>
        <p className="mt-1.5 mb-5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
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
                className={`rounded-[8px] border border-brand-border border-l-[3px] bg-brand-panel-sunken px-3 py-1.5 font-mono text-[11px] tabular-nums text-text-dark-secondary ${WINDOW_RAIL[window.id]}`}
              >
                <b className="font-medium text-text-dark-primary">
                  {t(`windows.${window.id}.label`)} {window.startDate} →{" "}
                  {window.endDate}
                </b>{" "}
                · {numbers.format(window.clicks)} {t("clicks")} ·{" "}
                {numbers.format(window.impressions)} {t("impressions")} · CTR{" "}
                {formatCtr(window)}
              </span>
            ))}
            <p className="mt-1 w-full text-[12.5px] leading-[1.6] text-text-dark-secondary">
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

      {surfacedFindings.length > 0 ? (
        <section className={CARD}>
          <h2 className="text-[16.5px] font-semibold text-text-dark-primary">
            {t("findingsTitle", { count: surfacedFindings.length })}
          </h2>
          <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {t("findingsIntro")}
          </p>

          <div className="mt-3">
            {surfacedFindings.map((finding) => findingArticle(finding))}
          </div>
        </section>
      ) : null}

      {/*
       * Everything the run could not look at, in one counted fold (交办 5c):
       * data-boundary findings and the site-signal blocks whose outcome is
       * `not_available`. The material used to spread across the top of the
       * report; the tags said "we could not check this", so it collapses
       * under exactly those words — full text intact inside.
       */}
      {uncheckedCount > 0 ? (
        <details className="rounded-card border border-brand-border-card bg-brand-panel px-[22px] md:px-[26px]">
          <summary className="cursor-pointer py-4 text-[13px] text-text-dark-secondary transition-colors hover:text-brand-accent-text">
            {locale === "zh"
              ? `我们没能查的（${uncheckedCount} 项）`
              : `What we could not check (${uncheckedCount} ${
                  uncheckedCount === 1 ? "item" : "items"
                })`}
          </summary>
          <div className="space-y-5 pb-5">
            {uncheckedSignalBlockCount(result.siteSignals) > 0 ? (
              <TrafficDropUncheckedSignals
                signals={result.siteSignals}
                locale={locale}
              />
            ) : null}
            {boundaryFindings.map((finding) => findingArticle(finding))}
          </div>
        </details>
      ) : null}

      {result.actions.length > 0 ? (
        <section className={CARD}>
          <h2 className="text-[16.5px] font-semibold text-text-dark-primary">
            {t("actionsTitle", { count: result.actions.length })}
          </h2>
          <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {t("actionsIntro")}
          </p>

          <div className="mt-3">
            {result.actions.map((action) => {
              const link = trafficDropActionLink(action.id, locale);
              return (
                <article
                  key={action.id}
                  className="flex gap-3.5 border-t border-brand-border-faint py-5 first:border-t-0"
                >
                  <span
                    className={`mt-0.5 shrink-0 self-start ${CHIP} ${ACTION_STYLE[action.kind]}`}
                  >
                    {t(`actionKinds.${action.kind}`)}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[15.5px] font-semibold text-text-dark-primary">
                      {t(`actions.${action.id}.title`)}
                    </h3>
                    <p className="mt-1.5 max-w-[52em] text-[13px] leading-[1.6] text-text-dark-secondary">
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
                    <p className="mt-2.5 text-[12.5px] text-text-dark-secondary">
                      {/*
                       * 「依据」是证据溯源标签，不是序号：读不到它，后面那串标题就会
                       * 被当成又一条建议。faint 那档只留给读不到也不丢信息的记号。
                       */}
                      <span className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
                        {t("basisLabel")}:
                      </span>{" "}
                      {[
                        ...action.basis.map((id) => t(`findings.${id}.title`)),
                        ...action.signalBasis.map((id) =>
                          t(`siteSignals.${id}.label`),
                        ),
                      ].join(" · ")}
                    </p>
                    {link ? <ToolLinkLine link={link} /> : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {/*
       * The exit card (交办 5b). Same body and links as the page-bottom aside
       * in ConnectedToolPage — only the position (right after "what to do
       * next", where the reader is asking exactly this) and the heading
       * changed. Removing the page-bottom copy is that shared shell's change,
       * not this component's.
       */}
      <aside className={CARD}>
        <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
          {locale === "zh" ? "接下来去哪里" : "Where to go next"}
        </p>
        <p className="mt-3 text-[15.5px] leading-snug font-semibold text-text-dark-primary">
          {locale === "zh"
            ? "先用无需连接的数据检查网站基础。"
            : "Start with a site check that does not require a connection."}
        </p>
        <div className="mt-5 space-y-3">
          <Link
            href={localePath(locale, "/tools/seo-audit")}
            className="flex items-center gap-1.5 text-[13.5px] text-brand-accent-2 transition-colors hover:text-brand-info"
          >
            {locale === "zh" ? "免费 SEO 审计" : "Free SEO Audit"}
            <span aria-hidden="true">&rarr;</span>
          </Link>
          <Link
            href={localePath(locale, "/tools/internal-link-audit")}
            className="flex items-center gap-1.5 text-[13.5px] text-brand-accent-2 transition-colors hover:text-brand-info"
          >
            {locale === "zh" ? "内链审计" : "Internal Link Audit"}
            <span aria-hidden="true">&rarr;</span>
          </Link>
        </div>
      </aside>

      <details className="rounded-card border border-brand-border-card bg-brand-panel px-[22px] md:px-[26px]">
        <summary className="cursor-pointer py-4 text-[13px] text-text-dark-secondary transition-colors hover:text-brand-accent-text">
          {t("checksSummary", {
            total: result.checks.length,
            hits: result.checks.filter((check) => check.status === "hit")
              .length,
          })}
        </summary>
        <ul className="list-none p-0 pb-4">
          {result.checks.map((check) => {
            const link = trafficDropCheckLink(
              check.id,
              check.status,
              locale,
              property ?? null,
            );
            return (
              <li
                key={check.id}
                className="flex flex-wrap gap-x-3 gap-y-1 border-t border-brand-border-faint py-2.5 text-[12.5px] first:border-t-0"
              >
                <span
                  className={`w-20 shrink-0 font-mono text-[10px] tracking-[0.08em] uppercase ${CHECK_STYLE[check.status]}`}
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
                  {link ? (
                    <span className="mt-1 block">
                      {link.external ? (
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={NAV_LINK}
                        >
                          <span aria-hidden="true">→</span>
                          {link.label}
                        </a>
                      ) : (
                        <Link href={link.href} className={NAV_LINK}>
                          <span aria-hidden="true">→</span>
                          {link.label}
                        </Link>
                      )}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}
