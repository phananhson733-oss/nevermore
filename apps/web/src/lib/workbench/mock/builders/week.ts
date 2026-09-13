/**
 * The weekly report (plan Task 8 Step 3; Q16 / Q17 / Q23 / Q33; behaviour
 * source jsx:2803-2823). Section titles are Chinese mock copy written here, like
 * every other builder's, and not i18n messages (Q33).
 *
 * The body is unstamped (R5): the provenance declaration is folded in once, by
 * `useAddArtifact`, and this file must never state it too (Q23) — two
 * declarations in one artifact are two wordings of one claim.
 *
 * The input is facts the week view has already derived from the store, not the
 * store itself, so every number here has exactly one producer (the view's
 * `week-summary.ts`) and the report cannot disagree with the cards beside it.
 * `null` is "not known" and prints an em dash, never 0. A borderline count taken
 * over only the rows with a position names the rows without one beside it
 * (「另有 N 条排名未知」, codex S7a #4).
 *
 * What it will not write, and why:
 * - The prototype's 「修掉了什么」 (Q16). The store holds reports, their history
 *   and artifacts; nothing in it shows a repair ran. The section is
 *   「检查结果变化」 and says only which titles one check listed and the other
 *   did not.
 * - Rank movement (Q17). There is no keyword position history, so no number
 *   here ever moves from one position to another.
 * - A change between two checks of different things (codex S7a #1 / #2 / #7).
 *   An earlier audit over other pages is named and not compared, instead of
 *   「只有一次检查结果」, and a mention share printed as a band carries no point
 *   delta. `week-summary.ts` decides both; this file prints what it is given.
 * - 「较上周」 (Q20). The previous run may be a day or months old; its stamp is
 *   printed instead.
 * - The prototype's promises and superlatives (「通常就能进前十」,
 *   「被引用率最高」, 「先做被问最多的」) and its unconditional 「修复任务已经在
 *   产物里」: repair tasks get their own section only when the basket holds one,
 *   and that section says they are tasks.
 *
 * Every user- or AI-controlled string (brand, finding titles, artifact titles)
 * goes through `docText`, so none can open a heading, list or fence.
 */
import type { ArtifactType, Engine, ModuleId } from "../../types.ts";
import { bulletLines, docText, joinParts } from "./compose.ts";

export type WeekEventKind = "audit" | "visibility" | "profile" | "kb" | "artifact";

export interface WeekEvent {
  readonly kind: WeekEventKind;
  /** Local wall-clock stamp, `YYYY-MM-DD HH:mm`. */
  readonly at: string;
  /** The artifact's own module for `artifact`; the page the event belongs to otherwise. */
  readonly module: ModuleId;
  /** The artifact's title for `artifact`; `null` for every other kind. */
  readonly title: string | null;
}

export interface WeekAuditComparison {
  /** When the previous check ran. */
  readonly at: string;
  readonly scoreDelta: number;
  /** Finding titles the previous check listed and the latest did not. */
  readonly noLonger: readonly string[];
  /** Finding titles the latest check listed and the previous did not. */
  readonly newly: readonly string[];
}

export interface WeekHealth {
  readonly at: string;
  readonly score: number;
  /** `null` with no archived check, or with one that is not comparable to the latest. */
  readonly previous: WeekAuditComparison | null;
  /**
   * The archived check's stamp when there is one but it did not list the same
   * checked pages as the latest, so it was not compared; `null` otherwise.
   */
  readonly incomparableAt: string | null;
}

export interface WeekMention {
  readonly at: string;
  /** Already formatted by `formatShare`, the one share every surface prints (Q9). */
  readonly share: string;
  readonly hits: number;
  readonly total: number;
  readonly previous: {
    readonly at: string;
    readonly share: string;
    /** `null` when either share prints as a band (`<1%` / `>99%`): there is no whole-point difference. */
    readonly deltaPt: number | null;
  } | null;
}

export interface WeeklyReportInput {
  readonly brand: string;
  /** `YYYY-MM-DD`. */
  readonly from: string;
  /** `YYYY-MM-DD`. */
  readonly to: string;
  readonly health: WeekHealth | null;
  readonly mention: WeekMention | null;
  readonly artifactsThisWeek: number;
  readonly borderline: number | null;
  /** GSC rows with no usable position; printed beside a known `borderline`. */
  readonly borderlineUnknown: number;
  /** Prompts at least one platform did not answer with the brand in it. */
  readonly answerGaps: number | null;
  readonly kbGaps: number | null;
  readonly highFindings: number | null;
  /** Titles of the audit repair-task prompts in the basket. */
  readonly auditTaskTitles: readonly string[];
  /** Already windowed and sorted, newest first. */
  readonly events: readonly WeekEvent[];
}

/** Everything the draft needs besides title and body. `engine: "both"` is the prototype's `""`. */
export const WEEKLY_REPORT_META = {
  module: "week",
  type: "md",
  engine: "both",
  filename: "weekly.md",
} as const satisfies {
  readonly module: ModuleId;
  readonly type: ArtifactType;
  readonly engine: Engine;
  readonly filename: string;
};

const UNKNOWN = "—";

const EVENT_LABEL = {
  audit: "技术审计",
  visibility: "AI 可见度检查",
  profile: "站点档案",
  kb: "事实知识库",
  artifact: "产物",
} as const satisfies Readonly<Record<WeekEventKind, string>>;

function amount(value: number | null, unit: string): string {
  return value === null ? UNKNOWN : `${value} ${unit}`;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function positive(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

function healthLine(health: WeekHealth | null): string {
  if (health === null) return `- 技术健康分：${UNKNOWN}`;
  const { previous } = health;
  const since =
    previous === null ? "" : `；较上次（${previous.at}）${signed(previous.scoreDelta)}`;
  return `- 技术健康分：${health.score}（检查于 ${health.at}${since}）`;
}

function mentionLine(mention: WeekMention | null): string {
  if (mention === null) return `- AI 提及率：${UNKNOWN}`;
  const { previous } = mention;
  const since =
    previous === null
      ? ""
      : `；较上次（${previous.at}，${previous.share}）${previous.deltaPt === null ? "" : `${signed(previous.deltaPt)}pt`}`;
  return `- AI 提及率：${mention.share}（${mention.total} 次问答里有 ${mention.hits} 次提到品牌，检查于 ${mention.at}${since}）`;
}

function borderlineAmount(input: WeeklyReportInput): string {
  const known = amount(input.borderline, "条");
  return input.borderline !== null && input.borderlineUnknown > 0
    ? `${known}（另有 ${input.borderlineUnknown} 条排名未知）`
    : known;
}

function numbersSection(input: WeeklyReportInput): string {
  return [
    "## 数字",
    healthLine(input.health),
    mentionLine(input.mention),
    `- 本周新增产物：${input.artifactsThisWeek} 件`,
    `- 临界词（11-30 名）：${borderlineAmount(input)}`,
    `- 至少一个平台没提到品牌的提问：${amount(input.answerGaps, "个")}`,
    `- 知识库还没写结论句的条目：${amount(input.kbGaps, "条")}`,
  ].join("\n");
}

function titleLines(titles: readonly string[]): readonly string[] {
  const lines = bulletLines(titles);
  return lines.length === 0 ? ["- 无"] : lines;
}

function changesSection(health: WeekHealth | null): string {
  const head = [
    "## 检查结果变化",
    "这里只对比两次检查各自列出的问题标题，不判断差异从何而来。",
  ];
  if (health === null) return [...head, "- 没有检查结果。"].join("\n");
  const { previous } = health;
  if (previous === null && health.incomparableAt !== null) {
    return [
      ...head,
      `- 上一次检查（${health.incomparableAt}）查过的页面不能确认和最近一次（${health.at}）相同，这里不做对比。`,
    ].join("\n");
  }
  if (previous === null) {
    return [...head, `- 只有一次检查结果（${health.at}），没有可对比的上一次。`].join("\n");
  }
  return [
    ...head,
    `- 上一次检查：${previous.at}；最近一次检查：${health.at}`,
    "",
    `### 上一次列出、最近一次没有列出（${previous.noLonger.length} 条）`,
    ...titleLines(previous.noLonger),
    "",
    `### 最近一次新列出（${previous.newly.length} 条）`,
    ...titleLines(previous.newly),
  ].join("\n");
}

function eventLine(event: WeekEvent): string {
  const label =
    event.kind === "artifact" && event.title !== null
      ? `${EVENT_LABEL.artifact}：${docText(event.title)}`
      : EVENT_LABEL[event.kind];
  return `- ${event.at}｜${label}`;
}

function eventsSection(events: readonly WeekEvent[]): string {
  const lines = events.map(eventLine);
  return ["## 本周事件", ...(lines.length === 0 ? ["- 这段时间没有事件。"] : lines)].join("\n");
}

function taskLines(input: WeeklyReportInput): readonly string[] {
  const high = positive(input.highFindings);
  const answers = positive(input.answerGaps);
  const borderline = positive(input.borderline);
  const kb = positive(input.kbGaps);
  return [
    high === null ? null : `- 处理 ${high} 个高危问题`,
    answers === null ? null : `- 给 ${answers} 个至少一个平台没提到品牌的提问写答案页`,
    borderline === null ? null : `- 推进 ${borderline} 条临界词（11-30 名）`,
    kb === null ? null : `- 补 ${kb} 条知识库结论句`,
  ].filter((line): line is string => line !== null);
}

function tasksSection(input: WeeklyReportInput): string {
  const lines = taskLines(input);
  return [
    "## 下周待办",
    "下面列的是要做的事，不是已经得到的结果。",
    ...(lines.length === 0 ? ["- 暂无待办。"] : lines),
  ].join("\n");
}

/** Only when the basket holds one: pointing at a generator the workbench does not have yet would be a dead end. */
function repairTasksSection(titles: readonly string[]): string | null {
  const lines = bulletLines(titles);
  if (lines.length === 0) return null;
  return [
    "## 修复任务（任务，不是结果）",
    "产物筐里有这些技术审计生成的修复任务；它们是任务，存在不代表已经执行：",
    ...lines,
  ].join("\n");
}

export function weeklyReportMarkdown(input: WeeklyReportInput): string {
  return joinParts([
    `# ${docText(input.brand)} 周报（${input.from} 至 ${input.to}）`,
    numbersSection(input),
    changesSection(input.health),
    eventsSection(input.events),
    tasksSection(input),
    repairTasksSection(input.auditTaskTitles),
  ]);
}
