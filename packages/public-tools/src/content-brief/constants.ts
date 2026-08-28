// @input  -- nothing; the engine thresholds, budgets and quotas of the content chain
// @output -- named constants the engine enforces and the UI prints verbatim
// @pos    -- the single source every content-brief threshold is read from
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { CONTENT_BRIEF_HANDOFF_MAX_BYTES } from "./contract.ts";

/**
 * Why every number lives here and nowhere else.
 *
 * The page prints its thresholds ("8 questions shown", "45 s budget") so the
 * visitor never has to guess what the engine was thinking. A literal inside a
 * component would drift from the engine the first time either side changed;
 * the copy-honesty tests derive the expected copy from these exports, so the
 * only way to change a threshold is to change it here.
 *
 * This package cannot import from apps/*, so the language allow-list is not
 * derived from the marketing site's SERP_LANGUAGES; the site checks membership
 * against that list, this module only knows which languages it cannot
 * tokenise.
 */

/* ------------------------------------------------------------------ */
/* brief 预算：单一 deadlineAt = start + RUN_BUDGET_MS                  */
/* 每阶段上限 = min(阶段常量, deadlineAt - now - ENVELOPE_MS)           */
/* ------------------------------------------------------------------ */

export const RUN_BUDGET_MS = 45_000; // route maxDuration = 300
export const ENVELOPE_MS = 5_000; // 组装 + 序列化预留
export const SERP_DEADLINE_MS = 10_000;
export const CRAWL_DEADLINE_MS = 15_000; // 全部 URL 的墙钟
export const GSC_DEADLINE_MS = 15_000; // 与 SERP/抓取并行；步骤 5 前必须结束
export const LLM_DEADLINE_MS = 15_000; // brief 唯一一次 LLM 调用

export const CRAWL_FETCH_TIMEOUT_MS = 8_000; // = fetchPublicResource 默认
export const CRAWL_CONCURRENCY = 5;
/** 传给 fetchPublicResource 的 maxBodyBytes；bodyComplete === false ⇔ 截断 */
export const CRAWL_MAX_BYTES_PER_PAGE = 1_500_000;
export const CRAWL_EXCERPT_MAX_CHARS = 600; // 每个小标题下的正文片段
export const CRAWL_EXCERPTS_PER_PAGE_MAX = 12;
export const HEADING_MAX_CHARS = 160;
/** 每页进账本的 h2 / h3 各自上限（文档序截断）；crawler 与 parser 钉同一值，防第三方页面用海量小标题撑爆 brief */
export const CRAWL_HEADINGS_PER_PAGE_MAX = 40;
/** 模型改写的问句上限 */
export const QUESTION_MAX_CHARS = 400;
/** 模型产出的其它自由文本（h2 / h3 / gap_angle.value / rationale / why / topic）上限；LLM 校验与 parser 共用 */
export const MODEL_TEXT_MAX_CHARS = 2_000;

export const LLM_MAX_OUTPUT_TOKENS = 4_000; // brief
export const SECTION_MAX_OUTPUT_TOKENS = 2_500;
export const COVERAGE_MAX_OUTPUT_TOKENS = 1_500;
export const MAX_BYTES_PER_TOKEN = 4;
/** 句级标注（claim / refs / support_count）相对纯文本的膨胀 */
export const ANNOTATION_OVERHEAD = 2;
/** 度量对象 = 该 DraftSection 序列化后的 JSON 字节 */
export const SECTION_BODY_MAX_BYTES =
  SECTION_MAX_OUTPUT_TOKENS * MAX_BYTES_PER_TOKEN * ANNOTATION_OVERHEAD;
export const SECTION_MAX_SENTENCES = 120;
export const SENTENCE_MAX_CHARS = 600;

/* ------------------------------------------------------------------ */
/* SERP / 抓取                                                          */
/* ------------------------------------------------------------------ */

/** Owner 定：抓 top-10 = SERP 返回的全部（同 host 去重后可能 < 10）；不另设 CRAWL_TARGET */
export const SERP_DEPTH = 10;
/** pages_counted 低于它整个 length 字段 unavailable */
export const CRAWL_MIN_FOR_LENGTH = 5;

/* ------------------------------------------------------------------ */
/* 形态 / 意图                                                          */
/* ------------------------------------------------------------------ */

/** 比的是 distribution 里的最大 count（分母 classified） */
export const FORMAT_PLURALITY_MIN = 5;
export const INTENT_CONFIRMED_MIN_RATIO = 0.7;
/** 域名主体短于它不参与 navigational 判定（hp.com 不该把 "php tutorial" 判成品牌词） */
export const NAVIGATIONAL_BRAND_MIN_CHARS = 3;

/* ------------------------------------------------------------------ */
/* must_answer / outline                                                */
/* ------------------------------------------------------------------ */

export const MUST_ANSWER_MIN_PAGES = 3;
export const MUST_ANSWER_CAP = 8;
export const HEADING_CLUSTER_JACCARD = 0.6;
/** 模型超出 → validation_failed（prompt 里告知上限） */
export const OUTLINE_CAP = 7;
export const OUTLINE_MIN_QUESTIONS = 3;
export const SUPPORTING_KEYWORDS_MAX = 10;
export const PROFILE_FACT_MAX_CHARS = 280;
/** 进账本的页面维度行数 */
export const GSC_PAGE_ROWS_MAX = 50;
/** 超出 → validation_failed */
export const INTERNAL_LINKS_CAP = 5;
/** 超出 → validation_failed */
export const DO_NOT_COVER_CAP = 5;

/* ------------------------------------------------------------------ */
/* 判定（只看主关键词）                                                 */
/* ------------------------------------------------------------------ */

/** app 侧加一条测试断言 === COVERAGE_WINDOW_DAYS（包不能 import app） */
export const GSC_LOOKBACK_DAYS = 28;
export const SELF_COMPETE_MIN_IMPRESSIONS = 30;
export const SELF_COMPETE_MAX_POSITION = 30;

/* ------------------------------------------------------------------ */
/* draft                                                                */
/* ------------------------------------------------------------------ */

export const SECTION_TIMEOUT_MS = 20_000;
/** 校验失败重试一次 */
export const SECTION_MAX_ATTEMPTS = 2;
export const DRAFT_TOTAL_BUDGET_MS = 120_000; // route maxDuration = 300
export const COVERAGE_TIMEOUT_MS = 20_000;
/** = SECTION_TIMEOUT_MS × SECTION_MAX_ATTEMPTS + COVERAGE_TIMEOUT_MS + ENVELOPE_MS；route maxDuration = 300 */
export const SECTION_ENDPOINT_BUDGET_MS =
  SECTION_TIMEOUT_MS * SECTION_MAX_ATTEMPTS + COVERAGE_TIMEOUT_MS + ENVELOPE_MS;
/** 客户端软上限；服务端只认配额 */
export const SECTION_RERUN_SOFT_MAX = 7;

/* ------------------------------------------------------------------ */
/* 配额（durable，走 consumePublicToolQuota）                            */
/* 桶名前缀 public-content-brief / public-content-draft                 */
/* ------------------------------------------------------------------ */

export const QUOTA_WINDOW_SECONDS = 3_600;
export const BRIEF_ACCOUNT_MAX_PER_HOUR = 10;
export const BRIEF_IP_MAX_PER_HOUR = 10;
/** SERP 付费调用的日桶（bucket 含 UTC 日期） */
export const BRIEF_DAILY_MAX = 200;
export const DAILY_WINDOW_SECONDS = 86_400;
export const DRAFT_ACCOUNT_MAX_PER_HOUR = 10;
export const DRAFT_IP_MAX_PER_HOUR = 10;
export const SECTION_ACCOUNT_MAX_PER_HOUR = 30;
export const SECTION_IP_MAX_PER_HOUR = 30;

/* ------------------------------------------------------------------ */
/* 请求体                                                               */
/* ------------------------------------------------------------------ */

export const BRIEF_REQUEST_MAX_BYTES = 8 * 1024;
/** brief + settings + section_ids */
export const DRAFT_REQUEST_MAX_BYTES = CONTENT_BRIEF_HANDOFF_MAX_BYTES + 16 * 1024;
/** brief + 全部段 */
export const SECTION_REQUEST_MAX_BYTES =
  CONTENT_BRIEF_HANDOFF_MAX_BYTES + OUTLINE_CAP * SECTION_BODY_MAX_BYTES + 16 * 1024;

/* ------------------------------------------------------------------ */
/* 语言                                                                 */
/* ------------------------------------------------------------------ */

/** v1 只支持空白分词语言；这些语言下篇幅 / must_answer / outline 三字段 unsupported_language */
export const NON_WHITESPACE_TOKENIZED_LANGUAGES: ReadonlySet<string> = new Set([
  "zh",
  "ja",
  "ko",
  "th",
]);

export function isWhitespaceTokenizedLanguage(language: string): boolean {
  return !NON_WHITESPACE_TOKENIZED_LANGUAGES.has(language.toLowerCase());
}

/**
 * Stopwords for heading normalisation. The English list mirrors the private
 * table in packages/sources/src/csv/cluster-key.ts; other languages start
 * empty on purpose — clustering still works through lowercasing, punctuation
 * stripping and the substring rule, it just keeps more function words.
 */
export const STOPWORDS: Readonly<Record<string, ReadonlySet<string>>> = {
  en: new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "into",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "this",
    "to",
    "with",
    "your",
    "you",
    "our",
    "we",
  ]),
  es: new Set([
    "a",
    "al",
    "como",
    "con",
    "de",
    "del",
    "el",
    "en",
    "es",
    "la",
    "las",
    "lo",
    "los",
    "o",
    "para",
    "por",
    "que",
    "se",
    "su",
    "sus",
    "tu",
    "tus",
    "un",
    "una",
    "y",
  ]),
};

/** Question-style prefixes that must survive stopword stripping. */
export const PRESERVED_QUESTION_PREFIXES: readonly string[] = [
  "how to",
  "what is",
  "what are",
  "why",
  "when",
  "where",
  "which",
  "who",
  "should",
  "can",
  "does",
  "is",
];
