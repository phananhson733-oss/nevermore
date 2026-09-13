/**
 * Where the GSC rows came from (Q6). The mark lives next to the rows in project
 * state and moves with them: it is the only thing the overview footnote, the
 * data-source row badge and a freshly generated profile snapshot may read to
 * decide whether to say "sample". `state.demo` must not answer that question —
 * after a sample load it is true even for rows the user pasted afterwards.
 */
import { describe, expect, it } from "vitest";
import type { Artifact, AuditReport, DemoPayload, VisResult } from "../types.ts";
import { initialProjectState, reduce } from "./reducer.ts";

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
