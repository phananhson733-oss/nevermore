import { describe, expect, it } from "vitest";
import type { Artifact, AuditReport, DemoPayload, VisResult } from "../types.ts";
import { ARTIFACT_LIMIT, HISTORY_LIMIT } from "../types.ts";
import { initialProjectState, normalizeInterrupted, reduce } from "./reducer.ts";

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

describe("initialProjectState", () => {
  it("mirrors only url, brand and market from the real project", () => {
    const s = initialProjectState(seed);
    expect(s.profile).toEqual({ ...seed, positioning: "", features: "", competitors: "" });
    expect(s.audit).toBeNull();
    expect(s.artifacts).toEqual([]);
    expect(s.demo).toBe(false);
    expect(s.notify).toEqual({ weekly: true, drop: true, mention: false, gsc: true });
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
});

describe("visibility transitions", () => {
  it("progress does not archive, complete does", () => {
    let s = reduce(initialProjectState(seed), { type: "visComplete", results: [vis("q1")], at: "t1" });
    expect(s.visHistory).toEqual([]);
    s = reduce(s, { type: "visStart" });
    expect(s.visResults).toEqual([]);
    s = reduce(s, { type: "visProgress", results: [vis("q2")] });
    expect(s.visHistory).toEqual([]);
    expect(s.lastVis?.at).toBe("t1");
    s = reduce(s, { type: "visComplete", results: [vis("q2"), vis("q3")], at: "t2" });
    expect(s.visHistory.map((h) => h.at)).toEqual(["t1"]);
    expect(s.lastVis?.at).toBe("t2");
    expect(s.visResults).toHaveLength(2);
  });

  it("cancel restores the last snapshot or empties", () => {
    let s = reduce(initialProjectState(seed), { type: "visStart" });
    s = reduce(s, { type: "visProgress", results: [vis("x")] });
    expect(reduce(s, { type: "visCancel" }).visResults).toEqual([]);
    s = reduce(s, { type: "visComplete", results: [vis("x")], at: "t" });
    s = reduce(s, { type: "visStart" });
    expect(reduce(s, { type: "visCancel" }).visResults).toEqual([vis("x")]);
  });
});

describe("saved keywords", () => {
  it("keeps addedAt and source for words already saved", () => {
    let s = reduce(initialProjectState(seed), {
      type: "setSaved",
      saved: [{ q: "a", addedAt: "t0", source: "manual" }],
    });
    s = reduce(s, {
      type: "setSaved",
      saved: [{ q: "a", addedAt: "t9", source: "matrix" }, { q: "b", addedAt: "t1", source: "matrix" }],
    });
    expect(s.saved).toEqual([
      { q: "a", addedAt: "t0", source: "manual" },
      { q: "b", addedAt: "t1", source: "matrix" },
    ]);
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
  const payload: DemoPayload = {
    conns: { GSC: true, GA4: true }, gscRows: [], seeds: "a\nb", built: true, saved: [],
    audit: report("d"), auditHistory: [], lastAudit: report("d"),
    visResults: [vis("q")], visHistory: [], lastVis: { at: "d", results: [vis("q")] },
    compData: null, plans: {}, targets: null, kb: null, artifacts: [artifact("demo")], profileDoc: null,
  };

  it("loadDemo writes the payload fields, flags demo, and never touches profile or notify", () => {
    let s = reduce(initialProjectState(seed), {
      type: "patchProfile", patch: { positioning: "mine" },
    });
    s = reduce(s, { type: "setNotify", notify: { weekly: false, drop: false, mention: false, gsc: false } });
    s = reduce(s, { type: "loadDemo", payload });
    expect(s.demo).toBe(true);
    expect(s.seeds).toBe("a\nb");
    expect(s.audit?.at).toBe("d");
    expect(s.profile.positioning).toBe("mine");
    expect(s.notify.weekly).toBe(false);
  });

  it("clearDemo is symmetric to loadDemo and keeps profile edits and notify", () => {
    let s = reduce(initialProjectState(seed), { type: "patchProfile", patch: { features: "a, b" } });
    s = reduce(s, { type: "loadDemo", payload });
    s = reduce(s, { type: "clearDemo" });
    expect(s).toEqual({ ...initialProjectState(seed), profile: { ...initialProjectState(seed).profile, features: "a, b" } });
    expect(s.demo).toBe(false);
  });

  it("reset returns to the initial state for the same seed", () => {
    let s = reduce(initialProjectState(seed), { type: "loadDemo", payload });
    s = reduce(s, { type: "reset", seed });
    expect(s).toEqual(initialProjectState(seed));
  });

  it("loadPersisted replaces the whole state", () => {
    const other = { ...initialProjectState(seed), seeds: "persisted" };
    expect(reduce(initialProjectState(seed), { type: "loadPersisted", state: other })).toBe(other);
  });
});

describe("normalizeInterrupted", () => {
  it("restores the last audit and visibility snapshot after an interrupted run", () => {
    let s = reduce(initialProjectState(seed), { type: "auditComplete", report: report("a") });
    s = reduce(s, { type: "visComplete", results: [vis("v")], at: "t" });
    s = reduce(s, { type: "auditStart" });
    s = reduce(s, { type: "visStart" });
    const normalized = normalizeInterrupted(s);
    expect(normalized.audit?.at).toBe("a");
    expect(normalized.visResults).toEqual([vis("v")]);
  });
  it("is the identity when nothing was interrupted", () => {
    const s = initialProjectState(seed);
    expect(normalizeInterrupted(s)).toBe(s);
  });
});

describe("immutability", () => {
  it("never mutates the previous state object", () => {
    const before = initialProjectState(seed);
    const frozen = Object.freeze(before);
    const after = reduce(frozen, { type: "addArtifact", artifact: artifact("z") });
    expect(after).not.toBe(before);
    expect(before.artifacts).toEqual([]);
  });
});
