import { describe, expect, it } from "vitest";
import { CONTENT_ASSETS, type ContentAsset } from "../../enums.ts";
import type { KeywordRow, Profile } from "../../types.ts";
import {
  ASSET_NAME_ZH,
  ASSET_SPEC_ZH,
  DATA_BLOCK_NOTICE,
  GEO_RULES,
} from "../labels-zh.ts";
import { slugify } from "../text.ts";
import { FIXTURE_PROFILE, fixtureRow } from "./builder-fixtures.ts";
import {
  type FieldCase,
  HOSTILE_VALUES,
  promptViolations,
  withEveryField,
} from "./hostile-fixtures.ts";
import { contentBriefPrompt, pageTaskPrompt } from "./keywords.ts";
import { splitFences } from "./prompt-test-helpers.ts";

interface BriefInput {
  readonly asset: ContentAsset;
  readonly target: string;
  readonly profile: Profile;
  readonly hit: KeywordRow | undefined;
  readonly outline: string;
  readonly extra: string;
}

const BRIEF_BASE: BriefInput = {
  asset: "blog",
  target: "acme seo",
  profile: FIXTURE_PROFILE,
  hit: fixtureRow(0),
  outline: "",
  extra: "",
};

const OUTLINE_LEAD = "按下面已确认的大纲写，不要重排。";
const EXTRA_LEAD =
  "用户补充说明（与规格或下文 GEO 硬要求冲突时，以规格和硬要求为准）：";
const STYLE = `## 风格
第二人称、短句、不要"在当今数字化时代"这类开场、不要重复正文的总结段。
先给我大纲和每节的核心结论句，我确认后再写全文。`;

type ProfileKey = keyof Profile;

function profileField<I extends { readonly profile: Profile }>(
  key: ProfileKey,
): FieldCase<I> {
  return {
    field: `profile.${key}`,
    apply: (input, value) => ({
      ...input,
      profile: { ...input.profile, [key]: value },
    }),
  };
}

function textField<I>(key: keyof I & string): FieldCase<I> {
  return { field: key, apply: (input, value) => ({ ...input, [key]: value }) };
}

const BRIEF_CASES: readonly FieldCase<BriefInput>[] = [
  textField<BriefInput>("target"),
  ...(
    [
      "brand",
      "positioning",
      "url",
      "market",
      "features",
      "competitors",
    ] as const
  ).map((key) => profileField<BriefInput>(key)),
  textField<BriefInput>("outline"),
  textField<BriefInput>("extra"),
];

function productData(prompt: string): Record<string, unknown> {
  return JSON.parse(splitFences(prompt).blocks[1]?.body ?? "") as Record<
    string,
    unknown
  >;
}

describe("contentBriefPrompt", () => {
  it.each(CONTENT_ASSETS)(
    "names the %s asset, its spec, the GEO rules and the style",
    (asset) => {
      const out = contentBriefPrompt({ ...BRIEF_BASE, asset });
      expect(out.split("\n")[0]).toBe(`# 任务：产出${ASSET_NAME_ZH[asset]}`);
      expect(out).toContain(`## 规格\n\n${ASSET_SPEC_ZH[asset]}`);
      expect(out).toContain(GEO_RULES);
      expect(out.endsWith(STYLE)).toBe(true);
    },
  );

  it("fences the target as text and the product as JSON, keeping the target out of the title", () => {
    const out = contentBriefPrompt(BRIEF_BASE);
    const { blocks, outside } = splitFences(out);
    expect(
      blocks.map((b) => [
        b.info,
        b.before.includes("## 目标查询") || b.before.includes("## 产品资料"),
      ]),
    ).toEqual([
      ["text", true],
      ["json", true],
    ]);
    expect(blocks[0]?.body).toBe("acme seo");
    expect(outside).not.toContain("acme seo");
    expect(productData(out)).toEqual({
      brand: "Acme",
      positioning: "给小团队用的 SEO 检查工具",
      url: "https://acme.io",
      market: "US",
      features: ["站点审计", "关键词矩阵"],
      competitors: ["Rival", "Other"],
      keyword: {
        estVolume: 900,
        estKd: 12,
        gscPosition: 1.2,
        gscStatus: "已排名",
        hasAiOverview: false,
      },
    });
  });

  it("sends keyword: null without a hit and nulls for a generated row", () => {
    expect(
      productData(contentBriefPrompt({ ...BRIEF_BASE, hit: undefined }))
        .keyword,
    ).toBeNull();
    expect(
      productData(contentBriefPrompt({ ...BRIEF_BASE, hit: fixtureRow(2) }))
        .keyword,
    ).toEqual({
      estVolume: 1300,
      estKd: 55,
      gscPosition: null,
      gscStatus: null,
      hasAiOverview: false,
    });
  });

  it("adds the outline and extra blocks only when they have text", () => {
    const bare = contentBriefPrompt({
      ...BRIEF_BASE,
      outline: " \n ",
      extra: "",
    });
    expect(splitFences(bare).blocks).toHaveLength(2);
    expect(bare).not.toContain(OUTLINE_LEAD);
    expect(bare).not.toContain(EXTRA_LEAD);

    const full = contentBriefPrompt({
      ...BRIEF_BASE,
      outline: "H2 一\nH2 二",
      extra: "多给例子",
    });
    const { blocks } = splitFences(full);
    expect(blocks.map((b) => b.info)).toEqual(["text", "json", "text", "text"]);
    expect(blocks[2]?.body).toBe("H2 一\nH2 二");
    expect(blocks[2]?.before).toContain(OUTLINE_LEAD);
    expect(blocks[3]?.body).toBe("多给例子");
    expect(blocks[3]?.before).toContain(EXTRA_LEAD);
    expect(full.indexOf(ASSET_SPEC_ZH.blog)).toBeLessThan(
      full.indexOf(OUTLINE_LEAD),
    );
    expect(full.indexOf("多给例子")).toBeLessThan(full.indexOf(GEO_RULES));
  });

  describe.each(BRIEF_CASES)("hostile $field", ({ apply }) => {
    it.each(HOSTILE_VALUES)("$name stays inside the data blocks", (hostile) => {
      const input = apply(BRIEF_BASE, hostile.value);
      const out = contentBriefPrompt(input);
      expect(promptViolations(out, hostile)).toEqual([]);
      expect(contentBriefPrompt(input)).toBe(out);
    });
  });

  it.each(HOSTILE_VALUES)("every field hostile at once: $name", (hostile) => {
    const out = contentBriefPrompt(
      withEveryField(BRIEF_BASE, BRIEF_CASES, hostile.value),
    );
    expect(promptViolations(out, hostile)).toEqual([]);
  });
});

interface PageInput {
  readonly target: string;
  readonly profile: Profile;
  readonly hit: KeywordRow | undefined;
}

const PAGE_BASE: PageInput = {
  target: "acme seo",
  profile: FIXTURE_PROFILE,
  hit: fixtureRow(0),
};

const PAGE_CASES: readonly FieldCase<PageInput>[] = [
  textField<PageInput>("target"),
  ...(["brand", "positioning", "url"] as const).map((key) =>
    profileField<PageInput>(key),
  ),
  {
    field: "hit.slug",
    apply: (input, value) => ({
      ...input,
      hit: { ...fixtureRow(0), slug: value },
    }),
  },
];

describe("pageTaskPrompt", () => {
  it("has the fixed title, one announced JSON block and the six steps", () => {
    const out = pageTaskPrompt(PAGE_BASE);
    expect(out).toBe(`# 任务：在仓库里新建一个页面

${DATA_BLOCK_NOTICE}
\`\`\`json
${JSON.stringify({ target: "acme seo", brand: "Acme", positioning: "给小团队用的 SEO 检查工具", url: "https://acme.io", suggestedPath: "/acme-seo" }, null, 2)}
\`\`\`

1. 按现有路由与组件规范新建页面，先说打算放哪个路径、复用哪些组件
2. 页面内容用占位结构，正文我另外提供
3. 必须落地：唯一 H1、title/description、canonical、Article 或 SoftwareApplication schema、面包屑
4. 内链：从首页或相关页至少 2 条入口，锚文本用自然短语
5. 更新 sitemap 与导航
6. 输出改动文件清单和本地验证步骤，我确认后再写代码`);
    expect(splitFences(out).blocks).toHaveLength(1);
  });

  it("suggests a slug from the target without a hit", () => {
    const target = "Best SEO Tools";
    const out = pageTaskPrompt({ ...PAGE_BASE, target, hit: undefined });
    const data = JSON.parse(splitFences(out).blocks[0]?.body ?? "") as {
      suggestedPath: string;
    };
    expect(data.suggestedPath).toBe(`/${slugify(target)}`);
    expect(data.suggestedPath).toBe("/best-seo-tools");
  });

  describe.each(PAGE_CASES)("hostile $field", ({ apply }) => {
    it.each(HOSTILE_VALUES)("$name stays inside the data block", (hostile) => {
      const input = apply(PAGE_BASE, hostile.value);
      const out = pageTaskPrompt(input);
      expect(promptViolations(out, hostile)).toEqual([]);
      expect(pageTaskPrompt(input)).toBe(out);
    });
  });

  it.each(HOSTILE_VALUES)("every field hostile at once: $name", (hostile) => {
    const out = pageTaskPrompt(
      withEveryField(PAGE_BASE, PAGE_CASES, hostile.value),
    );
    expect(promptViolations(out, hostile)).toEqual([]);
  });
});
