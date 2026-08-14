// @input  -- 临时写入 content/prompts/zh 的单个翻译文件
// @output -- 部分翻译下 locale 库仍然完整的回归护栏
// @pos    -- 单独成文件：聚合结果带 React cache，与其它用例共享实例会互相污染

import { rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { getPromptsForLocale } from "./prompt-content";

const TRANSLATED = fileURLToPath(
  new URL(
    "../../content/prompts/zh/seo-keyword-clustering-prompt.md",
    import.meta.url,
  ),
);

const ZH_PROMPT = `---
title: SEO 关键词聚类提示词
description: 把一份原始关键词表聚成可以直接建页面的主题簇。
category: research
useCase: 内容规划
outputFormat: 表格
models: ChatGPT, Claude
keywords: 关键词聚类, seo 提示词
relatedPrompts: topical-map-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

\`\`\`text
围绕 {{site_topic}} 聚类关键词。
\`\`\`

## Variables

### site_topic
Required. 站点是做什么的。
Example: 面向自由设计师的开票软件

## How to use

替换变量后运行。

## Example input

\`\`\`text
站点：面向自由设计师的开票软件
\`\`\`

## Example output

一张主题簇表格。

## Safety notes

核对输出里没有你没提供过的数字。

## FAQ

### 一次能粘多少关键词？

几百条没问题。

### 为什么会拆开看起来一样的词？

因为决定页面内容的是搜索意图，不是字面。
`;

writeFileSync(TRANSLATED, ZH_PROMPT);

afterAll(() => {
  rmSync(TRANSLATED, { force: true });
});

/**
 * The first translated file is the moment an all-or-nothing fallback breaks: it
 * would shrink the locale's library to that single entry and turn every other
 * slug into a 404, behind hreflang tags still promising those pages exist.
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

    const translated = prompts.find(
      (prompt) => prompt.slug === "seo-keyword-clustering-prompt",
    );
    expect(translated?.locale).toBe("zh");
    expect(translated?.title).toBe("SEO 关键词聚类提示词");

    const untranslated = prompts.filter(
      (prompt) => prompt.slug !== "seo-keyword-clustering-prompt",
    );
    expect(untranslated.length).toBeGreaterThan(0);
    for (const prompt of untranslated) {
      expect(prompt.locale).toBe("en");
    }

    // The hub still tells the reader some entries are English.
    expect(hasFallback).toBe(true);
  });

  it("lets a translation reference a prompt only English owns", async () => {
    // The zh fixture points at topical-map-prompt, which has no zh file. The
    // reader resolves it through the same per-slug fallback, so validating a
    // translation against its own directory alone would reject the first
    // translated file anyone writes.
    const { prompts } = await getPromptsForLocale("zh");
    const translated = prompts.find(
      (prompt) => prompt.slug === "seo-keyword-clustering-prompt",
    );

    expect(translated?.relatedPrompts).toContain("topical-map-prompt");
    expect(prompts.map((prompt) => prompt.slug)).toContain(
      "topical-map-prompt",
    );
  });

  it("reports no fallback for the English library itself", async () => {
    const { hasFallback } = await getPromptsForLocale("en");

    expect(hasFallback).toBe(false);
  });
});
