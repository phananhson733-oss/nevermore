import { describe, expect, it } from "vitest";
import { KEYWORD_SOURCES } from "../../enums.ts";
import type { KeywordRow, Profile } from "../../types.ts";
import { DATA_BLOCK_NOTICE } from "../labels-zh.ts";
import { FIXTURE_PROFILE, FIXTURE_ROWS, fixtureRow } from "./builder-fixtures.ts";
import {
  type FieldCase,
  HOSTILE_VALUES,
  promptViolations,
  withEveryField,
} from "./hostile-fixtures.ts";
import { keywordCsv, keywordTaskPrompt } from "./keywords.ts";
import { splitFences } from "./prompt-test-helpers.ts";

const HEADER =
  "query,source,intent,stage,engine,page_type,suggested_url,est_volume,est_kd,est_cpc,ai_overview,gsc_position,gsc_clicks,opportunity";

describe("keywordCsv", () => {
  it("writes the exact header and rows, leaving missing GSC columns empty", () => {
    expect(keywordCsv(FIXTURE_ROWS).split("\n")).toEqual([
      HEADER,
      "acme seo,gsc,navigational,BOFU,seo,landing,/acme-seo,900,12,1.20,no,1.2,120,64",
      "seo checklist,gsc,informational,MOFU,both,blog,/blog/seo-checklist,400,40,2.10,yes,,,51",
      "how to rank,generated,informational,TOFU,seo,blog,/blog/how-to-rank,1300,55,0.80,no,,,38",
    ]);
  });

  it("outputs source ids only", () => {
    const sources = keywordCsv(FIXTURE_ROWS)
      .split("\n")
      .slice(1)
      .map((line) => line.split(",")[1]);
    expect(sources.every((s) => (KEYWORD_SOURCES as readonly (string | undefined)[]).includes(s))).toBe(true);
  });

  it("neutralises a formula-leading query", () => {
    const row: KeywordRow = { ...fixtureRow(2), q: "=cmd|' /C calc'!A0" };
    expect(keywordCsv([row]).split("\n")[1]?.startsWith("'=cmd|' /C calc'!A0,generated,")).toBe(true);
  });

  it("writes only the header without rows", () => {
    expect(keywordCsv([])).toBe(HEADER);
  });
});

interface TaskInput {
  readonly rows: readonly KeywordRow[];
  readonly profile: Profile;
}

const TASK_BASE: TaskInput = { rows: FIXTURE_ROWS, profile: FIXTURE_PROFILE };

const TASK_CASES: readonly FieldCase<TaskInput>[] = [
  ...(["url", "market"] as const).map(
    (key): FieldCase<TaskInput> => ({
      field: `profile.${key}`,
      apply: (input, value) => ({ ...input, profile: { ...input.profile, [key]: value } }),
    }),
  ),
  {
    field: "rows[0].q",
    apply: (input, value) => ({
      ...input,
      rows: input.rows.map((row, i) => (i === 0 ? { ...row, q: value } : row)),
    }),
  },
];

describe("keywordTaskPrompt", () => {
  const prompt = keywordTaskPrompt(TASK_BASE);

  it("opens with the fixed title and the four steps, all outside the data", () => {
    expect(prompt.startsWith(`# 任务：核实关键词数据并给出本季度内容排期

## 你要做的

1. 用你能访问的数据源核对每行的 volume 与 kd，改成真实值，查不到写 n/a，不要估算。
2. 补充每个查询当前 SERP 前三名域名，以及是否出现 AI Overview。
3. 按「能不能在 8 周内进前十」给每行打可行性：高 / 中 / 低，并说明依据。
4. 输出排期：前 12 个查询，每个给出页面类型、目标 URL、建议发布周。

## 数据`)).toBe(true);
  });

  it("says the numbers are estimates right before the announced block", () => {
    const { blocks } = splitFences(prompt);
    expect(blocks).toHaveLength(1);
    const before = blocks[0]?.before ?? "";
    expect(before).toContain("volume / kd 是工作台估算值");
    expect(before.trimEnd().endsWith(DATA_BLOCK_NOTICE)).toBe(true);
    expect(before.indexOf("估算值")).toBeLessThan(before.indexOf(DATA_BLOCK_NOTICE));
  });

  it("fences the site and rows, with null for a missing GSC position", () => {
    expect(JSON.parse(splitFences(prompt).blocks[0]?.body ?? "")).toEqual({
      site: { url: "https://acme.io", market: "US" },
      rows: [
        { query: "acme seo", intent: "navigational", pageType: "landing", estVolume: 900, estKd: 12, gscPosition: 1.2 },
        { query: "seo checklist", intent: "informational", pageType: "blog", estVolume: 400, estKd: 40, gscPosition: null },
        { query: "how to rank", intent: "informational", pageType: "blog", estVolume: 1300, estKd: 55, gscPosition: null },
      ],
    });
  });

  it("sends at most the first 40 rows", () => {
    const rows = Array.from({ length: 45 }, (_, i) => ({ ...fixtureRow(2), q: `q${i}` }));
    const data = JSON.parse(
      splitFences(keywordTaskPrompt({ ...TASK_BASE, rows })).blocks[0]?.body ?? "",
    ) as { rows: readonly { query: string }[] };
    expect(data.rows.map((r) => r.query)).toEqual(rows.slice(0, 40).map((r) => r.q));
  });

  describe.each(TASK_CASES)("hostile $field", ({ apply }) => {
    it.each(HOSTILE_VALUES)("$name stays inside the data block", (hostile) => {
      const input = apply(TASK_BASE, hostile.value);
      const out = keywordTaskPrompt(input);
      expect(promptViolations(out, hostile)).toEqual([]);
      expect(keywordTaskPrompt(input)).toBe(out);
    });
  });

  it.each(HOSTILE_VALUES)("every field hostile at once: $name", (hostile) => {
    const out = keywordTaskPrompt(withEveryField(TASK_BASE, TASK_CASES, hostile.value));
    expect(promptViolations(out, hostile)).toEqual([]);
  });
});
