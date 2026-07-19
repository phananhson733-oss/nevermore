import { describe, expect, it } from "vitest";
import { validateMarkdownSections, type RequiredSection } from "./markdown.ts";

const REQUIRED: readonly RequiredSection[] = [
  { label: "Objective", aliases: ["Objective", "目标"] },
  { label: "Evidence", aliases: ["Evidence", "证据"] },
];

describe("validateMarkdownSections", () => {
  it("returns no errors when all sections are present and non-empty", () => {
    const md = "## Objective\n\nGrow CTR.\n\n## Evidence\n\n- [ev1] claim\n";
    expect(validateMarkdownSections(md, REQUIRED)).toEqual([]);
  });

  it("reports a missing section", () => {
    const md = "## Objective\n\nGrow CTR.\n";
    const errors = validateMarkdownSections(md, REQUIRED);
    expect(errors.some((e) => e.includes("missing required section: ## Evidence"))).toBe(true);
  });

  it("reports an empty section", () => {
    const md = "## Objective\n\n## Evidence\n\n- [ev1] claim\n";
    const errors = validateMarkdownSections(md, REQUIRED);
    expect(errors.some((e) => e.includes("empty required section: ## Objective"))).toBe(true);
  });

  it("accepts zh-CN aliases for English-labelled required sections", () => {
    const md = "## 目标\n\n增长点击率。\n\n## 证据\n\n- [ev1] 主张\n";
    expect(validateMarkdownSections(md, REQUIRED)).toEqual([]);
  });

  it("rejects injected raw <script>", () => {
    const md = "## Objective\n\n<script>alert(1)</script>\n\n## Evidence\n\n- [ev1] claim\n";
    const errors = validateMarkdownSections(md, REQUIRED);
    expect(errors.some((e) => e.includes("raw HTML/script"))).toBe(true);
  });

  it("rejects a raw <html> document wrapper", () => {
    const md = "<html><body>## Objective</body></html>";
    const errors = validateMarkdownSections(md, REQUIRED);
    expect(errors.some((e) => e.includes("raw HTML/script"))).toBe(true);
  });

  it.each([
    ["image with an event handler", "<img src=x onerror=alert(1)>"],
    ["ordinary anchor", '<a href="https://example.com">read more</a>'],
    ["mixed-case SVG", '<SvG viewBox="0 0 10 10"><circle /></sVg>'],
    ["uppercase custom element", "<ACME-CARD>content</ACME-CARD>"],
    ["closing tag by itself", "safe text</DiV>"],
  ])("rejects any raw HTML tag opener: %s", (_name, payload) => {
    const md = `## Objective\n\n${payload}\n\n## Evidence\n\n- [ev1] claim\n`;
    expect(validateMarkdownSections(md, REQUIRED)).toContain(
      "markdown contains disallowed raw HTML/script (spec §14.4)",
    );
  });

  it.each([
    ["HTML comment", "<!-- hidden -->"],
    ["DOCTYPE declaration", "<!DOCTYPE html>"],
    ["processing instruction", "<?render target?>"],
    ["CDATA section", "<![CDATA[hidden]]>"],
  ])("rejects a raw HTML block opener: %s", (_name, payload) => {
    const md = `## Objective\n\n${payload}\n\n## Evidence\n\n- [ev1] claim\n`;
    expect(validateMarkdownSections(md, REQUIRED)).toContain(
      "markdown contains disallowed raw HTML/script (spec §14.4)",
    );
  });

  it.each([
    ["multiline HTML attributes", "<IMG\nSRC=x\nONERROR \t = alert(1)>"],
    ["bare event handler", "onload\n = steal()"],
    ["mixed-case JS URI", "[open](JaVaScRiPt \t:\nalert(1))"],
    ["control whitespace inside JS scheme", "[open](java\nscript:alert(1))"],
    ["numeric-entity JS colon", "[open](javascript&#x3a;alert(1))"],
    ["entity-obfuscated JS whitespace", "[open](java&#x09;script&colon;alert(1))"],
  ])("rejects whitespace-obfuscated active content: %s", (_name, payload) => {
    const md = `## Objective\n\n${payload}\n\n## Evidence\n\n- [ev1] claim\n`;
    expect(validateMarkdownSections(md, REQUIRED)).toContain(
      "markdown contains disallowed raw HTML/script (spec §14.4)",
    );
  });

  it("keeps comparison prose and normal markdown sections valid", () => {
    const md = [
      "## Objective",
      "",
      "Choose plans < pro when team size < 10; keep **normal Markdown**.",
      "",
      "## Evidence",
      "",
      "- [ev1] [Source](https://example.com) with `inline code`.",
      "",
    ].join("\n");
    expect(validateMarkdownSections(md, REQUIRED)).toEqual([]);
  });

  it("treats empty input as invalid", () => {
    expect(validateMarkdownSections("   ", REQUIRED)).toEqual(["markdown content is empty"]);
  });

  it("does not treat a level-3 heading as a section", () => {
    const md = "## Objective\n\n### Sub\n\ndetail\n\n## Evidence\n\n- [ev1] claim\n";
    expect(validateMarkdownSections(md, REQUIRED)).toEqual([]);
  });
});
