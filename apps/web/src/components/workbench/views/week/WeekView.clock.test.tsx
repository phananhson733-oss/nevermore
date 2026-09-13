/** @vitest-environment jsdom */

/**
 * Week audit #2: the week page's clock keeps up with the wall clock. A tab left
 * open past midnight kept yesterday's seven dates, so an artifact from the first
 * of them was still counted and still listed. The subtitle, the count and the
 * feed read one clock, so all three move together.
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOW_STAMP_REFRESH_MS } from "../../hooks/useNowStamp.ts";
import {
  BLANK_WEEK,
  type RenderedWeek,
  type WeekLocale,
  artifact,
  renderWeek,
  text,
} from "./week-view-test-harness.tsx";

const BEFORE_MIDNIGHT = new Date(2026, 8, 14, 23, 59, 0);
const STATE = {
  ...BLANK_WEEK,
  artifacts: [artifact("first-date", "2026-09-08 10:00", { title: "首日产物" })],
};

let rendered: RenderedWeek | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(BEFORE_MIDNIGHT);
});

afterEach(() => {
  rendered?.unmount();
  rendered = null;
  vi.useRealTimers();
});

function eventStamps(scope: ParentNode): readonly (string | null)[] {
  return [...scope.querySelectorAll("[data-wb-event] time")].map((time) => time.textContent);
}

describe("the week page past midnight", () => {
  it.each<[WeekLocale, string, string, string, string, string]>([
    [
      "zh-CN",
      "2026-09-08 至 2026-09-14",
      "近 7 天新增 1 件产物",
      "2026-09-09 至 2026-09-15",
      "近 7 天新增 0 件产物",
      "近 7 天暂无事件记录",
    ],
    [
      "en",
      "2026-09-08 to 2026-09-14",
      "1 artifact added in the last 7 days",
      "2026-09-09 to 2026-09-15",
      "0 artifacts added in the last 7 days",
      "No recorded events in the last 7 days",
    ],
  ])("moves the seven dates on without a reload (%s)", (locale, rangeBefore, countBefore, rangeAfter, countAfter, feedEmpty) => {
    rendered = renderWeek(STATE, { locale });
    const scope = rendered.container;
    expect(scope.textContent).toContain(rangeBefore);
    expect(text(scope, "[data-wb-summary='artifacts']")).toBe(countBefore);
    expect(eventStamps(scope)).toEqual(["2026-09-08 10:00"]);

    act(() => {
      vi.advanceTimersByTime(2 * NOW_STAMP_REFRESH_MS);
    });

    expect(scope.textContent).toContain(rangeAfter);
    expect(scope.textContent).not.toContain(rangeBefore);
    expect(text(scope, "[data-wb-summary='artifacts']")).toBe(countAfter);
    expect(eventStamps(scope)).toEqual([]);
    expect(text(scope, "[data-wb-week-feed] p")).toBe(feedEmpty);
  });
});
