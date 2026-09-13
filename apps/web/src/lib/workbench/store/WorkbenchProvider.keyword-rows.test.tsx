/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRows } from "../mock/keywords.ts";
import type { KeywordRow, VisResult, WorkbenchProjectState } from "../types.ts";
import { useWorkbench, useWorkbenchCounts } from "./hooks.ts";
import { storageKey } from "./persistence.ts";
import { initialProjectState, type ProjectSeed, type WorkbenchAction } from "./reducer.ts";
import { PERSISTED_VERSION } from "./schema.ts";
import { splitSeeds, type WorkbenchCounts } from "./selectors.ts";
import { WorkbenchProvider, type WorkbenchContextValue } from "./WorkbenchProvider.tsx";

// Split from WorkbenchProvider.test.tsx (already past the 400-line file limit):
// the R13 keywordRows wiring only. Same act-environment declaration as there.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const SEED: ProjectSeed = { url: "https://example.test", brand: "Example", market: "US" };
const PID = "00000000-0000-4000-8000-000000000042";

/** Everything the probe saw: the latest context, every keywordRows reference, and how often it rendered. */
interface Recorder {
  current: WorkbenchContextValue | null;
  counts: WorkbenchCounts | null;
  renders: number;
  readonly rowRefs: Set<readonly KeywordRow[]>;
}

function Probe({ rec }: { readonly rec: Recorder }) {
  const value = useWorkbench();
  rec.current = value;
  rec.counts = useWorkbenchCounts();
  rec.renders += 1;
  rec.rowRefs.add(value.keywordRows);
  return null;
}

const mounted: { readonly root: Root; readonly container: HTMLElement }[] = [];

function mount(): Recorder {
  const rec: Recorder = { current: null, counts: null, renders: 0, rowRefs: new Set() };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => {
    root.render(
      <WorkbenchProvider projectId={PID} seed={SEED}>
        <Probe rec={rec} />
      </WorkbenchProvider>,
    );
  });
  return rec;
}

function ctx(rec: Recorder): WorkbenchContextValue {
  if (!rec.current) throw new Error("provider never rendered its children");
  return rec.current;
}

function send(rec: Recorder, action: WorkbenchAction): void {
  act(() => ctx(rec).dispatch(action));
}

/** The rows the provider should expose for `state`, computed without the provider. */
function rowsFor(state: WorkbenchProjectState): readonly KeywordRow[] {
  return buildRows(splitSeeds(state.seeds), state.profile, state.gscRows);
}

function partialRun(n: number): readonly VisResult[] {
  return Array.from({ length: n }, (_, i): VisResult => ({
    p: `probe ${i}`, platform: "Perplexity", hit: i % 2 === 0, rank: i % 2 === 0 ? 1 : null,
    brands: [], domains: [], real: false,
  }));
}

describe("WorkbenchProvider keywordRows (R13)", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    for (let entry = mounted.pop(); entry !== undefined; entry = mounted.pop()) {
      act(() => entry.root.unmount());
      entry.container.remove();
    }
  });

  it("gates the count on built, never the rows", () => {
    const rec = mount();
    expect(ctx(rec).keywordRowCount).toBeNull();
    expect(Array.isArray(ctx(rec).keywordRows)).toBe(true);

    send(rec, { type: "setSeeds", seeds: "seo" });
    expect(ctx(rec).keywordRows.length).toBeGreaterThan(0);
    expect(ctx(rec).keywordRowCount).toBeNull();
    expect(rec.counts?.keywords).toBeNull();

    send(rec, { type: "setBuilt", built: true });
    const { keywordRows, keywordRowCount } = ctx(rec);
    expect(keywordRowCount).toBeGreaterThan(0);
    expect(keywordRowCount).toBe(keywordRows.length);
    expect(keywordRows).toEqual(buildRows(["seo"], { brand: SEED.brand, competitors: "" }, []));
    // The sidebar hook reads the same count.
    expect(rec.counts?.keywords).toBe(String(keywordRows.length));
  });

  it("keeps the keywordRows reference across dispatches that do not touch its inputs", () => {
    const rec = mount();
    send(rec, { type: "setSeeds", seeds: "seo" });
    const baseline = ctx(rec).keywordRows;
    rec.rowRefs.clear();
    const rendersBefore = rec.renders;

    for (const n of [1, 2, 3, 4, 5]) send(rec, { type: "visProgress", results: partialRun(n) });
    send(rec, { type: "setNotify", notify: { weekly: true, drop: true, mention: false, gsc: true } });

    // Six re-renders really happened, so one reference is not "the probe never ran".
    expect(rec.renders - rendersBefore).toBeGreaterThanOrEqual(6);
    expect(rec.rowRefs.size).toBe(1);
    expect(ctx(rec).keywordRows).toBe(baseline);

    send(rec, { type: "setSeeds", seeds: "seo audit" });
    expect(rec.rowRefs.size).toBe(2);
    expect(ctx(rec).keywordRows).not.toBe(baseline);
  });

  it("does not rebuild when a profile field buildRows never reads changes", () => {
    const rec = mount();
    send(rec, { type: "setSeeds", seeds: "seo" });
    const baseline = ctx(rec).keywordRows;
    // patchProfile re-creates `profile`, so a dependency on the object would rebuild here.
    send(rec, { type: "patchProfile", patch: { positioning: "analytics for SMBs", features: "alerts" } });
    expect(ctx(rec).keywordRows).toBe(baseline);
  });

  it("rebuilds when profile.competitors changes (no stale vs row)", () => {
    const rec = mount();
    send(rec, { type: "setSeeds", seeds: "seo" });
    const before = ctx(rec).keywordRows;
    expect(before.some((row) => row.q.includes(" vs "))).toBe(false);

    send(rec, { type: "patchProfile", patch: { competitors: "Rival" } });
    const after = ctx(rec).keywordRows;
    expect(after).not.toBe(before);
    expect(after.some((row) => row.q === "Example vs Rival")).toBe(true);
    expect(after).toEqual(rowsFor(ctx(rec).state));
  });

  it("rebuilds when only profile.brand changes (no stale vs row after a rename)", () => {
    const rec = mount();
    send(rec, { type: "setSeeds", seeds: "seo" });
    send(rec, { type: "patchProfile", patch: { competitors: "Rival" } });
    const before = ctx(rec).state;
    const rowsBefore = ctx(rec).keywordRows;
    expect(rowsBefore.some((row) => row.q === "Example vs Rival")).toBe(true);

    // A rename reaches a mounted provider: WorkbenchShell keys it on the project
    // id only, so a refreshed seed re-stamps the brand on the next load from
    // storage. Every real path that does that also brings a new gscRows array,
    // which would hide a missing brand dependency, so this load keeps the same
    // gscRows, seeds and competitors and changes nothing but the brand.
    send(rec, {
      type: "loadPersisted",
      state: { ...before, profile: { ...before.profile, brand: "Renamed", competitors: "Rival" } },
    });
    expect(ctx(rec).state.gscRows).toBe(before.gscRows);
    expect(ctx(rec).state.seeds).toBe(before.seeds);

    const after = ctx(rec).keywordRows;
    expect(after).not.toBe(rowsBefore);
    expect(after.some((row) => row.q === "Renamed vs Rival")).toBe(true);
    expect(after.some((row) => row.q === "Example vs Rival")).toBe(false);
    expect(after).toEqual(rowsFor(ctx(rec).state));
  });

  it("rebuilds when the GSC rows change", () => {
    const rec = mount();
    send(rec, { type: "setSeeds", seeds: "seo" });
    const before = ctx(rec).keywordRows;

    send(rec, {
      type: "setGscRows",
      rows: [{ query: "example pricing plans", clicks: 4, impressions: 120, ctr: 3.3, position: 6.1 }],
    });
    const after = ctx(rec).keywordRows;
    expect(after).not.toBe(before);
    expect(after.some((row) => row.q === "example pricing plans")).toBe(true);
    expect(after).toEqual(rowsFor(ctx(rec).state));
  });

  it("builds from hydrated state, naming the vs row after the seed's brand rather than the stored one", () => {
    const onDisk: WorkbenchProjectState = {
      ...initialProjectState(SEED),
      seeds: "geo, seo audit",
      built: true,
      profile: { url: "https://stale.test", brand: "Stale", market: "DE", positioning: "", features: "", competitors: "Rival" },
    };
    window.localStorage.setItem(storageKey(PID), JSON.stringify({ v: PERSISTED_VERSION, state: onDisk }));
    const rec = mount();

    // The rows rebuild here because seeds, competitors and gscRows came from
    // disk. The brand in state is the seed's "Example" both before and after
    // hydration, so this test does not exercise the brand dependency; the
    // rename test above does.
    const rows = ctx(rec).keywordRows;
    expect(rows.some((row) => row.q === "Example vs Rival")).toBe(true);
    expect(rows.some((row) => row.q.startsWith("Stale"))).toBe(false);
    expect(rows).toEqual(rowsFor(ctx(rec).state));
    expect(ctx(rec).keywordRowCount).toBe(rows.length);
  });
});
