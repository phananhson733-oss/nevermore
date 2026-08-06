// @input  -- daily clicks/impressions series and the detector's fixed comparison windows
// @output -- dual-series time chart with crosshair hover and an equivalent data table
// @pos    -- the evidence surface of /[locale]/tools/traffic-drop-diagnosis
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { TrafficDailyPoint, TrafficWindow } from "@sf/public-tools";

/**
 * Calendar arithmetic, kept local on purpose.
 *
 * `@sf/public-tools` exports the same two helpers, but importing a VALUE from
 * it here would pull the whole engine index into the client bundle — and that
 * index reaches `node:net` through the source adapters, which fails the build
 * outright. The existing type-only import is erased at compile time, which is
 * why it was always fine.
 *
 * These are pure string-date functions with no dependencies; the engine-side
 * definitions in `series.ts` are the ones under test, and these must agree
 * with them.
 */
const MS_PER_DAY = 86_400_000;

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      MS_PER_DAY,
  );
}

/** Calendar span from the first VISIBLE day, matching the engine's report. */
function historySpanDays(series: readonly TrafficDailyPoint[]): number {
  const first = series.find((day) => day.impressions > 0)?.date;
  const last = series[series.length - 1]?.date;
  if (!first || !last) return 0;
  return daysBetween(first, last) + 1;
}

const VIEW_WIDTH = 900;
const VIEW_HEIGHT = 300;
const PAD_LEFT = 46;
const PAD_RIGHT = 54;
const PAD_TOP = 18;
const PAD_BOTTOM = 34;
const PLOT_WIDTH = VIEW_WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_HEIGHT = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM;

/**
 * Window tints follow the reading order of the report, not a rank.
 *
 * Kept at 5–6% so the band never competes with the two series drawn over it:
 * the highlight marks WHERE the comparison was cut, and the lines are what the
 * reader is meant to look at.
 */
const WINDOW_TINT: Record<TrafficWindow["id"], string> = {
  peak: "rgba(61, 220, 151, 0.06)",
  mid: "rgba(229, 200, 120, 0.055)",
  recent: "rgba(240, 144, 144, 0.06)",
};

/** The same three colours at 25%, dashed — an edge, not a frame. */
const WINDOW_EDGE: Record<TrafficWindow["id"], string> = {
  peak: "rgba(61, 220, 151, 0.25)",
  mid: "rgba(229, 200, 120, 0.25)",
  recent: "rgba(240, 144, 144, 0.25)",
};

const WINDOW_LABEL: Record<TrafficWindow["id"], string> = {
  peak: "var(--color-brand-accent)",
  mid: "var(--color-brand-warning)",
  recent: "var(--color-brand-error)",
};

/** GLOW_03 — the one data highlight this surface is allowed. */
const CLICK_AREA_FILL_ID = "traffic-drop-click-area";

interface TrafficDropChartProps {
  readonly series: readonly TrafficDailyPoint[];
  readonly windows: readonly TrafficWindow[];
  readonly locale: string;
}

/** A round-ish upper bound so the axis labels land on readable numbers. */
function axisMax(values: readonly number[]): number {
  const peak = Math.max(1, ...values);
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  return Math.ceil(peak / magnitude) * magnitude;
}

function formatCompact(value: number, locale: string): string {
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function TrafficDropChart({
  series,
  windows,
  locale,
}: TrafficDropChartProps) {
  const t = useTranslations("tools.trafficDrop");
  const [hovered, setHovered] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const clickMax = axisMax(series.map((day) => day.clicks));
    const impressionMax = axisMax(series.map((day) => day.impressions));
    // Positioned by DATE, not by array index.
    //
    // The engine treats a missing day as a real fact — windows are cut by
    // calendar date precisely because Search Console omits days a property
    // drew nothing. Plotting row N at N/(rows-1) undoes that on the one
    // surface the reader actually looks at: a site with 480 days of history
    // and 180 quiet ones had its silent stretches squeezed to nothing, so the
    // comparison-window highlights sat over the wrong part of the timeline and
    // changed width depending on how many rows happened to fall inside them.
    const firstDate = series[0]?.date ?? null;
    const lastDate = series[series.length - 1]?.date ?? null;
    const totalSpan =
      firstDate && lastDate ? daysBetween(firstDate, lastDate) : 0;
    const x = (index: number) => {
      const date = series[index]?.date;
      if (!firstDate || !date || totalSpan <= 0) return PAD_LEFT;
      return PAD_LEFT + (daysBetween(firstDate, date) / totalSpan) * PLOT_WIDTH;
    };
    return {
      clickMax,
      impressionMax,
      x,
      yClicks: (value: number) =>
        PAD_TOP + PLOT_HEIGHT - (value / clickMax) * PLOT_HEIGHT,
      yImpressions: (value: number) =>
        PAD_TOP + PLOT_HEIGHT - (value / impressionMax) * PLOT_HEIGHT,
      indexOf: (date: string) => series.findIndex((day) => day.date === date),
    };
  }, [series]);

  if (series.length === 0) return null;

  const { clickMax, impressionMax, x, yClicks, yImpressions, indexOf } =
    geometry;
  const clickLine = series
    .map((day, index) => `${x(index)},${yClicks(day.clicks)}`)
    .join(" ");
  const impressionLine = series
    .map((day, index) => `${x(index)},${yImpressions(day.impressions)}`)
    .join(" ");
  const hoveredDay = hovered === null ? null : series[hovered];
  const spanDays = historySpanDays(series);

  function handleMove(event: React.MouseEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const position =
      ((event.clientX - bounds.left) / bounds.width) * VIEW_WIDTH;
    // Nearest point along the same DATE scale the line is drawn on. Inverting
    // the old index scale here would put the crosshair on a different day than
    // the one under the cursor wherever the series has gaps.
    let nearest = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < series.length; index += 1) {
      const distance = Math.abs(x(index) - position);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = index;
      }
    }
    setHovered(nearest);
  }

  return (
    <figure className="m-0">
      <div className="relative">
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          className="block h-auto w-full"
          role="img"
          aria-label={t("chartAlt", {
            // The calendar span, matching the "history covered" line above the
            // chart. `series.length` is a row count, and quoting it here made
            // the screen-reader label contradict the visible text on any site
            // with gaps.
            days: spanDays,
            start: series[0]?.date ?? "",
            end: series[series.length - 1]?.date ?? "",
          })}
          onMouseMove={handleMove}
          onMouseLeave={() => setHovered(null)}
        >
          <defs>
            <linearGradient id={CLICK_AREA_FILL_ID} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#3DDC97" stopOpacity={0.16} />
              <stop offset="100%" stopColor="#3DDC97" stopOpacity={0} />
            </linearGradient>
          </defs>

          {windows.map((window) => {
            const from = indexOf(window.startDate);
            const to = indexOf(window.endDate);
            if (from < 0 || to < 0) return null;
            return (
              <g key={window.id}>
                <rect
                  x={x(from)}
                  y={PAD_TOP}
                  width={Math.max(1, x(to) - x(from))}
                  height={PLOT_HEIGHT}
                  fill={WINDOW_TINT[window.id]}
                  stroke={WINDOW_EDGE[window.id]}
                  strokeWidth={1}
                  strokeDasharray="4 4"
                />
                <text
                  x={(x(from) + x(to)) / 2}
                  y={PAD_TOP + 12}
                  textAnchor="middle"
                  fontFamily="var(--font-mono)"
                  fontSize={9.5}
                  letterSpacing="0.1em"
                  fill={WINDOW_LABEL[window.id]}
                >
                  {t(`windows.${window.id}.short`)}
                </text>
              </g>
            );
          })}

          {[0, 0.5, 1].map((step) => {
            const value = clickMax * step;
            return (
              <g key={step}>
                {/* Baseline is the axis (#1B2430); the rest are grid (#141C26). */}
                <line
                  x1={PAD_LEFT}
                  x2={VIEW_WIDTH - PAD_RIGHT}
                  y1={yClicks(value)}
                  y2={yClicks(value)}
                  stroke={
                    step === 0
                      ? "var(--color-brand-border)"
                      : "var(--color-brand-border-faint)"
                  }
                  strokeWidth={1}
                />
                <text
                  x={PAD_LEFT - 8}
                  y={yClicks(value) + 4}
                  textAnchor="end"
                  fontFamily="var(--font-mono)"
                  fontSize={9.5}
                  fill="var(--color-text-dark-secondary)"
                >
                  {formatCompact(value, locale)}
                </text>
                <text
                  x={VIEW_WIDTH - PAD_RIGHT + 8}
                  y={yImpressions(impressionMax * step) + 4}
                  fontFamily="var(--font-mono)"
                  fontSize={9.5}
                  fill="var(--color-brand-series-2)"
                  opacity={0.75}
                >
                  {formatCompact(impressionMax * step, locale)}
                </text>
              </g>
            );
          })}

          {/*
            Impressions are the SECOND series and are drawn dashed, not merely
            in a second colour: green and cyan are close enough under
            deuteranopia that colour alone cannot carry the distinction.
          */}
          <polyline
            points={impressionLine}
            fill="none"
            stroke="var(--color-brand-series-2)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            opacity={0.75}
          />
          <polygon
            points={`${x(0)},${yClicks(0)} ${clickLine} ${x(series.length - 1)},${yClicks(0)}`}
            fill={`url(#${CLICK_AREA_FILL_ID})`}
          />
          <polyline
            points={clickLine}
            fill="none"
            stroke="var(--color-brand-series-1)"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <circle
            cx={x(series.length - 1)}
            cy={yClicks(series[series.length - 1]?.clicks ?? 0)}
            r={7}
            fill="rgba(61, 220, 151, 0.16)"
          />
          <circle
            cx={x(series.length - 1)}
            cy={yClicks(series[series.length - 1]?.clicks ?? 0)}
            r={3.5}
            fill="var(--color-brand-series-1)"
          />

          {hovered !== null ? (
            <line
              x1={x(hovered)}
              x2={x(hovered)}
              y1={PAD_TOP}
              y2={PAD_TOP + PLOT_HEIGHT}
              stroke="var(--color-brand-accent)"
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.4}
            />
          ) : null}
        </svg>

        {hoveredDay && hovered !== null ? (
          <p
            className="pointer-events-none absolute top-1 whitespace-nowrap rounded-[8px] border border-brand-border-strong bg-brand-panel-raised px-3 py-1.5 font-mono text-[11px] tabular-nums text-text-dark-primary"
            aria-hidden="true"
            style={{
              left: `${(x(hovered) / VIEW_WIDTH) * 100}%`,
              // Flip to the left of the crosshair near the right edge so the
              // tooltip never runs off the plot.
              transform:
                x(hovered) / VIEW_WIDTH > 0.62
                  ? "translateX(calc(-100% - 12px))"
                  : "translateX(12px)",
            }}
          >
            {hoveredDay.date} · {t("clicks")} {hoveredDay.clicks} ·{" "}
            {t("impressions")} {hoveredDay.impressions.toLocaleString()}
          </p>
        ) : null}
      </div>

      {/*
        The legend states the LINE STYLE, not just the colour. A key that only
        names colours is unreadable to the readers the dashing is there for.
      */}
      <figcaption className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-text-dark-secondary">
        <span className="flex items-center gap-2 font-mono text-[10px] tracking-[0.1em] text-text-dark-secondary uppercase">
          <svg
            aria-hidden="true"
            width="18"
            height="6"
            viewBox="0 0 18 6"
            className="shrink-0"
          >
            <line
              x1="0"
              y1="3"
              x2="18"
              y2="3"
              stroke="var(--color-brand-series-1)"
              strokeWidth="2"
            />
          </svg>
          {t("clicks")}
        </span>
        <span className="flex items-center gap-2 font-mono text-[10px] tracking-[0.1em] text-text-dark-secondary uppercase">
          <svg
            aria-hidden="true"
            width="18"
            height="6"
            viewBox="0 0 18 6"
            className="shrink-0"
          >
            <line
              x1="0"
              y1="3"
              x2="18"
              y2="3"
              stroke="var(--color-brand-series-2)"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              opacity="0.75"
            />
          </svg>
          {t("impressionsRightAxis")}
        </span>
        <span>{t("windowsAreFixed")}</span>
      </figcaption>

      <details className="mt-3 rounded-card border border-brand-border-card bg-brand-panel px-[18px]">
        <summary className="cursor-pointer py-3 text-[12.5px] text-text-dark-secondary transition-colors hover:text-brand-accent-text">
          {t("viewAsTable")}
        </summary>
        <div className="max-h-72 overflow-auto pb-3">
          <table className="w-full font-mono text-[11.5px] tabular-nums">
            <thead>
              <tr className="text-left text-text-dark-secondary">
                <th className="py-1.5 pr-4 text-[10px] tracking-[0.1em] uppercase">
                  {t("date")}
                </th>
                <th className="py-1.5 pr-4 text-right text-[10px] tracking-[0.1em] uppercase">
                  {t("clicks")}
                </th>
                <th className="py-1.5 text-right text-[10px] tracking-[0.1em] uppercase">
                  {t("impressions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {series.map((day) => (
                <tr
                  key={day.date}
                  className="border-t border-brand-border-faint text-text-dark-secondary"
                >
                  <td className="py-1 pr-4">{day.date}</td>
                  <td className="py-1 pr-4 text-right text-text-dark-primary">
                    {day.clicks}
                  </td>
                  <td className="py-1 text-right">
                    {day.impressions.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
