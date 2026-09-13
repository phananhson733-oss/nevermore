/**
 * Link-building and data-report artifacts (plan Task 12; jsx:865-910). Bodies
 * are unstamped (R5). Prompts keep titles and instructions fixed; profile
 * fields, candidate targets and the report angle only appear inside announced
 * data blocks (R6). Targets are a built-in sample list with sample DR values,
 * and a channel may have no DR or difficulty at all: those stay `null` inside
 * the JSON and are never written into an instruction line (R10).
 */
import type { LinkTarget, LinkType, Profile } from "../../types.ts";
import { toCsv } from "../csv.ts";
import { dataSection, fenceJson } from "../fence.ts";
import { LEVEL_ZH, LINK_TYPE_ZH } from "../labels-zh.ts";
import { joinParts } from "./compose.ts";

export interface LinkPromptInput {
  readonly targets: readonly LinkTarget[];
  readonly profile: Profile;
}

export interface ReportTaskInput {
  readonly profile: Profile;
  readonly angle: string;
}

const LINK_HEADER = [
  "type",
  "site",
  "domain",
  "dr",
  "relevance",
  "difficulty",
  "action",
  "asset_to_offer",
  "contact",
] as const;

/** Enum columns carry ids (R7); an unknown DR or difficulty is an empty cell, and contact is always left for the user. */
export function linkCsv(targets: readonly LinkTarget[]): string {
  return toCsv(
    LINK_HEADER,
    targets.map((t) => [
      t.type,
      t.site,
      t.domain,
      t.dr,
      t.relevance,
      t.difficulty,
      t.action,
      t.asset,
      "",
    ]),
  );
}

function productData(profile: Profile): unknown {
  return {
    brand: profile.brand,
    url: profile.url,
    positioning: profile.positioning,
  };
}

/** A channel without a domain has no DR and no difficulty; both stay `null` in the JSON, never 0 or a label. */
function candidateData(target: LinkTarget): unknown {
  return {
    type: LINK_TYPE_ZH[target.type],
    site: target.site,
    domain: target.domain === "" ? null : target.domain,
    dr: target.dr,
    difficulty: target.difficulty === null ? null : LEVEL_ZH[target.difficulty],
    action: target.action,
    assetToOffer: target.asset,
  };
}

export function linkTaskPrompt({ targets, profile }: LinkPromptInput): string {
  return joinParts([
    "# 任务：核实外链目标并开始外联",
    "## 产品资料",
    dataSection(fenceJson(productData(profile))),
    "## 候选",
    "下面的候选站点来自工作台内置清单，DR 与难度是示例值；逐个核实后再动。",
    dataSection(fenceJson(targets.map(candidateData))),
    "## 你要做的",
    [
      "1. 逐个访问，确认现在是否还接受收录、是否 dofollow、提交入口的真实 URL",
      "2. 补充联系方式，找不到写 n/a，不要编邮箱",
      '3. 补 10 个清单里没有的目标：搜 "best [关键词] tools" 类页面，挑接受新增条目的',
      "4. 按难度从低到高排序，难度未知的排最后，输出 CSV：type,site,url,dofollow,submit_url,contact,difficulty,note",
    ].join("\n"),
  ]);
}

/** Type names deduped by id in first-appearance order, then labelled. */
function recipientTypes(targets: readonly LinkTarget[]): readonly string[] {
  const ids: readonly LinkType[] = targets.map((target) => target.type);
  return ids
    .filter((id, index) => ids.indexOf(id) === index)
    .map((id) => LINK_TYPE_ZH[id]);
}

export function outreachPrompt({ targets, profile }: LinkPromptInput): string {
  const data = {
    sender: productData(profile),
    recipientTypes: recipientTypes(targets),
  };
  return joinParts([
    "# 任务：写 3 版外联邮件",
    "## 发件方与收件方类型",
    dataSection(fenceJson(data)),
    "## 要求",
    [
      "- 每版不超过 90 词，主题行不超过 6 个词",
      "- 第一句提到对方的具体内容（留 [具体页面/观点] 占位）",
      "- 中间一句说明能提供什么：数据、免费工具或可嵌入图表选一个；我没说有的就留 [可提供的资产] 占位，不要编",
      '- 结尾一个低门槛问句，不要"期待回复"',
      "- 三版差异：A 提供数据资产、B 指出对方清单缺漏、C 提出互换内容",
    ].join("\n"),
    "另给一版 4 天后的跟进邮件，不超过 40 词。不要夸张形容词，不要群发感。",
  ]);
}

export function reportTaskPrompt({ profile, angle }: ReportTaskInput): string {
  const trimmed = angle.trim();
  const data = {
    brand: profile.brand,
    positioning: profile.positioning,
    market: profile.market,
    angle: trimmed === "" ? null : trimmed,
  };
  return joinParts([
    "# 任务：做一份可被引用的原创数据报告",
    "## 产品资料",
    dataSection(fenceJson(data)),
    trimmed === ""
      ? "切入角度待定，先帮我提 3 个。"
      : "切入角度按资料里的 angle。",
    "目标：产出别人写文章时会引用的数字资产。",
    [
      "1. 提出 3 个能用我们自有数据回答的问题",
      "2. 每个问题给出：需要字段、样本量要求、统计口径、可能偏差",
      "3. 结构：一句话核心发现 → 3 个可独立引用的数字 → 方法论 → 分场景解读 → 原始数据下载",
      "4. 每个关键数字单独成句，写成能被整句摘走的形式",
      "5. 配一个可嵌入图表和一段引用规范",
      "6. 出一版摘要页文案，用于媒体和目录站分发",
    ].join("\n"),
    "不要写没有数据支撑的趋势判断。",
  ]);
}
