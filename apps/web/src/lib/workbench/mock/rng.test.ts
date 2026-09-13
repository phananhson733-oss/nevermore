import { describe, expect, it } from "vitest";
import { hashOf, pick, rngOf, sampleDistinct, seedKey } from "./rng.ts";

const take = (next: () => number, count: number): readonly number[] =>
  Array.from({ length: count }, () => next());

describe("hashOf", () => {
  it("is 32-bit FNV-1a over UTF-16 code units", () => {
    expect(hashOf("")).toBe(2166136261);
    expect(hashOf("a")).toBe(0xe40c292c);
    expect(hashOf("foobar")).toBe(0xbf9cf968);
  });

  it("always returns an unsigned 32-bit integer", () => {
    for (const value of ["", "x", "中文", "𠮷", "a much longer seed string"]) {
      const h = hashOf(value);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
    }
  });
});

describe("rngOf", () => {
  it("replays the same sequence for the same seed", () => {
    expect(take(rngOf(42), 50)).toEqual(take(rngOf(42), 50));
  });

  it("gives different sequences for different seeds", () => {
    expect(take(rngOf(1), 5)).not.toEqual(take(rngOf(2), 5));
  });

  it("stays in [0, 1) over 10000 draws", () => {
    const next = rngOf(hashOf("range"));
    for (const value of take(next, 10_000)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("does not share state between generators", () => {
    const a = rngOf(7);
    const b = rngOf(7);
    const first = a();
    a();
    a();
    expect(b()).toBe(first);
  });
});

describe("seedKey", () => {
  it("does not collide when the same characters are split differently", () => {
    expect(seedKey("Acmeprev")).not.toBe(seedKey("Acme", "prev"));
    expect(seedKey("ab", "c")).not.toBe(seedKey("a", "bc"));
  });

  it("joins parts with the unit separator", () => {
    expect(seedKey("Acme", "prev")).toBe(hashOf("Acme\u001fprev"));
    expect(seedKey("solo")).toBe(hashOf("solo"));
  });
});

describe("pick", () => {
  it("throws on an empty list", () => {
    expect(() => pick([], rngOf(1))).toThrow("non-empty");
  });

  it("maps the draw onto an index", () => {
    const items = ["a", "b", "c", "d"] as const;
    expect(pick(items, () => 0)).toBe("a");
    expect(pick(items, () => 0.5)).toBe("c");
    expect(pick(items, () => 0.999)).toBe("d");
  });
});

describe("sampleDistinct", () => {
  it("returns distinct items drawn from the input", () => {
    const items = Object.freeze(["a", "b", "c", "d", "e", "f"]);
    const out = sampleDistinct(items, 4, rngOf(hashOf("distinct")));
    expect(out).toHaveLength(4);
    expect(new Set(out).size).toBe(4);
    for (const item of out) expect(items).toContain(item);
  });

  it("returns every item when count exceeds the length", () => {
    const items = Object.freeze(["a", "b", "c"]);
    const out = sampleDistinct(items, 10, rngOf(3));
    expect([...out].sort()).toEqual(["a", "b", "c"]);
  });

  it("returns nothing for a zero count or an empty list", () => {
    expect(sampleDistinct(Object.freeze(["a"]), 0, rngOf(1))).toEqual([]);
    expect(sampleDistinct(Object.freeze([]), 3, rngOf(1))).toEqual([]);
  });

  it("does not mutate a frozen input and is deterministic", () => {
    const items = Object.freeze(["g2.com", "reddit.com", "capterra.com", "medium.com", "producthunt.com"]);
    const first = sampleDistinct(items, 3, rngOf(seedKey("demo", "serp")));
    const second = sampleDistinct(items, 3, rngOf(seedKey("demo", "serp")));
    expect(first).toEqual(second);
    expect(items).toEqual(["g2.com", "reddit.com", "capterra.com", "medium.com", "producthunt.com"]);
  });

  it("keeps duplicate input values as separate draws", () => {
    const out = sampleDistinct(Object.freeze(["x", "x"]), 2, rngOf(9));
    expect(out).toEqual(["x", "x"]);
  });
});
