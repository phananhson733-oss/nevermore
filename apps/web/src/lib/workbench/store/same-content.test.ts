import { describe, expect, it } from "vitest";
import type { WorkbenchProjectState } from "../types.ts";
import { demoFields, sameDemoFields } from "./demo-fields.ts";
import { reduce } from "./reducer.ts";
import { sameContent } from "./same-content.ts";
import { PERSISTED_VERSION, parsePersistedState } from "./schema.ts";
import { populatedProjectState } from "./test-fixtures.ts";

const seed = { url: "https://example.test", brand: "Example", market: "US" };

describe("sameContent", () => {
  it("is true for the same reference without encoding it: a cycle does not throw", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(sameContent(cyclic, cyclic)).toBe(true);
  });

  it("is true for the same content rebuilt by a JSON round-trip", () => {
    const rows = [{ query: "geo audit", clicks: 3, ctr: null }];
    const reparsed: unknown = JSON.parse(JSON.stringify(rows));
    expect(reparsed).not.toBe(rows);
    expect(sameContent(reparsed, rows)).toBe(true);
  });

  it("is true for nested objects whose keys come in another order", () => {
    const written = { a: 1, b: { c: [1, { d: 2, e: 3 }], f: null } };
    const rebuilt = { b: { f: null, c: [1, { e: 3, d: 2 }] }, a: 1 };
    expect(JSON.stringify(rebuilt)).not.toBe(JSON.stringify(written));
    expect(sameContent(rebuilt, written)).toBe(true);
  });

  it("treats a key holding undefined as a missing key, as JSON does", () => {
    expect(sameContent({ q: "geo audit", note: undefined }, { q: "geo audit" })).toBe(true);
  });

  it("is false when an array holds the same items in another order", () => {
    expect(sameContent([1, 2], [2, 1])).toBe(false);
    expect(sameContent({ seeds: ["seo", "geo"] }, { seeds: ["geo", "seo"] })).toBe(false);
  });

  it("is false for other content", () => {
    expect(sameContent([{ query: "geo audit" }], [{ query: "seo audit" }])).toBe(false);
    expect(sameContent({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
    expect(sameContent("user", "sample")).toBe(false);
    expect(sameContent(null, [])).toBe(false);
  });
});

/** The same entries with their keys written in reverse: the content is unchanged, the order is not the schema's. */
function reversedKeys<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).reverse()) as T;
}

/** What another tab's write hands this tab: the persisted envelope, parsed by `schema.ts`. */
function throughStorage(state: WorkbenchProjectState): WorkbenchProjectState {
  const parsed = parsePersistedState(JSON.parse(JSON.stringify({ v: PERSISTED_VERSION, state })));
  if (parsed === null) throw new Error("the persisted envelope did not parse");
  return parsed;
}

/**
 * S6r3 C: the storage path re-parses through zod, and `strictObject` rebuilds
 * every object in the schema's key order. Entries a producer wrote in another
 * order then differ under plain `JSON.stringify`, so the confirmation #2 was
 * about came back refused on the real path.
 */
describe("sameContent on the storage path, with entries not in the schema's key order", () => {
  const base = populatedProjectState(seed);
  const shown: WorkbenchProjectState = {
    ...base,
    gscRows: base.gscRows.map(reversedKeys),
    saved: base.saved.map(reversedKeys),
    artifacts: base.artifacts.map(reversedKeys),
  };

  it("keeps a demo confirmation across another tab's write of notify alone", () => {
    const reparsed = throughStorage({ ...shown, notify: { ...shown.notify, weekly: !shown.notify.weekly } });
    // Hollow unless the schema really rebuilt the entries in its own order.
    expect(Object.keys(reparsed.saved[0] ?? {})).not.toEqual(Object.keys(shown.saved[0] ?? {}));
    expect(Object.keys(reparsed.artifacts[0] ?? {})).not.toEqual(Object.keys(shown.artifacts[0] ?? {}));

    expect(sameDemoFields(reparsed, demoFields(shown))).toBe(true);
  });

  it("keeps a clear-GSC-rows confirmation across the same write", () => {
    const reparsed = throughStorage(shown);
    expect(Object.keys(reparsed.gscRows[0] ?? {})).not.toEqual(Object.keys(shown.gscRows[0] ?? {}));

    const cleared = reduce(reparsed, {
      type: "clearGscRows",
      expected: { rows: shown.gscRows, source: shown.gscRowsSource },
    });

    expect(cleared).not.toBe(reparsed);
    expect(cleared.gscRows).toEqual([]);
    expect(cleared.gscRowsSource).toBeNull();
  });
});
