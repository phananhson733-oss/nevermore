// @input  -- fresh Daily Briefing points, run completion time, and locale
// @output -- the default-24h Search Console-style trend chart and metric toggles
// @pos    -- visual-only evidence; it never changes Daily Briefing actions

"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

import type {
  DailyBriefingTrend,
  DailyBriefingTrendPoint,
} from "@sf/public-tools";

type MetricKey = "clicks" | "impressions" | "ctr" | "position";
type TrendPeriod = "24h" | "7d" | "28d" | "3m";

interface TrendBucket {
  readonly key: string;
  readonly point: DailyBriefingTrendPoint | null;
}

const METRICS: readonly MetricKey[] = [
  "clicks",
  "impressions",
  "ctr",
  "position",
];

const PERIODS: readonly { readonly id: TrendPeriod; readonly points: number }[] = [
  { id: "24h", points: 24 },
  { id: "7d", points: 7 },
  { id: "28d", points: 28 },
  { id: "3m", points: 90 },
];

const METRIC_STYLE: Readonly<
  Record<MetricKey, { readonly color: string; readonly dash?: string }>
> = {
  // These are dedicated GSC visualization tokens. The same token paints the
  // large KPI tile and its corresponding line, while dash patterns remain the
  // secondary encoding.
  clicks: { color: "var(--gsc-clicks)" },
  impressions: { color: "var(--gsc-impressions)", dash: "8 4" },
  ctr: { color: "var(--gsc-ctr)", dash: "3 4" },
  position: { color: "var(--gsc-position)", dash: "12 4" },
};

const VIEW_WIDTH = 980;
const VIEW_HEIGHT = 330;
const PAD_LEFT = 14;
const PAD_RIGHT = 14;
const PAD_TOP = 18;
const PAD_BOTTOM = 38;
const PLOT_WIDTH = VIEW_WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_HEIGHT = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM;
const HOUR_MS = 60 * 60 * 1_000;
const PACIFIC_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
// The server cannot know the browser timezone. A stable server snapshot keeps
// hydration consistent; React then reads the browser's timezone on the client.
const subscribeToTimeZone = () => () => undefined;
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverTimeZone = () => "UTC";

function number(locale: string, value: number): string {
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
    maximumFractionDigits: 1,
  }).format(value);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function metricValue(point: DailyBriefingTrendPoint, metric: MetricKey): number | null {
  switch (metric) {
    case "clicks":
      return point.clicks;
    case "impressions":
      return point.impressions;
    case "ctr":
      return point.ctr;
    case "position":
      // Above zero, or nothing. The GSC reader coerces a missing or
      // non-numeric position to 0 (search-analytics.ts, `toNumber`), and this
      // chart draws smaller positions higher — a bucket whose position was
      // never returned would plot above every measured one and print as 0.0.
      return point.position !== null && point.position > 0
        ? point.position
        : null;
  }
}

function formatMetric(locale: string, metric: MetricKey, value: number | null): string {
  if (value === null) return "—";
  if (metric === "ctr") return percent(value);
  if (metric === "position") return value.toFixed(1);
  return number(locale, value);
}

function aggregate(points: readonly DailyBriefingTrendPoint[]) {
  const clicks = points.reduce((total, point) => total + point.clicks, 0);
  const impressions = points.reduce(
    (total, point) => total + point.impressions,
    0,
  );
  // One bucket with traffic and no measured position makes the period's
  // average unavailable, not approximate.
  //
  // Dividing by the full total let such a bucket contribute nothing to the
  // numerator and its whole weight to the denominator, pulling the average
  // below every point it summarised. Dropping it instead averages a subset and
  // calls the result the period's average, which hides an unknown weight that
  // can change both the size of a move and its direction. Clicks, impressions
  // and CTR are complete either way, so only the position fails closed.
  let weightedPosition = 0;
  let positionUnavailable = false;
  for (const point of points) {
    if (point.impressions === 0) continue;
    if (point.position === null || !(point.position > 0)) {
      positionUnavailable = true;
      continue;
    }
    weightedPosition += point.position * point.impressions;
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : null,
    position:
      positionUnavailable || impressions === 0
        ? null
        : weightedPosition / impressions,
  } as const;
}

function isDateKey(key: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(key)
    && Number.isFinite(Date.parse(key))
    && new Date(key).toISOString().slice(0, 10) === key;
}

function parseHourKey(key: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):00:00(?:\.000)?(?:Z|[+-]\d{2}:\d{2})?$/i.test(key)
    || !isDateKey(key.slice(0, 10))) return null;
  const hasZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(key);
  const parsed = Date.parse(hasZone ? key : `${key}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function shiftDate(date: string, days: number): string {
  const instant = new Date(`${date}T00:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

function bucketsForPeriod(
  period: TrendPeriod,
  points: readonly DailyBriefingTrendPoint[],
  completedAt: string,
): readonly TrendBucket[] {
  const count = PERIODS.find((candidate) => candidate.id === period)?.points ?? 24;
  const completed = Date.parse(completedAt);
  if (!Number.isFinite(completed)) return [];

  if (period !== "24h") {
    const latestAllowedDate = PACIFIC_DATE.format(completed);
    const pointByKey = new Map(points
      .filter((point) => isDateKey(point.key) && point.key <= latestAllowedDate)
      .map((point) => [point.key, point]));
    const endDate = [...pointByKey.keys()].sort().at(-1);
    if (endDate === undefined) return [];
    return Array.from({ length: count }, (_, index) => {
      const key = shiftDate(endDate, index - (count - 1));
      return { key, point: pointByKey.get(key) ?? null };
    });
  }

  const pointByHour = new Map<number, DailyBriefingTrendPoint>();
  for (const point of points) {
    const timestamp = parseHourKey(point.key);
    if (timestamp !== null && timestamp <= completed) pointByHour.set(timestamp, point);
  }
  if (pointByHour.size === 0) return [];
  // GSC can lag the run by several hours. Anchor to its latest returned hour,
  // then keep 24 elapsed hours (including internal gaps), not 24 returned rows.
  const endHour = Math.max(...pointByHour.keys());
  return Array.from({ length: count }, (_, index) => {
    const timestamp = endHour + (index - (count - 1)) * HOUR_MS;
    const point = pointByHour.get(timestamp) ?? null;
    return {
      key: point?.key ?? new Date(timestamp).toISOString(),
      point,
    };
  });
}

function chartPath(
  buckets: readonly TrendBucket[],
  metric: MetricKey,
): string {
  const values = buckets
    .map((bucket) =>
      bucket.point === null ? null : metricValue(bucket.point, metric),
    )
    .filter((value): value is number => value !== null);
  if (values.length === 0) return "";

  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum;
  let continuous = false;
  let path = "";

  for (let index = 0; index < buckets.length; index += 1) {
    const bucket = buckets[index];
    const value =
      bucket?.point === null || bucket?.point === undefined
        ? null
        : metricValue(bucket.point, metric);
    if (bucket === undefined || value === null) {
      continuous = false;
      continue;
    }
    const x =
      buckets.length <= 1
        ? PAD_LEFT + PLOT_WIDTH / 2
        : PAD_LEFT + (index / (buckets.length - 1)) * PLOT_WIDTH;
    // Lower numeric average position is better, so it intentionally rises.
    const normalized =
      range === 0
        ? 0.5
        : metric === "position"
          ? (maximum - value) / range
          : (value - minimum) / range;
    const y = PAD_TOP + PLOT_HEIGHT - normalized * PLOT_HEIGHT;
    path += `${continuous ? " L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    continuous = true;
  }
  return path;
}

function tickIndexes(length: number): readonly number[] {
  if (length <= 1) return [0];
  const count = Math.min(5, length);
  return Array.from({ length: count }, (_, index) =>
    Math.round((index / (count - 1)) * (length - 1)),
  );
}

export function DailyBriefingTrendChart({
  locale,
  trend,
  completedAt,
}: {
  readonly locale: string;
  readonly trend: DailyBriefingTrend;
  readonly completedAt: string;
}) {
  const t = useTranslations("tools.dailyBriefing");
  const timeZone = useSyncExternalStore(subscribeToTimeZone, browserTimeZone, serverTimeZone);
  const [period, setPeriod] = useState<TrendPeriod>("24h");
  const [visible, setVisible] = useState<ReadonlySet<MetricKey>>(
    () => new Set(METRICS),
  );
  const [hovered, setHovered] = useState<number | null>(null);
  const series = period === "24h" ? trend.hourly : trend.daily;
  const buckets = series.evidence === "unavailable"
    ? []
    : bucketsForPeriod(period, series.points, completedAt);
  const points = buckets.flatMap((bucket) =>
    bucket.point === null ? [] : [bucket.point],
  );
  const hasPoints = points.length > 0;
  const hasGaps = buckets.some((bucket) => bucket.point === null);
  const totals = aggregate(points);
  const ticks = tickIndexes(buckets.length);
  const activeBucket = buckets[hovered ?? -1] ?? null;
  const localHour = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  });
  const localHourTick = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const firstBucket = buckets[0];
  const lastBucket = buckets.at(-1);
  const windowLabel = firstBucket === undefined || lastBucket === undefined
    ? null
    : period === "24h"
      ? t("trend.hourlyWindow", {
          start: localHour.format(parseHourKey(firstBucket.key)!),
          end: localHour.format(parseHourKey(lastBucket.key)! + HOUR_MS),
          timezone: timeZone,
        })
      : t("trend.dailyWindow", { start: firstBucket.key, end: lastBucket.key });

  function bucketLabel(key: string, compact = false): string {
    if (period !== "24h") return compact ? key.slice(5) : `${key} (PT)`;
    const timestamp = parseHourKey(key);
    if (timestamp === null) return "—";
    return compact
      ? localHourTick.format(timestamp)
      : `${localHour.format(timestamp)} – ${localHour.format(timestamp + HOUR_MS)}`;
  }

  function toggleMetric(metric: MetricKey) {
    setVisible((current) => {
      if (current.has(metric) && current.size === 1) return current;
      const next = new Set(current);
      if (next.has(metric)) next.delete(metric);
      else next.add(metric);
      return next;
    });
  }

  function handlePointerMove(event: React.MouseEvent<SVGSVGElement>) {
    if (buckets.length === 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    setHovered(Math.round(ratio * Math.max(0, buckets.length - 1)));
  }

  return (
    <section data-result-section="trend" aria-labelledby="daily-briefing-trend">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-[10px] tracking-[0.12em] text-brand-accent-text uppercase">
            {t("trend.eyebrow")}
          </p>
          <h3
            id="daily-briefing-trend"
            className="mt-1 text-[19px] font-semibold tracking-[-0.02em] text-text-dark-primary"
          >
            {t("trend.title")}
          </h3>
        </div>
        <div className="inline-flex w-full overflow-hidden rounded-[10px] border border-brand-border-strong bg-brand-bg md:w-auto" role="group" aria-label={t("trend.periodLabel")}>
          {PERIODS.map((candidate) => {
            const selected = candidate.id === period;
            return (
              <button
                key={candidate.id}
                type="button"
                data-trend-period={candidate.id}
                aria-pressed={selected}
                onClick={() => {
                  setPeriod(candidate.id);
                  setHovered(null);
                }}
                className={`min-h-10 flex-1 border-r border-brand-border-strong px-3 font-mono text-[11px] font-semibold transition-colors last:border-r-0 md:flex-none ${
                  selected
                    ? "bg-brand-accent/15 text-brand-accent-text"
                    : "text-text-dark-secondary hover:bg-brand-panel-raised hover:text-text-dark-primary"
                }`}
              >
                {t(`trend.periods.${candidate.id}`)}
              </button>
            );
          })}
        </div>
      </div>

      {windowLabel !== null ? (
        <p data-trend-window className="mt-3 text-[11px] leading-[1.55] text-text-dark-secondary">
          {windowLabel}
        </p>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label={t("trend.metricsLabel")}>
        {METRICS.map((metric) => {
          const active = visible.has(metric);
          const color = METRIC_STYLE[metric].color;
          return (
            <button
              key={metric}
              type="button"
              data-trend-metric={metric}
              aria-pressed={active}
              onClick={() => toggleMetric(metric)}
              className="min-h-[118px] rounded-[12px] border p-4 text-left transition-[filter,transform] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:cursor-default"
              style={{
                borderColor: `color-mix(in oklab, ${color} 52%, var(--sc-border-card))`,
                background: `linear-gradient(145deg, color-mix(in oklab, ${color} 26%, var(--sc-panel-raised)), color-mix(in oklab, ${color} 10%, var(--sc-panel)))`,
                opacity: active ? 1 : 0.48,
              }}
            >
              <span className="flex items-center gap-2 font-mono text-[10px] tracking-[0.1em] text-text-dark-primary uppercase">
                <span className="inline-flex size-4 items-center justify-center rounded-[4px] border border-current text-[10px] leading-none">
                  {active ? "✓" : ""}
                </span>
                {t(`trend.metrics.${metric}`)}
              </span>
              <strong className="mt-4 block text-[29px] leading-none font-semibold tracking-[-0.04em] text-text-dark-primary tabular-nums">
                {!hasPoints || series.evidence === "unavailable"
                  ? t("trend.unavailable")
                  : formatMetric(locale, metric, totals[metric])}
              </strong>
            </button>
          );
        })}
      </div>

      <div className="mt-3 rounded-[12px] border border-brand-border-card bg-brand-panel p-3 md:p-4">
        {series.evidence === "unavailable" || !hasPoints ? (
          <p className="flex min-h-56 items-center justify-center text-center text-[13px] leading-[1.6] text-text-dark-secondary">
            {series.evidence === "unavailable"
              ? period === "24h"
                ? t("trend.hourlyUnavailable")
                : t("trend.dailyUnavailable")
              : period === "24h"
                ? t("trend.hourlyNoData")
                : t("trend.dailyNoData")}
          </p>
        ) : (
          <div className="relative">
            <svg
              data-trend-chart
              viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
              className="block h-auto min-h-56 w-full"
              role="img"
              aria-label={t("trend.chartLabel", {
                period: t(`trend.periods.${period}`),
                points: points.length,
              })}
              onMouseMove={handlePointerMove}
              onMouseLeave={() => setHovered(null)}
            >
              {[0, 0.5, 1].map((step) => (
                <line
                  key={step}
                  x1={PAD_LEFT}
                  x2={VIEW_WIDTH - PAD_RIGHT}
                  y1={PAD_TOP + PLOT_HEIGHT - step * PLOT_HEIGHT}
                  y2={PAD_TOP + PLOT_HEIGHT - step * PLOT_HEIGHT}
                  stroke={step === 0 ? "var(--sc-border)" : "var(--sc-border-faint)"}
                  strokeWidth="1"
                />
              ))}
              {METRICS.filter((metric) => visible.has(metric)).map((metric) => (
                <path
                  key={metric}
                  d={chartPath(buckets, metric)}
                  fill="none"
                  stroke={METRIC_STYLE[metric].color}
                  strokeWidth={metric === "clicks" ? 2.5 : 2}
                  strokeDasharray={METRIC_STYLE[metric].dash}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {hovered !== null && buckets.length > 0 ? (
                <line
                  x1={
                    buckets.length <= 1
                      ? PAD_LEFT + PLOT_WIDTH / 2
                      : PAD_LEFT + (hovered / (buckets.length - 1)) * PLOT_WIDTH
                  }
                  x2={
                    buckets.length <= 1
                      ? PAD_LEFT + PLOT_WIDTH / 2
                      : PAD_LEFT + (hovered / (buckets.length - 1)) * PLOT_WIDTH
                  }
                  y1={PAD_TOP}
                  y2={PAD_TOP + PLOT_HEIGHT}
                  stroke="var(--sc-text-secondary)"
                  strokeDasharray="3 4"
                  opacity="0.7"
                />
              ) : null}
              {ticks.map((index) => {
                const bucket = buckets[index];
                if (bucket === undefined) return null;
                const x =
                  buckets.length <= 1
                    ? PAD_LEFT + PLOT_WIDTH / 2
                    : PAD_LEFT + (index / (buckets.length - 1)) * PLOT_WIDTH;
                return (
                  <text
                    key={`${bucket.key}-${index}`}
                    x={x}
                    y={VIEW_HEIGHT - 14}
                    textAnchor={index === 0 ? "start" : index === buckets.length - 1 ? "end" : "middle"}
                    fill="var(--sc-text-secondary)"
                    fontFamily="var(--font-mono)"
                    fontSize="10"
                  >
                    {bucketLabel(bucket.key, true)}
                  </text>
                );
              })}
            </svg>
            {activeBucket !== null ? (
              <div data-trend-tooltip className="pointer-events-none absolute left-3 top-3 rounded-[8px] border border-brand-border-strong bg-brand-panel-raised px-3 py-2 font-mono text-[11px] text-text-dark-primary shadow-panel">
                <p className="mb-1 text-text-dark-secondary">
                  <time dateTime={activeBucket.key}>{bucketLabel(activeBucket.key)}</time>
                </p>
                {METRICS.filter((metric) => visible.has(metric)).map((metric) => (
                  <p key={metric} className="tabular-nums">
                    {t(`trend.metrics.${metric}`)} · {formatMetric(
                      locale,
                      metric,
                      activeBucket.point === null
                        ? null
                        : metricValue(activeBucket.point, metric),
                    )}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        )}
        <p className="mt-2 text-[11px] leading-[1.55] text-text-dark-secondary">
          {t("trend.scaleNote")}
        </p>
        {series.evidence === "partial" ? (
          <p className="mt-2 text-[11px] leading-[1.55] text-brand-warning">
            {period === "24h" ? t("trend.hourlyPartial") : t("trend.dailyPartial")}
          </p>
        ) : null}
        {hasPoints && hasGaps ? (
          <p className="mt-2 text-[11px] leading-[1.55] text-text-dark-secondary">
            {t("trend.windowIncomplete")}
          </p>
        ) : null}
        {hasPoints ? (
          <details
            data-trend-table
            className="mt-3 rounded-[10px] border border-brand-border-card bg-brand-bg px-4"
          >
            <summary className="cursor-pointer py-3 text-[12px] font-medium text-text-dark-secondary transition-colors hover:text-brand-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent">
              {t("trend.viewAsTable")}
            </summary>
            <div className="max-h-80 overflow-auto pb-3">
              <table className="w-full min-w-[620px] font-mono text-[11px] tabular-nums">
                <caption className="sr-only">
                  {t("trend.chartLabel", {
                    period: t(`trend.periods.${period}`),
                    points: points.length,
                  })}
                </caption>
                <thead>
                  <tr className="text-left text-text-dark-secondary">
                    <th className="py-1.5 pr-4 text-[10px] tracking-[0.1em] uppercase">
                      {t("trend.bucket")}
                    </th>
                    {METRICS.map((metric) => (
                      <th
                        key={metric}
                        className="py-1.5 pr-4 text-right text-[10px] tracking-[0.1em] uppercase last:pr-0"
                      >
                        {t(`trend.metrics.${metric}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {buckets.map((bucket) => (
                    <tr
                      key={bucket.key}
                      className="border-t border-brand-border-faint text-text-dark-secondary"
                    >
                      <td className="py-1.5 pr-4 whitespace-nowrap">
                        <time dateTime={bucket.key}>{bucketLabel(bucket.key)}</time>
                      </td>
                      {METRICS.map((metric) => (
                        <td
                          key={metric}
                          className="py-1.5 pr-4 text-right text-text-dark-primary last:pr-0"
                        >
                          {bucket.point === null
                            ? t("trend.unavailable")
                            : formatMetric(
                                locale,
                                metric,
                                metricValue(bucket.point, metric),
                              )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}
