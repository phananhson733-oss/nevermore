/**
 * Where the GSC rows came from (Q6). The mark lives next to the rows in project
 * state and moves with them: it is the only thing the overview footnote, the
 * data-source row badge and a freshly generated profile snapshot may read to
 * decide whether to say "sample". `state.demo` must not answer that question —
 * after a sample load it is true even for rows the user pasted afterwards.
 */
import { describe, expect, it } from "vitest";
import type { Artifact, AuditReport, DemoPayload, VisResult, WorkbenchProjectState } from "../types.ts";
import { initialProjectState, normalizeInterrupted, reduce } from "./reducer.ts";
import { classifyPersistedState, parsePersistedState, PERSISTED_VERSION } from "./schema.ts";

const seed = { url: "https://example.test", brand: "Example", market: "US" };

function report(at: string): AuditReport {
  return {
    at, score: 50, findings: [],
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

const gscRow = { query: "acme seo", clicks: 3, impressions: 90, ctr: 3.3, position: 7.5 } as const;

describe("gsc rows carry their provenance (Q6)", () => {
  it("records where the rows came from, for either source", () => {
    for (const source of ["user", "sample"] as const) {
      const s = reduce(initialProjectState(seed), { type: "setGscRows", rows: [gscRow], source });
      expect(s.gscRows).toEqual([gscRow]);
      expect(s.gscRowsSource, source).toBe(source);
    }
  });

  it("clears the provenance when the rows go away: no rows, no source", () => {
    let s = reduce(initialProjectState(seed), { type: "setGscRows", rows: [gscRow], source: "sample" });
    s = reduce(s, { type: "setGscRows", rows: [], source: "user" });
    expect(s.gscRows).toEqual([]);
    expect(s.gscRowsSource).toBeNull();
  });

  it("replaces a sample provenance when the user imports their own rows, and back", () => {
    let s = reduce(initialProjectState(seed), { type: "setGscRows", rows: [gscRow], source: "sample" });
    s = reduce(s, { type: "setGscRows", rows: [gscRow], source: "user" });
    expect(s.gscRowsSource).toBe("user");
    s = reduce(s, { type: "setGscRows", rows: [gscRow], source: "sample" });
    expect(s.gscRowsSource).toBe("sample");
  });

  it("loadDemo marks the rows as the sample's, and clearDemo takes the mark away with them", () => {
    let s = reduce(initialProjectState(seed), { type: "loadDemo", payload: { ...demoPayload, gscRows: [gscRow] } });
    expect(s.gscRows).toEqual([gscRow]);
    expect(s.gscRowsSource).toBe("sample");
    s = reduce(s, { type: "clearDemo" });
    expect(s.gscRows).toEqual([]);
    expect(s.gscRowsSource).toBeNull();
  });

  it("does not claim a source when the sample payload carries no rows", () => {
    const s = reduce(initialProjectState(seed), { type: "loadDemo", payload: demoPayload });
    expect(s.gscRows).toEqual([]);
    expect(s.gscRowsSource).toBeNull();
  });

  it("keeps the user's own rows marked as theirs after a clearDemo", () => {
    // clearDemo rolls back 17 fields, the user's own rows among them (design
    // §6.7), so the mark must go with the rows rather than linger as "sample".
    let s = reduce(initialProjectState(seed), { type: "loadDemo", payload: { ...demoPayload, gscRows: [gscRow] } });
    s = reduce(s, { type: "setGscRows", rows: [gscRow], source: "user" });
    expect(s.gscRowsSource).toBe("user");
    s = reduce(s, { type: "clearDemo" });
    expect(s.gscRowsSource).toBeNull();
  });
});

/**
 * `sourceFor` keeps "no rows, no source" true for everything the reducer writes,
 * but stored bytes do not come from the reducer: localStorage is a boundary
 * (design §6.5), and it holds whatever an older build, another tab or the
 * browser's dev tools left there. The schema checks each field on its own, so
 * `{gscRows: [], gscRowsSource: "sample"}` is a well-formed envelope.
 *
 * The parse exit is where the invariant is re-applied, so that every door the
 * provider loads through gets a normalised object without having to remember to
 * ask for one (the doors themselves are driven in
 * `WorkbenchProvider.gsc-source.test.tsx`).
 */
describe("a stale source cannot come out of a successful parse (Q6)", () => {
  function envelope(state: WorkbenchProjectState): unknown {
    return { v: PERSISTED_VERSION, state };
  }

  function parsed(raw: unknown): WorkbenchProjectState {
    const result = classifyPersistedState(raw);
    if (result.kind !== "ok") throw new Error(`expected a readable envelope, got ${result.kind}`);
    return result.state;
  }

  const tampered = envelope({ ...initialProjectState(seed), seeds: "kept", gscRows: [], gscRowsSource: "sample" });

  it("still reads the envelope: one inconsistent field is not another version of the format", () => {
    // Deliberately NOT `invalid`. A missing key means the envelope was written by
    // a build that did not have the field, and discarding it is right. This one
    // has every key, so condemning it would throw away the basket, the profile
    // snapshot and the seed words over a label on rows that are not there.
    expect(classifyPersistedState(tampered).kind).toBe("ok");
  });

  it("drops the mark on the way out of the parse, leaving the rest of the project alone", () => {
    const state = parsed(tampered);
    expect(state.gscRows).toEqual([]);
    expect(state.gscRowsSource).toBeNull();
    expect(state.seeds).toBe("kept");
    expect(parsePersistedState(tampered)?.gscRowsSource).toBeNull();
  });

  it("leaves a mark that does have rows under it exactly as stored", () => {
    for (const source of ["user", "sample"] as const) {
      const state = parsed(envelope({ ...initialProjectState(seed), gscRows: [gscRow], gscRowsSource: source }));
      expect(state.gscRowsSource, source).toBe(source);
    }
  });

  it("does not settle interrupted runs: that stays first hydration's job alone", () => {
    const partial = { ...initialProjectState(seed), visPartial: true, visResults: [vis("q")] };
    expect(parsed(envelope(partial)).visPartial).toBe(true);
    expect(normalizeInterrupted(parsed(envelope(partial))).visPartial).toBe(false);
  });
});
