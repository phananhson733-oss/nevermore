/**
 * Raw HTML in a value that lands inside a line a builder has already opened (a
 * heading, the text after a fixed label) in the profile document, the knowledge
 * base and llms.txt: no reader may see it as an html token, with GFM on or off
 * (T9 review #3). Values that start a line are covered by
 * profile-doc-markdown.test.ts and kb-doc-tokens.test.ts; compose.test.ts holds
 * the encoding itself.
 */
import { lexer, walkTokens } from "marked";
import { describe, expect, it } from "vitest";
import type { IcpSegment, KbEntry, Profile, ProfileDoc } from "../../types.ts";
import { FIXTURE_DOC, FIXTURE_PROFILE } from "./builder-fixtures.ts";
import { FIXTURE_KB_ENTRIES, withEntry } from "./builder-fixtures-kb.ts";
import { type FieldCase, withEveryField } from "./hostile-fixtures.ts";
import { kbMarkdown, llmsTxt } from "./kb.ts";
import { profileDocMarkdown } from "./profile.ts";

interface HtmlValue {
  readonly value: string;
  /** Text after the value's first `<`, so a test can tell the value reached the document whatever became of the `<`. */
  readonly marker: string;
}

const HTML_VALUES: readonly HtmlValue[] = [
  { value: "<img src=x onerror=alert(1)>", marker: "img src=x onerror=alert(1)>" },
  { value: "a</p><h1>qz1</h1>", marker: "h1>qz1" },
  { value: "<!-- qz2 -->", marker: "!-- qz2 -->" },
  { value: "www.example.com/<b>qz3", marker: "b>qz3" },
  { value: "```<b>qz4</b>```", marker: "b>qz4" },
  { value: "<?qz5?>", marker: "?qz5?>" },
];

const GFM_MODES = [true, false] as const;

/** Every html token marked reads in `markdown`, block or inline, in either mode. */
function htmlTokens(markdown: string): readonly string[] {
  return GFM_MODES.flatMap((gfm) => {
    // walkTokens only takes a callback, so the result is a local rebound to a new array.
    let found: readonly string[] = [];
    walkTokens(lexer(markdown, { gfm }), (token) => {
      if (token.type === "html") found = [...found, `${token.raw} (gfm ${String(gfm)})`];
    });
    return found;
  });
}

function expectNoHtml(markdown: string, { marker }: HtmlValue): void {
  expect(markdown).toContain(marker);
  expect(htmlTokens(markdown)).toEqual([]);
}

interface ProfileInput {
  readonly profile: Profile;
  readonly doc: ProfileDoc;
}

function siteField(key: "brand" | "url" | "market"): FieldCase<ProfileInput> {
  return {
    field: `profile.${key}`,
    apply: (input, value) => ({ ...input, profile: { ...input.profile, [key]: value } }),
  };
}

function docField(field: string, patch: (doc: ProfileDoc, value: string) => ProfileDoc): FieldCase<ProfileInput> {
  return { field: `doc.${field}`, apply: (input, value) => ({ ...input, doc: patch(input.doc, value) }) };
}

function crawlField(key: "stack" | "lang"): FieldCase<ProfileInput> {
  return docField(`crawl.${key}`, (doc, value) => ({
    ...doc,
    crawl: doc.crawl === null ? null : { ...doc.crawl, [key]: value },
  }));
}

function icpField(key: keyof IcpSegment): FieldCase<ProfileInput> {
  return docField(`ai.icp[0].${key}`, (doc, value) => ({
    ...doc,
    ai: { ...doc.ai, icp: doc.ai.icp.map((seg, i) => (i === 0 ? { ...seg, [key]: value } : seg)) },
  }));
}

const PROFILE_CASES: readonly FieldCase<ProfileInput>[] = [
  ...(["brand", "url", "market"] as const).map(siteField),
  docField("at", (doc, value) => ({ ...doc, at: value })),
  crawlField("stack"),
  crawlField("lang"),
  docField("gsc.top[0].query", (doc, value) => ({
    ...doc,
    gsc:
      doc.gsc === null
        ? null
        : { ...doc.gsc, top: doc.gsc.top.map((row, i) => (i === 0 ? { ...row, query: value } : row)) },
  })),
  ...(["seg", "role", "pain", "trigger", "objection"] as const).map(icpField),
  docField("ai.summary", (doc, value) => ({ ...doc, ai: { ...doc.ai, summary: value } })),
  docField("ai.tone", (doc, value) => ({ ...doc, ai: { ...doc.ai, tone: value } })),
  docField("ai.facts", (doc, value) => ({ ...doc, ai: { ...doc.ai, facts: [value] } })),
];

const PROFILE_BASE: ProfileInput = { profile: FIXTURE_PROFILE, doc: FIXTURE_DOC };

describe.each(PROFILE_CASES)("profileDocMarkdown with HTML in $field", ({ apply }) => {
  it.each(HTML_VALUES)("reads $value as text", (html) => {
    expectNoHtml(profileDocMarkdown(apply(PROFILE_BASE, html.value)), html);
  });
});

it.each(HTML_VALUES)("profileDocMarkdown with $value in every field at once reads it as text", (html) => {
  expectNoHtml(profileDocMarkdown(withEveryField(PROFILE_BASE, PROFILE_CASES, html.value)), html);
});

interface KbInput {
  readonly profile: Profile;
  readonly entries: readonly KbEntry[];
}

function kbSiteField(key: "brand" | "url" | "market"): FieldCase<KbInput> {
  return {
    field: `profile.${key}`,
    apply: (input, value) => ({ ...input, profile: { ...input.profile, [key]: value } }),
  };
}

function entryField(index: number, key: "statement" | "evidence" | "source"): FieldCase<KbInput> {
  return {
    field: `entries[${index}].${key}`,
    apply: (input, value) => ({ ...input, entries: withEntry(input.entries, index, { [key]: value }) }),
  };
}

const KB_CASES: readonly FieldCase<KbInput>[] = [
  ...(["brand", "url", "market"] as const).map(kbSiteField),
  entryField(0, "statement"),
  entryField(0, "evidence"),
  entryField(1, "source"),
];

const KB_BASE: KbInput = { profile: FIXTURE_PROFILE, entries: FIXTURE_KB_ENTRIES };

describe.each(KB_CASES)("kbMarkdown with HTML in $field", ({ apply }) => {
  it.each(HTML_VALUES)("reads $value as text", (html) => {
    expectNoHtml(kbMarkdown(apply(KB_BASE, html.value)), html);
  });
});

it.each(HTML_VALUES)("kbMarkdown with $value in every field at once reads it as text", (html) => {
  expectNoHtml(kbMarkdown(withEveryField(KB_BASE, KB_CASES, html.value)), html);
});

// The site URL feeds both the `# domain` heading and the Contact line.
it.each(HTML_VALUES)("llmsTxt with $value as the site URL reads it as text", (html) => {
  expectNoHtml(llmsTxt(kbSiteField("url").apply(KB_BASE, html.value)), html);
});
