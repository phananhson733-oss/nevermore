/**
 * kbMarkdown and llmsTxt as marked (CommonMark + GFM, the studio preview's
 * parser) reads them. A user or AI value at the start of a bullet, or right
 * after the llms.txt `>` marker, must stay that line's inline text: no nested
 * block, no link reference definition, and no fixed placeholder such as
 * `[补边界]` turned into a link. String-level tests live in kb.test.ts and
 * kb-llms.test.ts.
 */
import { type Token, type Tokens, lexer, walkTokens } from "marked";
import { describe, expect, it } from "vitest";
import type { KbEntry, Profile } from "../../types.ts";
import { FIXTURE_PROFILE } from "./builder-fixtures.ts";
import { FIXTURE_KB_ENTRIES, withEntry } from "./builder-fixtures-kb.ts";
import {
  BLOCK_TOKEN_TYPES,
  blockTokenCounts,
  linkDefinitionLabels,
} from "./hostile-fixtures.ts";
import { kbMarkdown, llmsTxt } from "./kb.ts";

interface Input {
  readonly profile: Profile;
  readonly entries: readonly KbEntry[];
}

/** Each opens a block, or registers a link definition, where it starts a bullet's or a blockquote's content. */
const OPENERS: readonly string[] = [
  "# 伪标题",
  "###### x",
  "> x",
  ">x",
  "- x",
  "+ x",
  "* x",
  "---",
  "***",
  "___",
  "- - -",
  "--",
  "```",
  "```js",
  "````",
  "~~~",
  "<div>",
  "<!--",
  "[a]: https://evil.example",
  "[x]: https://evil.example",
  "[补边界]: https://evil.example",
  "[补定义]: https://evil.example",
  "[缺口：补一句 不适合谁]: https://evil.example",
  "[ ] x",
  "[x] x",
  "1. x",
  "1) x",
];

const BASE: Input = { profile: FIXTURE_PROFILE, entries: FIXTURE_KB_ENTRIES };
const NO_DEFINITION: Input = {
  ...BASE,
  entries: FIXTURE_KB_ENTRIES.filter((entry) => entry.cat !== "definition"),
};

function isHeading(token: Token): token is Tokens.Heading {
  return token.type === "heading";
}

function isList(token: Token): token is Tokens.List {
  return token.type === "list";
}

function isBlockquote(token: Token): token is Tokens.Blockquote {
  return token.type === "blockquote";
}

/** Top-level tokens without the blank-line `space` tokens. */
function blocks(markdown: string): readonly Token[] {
  return lexer(markdown).filter((token) => token.type !== "space");
}

/** The first list item under the `##` heading titled `title`. */
function firstItemUnder(markdown: string, title: string): Tokens.ListItem {
  const tokens = blocks(markdown);
  const at = tokens.findIndex(
    (token) => isHeading(token) && token.text === title,
  );
  const next = at < 0 ? undefined : tokens[at + 1];
  const item = next !== undefined && isList(next) ? next.items[0] : undefined;
  if (item === undefined) throw new Error(`no list item under ${title}`);
  return item;
}

/** The single inline child a value's container must hold, and any block token found anywhere inside it. */
function containerViolations(
  children: readonly Token[],
  inlineType: "text" | "paragraph",
): readonly string[] {
  const [only, ...rest] = children;
  const shape =
    only?.type === inlineType && rest.length === 0
      ? []
      : [`children: ${children.map((token) => token.type).join(",")}`];
  // walkTokens only takes a callback, so the result is a local rebound to a new array.
  let nested: readonly string[] = [];
  walkTokens([...children], (token) => {
    if ((BLOCK_TOKEN_TYPES as readonly string[]).includes(token.type)) {
      nested = [...nested, `nested ${token.type}`];
    }
  });
  return [...shape, ...nested];
}

function itemViolations(item: Tokens.ListItem): readonly string[] {
  return [
    ...(item.task ? ["task item"] : []),
    ...containerViolations(item.tokens, "text"),
  ];
}

function summaryViolations(markdown: string): readonly string[] {
  const quote = blocks(markdown)[1];
  if (quote === undefined || !isBlockquote(quote)) {
    return ["no summary blockquote after the H1"];
  }
  return containerViolations(quote.tokens, "paragraph");
}

/** `[label]` links resolved against a definition; the documents' own links are all bare URLs. */
function referenceLinks(markdown: string): readonly string[] {
  let found: readonly string[] = [];
  walkTokens(lexer(markdown), (token) => {
    if (token.type === "link" && token.raw.startsWith("[")) {
      found = [...found, token.raw];
    }
  });
  return found;
}

function linkViolations(markdown: string): readonly string[] {
  return [
    ...linkDefinitionLabels(markdown).map((label) => `definition ${label}`),
    ...referenceLinks(markdown).map((raw) => `reference link ${raw}`),
  ];
}

interface DocCase {
  readonly name: string;
  readonly build: (value: string) => string;
  readonly baseline: string;
  readonly holder: (doc: string) => readonly string[];
}

const withProfile = (input: Input, patch: Partial<Profile>): Input => ({
  ...input,
  profile: { ...input.profile, ...patch },
});

const STATEMENT_CASES: readonly DocCase[] = [
  {
    name: "kbMarkdown statement bullet",
    build: (value) =>
      kbMarkdown({
        ...BASE,
        entries: withEntry(FIXTURE_KB_ENTRIES, 0, { statement: value }),
      }),
    baseline: kbMarkdown(BASE),
    holder: (doc) => itemViolations(firstItemUnder(doc, "定义")),
  },
  {
    name: "llmsTxt statement bullet",
    build: (value) =>
      llmsTxt({
        ...BASE,
        entries: withEntry(FIXTURE_KB_ENTRIES, 0, { statement: value }),
      }),
    baseline: llmsTxt(BASE),
    holder: (doc) => itemViolations(firstItemUnder(doc, "About")),
  },
  {
    name: "llmsTxt summary after >",
    build: (value) => llmsTxt(withProfile(BASE, { positioning: value })),
    baseline: llmsTxt(BASE),
    holder: summaryViolations,
  },
  {
    name: "llmsTxt About placeholder brand",
    build: (value) => llmsTxt(withProfile(NO_DEFINITION, { brand: value })),
    baseline: llmsTxt(NO_DEFINITION),
    holder: (doc) => itemViolations(firstItemUnder(doc, "About")),
  },
];

/**
 * The URL also reaches the H1 and `- https://${domain}/`, inside heading text
 * and after fixed text, where inline Markdown is left alone by design; so for
 * it only the Contact item and the link checks are compared, not the whole
 * document's token counts.
 */
const URL_CASE: DocCase = {
  name: "llmsTxt Contact url",
  build: (value) => llmsTxt(withProfile(BASE, { url: value })),
  baseline: llmsTxt(BASE),
  holder: (doc) => itemViolations(firstItemUnder(doc, "Contact")),
};

describe.each([...STATEMENT_CASES, URL_CASE])("$name", ({ build, holder }) => {
  it.each(OPENERS)("%s stays inline text with no link definition", (value) => {
    const doc = build(value);
    expect(holder(doc)).toEqual([]);
    expect(linkViolations(doc)).toEqual([]);
  });
});

describe.each(STATEMENT_CASES)("$name, whole document", ({ build, baseline }) => {
  it.each(OPENERS)("%s adds no block token anywhere", (value) => {
    expect(blockTokenCounts(build(value))).toEqual(blockTokenCounts(baseline));
  });
});

describe("fixed placeholders", () => {
  it("baseline documents hold no link definitions or reference links", () => {
    expect(linkViolations(kbMarkdown(BASE))).toEqual([]);
    expect(linkViolations(llmsTxt(BASE))).toEqual([]);
    expect(linkViolations(llmsTxt(NO_DEFINITION))).toEqual([]);
  });

  it("keeps [补边界] as text when a statement tries to define that label", () => {
    const doc = llmsTxt({
      ...BASE,
      entries: withEntry(FIXTURE_KB_ENTRIES, 0, {
        statement: "[补边界]: https://evil.example",
      }),
    });
    expect(doc).toContain("\n## Not a fit for\n- [补边界]\n");
    expect(linkDefinitionLabels(doc)).toEqual([]);
    expect(itemViolations(firstItemUnder(doc, "Not a fit for"))).toEqual([]);
    expect(referenceLinks(doc)).toEqual([]);
  });

  it("keeps the knowledge-base gap line as text when a statement tries to define its label", () => {
    const doc = kbMarkdown({
      ...BASE,
      entries: withEntry(FIXTURE_KB_ENTRIES, 0, {
        statement: "[缺口：补一句 不适合谁]: https://evil.example",
      }),
    });
    expect(doc).toContain("\n## 不适合谁\n- [缺口：补一句 不适合谁]\n");
    expect(linkDefinitionLabels(doc)).toEqual([]);
    expect(referenceLinks(doc)).toEqual([]);
  });
});
