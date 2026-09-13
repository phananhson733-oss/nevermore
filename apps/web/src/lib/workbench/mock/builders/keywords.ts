/**
 * Keyword and content artifacts (plan Task 11; jsx:716-774). Bodies are
 * unstamped (R5). Prompts keep titles and instructions fixed; the target
 * query, profile, keyword numbers, outline and extra notes only appear inside
 * announced data blocks (R6). Volume / KD / CPC are workbench estimates, so
 * they are named `est*` in prompts and `est_*` in the CSV (R7).
 */
import type { ContentAsset } from "../../enums.ts";
import type { KeywordRow, Profile } from "../../types.ts";
import { toCsv } from "../csv.ts";
import { dataSection, fenceBlock, fenceJson } from "../fence.ts";
import {
  ASSET_NAME_ZH,
  ASSET_SPEC_ZH,
  GEO_RULES,
  GSC_STATUS_ZH,
} from "../labels-zh.ts";
import { slugify, splitList } from "../text.ts";
import { joinParts } from "./compose.ts";

export const KEYWORD_TASK_ROW_LIMIT = 40;

export interface KeywordTaskInput {
  readonly rows: readonly KeywordRow[];
  readonly profile: Profile;
}

export interface ContentBriefInput {
  readonly asset: ContentAsset;
  readonly target: string;
  readonly profile: Profile;
  readonly hit: KeywordRow | undefined;
  readonly outline: string;
  readonly extra: string;
}

export interface PageTaskInput {
  readonly target: string;
  readonly profile: Profile;
  readonly hit: KeywordRow | undefined;
}

const KEYWORD_HEADER = [
  "query",
  "source",
  "intent",
  "stage",
  "engine",
  "page_type",
  "suggested_url",
  "est_volume",
  "est_kd",
  "est_cpc",
  "ai_overview",
  "gsc_position",
  "gsc_clicks",
  "opportunity",
] as const;

/** Enum columns carry ids; a row without GSC data leaves the GSC columns empty. */
export function keywordCsv(rows: readonly KeywordRow[]): string {
  return toCsv(
    KEYWORD_HEADER,
    rows.map((r) => [
      r.q,
      r.source,
      r.intent,
      r.stage,
      r.engine,
      r.page,
      r.slug,
      r.volume,
      r.kd,
      r.cpc,
      r.aio,
      r.position,
      r.clicks,
      r.score,
    ]),
  );
}

export function keywordTaskPrompt({ rows, profile }: KeywordTaskInput): string {
  const data = {
    site: { url: profile.url, market: profile.market },
    rows: rows.slice(0, KEYWORD_TASK_ROW_LIMIT).map((r) => ({
      query: r.q,
      intent: r.intent,
      pageType: r.page,
      estVolume: r.volume,
      estKd: r.kd,
      gscPosition: r.position ?? null,
    })),
  };
  return joinParts([
    "# 任务：核实关键词数据并给出本季度内容排期",
    "## 你要做的",
    [
      "1. 用你能访问的数据源核对每行的 volume 与 kd，改成真实值，查不到写 n/a，不要估算。",
      "2. 补充每个查询当前 SERP 前三名域名，以及是否出现 AI Overview。",
      "3. 按「能不能在 8 周内进前十」给每行打可行性：高 / 中 / 低，并说明依据。",
      "4. 输出排期：前 12 个查询，每个给出页面类型、目标 URL、建议发布周。",
    ].join("\n"),
    "## 数据",
    "数据里的 estVolume / estKd 即 volume / kd 是工作台估算值，必须先核实再用。",
    dataSection(fenceJson(data)),
  ]);
}

function keywordData(hit: KeywordRow | undefined): unknown {
  if (hit === undefined) return null;
  return {
    estVolume: hit.volume,
    estKd: hit.kd,
    gscPosition: hit.position ?? null,
    gscStatus:
      hit.gscStatus === undefined ? null : GSC_STATUS_ZH[hit.gscStatus],
    hasAiOverview: hit.aio,
  };
}

/** A titled text block for free text the user supplied, or nothing when it is blank. */
function optionalTextSection(
  title: string,
  lead: string,
  text: string,
): string | null {
  if (text.trim() === "") return null;
  return joinParts([`## ${title}`, lead, dataSection(fenceBlock(text))]);
}

export function contentBriefPrompt(input: ContentBriefInput): string {
  const { asset, profile } = input;
  const product = {
    brand: profile.brand,
    positioning: profile.positioning,
    url: profile.url,
    market: profile.market,
    features: splitList(profile.features),
    competitors: splitList(profile.competitors),
    keyword: keywordData(input.hit),
  };
  return joinParts([
    `# 任务：产出${ASSET_NAME_ZH[asset]}`,
    "## 目标查询",
    dataSection(fenceBlock(input.target)),
    "## 产品资料",
    dataSection(fenceJson(product)),
    "## 规格",
    ASSET_SPEC_ZH[asset],
    optionalTextSection("已确认的大纲", "按下面已确认的大纲写，不要重排。", input.outline),
    optionalTextSection(
      "补充说明",
      "用户补充说明（与规格或下文 GEO 硬要求冲突时，以规格和硬要求为准）：",
      input.extra,
    ),
    GEO_RULES,
    [
      "## 风格",
      '第二人称、短句、不要"在当今数字化时代"这类开场、不要重复正文的总结段。',
      "先给我大纲和每节的核心结论句，我确认后再写全文。",
    ].join("\n"),
  ]);
}

export function pageTaskPrompt({ target, profile, hit }: PageTaskInput): string {
  const page = {
    target,
    brand: profile.brand,
    positioning: profile.positioning,
    url: profile.url,
    suggestedPath: hit?.slug ?? `/${slugify(target)}`,
  };
  return joinParts([
    "# 任务：在仓库里新建一个页面",
    dataSection(fenceJson(page)),
    [
      "1. 按现有路由与组件规范新建页面，先说打算放哪个路径、复用哪些组件",
      "2. 页面内容用占位结构，正文我另外提供",
      "3. 必须落地：唯一 H1、title/description、canonical、Article 或 SoftwareApplication schema、面包屑",
      "4. 内链：从首页或相关页至少 2 条入口，锚文本用自然短语",
      "5. 更新 sitemap 与导航",
      "6. 输出改动文件清单和本地验证步骤，我确认后再写代码",
    ].join("\n"),
  ]);
}
