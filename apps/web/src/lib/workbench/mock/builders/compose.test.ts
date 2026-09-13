import { describe, expect, it } from "vitest";
import {
  bulletLines,
  countText,
  docSection,
  docText,
  joinParts,
} from "./compose.ts";

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

// Rendering checks (marked) for these values live in profile-doc-markdown.test.ts.
describe("docText", () => {
  it("folds lines, then escapes the first character of a block opener", () => {
    expect(docText("a\n# b")).toBe("a # b");
    expect(docText("# 伪标题")).toBe("\\# 伪标题");
    expect(docText("  > 引用 ")).toBe("\\> 引用");
    expect(docText("--")).toBe("\\--");
    expect(docText("[ ] 待办")).toBe("\\[ ] 待办");
    expect(docText("[a\\]b]: https://x")).toBe("\\[a\\]b]: https://x");
  });

  it("escapes an ordered-list delimiter and keeps the number", () => {
    expect(docText("1. x")).toBe("1\\. x");
    expect(docText("1) x")).toBe("1\\) x");
    expect(docText("123456789.")).toBe("123456789\\.");
  });

  it.each([
    "#hashtag",
    "-5%",
    "<3 love",
    "[示例] Acme：定位",
    "C# 教程",
    "a | b",
    "| a | b |",
    "===",
    "--flag",
    "**bold**",
    "2026.09.13",
    "1234567890. x",
    "#######",
    "[x]y",
  ])("leaves %j byte-identical", (value) => {
    expect(docText(value)).toBe(value);
  });

  // codex S7b #1: only the start of the line was escaped, so HTML later in it reached the reader.
  it("escapes every `<` that would open raw HTML, not only a leading one", () => {
    expect(docText("普通标题 <h1>本站检查全部通过</h1><br>示例数据：y")).toBe(
      "普通标题 \\<h1>本站检查全部通过\\</h1>\\<br>示例数据：y",
    );
    expect(docText("a <!-- c --> <?x ?> <!DOCTYPE html> <![CDATA[x]]> <https://x.example>")).toBe(
      "a \\<!-- c --> \\<?x ?> \\<!DOCTYPE html> \\<![CDATA[x]]> \\<https://x.example>",
    );
    expect(docText("<div>")).toBe("\\<div>");
  });

  it("leaves an escaped `<` alone and escapes one behind an escaped backslash", () => {
    expect(docText("a \\<b>")).toBe("a \\<b>");
    expect(docText("a \\\\<b>")).toBe("a \\\\\\<b>");
    expect(docText("a \\\\\\<b>")).toBe("a \\\\\\<b>");
  });

  it("folds whitespace and line breaks alone to nothing", () => {
    expect(docText(" \r\n\u2028 ")).toBe("");
  });
});

describe("bulletLines", () => {
  it("puts each item through docText and drops items that fold to nothing", () => {
    expect(bulletLines(["a\n# b", " \r\n ", "````", "# c"])).toEqual([
      "- a # b",
      "- \\````",
      "- \\# c",
    ]);
  });

  it("leaves no unescaped `<h1` or `<br` in a title that carries them mid-line", () => {
    const [line] = bulletLines(["普通标题 <h1>x</h1><br>示例数据：y"]);
    expect(line).toBe("- 普通标题 \\<h1>x\\</h1>\\<br>示例数据：y");
    expect(line).not.toMatch(/(?<!\\)<(?:h1|\/h1|br)/u);
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
