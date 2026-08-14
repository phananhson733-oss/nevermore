// @input  -- 临时写入 content 目录的 draft 文件与两个资源库 loader
// @output -- draft 永不出现在列表、详情或 sitemap 的回归护栏
// @pos    -- 单独成文件：loader 的聚合结果带 React cache，与其它用例共享实例会互相污染

import { rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { getPromptBySlug, getPrompts } from "./prompt-content";
import { getSkillBySlug, getSkills } from "./skill-content";

const PROMPT_FILE = fileURLToPath(
  new URL(
    "../../content/prompts/en/zz-draft-fixture-prompt.md",
    import.meta.url,
  ),
);
const SKILL_FILE = fileURLToPath(
  new URL("../../content/skills/en/zz-draft-fixture.md", import.meta.url),
);

const DRAFT_PROMPT = `---
title: Draft Fixture Prompt
description: A draft that must never be published.
category: research
useCase: Planning
outputFormat: Table
models: Claude
keywords: draft fixture
status: draft
publishedAt: 2026-08-14
---

## Prompt

\`\`\`text
Work on {{site_topic}}.
\`\`\`

## Variables

### site_topic
Required. What the site is about.
Example: Invoicing software

## How to use

Run it.

## Example input

\`\`\`text
Site: Invoicing software
\`\`\`

## Example output

A table.

## Safety notes

Check it.

## FAQ

### First?

Yes.

### Second?

Also yes.
`;

const DRAFT_SKILL = `---
title: Draft Fixture
description: A draft that must never be published.
tagline: Never shipped
category: seo
owner: seo
keywords: draft fixture
status: draft
publishedAt: 2026-08-14
---

## Skill file

\`\`\`text
---
name: zz-draft-fixture
description: A draft that must never be published. Use when nothing at all.
metadata:
  owner: GenGrowth SEO Agent
---

# Draft Fixture

Do the work in order, and never ship a draft.
\`\`\`

## What it does

Nothing, it is a fixture.

## In action

### You ask

Where should we start?

### The agent does

Nowhere, this is a draft.

## How it works

### Read

Understand.

### Act

Then act.

## What it covers

- One area
- Another area

## When to use it

- Never

## FAQ

### First?

Yes.

### Second?

Also yes.
`;

writeFileSync(PROMPT_FILE, DRAFT_PROMPT);
writeFileSync(SKILL_FILE, DRAFT_SKILL);

afterAll(() => {
  rmSync(PROMPT_FILE, { force: true });
  rmSync(SKILL_FILE, { force: true });
});

describe("draft resources", () => {
  it("keeps a draft prompt out of the library and off its detail route", async () => {
    const prompts = await getPrompts("en");

    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.map((prompt) => prompt.slug)).not.toContain(
      "zz-draft-fixture-prompt",
    );
    // A draft that still resolved by slug would be reachable by anyone who
    // guessed the URL, and would be prerendered into the build.
    expect(await getPromptBySlug("zz-draft-fixture-prompt", "en")).toBeNull();
  });

  it("keeps a draft skill out of the library and off its detail route", async () => {
    const skills = await getSkills("en");

    expect(skills.length).toBeGreaterThan(0);
    expect(skills.map((skill) => skill.slug)).not.toContain(
      "zz-draft-fixture",
    );
    expect(await getSkillBySlug("zz-draft-fixture", "en")).toBeNull();
  });

  it("publishes every file currently in the library", async () => {
    const [prompts, skills] = await Promise.all([
      getPrompts("en"),
      getSkills("en"),
    ]);

    for (const entry of [...prompts, ...skills]) {
      expect(entry.status).toBe("published");
    }
  });
});
