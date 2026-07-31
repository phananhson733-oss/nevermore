// @input  -- daily clicks/impressions series and the detector's fixed comparison windows
// @output -- dual-series time chart with crosshair hover and an equivalent data table
// @pos    -- the evidence surface of /[locale]/tools/traffic-drop-diagnosis
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { TrafficDailyPoint, TrafficWindow } from "@sf/public-tools";

const VIEW_WIDTH = 900;
const VIEW_HEIGHT = 300;
const PAD_LEFT = 46;
const PAD_RIGHT = 54;
const PAD_TOP = 18;
const PAD_BOTTOM = 34;
const PLOT_WIDTH = VIEW_WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_HEIGHT = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM;

/** Window tints follow the reading order of the report, not a rank. */
const WINDOW_TINT: Record<TrafficWindow["id"], string> = {
  peak: "rgba(91, 185, 140, 0.07)",
  mid: "rgba(212, 168, 67, 0.07)",
  recent: "rgba(217, 87, 87, 0.08)",
};

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
    const x = (index: number) =>
      series.length <= 1
        ? PAD_LEFT
        : PAD_LEFT + (index / (series.length - 1)) * PLOT_WIDTH;
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

  function handleMove(event: React.MouseEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const position =
      ((event.clientX - bounds.left) / bounds.width) * VIEW_WIDTH;
    const ratio = (position - PAD_LEFT) / PLOT_WIDTH;
    const index = Math.round(ratio * (series.length - 1));
    setHovered(Math.max(0, Math.min(series.length - 1, index)));
  }

  return (
    <figure className="m-0">
      <div className="relative">
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          className="block h-auto w-full"
          role="img"
          aria-label={t("chartAlt", {
            days: series.length,
            start: series[0]?.date ?? "",
            end: series[series.length - 1]?.date ?? "",
          })}
          onMouseMove={handleMove}
          onMouseLeave={() => setHovered(null)}
        >
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
                />
                <text
                  x={(x(from) + x(to)) / 2}
                  y={PAD_TOP + 12}
                  textAnchor="middle"
                  fontSize={10.5}
                  fontWeight={700}
                  fill="var(--color-text-dark-secondary)"
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
                <line
                  x1={PAD_LEFT}
                  x2={VIEW_WIDTH - PAD_RIGHT}
                  y1={yClicks(value)}
                  y2={yClicks(value)}
                  stroke="var(--color-brand-border)"
                  strokeWidth={1}
                />
                <text
                  x={PAD_LEFT - 8}
                  y={yClicks(value) + 4}
                  textAnchor="end"
                  fontSize={10}
                  fill="var(--color-text-dark-secondary)"
                >
                  {formatCompact(value, locale)}
                </text>
                <text
                  x={VIEW_WIDTH - PAD_RIGHT + 8}
                  y={yImpressions(impressionMax * step) + 4}
                  fontSize={10}
                  fill="var(--color-brand-series-2)"
                >
                  {formatCompact(impressionMax * step, locale)}
                </text>
              </g>
            );
          })}

          <polyline
            points={impressionLine}
            fill="none"
            stroke="var(--color-brand-series-2)"
            strokeWidth={1.6}
            opacity={0.65}
          />
          <polygon
            points={`${x(0)},${yClicks(0)} ${clickLine} ${x(series.length - 1)},${yClicks(0)}`}
            fill="rgba(200, 100, 68, 0.12)"
          />
          <polyline
            points={clickLine}
            fill="none"
            stroke="var(--color-brand-series-1)"
            strokeWidth={2.2}
            strokeLinejoin="round"
          />
          <circle
            cx={x(series.length - 1)}
            cy={yClicks(series[series.length - 1]?.clicks ?? 0)}
            r={4}
            fill="var(--color-brand-series-1)"
          />

          {hovered !== null ? (
            <line
              x1={x(hovered)}
              x2={x(hovered)}
              y1={PAD_TOP}
              y2={PAD_TOP + PLOT_HEIGHT}
              stroke="var(--color-text-dark-secondary)"
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.6}
            />
          ) : null}
        </svg>

        {hoveredDay && hovered !== null ? (
          <p
            className="pointer-events-none absolute top-1 whitespace-nowrap rounded-lg border border-brand-border bg-brand-bg-alt px-3 py-1.5 text-[12px] tabular-nums text-text-dark-primary shadow-lg"
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

      <figcaption className="mt-2 flex flex-wrap gap-4 text-[12px] text-text-dark-secondary">
        <span className="flex items-center gap-1.5">
          <i
            aria-hidden="true"
            className="inline-block h-[3px] w-3.5 rounded-sm bg-brand-series-1"
          />
          {t("clicks")}
        </span>
        <span className="flex items-center gap-1.5">
          <i
            aria-hidden="true"
            className="inline-block h-[3px] w-3.5 rounded-sm bg-brand-series-2"
          />
          {t("impressionsRightAxis")}
        </span>
        <span>{t("windowsAreFixed")}</span>
      </figcaption>

      <details className="mt-3 rounded-xl border border-brand-border/70 bg-brand-bg-alt/25 px-4">
        <summary className="cursor-pointer py-2.5 text-[12.5px] text-text-dark-secondary">
          {t("viewAsTable")}
        </summary>
        <div className="max-h-72 overflow-auto pb-3">
          <table className="w-full text-[12.5px] tabular-nums">
            <thead>
              <tr className="text-left text-text-dark-secondary">
                <th className="py-1.5 pr-4 font-medium">{t("date")}</th>
                <th className="py-1.5 pr-4 text-right font-medium">
                  {t("clicks")}
                </th>
                <th className="py-1.5 text-right font-medium">
                  {t("impressions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {series.map((day) => (
                <tr key={day.date} className="border-t border-brand-border/40">
                  <td className="py-1 pr-4">{day.date}</td>
                  <td className="py-1 pr-4 text-right">{day.clicks}</td>
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
