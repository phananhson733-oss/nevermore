// @input  -- the site-signal group from a traffic-drop result
// @output -- the recorded self-checks, the path this report is on, and the observations
// @pos    -- top of the report surface; renders before the chart on purpose
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useTranslations } from "next-intl";
import type {
  BrandSplitOutcome,
  CoreUpdateTimeline,
  QueryCohortOutcome,
  SelfCheckObservation,
  TrafficSiteSignals,
} from "@sf/public-tools";

/**
 * Explanations each split shape is consistent with, in the order they should
 * be tried.
 *
 * Ordered by how cheap they are to check and fix, NOT by likelihood — we have
 * no basis for a likelihood ordering and presenting one would be the same
 * mistake as naming a single cause. The technical entries come first because a
 * stray `noindex` produces the identical shape to any content story and can be
 * ruled out in minutes.
 */
const SHAPE_EXPLANATIONS: Record<string, readonly string[]> = {
  non_brand_declined_more: [
    "technical",
    "freshness",
    "demand",
    "serp",
    "competition",
    "quality",
  ],
  brand_declined_more: ["technical", "demand", "serp"],
  both_declined: ["uniform", "technical", "demand", "serp"],
  no_material_change: [],
};

const CARD =
  "rounded-card border border-brand-border-card bg-brand-panel p-[22px] md:p-[26px]";

interface TrafficDropSiteSignalsProps {
  readonly signals: TrafficSiteSignals;
  readonly locale: string;
}

export function TrafficDropSiteSignals({
  signals,
  locale,
}: TrafficDropSiteSignalsProps) {
  const t = useTranslations("tools.trafficDrop");
  const percent = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
    style: "percent",
    maximumFractionDigits: 0,
  });
  const signed = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
    style: "percent",
    maximumFractionDigits: 0,
    signDisplay: "exceptZero",
  });

  const { path } = signals.selfChecks;

  return (
    <div className="space-y-4">
      <RecordedSelfChecks signals={signals} t={t} />

      {/*
        The reported-issue variant is the one state on this page with a
        definite answer, so it carries an inset rail rather than a louder fill.
      */}
      <section
        className={`rounded-card border p-[22px] md:p-[26px] ${
          path === "issue_reported"
            ? "border-brand-error/40 bg-brand-error/[0.07] shadow-[inset_2px_0_0_#F09090]"
            : "border-brand-border-card bg-brand-panel"
        }`}
      >
        <h2 className="text-[16.5px] font-semibold text-text-dark-primary">
          {t(
            path === "issue_reported"
              ? "siteSignals.paths.issueReportedTitle"
              : path === "no_issue_reported"
                ? "siteSignals.paths.noIssueTitle"
                : "siteSignals.paths.unconfirmedTitle",
          )}
        </h2>
        <p className="mt-2 max-w-[52em] text-[13px] leading-[1.65] text-text-dark-secondary">
          {t(
            path === "issue_reported"
              ? "siteSignals.paths.issueReportedBody"
              : path === "no_issue_reported"
                ? "siteSignals.paths.noIssueBody"
                : "siteSignals.paths.unconfirmedBody",
          )}
        </p>
      </section>

      <section className={CARD}>
        <h2 className="text-[16.5px] font-semibold text-text-dark-primary">
          {t("siteSignals.sectionTitle")}
        </h2>
        <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
          {t("siteSignals.sectionIntro")}
        </p>

        <div className="mt-5 space-y-4">
          <CoreUpdateBlock timeline={signals.coreUpdateTimeline} t={t} />
          <BrandSplitBlock
            outcome={signals.brandSplit}
            percent={percent}
            signed={signed}
            t={t}
          />
          <CohortBlock outcome={signals.queryCohort} percent={percent} t={t} />
        </div>
      </section>
    </div>
  );
}

type Translate = ReturnType<typeof useTranslations<"tools.trafficDrop">>;

/**
 * What the visitor told us, played back as their words rather than ours.
 *
 * Read-only on purpose. The answers are collected before the run — see the
 * gate in `traffic-drop-tool.tsx` — so by the time this renders they are
 * settled inputs, not a question. When the card lived here and answering
 * re-ran the report, every visitor read a hedged first draft before the real
 * one, and each of the four buttons stayed live afterwards as a re-run trigger
 * against an hourly allowance shared with everyone else.
 *
 * The lineage line is not decoration. A reader who skims will remember "no
 * manual action" as something the tool established; it was not, and this is
 * the only place that says so.
 */
function RecordedSelfChecks({
  signals,
  t,
}: {
  readonly signals: TrafficSiteSignals;
  readonly t: Translate;
}) {
  return (
    <section className={CARD}>
      <h2 className="text-[16.5px] font-semibold text-text-dark-primary">
        {t("siteSignals.recorded.title")}
      </h2>
      {/* 1px gap over the divider colour — the answers read as a record. */}
      <dl className="mt-4 grid gap-px overflow-hidden rounded-card border border-brand-border-card bg-brand-border-card sm:grid-cols-2">
        <RecordedAnswer check={signals.selfChecks.manualAction} t={t} />
        <RecordedAnswer check={signals.selfChecks.securityIssue} t={t} />
      </dl>
      <p className="mt-4 max-w-[52em] text-[12.5px] leading-[1.6] text-text-dark-secondary">
        {t("siteSignals.recorded.lineage")}
      </p>
    </section>
  );
}

function RecordedAnswer({
  check,
  t,
}: {
  readonly check: SelfCheckObservation;
  readonly t: Translate;
}) {
  const label =
    check.id === "manual_action"
      ? "siteSignals.manual_action.label"
      : "siteSignals.security_issue.label";

  return (
    <div className="bg-brand-panel-sunken px-5 py-4">
      <dt className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
        {t(label)}
      </dt>
      <dd className="mt-2 text-[14px] font-semibold text-text-dark-primary">
        {t(`siteSignals.recorded.${check.id}.${check.answer}`)}
      </dd>
    </div>
  );
}

function Block({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <article className="border-t border-brand-border-faint pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-[14px] font-semibold text-text-dark-primary">
        {label}
      </h3>
      <div className="mt-2 max-w-[52em] space-y-1.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
        {children}
      </div>
    </article>
  );
}

function CoreUpdateBlock({
  timeline,
  t,
}: {
  readonly timeline: CoreUpdateTimeline;
  readonly t: Translate;
}) {
  return (
    <Block label={t("siteSignals.coreUpdate.label")}>
      <p className="text-text-dark-secondary">
        {t("siteSignals.coreUpdate.caveat")}
      </p>
      {timeline.kind === "not_available" ? (
        <p>
          {t(
            `unavailableReasons.${
              timeline.reason === "no_event_window"
                ? "no_event_window"
                : "core_update_table_not_verified"
            }`,
          )}
        </p>
      ) : (
        <>
          <p>
            {t("siteSignals.coreUpdate.eventWindow", {
              startDate: timeline.eventWindow.startDate,
              endDate: timeline.eventWindow.endDate,
              dayCount: timeline.eventWindow.dayCount,
            })}
          </p>
          {timeline.overlapping.length === 0 ? (
            <p>{t("siteSignals.coreUpdate.noOverlap")}</p>
          ) : (
            <ul className="list-none space-y-1 p-0">
              {timeline.overlapping.map((entry) => (
                <li key={entry.update.id}>
                  {entry.rolloutEndUnannounced
                    ? t("siteSignals.coreUpdate.overlapOpenEnded", {
                        name: entry.update.name,
                        startDate: entry.update.startDate,
                      })
                    : t("siteSignals.coreUpdate.overlap", {
                        name: entry.update.name,
                        startDate: entry.update.startDate,
                        endDate: entry.update.endDate ?? entry.update.startDate,
                        days: entry.overlapDays,
                      })}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="font-mono text-[10px] tracking-[0.08em] text-text-dark-secondary">
        {t("siteSignals.coreUpdate.tableStamp", {
          version: timeline.tableVersion,
          verifiedThrough: timeline.verifiedThrough,
        })}
      </p>
    </Block>
  );
}

function BrandSplitBlock({
  outcome,
  percent,
  signed,
  t,
}: {
  readonly outcome: BrandSplitOutcome;
  readonly percent: Intl.NumberFormat;
  readonly signed: Intl.NumberFormat;
  readonly t: Translate;
}) {
  const share = (value: number | null) =>
    value === null ? t("notAvailable") : percent.format(value);
  const change = (value: number | null) =>
    value === null ? t("notAvailable") : signed.format(value);

  return (
    <Block label={t("siteSignals.brandSplit.label")}>
      {outcome.kind === "not_available" ? (
        <p>{t(`unavailableReasons.${unavailableKey(outcome.reason)}`)}</p>
      ) : (
        <>
          <p>
            {t("siteSignals.brandSplit.coverage", {
              beforeShare: share(outcome.coverage.before.clickShare),
              afterShare: share(outcome.coverage.after.clickShare),
            })}
          </p>
          <p className="rounded-[10px] border border-brand-border bg-brand-panel-sunken px-4 py-3 font-medium tabular-nums text-text-dark-primary">
            {t("siteSignals.brandSplit.brandGroup", {
              clickChange: change(outcome.brand.clickChangeRatio),
              queries: outcome.brand.queries,
            })}
            {" · "}
            {t("siteSignals.brandSplit.nonBrandGroup", {
              clickChange: change(outcome.nonBrand.clickChangeRatio),
              queries: outcome.nonBrand.queries,
            })}
          </p>
          <p>{t(`siteSignals.brandSplit.shape_${outcome.shape}`)}</p>
          {(SHAPE_EXPLANATIONS[outcome.shape] ?? []).length > 0 ? (
            <>
              <p>{t("siteSignals.brandSplit.compatibleWith")}</p>
              <ul className="ml-4 list-disc space-y-0.5">
                {(SHAPE_EXPLANATIONS[outcome.shape] ?? []).map((key) => (
                  <li key={key}>
                    {t(`siteSignals.brandSplit.explanation_${key}`)}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {outcome.coverage.before.truncated ||
          outcome.coverage.after.truncated ? (
            <p>{t("siteSignals.brandSplit.truncated")}</p>
          ) : null}
        </>
      )}
    </Block>
  );
}

function CohortBlock({
  outcome,
  percent,
  t,
}: {
  readonly outcome: QueryCohortOutcome;
  readonly percent: Intl.NumberFormat;
  readonly t: Translate;
}) {
  return (
    <Block label={t("siteSignals.cohort.label")}>
      {outcome.kind === "not_available" ? (
        <p>{t(`unavailableReasons.${unavailableKey(outcome.reason)}`)}</p>
      ) : (
        <>
          <p>
            {t("siteSignals.cohort.intro", { cohortSize: outcome.cohortSize })}
          </p>
          <p className="rounded-[10px] border border-brand-border bg-brand-panel-sunken px-4 py-3 font-medium tabular-nums text-text-dark-primary">
            {t("siteSignals.cohort.topTen", {
              startedInTopTen: outcome.topTen.startedInTopTen,
              heldTopTen: outcome.topTen.heldTopTen,
              slippedWithinFifty: outcome.topTen.slippedWithinFifty,
              fellBelowFifty: outcome.topTen.fellBelowFifty,
            })}
          </p>
          {outcome.noLongerVisible > 0 ? (
            <p>
              {t("siteSignals.cohort.noLongerVisible", {
                count: outcome.noLongerVisible,
              })}
            </p>
          ) : null}
          {outcome.coverage.cohortClickShare !== null ? (
            <p>
              {t("siteSignals.cohort.coverage", {
                share: percent.format(outcome.coverage.cohortClickShare),
              })}
            </p>
          ) : null}
          {outcome.coverage.beforeTruncated ||
          outcome.coverage.afterTruncated ? (
            <p>{t("siteSignals.cohort.truncated")}</p>
          ) : null}
        </>
      )}
    </Block>
  );
}

/**
 * Map an outcome's own reason onto the shared copy namespace.
 *
 * The two vocabularies overlap but are not identical — `read_not_performed`
 * is the modules' word and `query_read_not_performed` is the report's. Doing
 * the translation here rather than renaming one of them keeps each module
 * readable on its own terms.
 */
function unavailableKey(reason: string): string {
  return reason === "read_not_performed" ? "query_read_not_performed" : reason;
}
