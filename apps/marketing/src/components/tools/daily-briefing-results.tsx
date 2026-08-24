// @input  -- one Daily Briefing envelope, property identity, quota facts, and tab storage
// @output -- localized KPI, evidence, change, handoff, manual-check, and limitation panels
// @pos    -- non-persistent result artifact inside the Daily Briefing tool

"use client";

import { useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  Database,
  Eye,
  Gauge,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import type {
  DailyBriefingAction,
  DailyBriefingChange,
  DailyBriefingEnvelope,
  DailyBriefingKpiComparison,
} from "@sf/public-tools";
import { localePath } from "../../lib/locale-path";
import { writeToolHandoff } from "../../lib/tools/tool-handoff";

const CARD =
  "rounded-[12px] border border-brand-border-card bg-brand-bg p-4 md:p-[18px]";
const EYEBROW =
  "font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase";

type RateLimitFacts = {
  readonly remaining: number | null;
  readonly limit: number;
};

interface DailyBriefingResultsProps {
  readonly locale: string;
  readonly property: string;
  readonly envelope: DailyBriefingEnvelope;
  readonly rateLimit: RateLimitFacts | null;
}

interface ResultPreviewSectionProps {
  readonly id: string;
  readonly title: string;
  readonly intro: string;
  readonly body: string;
  readonly kind: "changes" | "actions";
}

interface NoiseSummaryProps {
  readonly filtered: number;
  readonly shown: number;
  readonly complete: boolean;
}

type MetricKey = "clicks" | "impressions" | "ctr" | "position";

const METRICS: readonly MetricKey[] = [
  "clicks",
  "impressions",
  "ctr",
  "position",
];

function number(locale: string, value: number): string {
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
    maximumFractionDigits: 1,
  }).format(value);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function metricValue(
  locale: string,
  comparison: DailyBriefingKpiComparison,
  metric: MetricKey,
): string | null {
  const value = comparison.current?.[metric] ?? null;
  if (value === null) return null;
  if (metric === "ctr") return percent(value);
  if (metric === "position") return value.toFixed(1);
  return number(locale, value);
}

function metricDelta(
  locale: string,
  comparison: DailyBriefingKpiComparison,
  metric: MetricKey,
): string | null {
  const value = comparison.delta[metric];
  if (value === null) return null;
  let absolute: string;
  switch (metric) {
    case "ctr":
      absolute = percent(Math.abs(value));
      break;
    case "position":
      absolute = Math.abs(value).toFixed(1);
      break;
    default:
      absolute = number(locale, Math.abs(value));
  }
  if (value > 0) return `+${absolute}`;
  if (value < 0) return `-${absolute}`;
  return absolute;
}

function metricLabel(
  metric: MetricKey,
): "kpis.clicks" | "kpis.impressions" | "kpis.ctr" | "kpis.averagePosition" {
  switch (metric) {
    case "clicks":
      return "kpis.clicks";
    case "impressions":
      return "kpis.impressions";
    case "ctr":
      return "kpis.ctr";
    case "position":
      return "kpis.averagePosition";
  }
}

function destination(
  action: DailyBriefingAction,
): {
  readonly path: string;
  readonly labelKey:
    | "actionDestinations.seo-quick-wins"
    | "actionDestinations.traffic-drop-diagnosis"
    | "actionDestinations.on-page-seo-check";
} {
  switch (action.destination) {
    case "seo-quick-wins":
      return {
        path: "/tools/seo-quick-wins",
        labelKey: "actionDestinations.seo-quick-wins",
      };
    case "traffic-drop-diagnosis":
      return {
        path: "/tools/traffic-drop-diagnosis",
        labelKey: "actionDestinations.traffic-drop-diagnosis",
      };
    case "on-page-seo-check":
      return {
        path: "/tools/on-page-seo-check",
        labelKey: "actionDestinations.on-page-seo-check",
      };
  }
}

function metricsLine(
  t: ReturnType<typeof useTranslations>,
  locale: string,
  row: DailyBriefingChange["current"],
): string {
  const ctr = row.impressions > 0 ? row.clicks / row.impressions : null;
  return t("changes.metrics", {
    clicks: number(locale, row.clicks),
    impressions: number(locale, row.impressions),
    ctr: ctr === null ? t("kpis.unavailable") : percent(ctr),
    position: Number.isFinite(row.position)
      ? row.position.toFixed(1)
      : t("kpis.unavailable"),
  });
}

function comparison(
  previous: number | null,
  current: number,
  format: (value: number) => string,
  notObserved: string,
): string {
  return `${previous === null ? notObserved : format(previous)} → ${format(current)}`;
}

function matchingActions(
  envelope: DailyBriefingEnvelope,
): readonly {
  readonly action: DailyBriefingAction;
  readonly change: DailyBriefingChange;
}[] {
  return envelope.result.actions
    .flatMap((action) => {
      const change = envelope.result.changes.find(
        (candidate) =>
          candidate.kind === action.kind &&
          candidate.query === action.query &&
          candidate.page === action.page,
      );
      return change ? [{ action, change }] : [];
    })
    .slice(0, 3);
}

function ResultPreviewSection({
  id,
  title,
  intro,
  body,
  kind,
}: ResultPreviewSectionProps) {
  return (
    <section
      aria-labelledby={id}
      data-result-preview={kind}
      className="scroll-mt-8"
    >
      <h3
        id={id}
        className="text-[19px] font-semibold tracking-[-0.02em] text-text-dark-primary"
      >
        {title}
      </h3>
      <p className="mt-2 max-w-3xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
        {intro}
      </p>
      <div className={`${CARD} mt-4`}>
        <p className="max-w-3xl text-[13px] leading-[1.65] text-text-dark-secondary">
          {body}
        </p>
      </div>
    </section>
  );
}

function NoiseSummary({ filtered, shown, complete }: NoiseSummaryProps) {
  const t = useTranslations("tools.dailyBriefing");

  return (
    <section
      aria-labelledby="daily-briefing-noise"
      data-result-section="noise"
      className="rounded-[10px] border border-brand-accent/25 bg-brand-accent-soft px-4 py-3"
    >
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
        <h3
          id="daily-briefing-noise"
          className={`${EYEBROW} shrink-0 text-brand-accent-text`}
        >
          {t("noise.label")}
        </h3>
        <p className="text-[12.5px] leading-[1.6] text-text-dark-secondary">
          {complete
            ? t("noise.complete", { filtered, shown })
            : t("noise.partial", { filtered, shown })}
        </p>
      </div>
    </section>
  );
}

export function DailyBriefingResultPreview() {
  const t = useTranslations("tools.dailyBriefing");

  return (
    <div className="mt-8 space-y-8">
      <ResultPreviewSection
        id="daily-briefing-preview-changes"
        kind="changes"
        title={t("changes.title")}
        intro={t("changes.intro")}
        body={t("preview.changes")}
      />
      <ResultPreviewSection
        id="daily-briefing-preview-actions"
        kind="actions"
        title={t("actions.title")}
        intro={t("actions.intro")}
        body={t("preview.actions")}
      />
    </div>
  );
}

export function DailyBriefingResults({
  locale,
  property,
  envelope,
  rateLimit,
}: DailyBriefingResultsProps) {
  const t = useTranslations("tools.dailyBriefing");
  const [manualChecked, setManualChecked] = useState(false);
  const [securityChecked, setSecurityChecked] = useState(false);
  const [handoffFailed, setHandoffFailed] = useState(false);
  const { result } = envelope;
  const dailyAvailable =
    result.cadence === "daily" && result.day.evidence === "observed";
  const actions = matchingActions(envelope);
  const currentCoverage = result.coverage.current;
  const currentAnonymization = result.anonymization.current;
  const shownChanges = result.changes.slice(0, 3);

  function handoff(
    event: ReactMouseEvent<HTMLAnchorElement>,
    action: DailyBriefingAction,
    index: number,
  ) {
    let written = false;
    try {
      written = writeToolHandoff(window.sessionStorage, Date.now(), {
        source: "daily-search-briefing",
        destination: action.destination,
        property,
        query: action.query,
        page: action.page,
        evidenceId: `daily:${index}:${action.kind}`,
      });
    } catch {
      written = false;
    }
    if (!written) {
      event.preventDefault();
      setHandoffFailed(true);
    }
  }

  return (
    <div className="mt-8 space-y-8">
      <p
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 text-[12.5px] text-brand-success"
      >
        <Check aria-hidden="true" className="size-4" />
        {t("runComplete")}
      </p>

      <section
        aria-labelledby="daily-briefing-facts"
        data-result-section="facts"
      >
        <h3 id="daily-briefing-facts" className="sr-only">
          {t("facts.dataThrough")}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <FactCard
            icon={<Database aria-hidden="true" className="size-4" />}
            label={t("facts.dataThrough")}
            value={result.windows.latestDay.endDate}
          />
          <FactCard
            icon={<Eye aria-hidden="true" className="size-4" />}
            label={t("facts.timeBasis")}
            value={t("facts.timeBasisBody")}
          />
          <FactCard
            icon={<Gauge aria-hidden="true" className="size-4" />}
            label={t("facts.cadence")}
            value={
              result.cadence === "daily" ? t("facts.daily") : t("facts.weekly")
            }
            detail={
              result.cadence === "daily"
                ? t("facts.dailyReason")
                : t("facts.weeklyReason")
            }
          />
          <FactCard
            icon={<ShieldCheck aria-hidden="true" className="size-4" />}
            label={t("facts.sharedRuns")}
            value={
              rateLimit === null || rateLimit.remaining === null
                ? t("facts.quotaUnavailable")
                : t("facts.quotaAvailable", {
                    remaining: rateLimit.remaining,
                    limit: rateLimit.limit,
                  })
            }
          />
        </div>
      </section>

      <section
        aria-labelledby="daily-briefing-kpis"
        data-result-section="kpis"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h3
            id="daily-briefing-kpis"
            className="text-[19px] font-semibold tracking-[-0.02em] text-text-dark-primary"
          >
            {t("kpis.title")}
          </h3>
          <p className="max-w-xl text-[12.5px] leading-[1.55] text-text-dark-secondary">
            {t("kpis.positionNote")}
          </p>
        </div>
        {!dailyAvailable ? (
          <p className="mt-3 text-[12.5px] text-brand-warning">
            {t("kpis.dailySuppressed")}
          </p>
        ) : null}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {METRICS.map((metric) => (
            <KpiCard
              key={metric}
              metric={metric}
              label={t(metricLabel(metric))}
              locale={locale}
              day={result.day}
              weekly={result.weekly}
              dailyAvailable={dailyAvailable}
            />
          ))}
        </div>
      </section>

      <NoiseSummary
        filtered={result.filteredObservedRows}
        shown={shownChanges.length}
        complete={result.countComplete}
      />

      <section
        aria-labelledby="daily-briefing-changes"
        data-result-section="changes"
      >
        <h3
          id="daily-briefing-changes"
          className="text-[19px] font-semibold tracking-[-0.02em] text-text-dark-primary"
        >
          {t("changes.title")}
        </h3>
        <p className="mt-2 max-w-3xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
          {t("changes.intro")}
        </p>
        {shownChanges.length === 0 ? (
          <div data-change-empty className={`${CARD} mt-4`}>
            <p className="max-w-3xl text-[13px] leading-[1.65] text-text-dark-secondary">
              {t("changes.empty")}
            </p>
          </div>
        ) : (
          <div
            role="table"
            aria-label={t("changes.title")}
            className="mt-4 overflow-hidden rounded-[12px] border border-brand-border-card bg-brand-bg"
          >
            <div
              role="row"
              className="sr-only border-brand-border-card bg-brand-panel px-4 py-3 md:not-sr-only md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.45fr)_minmax(0,0.65fr)_minmax(0,0.7fr)_minmax(0,1.5fr)] md:gap-5"
            >
              {[
                t("changes.columns.change"),
                t("changes.columns.queryPage"),
                t("changes.columns.clicks"),
                t("changes.columns.position"),
                t("changes.columns.interpretation"),
              ].map((header) => (
                <div
                  key={header}
                  role="columnheader"
                  className={EYEBROW}
                >
                  {header}
                </div>
              ))}
            </div>
            {shownChanges.map((change, index) => (
              <article
                key={`change:${index}:${change.kind}`}
                role="row"
                data-change
                className="grid min-w-0 gap-3 border-t border-brand-border-card px-4 py-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.45fr)_minmax(0,0.65fr)_minmax(0,0.7fr)_minmax(0,1.5fr)] md:gap-5 md:px-4 md:py-5"
              >
                <div role="cell" className="min-w-0">
                  <span aria-hidden="true" className={`${EYEBROW} md:hidden`}>
                    {t("changes.columns.change")}
                  </span>
                  <div className="mt-2 flex min-w-0 items-start gap-2.5 md:mt-0">
                    <span className="mt-0.5 shrink-0 rounded-full border border-brand-accent/25 bg-brand-accent-soft px-2 py-0.5 font-mono text-[9.5px] text-brand-accent-text">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <h4 className="break-words text-[13px] leading-[1.45] font-semibold text-text-dark-primary">
                        {t(`changeKinds.${change.kind}.title`)}
                      </h4>
                      <p className="mt-1.5 font-mono text-[9.5px] leading-[1.4] tracking-[0.04em] text-brand-accent-text uppercase">
                        {t(`evidenceStates.${change.evidence}`)}
                      </p>
                    </div>
                  </div>
                </div>
                <div role="cell" className="min-w-0">
                  <span aria-hidden="true" className={`${EYEBROW} md:hidden`}>
                    {t("changes.columns.queryPage")}
                  </span>
                  <p className="mt-2 break-words text-[12.5px] leading-[1.5] font-medium text-text-dark-primary md:mt-0">
                    {change.query}
                  </p>
                  <p className="mt-1 break-all text-[10.5px] leading-[1.5] text-text-dark-secondary">
                    {change.page}
                  </p>
                </div>
                <div role="cell" className="min-w-0">
                  <span aria-hidden="true" className={`${EYEBROW} md:hidden`}>
                    {t("changes.columns.clicks")}
                  </span>
                  <p className="mt-2 font-mono text-[12px] leading-[1.5] text-text-dark-primary md:mt-0">
                    {comparison(
                      change.previous?.clicks ?? null,
                      change.current.clicks,
                      (value) => number(locale, value),
                      t("changes.notObserved"),
                    )}
                  </p>
                </div>
                <div role="cell" className="min-w-0">
                  <span aria-hidden="true" className={`${EYEBROW} md:hidden`}>
                    {t("changes.columns.position")}
                  </span>
                  <p className="mt-2 font-mono text-[12px] leading-[1.5] text-text-dark-primary md:mt-0">
                    {comparison(
                      change.previous?.position ?? null,
                      change.current.position,
                      (value) =>
                        Number.isFinite(value)
                          ? value.toFixed(1)
                          : t("kpis.unavailable"),
                      t("changes.notObserved"),
                    )}
                  </p>
                </div>
                <div role="cell" className="min-w-0">
                  <span aria-hidden="true" className={`${EYEBROW} md:hidden`}>
                    {t("changes.columns.interpretation")}
                  </span>
                  <p className="mt-2 break-words text-[12px] leading-[1.6] text-text-dark-secondary md:mt-0">
                    {t(`changeKinds.${change.kind}.body`)}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        aria-labelledby="daily-briefing-actions"
        data-result-section="actions"
      >
        <h3
          id="daily-briefing-actions"
          className="text-[19px] font-semibold tracking-[-0.02em] text-text-dark-primary"
        >
          {t("actions.title")}
        </h3>
        <p className="mt-2 max-w-3xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
          {t("actions.intro")}
        </p>
        {actions.length === 0 ? (
          <p className="mt-3 text-[13px] leading-[1.65] text-text-dark-secondary">
            {t("actions.empty")}
          </p>
        ) : (
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {actions.map(({ action, change }, index) => {
              const target = destination(action);
              return (
                <article
                  key={`action:${index}:${action.kind}`}
                  className={`${CARD} flex min-w-0 flex-col`}
                >
                  <p className={EYEBROW}>{t("actions.why")}</p>
                  <h4 className="mt-2 text-[16px] font-semibold text-text-dark-primary">
                    {t(`actionKinds.${action.kind}.title`)}
                  </h4>
                  <p className="mt-2 text-[13px] leading-[1.6] text-text-dark-secondary">
                    {t(`actionKinds.${action.kind}.body`)}
                  </p>
                  <div className="mt-4 border-t border-brand-border pt-4">
                    <p className={EYEBROW}>{t("actions.evidence")}</p>
                    <p className="mt-2 break-words text-[12.5px] font-medium text-text-dark-primary">
                      {change.query}
                    </p>
                    <p className="mt-1 break-all text-[11.5px] leading-[1.5] text-text-dark-secondary">
                      {change.page}
                    </p>
                    <p className="mt-2 text-[11.5px] leading-[1.5] text-text-dark-secondary">
                      {metricsLine(t, locale, change.current)}
                    </p>
                  </div>
                  <Link
                    data-action-link
                    href={localePath(locale, target.path)}
                    onClick={(event) => handoff(event, action, index)}
                    className="mt-5 inline-flex min-h-11 items-center justify-between gap-3 rounded-[9px] border border-brand-accent/30 bg-brand-accent-soft px-3.5 py-2.5 text-[13px] font-semibold text-brand-accent-text transition-colors hover:border-brand-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
                  >
                    {t(target.labelKey)}
                    <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />
                  </Link>
                </article>
              );
            })}
          </div>
        )}
        {handoffFailed ? (
          <p
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-[10px] border border-brand-warning/30 bg-brand-warning/[0.08] px-4 py-3 text-[13px] leading-[1.6] text-brand-warning"
          >
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {t("handoffError")}
          </p>
        ) : null}
      </section>

      <section
        aria-labelledby="daily-briefing-manual"
        data-result-section="manual"
        className={CARD}
      >
        <h3
          id="daily-briefing-manual"
          className="text-[18px] font-semibold tracking-[-0.02em] text-text-dark-primary"
        >
          {t("manual.title")}
        </h3>
        <p className="mt-2 max-w-3xl text-[13px] leading-[1.65] text-text-dark-secondary">
          {t("manual.body")}
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <ManualCheck
            title={t("manual.manualActions")}
            href="https://search.google.com/search-console/manual-actions"
            checked={manualChecked}
            onCheck={() => setManualChecked(true)}
          />
          <ManualCheck
            title={t("manual.securityIssues")}
            href="https://search.google.com/search-console/security-issues"
            checked={securityChecked}
            onCheck={() => setSecurityChecked(true)}
          />
        </div>
      </section>

      <section
        aria-labelledby="daily-briefing-evidence"
        data-result-section="evidence"
        className={CARD}
      >
        <h3
          id="daily-briefing-evidence"
          className="text-[18px] font-semibold tracking-[-0.02em] text-text-dark-primary"
        >
          {t("evidence.title")}
        </h3>
        <p className="mt-3 max-w-4xl text-[13px] leading-[1.65] text-text-dark-secondary">
          {t("evidence.thresholdSummary")}
        </p>
        <p className="mt-3 border-l-2 border-brand-accent pl-3 text-[13px] leading-[1.6] text-text-dark-secondary">
          {result.countComplete
            ? t("evidence.filteredComplete", {
                count: result.filteredObservedRows,
              })
            : t("evidence.filteredPartial", {
                count: result.filteredObservedRows,
              })}
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <EvidenceCard
            title={t("evidence.coverageTitle")}
            state={t(`evidenceStates.${currentCoverage.evidence}`)}
            body={
              currentCoverage.evidence === "observed" ||
              currentCoverage.evidence === "partial"
                ? t("evidence.coverageObserved", {
                    covered: currentCoverage.coveredQueries,
                    eligible: currentCoverage.eligibleQueries,
                    floor: percent(currentCoverage.minimumQueryPageCoverage),
                  })
                : t("evidence.coverageUnavailable")
            }
          />
          <EvidenceCard
            title={t("evidence.anonymizationTitle")}
            state={t(`evidenceStates.${currentAnonymization.evidence}`)}
            body={
              (currentAnonymization.evidence === "observed" ||
                currentAnonymization.evidence === "partial") &&
              currentAnonymization.missingImpressionShare !== null &&
              currentAnonymization.missingClickShare !== null
                ? t("evidence.anonymizationObserved", {
                    impressions: percent(
                      currentAnonymization.missingImpressionShare,
                    ),
                    clicks: percent(currentAnonymization.missingClickShare),
                  })
                : t("evidence.anonymizationUnavailable")
            }
          />
        </div>
      </section>

      <section
        aria-labelledby="daily-briefing-limits"
        data-result-section="limitations"
      >
        <h3
          id="daily-briefing-limits"
          className="text-[19px] font-semibold tracking-[-0.02em] text-text-dark-primary"
        >
          {t("limitations.title")}
        </h3>
        {result.limitations.length === 0 ? (
          <p className="mt-3 text-[13px] leading-[1.65] text-text-dark-secondary">
            {t("limitations.empty")}
          </p>
        ) : (
          <ul className="mt-4 grid gap-2 text-[13px] leading-[1.6] text-text-dark-secondary">
            {result.limitations.map((code) => (
              <li
                key={code}
                className="flex gap-3 rounded-[10px] border border-brand-border-card bg-brand-bg px-4 py-3"
              >
                <span
                  aria-hidden="true"
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-warning"
                />
                {t(`limitationCodes.${code}`)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="daily-briefing-method"
        data-result-section="methodology"
        className={CARD}
      >
        <h3
          id="daily-briefing-method"
          className="text-[18px] font-semibold tracking-[-0.02em] text-text-dark-primary"
        >
          {t("methodology.title")}
        </h3>
        <ul className="mt-4 grid gap-3 text-[12.5px] leading-[1.65] text-text-dark-secondary md:grid-cols-2">
          {[
            t("methodology.time"),
            t("methodology.position"),
            t("methodology.anonymization"),
            t("methodology.noPersistence"),
          ].map((item) => (
            <li key={item} className="border-l border-brand-border pl-3">
              {item}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function FactCard({
  icon,
  label,
  value,
  detail,
}: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
}) {
  return (
    <article className={CARD}>
      <div className="flex items-center gap-2 text-brand-accent">
        {icon}
        <p className={EYEBROW}>{label}</p>
      </div>
      <p className="mt-3 text-[14px] leading-[1.45] font-semibold text-text-dark-primary">
        {value}
      </p>
      {detail ? (
        <p className="mt-2 text-[11.5px] leading-[1.55] text-text-dark-secondary">
          {detail}
        </p>
      ) : null}
    </article>
  );
}

function KpiCard({
  metric,
  label,
  locale,
  day,
  weekly,
  dailyAvailable,
}: {
  readonly metric: MetricKey;
  readonly label: string;
  readonly locale: string;
  readonly day: DailyBriefingKpiComparison;
  readonly weekly: DailyBriefingKpiComparison;
  readonly dailyAvailable: boolean;
}) {
  const t = useTranslations("tools.dailyBriefing");
  const dayValue = dailyAvailable ? metricValue(locale, day, metric) : null;
  const dayDelta = dailyAvailable ? metricDelta(locale, day, metric) : null;
  const weekValue = metricValue(locale, weekly, metric);
  const weekDelta = metricDelta(locale, weekly, metric);

  return (
    <article data-kpi={metric} className={`${CARD} min-w-0`}>
      <p className={EYEBROW}>{label}</p>
      <div className="mt-4 space-y-4">
        {dailyAvailable ? (
          <MetricPeriod
            period="day"
            label={t("kpis.latestDay")}
            value={dayValue ?? t("kpis.unavailable")}
            delta={dayDelta}
          />
        ) : null}
        <MetricPeriod
          period="week"
          label={t("kpis.currentSevenDays")}
          value={weekValue ?? t("kpis.unavailable")}
          delta={weekDelta}
        />
      </div>
    </article>
  );
}

function MetricPeriod({
  period,
  label,
  value,
  delta,
}: {
  readonly period: "day" | "week";
  readonly label: string;
  readonly value: string;
  readonly delta: string | null;
}) {
  const t = useTranslations("tools.dailyBriefing");
  return (
    <div data-kpi-period={period}>
      <p className="text-[11.5px] text-text-dark-secondary">{label}</p>
      <div className="mt-1 flex min-w-0 items-baseline justify-between gap-2">
        <p className="truncate text-[22px] leading-none font-semibold tracking-[-0.03em] text-text-dark-primary">
          {value}
        </p>
        <p className="shrink-0 font-mono text-[10px] text-text-dark-secondary">
          {t("kpis.change", {
            delta: delta ?? t("kpis.unavailable"),
          })}
        </p>
      </div>
    </div>
  );
}

function EvidenceCard({
  title,
  state,
  body,
}: {
  readonly title: string;
  readonly state: string;
  readonly body: string;
}) {
  return (
    <article className="rounded-[10px] border border-brand-border-card bg-brand-panel px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[13px] font-semibold text-text-dark-primary">
          {title}
        </h4>
        <span className="font-mono text-[9.5px] tracking-[0.06em] text-brand-accent-text uppercase">
          {state}
        </span>
      </div>
      <p className="mt-2 text-[12px] leading-[1.6] text-text-dark-secondary">
        {body}
      </p>
    </article>
  );
}

function ManualCheck({
  title,
  href,
  checked,
  onCheck,
}: {
  readonly title: string;
  readonly href: string;
  readonly checked: boolean;
  readonly onCheck: () => void;
}) {
  const t = useTranslations("tools.dailyBriefing");
  return (
    <article className="rounded-[10px] border border-brand-border-card bg-brand-panel p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <h4 className="text-[14px] font-semibold text-text-dark-primary">
          {title}
        </h4>
        <a
          data-manual-link
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex min-h-9 items-center gap-1.5 text-[12px] text-brand-accent-text underline underline-offset-2"
        >
          {t("manual.open")}
          <ArrowUpRight aria-hidden="true" className="size-3.5" />
        </a>
      </div>
      <p className="mt-3 text-[12.5px] text-text-dark-secondary">
        {checked ? t("manual.checked") : t("manual.unconfirmed")}
      </p>
      {!checked ? (
        <button
          type="button"
          onClick={onCheck}
          className="mt-3 min-h-9 text-left text-[12px] font-medium text-text-dark-primary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
        >
          {t("manual.markChecked")}
        </button>
      ) : null}
    </article>
  );
}
