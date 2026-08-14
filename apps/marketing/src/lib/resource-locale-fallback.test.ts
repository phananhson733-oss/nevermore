// @input  -- 临时写入 content/prompts 的 zz- 前缀 fixture（en 两个、zh 一个）
// @output -- 部分翻译下 locale 库仍然完整的回归护栏
// @pos    -- 单独成文件：聚合结果带 React cache，与其它用例共享实例会互相污染

import { rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { getPromptsForLocale } from "./prompt-content";

/**
 * Fixtures use `zz-` slugs that no published prompt owns, and they are written
 * to both directories rather than reusing a real one.
 *
 * An earlier version of this file wrote its fixture over
 * `content/prompts/zh/seo-keyword-clustering-prompt.md` and deleted it in
 * `afterAll`, so running the suite silently destroyed a published translation.
 * A test that needs a file on disk must bring its own.
 */
const TRANSLATED_SLUG = "zz-fallback-translated";
const ENGLISH_ONLY_SLUG = "zz-fallback-english-only";

function contentPath(locale: string, slug: string): string {
  return fileURLToPath(
    new URL(`../../content/prompts/${locale}/${slug}.md`, import.meta.url),
  );
}

/** Minimal prompt that satisfies every section the loader requires. */
function fixture(options: {
  readonly title: string;
  readonly description: string;
  readonly related?: string;
}): string {
  return `---
title: ${options.title}
description: ${options.description}
category: research
useCase: Fixture
outputFormat: Table
models: ChatGPT, Claude
keywords: fallback fixture, locale fixture
${options.related ? `relatedPrompts: ${options.related}\n` : ""}status: published
publishedAt: 2026-08-14
---

## Prompt

\`\`\`text
Cluster keywords for {{site_topic}}.
\`\`\`

## Variables

### site_topic
Required. What the site does.
Example: Invoicing software for freelance designers

## How to use

Replace the variable and run it.

## Example input

\`\`\`text
Site: invoicing software for freelance designers
\`\`\`

## Example output

A table of clusters.

## Safety notes

Check that no figure appears that you did not supply.

## FAQ

### How many keywords at once?

A few hundred works.

### Why split similar-looking keywords?

Because intent decides what a page must contain, not wording.
`;
}

const WRITTEN = [
  [
    contentPath("en", ENGLISH_ONLY_SLUG),
    fixture({
      title: "Fallback fixture, English only",
      description: "An English prompt with no translation, used as a fixture.",
    }),
  ],
  [
    contentPath("en", TRANSLATED_SLUG),
    fixture({
      title: "Fallback fixture, translated",
      description: "An English prompt that also has a translation.",
      related: ENGLISH_ONLY_SLUG,
    }),
  ],
  [
    contentPath("zh", TRANSLATED_SLUG),
    fixture({
      title: "回退固件，已翻译",
      description: "一个同时拥有中文文件的提示词固件。",
      related: ENGLISH_ONLY_SLUG,
    }),
  ],
] as const;

for (const [path, source] of WRITTEN) {
  writeFileSync(path, source);
}

afterAll(() => {
  for (const [path] of WRITTEN) {
    rmSync(path, { force: true });
  }
});

/**
 * Partial translation is the state an all-or-nothing fallback breaks in: it
 * would shrink the locale's library to the translated entries alone and turn
 * every other slug into a 404, behind hreflang tags still promising those
 * pages exist.
 */
describe("partial translation", () => {
  it("keeps the whole library addressable in the translated locale", async () => {
    const english = await getPromptsForLocale("en");
    const chinese = await getPromptsForLocale("zh");

    expect(english.prompts.length).toBeGreaterThan(1);
    expect(chinese.prompts.map((p) => p.slug).sort()).toEqual(
      english.prompts.map((p) => p.slug).sort(),
    );
  });

  it("serves the translation where it exists and English everywhere else", async () => {
    const { prompts, hasFallback } = await getPromptsForLocale("zh");

    const translated = prompts.find((p) => p.slug === TRANSLATED_SLUG);
    expect(translated?.locale).toBe("zh");
    expect(translated?.title).toBe("回退固件，已翻译");

    const untranslated = prompts.find((p) => p.slug === ENGLISH_ONLY_SLUG);
    expect(untranslated?.locale).toBe("en");
    expect(untranslated?.title).toBe("Fallback fixture, English only");

    // The hub still tells the reader some entries are English.
    expect(hasFallback).toBe(true);
  });

  it("lets a translation reference a prompt only English owns", async () => {
    // The zh fixture points at a slug with no zh file. The reader resolves it
    // through the same per-slug fallback, so validating a translation against
    // its own directory alone would reject the first translated file anyone
    // writes.
    const { prompts } = await getPromptsForLocale("zh");
    const translated = prompts.find((p) => p.slug === TRANSLATED_SLUG);

    expect(translated?.relatedPrompts).toContain(ENGLISH_ONLY_SLUG);
    expect(prompts.map((p) => p.slug)).toContain(ENGLISH_ONLY_SLUG);
  });
});
