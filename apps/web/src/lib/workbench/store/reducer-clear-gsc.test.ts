/**
 * "Clear GSC rows" on the data-sources page asks first, and the yes covers the
 * rows the dialog was raised over, not whatever is in the store when the click
 * lands (codex S6r3). While the box is open another tab can import different
 * rows, or an update of our own can be queued behind the render the operator
 * clicked in — the component cannot see the second, and this reducer runs after
 * both. So `clearGscRows` carries what the screen showed and the reducer clears
 * only while the rows and their provenance are still exactly that; otherwise it
 * hands back the same state object, which is how the caller tells the clear was
 * refused.
 *
 * Equality is by reference for now (the coordinator's call); these cases avoid
 * pinning "equal content re-parsed from storage is refused", because the guarded
 * actions are about to be relaxed to reference-or-serialised equality.
 */
import { describe, expect, it } from "vitest";
import type { GscRow, GscRowsSource } from "../types.ts";
import { initialProjectState, reduce } from "./reducer.ts";

const seed = { url: "https://example.test", brand: "Example", market: "US" };

function row(query: string, clicks: number): GscRow {
  return { query, clicks, impressions: clicks * 10, ctr: 1.5, position: 7 };
}

function withRows(rows: readonly GscRow[], source: GscRowsSource) {
  return reduce(initialProjectState(seed), { type: "setGscRows", rows, source });
}

describe("clearGscRows", () => {
  it("clears the rows and their provenance when they are still the ones confirmed", () => {
    const before = withRows([row("seo tool", 3), row("geo tool", 4)], "user");
    const after = reduce(before, {
      type: "clearGscRows",
      expected: { rows: before.gscRows, source: before.gscRowsSource },
    });
    expect(after).not.toBe(before);
    expect(after.gscRows).toEqual([]);
    expect(after.gscRowsSource).toBeNull();
    // Nothing else moves: the clear is about GSC rows, not the project.
    expect(after.artifacts).toBe(before.artifacts);
    expect(after.profile).toBe(before.profile);
    expect(after.seeds).toBe(before.seeds);
    expect(after.demo).toBe(before.demo);
  });

  it("clears sample rows under the same rule", () => {
    const before = withRows([row("sample query", 9)], "sample");
    const after = reduce(before, { type: "clearGscRows", expected: { rows: before.gscRows, source: "sample" } });
    expect(after.gscRows).toEqual([]);
    expect(after.gscRowsSource).toBeNull();
  });

  it("returns the same state object when the rows were replaced after the dialog opened", () => {
    const shown = withRows([row("seo tool", 3)], "user");
    const expected = { rows: shown.gscRows, source: shown.gscRowsSource };
    const replaced = reduce(shown, { type: "setGscRows", rows: [row("new import", 50)], source: "user" });
    const after = reduce(replaced, { type: "clearGscRows", expected });
    expect(after).toBe(replaced);
    expect(after.gscRows).toEqual([row("new import", 50)]);
  });

  it("returns the same state object when only the provenance changed under the same rows", () => {
    const shown = withRows([row("seo tool", 3)], "sample");
    const expected = { rows: shown.gscRows, source: shown.gscRowsSource };
    const relabelled = reduce(shown, { type: "setGscRows", rows: shown.gscRows, source: "user" });
    expect(relabelled.gscRows).toBe(shown.gscRows);
    expect(reduce(relabelled, { type: "clearGscRows", expected })).toBe(relabelled);
  });

  it("returns the same state object when rows arrived on a project the operator saw empty", () => {
    const empty = initialProjectState(seed);
    const expected = { rows: empty.gscRows, source: empty.gscRowsSource };
    const imported = reduce(empty, { type: "setGscRows", rows: [row("another tab", 2)], source: "user" });
    expect(reduce(imported, { type: "clearGscRows", expected })).toBe(imported);
  });
});
