import { type Token, lexer, walkTokens } from "marked";
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
      "a \\<!-- c --> \\<?x ?> \\<!DOCTYPE html> \\<![CDATA[x]]> <https://x.example>",
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

/** Every token marked's lexer produces for `markdown`, nested ones included. */
function tokensOf(markdown: string, gfm: boolean): readonly Token[] {
  // walkTokens only takes a callback, so the result is a local rebound to a new array.
  let seen: readonly Token[] = [];
  walkTokens(lexer(markdown, { gfm }), (token) => {
    seen = [...seen, token];
  });
  return seen;
}

function ofType<T extends Token["type"]>(markdown: string, gfm: boolean, type: T): readonly Extract<Token, { type: T }>[] {
  return tokensOf(markdown, gfm).filter((token): token is Extract<Token, { type: T }> => token.type === type);
}

const GFM_MODES = [true, false] as const;

/** A document bullet the way the builders write one. */
function bullet(value: string): string {
  return `- ${docText(value)}`;
}

// codex S7r2 #1: escaping every `<` rewrote a link's target to `%3Chttps://…%3E`,
// turned an autolink into text and put a backslash inside a code span.
describe("docText: only a `<` that opens raw HTML is escaped", () => {
  it.each(GFM_MODES)("keeps an angle-bracket link destination as the link's own target (gfm %s)", (gfm) => {
    const value = "示例 [来源](<https://example.com/a>)";
    expect(docText(value)).toBe(value);
    expect(ofType(bullet(value), gfm, "link").map((link) => link.href)).toEqual(["https://example.com/a"]);
  });

  it.each(GFM_MODES)("keeps a destination that is not an autolink too (gfm %s)", (gfm) => {
    const value = "见 [说明](</guide/a b>) 与 [另一处](<docs/b>)";
    expect(docText(value)).toBe(value);
    expect(ofType(bullet(value), gfm, "link").map((link) => link.href)).toEqual(["/guide/a b", "docs/b"]);
  });

  it.each(GFM_MODES)("keeps an autolink a link (gfm %s)", (gfm) => {
    const value = "查看 <https://example.com> 或写信 <team@example.com>";
    expect(docText(value)).toBe(value);
    expect(ofType(bullet(value), gfm, "link").map((link) => link.href)).toEqual([
      "https://example.com",
      "mailto:team@example.com",
    ]);
  });

  it.each(GFM_MODES)("leaves a code span's text without a backslash (gfm %s)", (gfm) => {
    const value = "代码 `<title>` 与 ``a ` </p>``";
    expect(docText(value)).toBe(value);
    expect(ofType(bullet(value), gfm, "codespan").map((code) => code.text)).toEqual(["<title>", "a ` </p>"]);
  });

  it.each<[number, number]>([
    [0, 1],
    [1, 1],
    [2, 3],
    [3, 3],
    [4, 5],
    [5, 5],
    [6, 7],
  ])("gives %i backslashes before a tag %i, so the `<` stays text", (typed, written) => {
    expect(docText(`a ${"\\".repeat(typed)}<b>x`)).toBe(`a ${"\\".repeat(written)}<b>x`);
  });

  it.each<[string, string]>([
    ["普通标题 <h1>本站检查全部通过</h1><br>示例数据：y", "普通标题 \\<h1>本站检查全部通过\\</h1>\\<br>示例数据：y"],
    ["a <!-- c --> b", "a \\<!-- c --> b"],
    ["a <?pi?> b", "a \\<?pi?> b"],
    ["a </h1> b", "a \\</h1> b"],
    ["A <B>", "A \\<B>"],
    ["&lt;h1&gt;", "&lt;h1&gt;"],
    ["＜h1＞", "＜h1＞"],
    ["<1%", "<1%"],
  ])("writes %j as %j", (value, written) => {
    expect(docText(value)).toBe(written);
  });

  // Each of these only looks like a code span or a link destination. Written
  // as typed, marked reads a raw HTML token in it, in both modes.
  it.each<[string, string]>([
    ["`<b> 没有闭合", "`\\<b> 没有闭合"],
    ["``<b>` 长度不同", "``\\<b>` 长度不同"],
    ["x](<img src=x onerror=alert(1)>)", "x](\\<img src=x onerror=alert(1)>)"],
    ["[a](<b c> 没有右括号", "[a](\\<b c> 没有右括号"],
    ["\\[x](<a b>)", "\\[x](\\<a b>)"],
    ["[x](/u \"[\")](<a b>)", "[x](/u \"[\")](\\<a b>)"],
    ["[a]b](<c d>)", "[a]b](\\<c d>)"],
  ])("still escapes %j, which is raw HTML as typed", (value, written) => {
    expect(docText(value)).toBe(written);
    for (const gfm of GFM_MODES) {
      expect(ofType(`- ${value}`, gfm, "html").length, `gfm ${String(gfm)}`).toBeGreaterThan(0);
    }
  });

  // Not raw HTML in marked as typed, and escaped all the same: a destination
  // inside other brackets is a link the scanner does not vouch for across
  // readers, and a `<scheme:` with whitespace is not an autolink. The cost is
  // the link target or a visible backslash, never a tag let through.
  it.each<[string, string]>([
    ["[y [x](<a b>)](/u)", "[y [x](\\<a b>)](/u)"],
    ["[[x](<a b>)](/u)", "[[x](\\<a b>)](/u)"],
    ["[y `]` [x](<a b>)](/u)", "[y `]` [x](\\<a b>)](/u)"],
    ["<https://a b>", "\\<https://a b>"],
    ["<ab:c d>", "\\<ab:c d>"],
  ])("escapes %j too, by caution", (value, written) => {
    expect(docText(value)).toBe(written);
  });

  it("lets no case above reach a reader as raw HTML, in either marked mode", () => {
    const values = [
      "示例 [来源](<https://example.com/a>)",
      "见 [说明](</guide/a b>) 与 [另一处](<docs/b>)",
      "查看 <https://example.com> 或写信 <team@example.com>",
      "代码 `<title>` 与 ``a ` </p>``",
      ...[0, 1, 2, 3, 4, 5, 6].map((typed) => `a ${"\\".repeat(typed)}<b>x`),
      "普通标题 <h1>本站检查全部通过</h1><br>示例数据：y",
      "a <!-- c --> <?pi?> </h1> <!DOCTYPE html> <![CDATA[x]]> A <B>",
      "`<b> 没有闭合 ``<b>` 长度不同",
      "x](<img src=x onerror=alert(1)>)",
      "[a](<b c> 没有右括号",
      "\\[x](<a b>)",
      "[y [x](<a b>)](/u)",
      "[[x](<a b>)](/u)",
      "[y `]` [x](<a b>)](/u)",
      "[x](/u \"[\")](<a b>)",
      "[a]b](<c d>)",
      "<https://a b> <ab:c d>",
      "<div>",
      "</p>",
    ];
    for (const gfm of GFM_MODES) {
      for (const value of values) {
        expect(ofType(bullet(value), gfm, "html"), `${value} (gfm ${String(gfm)})`).toEqual([]);
      }
    }
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
