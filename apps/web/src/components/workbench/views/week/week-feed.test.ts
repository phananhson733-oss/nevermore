import { describe, expect, it } from "vitest";
import { initialProjectState, type ProjectSeed } from "@/lib/workbench/store/reducer";
import { populatedProjectState } from "@/lib/workbench/store/test-fixtures";
import type { Artifact, AuditReport, VisSnapshot, WorkbenchProjectState } from "@/lib/workbench/types";
import { WEEK_WINDOW_DAYS, artifactsInWeek, inWeekWindow, weekFeed, weekWindow } from "./week-feed.ts";

/**
 * The week window (Q20, jsx W3/W5/W19; codex S7a #5 / #9). It is the local
 * calendar range the subtitle prints: from 00:00 on the date seven days before
 * today up to `now`, both ends in. Stamps have minute precision, so the edges
 * are pinned on stamps: the first minute of the first date is in and the minute
 * before it is out; the minute `now` falls in is in, a second later too, and the
 * next minute is out. A future stamp is outside every window.
 */

const SEED: ProjectSeed = { url: "https://example.test", brand: "Example", market: "US" };
const NOW = new Date(2026, 8, 13, 10, 30, 0);
const ONE_SECOND_LATER = new Date(2026, 8, 13, 10, 30, 1);
const FIRST_MINUTE = "2026-09-06 00:00";
const DAY_BEFORE = "2026-09-05 23:59";

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
  it("runs from the first minute of the date seven days back to now", () => {
    expect(WEEK_WINDOW_DAYS).toBe(7);
    expect(weekWindow(NOW)).toEqual({
      from: "2026-09-06",
      to: "2026-09-13",
      first: FIRST_MINUTE,
      last: "2026-09-13 10:30",
    });
  });

  it("crosses a month boundary", () => {
    expect(weekWindow(new Date(2026, 9, 3, 0, 5))).toMatchObject({ from: "2026-09-26", to: "2026-10-03" });
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

  // codex S7a #9: the subtitle printed 2026-09-07 while this artifact, 171 hours
  // old, fell outside a 168-hour window and the page said nothing had happened.
  it("counts every stamp on the subtitle's first date, however many hours back", () => {
    const now = new Date(2026, 8, 14, 12, 0);
    expect(weekWindow(now)).toMatchObject({ from: "2026-09-07", to: "2026-09-14" });
    expect(inWeekWindow("2026-09-07 09:00", weekWindow(now))).toBe(true);
  });

  // In America/Los_Angeles this span holds a fall-back hour (169 hours); in Asia/Shanghai it is 168.
  it("takes the first date by the calendar across a daylight-saving change", () => {
    const now = new Date(2026, 10, 3, 12, 0);
    expect(weekWindow(now)).toMatchObject({ from: "2026-10-27", to: "2026-11-03" });
    expect(inWeekWindow("2026-10-27 12:00", weekWindow(now))).toBe(true);
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

  it("lists a run once when the history holds one of the same kind and stamp", () => {
    const state = blank({
      auditHistory: [{ ...REPORT, at: "2026-09-12 10:00" }],
      lastAudit: { ...REPORT, at: "2026-09-12 10:00", score: 1 },
      visHistory: [{ ...SNAPSHOT, at: "2026-09-12 10:00" }],
    });
    expect(weekFeed(state, NOW)).toEqual([
      { kind: "audit", at: "2026-09-12 10:00", module: "audit", title: null },
      { kind: "visibility", at: "2026-09-12 10:00", module: "visibility", title: null },
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
