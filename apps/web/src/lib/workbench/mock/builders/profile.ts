/**
 * Profile artifacts (plan Task 11; jsx:622-690). Bodies are unstamped: the
 * provenance line is added by `stampArtifact` (R5). `profileDocMarkdown` is a
 * document, so user and AI text is folded with `oneLine` instead of fenced;
 * `profileContextPrompt` is a prompt, so every user or AI field sits in one
 * announced data block (R6).
 */
import type {
  AiDoc,
  CrawlSignals,
  GscRow,
  GscRowsSource,
  GscSignals,
  Profile,
  ProfileDoc,
} from "../../types.ts";
import { dataSection, fenceJson } from "../fence.ts";
import { domainOf, oneLine, splitList } from "../text.ts";
import { bulletLines, countText, docSection, joinParts } from "./compose.ts";

export interface ProfileJsonInput {
  readonly profile: Profile;
  readonly ai?: AiDoc;
}

export interface ProfileDocInput {
  readonly profile: Profile;
  readonly doc: ProfileDoc;
}

/** Every number under these section titles comes from generated signals in this PR. */
const SAMPLE_SUFFIX = "（示例数据）";
/** A GSC snapshot whose numbers exist but whose source was never recorded (only a tampered envelope today). */
const UNKNOWN_SOURCE_SUFFIX = "（来源未知）";
const UNFILLED_LINE = "- [未填]";

export function profileJson({ profile, ai }: ProfileJsonInput): string {
  const base = {
    brand: profile.brand,
    url: profile.url,
    domain: domainOf(profile.url),
    market: profile.market,
    positioning: profile.positioning,
    features: splitList(profile.features),
    competitors: splitList(profile.competitors),
  };
  // A sub-object, never spread: AI keys must not be able to overwrite the profile's.
  return JSON.stringify(ai === undefined ? base : { ...base, ai }, null, 2);
}

function orUnfilled(lines: readonly string[]): readonly string[] {
  return lines.length === 0 ? [UNFILLED_LINE] : lines;
}

function crawlSection(crawl: CrawlSignals | null): string {
  if (crawl === null) return "## 站点现状\n- 未抓取";
  const keyPages = [
    crawl.hasPricing ? "定价" : "",
    crawl.hasDocs ? "文档" : "",
    crawl.hasBlog ? "博客" : "",
  ].filter((name) => name !== "");
  return [
    `## 站点现状${SAMPLE_SUFFIX}`,
    `- 技术栈（推测）：${oneLine(crawl.stack)}｜语言：${oneLine(crawl.lang)}`,
    `- 抓到页面 ${countText(crawl.pages)}，可收录约 ${countText(crawl.indexable)}`,
    `- 关键页：${keyPages.join("、") || "缺失"}`,
  ].join("\n");
}

function thirdSection(third: CrawlSignals | null): string | null {
  if (third === null) return null;
  return [
    `## 第三方估算${SAMPLE_SUFFIX}`,
    `- 自然流量 ≈${countText(third.traffic)}/月，DR ${countText(third.dr)}，引用域名 ${countText(third.refdomains)}（估算值，需核实）`,
  ].join("\n");
}

function topQuery(row: GscRow): string {
  return `${oneLine(row.query)}（${countText(row.clicks)} 次，排名 ${countText(row.position)}）`;
}

/**
 * The one section whose numbers can be the user's own: they come from the rows
 * that were in play when the snapshot was generated, so the sample label follows
 * the provenance the snapshot froze (Q6) rather than being fixed like the crawl
 * and third-party sections, whose numbers are always generated. Read from `doc`,
 * not from the project's current rows: a document generated from the sample and
 * then left alone must keep saying so after the user imports real rows.
 */
/**
 * Three sources, three headings, and none of them a default (Q6). A two-way
 * `source === "sample" ? label : ""` gives an unknown source the user's heading,
 * so sample numbers would print with no label at all; picking the sample heading
 * instead would call real numbers generated. Unknown is said out loud, the way a
 * missing number is `null` and never 0.
 */
function gscSourceSuffix(source: GscRowsSource | null): string {
  switch (source) {
    case "sample":
      return SAMPLE_SUFFIX;
    case "user":
      return "";
    case null:
      return UNKNOWN_SOURCE_SUFFIX;
  }
}

function gscSection(gsc: GscSignals | null, source: GscRowsSource | null): string {
  if (gsc === null) return "## 搜索表现\n- 未接入 GSC";
  const top = gsc.top.map(topQuery);
  return [
    `## 搜索表现${gscSourceSuffix(source)}`,
    `- 品牌词点击 ${countText(gsc.brandClicks)}，非品牌词点击 ${countText(gsc.nonBrandClicks)}`,
    `- 临界词（11-30 名）${countText(gsc.near)} 条`,
    ...(top.length === 0 ? [] : [`- 点击最多：${top.join("；")}`]),
  ].join("\n");
}

function icpSection(ai: AiDoc): string | null {
  if (ai.icp.length === 0) return null;
  const segments = ai.icp.map((segment, index) =>
    [
      `### ${index + 1}. ${oneLine(segment.seg)}`,
      `- 角色：${oneLine(segment.role)}`,
      `- 核心痛点：${oneLine(segment.pain)}`,
      `- 会搜：${oneLine(segment.trigger)}`,
      `- 最常见顾虑：${oneLine(segment.objection)}`,
    ].join("\n"),
  );
  return `## ICP\n${segments.join("\n\n")}`;
}

function aiSections(ai: AiDoc): readonly (string | null)[] {
  return [
    icpSection(ai),
    docSection("价值主张", bulletLines(ai.value_props)),
    docSection("差异点", bulletLines(ai.diff)),
    docSection("内容主题域", bulletLines(ai.pillars)),
    docSection(
      "可被 AI 引用的事实",
      bulletLines(ai.facts).map((line) => `${line}｜[补证据与核对日期]`),
    ),
    docSection("语气规范", bulletLines([ai.tone])),
  ];
}

export function profileDocMarkdown({ profile, doc }: ProfileDocInput): string {
  const header = [
    `# ${oneLine(profile.brand) || "[品牌]"} 产品档案`,
    `生成时间：${oneLine(doc.at)}｜站点：${oneLine(profile.url)}｜市场：${oneLine(profile.market)}`,
  ].join("\n");
  return joinParts([
    header,
    docSection("一句话定位", orUnfilled(bulletLines([profile.positioning]))),
    docSection("产品描述", bulletLines([doc.ai.summary])),
    docSection("核心功能", orUnfilled(bulletLines(splitList(profile.features)))),
    crawlSection(doc.crawl),
    thirdSection(doc.third),
    gscSection(doc.gsc, doc.gscSource),
    ...aiSections(doc.ai),
    docSection("竞品", orUnfilled(bulletLines(splitList(profile.competitors)))),
  ]);
}

/**
 * Whether the prompt announces the GSC numbers as sample data, read from the
 * provenance frozen in the snapshot — the same field `gscSourceSuffix` labels
 * the document's section from, so the two artifacts cannot disagree (Q6). Three
 * values in, three out: `null` (source not recorded) is announced as `null`,
 * never `false`, which would state "these are not examples" on no evidence.
 */
function sampleDataFor(source: GscRowsSource | null): boolean | null {
  switch (source) {
    case "sample":
      return true;
    case "user":
      return false;
    case null:
      return null;
  }
}

function contextData({ profile, doc }: ProfileDocInput): unknown {
  const { ai, gsc } = doc;
  return {
    product: {
      brand: profile.brand,
      url: profile.url,
      positioning: profile.positioning,
      market: profile.market,
      features: splitList(profile.features),
      competitors: splitList(profile.competitors),
    },
    ai: {
      summary: ai.summary,
      icp: ai.icp.map(({ seg, role, pain, trigger, objection }) => ({
        seg,
        role,
        pain,
        trigger,
        objection,
      })),
      value_props: ai.value_props,
      diff: ai.diff,
      pillars: ai.pillars,
      tone: ai.tone,
    },
    // sampleData leads so a reader knows what the numbers are before reading
    // them: true for the sample's rows, false for rows the operator imported,
    // null when the snapshot never recorded which (plan Task 9 Step 4b).
    search:
      gsc === null
        ? null
        : {
            sampleData: sampleDataFor(doc.gscSource),
            brandClicks: gsc.brandClicks,
            nonBrandClicks: gsc.nonBrandClicks,
            near: gsc.near,
          },
  };
}

export function profileContextPrompt(input: ProfileDocInput): string {
  return joinParts([
    "# 产品背景",
    "以下是我的产品背景，回答我接下来的问题时都以此为准。",
    dataSection(fenceJson(contextData(input))),
    "涉及数字与事实时，没有依据就标 [需补数据]，不要编造。",
  ]);
}
