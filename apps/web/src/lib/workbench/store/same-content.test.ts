import { describe, expect, it } from "vitest";
import { sameContent } from "./same-content.ts";

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

  it("is false for other content", () => {
    expect(sameContent([{ query: "geo audit" }], [{ query: "seo audit" }])).toBe(false);
    expect(sameContent("user", "sample")).toBe(false);
    expect(sameContent(null, [])).toBe(false);
  });

  it("is false for the same keys in another order: asking again is the safe side", () => {
    expect(sameContent({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
  });
});
