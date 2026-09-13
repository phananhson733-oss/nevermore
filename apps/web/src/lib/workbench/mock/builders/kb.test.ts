import { describe, expect, it } from "vitest";
import { KB_CATEGORIES } from "../../enums.ts";
import type { KbEntry, Profile } from "../../types.ts";
import { KB_SECTION_TITLE_ZH } from "../labels-zh.ts";
import { FIXTURE_PROFILE } from "./builder-fixtures.ts";
import {
  FIXTURE_KB_ENTRIES,
  KB_DOC_HOSTILE_VALUES,
  withEntry,
} from "./builder-fixtures-kb.ts";
import {
  type FieldCase,
  blockTokenCounts,
  docViolations,
  headingLines,
  withEveryField,
} from "./hostile-fixtures.ts";
import { kbMarkdown } from "./kb.ts";

interface Input {
  readonly profile: Profile;
  readonly entries: readonly KbEntry[];
}

const BASE: Input = { profile: FIXTURE_PROFILE, entries: FIXTURE_KB_ENTRIES };

const EXPECTED = `# Acme 事实知识库

> 每条都是可被模型整段摘走的句子。改完同步到 /llms.txt、About、定价页与 FAQ。
> 站点：https://acme.io｜市场：US｜条目 8 条，已写 6 条

## 定义
- Acme 是给小团队用的 SEO 检查工具｜证据：来自站点档案字段
- Acme 是第二条定义｜[待补证据]

## 能做什么
- Acme 提供 站点审计｜[待补证据]｜来源：https://acme.io/features

## 不适合谁
- [缺口：补一句 不适合谁]

## 定价
- [缺口：补一句 定价]

## 与同类产品的差别
- [缺口：补一句 与同类产品的差别]

## 可引用数据
- [缺口：补一句 可引用数据]

## 常见问题
- Acme 支持中文站吗 → 支持 → 需要先填市场｜证据：示例，未核对
- → 没有问题的答案｜[待补证据]
- 没有箭头的问题｜[待补证据]

## 维护规则
- 每条事实必须能在站内某个 URL 上找到原句
- 带数字的事实标注核对日期
- 每季度复核一次，过期的先删再补`;

function profileField(key: "brand" | "url" | "market"): FieldCase<Input> {
  return {
    field: `profile.${key}`,
    apply: (input, value) => ({
      ...input,
      profile: { ...input.profile, [key]: value },
    }),
  };
}

function entryField(
  index: number,
  key: "statement" | "evidence" | "source",
): FieldCase<Input> {
  return {
    field: `entries[${index}].${key}`,
    apply: (input, value) => ({
      ...input,
      entries: withEntry(input.entries, index, { [key]: value }),
    }),
  };
}

const CASES: readonly FieldCase<Input>[] = [
  ...(["brand", "url", "market"] as const).map(profileField),
  entryField(0, "statement"),
  entryField(0, "evidence"),
  entryField(1, "source"),
  entryField(4, "statement"),
];

describe("kbMarkdown", () => {
  it("renders the fixture knowledge base", () => {
    expect(kbMarkdown(BASE)).toBe(EXPECTED);
  });

  it("emits one section per category in KB_CATEGORIES order, then the maintenance rules", () => {
    expect(headingLines(kbMarkdown(BASE))).toEqual([
      "# Acme 事实知识库",
      ...KB_CATEGORIES.map((cat) => `## ${KB_SECTION_TITLE_ZH[cat]}`),
      "## 维护规则",
    ]);
  });

  it("fills a gap line in every section of an empty knowledge base", () => {
    const doc = kbMarkdown({
      profile: { ...FIXTURE_PROFILE, brand: " " },
      entries: [],
    });
    expect(doc.split("\n")[0]).toBe("# [品牌] 事实知识库");
    expect(doc).toContain("｜条目 0 条，已写 0 条");
    for (const cat of KB_CATEGORIES) {
      const title = KB_SECTION_TITLE_ZH[cat];
      expect(doc).toContain(`## ${title}\n- [缺口：补一句 ${title}]\n\n`);
    }
  });

  it("treats blank evidence as missing and leaves out a blank source", () => {
    const entry: KbEntry = {
      id: "kb-01",
      cat: "definition",
      statement: "X 是 Y",
      evidence: "\n ",
      source: " \r\n",
      from: "manual",
    };
    const doc = kbMarkdown({ profile: FIXTURE_PROFILE, entries: [entry] });
    expect(doc).toContain("## 定义\n- X 是 Y｜[待补证据]\n\n");
    expect(doc).not.toContain("来源：");
  });

  it("never says 实测", () => {
    expect(kbMarkdown(BASE)).not.toContain("实测");
  });

  it("keeps a statement with a heading after a newline on its bullet line", () => {
    const doc = kbMarkdown({
      ...BASE,
      entries: withEntry(FIXTURE_KB_ENTRIES, 0, {
        statement: "安全\n# 伪标题",
      }),
    });
    expect(headingLines(doc)).toEqual(headingLines(EXPECTED));
    expect(blockTokenCounts(doc)).toEqual(blockTokenCounts(EXPECTED));
    expect(doc).toContain("\n- 安全 # 伪标题｜证据：来自站点档案字段\n");
  });

  it("escapes a statement that would open a block at the start of its bullet", () => {
    const doc = kbMarkdown({
      ...BASE,
      entries: withEntry(FIXTURE_KB_ENTRIES, 0, { statement: "# 伪标题" }),
    });
    expect(doc).toContain("\n- \\# 伪标题｜证据：来自站点档案字段\n");
  });

  it("does not change its input and gives the same text twice", () => {
    const entries = Object.freeze(
      FIXTURE_KB_ENTRIES.map((entry) => Object.freeze({ ...entry })),
    );
    const profile = Object.freeze({ ...FIXTURE_PROFILE });
    const first = kbMarkdown({ profile, entries });
    expect(kbMarkdown({ profile, entries })).toBe(first);
    expect(entries).toEqual(FIXTURE_KB_ENTRIES);
  });

  describe.each(CASES)("hostile $field", ({ apply }) => {
    it.each(KB_DOC_HOSTILE_VALUES)("$name stays on its line", (hostile) => {
      const doc = kbMarkdown(apply(BASE, hostile.value));
      expect(docViolations(doc, EXPECTED, hostile)).toEqual([]);
    });
  });

  it.each(KB_DOC_HOSTILE_VALUES)(
    "every field hostile at once: $name",
    (hostile) => {
      const doc = kbMarkdown(withEveryField(BASE, CASES, hostile.value));
      expect(docViolations(doc, EXPECTED, hostile)).toEqual([]);
    },
  );
});
