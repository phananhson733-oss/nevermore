// @input  -- resource-markdown 的分节、子分节与围栏块提取
// @output -- 围栏状态机的回归护栏（嵌套围栏、未闭合、多块）
// @pos    -- 这层错了会静默截断已发布的提示词，所以边界用例必须钉死

import { describe, expect, it } from "vitest";

import {
  extractFencedBlock,
  parseBulletList,
  splitResourceSections,
  splitResourceSubsections,
  toPlainText,
} from "./resource-markdown";

function lines(...rows: string[]): string {
  return rows.join("\n");
}

describe("splitResourceSections", () => {
  it("ignores headings inside a fenced block", () => {
    const sections = splitResourceSections(
      lines(
        "## Prompt",
        "",
        "```text",
        "# Not a document heading",
        "## Also not one",
        "```",
        "",
        "## Variables",
        "",
        "content",
      ),
      "f.md",
    );

    expect([...sections.keys()]).toEqual(["Prompt", "Variables"]);
    expect(sections.get("Prompt")).toContain("## Also not one");
  });

  it("rejects an unterminated fence", () => {
    expect(() =>
      splitResourceSections(lines("## Prompt", "", "```text", "no close"), "f.md"),
    ).toThrow(/unterminated fenced code block/);
  });

  it("rejects a duplicate section", () => {
    expect(() =>
      splitResourceSections(lines("## Prompt", "a", "## Prompt", "b"), "f.md"),
    ).toThrow(/duplicate '## Prompt' section/);
  });

  it("does not let an info-string line close an open fence", () => {
    // ```json opens nothing and closes nothing inside an open block. Treating
    // it as a close is what silently truncated a prompt that demonstrated JSON
    // output — the tail simply stopped being part of the block.
    const sections = splitResourceSections(
      lines(
        "## Prompt",
        "",
        "````text",
        "Return JSON:",
        "```json",
        '{"a": 1}',
        "```",
        "Then stop.",
        "````",
        "",
        "## Variables",
        "x",
      ),
      "f.md",
    );

    expect([...sections.keys()]).toEqual(["Prompt", "Variables"]);
  });
});

describe("extractFencedBlock", () => {
  it("returns the block verbatim", () => {
    const block = extractFencedBlock(
      lines("```text", "line one", "  indented", "line two", "```"),
      "f.md",
      "Prompt",
    );

    expect(block).toBe(lines("line one", "  indented", "line two"));
  });

  it("keeps an inner fence when the outer fence is longer", () => {
    const block = extractFencedBlock(
      lines(
        "````text",
        "Return JSON:",
        "```json",
        '{"a": 1}',
        "```",
        "Then stop.",
        "````",
      ),
      "f.md",
      "Prompt",
    );

    expect(block).toContain("```json");
    expect(block).toContain("Then stop.");
  });

  it("rejects a section holding two separate blocks", () => {
    expect(() =>
      extractFencedBlock(
        lines("```text", "one", "```", "", "```text", "two", "```"),
        "f.md",
        "Prompt",
      ),
    ).toThrow(/more than one fenced code block/);
  });

  it("rejects an unterminated block", () => {
    expect(() =>
      extractFencedBlock(lines("```text", "no close"), "f.md", "Prompt"),
    ).toThrow(/unterminated fenced code block/);
  });

  it("rejects a section with no block at all", () => {
    expect(() =>
      extractFencedBlock("just prose", "f.md", "Prompt"),
    ).toThrow(/must contain a closed fenced code block/);
  });

  it("does not treat a tilde line as closing a backtick fence", () => {
    expect(() =>
      extractFencedBlock(lines("```text", "body", "~~~"), "f.md", "Prompt"),
    ).toThrow(/unterminated fenced code block/);
  });
});

describe("splitResourceSubsections", () => {
  it("ignores h3-looking lines inside a fence", () => {
    const subsections = splitResourceSubsections(
      lines("### One", "```text", "### Not a heading", "```", "### Two", "body"),
      "f.md",
      "FAQ",
    );

    expect(subsections.map((s) => s.heading)).toEqual(["One", "Two"]);
  });

  it("rejects a repeated heading", () => {
    // Duplicates would render the same card twice under one React key.
    expect(() =>
      splitResourceSubsections(
        lines("### One", "a", "### One", "b"),
        "f.md",
        "Variables",
      ),
    ).toThrow(/repeats the '### One' heading/);
  });

  it("rejects a fence left open in the last subsection", () => {
    expect(() =>
      splitResourceSubsections(
        lines("### One", "Yes.", "### Two", "```text", "never closed"),
        "f.md",
        "FAQ",
      ),
    ).toThrow(/'FAQ' has an unterminated fenced code block/);
  });
});

describe("toPlainText", () => {
  it("flattens markdown to the words a reader would hear", () => {
    expect(
      toPlainText("A **bold** claim with `code` and a [link](https://x.test)."),
    ).toBe("A bold claim with code and a link.");
  });

  it("drops fenced blocks rather than inlining their contents", () => {
    expect(toPlainText(lines("Before.", "```", "code()", "```", "After."))).toBe(
      "Before. After.",
    );
  });
});

describe("parseBulletList", () => {
  it("reads a flat list", () => {
    expect(parseBulletList(lines("- one", "- two"), "f.md", "Scope")).toEqual([
      "one",
      "two",
    ]);
  });

  it("rejects nested items rather than dropping them", () => {
    // The section renders flat, so a nested bullet would exist in the file and
    // never on the page.
    expect(() =>
      parseBulletList(lines("- one", "    - nested"), "f.md", "Scope"),
    ).toThrow(/must be a flat list/);
  });

  it("rejects an empty list", () => {
    expect(() => parseBulletList("prose only", "f.md", "Scope")).toThrow(
      /must list at least one item/,
    );
  });
});
