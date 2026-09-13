import { type Token, type Tokens, Parser, TextRenderer, lexer, marked, walkTokens } from "marked";
import { describe, expect, it } from "vitest";
import {
  bulletLines,
  countText,
  docSection,
  docText,
  headingText,
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
  it("encodes every `<` that would open raw HTML, not only a leading one", () => {
    expect(docText("普通标题 <h1>本站检查全部通过</h1><br>示例数据：y")).toBe(
      "普通标题 &lt;h1>本站检查全部通过&lt;/h1>&lt;br>示例数据：y",
    );
    expect(docText("a <!-- c --> <?x ?> <!DOCTYPE html> <![CDATA[x]]> <https://x.example>")).toBe(
      "a &lt;!-- c --> &lt;?x ?> &lt;!DOCTYPE html> &lt;![CDATA[x]]> &lt;https://x.example>",
    );
    expect(docText("<div>")).toBe("&lt;div>");
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

/** Each of `markdown` direct and as a bullet, in both marked modes, that holds an html token. */
function htmlLeaks(written: string): readonly string[] {
  return GFM_MODES.flatMap((gfm) =>
    [written, `- ${written}`]
      .filter((markdown) => ofType(markdown, gfm, "html").length > 0)
      .map((markdown) => `${JSON.stringify(markdown)} (gfm ${String(gfm)})`),
  );
}

const PREFIXES = ["", "www.example.com/", "https://example.com/", "```", "``", "`", "[x](", "[x](<", "\\", "- ", "# "];
const PAYLOADS = ["<b>x</b>", "<img src=x>", "<!-- c -->", "<?x?>", "</p>", "<a href=y>"];
const SUFFIXES = ["", "```", "`", ")", ">)", " tail"];

// codex S7r3: a scanner that let a `<` through inside a code span or a link
// destination was beaten twice by constructed input (a block-start backslash
// moved the code span; a GFM bare link swallowed the link text). Every
// tag-shaped `<` is now an entity, whatever stands around it.
describe("docText: no Markdown around a tag gets it to a reader as raw HTML (codex S7r3)", () => {
  it.each(PREFIXES)("after %j, for every payload and suffix", (prefix) => {
    const leaks = PAYLOADS.flatMap((payload) =>
      SUFFIXES.flatMap((suffix) => htmlLeaks(docText(`${prefix}${payload}${suffix}`))),
    );
    expect(leaks).toEqual([]);
  });

  // The html-token check runs on what docText wrote before the spelling is
  // pinned, so a regression shows as a leak rather than only a changed string.
  it.each<[string, string]>([
    ["```<b>x</b>```", "\\```&lt;b>x&lt;/b>```"],
    ["www.example.com/[x](<b>)", "www.example.com/[x](&lt;b>)"],
    ["www.example.com/<b>", "www.example.com/&lt;b>"],
  ])("closes codex's repro %j (written %j)", (value, written) => {
    const actual = docText(value);
    expect(htmlLeaks(actual)).toEqual([]);
    expect(actual).toBe(written);
  });

  it.each(["a<b", "<3", "Array<string>", "A <B> C", "x </ y"])("reads %j back as typed once rendered", (value) => {
    for (const gfm of GFM_MODES) {
      expect(visibleText(new Parser().parse(lexer(docText(value), { gfm }))), `gfm ${String(gfm)}`).toBe(value);
    }
  });
});

const ENTITIES: Readonly<Record<string, string>> = { lt: "<", gt: ">", amp: "&", quot: '"', "#39": "'" };

/** The text a reader shows for marked's HTML: tags dropped, the entities marked writes decoded. */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]*>/gu, "")
    .replace(/&(lt|gt|amp|quot|#39);/gu, (_match, name: string) => ENTITIES[name] ?? "")
    .trim();
}

// The costs of the S7r3 ruling, written down so a change to them is a
// decision. Before it (codex S7r2 #1) these kept their link target, autolink
// and code span text; now the `<` in them is an entity like any other.
describe("docText: what encoding without context costs", () => {
  it.each(GFM_MODES)("gives an angle-bracket destination `&lt;` in its target (gfm %s)", (gfm) => {
    const value = "示例 [来源](<https://example.com/a>) 见 [另一处](<docs/b>)";
    const written = docText(value);
    expect(written).toBe("示例 [来源](&lt;https://example.com/a>) 见 [另一处](&lt;docs/b>)");
    expect(ofType(`- ${written}`, gfm, "html")).toEqual([]);
  });

  it("turns an autolink into text; with GFM on, the bare address inside is still linked", () => {
    const written = docText("查看 <https://example.com> 或写信 <team@example.com>");
    expect(written).toBe("查看 &lt;https://example.com> 或写信 &lt;team@example.com>");
    expect(ofType(`- ${written}`, false, "link")).toEqual([]);
    expect(ofType(`- ${written}`, true, "link")).toHaveLength(2);
    expect(htmlLeaks(written)).toEqual([]);
  });

  it.each(GFM_MODES)("shows a tag in a code span as `&lt;` (gfm %s)", (gfm) => {
    const written = docText("代码 `<title>` 与 ``a ` </p>``");
    expect(ofType(`- ${written}`, gfm, "codespan").map((code) => code.text)).toEqual(["&lt;title>", "a ` &lt;/p>"]);
  });

  // An odd count now escapes the `&`, so the reader shows `&lt;b>`; an even one reads `<b>`. Neither is a tag.
  it.each([0, 1, 2, 3, 4, 5, 6])("encodes the `<` behind %i typed backslashes", (typed) => {
    const written = docText(`a ${"\\".repeat(typed)}<b>x`);
    expect(written).toBe(`a ${"\\".repeat(typed)}&lt;b>x`);
    expect(htmlLeaks(written)).toEqual([]);
  });

  it.each<[string, string]>([
    ["a <!-- c --> b", "a &lt;!-- c --> b"],
    ["a <?pi?> b", "a &lt;?pi?> b"],
    ["a </h1> b", "a &lt;/h1> b"],
    ["A <B>", "A &lt;B>"],
    ["[y [x](<a b>)](/u)", "[y [x](&lt;a b>)](/u)"],
    ["<https://a b>", "&lt;https://a b>"],
    ["<ab:c d>", "&lt;ab:c d>"],
    // Not tag-shaped, or not a `<` at all: left as typed. A typed entity renders as the character it names.
    ["&lt;h1&gt;", "&lt;h1&gt;"],
    ["＜h1＞", "＜h1＞"],
    ["<1%", "<1%"],
  ])("writes %j as %j", (value, written) => {
    expect(docText(value)).toBe(written);
  });

  // Each of these is raw HTML in marked as typed, in both modes.
  it.each<[string, string]>([
    ["`<b> 没有闭合", "`&lt;b> 没有闭合"],
    ["``<b>` 长度不同", "``&lt;b>` 长度不同"],
    ["x](<img src=x onerror=alert(1)>)", "x](&lt;img src=x onerror=alert(1)>)"],
    ["[a](<b c> 没有右括号", "[a](&lt;b c> 没有右括号"],
    ["\\[x](<a b>)", "\\[x](&lt;a b>)"],
    ["[x](/u \"[\")](<a b>)", "[x](/u \"[\")](&lt;a b>)"],
    ["[a]b](<c d>)", "[a]b](&lt;c d>)"],
  ])("encodes %j, which is raw HTML as typed", (value, written) => {
    expect(docText(value)).toBe(written);
    for (const gfm of GFM_MODES) {
      expect(ofType(`- ${value}`, gfm, "html").length, `gfm ${String(gfm)}`).toBeGreaterThan(0);
    }
  });

  it("lets no case above reach a reader as raw HTML, in either marked mode", () => {
    const values = [
      "示例 [来源](<https://example.com/a>)",
      "见 [说明](</guide/a b>) 与 [另一处](<docs/b>)",
      "查看 <https://example.com> 或写信 <team@example.com>",
      "代码 `<title>` 与 ``a ` </p>``",
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

/** What a reader shows for a heading: its inline tokens rendered as text, escapes resolved. */
function headingShows(heading: Tokens.Heading): string {
  return new Parser().parseInline(heading.tokens, new TextRenderer());
}

/** The one H3 `markdown` holds in one marked mode; throws when it holds anything else. */
function onlyH3(markdown: string, gfm: boolean): Tokens.Heading {
  const [token, ...rest] = lexer(markdown, { gfm });
  const heading = token as Tokens.Heading | undefined;
  if (heading?.type !== "heading" || heading.depth !== 3 || rest.length > 0) {
    throw new Error(`expected one H3 in ${JSON.stringify(markdown)} (gfm ${String(gfm)})`);
  }
  return heading;
}

// codex S9r2b: a `#` run ending a heading's value was read as the heading's closing sequence and dropped.
describe("headingText", () => {
  it.each(["Acme ###", "###", "# #", "a #b#", "C#"])("keeps %j whole at the end of an H3, in both marked modes", (value) => {
    const markdown = `### 1. ${headingText(value)}`;
    for (const gfm of GFM_MODES) {
      expect(headingShows(onlyH3(markdown, gfm)), `gfm ${String(gfm)}`).toBe(`1. ${value}`);
      expect(marked.parse(markdown, { gfm, async: false }), `gfm ${String(gfm)}`).toBe(`<h3>1. ${value}</h3>\n`);
    }
  });

  it("escapes only a run standing alone at the end, so a bare URL ending in `#` keeps its target", () => {
    expect(headingText("Acme ###")).toBe("Acme \\#\\#\\#");
    expect(headingText("###")).toBe("\\#\\#\\#");
    expect(headingText("# #")).toBe("# \\#");
    expect(headingText("a\t##")).toBe("a\t\\#\\#");
    for (const value of ["a #b#", "C#", "a \\#", "#hashtag", "see https://a.b/#", ""]) {
      expect(headingText(value)).toBe(value);
    }
    const markdown = `### 1. ${headingText("see https://a.b/#")}`;
    expect(marked.parse(markdown, { gfm: true, async: false })).toContain('<a href="https://a.b/#">https://a.b/#</a>');
  });

  it("folds the value and encodes its HTML the way inlineText does", () => {
    expect(headingText("a\n<b> ##")).toBe("a &lt;b> \\#\\#");
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

  it("leaves no `<h1` or `<br` in a title that carries them mid-line", () => {
    const [line] = bulletLines(["普通标题 <h1>x</h1><br>示例数据：y"]);
    expect(line).toBe("- 普通标题 &lt;h1>x&lt;/h1>&lt;br>示例数据：y");
    expect(line).not.toMatch(/<(?:h1|\/h1|br)/u);
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
