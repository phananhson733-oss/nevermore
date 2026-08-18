// @input  -- the check modules' own source and both message catalogues
// @output -- a failing test when a check can render its own key path to a reader
// @pos    -- the guard for the one failure mode next-intl does not report
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SLOT_ORDER } from "./checks-keyword.ts";
import { SITE_RULES } from "./checks-site.ts";
import { SCORE_CAP_REASONS } from "./scoring.ts";

/**
 * Why this reads source instead of a list someone maintains.
 *
 * next-intl renders a missing key as its own dotted path and throws nothing, so
 * a branch with no wording ships as the literal text
 * `tools.onPageChecker.checks.urlShape.deep` in front of whoever hit it. A
 * hand-kept inventory of keys is only as good as the last person to remember
 * it, and it agrees with itself by construction. Reading the modules that emit
 * the keys means a check added without wording fails here.
 *
 * Two families are assembled at runtime — one key per keyword slot, one per
 * site rule — and those are expanded from the arrays the code itself iterates.
 * Every other key in these files is written out as a literal, deliberately, so
 * that this scan can see it.
 */
const SOURCES = [
  "./checks-meta.ts",
  "./checks-keyword.ts",
  "./checks-site.ts",
  "./checks-technical.ts",
];

/** A dotted lower-camel string in these files is a message key. */
const KEY_LITERAL = /"([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+)"/g;

/**
 * Check *ids* that happen to be dotted, and so look like keys to the scan.
 *
 * Listed rather than pattern-matched away, and asserted below to resolve to a
 * message group — so if one of these ever becomes a real key, or stops
 * existing, the exclusion cannot hide it.
 */
const DOTTED_CHECK_IDS: readonly string[] = ["keyword.density", "keyword.brand"];

function literalKeys(): readonly string[] {
  const found = new Set<string>();
  for (const relative of SOURCES) {
    const source = readFileSync(
      fileURLToPath(new URL(relative, import.meta.url)),
      "utf8",
    );
    for (const match of source.matchAll(KEY_LITERAL)) {
      if (match[1] !== undefined) found.add(match[1]);
    }
  }
  return [...found];
}

function assembledKeys(): readonly string[] {
  return [
    ...SLOT_ORDER.flatMap((slot) => [
      `keyword.${slot}.covered`,
      `keyword.${slot}.absent`,
      `keyword.${slot}.notApplicable`,
    ]),
    ...SITE_RULES.flatMap((rule) => [
      `site.${rule.id}.flagged`,
      `site.${rule.id}.clear`,
      `site.${rule.id}.notTested`,
    ]),
  ];
}

/** Every check id needs a heading of its own, not just a sentence. */
function labelKeys(): readonly string[] {
  return [
    ...SITE_RULES.map((rule) => `site.${rule.id}._label`),
    ...[
      "title",
      "description",
      "canonical",
      "robots",
      "viewport",
      "charset",
      "lang",
      "favicon",
      "h1",
      "bodyWords",
      "subHeadings",
      "textRatio",
      "demandCapture",
      "keyword",
      "internalLinks",
      "anchorText",
      "externalLinks",
      "linkSafety",
      "images",
      "imageDimensions",
      "imageLoading",
      "openGraph",
      "twitterCard",
      "https",
      "status",
      "responseTime",
      "urlShape",
      "rendering",
      "jsonLd",
      "robotsTxt",
      "sitemap",
      "sitemapMember",
      "htmlSize",
      "hreflang",
    ].map((id) => `${id}._label`),
  ];
}

async function catalogue(locale: string): Promise<Record<string, unknown>> {
  const loaded = (await import(`../../i18n/messages/${locale}.json`, {
    with: { type: "json" },
  })) as unknown as { default: Record<string, unknown> };
  return loaded.default;
}

function resolve(root: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>(
    (current, segment) =>
      typeof current === "object" && current !== null
        ? (current as Record<string, unknown>)[segment]
        : undefined,
    root,
  );
}

describe.each(["en", "zh"])("%s wording covers every check", (locale) => {
  it("has a sentence for every message key the checks can emit", async () => {
    const messages = await catalogue(locale);
    const keys = [...literalKeys(), ...assembledKeys(), ...labelKeys()].filter(
      (key) => !DOTTED_CHECK_IDS.includes(key),
    );

    // A scan that found nothing would pass every assertion below it.
    expect(keys.length).toBeGreaterThan(80);

    for (const key of keys) {
      const value = resolve(messages, [
        "tools",
        "onPageChecker",
        "checks",
        ...key.split("."),
      ]);
      expect(value, `missing wording for "${key}" in ${locale}`).toBeTypeOf(
        "string",
      );
    }

    for (const id of DOTTED_CHECK_IDS) {
      const group = resolve(messages, [
        "tools",
        "onPageChecker",
        "checks",
        ...id.split("."),
      ]);
      expect(group, `"${id}" is excluded as an id but is not a group`).toBeTypeOf(
        "object",
      );
      expect(literalKeys()).toContain(id);
    }
  });

  it("has a sentence for every score cap", async () => {
    const messages = await catalogue(locale);
    for (const reason of SCORE_CAP_REASONS) {
      const value = resolve(messages, [
        "tools",
        "onPageChecker",
        "score",
        "caps",
        reason,
      ]);
      expect(value, `missing wording for cap "${reason}"`).toBeTypeOf("string");
      // The ceiling is the whole point of the sentence.
      expect(value).toContain("{ceiling}");
    }
  });
});
