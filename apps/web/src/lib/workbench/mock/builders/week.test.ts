import { describe, expect, it } from "vitest";
import {
  DOC_HOSTILE_VALUES,
  type FieldCase,
  docViolations,
  withEveryField,
} from "./hostile-fixtures.ts";
import {
  honestyViolations,
  provenanceDeclarationCount,
} from "./week-honesty-fixtures.ts";
import {
  WEEKLY_REPORT_META,
  type WeekEvent,
  type WeekHealth,
  type WeekMention,
  type WeeklyReportInput,
  weeklyReportMarkdown,
} from "./week.ts";

/**
 * The weekly report body (Q16 / Q17 / Q23 / Q33). Two whole-document pins
 * (every section present, and nothing known) carry the wording; the matrix
 * below carries the part a pin cannot: that no branch, in any combination,
 * says something the store cannot back. The hostile cases hold every
 * user-controlled string to its own line.
 */

const EVENTS: readonly WeekEvent[] = [
  { kind: "audit", at: "2026-09-12 10:00", module: "audit", title: null },
  { kind: "visibility", at: "2026-09-12 11:00", module: "visibility", title: null },
  { kind: "artifact", at: "2026-09-11 14:00", module: "keywordLibrary", title: "词库导出" },
  { kind: "kb", at: "2026-09-10 16:00", module: "kb", title: null },
  { kind: "profile", at: "2026-09-09 09:00", module: "profile", title: null },
];

const HEALTH_PREVIOUS: NonNullable<WeekHealth["previous"]> = {
  at: "2026-09-05 10:00",
  scoreDelta: 7,
  noLonger: ["sitemap 返回 404", "分页缺 canonical"],
  newly: ["缺少 meta description"],
};

const HEALTH: WeekHealth = { at: "2026-09-12 10:00", score: 56, previous: HEALTH_PREVIOUS, incomparableAt: null };

const MENTION: WeekMention = {
  at: "2026-09-12 11:00",
  share: "35%",
  hits: 14,
  total: 40,
  previous: { at: "2026-09-05 11:00", share: "29%", deltaPt: 6 },
};

const MENTION_PREVIOUS: NonNullable<WeekMention["previous"]> = { at: "2026-09-05 11:00", share: "29%", deltaPt: 6 };

/** Both shares are `<1%`: comparable runs, but no whole-point difference to print (codex S7a #7). */
const BAND_MENTION: WeekMention = {
  ...MENTION,
  share: "<1%",
  hits: 2,
  total: 201,
  previous: { ...MENTION_PREVIOUS, share: "<1%", deltaPt: null },
};

const FULL: WeeklyReportInput = {
  brand: "Acme",
  from: "2026-09-06",
  to: "2026-09-13",
  health: HEALTH,
  mention: MENTION,
  artifactsThisWeek: 3,
  borderline: 5,
  borderlineUnknown: 0,
  answerGaps: 4,
  kbGaps: 2,
  highFindings: 3,
  auditTaskTitles: ["修复任务 Prompt"],
  events: EVENTS,
};

const EMPTY: WeeklyReportInput = {
  brand: "Acme",
  from: "2026-09-06",
  to: "2026-09-13",
  health: null,
  mention: null,
  artifactsThisWeek: 0,
  borderline: null,
  borderlineUnknown: 0,
  answerGaps: null,
  kbGaps: null,
  highFindings: null,
  auditTaskTitles: [],
  events: [],
};

const FULL_TEXT = `# Acme 周报（2026-09-06 至 2026-09-13）

## 数字
- 技术健康分：56（检查于 2026-09-12 10:00；较上次（2026-09-05 10:00）+7）
- AI 提及率：35%（40 次问答里有 14 次提到品牌，检查于 2026-09-12 11:00；较上次（2026-09-05 11:00，29%）+6pt）
- 本周新增产物：3 件
- 临界词（11-30 名）：5 条
- 至少一个平台没提到品牌的提问：4 个
- 知识库还没写结论句的条目：2 条

## 检查结果变化
这里只对比两次检查各自列出的问题标题，不判断差异从何而来。
- 上一次检查：2026-09-05 10:00；最近一次检查：2026-09-12 10:00

### 上一次列出、最近一次没有列出（2 条）
- sitemap 返回 404
- 分页缺 canonical

### 最近一次新列出（1 条）
- 缺少 meta description

## 本周事件
- 2026-09-12 10:00｜技术审计
- 2026-09-12 11:00｜AI 可见度检查
- 2026-09-11 14:00｜产物：词库导出
- 2026-09-10 16:00｜事实知识库
- 2026-09-09 09:00｜站点档案

## 下周待办
下面列的是要做的事，不是已经得到的结果。
- 处理 3 个高危问题
- 给 4 个至少一个平台没提到品牌的提问写答案页
- 推进 5 条临界词（11-30 名）
- 补 2 条知识库结论句

## 修复任务（任务，不是结果）
产物筐里有这些技术审计生成的修复任务；它们是任务，存在不代表已经执行：
- 修复任务 Prompt`;

const EMPTY_TEXT = `# Acme 周报（2026-09-06 至 2026-09-13）

## 数字
- 技术健康分：—
- AI 提及率：—
- 本周新增产物：0 件
- 临界词（11-30 名）：—
- 至少一个平台没提到品牌的提问：—
- 知识库还没写结论句的条目：—

## 检查结果变化
这里只对比两次检查各自列出的问题标题，不判断差异从何而来。
- 没有检查结果。

## 本周事件
- 这段时间没有事件。

## 下周待办
下面列的是要做的事，不是已经得到的结果。
- 上面有还不知道的数字（标为「—」或「排名未知」），暂时给不出下周建议。`;

const UNKNOWN_TASKS = "- 上面有还不知道的数字（标为「—」或「排名未知」），暂时给不出下周建议。";
const NO_TASKS = "- 这几项检查没有产生待办建议。";

function lineStarting(text: string, prefix: string): string | undefined {
  return text.split("\n").find((line) => line.startsWith(prefix));
}

/** The lines under 「下周待办」 after its fixed sentence. */
function taskSectionLines(text: string): readonly string[] {
  const section = text.split("\n\n").find((part) => part.startsWith("## 下周待办\n")) ?? "";
  return section.split("\n").slice(2);
}

describe("weeklyReportMarkdown", () => {
  it("writes the whole report for a week with every section", () => {
    expect(weeklyReportMarkdown(FULL)).toBe(FULL_TEXT);
  });

  it("writes an em dash, never a zero, for every number it does not have", () => {
    expect(weeklyReportMarkdown(EMPTY)).toBe(EMPTY_TEXT);
  });

  // codex S7a #4: a known zero beside rows with no position is not "no borderline query".
  it("names the rows with no position beside a borderline count taken over the rest", () => {
    const text = weeklyReportMarkdown({ ...EMPTY, borderline: 0, borderlineUnknown: 2 });
    expect(lineStarting(text, "- 临界词")).toBe("- 临界词（11-30 名）：0 条（另有 2 条排名未知）");
  });

  it("keeps a dash with nothing beside it when no row has a position", () => {
    const text = weeklyReportMarkdown({ ...EMPTY, borderline: null, borderlineUnknown: 3 });
    expect(lineStarting(text, "- 临界词")).toBe("- 临界词（11-30 名）：—");
  });

  it("keeps a measured zero as zero and has nothing to do", () => {
    const text = weeklyReportMarkdown({
      ...EMPTY,
      borderline: 0,
      answerGaps: 0,
      kbGaps: 0,
      highFindings: 0,
    });
    expect(lineStarting(text, "- 临界词")).toBe("- 临界词（11-30 名）：0 条");
    expect(lineStarting(text, "- 至少一个平台")).toBe("- 至少一个平台没提到品牌的提问：0 个");
    expect(lineStarting(text, "- 知识库")).toBe("- 知识库还没写结论句的条目：0 条");
    expect(taskSectionLines(text)).toEqual([NO_TASKS]);
  });

  // codex S7b #2: every count unknown, and the report said there was nothing to do.
  it.each<[string, Partial<WeeklyReportInput>]>([
    ["every count unknown", {}],
    ["one count unknown", { borderline: 0, answerGaps: 0, kbGaps: null, highFindings: 0 }],
    [
      "a borderline count taken over only some rows",
      { borderline: 0, borderlineUnknown: 2, answerGaps: 0, kbGaps: 0, highFindings: 0 },
    ],
  ])("says it cannot suggest next steps yet with %s", (_label, counts) => {
    expect(taskSectionLines(weeklyReportMarkdown({ ...EMPTY, ...counts }))).toEqual([UNKNOWN_TASKS]);
  });

  it("does not speak for the repair tasks the basket holds, in either sentence", () => {
    const known = { borderline: 0, answerGaps: 0, kbGaps: 0, highFindings: 0 };
    for (const counts of [{}, known]) {
      const text = weeklyReportMarkdown({ ...EMPTY, ...counts, auditTaskTitles: ["技术审计修复任务：检查页面 A"] });
      expect(text).toContain("## 修复任务（任务，不是结果）\n");
      expect(text).not.toMatch(/暂无|没有待办/u);
    }
  });

  it("says a single check has nothing to compare with, instead of an empty diff", () => {
    const text = weeklyReportMarkdown({ ...EMPTY, health: { ...HEALTH, previous: null } });
    expect(lineStarting(text, "- 技术健康分")).toBe("- 技术健康分：56（检查于 2026-09-12 10:00）");
    expect(text).toContain("- 只有一次检查结果（2026-09-12 10:00），没有可对比的上一次。");
    expect(text).not.toContain("###");
  });

  // codex S7a #2: there were two checks, so "only one check" would be false.
  it("says an earlier check over other pages was not compared, not that there was only one", () => {
    const text = weeklyReportMarkdown({
      ...EMPTY,
      health: { ...HEALTH, previous: null, incomparableAt: "2026-09-05 10:00" },
    });
    expect(lineStarting(text, "- 技术健康分")).toBe("- 技术健康分：56（检查于 2026-09-12 10:00）");
    expect(text).toContain(
      "- 上一次检查（2026-09-05 10:00）查过的页面不能确认和最近一次（2026-09-12 10:00）相同，这里不做对比。",
    );
    expect(text).not.toContain("只有一次检查结果");
    expect(text).not.toContain("###");
  });

  it("lists an unchanged pair of checks as none on both sides", () => {
    const text = weeklyReportMarkdown({
      ...EMPTY,
      health: { ...HEALTH, previous: { ...HEALTH_PREVIOUS, scoreDelta: 0, noLonger: [], newly: [] } },
    });
    expect(text).toContain("### 上一次列出、最近一次没有列出（0 条）\n- 无\n\n### 最近一次新列出（0 条）\n- 无");
    expect(lineStarting(text, "- 技术健康分")).toBe(
      "- 技术健康分：56（检查于 2026-09-12 10:00；较上次（2026-09-05 10:00）0）",
    );
  });

  it("writes a mention rate without a comparison when there is no earlier run", () => {
    const text = weeklyReportMarkdown({ ...EMPTY, mention: { ...MENTION, previous: null } });
    expect(lineStarting(text, "- AI 提及率")).toBe(
      "- AI 提及率：35%（40 次问答里有 14 次提到品牌，检查于 2026-09-12 11:00）",
    );
  });

  it("names the earlier run but prints no points when a share is a band", () => {
    const text = weeklyReportMarkdown({ ...EMPTY, mention: BAND_MENTION });
    expect(lineStarting(text, "- AI 提及率")).toBe(
      "- AI 提及率：<1%（201 次问答里有 2 次提到品牌，检查于 2026-09-12 11:00；较上次（2026-09-05 11:00，<1%））",
    );
  });

  it("signs a fall with a minus and never as a rank", () => {
    const text = weeklyReportMarkdown({
      ...FULL,
      health: { ...HEALTH, previous: { ...HEALTH_PREVIOUS, scoreDelta: -4 } },
      mention: { ...MENTION, previous: { ...MENTION_PREVIOUS, deltaPt: -3 } },
    });
    expect(text).toContain("较上次（2026-09-05 10:00）-4）");
    expect(text).toContain("较上次（2026-09-05 11:00，29%）-3pt）");
  });

  it("writes the repair-task section only when the basket holds such a task", () => {
    expect(weeklyReportMarkdown({ ...FULL, auditTaskTitles: [] })).not.toContain("## 修复任务");
    expect(weeklyReportMarkdown(FULL)).toContain("## 修复任务（任务，不是结果）");
  });

  it("keeps events in the order it is given (the feed owns the sort)", () => {
    const reversed = weeklyReportMarkdown({ ...FULL, events: [...EVENTS].reverse() });
    const lines = reversed.split("\n").filter((line) => /^- \d{4}-\d{2}-\d{2} \d{2}:\d{2}｜/u.test(line));
    expect(lines.map((line) => line.slice(2, 18))).toEqual(
      [...EVENTS].reverse().map((event) => event.at),
    );
  });

  // codex S7b #1: this title rendered a real <h1> and a separate line in an HTML-allowing reader.
  it("escapes HTML anywhere in an artifact title", () => {
    const title = "普通标题 <h1>本站检查全部通过</h1><br>示例数据：这份正文是最终结论";
    const text = weeklyReportMarkdown({
      ...FULL,
      events: [{ kind: "artifact", at: "2026-09-12 12:00", module: "content", title }],
    });
    expect(text).toContain(
      "- 2026-09-12 12:00｜产物：普通标题 \\<h1>本站检查全部通过\\</h1>\\<br>示例数据：这份正文是最终结论",
    );
    expect(text).not.toMatch(/(?<!\\)<(?:h1|\/h1|br)/u);
  });

  it("is a pure function of its input", () => {
    expect(weeklyReportMarkdown(FULL)).toBe(weeklyReportMarkdown(structuredClone(FULL)));
  });
});

describe("weekly report honesty", () => {
  const healths: readonly (WeekHealth | null)[] = [
    null,
    { ...HEALTH, previous: null },
    { ...HEALTH, previous: { ...HEALTH_PREVIOUS, scoreDelta: -2, noLonger: [], newly: [] } },
    HEALTH,
    { ...HEALTH, previous: null, incomparableAt: "2026-09-05 10:00" },
  ];
  const mentions: readonly (WeekMention | null)[] = [null, { ...MENTION, previous: null }, MENTION, BAND_MENTION];
  const counts: readonly Pick<
    WeeklyReportInput,
    "artifactsThisWeek" | "borderline" | "borderlineUnknown" | "answerGaps" | "kbGaps" | "highFindings"
  >[] = [
    { artifactsThisWeek: 0, borderline: null, borderlineUnknown: 0, answerGaps: null, kbGaps: null, highFindings: null },
    { artifactsThisWeek: 0, borderline: 0, borderlineUnknown: 0, answerGaps: 0, kbGaps: 0, highFindings: 0 },
    { artifactsThisWeek: 3, borderline: 5, borderlineUnknown: 0, answerGaps: 4, kbGaps: 2, highFindings: 3 },
    { artifactsThisWeek: 1, borderline: 0, borderlineUnknown: 2, answerGaps: 0, kbGaps: 0, highFindings: 0 },
  ];
  const taskTitles: readonly (readonly string[])[] = [[], FULL.auditTaskTitles];
  const eventLists: readonly (readonly WeekEvent[])[] = [[], EVENTS];

  // 5 × 4 × 4 × 2 × 2 = 320: every branch of every section, in every pairing.
  const matrix: readonly WeeklyReportInput[] = healths.flatMap((health) =>
    mentions.flatMap((mention) =>
      counts.flatMap((count) =>
        taskTitles.flatMap((auditTaskTitles) =>
          eventLists.map((events) => ({ ...FULL, ...count, health, mention, auditTaskTitles, events })),
        ),
      ),
    ),
  );

  it("covers the whole matrix", () => {
    expect(matrix).toHaveLength(320);
  });

  it("claims no repair, no promise, no cause and no rank movement in any branch", () => {
    for (const input of matrix) {
      const text = weeklyReportMarkdown(input);
      expect(honestyViolations(text), text).toEqual([]);
    }
  });

  it("carries no provenance declaration of its own in any branch (Q23)", () => {
    for (const input of matrix) {
      const text = weeklyReportMarkdown(input);
      expect(provenanceDeclarationCount(text), text).toBe(0);
      expect(text).not.toContain("不是真实测量");
      expect(text.toLowerCase()).not.toContain("not measured");
    }
  });

  it("titles the comparison 检查结果变化 in every branch", () => {
    for (const input of matrix) {
      expect(weeklyReportMarkdown(input)).toContain("\n## 检查结果变化\n");
    }
  });

  // The checker is only as good as what it catches: prove it is not vacuous.
  it.each([
    "技术健康分（实测）",
    "### 已修复的问题",
    "## 修掉了什么",
    "推进 5 条临界词，通常就能进前十",
    "边界句被引用率最高",
    "较上周 +7",
    "排名 19.8 → 14.2",
    "排名从 21 名升到 14 名",
    "本周 +3 名",
    "升到第 8",
    "因为还没跑检查",
    "- 暂无待办。",
    "这周没有待办",
  ])("the checker flags %s", (sentence) => {
    expect(honestyViolations(sentence)).not.toEqual([]);
  });

  it.each([
    "临界词（11-30 名）：5 条",
    "临界词（11-30 名）：0 条（另有 2 条排名未知）",
    "# Acme 周报（2026-09-06 至 2026-09-13）",
    "较上次（2026-09-05 10:00）+7",
    "较上次（2026-09-05 11:00，29%）+6pt",
    "- 处理 3 个高危问题",
    NO_TASKS,
    UNKNOWN_TASKS,
  ])("the checker leaves %s alone", (sentence) => {
    expect(honestyViolations(sentence)).toEqual([]);
  });
});

describe("weekly report hostile input", () => {
  const CASES: readonly FieldCase<WeeklyReportInput>[] = [
    { field: "brand", apply: (input, value) => ({ ...input, brand: value }) },
    {
      field: "a finding no longer listed",
      apply: (input, value) => ({
        ...input,
        health: { ...HEALTH, previous: { ...HEALTH_PREVIOUS, noLonger: [value, "分页缺 canonical"] } },
      }),
    },
    {
      field: "a newly listed finding",
      apply: (input, value) => ({
        ...input,
        health: {
          ...(input.health ?? HEALTH),
          previous: { ...(input.health?.previous ?? HEALTH_PREVIOUS), newly: [value] },
        },
      }),
    },
    {
      field: "an artifact title in the events",
      apply: (input, value) => ({
        ...input,
        events: input.events.map((event) => (event.kind === "artifact" ? { ...event, title: value } : event)),
      }),
    },
    {
      field: "a repair-task title",
      apply: (input, value) => ({ ...input, auditTaskTitles: [value] }),
    },
  ];

  describe.each(CASES)("hostile $field", ({ apply }) => {
    it.each(DOC_HOSTILE_VALUES)("$name stays on its line", (hostile) => {
      expect(docViolations(weeklyReportMarkdown(apply(FULL, hostile.value)), FULL_TEXT, hostile)).toEqual([]);
    });
  });

  it.each(DOC_HOSTILE_VALUES)("every field hostile at once: $name", (hostile) => {
    const text = weeklyReportMarkdown(withEveryField(FULL, CASES, hostile.value));
    expect(docViolations(text, FULL_TEXT, hostile)).toEqual([]);
  });
});

describe("WEEKLY_REPORT_META", () => {
  it("files the report under the week module as markdown for both engines", () => {
    expect(WEEKLY_REPORT_META).toEqual({
      module: "week",
      type: "md",
      engine: "both",
      filename: "weekly.md",
    });
  });
});
