import { describe, expect, it } from "vitest";
import { LEVELS, LINK_TYPES } from "../../enums.ts";
import type { LinkTarget, Profile } from "../../types.ts";
import { dataSection, fenceJson } from "../fence.ts";
import { DATA_BLOCK_NOTICE } from "../labels-zh.ts";
import { FIXTURE_PROFILE } from "./builder-fixtures.ts";
import { FIXTURE_TARGETS, withTarget } from "./builder-fixtures-kb.ts";
import {
  type FieldCase,
  HOSTILE_VALUES,
  promptViolations,
  withEveryField,
} from "./hostile-fixtures.ts";
import { linkCsv, linkTaskPrompt, outreachPrompt } from "./links.ts";
import { splitFences } from "./prompt-test-helpers.ts";

const HEADER =
  "type,site,domain,dr,relevance,difficulty,action,asset_to_offer,contact";
const CHANNEL_LINE = "media,行业播客,,,mid,,联系主持人提选题,可分享的使用数据,";

/** The fixture's channel entries: no domain, so no DR and no difficulty (Task 8 ruling). */
const CHANNELS = FIXTURE_TARGETS.filter((target) => target.domain === "");

describe("linkCsv", () => {
  it("writes the exact header and id-valued type and level columns, contact empty", () => {
    expect(linkCsv(FIXTURE_TARGETS).split("\n")).toEqual([
      HEADER,
      "dir,Product Hunt,producthunt.com,91,high,high,提交产品页,产品截图与一句话介绍,",
      "dir,SaaSHub,saashub.com,72,mid,low,提交收录申请,产品描述与分类,",
      CHANNEL_LINE,
    ]);
  });

  it("outputs ids only in the type and relevance columns, and an id or nothing for difficulty", () => {
    const rows = linkCsv(FIXTURE_TARGETS)
      .split("\n")
      .slice(1)
      .map((line) => line.split(","));
    const types: readonly (string | undefined)[] = LINK_TYPES;
    const levels: readonly (string | undefined)[] = LEVELS;
    expect(rows.every((cells) => types.includes(cells[0]))).toBe(true);
    expect(rows.every((cells) => levels.includes(cells[4]))).toBe(true);
    expect(
      rows.every((cells) => levels.includes(cells[5]) || cells[5] === ""),
    ).toBe(true);
  });

  it("leaves dr and difficulty empty for a channel without a domain", () => {
    expect(CHANNELS.map((target) => [target.dr, target.difficulty])).toEqual([
      [null, null],
    ]);
    expect(linkCsv(CHANNELS)).toBe(`${HEADER}\n${CHANNEL_LINE}`);
  });

  it("neutralises formula-leading cells", () => {
    const line = linkCsv(
      withTarget(FIXTURE_TARGETS, 0, {
        site: "=cmd|' /C calc'!A0",
        action: "+1",
      }),
    ).split("\n")[1];
    expect(line).toBe(
      "dir,'=cmd|' /C calc'!A0,producthunt.com,91,high,high,'+1,产品截图与一句话介绍,",
    );
  });

  it("writes only the header without targets", () => {
    expect(linkCsv([])).toBe(HEADER);
  });
});

interface Input {
  readonly targets: readonly LinkTarget[];
  readonly profile: Profile;
}

const BASE: Input = { targets: FIXTURE_TARGETS, profile: FIXTURE_PROFILE };
const PRODUCT = {
  brand: "Acme",
  url: "https://acme.io",
  positioning: "给小团队用的 SEO 检查工具",
};
const CANDIDATES_NOTE =
  "下面的候选站点来自工作台内置清单，DR 与难度是示例值；逐个核实后再动。";
const CANDIDATES = [
  {
    type: "工具目录站",
    site: "Product Hunt",
    domain: "producthunt.com",
    dr: 91,
    difficulty: "高",
    action: "提交产品页",
    assetToOffer: "产品截图与一句话介绍",
  },
  {
    type: "工具目录站",
    site: "SaaSHub",
    domain: "saashub.com",
    dr: 72,
    difficulty: "低",
    action: "提交收录申请",
    assetToOffer: "产品描述与分类",
  },
  {
    type: "行业媒体与 newsletter",
    site: "行业播客",
    domain: null,
    dr: null,
    difficulty: null,
    action: "联系主持人提选题",
    assetToOffer: "可分享的使用数据",
  },
];
const LINK_STEPS = `## 你要做的

1. 逐个访问，确认现在是否还接受收录、是否 dofollow、提交入口的真实 URL
2. 补充联系方式，找不到写 n/a，不要编邮箱
3. 补 10 个清单里没有的目标：搜 "best [关键词] tools" 类页面，挑接受新增条目的
4. 按难度从低到高排序，难度未知的排最后，输出 CSV：type,site,url,dofollow,submit_url,contact,difficulty,note`;
const OUTREACH_RULES = `## 要求

- 每版不超过 90 词，主题行不超过 6 个词
- 第一句提到对方的具体内容（留 [具体页面/观点] 占位）
- 中间一句说明能提供什么：数据、免费工具或可嵌入图表选一个；我没说有的就留 [可提供的资产] 占位，不要编
- 结尾一个低门槛问句，不要"期待回复"
- 三版差异：A 提供数据资产、B 指出对方清单缺漏、C 提出互换内容

另给一版 4 天后的跟进邮件，不超过 40 词。不要夸张形容词，不要群发感。`;

function profileField(key: "brand" | "url" | "positioning"): FieldCase<Input> {
  return {
    field: `profile.${key}`,
    apply: (input, value) => ({
      ...input,
      profile: { ...input.profile, [key]: value },
    }),
  };
}

function targetField(
  key: "site" | "domain" | "action" | "asset",
): FieldCase<Input> {
  return {
    field: `targets[0].${key}`,
    apply: (input, value) => ({
      ...input,
      targets: withTarget(input.targets, 0, { [key]: value }),
    }),
  };
}

const PROFILE_CASES = (["brand", "url", "positioning"] as const).map(
  profileField,
);
const LINK_CASES: readonly FieldCase<Input>[] = [
  ...PROFILE_CASES,
  ...(["site", "domain", "action", "asset"] as const).map(targetField),
];

function blockData(prompt: string, index: number): unknown {
  return JSON.parse(splitFences(prompt).blocks[index]?.body ?? "");
}

describe("linkTaskPrompt", () => {
  const prompt = linkTaskPrompt(BASE);

  it("keeps the title, notes and steps fixed and fences the product and candidates", () => {
    expect(prompt).toBe(
      [
        "# 任务：核实外链目标并开始外联",
        "## 产品资料",
        dataSection(fenceJson(PRODUCT)),
        "## 候选",
        CANDIDATES_NOTE,
        dataSection(fenceJson(CANDIDATES)),
        LINK_STEPS,
      ].join("\n\n"),
    );
  });

  it("announces both blocks and keeps target data out of the instructions", () => {
    const { blocks, outside } = splitFences(prompt);
    expect(blocks.map((block) => block.info)).toEqual(["json", "json"]);
    expect(
      blocks.every((block) =>
        block.before.trimEnd().endsWith(DATA_BLOCK_NOTICE),
      ),
    ).toBe(true);
    for (const value of [
      "Acme",
      "acme.io",
      "Product Hunt",
      "producthunt.com",
    ]) {
      expect(outside).not.toContain(value);
    }
  });

  it("keeps a channel's missing DR, difficulty and domain as null inside the block only", () => {
    const out = linkTaskPrompt({ ...BASE, targets: CHANNELS });
    const { blocks, outside } = splitFences(out);
    const body = blocks[1]?.body ?? "";
    expect(body).toContain('"domain": null');
    expect(body).toContain('"dr": null');
    expect(body).toContain('"difficulty": null');
    expect(outside).not.toContain("null");
    expect(outside).toContain("难度未知的排最后");
  });

  it("never says 实测", () => {
    expect(prompt).not.toContain("实测");
  });

  describe.each(LINK_CASES)("hostile $field", ({ apply }) => {
    it.each(HOSTILE_VALUES)("$name stays inside the data blocks", (hostile) => {
      const input = apply(BASE, hostile.value);
      const out = linkTaskPrompt(input);
      expect(promptViolations(out, hostile)).toEqual([]);
      expect(linkTaskPrompt(input)).toBe(out);
    });
  });

  it.each(HOSTILE_VALUES)("every field hostile at once: $name", (hostile) => {
    const out = linkTaskPrompt(withEveryField(BASE, LINK_CASES, hostile.value));
    expect(promptViolations(out, hostile)).toEqual([]);
  });
});

describe("outreachPrompt", () => {
  const prompt = outreachPrompt(BASE);

  it("fences the sender and the deduped recipient type names", () => {
    expect(prompt).toBe(
      [
        "# 任务：写 3 版外联邮件",
        "## 发件方与收件方类型",
        dataSection(
          fenceJson({
            sender: PRODUCT,
            recipientTypes: ["工具目录站", "行业媒体与 newsletter"],
          }),
        ),
        OUTREACH_RULES,
      ].join("\n\n"),
    );
  });

  it("dedupes type ids in first-appearance order before labelling them", () => {
    const types = ["agg", "dir", "agg", "comm", "dir"] as const;
    const targets = types.flatMap((type, i) =>
      withTarget(FIXTURE_TARGETS.slice(0, 1), 0, { type, site: `site-${i}` }),
    );
    const data = blockData(outreachPrompt({ ...BASE, targets }), 0) as {
      recipientTypes: unknown;
    };
    expect(data.recipientTypes).toEqual([
      "同类工具聚合页",
      "工具目录站",
      "社区问答",
    ]);
  });

  it("names a channel's type without printing its missing DR or difficulty anywhere", () => {
    const out = outreachPrompt({ ...BASE, targets: CHANNELS });
    const data = blockData(out, 0) as { recipientTypes: unknown };
    expect(data.recipientTypes).toEqual(["行业媒体与 newsletter"]);
    expect(out).not.toContain("null");
  });

  it("does not read the candidate sites", () => {
    expect(prompt).not.toContain("Product Hunt");
    expect(prompt).not.toContain("producthunt.com");
  });

  it("never says 实测", () => {
    expect(prompt).not.toContain("实测");
  });

  describe.each(PROFILE_CASES)("hostile $field", ({ apply }) => {
    it.each(HOSTILE_VALUES)("$name stays inside the data block", (hostile) => {
      const input = apply(BASE, hostile.value);
      const out = outreachPrompt(input);
      expect(promptViolations(out, hostile)).toEqual([]);
      expect(outreachPrompt(input)).toBe(out);
    });
  });

  it.each(HOSTILE_VALUES)("every field hostile at once: $name", (hostile) => {
    const out = outreachPrompt(
      withEveryField(BASE, PROFILE_CASES, hostile.value),
    );
    expect(promptViolations(out, hostile)).toEqual([]);
  });
});
