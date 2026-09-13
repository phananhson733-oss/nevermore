import { describe, expect, it } from "vitest";
import { truncateUtf16 } from "./truncate.ts";

describe("truncateUtf16", () => {
  it("returns short strings untouched", () => {
    expect(truncateUtf16("abc", 3)).toBe("abc");
    expect(truncateUtf16("", 0)).toBe("");
  });

  it("cuts at the limit when the boundary is between whole characters", () => {
    expect(truncateUtf16("abcdef", 3)).toBe("abc");
    expect(truncateUtf16("中文字符", 2)).toBe("中文");
  });

  it("never leaves a lone high surrogate at the cut", () => {
    // "𠮷" is two code units; a cut between them would strand \uD842.
    expect(truncateUtf16("ab𠮷cd", 3)).toBe("ab");
    expect(truncateUtf16("ab𠮷cd", 4)).toBe("ab𠮷");
    expect(truncateUtf16("𠮷", 1)).toBe("");
    for (const cut of [1, 2, 3, 4, 5]) {
      expect(JSON.stringify(truncateUtf16("𠮷𠮷x", cut))).not.toMatch(/\\ud8/i);
    }
  });
});
