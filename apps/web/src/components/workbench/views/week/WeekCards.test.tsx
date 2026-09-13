/** @vitest-environment jsdom */

/**
 * The week cards' own dates and deltas (codex S7a #6 / #7). A card under the
 * page's date range names when its check ran and says so when that check is
 * older than the range, instead of letting an old score read as this week's;
 * a mention share printed as a band carries no point delta.
 */

import { getMessages } from "@sf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchProjectState } from "@/lib/workbench/types";
import {
  BLANK_WEEK,
  type RenderedWeek,
  type WeekLocale,
  gsc,
  hits,
  one,
  renderWeek,
  report,
  text,
} from "./week-view-test-harness.tsx";

const NOW = new Date(2026, 8, 14, 12, 0, 0);
const en = getMessages("en").workbench;
const zh = getMessages("zh-CN").workbench;

let rendered: RenderedWeek | null = null;

function show(state: WorkbenchProjectState, locale: WeekLocale = "en"): HTMLElement {
  rendered = renderWeek(state, { locale });
  return rendered.container;
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

const THIS_WEEK: WorkbenchProjectState = {
  ...BLANK_WEEK,
  lastAudit: report("2026-09-13 10:00", 56, []),
  lastVis: { at: "2026-09-13 11:00", results: hits(14, 40) },
};

// codex S7a #6's state: both checks ran on 2026-08-25, under a 2026-09-07 to 2026-09-14 range.
const OLD: WorkbenchProjectState = {
  ...BLANK_WEEK,
  lastAudit: report("2026-08-25 10:00", 80, []),
  auditHistory: [report("2026-08-24 10:00", 60, [])],
  lastVis: { at: "2026-08-25 11:00", results: hits(1, 2) },
};

describe("week cards: when their check ran", () => {
  it("print the latest check's stamp, and no range sentence when it is inside the range (en)", () => {
    const scope = show(THIS_WEEK);
    const health = one(scope, "[data-wb-week-card='health']");
    const mention = one(scope, "[data-wb-week-card='mention']");
    expect(text(health, "[data-wb-foot='at']")).toBe("Checked 2026-09-13 10:00");
    expect(text(mention, "[data-wb-foot='at']")).toBe("Checked 2026-09-13 11:00");
    expect(scope.querySelector("[data-wb-foot='stale']")).toBeNull();
  });

  it("say the range holds no newer check when the latest is older than it (zh)", () => {
    const scope = show(OLD, "zh-CN");
    expect(scope.textContent).toContain("2026-09-07 至 2026-09-14");
    const health = one(scope, "[data-wb-week-card='health']");
    expect(health.textContent?.startsWith(`80+20${zh.week.cards.health.label}`)).toBe(true);
    expect(text(health, "[data-wb-foot='at']")).toBe("检查于 2026-08-25 10:00");
    expect(text(health, "[data-wb-foot='stale']")).toBe("这段日期内没有新的检查");
    expect(text(health, "[data-wb-foot='since']")).toBe("较上次（2026-08-24 10:00）");
    const mention = one(scope, "[data-wb-week-card='mention']");
    expect(mention.textContent?.startsWith(`50%${zh.week.cards.mention.label}`)).toBe(true);
    expect(text(mention, "[data-wb-foot='at']")).toBe("检查于 2026-08-25 11:00");
    expect(text(mention, "[data-wb-foot='stale']")).toBe("这段日期内没有新的检查");
  });

  it("say the same in en", () => {
    const scope = show(OLD);
    expect(text(scope, "[data-wb-week-card='health'] [data-wb-foot='stale']")).toBe(
      "No new check in this date range",
    );
  });

  it("have no stamp and no range sentence when nothing was checked", () => {
    const scope = show({ ...BLANK_WEEK, gscRows: [gsc("a", 50)], gscRowsSource: "user" });
    expect(scope.querySelector("[data-wb-foot='at']")).toBeNull();
    expect(scope.querySelector("[data-wb-foot='stale']")).toBeNull();
  });
});

describe("week cards: a mention share printed as a band", () => {
  // codex S7a #7: two <1% shares used to draw "+1pt".
  it("names the earlier run but draws no point delta", () => {
    const scope = show({
      ...BLANK_WEEK,
      lastVis: { at: "2026-09-13 11:00", results: hits(2, 201) },
      visHistory: [{ at: "2026-09-08 11:00", results: hits(1, 201) }],
    });
    const card = one(scope, "[data-wb-week-card='mention']");
    expect(card.textContent?.startsWith(`<1%${en.week.cards.mention.label}`)).toBe(true);
    expect(card.textContent).not.toMatch(/[+\-−]\s*\d+\s*pt/u);
    expect(text(card, "[data-wb-foot='since']")).toBe("vs. the previous run (2026-09-08 11:00)");
  });
});

describe("week cards: borderline queries with some positions unknown", () => {
  // codex S7a #4: a known 5 and an unknown row printed "0" over "no queries in that range".
  it.each<[WeekLocale, string]>([
    ["zh-CN", "另有 1 条排名未知"],
    ["en", "1 more query has no known position"],
  ])("counts the known positions and names the unknown rows (%s)", (locale, sentence) => {
    const scope = show(
      { ...BLANK_WEEK, gscRows: [gsc("known", 5), gsc("unknown", null)], gscRowsSource: "user" },
      locale,
    );
    const card = one(scope, "[data-wb-week-card='borderline']");
    expect(card.textContent?.startsWith("0")).toBe(true);
    expect(text(card, "[data-wb-foot='unknownRows']")).toBe(sentence);
  });

  it("adds nothing when every position is known", () => {
    const scope = show({ ...BLANK_WEEK, gscRows: [gsc("a", 5), gsc("b", 12)], gscRowsSource: "user" });
    const card = one(scope, "[data-wb-week-card='borderline']");
    expect(card.textContent?.startsWith("1")).toBe(true);
    expect(card.querySelector("[data-wb-foot='unknownRows']")).toBeNull();
  });

  it("stays a dash with no footnote when no position is known", () => {
    const scope = show({ ...BLANK_WEEK, gscRows: [gsc("x", null), gsc("y", null)], gscRowsSource: "user" });
    const card = one(scope, "[data-wb-week-card='borderline']");
    expect(card.textContent?.startsWith("—")).toBe(true);
    expect(card.querySelector("[data-wb-foot]")).toBeNull();
  });
});
