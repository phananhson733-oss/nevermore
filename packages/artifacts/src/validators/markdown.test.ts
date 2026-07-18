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

  it("treats empty input as invalid", () => {
    expect(validateMarkdownSections("   ", REQUIRED)).toEqual(["markdown content is empty"]);
  });

  it("does not treat a level-3 heading as a section", () => {
    const md = "## Objective\n\n### Sub\n\ndetail\n\n## Evidence\n\n- [ev1] claim\n";
    expect(validateMarkdownSections(md, REQUIRED)).toEqual([]);
  });
});
