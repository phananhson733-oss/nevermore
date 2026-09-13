import { describe, expect, it } from "vitest";
import { bulletLines, countText, docSection, joinParts } from "./compose.ts";

describe("countText", () => {
  it("prints n/a for a missing or non-finite count and the number otherwise", () => {
    expect(countText(null)).toBe("n/a");
    expect(countText(undefined)).toBe("n/a");
    expect(countText(Number.NaN)).toBe("n/a");
    expect(countText(Number.POSITIVE_INFINITY)).toBe("n/a");
    expect(countText(0)).toBe("0");
    expect(countText(12.5)).toBe("12.5");
  });
});

describe("bulletLines", () => {
  it("folds each item onto one bullet and drops items that fold to nothing", () => {
    expect(bulletLines(["a\n# b", " \r\n ", "````"])).toEqual(["- a # b", "- ````"]);
  });
});

describe("docSection / joinParts", () => {
  it("omits a section without lines and joins the rest with a blank line", () => {
    expect(docSection("空", [])).toBeNull();
    expect(joinParts(["# t", docSection("空", []), docSection("有", ["- x"])])).toBe(
      "# t\n\n## 有\n- x",
    );
  });
});
