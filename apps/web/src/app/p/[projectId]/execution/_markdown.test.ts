import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, safeHref } from "./_markdown.ts";

function text(markdown: string): string {
  return JSON.stringify(parseMarkdown(markdown));
}

describe("parseMarkdown", () => {
  it("reads a draft body as the blocks a reviewer sees", () => {
    const blocks = parseMarkdown(
      [
        "# Onboarding analytics",
        "",
        "The first paragraph is the evidence.",
        "",
        "## Evidence",
        "",
        "- one point",
        "- another point",
        "",
        "1. first step",
        "2. second step",
        "",
        "> A quoted line.",
        "",
        "---",
      ].join("\n"),
    );

    expect(blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "list",
      "list",
      "quote",
      "rule",
    ]);
    expect(blocks[0]).toMatchObject({ level: 1 });
    expect(blocks[3]).toMatchObject({ ordered: false });
    expect(blocks[4]).toMatchObject({ ordered: true });
  });

  it("keeps fenced code verbatim, including markdown-looking lines", () => {
    const blocks = parseMarkdown(
      ["```", "# not a heading", "- not a list", "```"].join("\n"),
    );
    expect(blocks).toEqual([
      { kind: "code", text: "# not a heading\n- not a list" },
    ]);
  });

  it("reads a table into header and rows", () => {
    const blocks = parseMarkdown(
      ["| a | b |", "| --- | --- |", "| 1 | 2 |"].join("\n"),
    );
    expect(blocks[0]).toMatchObject({ kind: "table" });
    expect(text("| a | b |\n| --- | --- |\n| 1 | 2 |")).toContain('"a"');
  });

  it("produces an empty block list for an empty body rather than throwing", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("   \n\n  ")).toEqual([]);
  });
});

describe("untrusted body handling", () => {
  it("has no node kind that can carry markup", () => {
    const blocks = parseMarkdown(
      '<img src=x onerror="alert(1)">\n\n<script>alert(2)</script>',
    );
    // The tags survive as characters inside text nodes; there is nowhere for
    // them to become elements, because no node kind carries markup.
    const kinds = new Set(
      blocks.flatMap((block) =>
        "inline" in block ? block.inline.map((node) => node.kind) : [],
      ),
    );
    expect([...kinds]).toEqual(["text"]);
    expect(text('<img src=x onerror="alert(1)">')).toContain("<img src=x");
  });

  it("accepts only http(s) link addresses", () => {
    expect(safeHref("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHref("http://example.com")).toBe("http://example.com");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html;base64,AA")).toBeNull();
    expect(safeHref("/relative")).toBeNull();
    expect(safeHref("")).toBeNull();
  });

  it("leaves a link with an unusable address as literal text", () => {
    expect(parseInline("[bad](javascript:alert(1))")).toEqual([
      { kind: "text", text: "[bad](javascript:alert(1))" },
    ]);
    expect(parseInline("[docs](https://example.com/a)")).toEqual([
      { kind: "link", text: "docs", href: "https://example.com/a" },
    ]);
  });
});

describe("parseInline", () => {
  it("reads the marks a body actually uses", () => {
    expect(parseInline("plain `code` **bold** *emphasis* end")).toEqual([
      { kind: "text", text: "plain " },
      { kind: "code", text: "code" },
      { kind: "text", text: " " },
      { kind: "strong", text: "bold" },
      { kind: "text", text: " " },
      { kind: "em", text: "emphasis" },
      { kind: "text", text: " end" },
    ]);
  });

  it("leaves unmatched syntax alone instead of guessing", () => {
    expect(parseInline("a * b ** c")).toEqual([
      { kind: "text", text: "a * b ** c" },
    ]);
  });
});
