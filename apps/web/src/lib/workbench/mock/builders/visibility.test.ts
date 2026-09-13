import { afterEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "../../types.ts";
import { dataSection, fenceJson } from "../fence.ts";
import { DATA_BLOCK_NOTICE } from "../labels-zh.ts";
import type { VisGap } from "../visibility.ts";
import { FIXTURE_PROFILE } from "./builder-fixtures.ts";
import {
  FIXTURE_GAPS,
  FIXTURE_VIS_RESULTS,
  withGap,
} from "./builder-fixtures-kb.ts";
import {
  type FieldCase,
  HOSTILE_VALUES,
  promptViolations,
  withEveryField,
} from "./hostile-fixtures.ts";
import { splitFences } from "./prompt-test-helpers.ts";
import { answerPlanPrompt, visibilityCsv } from "./visibility.ts";

const HEADER =
  "prompt,platform,mentioned,rank_in_answer,brands_in_answer,cited_domains,source,checked_at";
const CHECKED_AT = "2026-09-12 08:15";
const CSV_INPUT = { results: FIXTURE_VIS_RESULTS, checkedAt: CHECKED_AT };

describe("visibilityCsv", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes the exact header and rows, with an empty rank when not mentioned", () => {
    expect(visibilityCsv(CSV_INPUT).split("\n")).toEqual([
      HEADER,
      "best seo tools,ChatGPT,yes,2,Rival | Acme,g2.com | reddit.com | medium.com,sample,2026-09-12",
      "best seo tools,Perplexity,no,,Rival | Other,capterra.com | g2.com | producthunt.com,sample,2026-09-12",
    ]);
  });

  it("marks every row as sample data and dates it from checkedAt", () => {
    const rows = visibilityCsv({ ...CSV_INPUT, checkedAt: "2025-01-31 23:59" })
      .split("\n")
      .slice(1)
      .map((line) => line.split(","));
    expect(rows.map((cells) => cells[6])).toEqual(["sample", "sample"]);
    expect(rows.map((cells) => cells[7])).toEqual(["2025-01-31", "2025-01-31"]);
  });

  it("does not read the clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2020, 0, 1, 12, 0));
    const early = visibilityCsv(CSV_INPUT);
    vi.setSystemTime(new Date(2031, 5, 15, 23, 59));
    expect(visibilityCsv(CSV_INPUT)).toBe(early);
    expect(early.split("\n")[1]?.endsWith(",sample,2026-09-12")).toBe(true);
  });

  it("neutralises a formula-leading prompt and quotes a brand with a comma", () => {
    const [first] = FIXTURE_VIS_RESULTS;
    if (first === undefined) throw new Error("fixture has no result");
    const line = visibilityCsv({
      checkedAt: CHECKED_AT,
      results: [{ ...first, p: "=cmd|' /C calc'!A0", brands: ["Rival, Inc.", "Acme"] }],
    }).split("\n")[1];
    expect(line).toBe(
      `'=cmd|' /C calc'!A0,ChatGPT,yes,2,"Rival, Inc. | Acme",g2.com | reddit.com | medium.com,sample,2026-09-12`,
    );
  });

  it("writes only the header without results", () => {
    expect(visibilityCsv({ results: [], checkedAt: CHECKED_AT })).toBe(HEADER);
  });
});

interface PlanInput {
  readonly profile: Profile;
  readonly gaps: readonly VisGap[];
}

const PLAN_BASE: PlanInput = { profile: FIXTURE_PROFILE, gaps: FIXTURE_GAPS };
const PLAN_EMPTY: PlanInput = { profile: FIXTURE_PROFILE, gaps: [] };
const PLAN_TITLE = "# 任务：为没被提及的提问建答案页";
const GAP_HEADING = "## 缺口（AI 答案里没有我们）";
const NO_GAPS = "还没有可见度缺口数据：先跑一次 AI 可见度诊断。";
const SAMPLE_GAPS =
  "下面的缺口来自示例数据，不是真实的 AI 回答；先在对应平台上逐条复核，复核不到的提问不要建页。";
const PAGE_STEPS = `## 每页要求

1. URL 与 H1：H1 直接用提问原句
2. 第一段 60 词内给出完整答案，能被整段摘走
3. 必须有：一句定义、一张对比表、3 个带数字的事实、一段"不适合谁"
4. 事实标注来源与核对日期，查不到写 [需补数据]
5. 输出 FAQPage JSON-LD
6. 给 llms.txt 追加片段，把这几页的结论句列进去

先输出页面清单和每页的结论句，我确认后再展开正文。`;
const PRODUCT = {
  brand: "Acme",
  positioning: "给小团队用的 SEO 检查工具",
  url: "https://acme.io",
  competitors: ["Rival", "Other"],
};
const GAP_DATA = [
  {
    prompt: "best seo tools",
    missingOn: ["Perplexity", "Gemini"],
    rivalsInAnswer: ["Rival", "Other"],
  },
  { prompt: "acme vs rival", missingOn: ["Claude"], rivalsInAnswer: [] },
];

function profileField(
  key: "brand" | "positioning" | "url" | "competitors",
): FieldCase<PlanInput> {
  return {
    field: `profile.${key}`,
    apply: (input, value) => ({
      ...input,
      profile: { ...input.profile, [key]: value },
    }),
  };
}

function gapField(
  field: string,
  patch: (gap: VisGap, value: string) => Partial<VisGap>,
): FieldCase<PlanInput> {
  return {
    field: `gaps[0].${field}`,
    apply: (input, value) => ({
      ...input,
      gaps: input.gaps.map((gap, i) =>
        i === 0 ? { ...gap, ...patch(gap, value) } : gap,
      ),
    }),
  };
}

const PROFILE_CASES = (
  ["brand", "positioning", "url", "competitors"] as const
).map(profileField);
const GAP_CASES: readonly FieldCase<PlanInput>[] = [
  gapField("p", (_gap, value) => ({ p: value })),
  gapField("missedPlatforms[0]", (gap, value) => ({
    missedPlatforms: [value, ...gap.missedPlatforms.slice(1)],
  })),
  gapField("rivals[0]", (gap, value) => ({
    rivals: [value, ...gap.rivals.slice(1)],
  })),
];
const PLAN_CASES = [...PROFILE_CASES, ...GAP_CASES];

describe("answerPlanPrompt", () => {
  const prompt = answerPlanPrompt(PLAN_BASE);

  it("puts the product and the gaps in two announced blocks between fixed text", () => {
    expect(prompt).toBe(
      [
        PLAN_TITLE,
        "## 产品资料",
        dataSection(fenceJson(PRODUCT)),
        GAP_HEADING,
        SAMPLE_GAPS,
        dataSection(fenceJson(GAP_DATA)),
        PAGE_STEPS,
      ].join("\n\n"),
    );
  });

  it("parses back to the product and gap data, with nothing user-supplied outside", () => {
    const { blocks, outside } = splitFences(prompt);
    expect(blocks.map((block) => block.info)).toEqual(["json", "json"]);
    expect(
      blocks.every((block) => block.before.trimEnd().endsWith(DATA_BLOCK_NOTICE)),
    ).toBe(true);
    expect(JSON.parse(blocks[0]?.body ?? "")).toEqual(PRODUCT);
    expect(JSON.parse(blocks[1]?.body ?? "")).toEqual(GAP_DATA);
    for (const value of ["Acme", "acme.io", "best seo tools", "Rival", "Gemini"]) {
      expect(outside).not.toContain(value);
    }
  });

  it("does not throw on empty gaps: fixed sentence, no gap block, product block kept", () => {
    const out = answerPlanPrompt(PLAN_EMPTY);
    const { blocks, outside } = splitFences(out);
    expect(blocks).toHaveLength(1);
    expect(JSON.parse(blocks[0]?.body ?? "")).toEqual(PRODUCT);
    expect(outside).toContain(`${GAP_HEADING}\n\n${NO_GAPS}\n\n## 每页要求`);
    expect(out).not.toContain("missingOn");
    expect(out).not.toContain(SAMPLE_GAPS);
    expect(out.endsWith(PAGE_STEPS)).toBe(true);
  });

  it("sends an empty competitor list rather than a placeholder name", () => {
    const out = answerPlanPrompt({
      ...PLAN_BASE,
      profile: { ...FIXTURE_PROFILE, competitors: " , " },
    });
    const data = JSON.parse(splitFences(out).blocks[0]?.body ?? "") as {
      competitors: unknown;
    };
    expect(data.competitors).toEqual([]);
  });

  it("never says 实测", () => {
    expect(prompt).not.toContain("实测");
    expect(answerPlanPrompt(PLAN_EMPTY)).not.toContain("实测");
  });

  describe.each(PLAN_CASES)("hostile $field", ({ apply }) => {
    it.each(HOSTILE_VALUES)("$name stays inside the data blocks", (hostile) => {
      const input = apply(PLAN_BASE, hostile.value);
      const out = answerPlanPrompt(input);
      expect(promptViolations(out, hostile)).toEqual([]);
      expect(answerPlanPrompt(input)).toBe(out);
    });
  });

  describe.each(PROFILE_CASES)("hostile $field without gaps", ({ apply }) => {
    it.each(HOSTILE_VALUES)("$name stays inside the product block", (hostile) => {
      const out = answerPlanPrompt(apply(PLAN_EMPTY, hostile.value));
      expect(promptViolations(out, hostile)).toEqual([]);
    });
  });

  it.each(HOSTILE_VALUES)("every field hostile at once: $name", (hostile) => {
    const out = answerPlanPrompt(
      withEveryField(PLAN_BASE, PLAN_CASES, hostile.value),
    );
    expect(promptViolations(out, hostile)).toEqual([]);
  });

  it("does not change the gaps it is given", () => {
    const gaps = Object.freeze(withGap(FIXTURE_GAPS, 0, {}).map((gap) => Object.freeze({ ...gap })));
    answerPlanPrompt({ profile: FIXTURE_PROFILE, gaps });
    expect(gaps).toEqual(FIXTURE_GAPS);
  });
});
