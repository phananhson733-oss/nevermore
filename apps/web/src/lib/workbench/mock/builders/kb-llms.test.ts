import { describe, expect, it } from "vitest";
import type { KbEntry, Profile } from "../../types.ts";
import { FIXTURE_PROFILE } from "./builder-fixtures.ts";
import {
  FIXTURE_KB_ENTRIES,
  KB_DOC_HOSTILE_VALUES,
  markdownViolations,
  withEntry,
} from "./builder-fixtures-kb.ts";
import { type FieldCase, withEveryField } from "./hostile-fixtures.ts";
import { llmsTxt } from "./kb.ts";

interface Input {
  readonly profile: Profile;
  readonly entries: readonly KbEntry[];
}

const BASE: Input = { profile: FIXTURE_PROFILE, entries: FIXTURE_KB_ENTRIES };
const NO_DEFINITION: Input = {
  ...BASE,
  entries: FIXTURE_KB_ENTRIES.filter((entry) => entry.cat !== "definition"),
};
const KEY_PAGES_PLACEHOLDER = "- [补关键页 URL：定价 / 文档 / 对比]";

const EXPECTED = `# acme.io

> 给小团队用的 SEO 检查工具

## About
- Acme 是给小团队用的 SEO 检查工具
- Acme 是第二条定义

## Capabilities
- Acme 提供 站点审计

## Not a fit for
- [补边界]

## Pricing
- [补定价事实]

## Compared to alternatives
- [补对比事实]

## Key pages
- https://acme.io/
${KEY_PAGES_PLACEHOLDER}

## Contact
- https://acme.io`;

function profileField(key: keyof Profile): FieldCase<Input> {
  return {
    field: `profile.${key}`,
    apply: (input, value) => ({
      ...input,
      profile: { ...input.profile, [key]: value },
    }),
  };
}

function statementField(index: number): FieldCase<Input> {
  return {
    field: `entries[${index}].statement`,
    apply: (input, value) => ({
      ...input,
      entries: withEntry(input.entries, index, { statement: value }),
    }),
  };
}

const CASES: readonly FieldCase<Input>[] = [
  profileField("url"),
  profileField("positioning"),
  statementField(0),
  statementField(1),
];

function keyPages(text: string): string | undefined {
  return text.split("## Key pages\n")[1]?.split("\n\n")[0];
}

describe("llmsTxt", () => {
  it("renders the fixture as llms.txt", () => {
    expect(llmsTxt(BASE)).toBe(EXPECTED);
  });

  it("lists only the home page and a placeholder under Key pages", () => {
    const text = llmsTxt({
      ...BASE,
      profile: { ...FIXTURE_PROFILE, features: "定价, 文档, 对比, 免费工具" },
    });
    expect(keyPages(text)).toBe(`- https://acme.io/\n${KEY_PAGES_PLACEHOLDER}`);
    for (const path of ["/compare/", "/tools/", "/docs"]) {
      expect(text).not.toContain(path);
    }
  });

  it("omits the summary line when positioning is blank", () => {
    const text = llmsTxt({
      ...BASE,
      profile: { ...FIXTURE_PROFILE, positioning: " \n " },
    });
    expect(text.startsWith("# acme.io\n\n## About\n")).toBe(true);
    expect(text.split("\n").some((line) => line.startsWith(">"))).toBe(false);
  });

  it("folds the positioning onto the summary line", () => {
    const text = llmsTxt({
      ...BASE,
      profile: { ...FIXTURE_PROFILE, positioning: "给小团队\n用的工具" },
    });
    expect(
      text.startsWith("# acme.io\n\n> 给小团队 用的工具\n\n## About\n"),
    ).toBe(true);
  });

  it("writes placeholders for sections without written statements", () => {
    expect(llmsTxt(NO_DEFINITION)).toContain("## About\n- Acme 是[补定义]\n\n");
    const blankBrand = llmsTxt({
      profile: { ...FIXTURE_PROFILE, brand: "" },
      entries: [],
    });
    expect(blankBrand).toContain("## About\n- [品牌] 是[补定义]\n\n");
    expect(blankBrand).toContain("## Capabilities\n- [补功能]\n\n");
  });

  it("leaves data and FAQ entries out", () => {
    const text = llmsTxt(BASE);
    expect(text).not.toContain("支持中文站");
    expect(text).not.toContain("没有箭头的问题");
  });

  it("takes the host from the URL and keeps the URL itself for Contact", () => {
    const text = llmsTxt({
      ...BASE,
      profile: { ...FIXTURE_PROFILE, url: "https://www.Acme.io/pricing?x=1" },
    });
    expect(text.startsWith("# acme.io\n")).toBe(true);
    expect(keyPages(text)).toBe(`- https://acme.io/\n${KEY_PAGES_PLACEHOLDER}`);
    expect(text.endsWith("## Contact\n- https://www.Acme.io/pricing?x=1")).toBe(
      true,
    );
  });

  it("uses placeholders instead of an empty host when the URL is blank", () => {
    const text = llmsTxt({
      ...BASE,
      profile: { ...FIXTURE_PROFILE, url: " " },
    });
    expect(text.startsWith("# [站点域名]\n")).toBe(true);
    expect(keyPages(text)).toBe(`- [补站点首页 URL]\n${KEY_PAGES_PLACEHOLDER}`);
    expect(text.endsWith("## Contact\n- [补站点 URL]")).toBe(true);
    expect(text).not.toContain("https:///");
  });

  it("puts each written category under its own section and leaves data out", () => {
    const written = (
      id: string,
      cat: KbEntry["cat"],
      statement: string,
    ): KbEntry => ({
      id,
      cat,
      statement,
      evidence: "",
      source: "",
      from: "manual",
    });
    // Listed against section order, so a right answer cannot come from entry order.
    const text = llmsTxt({
      profile: FIXTURE_PROFILE,
      entries: [
        written("kb-01", "data", "数据条目：示例数字 42"),
        written("kb-02", "comparison", "对比条目：与 Rival 的差别"),
        written("kb-03", "pricing", "定价条目：按席位收费"),
        written("kb-04", "boundary", "边界条目：不适合大型企业"),
        written("kb-05", "capability", "能力条目：站点审计"),
        written("kb-06", "definition", "定义条目：Acme 是检查工具"),
      ],
    });
    const sections = [
      ["About", "定义条目：Acme 是检查工具"],
      ["Capabilities", "能力条目：站点审计"],
      ["Not a fit for", "边界条目：不适合大型企业"],
      ["Pricing", "定价条目：按席位收费"],
      ["Compared to alternatives", "对比条目：与 Rival 的差别"],
    ] as const;
    for (const [title, statement] of sections) {
      expect(text).toContain(`\n## ${title}\n- ${statement}\n\n`);
    }
    expect(text).not.toContain("数据条目");
  });

  it("never says 实测", () => {
    expect(llmsTxt(BASE)).not.toContain("实测");
  });

  describe.each(CASES)("hostile $field", ({ apply }) => {
    it.each(KB_DOC_HOSTILE_VALUES)("$name stays on its line", (hostile) => {
      const text = llmsTxt(apply(BASE, hostile.value));
      expect(markdownViolations(text, EXPECTED, hostile)).toEqual([]);
    });
  });

  it.each(KB_DOC_HOSTILE_VALUES)(
    "hostile brand in the About placeholder: $name",
    (hostile) => {
      const baseline = llmsTxt(NO_DEFINITION);
      const text = llmsTxt(
        profileField("brand").apply(NO_DEFINITION, hostile.value),
      );
      expect(markdownViolations(text, baseline, hostile)).toEqual([]);
    },
  );

  it.each(KB_DOC_HOSTILE_VALUES)(
    "every field hostile at once: $name",
    (hostile) => {
      const text = llmsTxt(withEveryField(BASE, CASES, hostile.value));
      expect(markdownViolations(text, EXPECTED, hostile)).toEqual([]);
    },
  );
});
