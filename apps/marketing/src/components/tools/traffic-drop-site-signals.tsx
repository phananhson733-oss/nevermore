// @input  -- the site-signal group from a traffic-drop result, plus an answer callback
// @output -- the manual-action card, the path this report is on, and the observations
// @pos    -- top of the report surface; renders before the chart on purpose
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useTranslations } from "next-intl";
import type {
  BrandSplitOutcome,
  CoreUpdateTimeline,
  ManualActionStatus,
  QueryCohortOutcome,
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

interface TrafficDropSiteSignalsProps {
  readonly signals: TrafficSiteSignals;
  readonly locale: string;
  /** Re-runs the report with the visitor's answer. */
  readonly onAnswer: (status: ManualActionStatus) => void;
  readonly busy: boolean;
}

export function TrafficDropSiteSignals({
  signals,
  locale,
  onAnswer,
  busy,
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

  const { path, status } = signals.manualAction;

  return (
    <div className="space-y-4">
      <ManualActionCard
        status={status}
        busy={busy}
        onAnswer={onAnswer}
        t={t}
      />

      <section
        className={`rounded-2xl border p-5 md:p-6 ${
          path === "manual_action"
            ? "border-brand-error/40 bg-[rgba(197,84,72,0.07)]"
            : "border-brand-border/70 bg-brand-bg-alt/35"
        }`}
      >
        <h2 className="text-[16px] font-semibold text-text-dark-primary">
          {t(
            path === "manual_action"
              ? "siteSignals.paths.manualActionTitle"
              : path === "no_manual_action"
                ? "siteSignals.paths.noManualActionTitle"
                : "siteSignals.paths.unconfirmedTitle",
          )}
        </h2>
        <p className="mt-2 max-w-[52em] text-[13px] leading-relaxed text-text-dark-secondary">
          {t(
            path === "manual_action"
              ? "siteSignals.paths.manualActionBody"
              : path === "no_manual_action"
                ? "siteSignals.paths.noManualActionBody"
                : "siteSignals.paths.unconfirmedBody",
          )}
        </p>
      </section>

      <section className="rounded-2xl border border-brand-border/70 bg-brand-bg-alt/35 p-5 md:p-6">
        <h2 className="text-[16px] font-semibold text-text-dark-primary">
          {t("siteSignals.sectionTitle")}
        </h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-text-dark-secondary">
          {t("siteSignals.sectionIntro")}
        </p>

        <div className="mt-4 space-y-4">
          <CoreUpdateBlock timeline={signals.coreUpdateTimeline} t={t} />
          <BrandSplitBlock
            outcome={signals.brandSplit}
            percent={percent}
            signed={signed}
            t={t}
          />
          <CohortBlock
            outcome={signals.queryCohort}
            percent={percent}
            t={t}
          />
        </div>
      </section>
    </div>
  );
}

type Translate = ReturnType<typeof useTranslations<"tools.trafficDrop">>;

const ANSWERS: readonly {
  readonly status: ManualActionStatus;
  readonly key: string;
}[] = [
  { status: "user_reports_manual_action", key: "optionManualAction" },
  { status: "user_reports_none", key: "optionNone" },
  { status: "uncertain", key: "optionUncertain" },
  { status: "not_checked", key: "optionNotChecked" },
];

function ManualActionCard({
  status,
  busy,
  onAnswer,
  t,
}: {
  readonly status: ManualActionStatus;
  readonly busy: boolean;
  readonly onAnswer: (status: ManualActionStatus) => void;
  readonly t: Translate;
}) {
  return (
    <section className="rounded-2xl border border-brand-accent/30 bg-brand-accent/[0.06] p-5 md:p-6">
      <h2 className="text-[16px] font-semibold text-text-dark-primary">
        {t("siteSignals.manualAction.cardTitle")}
      </h2>
      <p className="mt-2 max-w-[52em] text-[13px] leading-relaxed text-text-dark-secondary">
        {t("siteSignals.manualAction.cardBody")}
      </p>
      <p className="mt-3 rounded-lg border border-brand-border bg-brand-bg px-3 py-2 text-[13px] font-semibold text-text-dark-primary">
        {t("siteSignals.manualAction.cardSteps")}
      </p>

      <fieldset className="mt-4 border-0 p-0">
        <legend className="sr-only">
          {t("siteSignals.manualAction.cardTitle")}
        </legend>
        <div className="flex flex-wrap gap-2">
          {ANSWERS.map((answer) => {
            const active = answer.status === status;
            return (
              <button
                key={answer.status}
                type="button"
                disabled={busy}
                aria-pressed={active}
                onClick={() => onAnswer(answer.status)}
                className={`rounded-lg border px-3 py-1.5 text-[12.5px] transition disabled:opacity-60 ${
                  active
                    ? "border-brand-accent bg-brand-accent text-white"
                    : "border-brand-border bg-brand-bg text-text-dark-secondary hover:border-brand-accent/50"
                }`}
              >
                {t(`siteSignals.manualAction.${answer.key}`)}
              </button>
            );
          })}
        </div>
      </fieldset>

      <p className="mt-3 max-w-[52em] text-[12.5px] leading-relaxed text-text-dark-secondary/85">
        {t("siteSignals.manualAction.notice")}
      </p>
      <p className="mt-2 max-w-[52em] text-[12.5px] leading-relaxed text-text-dark-secondary">
        {t("siteSignals.manualAction.cardWhy")}
      </p>
      <p className="mt-2 text-[12.5px] font-semibold text-text-dark-primary">
        {t(
          status === "user_reports_manual_action"
            ? "siteSignals.manualAction.recordedManualAction"
            : status === "user_reports_none"
              ? "siteSignals.manualAction.recordedNone"
              : status === "uncertain"
                ? "siteSignals.manualAction.recordedUncertain"
                : "siteSignals.manualAction.recordedNotChecked",
        )}
      </p>
    </section>
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
    <article className="border-t border-brand-border/40 pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-[13.5px] font-semibold text-text-dark-primary">
        {label}
      </h3>
      <div className="mt-1.5 max-w-[52em] space-y-1.5 text-[12.5px] leading-relaxed text-text-dark-secondary">
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
      <p className="text-text-dark-secondary/85">
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
      <p className="text-text-dark-secondary/70">
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
          <p className="font-semibold tabular-nums text-text-dark-primary">
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
          <p className="font-semibold tabular-nums text-text-dark-primary">
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
          {outcome.coverage.beforeTruncated || outcome.coverage.afterTruncated ? (
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
