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
/** 抓取内层墙钟比外层 lane 提前收口的余量；内层必须先返回，否则 lane 超时会丢弃已抓完的页 */
export const CRAWL_SETTLEMENT_MS = 500;
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
/** JSON 里每个字符最多占的字节（4 字节 UTF-8，或 \uXXXX 转义的 6 字节按 1.5 倍折算后仍 ≤ 此值 × 1.5） */
const JSON_BYTES_PER_CHAR = 6;
/** 一条 verify_before_publish / coverage item 除正文外的键名、id、refs 的余量 */
const RECORD_OVERHEAD_BYTES = 512;
/** run / brief_ref / settings / totals / reads 与 JSON 外壳 */
const DRAFT_ENVELOPE_BYTES = 16 * 1024;
/**
 * 一份 contract-valid DraftResult 序列化后的上限：全部段 + verify_before_publish
 * （最坏情况每句都进清单并复制整句）+ coverage（每题一段模型 gap）+ 外壳。
 * section 端点携带整份上一次结果，所以请求上限必须按这个形状推导，
 * 否则合法首跑结果会在任何模型调用前被 body reader 以 413 拒掉。
 */
export const DRAFT_RESULT_MAX_BYTES =
  OUTLINE_CAP * SECTION_BODY_MAX_BYTES +
  OUTLINE_CAP * SECTION_MAX_SENTENCES * (SENTENCE_MAX_CHARS * JSON_BYTES_PER_CHAR + RECORD_OVERHEAD_BYTES) +
  MUST_ANSWER_CAP * (MODEL_TEXT_MAX_CHARS * JSON_BYTES_PER_CHAR + RECORD_OVERHEAD_BYTES) +
  DRAFT_ENVELOPE_BYTES;
/** brief + section_id + 整份上一次 DraftResult */
export const SECTION_REQUEST_MAX_BYTES = CONTENT_BRIEF_HANDOFF_MAX_BYTES + DRAFT_RESULT_MAX_BYTES + 16 * 1024;

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

/**
 * The scripts that write words without spaces between them, as one class body
 * every consumer builds its own regex from.
 *
 * Three places decide something about language from this list: which text gets
 * CJK bigrams instead of word tokens, which runs get split into bigrams, and
 * whether a generated heading came back in the sources' script rather than the
 * one that was asked for. Written out three times, a script added to one copy
 * and missed in the others changes what counts as which language in one stage
 * only, and every test still passes.
 */
export const UNSEGMENTED_SCRIPT_CLASS =
  "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}\\p{Script=Thai}";

/**
 * How many of the visitor's own pages the brief reads.
 *
 * Both lanes that nominate owned pages cut to the same number: the Search
 * Console projection ranks matched and fallback pages, and the run merges that
 * with its own ranking. Two separate literals let one lane hand over more
 * candidates than the other would ever keep.
 */
export const BRIEF_V2_OWNED_CANDIDATES_MAX = 3;

/**
 * The script a brief written in each accepted language must actually contain.
 *
 * Mirrors SERP_LANGUAGES in apps/marketing/src/lib/tools/serp-markets.ts, which
 * this package cannot import: business packages do not depend on apps. A test
 * over there asserts every accepted language has an entry here, because a
 * language added to the list and missed here is not an error anywhere -- the
 * brief just stops being checked, silently.
 *
 * The scripts a brief in that language is actually written in today, not the
 * scripts it has ever been written in. Latin covers every language whose modern
 * alphabet is Latin, whatever its diacritics. Japanese lists kana alongside Han
 * because a Japanese heading may be entirely kana; Chinese lists Han alone, so
 * an all-Hangul brief cannot pass for Chinese by sharing the "unsegmented"
 * bucket.
 *
 * Where a language has a living second script, both are listed. Where the
 * alternative is historical (Cyrillic Romanian, Jawi Malay, Arabic-script
 * Turkish) it is not, and a brief written that way would be rejected. That is a
 * deliberate limit, written down rather than implied: this is a script test, and
 * a script test cannot tell a language from the alphabet it was typed in.
 */
export const EXPECTED_BRIEF_SCRIPTS: ReadonlyMap<string, string> = new Map([
  ["zh", "\\p{Script=Han}"],
  ["ja", "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}"],
  ["ko", "\\p{Script=Hangul}"],
  ["th", "\\p{Script=Thai}"],
  ["ru", "\\p{Script=Cyrillic}"],
  ["uk", "\\p{Script=Cyrillic}"],
  ["ar", "\\p{Script=Arabic}"],
  ["he", "\\p{Script=Hebrew}"],
  // Romanized Hindi is ordinary online writing, not a specialist form, so
  // Devanagari alone would reject a brief that is written the way its
  // readers write. Accepting both costs a check nobody was getting anyway.
  ["hi", "\\p{Script=Devanagari}\\p{Script=Latin}"],
  ["el", "\\p{Script=Greek}"],
  ...["en", "de", "fr", "es", "it", "pt", "nl", "sv", "no", "da", "fi", "pl",
    "tr", "vi", "id", "ms", "cs", "hu", "ro"].map((code): readonly [string, string] => [code, "\\p{Script=Latin}"]),
]);
