import { describe, expect, it } from "vitest";
import type { Profile } from "../../types.ts";
import { dataSection, fenceJson } from "../fence.ts";
import { DATA_BLOCK_NOTICE } from "../labels-zh.ts";
import { FIXTURE_PROFILE } from "./builder-fixtures.ts";
import {
  type FieldCase,
  HOSTILE_VALUES,
  promptViolations,
  withEveryField,
} from "./hostile-fixtures.ts";
import { reportTaskPrompt } from "./links.ts";
import { splitFences } from "./prompt-test-helpers.ts";

interface Input {
  readonly profile: Profile;
  readonly angle: string;
}

const TITLE = "# 任务：做一份可被引用的原创数据报告";
const ANGLE_PENDING = "切入角度待定，先帮我提 3 个。";
const ANGLE_GIVEN = "切入角度按资料里的 angle。";
const TAIL = `目标：产出别人写文章时会引用的数字资产。

1. 提出 3 个能用我们自有数据回答的问题
2. 每个问题给出：需要字段、样本量要求、统计口径、可能偏差
3. 结构：一句话核心发现 → 3 个可独立引用的数字 → 方法论 → 分场景解读 → 原始数据下载
4. 每个关键数字单独成句，写成能被整句摘走的形式
5. 配一个可嵌入图表和一段引用规范
6. 出一版摘要页文案，用于媒体和目录站分发

不要写没有数据支撑的趋势判断。`;

const BASE: Input = { profile: FIXTURE_PROFILE, angle: " 小团队的收录速度 " };
const BLANK: Input = { profile: FIXTURE_PROFILE, angle: " \n " };

function product(angle: string | null): unknown {
  return {
    brand: "Acme",
    positioning: "给小团队用的 SEO 检查工具",
    market: "US",
    angle,
  };
}

function profileField(key: "brand" | "positioning" | "market"): FieldCase<Input> {
  return {
    field: `profile.${key}`,
    apply: (input, value) => ({
      ...input,
      profile: { ...input.profile, [key]: value },
    }),
  };
}

const PROFILE_CASES = (["brand", "positioning", "market"] as const).map(profileField);
const CASES: readonly FieldCase<Input>[] = [
  ...PROFILE_CASES,
  { field: "angle", apply: (input, value) => ({ ...input, angle: value }) },
];

describe("reportTaskPrompt", () => {
  it("fences the trimmed angle with the product and points to it", () => {
    expect(reportTaskPrompt(BASE)).toBe(
      [
        TITLE,
        "## 产品资料",
        dataSection(fenceJson(product("小团队的收录速度"))),
        ANGLE_GIVEN,
        TAIL,
      ].join("\n\n"),
    );
  });

  it("sends angle null and asks for three angles outside the block when it is blank", () => {
    const out = reportTaskPrompt(BLANK);
    expect(out).toBe(
      [
        TITLE,
        "## 产品资料",
        dataSection(fenceJson(product(null))),
        ANGLE_PENDING,
        TAIL,
      ].join("\n\n"),
    );
    const { blocks, outside } = splitFences(out);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.before.trimEnd().endsWith(DATA_BLOCK_NOTICE)).toBe(true);
    expect(outside).toContain(ANGLE_PENDING);
    expect(blocks[0]?.body).not.toContain(ANGLE_PENDING);
  });

  it("keeps the angle and the product out of the instructions", () => {
    const { outside } = splitFences(reportTaskPrompt(BASE));
    for (const value of ["小团队的收录速度", "Acme", "SEO 检查工具"]) {
      expect(outside).not.toContain(value);
    }
    expect(outside).not.toContain(ANGLE_PENDING);
  });

  it("never says 实测", () => {
    expect(reportTaskPrompt(BASE)).not.toContain("实测");
    expect(reportTaskPrompt(BLANK)).not.toContain("实测");
  });

  describe.each(CASES)("hostile $field", ({ apply }) => {
    it.each(HOSTILE_VALUES)("$name stays inside the data block", (hostile) => {
      const input = apply(BASE, hostile.value);
      const out = reportTaskPrompt(input);
      expect(promptViolations(out, hostile)).toEqual([]);
      expect(reportTaskPrompt(input)).toBe(out);
    });
  });

  describe.each(PROFILE_CASES)("hostile $field with a blank angle", ({ apply }) => {
    it.each(HOSTILE_VALUES)("$name stays inside the data block", (hostile) => {
      const out = reportTaskPrompt(apply(BLANK, hostile.value));
      expect(promptViolations(out, hostile)).toEqual([]);
    });
  });

  it.each(HOSTILE_VALUES)("every field hostile at once: $name", (hostile) => {
    const out = reportTaskPrompt(withEveryField(BASE, CASES, hostile.value));
    expect(promptViolations(out, hostile)).toEqual([]);
  });
});
