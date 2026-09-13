import { describe, expect, it } from "vitest";
import { initialProjectState, type ProjectSeed } from "@/lib/workbench/store/reducer";
import { populatedProjectState } from "@/lib/workbench/store/test-fixtures";
import type { Artifact, AuditReport, VisSnapshot, WorkbenchProjectState } from "@/lib/workbench/types";
import { WEEK_WINDOW_DAYS, artifactsWithinDays, weekFeed } from "./week-feed.ts";

/**
 * The seven-day window (Q20, jsx W3/W5/W19). The edges are pinned with the
 * clock, not the stamp: stamps have minute precision, so "exactly seven days"
 * is `now` on the minute and "seven days and a second" is the same stamp read
 * one second later. A future stamp is outside every window.
 */

const SEED: ProjectSeed = { url: "https://example.test", brand: "Example", market: "US" };
const NOW = new Date(2026, 8, 13, 10, 30, 0);
const ONE_SECOND_LATER = new Date(2026, 8, 13, 10, 30, 1);
const SEVEN_DAYS = "2026-09-06 10:30";

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

describe("artifactsWithinDays", () => {
  it("is a seven-day window", () => {
    expect(WEEK_WINDOW_DAYS).toBe(7);
  });

  it("keeps an artifact exactly seven days old", () => {
    const kept = artifactsWithinDays([artifact("a", SEVEN_DAYS)], WEEK_WINDOW_DAYS, NOW);
    expect(kept.map((a) => a.id)).toEqual(["a"]);
  });

  it("drops the same artifact one second later", () => {
    expect(artifactsWithinDays([artifact("a", SEVEN_DAYS)], WEEK_WINDOW_DAYS, ONE_SECOND_LATER)).toEqual([]);
  });

  it("keeps one made this very minute", () => {
    const kept = artifactsWithinDays([artifact("a", "2026-09-13 10:30")], WEEK_WINDOW_DAYS, ONE_SECOND_LATER);
    expect(kept.map((a) => a.id)).toEqual(["a"]);
  });

  it("excludes a stamp in the future and one that does not parse", () => {
    const artifacts = [
      artifact("next-minute", "2026-09-13 10:31"),
      artifact("tomorrow", "2026-09-14 09:00"),
      artifact("feb-30", "2026-02-30 10:00"),
      artifact("iso", "2026-09-12T10:00:00Z"),
    ];
    expect(artifactsWithinDays(artifacts, WEEK_WINDOW_DAYS, NOW)).toEqual([]);
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

  it("applies the same edges to runs as to artifacts", () => {
    const state = blank({
      lastAudit: { ...REPORT, at: SEVEN_DAYS },
      lastVis: { ...SNAPSHOT, at: "2026-09-13 10:31" },
      kb: { ...must(POPULATED.kb), at: "2026-09-06 10:29" },
    });
    expect(weekFeed(state, NOW).map((event) => event.kind)).toEqual(["audit"]);
    expect(weekFeed(state, ONE_SECOND_LATER)).toEqual([]);
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
