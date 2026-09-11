import { describe, expect, it } from "vitest";
import { nextTrapIndex } from "./focus-order.ts";

describe("nextTrapIndex", () => {
  it("wraps forward and backward", () => {
    expect(nextTrapIndex(3, 2, false)).toBe(0);
    expect(nextTrapIndex(3, 0, true)).toBe(2);
    expect(nextTrapIndex(3, 1, false)).toBe(2);
  });
  it("enters from outside at the correct end", () => {
    expect(nextTrapIndex(3, -1, false)).toBe(0);
    expect(nextTrapIndex(3, -1, true)).toBe(2);
  });
  it("returns -1 when nothing is focusable", () => {
    expect(nextTrapIndex(0, 0, false)).toBe(-1);
  });
});
