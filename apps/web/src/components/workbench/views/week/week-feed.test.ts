import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatLocalStamp } from "@/lib/workbench/mock/time";
import { initialProjectState, reduce, type ProjectSeed } from "@/lib/workbench/store/reducer";
import { populatedProjectState } from "@/lib/workbench/store/test-fixtures";
import type { Artifact, AuditReport, VisSnapshot, WorkbenchProjectState } from "@/lib/workbench/types";
import { WEEK_WINDOW_DAYS, artifactsInWeek, inWeekWindow, rangePlacement, weekFeed, weekWindow } from "./week-feed.ts";

/**
 * The week window (Q20, jsx W3/W5/W19; codex S7a #5 / #9, S7r2 #6). It is the
 * local calendar range the subtitle prints, seven dates ending today: from 00:00
 * on the date six days before today up to `now`, both ends in. Stamps have minute precision, so the edges
 * are pinned on stamps: the first minute of the first date is in and the minute
 * before it is out; the minute `now` falls in is in, a second later too, and the
 * next minute is out. A future stamp is outside every window.
 */

const SEED: ProjectSeed = { url: "https://example.test", brand: "Example", market: "US" };
const NOW = new Date(2026, 8, 13, 10, 30, 0);
const ONE_SECOND_LATER = new Date(2026, 8, 13, 10, 30, 1);
const FIRST_MINUTE = "2026-09-07 00:00";
const DAY_BEFORE = "2026-09-06 23:59";

const POPULATED = populatedProjectState(SEED);

function must<T>(value: T | null): T {
  if (value === null) throw new Error("fixture is missing a value");
  return value;
}

const REPORT: AuditReport = must(POPULATED.lastAudit);
const SNAPSHOT: VisSnapshot = must(POPULATED.lastVis);

function artifact(id: string, at: string, overrides: Partial<Artifact> = {}): Artifact {
  return { ...must(POPULATED.artifacts[0] ?? null), id, at, ...overrides };
}

function blank(overrides: Partial<WorkbenchProjectState> = {}): WorkbenchProjectState {
  return { ...initialProjectState(SEED), ...overrides };
}

describe("weekWindow", () => {
  it("runs over seven dates, from the first minute of the date six days back to now", () => {
    expect(WEEK_WINDOW_DAYS).toBe(7);
    expect(weekWindow(NOW)).toEqual({
      from: "2026-09-07",
      to: "2026-09-13",
      first: FIRST_MINUTE,
      last: "2026-09-13 10:30",
      nowTime: NOW.getTime(),
    });
  });

  it("crosses a month boundary", () => {
    expect(weekWindow(new Date(2026, 9, 3, 0, 5))).toMatchObject({ from: "2026-09-27", to: "2026-10-03" });
  });
});

describe("inWeekWindow", () => {
  const range = weekWindow(NOW);

  it("keeps the first minute of the first date and drops the minute before it", () => {
    expect(inWeekWindow(FIRST_MINUTE, range)).toBe(true);
    expect(inWeekWindow(DAY_BEFORE, range)).toBe(false);
  });

  it("keeps the minute now falls in, a second later too, and drops the next minute", () => {
    expect(inWeekWindow("2026-09-13 10:30", weekWindow(ONE_SECOND_LATER))).toBe(true);
    expect(inWeekWindow("2026-09-13 10:31", weekWindow(ONE_SECOND_LATER))).toBe(false);
    expect(inWeekWindow("2026-09-14 09:00", range)).toBe(false);
  });

  // Each of these sorts between the two ends as a string; only parsing keeps it out.
  it.each(["2026-09-10 24:00", "2026-09-10 09:60", "2026-02-30 10:00", "2026-09-10 9:00", "2026-09-10 10:00 "])(
    "excludes %j, which does not parse",
    (stamp) => {
      expect(inWeekWindow(stamp, weekWindow(new Date(2026, 8, 13, 10, 30)))).toBe(false);
    },
  );

  it("excludes an ISO stamp", () => {
    expect(inWeekWindow("2026-09-12T10:00:00Z", range)).toBe(false);
  });

  // codex S7a #9: the subtitle printed a first date whose morning fell outside a
  // 168-hour window. codex S7r2 #6: and it printed eight dates under 「本周」;
  // the range is today and the six dates before it.
  it("keeps the whole sixth date back and nothing before it, on a Monday", () => {
    const monday = new Date(2026, 8, 14, 12, 0);
    expect(monday.getDay()).toBe(1);
    expect(weekWindow(monday)).toMatchObject({ from: "2026-09-08", to: "2026-09-14" });
    expect(inWeekWindow("2026-09-08 00:00", weekWindow(monday))).toBe(true);
    expect(inWeekWindow("2026-09-08 09:00", weekWindow(monday))).toBe(true);
    expect(inWeekWindow("2026-09-07 23:59", weekWindow(monday))).toBe(false);
  });

  // In America/Los_Angeles this span holds a fall-back hour (157 hours); in Asia/Shanghai it is 156.
  it("takes the first date by the calendar across a daylight-saving change", () => {
    const now = new Date(2026, 10, 3, 12, 0);
    expect(weekWindow(now)).toMatchObject({ from: "2026-10-28", to: "2026-11-03" });
    expect(inWeekWindow("2026-10-28 00:00", weekWindow(now))).toBe(true);
    expect(inWeekWindow("2026-10-27 23:59", weekWindow(now))).toBe(false);
  });
});

describe("artifactsInWeek", () => {
  it("keeps the artifacts stamped inside the window, in their order", () => {
    const artifacts = [
      artifact("now", "2026-09-13 10:30"),
      artifact("day-before", DAY_BEFORE),
      artifact("first-minute", FIRST_MINUTE),
      artifact("next-minute", "2026-09-13 10:31"),
      artifact("feb-30", "2026-02-30 10:00"),
    ];
    expect(artifactsInWeek(artifacts, weekWindow(ONE_SECOND_LATER)).map((a) => a.id)).toEqual(["now", "first-minute"]);
  });
});

describe("weekFeed", () => {
  const FULL = blank({
    lastAudit: { ...REPORT, at: "2026-09-12 10:00" },
    lastVis: { ...SNAPSHOT, at: "2026-09-12 11:00" },
    profileDoc: { ...must(POPULATED.profileDoc), at: "2026-09-09 09:00" },
    kb: { ...must(POPULATED.kb), at: "2026-09-10 16:00" },
    artifacts: [
      artifact("a1", "2026-09-11 14:00", { module: "keywordLibrary", title: "词库导出" }),
      artifact("a2", "2026-09-13 08:00", { module: "audit", title: "修复任务" }),
    ],
  });

  it("collects the four runs and every artifact, newest first", () => {
    expect(weekFeed(FULL, NOW)).toEqual([
      { kind: "artifact", at: "2026-09-13 08:00", module: "audit", title: "修复任务" },
      { kind: "visibility", at: "2026-09-12 11:00", module: "visibility", title: null },
      { kind: "audit", at: "2026-09-12 10:00", module: "audit", title: null },
      { kind: "artifact", at: "2026-09-11 14:00", module: "keywordLibrary", title: "词库导出" },
      { kind: "kb", at: "2026-09-10 16:00", module: "kb", title: null },
      { kind: "profile", at: "2026-09-09 09:00", module: "profile", title: null },
    ]);
  });

  it("is empty for a project that has nothing", () => {
    expect(weekFeed(blank(), NOW)).toEqual([]);
  });

  it("reads completed runs only: an audit in flight and streamed visibility results are not events", () => {
    const running = blank({
      audit: { ...REPORT, at: "2026-09-12 10:00" },
      visResults: SNAPSHOT.results,
      visPartial: true,
    });
    expect(weekFeed(running, NOW)).toEqual([]);
  });

  // codex S7a #5: two audits this week, and the feed listed only the latest
  // while the health card quoted the other one as "the previous run".
  it("lists every archived run still in the window, newest first", () => {
    const state = blank({
      auditHistory: [{ ...REPORT, at: "2026-08-01 10:00" }, { ...REPORT, at: "2026-09-12 09:00" }],
      lastAudit: { ...REPORT, at: "2026-09-13 09:00" },
      visHistory: [{ ...SNAPSHOT, at: "2026-09-11 11:00" }],
      lastVis: { ...SNAPSHOT, at: "2026-09-12 11:00" },
    });
    expect(weekFeed(state, NOW)).toEqual([
      { kind: "audit", at: "2026-09-13 09:00", module: "audit", title: null },
      { kind: "visibility", at: "2026-09-12 11:00", module: "visibility", title: null },
      { kind: "audit", at: "2026-09-12 09:00", module: "audit", title: null },
      { kind: "visibility", at: "2026-09-11 11:00", module: "visibility", title: null },
    ]);
  });

  // codex S7r2 #4: four different runs finished in one minute, and the feed
  // said two. A stamp has minute precision; it is not a run's identity.
  it("lists every run of one minute, however many there were", () => {
    const row = must(REPORT.pageRows[0] ?? null);
    const asked = must(SNAPSHOT.results[0] ?? null);
    const state = blank({
      auditHistory: [{ ...REPORT, at: "2026-09-12 10:00", pageRows: [{ ...row, url: "/a" }] }],
      lastAudit: { ...REPORT, at: "2026-09-12 10:00", pageRows: [{ ...row, url: "/b" }] },
      visHistory: [{ at: "2026-09-12 10:00", results: [{ ...asked, p: "Q" }] }],
      lastVis: { at: "2026-09-12 10:00", results: [{ ...asked, p: "R" }] },
    });
    expect(weekFeed(state, NOW)).toEqual([
      { kind: "audit", at: "2026-09-12 10:00", module: "audit", title: null },
      { kind: "audit", at: "2026-09-12 10:00", module: "audit", title: null },
      { kind: "visibility", at: "2026-09-12 10:00", module: "visibility", title: null },
      { kind: "visibility", at: "2026-09-12 10:00", module: "visibility", title: null },
    ]);
  });

  // The reducer puts one report object in both places when a report completes,
  // another completes after it, and the first is dispatched again: that is one
  // run held twice, not two.
  it("lists a report once when the reducer holds the same object as latest and archived", () => {
    const early = { ...REPORT, at: "2026-09-12 09:00" };
    const late = { ...REPORT, at: "2026-09-12 10:00" };
    const state = [early, late, early].reduce(
      (current, report) => reduce(current, { type: "auditComplete", report }),
      blank(),
    );
    expect(state.lastAudit).toBe(early);
    expect(state.auditHistory).toContain(early);
    expect(weekFeed(state, NOW)).toEqual([
      { kind: "audit", at: "2026-09-12 10:00", module: "audit", title: null },
      { kind: "audit", at: "2026-09-12 09:00", module: "audit", title: null },
    ]);
  });

  it("applies the same edges to runs as to artifacts, and moves them at midnight", () => {
    const state = blank({
      auditHistory: [{ ...REPORT, at: DAY_BEFORE }],
      lastAudit: { ...REPORT, at: FIRST_MINUTE },
      lastVis: { ...SNAPSHOT, at: "2026-09-13 10:31" },
      kb: { ...must(POPULATED.kb), at: DAY_BEFORE },
    });
    expect(weekFeed(state, ONE_SECOND_LATER).map((event) => event.kind)).toEqual(["audit"]);
    expect(weekFeed(state, new Date(2026, 8, 14, 0, 0)).map((event) => event.kind)).toEqual(["visibility"]);
  });

  it("keeps runs ahead of artifacts when they share a minute", () => {
    const state = blank({
      lastAudit: { ...REPORT, at: "2026-09-12 10:00" },
      artifacts: [artifact("a1", "2026-09-12 10:00")],
    });
    expect(weekFeed(state, NOW).map((event) => event.kind)).toEqual(["audit", "artifact"]);
  });

  it("does not change the state it reads", () => {
    const frozen = structuredClone(FULL);
    weekFeed(FULL, NOW);
    expect(FULL).toEqual(frozen);
  });
});

describe("rangePlacement", () => {
  it("places ordinary stamps the way the counts do", () => {
    const range = weekWindow(new Date(2026, 8, 14, 12, 0, 30));
    expect(rangePlacement("2026-09-08 00:00", range)).toBe("inside");
    expect(rangePlacement("2026-09-07 23:59", range)).toBe("outside");
    expect(rangePlacement("2026-09-14 12:00", range)).toBe("inside");
    expect(rangePlacement("2026-09-14 12:01", range)).toBe("outside");
    expect(rangePlacement("2026-02-30 10:00", range)).toBe("unknown");
  });

  // codex S8r3: a stamp carries no offset, so next to a daylight-saving change
  // it can name no instant or two. The zone is pinned for this block with
  // `vi.stubEnv`, whichever TZ the run was started in. Vitest's default `forks`
  // pool (this config sets no other) never runs two files at once in one
  // process, and `vi.unstubAllEnvs` puts the zone back after each test.
  describe("in America/Los_Angeles, across a daylight-saving change", () => {
    beforeEach(() => {
      vi.stubEnv("TZ", "America/Los_Angeles");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("runs in the zone it pins", () => {
      expect(new Date(2026, 2, 8, 2, 30).getHours()).toBe(3);
      expect(new Date(2026, 10, 1, 12, 0).getTimezoneOffset()).toBe(480);
    });

    // 02:00-02:59 on 2026-03-08 never happens there; `Date` reads 02:30 as 03:30.
    it("cannot place a stamp the spring-forward gap skips, though the counts keep it", () => {
      const range = weekWindow(new Date(2026, 2, 8, 3, 0));
      expect(inWeekWindow("2026-03-08 02:30", range)).toBe(true);
      expect(rangePlacement("2026-03-08 02:30", range)).toBe("unknown");
      expect(rangePlacement("2026-03-08 01:30", range)).toBe("inside");
      expect(rangePlacement("2026-03-08 03:00", range)).toBe("inside");
      expect(rangePlacement("2026-03-08 03:01", range)).toBe("outside");
    });

    // 01:00-01:59 on 2026-11-01 happens twice there, first in PDT and then in PST.
    it("cannot place a stamp in the repeated hour when its two readings fall on either side of now", () => {
      const firstPass = new Date(2026, 10, 1, 1, 30);
      const now = new Date(firstPass.getTime() + 45 * 60_000);
      expect(formatLocalStamp(now)).toBe("2026-11-01 01:15");
      const range = weekWindow(now);
      expect(rangePlacement("2026-11-01 01:30", range)).toBe("unknown");
      expect(rangePlacement("2026-11-01 01:10", range)).toBe("inside");
      expect(rangePlacement("2026-11-01 00:59", range)).toBe("inside");
      expect(rangePlacement("2026-11-01 02:00", range)).toBe("outside");
    });
  });
});
