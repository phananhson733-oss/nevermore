/**
 * AI visibility artifacts (plan Task 12; jsx:847-863, 912-913). Bodies are
 * unstamped (R5). The CSV takes its check date as a parameter and never reads
 * the clock (R3); every row is sample data. The answer-page prompt keeps its
 * title and instructions fixed; the product and the gaps only appear inside
 * announced data blocks (R6). Gaps come from sample answers, so the prompt
 * asks for a re-check before any page is built (R10).
 */
import type { Profile, VisResult } from "../../types.ts";
import { toCsv } from "../csv.ts";
import { dataSection, fenceJson } from "../fence.ts";
import { splitList } from "../text.ts";
import { stampDate } from "../time.ts";
import type { VisGap } from "../visibility.ts";
import { joinParts } from "./compose.ts";

export interface VisibilityCsvInput {
  readonly results: readonly VisResult[];
  /** The `YYYY-MM-DD HH:mm` stamp of the check the results belong to. */
  readonly checkedAt: string;
}

export interface AnswerPlanInput {
  readonly profile: Profile;
  readonly gaps: readonly VisGap[];
}

const VISIBILITY_HEADER = [
  "prompt",
  "platform",
  "mentioned",
  "rank_in_answer",
  "brands_in_answer",
  "cited_domains",
  "source",
  "checked_at",
] as const;

/** `VisResult.real` is always false in this PR, so the source column is always the sample id. */
const SAMPLE_SOURCE = "sample";
const LIST_SEPARATOR = " | ";

export function visibilityCsv({ results, checkedAt }: VisibilityCsvInput): string {
  const date = stampDate(checkedAt);
  return toCsv(
    VISIBILITY_HEADER,
    results.map((r) => [
      r.p,
      r.platform,
      r.hit,
      r.rank,
      r.brands.join(LIST_SEPARATOR),
      r.domains.join(LIST_SEPARATOR),
      SAMPLE_SOURCE,
      date,
    ]),
  );
}

/** The prototype crashed here on an empty list (jsx:853); with no gaps there is only a fixed sentence and no block. */
function gapParts(gaps: readonly VisGap[]): readonly string[] {
  if (gaps.length === 0) {
    return ["还没有可见度缺口数据：先跑一次 AI 可见度诊断。"];
  }
  const data = gaps.map((gap) => ({
    prompt: gap.p,
    missingOn: gap.missedPlatforms,
    rivalsInAnswer: gap.rivals,
  }));
  return [
    "下面的缺口来自示例数据，不是真实的 AI 回答；先在对应平台上逐条复核，复核不到的提问不要建页。",
    dataSection(fenceJson(data)),
  ];
}

export function answerPlanPrompt({ profile, gaps }: AnswerPlanInput): string {
  const product = {
    brand: profile.brand,
    positioning: profile.positioning,
    url: profile.url,
    competitors: splitList(profile.competitors),
  };
  return joinParts([
    "# 任务：为没被提及的提问建答案页",
    "## 产品资料",
    dataSection(fenceJson(product)),
    "## 缺口（AI 答案里没有我们）",
    ...gapParts(gaps),
    "## 每页要求",
    [
      "1. URL 与 H1：H1 直接用提问原句",
      "2. 第一段 60 词内给出完整答案，能被整段摘走",
      '3. 必须有：一句定义、一张对比表、3 个带数字的事实、一段"不适合谁"',
      "4. 事实标注来源与核对日期，查不到写 [需补数据]",
      "5. 输出 FAQPage JSON-LD",
      "6. 给 llms.txt 追加片段，把这几页的结论句列进去",
    ].join("\n"),
    "先输出页面清单和每页的结论句，我确认后再展开正文。",
  ]);
}
