// @vitest-environment jsdom
// @input  -- deterministic GSC hourly and PT-date series, including gaps and delayed data
// @output -- latest available time windows with truthful totals and local hourly labels
// @pos    -- regression coverage for the Daily Briefing Search Console trend

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DailyBriefingTrend, DailyBriefingTrendPoint } from "@sf/public-tools";
import en from "../../i18n/messages/en.json";
import { DailyBriefingTrendChart } from "./daily-briefing-trend.tsx";

const HOUR_MS = 3_600_000;
const OriginalDateTimeFormat = Intl.DateTimeFormat;
let root: Root | null = null;
let browserTimeZone = "Asia/Shanghai";

function point(key: string, clicks = 1, impressions = 10): DailyBriefingTrendPoint {
  return { key, clicks, impressions, ctr: impressions === 0 ? null : clicks / impressions, position: impressions === 0 ? null : 2 };
}

function hourlyPoints(first: string, count: number): DailyBriefingTrendPoint[] {
  return Array.from({ length: count }, (_, index) =>
    point(new Date(Date.parse(first) + index * HOUR_MS).toISOString()),
  );
}

function series(points: readonly DailyBriefingTrendPoint[]) {
  return { evidence: "partial" as const, points, firstIncompleteDate: null, firstIncompleteHour: null };
}

async function renderTrend({
  hourly = [],
  daily = [],
  completedAt = "2026-08-31T06:45:00Z",
  hourlyEvidence = "partial",
}: {
  readonly hourly?: readonly DailyBriefingTrendPoint[];
  readonly daily?: readonly DailyBriefingTrendPoint[];
  readonly completedAt?: string;
  readonly hourlyEvidence?: DailyBriefingTrend["hourly"]["evidence"];
} = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <DailyBriefingTrendChart
          locale="en"
          completedAt={completedAt}
          trend={{ hourly: { ...series(hourly), evidence: hourlyEvidence }, daily: series(daily) }}
        />
      </NextIntlClientProvider>,
    );
  });
  return host;
}

function metric(host: HTMLElement, key: string): string | null {
  return host.querySelector(`[data-trend-metric="${key}"] strong`)?.textContent ?? null;
}

function rows(host: HTMLElement): HTMLTableRowElement[] {
  return [...host.querySelectorAll<HTMLTableRowElement>("[data-trend-table] tbody tr")];
}

function rowTimes(host: HTMLElement): number[] {
  return rows(host).map((row) => Date.parse(row.querySelector("time")?.dateTime ?? ""));
}

async function selectPeriod(host: HTMLElement, period: string) {
  await act(async () => {
    host.querySelector<HTMLButtonElement>(`[data-trend-period="${period}"]`)!.click();
  });
}

beforeEach(() => {
  browserTimeZone = "Asia/Shanghai";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // The browser's timezone is a user/environment fact; GSC's explicit PT
  // calendar formatter must continue to use PT independently of this setting.
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (locale, options) {
    return new OriginalDateTimeFormat(locale, {
      ...options,
      timeZone: options?.timeZone ?? browserTimeZone,
    });
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("latest available Search Console trend windows", () => {
  it("includes the eight hours lost by anchoring to run completion instead of returned data", async () => {
    // Synthetic hourly distribution preserves the reported screenshot totals;
    // these fixture rows are not a claimed production/API capture.
    const hourly = hourlyPoints("2026-08-29T23:00:00Z", 24).map((row, index) => {
      const clicks = index < 8 ? (index === 7 ? 38 : 40) : (index === 23 ? 86 : 82);
      const impressions = index < 8 ? (index === 7 ? 192 : 193) : (index === 23 ? 415 : 417);
      return point(row.key, clicks, impressions);
    });
    const host = await renderTrend({ hourly });

    expect(metric(host, "clicks")).toBe("1,634");
    expect(metric(host, "impressions")).toBe("8,213");
    expect(metric(host, "ctr")).toBe("19.9%");
    expect(rows(host)).toHaveLength(24);
    expect(rows(host).every((row) => !row.textContent?.includes("Unavailable"))).toBe(true);
    expect(rowTimes(host).at(0)).toBe(Date.parse("2026-08-29T23:00:00Z"));
    expect(rowTimes(host).at(-1)).toBe(Date.parse("2026-08-30T22:00:00Z"));
  });

  it("finds the latest eligible hour in unsorted rows and rejects future and invalid points", async () => {
    const hourly = hourlyPoints("2026-08-29T23:00:00Z", 24);
    const host = await renderTrend({
      hourly: [point("2026-09-01T12:00:00Z", 999), ...hourly.reverse(), point("not-an-hour", 888)],
    });

    expect(metric(host, "clicks")).toBe("24");
    expect(rowTimes(host).at(-1)).toBe(Date.parse("2026-08-30T22:00:00Z"));
    expect(rows(host)).toHaveLength(24);
  });

  it("keeps an internal missing hour empty and excludes the older twenty-fifth hour", async () => {
    const hourly = hourlyPoints("2026-08-29T22:00:00Z", 25).filter((_, index) => index !== 12);
    const host = await renderTrend({ hourly });
    const gap = rows(host)[11];
    const path = host.querySelector('[data-trend-chart] path[stroke="var(--gsc-clicks)"]')?.getAttribute("d");

    expect(metric(host, "clicks")).toBe("23");
    expect(rows(host)).toHaveLength(24);
    expect(rowTimes(host).at(0)).toBe(Date.parse("2026-08-29T23:00:00Z"));
    expect(gap?.querySelector("time")?.dateTime).toBe("2026-08-30T10:00:00.000Z");
    expect([...gap!.querySelectorAll("td")].slice(1).map((cell) => cell.textContent)).toEqual(Array(4).fill("Unavailable"));
    expect(path?.match(/M/g)).toHaveLength(2);
  });

  it("includes a returned zero-traffic latest hour without treating it as missing", async () => {
    const host = await renderTrend({ hourly: [point("2026-08-30T21:00:00Z", 3, 20), point("2026-08-30T22:00:00Z", 0, 0)] });

    expect(rowTimes(host).at(-1)).toBe(Date.parse("2026-08-30T22:00:00Z"));
    expect([...rows(host).at(-1)!.querySelectorAll("td")].slice(1).map((cell) => cell.textContent)).toEqual(["0", "0", "—", "—"]);
    expect(metric(host, "clicks")).toBe("3");
  });

  it.each([
    { name: "spring forward", first: "2026-03-07T12:00:00-08:00", completedAt: "2026-03-09T00:00:00Z", repeatedHour: false },
    { name: "fall back", first: "2026-10-31T12:00:00-07:00", completedAt: "2026-11-02T00:00:00Z", repeatedHour: true },
  ])("keeps 24 distinct elapsed hours across Pacific $name", async ({ first, completedAt, repeatedHour }) => {
    browserTimeZone = "America/Los_Angeles";
    const host = await renderTrend({ hourly: hourlyPoints(first, 24), completedAt });
    const times = rowTimes(host);
    const localHours = rows(host).map((row) => row.querySelector("td")?.textContent ?? "");

    expect(metric(host, "clicks")).toBe("24");
    expect(times).toHaveLength(24);
    expect(new Set(times).size).toBe(24);
    expect(times.at(-1)! - times[0]!).toBe(23 * HOUR_MS);
    if (repeatedHour) {
      expect(localHours.some((label) => label.includes("11/01/2026, 01:00 GMT-7"))).toBe(true);
      expect(localHours.some((label) => label.includes("11/01/2026, 01:00 GMT-8"))).toBe(true);
    } else {
      expect(localHours.some((label) => label.startsWith("03/08/2026, 02:00"))).toBe(false);
      expect(localHours.some((label) => label.startsWith("03/08/2026, 03:00 GMT-7"))).toBe(true);
    }
  });

  it("shows local dates and offsets in the hourly axis, range, tooltip and table", async () => {
    const host = await renderTrend({ hourly: hourlyPoints("2026-08-29T23:00:00Z", 24) });
    const chart = host.querySelector<SVGSVGElement>("[data-trend-chart]")!;
    const range = host.querySelector("[data-trend-window]")?.textContent;

    expect(chart.querySelector("text")?.textContent).toBe("08/30, 07:00");
    expect(range).toContain("08/30/2026, 07:00 GMT+8");
    expect(range).toContain("08/31/2026, 07:00 GMT+8");
    expect(range).toContain("Asia/Shanghai");
    expect(rows(host)[0]?.querySelector("td")?.textContent).toContain("08/30/2026, 07:00 GMT+8");
    expect(rows(host)[0]?.querySelector("td")?.textContent).toContain("08/30/2026, 08:00 GMT+8");
    vi.spyOn(chart, "getBoundingClientRect").mockReturnValue({ left: 0, width: 980 } as DOMRect);
    await act(async () => chart.dispatchEvent(new MouseEvent("mousemove", { clientX: 0, bubbles: true })));
    expect(host.querySelector("[data-trend-tooltip]")?.textContent).toContain("08/30/2026, 07:00 GMT+8");
  });

  it.each([{ period: "7d", count: 7 }, { period: "28d", count: 28 }, { period: "3m", count: 90 }])(
    "anchors $period to the latest returned PT date across month boundaries",
    async ({ period, count }) => {
      const daily = Array.from({ length: 91 }, (_, index) => point(new Date(Date.UTC(2026, 8, 1 - index)).toISOString().slice(0, 10)));
      const host = await renderTrend({ daily: [point("2026-09-05", 999), ...daily, point("bad-date", 888)], completedAt: "2026-09-04T16:00:00Z" });
      await selectPeriod(host, period);

      expect(metric(host, "clicks")).toBe(String(count));
      expect(rows(host)).toHaveLength(count);
      expect(rows(host).at(-1)?.querySelector("time")?.dateTime).toBe("2026-09-01");
      expect(rows(host)[0]?.querySelector("time")?.dateTime).toBe(new Date(Date.UTC(2026, 8, 2 - count)).toISOString().slice(0, 10));
      expect(host.querySelector("[data-trend-window]")?.textContent).toContain("Pacific Time / PT");
      expect(rows(host).at(-1)?.querySelector("td")?.textContent).toBe("2026-09-01 (PT)");
    },
  );

  it("uses the PT current day to reject a future daily row even when the local date is later", async () => {
    const host = await renderTrend({ daily: [point("2026-08-31", 999), point("2026-08-30", 2)], completedAt: "2026-08-31T06:45:00Z" });
    await selectPeriod(host, "7d");

    expect(metric(host, "clicks")).toBe("2");
    expect(rows(host).at(-1)?.querySelector("time")?.dateTime).toBe("2026-08-30");
  });

  it("keeps a missing PT day empty instead of pulling an older date into the seven-day total", async () => {
    const daily = Array.from({ length: 8 }, (_, index) => point(`2026-08-${23 + index}`))
      .filter((row) => row.key !== "2026-08-27");
    const host = await renderTrend({ daily });
    await selectPeriod(host, "7d");

    expect(metric(host, "clicks")).toBe("6");
    expect(rows(host)).toHaveLength(7);
    expect(rows(host)[0]?.querySelector("time")?.dateTime).toBe("2026-08-24");
    expect(rows(host)[3]?.querySelector("time")?.dateTime).toBe("2026-08-27");
    expect([...rows(host)[3]!.querySelectorAll("td")].slice(1).map((cell) => cell.textContent)).toEqual(Array(4).fill("Unavailable"));
  });

  it("does not accept date-only, impossible-date or non-hour keys as hourly observations", async () => {
    const host = await renderTrend({
      hourly: [point("2026-08-30"), point("2026-02-31T22:00:00Z"), point("2026-08-30T22:30:00Z")],
    });

    expect(metric(host, "clicks")).toBe("Unavailable");
    expect(host.querySelector("[data-trend-table]")).toBeNull();
  });

  it.each([
    { name: "empty", hourly: [] },
    { name: "only future", hourly: [point("2026-09-01T12:00:00Z")] },
    { name: "invalid completion time", hourly: [point("2026-08-30T22:00:00Z")], completedAt: "invalid" },
    { name: "unavailable even with stray rows", hourly: [point("2026-08-30T22:00:00Z")], hourlyEvidence: "unavailable" as const },
  ])("keeps $name data unavailable without a claimed window or table", async (input) => {
    const host = await renderTrend(input);

    expect(metric(host, "clicks")).toBe("Unavailable");
    expect(host.querySelector("[data-trend-chart]")).toBeNull();
    expect(host.querySelector("[data-trend-window]")).toBeNull();
    expect(host.querySelector("[data-trend-table]")).toBeNull();
  });
});
