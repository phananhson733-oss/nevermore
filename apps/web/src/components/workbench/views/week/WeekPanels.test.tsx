/** @vitest-environment jsdom */

/**
 * The page's date range and the panels under the cards (codex S7a #5 / #9 /
 * #11). The subtitle, the artifact count and the event feed share one boundary,
 * the feed lists every run the store still holds for the range, and the
 * answer-page step keeps the summary row's qualifier.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchProjectState } from "@/lib/workbench/types";
import {
  BLANK_WEEK,
  type RenderedWeek,
  type WeekLocale,
  artifact,
  renderWeek,
  report,
  result,
  text,
} from "./week-view-test-harness.tsx";

const NOW = new Date(2026, 8, 14, 12, 0, 0);

let rendered: RenderedWeek | null = null;

function show(state: WorkbenchProjectState, locale: WeekLocale = "en"): HTMLElement {
  rendered = renderWeek(state, { locale });
  return rendered.container;
}

function eventStamps(scope: ParentNode): readonly (string | null)[] {
  return [...scope.querySelectorAll("[data-wb-event] time")].map((time) => time.textContent);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  rendered?.unmount();
  rendered = null;
  vi.useRealTimers();
});

describe("the week's range", () => {
  // codex S7a #9: the page printed 2026-09-07 and 「本周新增 0 件产物」 for this artifact.
  it.each<[WeekLocale, string, string, string]>([
    ["zh-CN", "2026-09-07 至 2026-09-14", "本周新增 1 件产物", "1 条"],
    ["en", "2026-09-07 to 2026-09-14", "1 artifact added this week", "1 item"],
  ])("counts what the subtitle's first date holds (%s)", (locale, range, artifacts, count) => {
    const scope = show(
      { ...BLANK_WEEK, artifacts: [artifact("first-date", "2026-09-07 09:00", { title: "首日产物" })] },
      locale,
    );
    expect(scope.textContent).toContain(range);
    expect(text(scope, "[data-wb-summary='artifacts']")).toBe(artifacts);
    expect(text(scope, "[data-wb-week-feed] h2 + span")).toBe(count);
    expect(eventStamps(scope)).toEqual(["2026-09-07 09:00"]);
  });

  // codex S7a #5: two audits in the range, and the feed said 「1 条」.
  it("lists and counts both audits of the range, not only the latest", () => {
    const scope = show(
      {
        ...BLANK_WEEK,
        auditHistory: [report("2026-09-12 09:00", 50, [])],
        lastAudit: report("2026-09-13 09:00", 60, []),
      },
      "zh-CN",
    );
    expect(text(scope, "[data-wb-week-feed] h2 + span")).toBe("2 条");
    expect(eventStamps(scope)).toEqual(["2026-09-13 09:00", "2026-09-12 09:00"]);
  });
});

describe("the next steps", () => {
  // codex S7a #11: one platform did mention this prompt, so it is not "unmentioned".
  const ONE_PLATFORM_MISSED: WorkbenchProjectState = {
    ...BLANK_WEEK,
    lastVis: {
      at: "2026-09-13 11:00",
      results: [result("q", "ChatGPT", true), result("q", "Perplexity", false)],
    },
  };

  it.each<[WeekLocale, string]>([
    ["zh-CN", "给 1 个仍有平台没提到你的提问写答案页"],
    ["en", "Write answer pages for 1 prompt where at least one platform did not mention you"],
  ])("keep the summary row's qualifier on the answer-page step (%s)", (locale, sentence) => {
    const scope = show(ONE_PLATFORM_MISSED, locale);
    expect(text(scope, "[data-wb-step='answerGaps'] span")).toBe(sentence);
  });
});
