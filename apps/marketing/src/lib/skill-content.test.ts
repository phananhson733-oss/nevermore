// @input  -- skill-content 解析器与 content/skills 真实文件
// @output -- Skill Markdown 契约的回归护栏（分节、SKILL.md 形状、步骤）
// @pos    -- 保证一个没有真实可下载文件的 skill 永远不会构建成功

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseSkillFile } from "./skill-content";

const CONTENT_DIR = fileURLToPath(
  new URL("../../content/skills/en", import.meta.url),
);

const VALID = `---
title: Example Skill
description: Does a thing end to end.
tagline: Ship the thing
category: seo
owner: seo
fileName: example-skill.md
keywords: example skill, sample
status: published
publishedAt: 2026-08-14
---

## Skill file

\`\`\`text
---
name: example-skill
description: Does a thing end to end.
owner: GenGrowth SEO Agent
---

# Example Skill

Do the work in order.
\`\`\`

## What it does

Explains itself in prose.

## In action

### You ask

Where should we start?

### The agent does

Start with the pages that already rank.

## How it works

### Read the site

Understand what it sells.

### Do the work

Then act on it.

## What it covers

- One area
- Another area

## When to use it

- When something is true

## FAQ

### First question?

First answer.

### Second question?

Second answer.
`;

describe("parseSkillFile", () => {
  it("parses frontmatter, the skill file, and every section", () => {
    const skill = parseSkillFile("en", "example-skill.md", VALID);

    expect(skill.slug).toBe("example-skill");
    expect(skill.owner).toBe("seo");
    expect(skill.fileName).toBe("example-skill.md");
    expect(skill.fileContent).toContain("name: example-skill");
    expect(skill.fileContent).toContain("# Example Skill");
    expect(skill.exampleAsk).toBe("Where should we start?");
    expect(skill.exampleResponse).toBe(
      "Start with the pages that already rank.",
    );
    expect(skill.steps).toEqual([
      { name: "Read the site", text: "Understand what it sells." },
      { name: "Do the work", text: "Then act on it." },
    ]);
    expect(skill.coverage).toEqual(["One area", "Another area"]);
    expect(skill.whenToUse).toEqual(["When something is true"]);
    expect(skill.faqs).toHaveLength(2);
  });

  it("rejects a skill file without its own frontmatter", () => {
    const source = VALID.replace(
      `---
name: example-skill
description: Does a thing end to end.
owner: GenGrowth SEO Agent
---

# Example Skill`,
      "# Example Skill",
    );

    expect(() => parseSkillFile("en", "example-skill.md", source)).toThrow(
      /must open with its own YAML frontmatter/,
    );
  });

  it("rejects a skill file whose declared name does not match its slug", () => {
    const source = VALID.replace("name: example-skill", "name: other-skill");

    expect(() => parseSkillFile("en", "example-skill.md", source)).toThrow(
      /declares name 'other-skill'/,
    );
  });

  it("rejects a fileName that does not match the slug", () => {
    const source = VALID.replace(
      "fileName: example-skill.md",
      "fileName: something-else.md",
    );

    expect(() => parseSkillFile("en", "example-skill.md", source)).toThrow(
      /must match the slug/,
    );
  });

  it("rejects an In action section missing one half of the exchange", () => {
    const source = VALID.replace(
      `### The agent does

Start with the pages that already rank.`,
      "",
    );

    expect(() => parseSkillFile("en", "example-skill.md", source)).toThrow(
      /needs both '### You ask' and '### The agent does'/,
    );
  });

  it("rejects a single-step workflow", () => {
    const source = VALID.replace(
      `### Do the work

Then act on it.`,
      "",
    );

    expect(() => parseSkillFile("en", "example-skill.md", source)).toThrow(
      /must describe at least two steps/,
    );
  });

  it("rejects an unknown owner", () => {
    const source = VALID.replace("owner: seo", "owner: growth");

    expect(() => parseSkillFile("en", "example-skill.md", source)).toThrow(
      /invalid frontmatter/,
    );
  });
});

describe("published skill library", () => {
  const filenames = readdirSync(CONTENT_DIR).filter((name) =>
    name.endsWith(".md"),
  );

  it("has at least one skill", () => {
    expect(filenames.length).toBeGreaterThan(0);
  });

  it.each(filenames)("parses %s", (filename) => {
    const source = readFileSync(`${CONTENT_DIR}/${filename}`, "utf8");
    const skill = parseSkillFile("en", filename, source);

    expect(skill.steps.length).toBeGreaterThanOrEqual(3);
    expect(skill.coverage.length).toBeGreaterThanOrEqual(3);
    expect(skill.whenToUse.length).toBeGreaterThanOrEqual(3);
    expect(skill.faqs.length).toBeGreaterThanOrEqual(2);
    expect(skill.description.length).toBeLessThanOrEqual(200);
    // The file is offered as a download; an empty or stub file would make the
    // page's central promise false.
    expect(skill.fileContent.length).toBeGreaterThan(400);
  });
});
