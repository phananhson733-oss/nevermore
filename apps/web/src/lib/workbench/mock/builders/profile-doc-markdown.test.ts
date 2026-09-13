/**
 * profileDocMarkdown and bulletLines as a renderer parses them (marked, the
 * studio preview's CommonMark + GFM parser): a value that starts a bullet stays
 * that bullet's text, the H1 survives Unicode line separators, and unavailable
 * numbers print n/a. String-level document tests live in profile.test.ts.
 */
import {
  Parser,
  TextRenderer,
  type Token,
  type Tokens,
  lexer,
  marked,
  walkTokens,
} from "marked";
import { describe, expect, it } from "vitest";
import type { CrawlSignals, GscSignals, Profile, ProfileDoc } from "../../types.ts";
import { FIXTURE_DOC, FIXTURE_PROFILE } from "./builder-fixtures.ts";
import { bulletLines } from "./compose.ts";
import {
  BLOCK_TOKEN_TYPES,
  blockTokenCounts,
  linkDefinitionLabels,
} from "./hostile-fixtures.ts";
import { profileDocMarkdown } from "./profile.ts";

/** Each of these opens a block when it starts a list item's content in marked 17. */
const BLOCK_OPENERS: readonly string[] = [
  "# 伪标题",
  "## x",
  "### x",
  "#### x",
  "##### x",
  "###### x",
  "> 引用",
  "- 嵌套",
  "+ 嵌套",
  "* 嵌套",
  "***",
  "---",
  "___",
  "- - -",
  // Joins the bullet's own dash into a thematic break: `- --` is a rule, not an item.
  "--",
  "```",
  "```js",
  "~~~",
  "<div>",
  "<!--",
  "<?x",
  "</p>",
  "[a]: https://x",
  "[未填]: https://evil.example",
  // GFM task markers: the value's brackets would render as a checkbox.
  "[ ] 待办",
  "[x] 完成",
  "1. x",
  "1) x",
  "123456789. x",
];

function withGsc(patch: Partial<GscSignals>): ProfileDoc {
  const { gsc } = FIXTURE_DOC;
  if (gsc === null) throw new Error("fixture has no GSC signals");
  return { ...FIXTURE_DOC, gsc: { ...gsc, ...patch } };
}

function withCrawl(patch: Partial<CrawlSignals>): ProfileDoc {
  const { crawl } = FIXTURE_DOC;
  if (crawl === null) throw new Error("fixture has no crawl signals");
  return { ...FIXTURE_DOC, crawl: { ...crawl, ...patch } };
}

function isHeading(token: Token): token is Tokens.Heading {
  return token.type === "heading";
}

function isList(token: Token): token is Tokens.List {
  return token.type === "list";
}

function headingTexts(markdown: string, depth: number): readonly string[] {
  // walkTokens only takes a callback, so the result is a local rebound to a new array.
  let found: readonly string[] = [];
  walkTokens(lexer(markdown), (token) => {
    if (isHeading(token) && token.depth === depth) {
      found = [...found, token.text];
    }
  });
  return found;
}

/** The raw text of every html token, block or inline, anywhere in the document. */
function htmlTokens(markdown: string): readonly string[] {
  let found: readonly string[] = [];
  walkTokens(lexer(markdown), (token) => {
    if (token.type === "html") found = [...found, token.raw];
  });
  return found;
}

/** Top-level tokens without the blank-line `space` tokens. */
function blocks(markdown: string): readonly Token[] {
  return lexer(markdown).filter((token) => token.type !== "space");
}

/** The items of the list right after the heading titled `title`; none when a list does not follow it. */
function itemsUnder(
  tokens: readonly Token[],
  title: string,
): readonly Tokens.ListItem[] {
  const at = tokens.findIndex(
    (token) => isHeading(token) && token.text === title,
  );
  const next = at < 0 ? undefined : tokens[at + 1];
  return next !== undefined && isList(next) ? next.items : [];
}

function onlyItem(items: readonly Tokens.ListItem[]): Tokens.ListItem {
  const [item, ...rest] = items;
  if (item === undefined || rest.length > 0) {
    throw new Error(`expected one list item, got ${items.length}`);
  }
  return item;
}

/** Block tokens inside an item: its text opened a heading, fence, quote, HTML, rule, table, list or task box. */
function nestedBlocks(item: Tokens.ListItem): readonly string[] {
  let found: readonly string[] = [];
  walkTokens(item.tokens, (token) => {
    if ((BLOCK_TOKEN_TYPES as readonly string[]).includes(token.type)) {
      found = [...found, token.type];
    }
  });
  return found;
}

const ENTITIES: Readonly<Record<string, string>> = { lt: "<", gt: ">", amp: "&", quot: '"', "#39": "'" };

/**
 * The text a reader shows for an item holding only inline content; null
 * otherwise. Backslash escapes are resolved by the renderer, and the entities
 * it leaves for the browser are decoded: docText writes a tag-shaped `<` as
 * `&lt;` (codex S7r3), which a reader shows as `<`.
 */
function itemText(item: Tokens.ListItem): string | null {
  const [only, ...rest] = item.tokens;
  if (item.task || only === undefined || rest.length > 0) return null;
  if (only.type !== "text") return null;
  const inline = (only as Tokens.Text).tokens ?? [];
  return new Parser()
    .parseInline(inline, new TextRenderer())
    .replace(/&(lt|gt|amp|quot|#39);/gu, (_match, name: string) => ENTITIES[name] ?? "");
}

describe("profileDocMarkdown numbers", () => {
  it("prints n/a, never 0, for GSC counts that are not available", () => {
    const doc = profileDocMarkdown({
      profile: FIXTURE_PROFILE,
      doc: withGsc({
        brandQueries: null,
        brandClicks: null,
        nonBrandClicks: null,
        near: null,
      }),
    });
    expect(doc).toContain(
      [
        "## 搜索表现（示例数据）",
        "- 查询 3 条，其中品牌词 n/a 条",
        "- 品牌词点击 n/a，非品牌词点击 n/a",
        "- 临界词（11-30 名）n/a 条",
        "- 点击最多：",
      ].join("\n"),
    );
  });

  it("writes 缺失 when the crawl found no pricing, docs or blog page", () => {
    const doc = profileDocMarkdown({
      profile: FIXTURE_PROFILE,
      doc: withCrawl({ hasPricing: false, hasDocs: false, hasBlog: false }),
    });
    expect(doc.split("\n")).toContain("- 关键页：缺失");
  });
});

describe("profileDocMarkdown H1", () => {
  it.each([
    { name: "LINE SEPARATOR", separator: "\u2028" },
    { name: "PARAGRAPH SEPARATOR", separator: "\u2029" },
    { name: "NEL", separator: "\u0085" },
  ])("stays exactly one H1 when the brand holds a $name", ({ separator }) => {
    const md = profileDocMarkdown({
      profile: { ...FIXTURE_PROFILE, brand: `Acme${separator}# 伪标题` },
      doc: FIXTURE_DOC,
    });
    expect(headingTexts(md, 1)).toEqual(["Acme # 伪标题 产品档案"]);
  });
});

function withSegmentName(seg: string): ProfileDoc {
  const [first, ...rest] = FIXTURE_DOC.ai.icp;
  if (first === undefined) throw new Error("fixture has no ICP segment");
  return { ...FIXTURE_DOC, ai: { ...FIXTURE_DOC.ai, icp: [{ ...first, seg }, ...rest] } };
}

/** What a reader shows for each heading of `depth`: its inline tokens rendered as text, escapes resolved. */
function shownHeadings(markdown: string, depth: number, gfm: boolean): readonly string[] {
  let found: readonly string[] = [];
  walkTokens(lexer(markdown, { gfm }), (token) => {
    if (isHeading(token) && token.depth === depth) {
      found = [...found, new Parser().parseInline(token.tokens, new TextRenderer())];
    }
  });
  return found;
}

// codex S9r2b: `### 1. Acme ###` rendered `1. Acme`, the trailing run taken for the heading's closing sequence.
describe("profileDocMarkdown ICP segment headings", () => {
  it.each(["Acme ###", "###", "# #", "a #b#"])("keeps a segment named %j whole in its H3, in both marked modes", (seg) => {
    const md = profileDocMarkdown({ profile: FIXTURE_PROFILE, doc: withSegmentName(seg) });
    for (const gfm of [true, false]) {
      expect(shownHeadings(md, 3, gfm), `gfm ${String(gfm)}`).toEqual([`1. ${seg}`]);
      expect(marked.parse(md, { gfm, async: false }), `gfm ${String(gfm)}`).toContain(`<h3>1. ${seg}</h3>\n`);
    }
  });
});

const BASELINE_DOC = profileDocMarkdown({ profile: FIXTURE_PROFILE, doc: FIXTURE_DOC });

function withSummary(summary: string): string {
  return profileDocMarkdown({
    profile: FIXTURE_PROFILE,
    doc: { ...FIXTURE_DOC, ai: { ...FIXTURE_DOC.ai, summary } },
  });
}

// The summary is the snapshot value that starts a bullet on its own; the
// positioning this used to carry is no longer in the document (T9 review #2).
describe("profileDocMarkdown with a block opener as the product summary", () => {
  it.each(BLOCK_OPENERS)("renders %j as the text of its one bullet", (value) => {
    const md = withSummary(value);
    const item = onlyItem(itemsUnder(blocks(md), "产品描述"));
    expect(nestedBlocks(item)).toEqual([]);
    expect(itemText(item)).toBe(value);
    expect(blockTokenCounts(md)).toEqual(blockTokenCounts(BASELINE_DOC));
    expect(linkDefinitionLabels(md)).toEqual([]);
  });

  it("does not let it turn the fixed [补证据与核对日期] of the facts into a link", () => {
    const md = withSummary("[补证据与核对日期]: https://evil.example");
    expect(itemText(onlyItem(itemsUnder(blocks(md), "可被 AI 引用的事实")))).toBe(
      "[示例事实：Acme 提供 站点审计，需补证据与核对日期]｜[补证据与核对日期]",
    );
    expect(linkDefinitionLabels(md)).toEqual([]);
  });
});

// T9 review #2: the doc tab and the markdown copied, exported or saved from it
// say the same things, read from the same snapshot.
describe("profileDocMarkdown fields", () => {
  const textsUnder = (md: string, title: string): readonly (string | null)[] =>
    itemsUnder(blocks(md), title).map(itemText);

  it("writes a line for the H1, the query total and the brand query count the doc tab shows", () => {
    expect(textsUnder(BASELINE_DOC, "站点现状（示例数据）")).toContain("首页 H1：[示例] Acme 的首页 H1（未抓取）");
    expect(textsUnder(BASELINE_DOC, "搜索表现（示例数据）")).toContain("查询 3 条，其中品牌词 1 条");
  });

  it("reads no profile field but the site's brand, url and market", () => {
    // A whole `Profile`, as the view passes it: the fields the document must not read are there to be read.
    const later: Profile = { ...FIXTURE_PROFILE, positioning: "生成之后改写的定位", features: "新功能甲, 新功能乙", competitors: "新对手" };
    const edited = profileDocMarkdown({ profile: later, doc: FIXTURE_DOC });
    expect(edited).toBe(BASELINE_DOC);
    expect(edited).not.toContain("生成之后改写的定位");
    // The site fields do reach it, so the equality above is not a document that ignores its input.
    expect(profileDocMarkdown({ profile: { ...FIXTURE_PROFILE, market: "DE" }, doc: FIXTURE_DOC })).not.toBe(BASELINE_DOC);
  });
});

describe("bulletLines under a renderer", () => {
  const render = (value: string): string =>
    [
      "## 定位",
      ...bulletLines([value, "下一条"]),
      "",
      "## 竞品",
      "- [未填]",
    ].join("\n");

  it.each(BLOCK_OPENERS)("keeps %j as the text of its own bullet", (value) => {
    const md = render(value);
    const tokens = blocks(md);
    expect(tokens.map((token) => token.type)).toEqual([
      "heading",
      "list",
      "heading",
      "list",
    ]);
    const items = itemsUnder(tokens, "定位");
    expect(items.map(nestedBlocks)).toEqual([[], []]);
    expect(items.map(itemText)).toEqual([value, "下一条"]);
    expect(itemsUnder(tokens, "竞品").map(itemText)).toEqual(["[未填]"]);
    expect(linkDefinitionLabels(md)).toEqual([]);
  });

  // codex S7b #1: raw HTML later in the line rendered a real <h1> and a <br>.
  it.each([
    "普通标题 <h1>本站检查全部通过</h1><br>示例数据：这份正文是最终结论",
    "a <div>b</div>",
    "a <!-- hidden --> b",
    "a <?x ?> b",
    "a \\\\<b>c</b>",
  ])("keeps HTML in %j as text: no html token, no element in the output", (value) => {
    const md = render(value);
    const items = itemsUnder(blocks(md), "定位");
    expect(items.map(nestedBlocks)).toEqual([[], []]);
    expect(htmlTokens(md)).toEqual([]);
    expect(new Parser().parse(lexer(md))).not.toMatch(/<(?:h1|br|div|b|\?|!--)[\s>]/u);
  });

  it("keeps a label with an escaped bracket from defining a link", () => {
    const md = render("[a\\]b]: https://evil.example");
    const items = itemsUnder(blocks(md), "定位");
    expect(items.map(nestedBlocks)).toEqual([[], []]);
    // The backslash typed inside the value is itself a CommonMark escape, so the bracket renders without it.
    expect(items.map(itemText)).toEqual([
      "[a]b]: https://evil.example",
      "下一条",
    ]);
    expect(linkDefinitionLabels(md)).toEqual([]);
  });
});
