import { describe, expect, it } from "vitest";
import type { Artifact, AuditReport, DemoPayload, VisResult, WorkbenchProjectState } from "../types.ts";
import {
  ARTIFACT_CONTENT_MAX,
  ARTIFACT_LIMIT,
  ARTIFACT_TITLE_MAX,
  HISTORY_LIMIT,
} from "../types.ts";
import { demoFields, type DemoFields } from "./demo-fields.ts";
import { PERSISTED_VERSION, parsePersistedState } from "./schema.ts";
import type { WorkbenchAction } from "./reducer.ts";
import { DEFAULT_NOTIFY, initialProjectState, normalizeInterrupted, reduce, withProjectSeed } from "./reducer.ts";
import { clearDemoOver, loadDemoOver, otherThan, populatedProjectState } from "./test-fixtures.ts";

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
    expect(s.gscRowsSource).toBeNull();
    // DEFAULT_NOTIFY is exported for the settings page; its literal is pinned here.
    expect(s.notify).toEqual(DEFAULT_NOTIFY);
    expect(DEFAULT_NOTIFY).toEqual({ weekly: true, drop: true, mention: false, gsc: true });
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

  it("resolves a word repeated in `previous` to its first copy, and the merged result has no duplicate q", () => {
    let s = reduce(initialProjectState(seed), {
      type: "loadPersisted",
      state: {
        ...initialProjectState(seed),
        saved: [
          { q: "a", addedAt: "t0", source: "manual" },
          { q: "a", addedAt: "t1", source: "gap" },
        ],
      },
    });
    s = reduce(s, {
      type: "setSaved",
      saved: [{ q: "a", addedAt: "t9", source: "matrix" }],
    });
    expect(s.saved).toEqual([{ q: "a", addedAt: "t0", source: "manual" }]);
    expect(s.saved.filter((k) => k.q === "a")).toHaveLength(1);
  });
});

describe("artifacts", () => {
  it("prepends, and refuses an artifact once the basket is full instead of evicting the oldest", () => {
    let s = initialProjectState(seed);
    for (let i = 0; i < ARTIFACT_LIMIT; i += 1) {
      s = reduce(s, { type: "addArtifact", artifact: artifact(`a${i}`) });
    }
    expect(s.artifacts).toHaveLength(ARTIFACT_LIMIT);
    expect(s.artifacts[0]?.id).toBe(`a${ARTIFACT_LIMIT - 1}`);

    const full = s;
    const after = reduce(full, { type: "addArtifact", artifact: artifact("late") });

    // The same object back, so no new reducer state is produced, and every
    // earlier artifact is still there — the oldest included.
    expect(after).toBe(full);
    expect(after.artifacts.map((a) => a.id)).not.toContain("late");
    expect(after.artifacts.at(-1)?.id).toBe("a0");
  });

  it("ignores an artifact whose id is already in the basket, wherever it sits: same state back, one copy", () => {
    // A save retried after its answer could not be read back (useAddArtifact)
    // dispatches the same id again. Not at the head, so a check that only looks
    // at the newest entry would still let a second copy in.
    let s = reduce(initialProjectState(seed), { type: "addArtifact", artifact: artifact("a") });
    s = reduce(s, { type: "addArtifact", artifact: artifact("b") });

    const again = reduce(s, { type: "addArtifact", artifact: { ...artifact("a"), content: "another" } });

    expect(again).toBe(s);
    expect(again.artifacts.map((x) => x.id)).toEqual(["b", "a"]);
    expect(again.artifacts[1]?.content).toBe("x");
  });

  it("clamps an oversized artifact to the persisted bounds instead of storing it whole", () => {
    // The schema rejects any stored envelope over these bounds, and a rejected
    // envelope resets the project on the next load, so the reducer must cut a
    // producer down on the way in; parsing what it stored must then succeed.
    const oversized: Artifact = {
      ...artifact("big"),
      title: "t".repeat(ARTIFACT_TITLE_MAX + 1),
      content: "c".repeat(ARTIFACT_CONTENT_MAX + 1),
      filename: "../escape/../report.csv",
    };
    const s = reduce(initialProjectState(seed), { type: "addArtifact", artifact: oversized });

    const stored = s.artifacts[0];
    expect(stored?.title).toHaveLength(ARTIFACT_TITLE_MAX);
    expect(stored?.content).toHaveLength(ARTIFACT_CONTENT_MAX);
    expect(stored?.filename).toBeUndefined();
    expect(parsePersistedState({ v: PERSISTED_VERSION, state: s })).toEqual(s);
  });

  it("keeps a filename that is a bare short file name", () => {
    const s = reduce(initialProjectState(seed), {
      type: "addArtifact",
      artifact: { ...artifact("named"), filename: "Keyword library (2026-09).csv" },
    });

    expect(s.artifacts[0]?.filename).toBe("Keyword library (2026-09).csv");
  });

  it("applies the same bounds to a demo payload", () => {
    const s = loadDemoOver(initialProjectState(seed), {
      ...demoPayload,
      artifacts: [{ ...artifact("demo"), content: "c".repeat(ARTIFACT_CONTENT_MAX + 5) }],
    });

    expect(s.artifacts[0]?.content).toHaveLength(ARTIFACT_CONTENT_MAX);
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
    s = loadDemoOver(s, demoPayload);
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
    const s = loadDemoOver(initialProjectState(seed), {
      ...demoPayload, auditHistory: history, visHistory: snapshots, artifacts: many,
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
    s = loadDemoOver(s, demoPayload);
    s = clearDemoOver(s);
    expect(s).toEqual({ ...initialProjectState(seed), profile: { ...initialProjectState(seed).profile, features: "a, b" } });
    expect(s.demo).toBe(false);
  });

  it("clearDemo does nothing once the state is not the sample: a queued stale confirm cannot wipe real rows", () => {
    // The interleaving codex S5 found: this tab's confirm box opened over the
    // sample, another tab wrote real data, the `storage` door queued
    // `loadPersisted` for it, and the old screen's callback then dispatched
    // `clearDemo`. React reduces them in exactly that order.
    const gscRow = { query: "acme seo", clicks: 3, impressions: 90, ctr: 3.3, position: 7.5 } as const;
    const sample = loadDemoOver(initialProjectState(seed), demoPayload);
    const real = reduce(
      reduce(initialProjectState(seed), { type: "setGscRows", rows: [gscRow], source: "user" }),
      { type: "addArtifact", artifact: artifact("mine") },
    );
    expect(sample.demo).toBe(true);
    expect(real.demo).toBe(false);

    let s = reduce(sample, { type: "loadPersisted", state: real });
    // The confirm was raised over the sample, so that is what it carries.
    s = reduce(s, { type: "clearDemo", expected: demoFields(sample) });

    // The same reference: no new reducer state is produced.
    expect(s).toBe(real);
    expect(s.gscRows).toEqual([gscRow]);
    expect(s.gscRowsSource).toBe("user");
    expect(s.artifacts.map((a) => a.id)).toEqual(["mine"]);
  });

  it("clearDemo still clears while the sample is loaded, rows added on top of it included", () => {
    const gscRow = { query: "acme seo", clicks: 3, impressions: 90, ctr: 3.3, position: 7.5 } as const;
    let s = loadDemoOver(initialProjectState(seed), demoPayload);
    s = reduce(s, { type: "setGscRows", rows: [gscRow], source: "user" });
    expect(s.demo).toBe(true);

    const cleared = clearDemoOver(s);

    expect(cleared).not.toBe(s);
    expect(cleared.demo).toBe(false);
    expect(cleared.gscRows).toEqual([]);
    expect(cleared.gscRowsSource).toBeNull();
    expect(cleared.artifacts).toEqual([]);
  });

  it("reset returns to the initial state for the same seed", () => {
    let s = loadDemoOver(initialProjectState(seed), demoPayload);
    s = reduce(s, { type: "reset", seed });
    expect(s).toEqual(initialProjectState(seed));
  });

  it("loadPersisted replaces the whole state", () => {
    const other = { ...initialProjectState(seed), seeds: "persisted" };
    expect(reduce(initialProjectState(seed), { type: "loadPersisted", state: other })).toBe(other);
  });
});

/**
 * The confirmation snapshot (codex S6r2 #1 #2). A load or a clear carries the
 * overwritable fields as the operator saw them, and the reducer is the last
 * place that can tell they moved: a component cannot see an update queued
 * behind the render it was clicked in.
 */
describe("demo: a confirmation covers the content it was given for", () => {
  const FIELDS = Object.keys(demoFields(populatedProjectState(seed))) as (keyof DemoFields)[];
  const ownData = (): WorkbenchProjectState => ({ ...populatedProjectState(seed), demo: false });

  it("loads and clears while nothing has moved", () => {
    const own = ownData();
    const loaded = reduce(own, { type: "loadDemo", payload: demoPayload, expected: demoFields(own) });
    expect(loaded.demo).toBe(true);
    expect(loaded.seeds).toBe(demoPayload.seeds);

    const cleared = reduce(loaded, { type: "clearDemo", expected: demoFields(loaded) });
    expect(cleared.demo).toBe(false);
    expect(cleared.artifacts).toEqual([]);
  });

  it.each(FIELDS)("refuses a load once %s is another reference, returning the very same state", (key) => {
    const own = ownData();
    const expected = demoFields(own);
    const moved = { ...own, [key]: otherThan(own[key]) } as WorkbenchProjectState;

    expect(reduce(moved, { type: "loadDemo", payload: demoPayload, expected })).toBe(moved);
  });

  it.each(FIELDS)("refuses a clear once %s is another reference, returning the very same state", (key) => {
    const sample = populatedProjectState(seed);
    expect(sample.demo).toBe(true);
    const expected = demoFields(sample);
    const moved = { ...sample, [key]: otherThan(sample[key]) } as WorkbenchProjectState;

    expect(reduce(moved, { type: "clearDemo", expected })).toBe(moved);
  });

  it("refuses a clear over a newer sample with the operator's additions, though it is still sample mode", () => {
    const first = loadDemoOver(initialProjectState(seed), demoPayload);
    const expected = demoFields(first);
    const second = reduce(first, { type: "loadPersisted", state: { ...first, seeds: "sample two\nmy own seed" } });
    expect(second.demo).toBe(true);

    expect(reduce(second, { type: "clearDemo", expected })).toBe(second);
  });

  it("stays valid across changes outside those fields", () => {
    const toggles = { weekly: false, drop: false, mention: true, gsc: false } as const;
    const sample = loadDemoOver(initialProjectState(seed), demoPayload);
    const sampleExpected = demoFields(sample);
    let s = reduce(sample, { type: "setNotify", notify: toggles });
    s = reduce(s, { type: "patchProfile", patch: { positioning: "mine" } });

    const cleared = reduce(s, { type: "clearDemo", expected: sampleExpected });
    expect(cleared.demo).toBe(false);
    expect(cleared.seeds).toBe("");
    expect(cleared.notify).toBe(toggles);

    const own = reduce(initialProjectState(seed), { type: "setSeeds", seeds: "geo audit" });
    const ownExpected = demoFields(own);
    const toggled = reduce(own, { type: "setNotify", notify: toggles });
    expect(reduce(toggled, { type: "loadDemo", payload: demoPayload, expected: ownExpected }).demo).toBe(true);
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
      { type: "setGscRows", rows: [], source: "user" },
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
      { type: "loadDemo", payload: demoPayload, expected: demoFields(populated) },
      { type: "clearDemo", expected: demoFields(populated) },
      { type: "clearGscRows", expected: { rows: populated.gscRows, source: populated.gscRowsSource } },
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
