// @input  -- prompt-content 解析器与 content/prompts 真实文件
// @output -- Prompt Markdown 契约的回归护栏（分节、变量、占位符一致性）
// @pos    -- 保证一个半成品或自相矛盾的 prompt 文件永远不会构建成功

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parsePromptFile } from "./prompt-content";

const CONTENT_DIR = fileURLToPath(
  new URL("../../content/prompts/en", import.meta.url),
);

const VALID = `---
title: Example Prompt
description: Does a thing.
category: research
useCase: Planning
outputFormat: Table
models: ChatGPT, Claude
keywords: example prompt, sample
status: published
publishedAt: 2026-08-14
---

## Prompt

\`\`\`text
Work on {{site_topic}} for {{target_user}}.
\`\`\`

## Variables

### site_topic
Required. What the site is about.
Example: Invoicing software

### target_user
Optional. Who it serves.
Example: Freelance designers

## How to use

Replace both placeholders and run it.

## Example input

\`\`\`text
Site: Invoicing software
\`\`\`

## Example output

A table of clusters.

## Safety notes

Check the numbers.

## FAQ

### First question?

First answer.

### Second question?

Second answer.
`;

function withSection(replacement: string, target: string): string {
  return VALID.replace(target, replacement);
}

describe("parsePromptFile", () => {
  it("parses frontmatter, sections, and variables", () => {
    const prompt = parsePromptFile("en", "example-prompt.md", VALID);

    expect(prompt.slug).toBe("example-prompt");
    expect(prompt.category).toBe("research");
    expect(prompt.models).toEqual(["ChatGPT", "Claude"]);
    expect(prompt.keywords).toEqual(["example prompt", "sample"]);
    expect(prompt.relatedSkill).toBeNull();
    expect(prompt.relatedPrompts).toEqual([]);
    expect(prompt.promptText).toBe(
      "Work on {{site_topic}} for {{target_user}}.",
    );
    expect(prompt.variables).toEqual([
      {
        name: "site_topic",
        required: true,
        description: "What the site is about.",
        example: "Invoicing software",
      },
      {
        name: "target_user",
        required: false,
        description: "Who it serves.",
        example: "Freelance designers",
      },
    ]);
    expect(prompt.faqs).toHaveLength(2);
    expect(prompt.exampleInput).toBe("Site: Invoicing software");
    // An absent updatedAt means "never revised", not "revised at the epoch".
    expect(prompt.updatedAt).toBe(prompt.publishedAt);
  });

  it("rejects a placeholder with no variable card", () => {
    const source = withSection(
      "Work on {{site_topic}} for {{target_user}} in {{market}}.",
      "Work on {{site_topic}} for {{target_user}}.",
    );

    expect(() => parsePromptFile("en", "example-prompt.md", source)).toThrow(
      /undocumented placeholders: market/,
    );
  });

  it("rejects a variable card the prompt never uses", () => {
    const source = withSection(
      `### site_topic
Required. What the site is about.
Example: Invoicing software

### target_user
Optional. Who it serves.
Example: Freelance designers

### unused_variable
Required. Never referenced.
Example: Nothing`,
      `### site_topic
Required. What the site is about.
Example: Invoicing software

### target_user
Optional. Who it serves.
Example: Freelance designers`,
    );

    expect(() => parsePromptFile("en", "example-prompt.md", source)).toThrow(
      /documented but absent from the prompt: unused_variable/,
    );
  });

  it("rejects a malformed placeholder instead of ignoring it", () => {
    // A pattern that only recognised valid names would let this one through
    // undocumented: invisible to the cross-check, present in the copied text.
    const source = withSection(
      "Work on {{site_topic}} for {{target_user}} in {{TargetMarket}}.",
      "Work on {{site_topic}} for {{target_user}}.",
    );

    expect(() => parsePromptFile("en", "example-prompt.md", source)).toThrow(
      /placeholder '\{\{TargetMarket\}\}' must be snake_case/,
    );
  });

  it("rejects a missing section", () => {
    const source = VALID.replace("## Safety notes\n\nCheck the numbers.\n", "");

    expect(() => parsePromptFile("en", "example-prompt.md", source)).toThrow(
      /missing required '## Safety notes' section/,
    );
  });

  it("rejects a variable without a required or optional marker", () => {
    const source = withSection(
      `### site_topic
What the site is about.
Example: Invoicing software`,
      `### site_topic
Required. What the site is about.
Example: Invoicing software`,
    );

    expect(() => parsePromptFile("en", "example-prompt.md", source)).toThrow(
      /must start with 'Required.' or 'Optional.'/,
    );
  });

  it("rejects a single-question FAQ", () => {
    const source = VALID.replace(
      "### Second question?\n\nSecond answer.\n",
      "",
    );

    expect(() => parsePromptFile("en", "example-prompt.md", source)).toThrow(
      /must answer at least two questions/,
    );
  });

  it("rejects an unknown frontmatter field", () => {
    const source = VALID.replace(
      "status: published",
      "author: Someone\nstatus: published",
    );

    expect(() => parsePromptFile("en", "example-prompt.md", source)).toThrow(
      /invalid frontmatter/,
    );
  });

  it("keeps headings inside the prompt body out of the section split", () => {
    const source = VALID.replace(
      "Work on {{site_topic}} for {{target_user}}.",
      `## Not a document heading
Work on {{site_topic}} for {{target_user}}.`,
    );
    const prompt = parsePromptFile("en", "example-prompt.md", source);

    expect(prompt.promptText).toContain("## Not a document heading");
    expect(prompt.safetyNotes).toBe("Check the numbers.");
  });
});

describe("published prompt library", () => {
  const filenames = readdirSync(CONTENT_DIR).filter((name) =>
    name.endsWith(".md"),
  );

  it("has at least one prompt", () => {
    expect(filenames.length).toBeGreaterThan(0);
  });

  it.each(filenames)("parses %s", (filename) => {
    const source = readFileSync(`${CONTENT_DIR}/${filename}`, "utf8");
    const prompt = parsePromptFile("en", filename, source);

    expect(prompt.title.length).toBeGreaterThan(0);
    expect(prompt.variables.length).toBeGreaterThan(0);
    expect(prompt.faqs.length).toBeGreaterThanOrEqual(2);
    // The description doubles as the meta description; an over-long one is
    // truncated by search engines mid-sentence.
    expect(prompt.description.length).toBeLessThanOrEqual(200);
  });
});
