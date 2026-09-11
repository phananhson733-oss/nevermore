import { describe, expect, it } from "vitest";
import type { Artifact, AuditReport, DemoPayload, VisResult } from "../types.ts";
import { ARTIFACT_LIMIT, HISTORY_LIMIT } from "../types.ts";
import type { WorkbenchAction } from "./reducer.ts";
import { initialProjectState, normalizeInterrupted, reduce, withProjectSeed } from "./reducer.ts";

const seed = { url: "https://example.test", brand: "Example", market: "US" };

function report(at: string, score = 50): AuditReport {
  return {
    at, score, findings: [],
    crawl: { pages: 1, indexable: 1, blocked: 0, orphan: 0, lcp: "2.0", schema: 10, llmReadable: 50 },
    pageRows: [],
  };
}
function vis(p: string): VisResult {
  return { p, platform: "ChatGPT", hit: false, rank: null, brands: [], domains: [], real: false };
}
function artifact(id: string): Artifact {
  return { id, at: "2026-09-11 10:00", module: "audit", type: "md", engine: "seo", title: id, content: "x" };
}

const demoPayload: DemoPayload = {
  conns: { GSC: true, GA4: true }, gscRows: [], seeds: "a\nb", built: true, saved: [],
  audit: report("d"), auditHistory: [], lastAudit: report("d"),
  visResults: [vis("q")], visHistory: [], lastVis: { at: "d", results: [vis("q")] },
  compData: null, plans: {}, targets: null, kb: null, artifacts: [artifact("demo")], profileDoc: null,
};

describe("initialProjectState", () => {
  it("mirrors only url, brand and market from the real project", () => {
    const s = initialProjectState(seed);
    expect(s.profile).toEqual({ ...seed, positioning: "", features: "", competitors: "" });
    expect(s.audit).toBeNull();
    expect(s.artifacts).toEqual([]);
    expect(s.demo).toBe(false);
    expect(s.visPartial).toBe(false);
    expect(s.notify).toEqual({ weekly: true, drop: true, mention: false, gsc: true });
  });
});

describe("withProjectSeed", () => {
  it("re-applies the mirrored fields and leaves user edits and the rest of the state alone", () => {
    const stale = reduce(
      initialProjectState({ url: "https://old.test", brand: "Old", market: "JP" }),
      { type: "patchProfile", patch: { positioning: "mine" } },
    );
    const edited = reduce(stale, { type: "setSeeds", seeds: "kept" });
    const next = withProjectSeed(edited, seed);
    expect(next.profile).toEqual({ ...seed, positioning: "mine", features: "", competitors: "" });
    const { profile: _next, ...restNext } = next;
    const { profile: _edited, ...restEdited } = edited;
    expect(restNext).toEqual(restEdited);
  });
});

describe("audit transitions", () => {
  it("archives the previous report on complete and keeps history free of the current one", () => {
    let s = initialProjectState(seed);
    s = reduce(s, { type: "auditComplete", report: report("2026-09-01 10:00") });
    expect(s.auditHistory).toEqual([]);
    expect(s.lastAudit?.at).toBe("2026-09-01 10:00");
    s = reduce(s, { type: "auditStart" });
    expect(s.audit).toBeNull();
    expect(s.lastAudit?.at).toBe("2026-09-01 10:00");
    s = reduce(s, { type: "auditComplete", report: report("2026-09-08 10:00") });
    expect(s.auditHistory.map((r) => r.at)).toEqual(["2026-09-01 10:00"]);
    expect(s.audit?.at).toBe("2026-09-08 10:00");
  });

  it("does not archive the current report when the same object completes twice", () => {
    const same = report("2026-09-01 10:00");
    let s = reduce(initialProjectState(seed), { type: "auditComplete", report: same });
    s = reduce(s, { type: "auditComplete", report: same });
    expect(s.auditHistory).toEqual([]);
    expect(s.audit).toBe(s.lastAudit);
  });

  it("caps history at HISTORY_LIMIT, dropping the oldest", () => {
    let s = initialProjectState(seed);
    for (let i = 0; i < HISTORY_LIMIT + 3; i += 1) {
      s = reduce(s, { type: "auditComplete", report: report(`2026-01-${String(i + 1).padStart(2, "0")} 00:00`) });
    }
    expect(s.auditHistory).toHaveLength(HISTORY_LIMIT);
    expect(s.auditHistory[0]?.at).toBe("2026-01-03 00:00");
  });

  it("cancel restores the last report", () => {
    let s = reduce(initialProjectState(seed), { type: "auditComplete", report: report("a") });
    s = reduce(s, { type: "auditStart" });
    s = reduce(s, { type: "auditCancel" });
    expect(s.audit?.at).toBe("a");
  });

  it("cancel with no previous report leaves the audit empty", () => {
    let s = reduce(initialProjectState(seed), { type: "auditStart" });
    s = reduce(s, { type: "auditCancel" });
    expect(s.audit).toBeNull();
  });
});

describe("visibility transitions", () => {
  it("progress does not archive, complete does, and visPartial tracks the run", () => {
    let s = reduce(initialProjectState(seed), { type: "visComplete", results: [vis("q1")], at: "t1" });
    expect(s.visHistory).toEqual([]);
    expect(s.visPartial).toBe(false);
    s = reduce(s, { type: "visStart" });
    expect(s.visResults).toEqual([]);
    expect(s.visPartial).toBe(true);
    s = reduce(s, { type: "visProgress", results: [vis("q2")] });
    expect(s.visHistory).toEqual([]);
    expect(s.visPartial).toBe(true);
    expect(s.lastVis?.at).toBe("t1");
    s = reduce(s, { type: "visComplete", results: [vis("q2"), vis("q3")], at: "t2" });
    expect(s.visHistory.map((h) => h.at)).toEqual(["t1"]);
    expect(s.lastVis?.at).toBe("t2");
    expect(s.visResults).toHaveLength(2);
    expect(s.visPartial).toBe(false);
  });

  it("cancel restores the last snapshot or empties, and clears visPartial", () => {
    let s = reduce(initialProjectState(seed), { type: "visStart" });
    s = reduce(s, { type: "visProgress", results: [vis("x")] });
    const cancelled = reduce(s, { type: "visCancel" });
    expect(cancelled.visResults).toEqual([]);
    expect(cancelled.visPartial).toBe(false);
    s = reduce(s, { type: "visComplete", results: [vis("x")], at: "t" });
    s = reduce(s, { type: "visStart" });
    const restored = reduce(s, { type: "visCancel" });
    expect(restored.visResults).toEqual([vis("x")]);
    expect(restored.visPartial).toBe(false);
  });

  it("caps history at HISTORY_LIMIT, dropping the oldest", () => {
    let s = initialProjectState(seed);
    for (let i = 0; i < HISTORY_LIMIT + 3; i += 1) {
      s = reduce(s, { type: "visComplete", results: [vis(`q${i}`)], at: `t${i}` });
    }
    expect(s.visHistory).toHaveLength(HISTORY_LIMIT);
    expect(s.visHistory[0]?.at).toBe("t2");
  });
});

describe("saved keywords", () => {
  it("keeps addedAt and source for words already saved, but takes the rest from the incoming entry", () => {
    let s = reduce(initialProjectState(seed), {
      type: "setSaved",
      saved: [{ q: "a", addedAt: "t0", source: "manual", note: "old" }],
    });
    s = reduce(s, {
      type: "setSaved",
      saved: [{ q: "a", addedAt: "t9", source: "matrix", note: "edited" }, { q: "b", addedAt: "t1", source: "matrix" }],
    });
    expect(s.saved).toEqual([
      { q: "a", addedAt: "t0", source: "manual", note: "edited" },
      { q: "b", addedAt: "t1", source: "matrix" },
    ]);
  });

  it("collapses a word repeated in the incoming list to its first entry", () => {
    const s = reduce(initialProjectState(seed), {
      type: "setSaved",
      saved: [{ q: "a", addedAt: "t0", source: "manual" }, { q: "a", addedAt: "t1", source: "gap" }],
    });
    expect(s.saved).toEqual([{ q: "a", addedAt: "t0", source: "manual" }]);
  });
});

describe("artifacts", () => {
  it("prepends and caps at ARTIFACT_LIMIT", () => {
    let s = initialProjectState(seed);
    for (let i = 0; i < ARTIFACT_LIMIT + 2; i += 1) {
      s = reduce(s, { type: "addArtifact", artifact: artifact(`a${i}`) });
    }
    expect(s.artifacts).toHaveLength(ARTIFACT_LIMIT);
    expect(s.artifacts[0]?.id).toBe(`a${ARTIFACT_LIMIT + 1}`);
    expect(s.artifacts.at(-1)?.id).toBe("a2");
  });

  it("removes one and clears all", () => {
    let s = reduce(initialProjectState(seed), { type: "addArtifact", artifact: artifact("a") });
    s = reduce(s, { type: "addArtifact", artifact: artifact("b") });
    expect(reduce(s, { type: "removeArtifact", id: "a" }).artifacts.map((x) => x.id)).toEqual(["b"]);
    expect(reduce(s, { type: "clearArtifacts" }).artifacts).toEqual([]);
  });
});

describe("demo", () => {
  it("loadDemo writes the payload fields, flags demo, and never touches profile or notify", () => {
    let s = reduce(initialProjectState(seed), {
      type: "patchProfile", patch: { positioning: "mine" },
    });
    s = reduce(s, { type: "setNotify", notify: { weekly: false, drop: false, mention: false, gsc: false } });
    s = reduce(s, { type: "loadDemo", payload: demoPayload });
    expect(s.demo).toBe(true);
    expect(s.seeds).toBe("a\nb");
    expect(s.audit?.at).toBe("d");
    expect(s.profile.positioning).toBe("mine");
    expect(s.notify.weekly).toBe(false);
    expect(s.visPartial).toBe(false);
  });

  it("loadDemo applies the history and artifact caps", () => {
    const history = Array.from({ length: HISTORY_LIMIT + 1 }, (_, i) => report(`h${i}`));
    const snapshots = Array.from({ length: HISTORY_LIMIT + 1 }, (_, i) => ({ at: `v${i}`, results: [vis(`q${i}`)] }));
    const many = Array.from({ length: ARTIFACT_LIMIT + 1 }, (_, i) => artifact(`x${i}`));
    const s = reduce(initialProjectState(seed), {
      type: "loadDemo",
      payload: { ...demoPayload, auditHistory: history, visHistory: snapshots, artifacts: many },
    });
    expect(s.auditHistory).toHaveLength(HISTORY_LIMIT);
    expect(s.auditHistory[0]?.at).toBe("h1");
    expect(s.visHistory).toHaveLength(HISTORY_LIMIT);
    expect(s.visHistory[0]?.at).toBe("v1");
    expect(s.visHistory.at(-1)?.at).toBe(`v${HISTORY_LIMIT}`);
    expect(s.artifacts).toHaveLength(ARTIFACT_LIMIT);
    expect(s.artifacts[0]?.id).toBe("x0");
    expect(s.artifacts.at(-1)?.id).toBe(`x${ARTIFACT_LIMIT - 1}`);
  });

  it("clearDemo is symmetric to loadDemo and keeps profile edits and notify", () => {
    let s = reduce(initialProjectState(seed), { type: "patchProfile", patch: { features: "a, b" } });
    s = reduce(s, { type: "loadDemo", payload: demoPayload });
    s = reduce(s, { type: "clearDemo" });
    expect(s).toEqual({ ...initialProjectState(seed), profile: { ...initialProjectState(seed).profile, features: "a, b" } });
    expect(s.demo).toBe(false);
  });

  it("reset returns to the initial state for the same seed", () => {
    let s = reduce(initialProjectState(seed), { type: "loadDemo", payload: demoPayload });
    s = reduce(s, { type: "reset", seed });
    expect(s).toEqual(initialProjectState(seed));
  });

  it("loadPersisted replaces the whole state", () => {
    const other = { ...initialProjectState(seed), seeds: "persisted" };
    expect(reduce(initialProjectState(seed), { type: "loadPersisted", state: other })).toBe(other);
  });
});

describe("normalizeInterrupted", () => {
  it("restores the last audit and discards streamed partial visibility results", () => {
    let s = reduce(initialProjectState(seed), { type: "auditComplete", report: report("a") });
    s = reduce(s, { type: "visComplete", results: [vis("v")], at: "t" });
    s = reduce(s, { type: "auditStart" });
    s = reduce(s, { type: "visStart" });
    s = reduce(s, { type: "visProgress", results: [vis("half")] });
    const normalized = normalizeInterrupted(s);
    expect(normalized.audit?.at).toBe("a");
    expect(normalized.visResults).toEqual([vis("v")]);
    expect(normalized.visPartial).toBe(false);
  });

  it("keeps a completed run with zero results (not interrupted)", () => {
    let s = reduce(initialProjectState(seed), { type: "visComplete", results: [vis("v")], at: "t1" });
    s = reduce(s, { type: "visComplete", results: [], at: "t2" });
    expect(normalizeInterrupted(s)).toBe(s);
    expect(s.visResults).toEqual([]);
  });

  it("is the identity when nothing was interrupted", () => {
    const s = initialProjectState(seed);
    expect(normalizeInterrupted(s)).toBe(s);
  });
});

/** Recursively freezes plain objects and arrays, so any in-place write throws under ESM strict mode. */
function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value);
  const record: Record<string, unknown> = value as Record<string, unknown>;
  for (const key of Object.keys(record)) deepFreeze(record[key]);
}

describe("immutability", () => {
  it("never mutates the state it is given, for any action", () => {
    let populated = reduce(initialProjectState(seed), { type: "auditComplete", report: report("a") });
    populated = reduce(populated, { type: "visComplete", results: [vis("v")], at: "t" });
    populated = reduce(populated, { type: "addArtifact", artifact: artifact("a1") });
    populated = reduce(populated, { type: "setSaved", saved: [{ q: "k", addedAt: "t0", source: "manual" }] });
    populated = reduce(populated, {
      type: "setKb",
      kb: { at: "t", entries: [{ id: "k1", cat: "faq", statement: "s", evidence: "e", source: "src", from: "manual" }] },
    });
    deepFreeze(populated);
    const before = JSON.stringify(populated);

    const everyAction = [
      { type: "patchProfile", patch: { positioning: "p" } },
      { type: "setProfileDoc", doc: null },
      { type: "setConns", conns: { GSC: true, GA4: false } },
      { type: "setGscRows", rows: [] },
      { type: "setSeeds", seeds: "s" },
      { type: "setBuilt", built: true },
      { type: "setSaved", saved: [{ q: "k", addedAt: "t1", source: "gap" }] },
      { type: "setCompData", data: null },
      { type: "setPlans", plans: {} },
      { type: "setTargets", targets: [] },
      { type: "setKb", kb: null },
      { type: "setNotify", notify: { weekly: false, drop: false, mention: false, gsc: false } },
      { type: "auditStart" },
      { type: "auditComplete", report: report("z") },
      { type: "auditCancel" },
      { type: "visStart" },
      { type: "visProgress", results: [vis("p")] },
      { type: "visComplete", results: [vis("p")], at: "z" },
      { type: "visCancel" },
      { type: "addArtifact", artifact: artifact("z") },
      { type: "removeArtifact", id: "a1" },
      { type: "clearArtifacts" },
      { type: "loadDemo", payload: demoPayload },
      { type: "clearDemo" },
      { type: "loadPersisted", state: initialProjectState(seed) },
      { type: "reset", seed },
    ] as const satisfies readonly WorkbenchAction[];

    // Compile-time exhaustiveness: adding an action to the reducer without
    // adding it here makes `Exclude<…>` non-empty, and `AssertNever` then fails
    // to typecheck. A hand-counted `toBe(26)` only caught the omission if
    // whoever added the action also remembered to bump the number.
    type AssertNever<T extends never> = T;
    type _AllActionsCovered = AssertNever<Exclude<WorkbenchAction["type"], (typeof everyAction)[number]["type"]>>;
    // Runtime half: proves the list reached the loop below at all.
    expect(everyAction.length).toBeGreaterThan(0);

    for (const action of everyAction) {
      expect(() => reduce(populated, action), action.type).not.toThrow();
    }
    expect(JSON.stringify(populated)).toBe(before);
  });
});
