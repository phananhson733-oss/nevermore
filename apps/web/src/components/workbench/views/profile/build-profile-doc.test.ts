/**
 * `buildProfileDoc` (plan Task 9 Step 1): what the three source switches and
 * the GSC provenance do to the snapshot. Every switch is checked by turning it
 * OFF on its own with the other two on, so a switch wired to the wrong field, or
 * a builder called whatever the switch says, fails here (codex #6).
 *
 * Expected values are literals or independent properties of the input where
 * one exists (the audit's own page count, the third-party variant differing
 * from the crawl variant), not the same builder call run twice: a comparison
 * whose two sides come from one expression proves nothing about the wiring.
 */
import { describe, expect, it } from "vitest";
import { populatedProjectState } from "@/lib/workbench/store/test-fixtures";
import type { GscRow, GscRowsSource } from "@/lib/workbench/types";
import { buildProfileDoc, type BuildProfileDocInput, type ProfileSources } from "./build-profile-doc.ts";

const STATE = populatedProjectState({ url: "https://example.test", brand: "Example", market: "US" });
const AUDIT = STATE.lastAudit;
const ALL_ON: ProfileSources = { crawl: true, gsc: true, third: true };
const ROWS: readonly GscRow[] = [
  { query: "example pricing", clicks: 30, impressions: 400, ctr: 7.5, position: 3 },
  { query: "seo checklist", clicks: 12, impressions: 900, ctr: 1.3, position: 18 },
  { query: "geo guide", clicks: null, impressions: 90, ctr: null, position: null },
];
const NOW = new Date(2026, 8, 13, 10, 30, 0);

function input(patch: Partial<BuildProfileDocInput> = {}): BuildProfileDocInput {
  return {
    profile: STATE.profile,
    gscRows: ROWS,
    gscRowsSource: "user",
    lastAudit: AUDIT,
    srcs: ALL_ON,
    now: NOW,
    ...patch,
  };
}

describe("buildProfileDoc with every source on", () => {
  const doc = buildProfileDoc(input());

  it("stamps the local wall clock of `now`", () => {
    expect(doc.at).toBe("2026-09-13 10:30");
  });

  it("reads the crawl shape from the last audit when there is one", () => {
    expect(AUDIT).not.toBeNull();
    expect(doc.crawl?.pages).toBe(AUDIT?.crawl.pages);
    expect(doc.crawl?.indexable).toBe(AUDIT?.crawl.indexable);
  });

  it("draws the third-party estimate as its own variant, never the crawl object", () => {
    expect(doc.third).not.toBeNull();
    expect(doc.third).not.toBe(doc.crawl);
    // Different seeds: at least one of the drawn metrics differs.
    const drawn = (signals: typeof doc.third) => [signals?.traffic, signals?.dr, signals?.refdomains];
    expect(drawn(doc.third)).not.toEqual(drawn(doc.crawl));
  });

  it("summarises exactly the rows it was given", () => {
    expect(doc.gsc?.total).toBe(3);
    expect(doc.gsc?.top.map((row) => row.query)).toEqual(["example pricing", "seo checklist", "geo guide"]);
    expect(doc.gsc?.near).toBe(1);
  });

  it("freezes the rows' provenance into the snapshot", () => {
    expect(doc.gscSource).toBe("user");
  });

  it("always carries the placeholder AI document", () => {
    expect(doc.ai.summary.startsWith("[示例] Example")).toBe(true);
  });
});

describe("buildProfileDoc switches", () => {
  it("crawl off: no crawl signals, the other two still there", () => {
    const doc = buildProfileDoc(input({ srcs: { ...ALL_ON, crawl: false } }));
    expect(doc.crawl).toBeNull();
    expect(doc.third).not.toBeNull();
    expect(doc.gsc).not.toBeNull();
  });

  it("gsc off: no GSC signals and no source, the other two still there", () => {
    const doc = buildProfileDoc(input({ srcs: { ...ALL_ON, gsc: false } }));
    expect(doc.gsc).toBeNull();
    expect(doc.gscSource).toBeNull();
    expect(doc.crawl).not.toBeNull();
    expect(doc.third).not.toBeNull();
  });

  it("third off: no third-party estimate, the other two still there", () => {
    const doc = buildProfileDoc(input({ srcs: { ...ALL_ON, third: false } }));
    expect(doc.third).toBeNull();
    expect(doc.crawl).not.toBeNull();
    expect(doc.gsc).not.toBeNull();
  });

  it("all off: only the AI placeholder and the stamp", () => {
    const doc = buildProfileDoc(input({ srcs: { crawl: false, gsc: false, third: false } }));
    expect([doc.crawl, doc.gsc, doc.gscSource, doc.third]).toEqual([null, null, null, null]);
    expect(doc.at).toBe("2026-09-13 10:30");
  });
});

describe("buildProfileDoc GSC provenance", () => {
  it("has no GSC signals without rows, even with the switch on", () => {
    // Zero rows is not a measurement of zero queries: nothing was imported.
    const doc = buildProfileDoc(input({ gscRows: [], gscRowsSource: null }));
    expect(doc.gsc).toBeNull();
    expect(doc.gscSource).toBeNull();
  });

  it.each<GscRowsSource>(["sample", "user"])("keeps %s as the source", (source) => {
    expect(buildProfileDoc(input({ gscRowsSource: source })).gscSource).toBe(source);
  });

  it("keeps an unknown source unknown rather than guessing one", () => {
    const doc = buildProfileDoc(input({ gscRowsSource: null }));
    expect(doc.gsc).not.toBeNull();
    expect(doc.gscSource).toBeNull();
  });
});

describe("buildProfileDoc without an audit", () => {
  it("generates the crawl shape instead of reading one", () => {
    const withAudit = buildProfileDoc(input());
    const without = buildProfileDoc(input({ lastAudit: null }));
    expect(without.crawl).not.toBeNull();
    // The audit fixture says 42 pages; the generated site is counted differently.
    expect(withAudit.crawl?.pages).toBe(42);
    expect(without.crawl?.pages).not.toBe(42);
  });
});
