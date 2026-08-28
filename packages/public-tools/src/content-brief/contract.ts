/**
 * GenGrowth · 内容链数据契约 v1（2026-08-28）
 *
 * 落点：packages/public-tools/src/content-brief/contract.ts
 * 导出：package.json "exports" 加 "./content-brief/contract"。
 * 营销站只从这个子路径 import，不走 "@sf/public-tools" barrel。
 * 同名异义物不要碰：apps/marketing 的 AgentSolutionKind "content-brief"（SEO Agent 模板）、
 * packages/artifacts 的 content_brief（产品侧 artifact）都与本协议无关。
 *
 * 五条不可协商的约定：
 * 1. 「读不到」在类型上必须是独立分支（status: "unavailable"），绝不用 0、null 占位或空数组表达。
 *    available 分支里的空数组才是真「没有」。
 * 2. 任何计数必须带分母，且分母只在一处：run.reads.*。字段里不复制分母，UI 从 run.reads 读。
 * 3. 来源分两层：method（observed / heuristic / model）× 数据来源。模型产出的一律 method: "model"
 *    并写明 derived_from（按本次实际喂入的来源计算），不得伪装成 observed。
 * 4. 模型自报的数字不进契约；support_count / word_count / covered_by 由服务端派生。
 *    模型只能写 Model* 类型里的字段（见文件末尾）。
 * 5. 服务端不产出自由文本人话：所有面向用户的说明都是封闭 code，人话在 i18n。
 *    模型产出的自由文本（q / h2 / gap_angle.value / coverage gap / why / topic）除外，它们带 method: "model"。
 *
 * 注释里写「parser 钉」「不变量」的约束由 packages/public-tools/src/content-brief/parse-brief.ts 执行（手写 decoder，无 zod）。
 * 模型自由文本的清洗与计长只有一个实现：./text.ts 的 boundedModelText（按码点计长）；LLM 校验与 parser 共用。
 * host 归一只有一个实现：./host.ts 的 hostKey；crawl plan 与 parser 重建共用。
 * parser 不只核对自报数字彼此一致：凡是 assemble.ts 能从 evidence 重算的字段（intent / format / length /
 * must_answer 簇骨架 / crawl 计数 / draft_readiness / mode / budget / 模型 provenance 的 derived_from）都重算后
 * exact compare——两端出自同一张表才算证明。
 */

/* ------------------------------------------------------------------ */
/* 来源                                                                */
/* ------------------------------------------------------------------ */

export type Origin =
  | "gsc"
  | "dataforseo_serp"
  | "crawl"
  | "product_profile"
  | "user_input";

/**
 * UI 配色只看这一层：
 *   method === "model"                              → --sc-source-model（无来源）
 *   origin ∈ gsc | product_profile | user_input     → --sc-source-first（一手）
 *   origin ∈ dataforseo_serp | crawl                → --sc-source-third（三方）
 * heuristic 按 origin 上色（没有单独的「规则色」）。
 */
export type Provenance =
  | { method: "observed" | "heuristic"; origin: Origin }
  | { method: "model"; derived_from: Origin[] };

/** 读取失败的原因枚举。i18n 里每个值一条文案，messages 测试钉住覆盖。 */
export type UnavailableReason =
  | "not_requested" // 用户没选（没选 GSC 资源 / 没选产品档案）
  | "not_connected" // 没授权
  | "not_configured" // 这一路的 env 没配（LLM 凭据缺失）
  | "timeout" // 该路预算耗尽
  | "provider_error" // 上游返回错误
  | "quota_exhausted" // 我们自己的闸门拒绝。v1 流程里配额全在付费调用前以 4xx 拒绝，此值不产生，保留给 v2
  | "insufficient_evidence" // 上游正常，但证据不够产出这个字段
  | "unsupported_language" // v1 只支持空白分词语言
  | "validation_failed"; // 上游返回了，但没通过我们的结构校验

export interface Unavailable {
  status: "unavailable";
  reason: UnavailableReason;
  /** 尝试过的次数 / 条数；不知道就是 null，不是 0。 */
  attempted: number | null;
}

/** 派生规则见 handoff §4.8（brief）/ §5.7（draft）。优先级 unavailable > degraded > partial > complete。 */
export type RunMode = "complete" | "partial" | "degraded" | "unavailable";

/* ------------------------------------------------------------------ */
/* 运行元数据                                                          */
/* ------------------------------------------------------------------ */

/** 单次 LLM 调用（brief 的唯一一次、draft 的覆盖度校验）。 */
export type LlmReadMeta =
  | {
      status: "complete";
      calls: number;
      /** provider 回报的 model id（Azure 下就是 deployment 名）；页面标「部署回报」。 */
      model_id: string;
      temperature_requested: number;
      /** 部署级 pin 覆盖请求值时记录实际生效值；拿不到就 null。绝不声称等于请求值。 */
      temperature_effective: number | null;
      input_tokens: number | null;
      output_tokens: number | null;
    }
  | (Unavailable & {
      /** 付费已发生的调用照记。 */
      calls: number;
      model_id: string | null;
      input_tokens: number | null;
      output_tokens: number | null;
    });

/** 多段并发调用的汇总（draft 分段生成）。规则见 handoff §5.7。 */
export type LlmAggregateMeta =
  | {
      /** complete = 请求的段全部 ok；partial = 有 ok 也有 failed。 */
      status: "complete" | "partial";
      calls: number; // Σ attempts（含失败重试）
      model_id: string;
      temperature_requested: number;
      temperature_effective: number | null;
      input_tokens: number | null;
      output_tokens: number | null;
      failed_reasons: SectionFailReason[];
    }
  | (Unavailable & {
      /** 没有任何一段 ok；reason 取第一个失败段的 fail_reason。 */
      calls: number;
      model_id: string | null;
      input_tokens: number | null;
      output_tokens: number | null;
      failed_reasons: SectionFailReason[];
    });

export type SerpReadMeta =
  | {
      /** partial = returned < requested || unresolved > 0 */
      status: "complete" | "partial";
      requested: number;
      returned: number; // ≥ 1
      /** provider 明确报告但无法解析的行数（unresolvedItemCount）；读不到的行必须计数，不能静默排除。 */
      unresolved: number;
    }
  | Unavailable; // returned === 0 → insufficient_evidence（attempted = requested）；超时 / provider_error / quota

export type CrawlReadMeta =
  | {
      /** partial = truncated > 0 || failed > 0。skipped 不降级（同 host 去重是常态）。 */
      status: "complete" | "partial";
      /** 不变量：attempted === reads.serp.returned === observed + failed + skipped。 */
      attempted: number;
      /** 解析成功的页数（含截断页）。所有分母用它。 */
      observed: number;
      /** observed 里 body_complete === false 的页数。 */
      truncated: number;
      failed: number;
      /** 同 host 去重或无 URL 而没抓的条目（计入 attempted）。 */
      skipped: number;
    }
  | Unavailable; // 一个 URL 都没开始抓：SERP 不可得（insufficient_evidence, attempted 0）/ 预算耗尽前置（timeout）。SERP 可得但全部 skipped 时仍是 available 分支（complete, attempted = returned, skipped = returned）

export type GscReadMeta =
  | {
      /** partial = 任一 truncated 或任一 unreadable_rows > 0。 */
      status: "complete" | "partial";
      property: string;
      window: { start: string; end: string; lookback_days: number };
      /** 归一化后等于主词的 GSC 原样 query 串数（同一主词可能有大小写/空格变体）。 */
      matched_queries: number;
      /**
       * queryPageCoverage(queryRows, queryPageRows).get(key) 的结果，key = 匹配串里曝光最高的那条原样串。
       * ratio 为 null 时 reason 由 handler 派生（handoff §4.4）：该 query 行 impressions 非有限或 ≤ 0 → no_query_impressions；
       * 否则 → split_exceeds_total。
       */
      primary_coverage:
        | { ratio: number }
        | { ratio: null; reason: "no_query_impressions" | "split_exceeds_total" | "query_not_in_sample" };
      truncated: ("query" | "query_page" | "page")[];
      /** 三路各自读到的可用行数（分母）；页面维度进账本的是其中曝光最高的 GSC_PAGE_ROWS_MAX 条。 */
      rows: { query: number; query_page: number; page: number };
      /** PagedRead.unreadableRows，三路各自。> 0 时「主词不在样本」不能推出「未观测到」。 */
      unreadable_rows: { query: number; query_page: number; page: number };
    }
  | Unavailable;

export type ProfileReadMeta =
  | { status: "complete"; website_id: string; snapshot_revision: number; profile_hash: string }
  | Unavailable; // not_requested / insufficient_evidence（网站存在但没有已确认快照）/ timeout / provider_error

export interface BriefRunMeta {
  run_id: string;
  collected_at: string; // ISO8601 UTC
  elapsed_ms: number;
  budget_ms: number; // 恒为 RUN_BUDGET_MS，印在页面上
  mode: RunMode;
  reads: {
    serp: SerpReadMeta;
    crawl: CrawlReadMeta;
    gsc: GscReadMeta;
    product_profile: ProfileReadMeta;
    llm: LlmReadMeta;
  };
  /**
   * sha256(canonicalize(ContentBrief 去掉 run.fingerprint 与 run.elapsed_ms))。
   * canonicalize = 键按 UTF-16 码元升序、无空白、数字按 JSON.stringify、不含 undefined 的稳定序列化，
   * 实现放 packages/public-tools/src/content-brief/canonical.ts，brief 与 draft 共用。
   * draft 侧的 parser 必须重算并比对，不等即拒绝。
   */
  fingerprint: string;
}

/* ------------------------------------------------------------------ */
/* 证据账本                                                            */
/* ------------------------------------------------------------------ */

/** SERP 形态封闭枚举。分类是有序规则表（handoff §4.6），首条命中即 value。 */
export type SerpFormat =
  | "guide"
  | "listicle"
  | "comparison"
  | "product_page"
  | "tool"
  | "forum"
  | "video"
  | "news"
  | "unknown";

export type ClassifiedSerpFormat = Exclude<SerpFormat, "unknown">;

export interface SerpObservation {
  id: string; // "S1" … "S10"
  rank: number;
  /** provider 可能不给；null 的行不抓，恰有一条 CrawlSkipped/no_url（不变量）。 */
  url: string | null;
  domain: string;
  title: string | null;
  /** method 恒为 heuristic（parser 钉 z.literal）。 */
  format: { value: SerpFormat; method: "heuristic"; rules_hit: string[] };
}

export interface CrawlExcerpt {
  heading: string;
  level: "h2" | "h3";
  /** 该小标题下的正文，≤ CRAWL_EXCERPT_MAX_CHARS。句级 bound 只能引用给了片段的观测。 */
  text: string;
}

interface CrawlObservationBase {
  id: string; // "C1" … "C10"，与 SerpObservation 同序号
  serp_id: string;
  url: string;
  final_url: string;
  fetched_at: string;
  h2: string[];
  h3: string[];
  excerpts: CrawlExcerpt[];
  content_hash: string;
}

/**
 * 截断页仍计入 observed（分母），不进长度统计，页面标「部分读取」。
 * word_count 在语言 ∈ NON_WHITESPACE_TOKENIZED_LANGUAGES 时也为 null（不是 0）。
 */
export type CrawlObservation =
  | (CrawlObservationBase & { body_complete: true; word_count: number | null })
  | (CrawlObservationBase & { body_complete: false; word_count: null });

/**
 * fetchPublicResource 的 PublicResourceErrorCode → reason 映射：
 *   timeout → timeout；blocked / cross_origin / invalid_redirect / redirect_limit / network → provider_error；
 *   非 HTML / 解析失败 → validation_failed（code 为 null）。
 */
export interface CrawlFailure {
  serp_id: string;
  url: string;
  reason: Extract<UnavailableReason, "timeout" | "provider_error" | "validation_failed">;
  code: string | null;
}

/** 不变量：每个 serp.id 恰好出现在 observed / failed / skipped 之一；kept_serp_id 指向 url 非 null 的条目（可以是 failed）。 */
export type CrawlSkipped =
  | { serp_id: string; reason: "same_host"; kept_serp_id: string }
  | { serp_id: string; reason: "no_url"; kept_serp_id: null };

/**
 * ProfileFact 的生成是确定性的（handoff §4.2 profileFacts）：
 * 按 WEBSITE_PROFILE_FIELD_NAMES 顺序遍历 MarketingWebsiteProfileV1；
 * string 字段非空一条；string[] 每个非空元素一条，field 记为 "coreFeatures[2]"；
 * 排除 schemaVersion / fieldProvenance / country / locale；fieldProvenance.derivation === "missing" 的字段不生成；
 * 单条 ≤ PROFILE_FACT_MAX_CHARS。
 * derivation 直接取自上游 fieldProvenance；inferred 是画像生成时的模型推断，不是一手事实。
 */
export type ProfileFact =
  | {
      id: string; // "P1" …
      field: string;
      text: string;
      derivation: "declared" | "observed" | "computed";
      provenance: { method: "observed"; origin: "product_profile" };
    }
  | {
      id: string;
      field: string;
      text: string;
      derivation: "inferred";
      provenance: { method: "model"; derived_from: ["product_profile"] };
    };

/** page-reader 行经 position 正规化后的投影；与 @sf/public-tools/gsc-analytics 的 GscQueryPageRow 不是同一个类型。 */
export interface BriefGscQueryPageRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  /** reader 把缺失 position 变成 0；这里在 producer 正规化成 null（<= 0 或非有限数都算缺失）。 */
  position: number | null;
}

export interface BriefGscPageRow {
  id: string; // "G1" …
  page: string;
  clicks: number;
  impressions: number;
  position: number | null;
}

export interface EvidenceLedger {
  serp: SerpObservation[];
  crawl: {
    observed: CrawlObservation[];
    failed: CrawlFailure[];
    skipped: CrawlSkipped[];
  };
  /** 不变量：非 null ⇔ reads.product_profile.status === "complete"。身份字段只在 reads 里。 */
  profile: { facts: ProfileFact[] } | null;
  /** 判定用到的行：只保留主关键词的 query×page 行。 */
  gsc_query_page: BriefGscQueryPageRow[];
  /** 页面维度 top-N（GSC_PAGE_ROWS_MAX），internal_links / do_not_cover 只能引用这里的 id。 */
  gsc_pages: BriefGscPageRow[];
}

/* ------------------------------------------------------------------ */
/* ContentBrief v1                                                     */
/* ------------------------------------------------------------------ */

export const CONTENT_BRIEF_SCHEMA = "gengrowth.content_brief/v1" as const;

type GscHeuristic = { method: "heuristic"; origin: "gsc" };

/** rows = 该 page 在匹配串集合里的 query×page 行数（每个 (query, page) 一行）；rows_with_position ≤ rows。 */
interface ExistingPage {
  page: string;
  impressions: number;
  rows: number;
  rows_with_position: number;
}

/**
 * 判定。v1 有意收窄为三态（Owner 2026-08-28 裁决 (a)）：
 * 2026-08-27 形态稿的四态与 A+B 仲裁是 v2。v1 只看主关键词的 GSC query×page；支持词不参与判定。
 * 文案键 `tools.contentBrief.verdict.<action>.<reason>`；三个 action 都有 reason，update 只有一个值 self_compete。
 * lookback_days 在 run.reads.gsc.window 里，不复制。
 */
export type Verdict =
  | { action: "undecidable"; reason: "no_gsc_property"; provenance: null }
  | {
      action: "undecidable";
      reason: "gsc_unavailable" | "gsc_partial" | "gsc_inconsistent" | "position_unavailable";
      provenance: GscHeuristic;
    }
  | { action: "create"; reason: "not_observed"; existing: null; provenance: GscHeuristic }
  | {
      action: "create";
      reason: "below_impression_floor";
      /** 曝光最高的那一页；no_query_impressions 时可能没有行 → null。 */
      existing: (ExistingPage & { avg_position: number | null }) | null;
      provenance: GscHeuristic;
    }
  | {
      action: "create";
      reason: "beyond_position_cap";
      existing: ExistingPage & { avg_position: number };
      provenance: GscHeuristic;
    }
  | {
      action: "update";
      reason: "self_compete";
      /** 文案固定为「v1 不产出改写清单」。 */
      target_url: string;
      observed: ExistingPage & { avg_position: number; rows_with_position: number };
      provenance: GscHeuristic;
    };

export type IntentField =
  | {
      status: "available";
      value: "informational" | "commercial" | "transactional" | "navigational";
      /** 首条命中意图 === value 的结果数；分母是 run.reads.serp.returned（不复制）。平局按 SERP rank 最靠前的结果所属意图，且强制 provisional。 */
      matched: number;
      /** run.reads.serp.returned === SERP_DEPTH && matched / returned ≥ INTENT_CONFIRMED_MIN_RATIO && 无平局 */
      confidence: "confirmed" | "provisional";
      provenance: { method: "heuristic"; origin: "dataforseo_serp" };
      rules_hit: string[];
    }
  | Unavailable; // 没有任何结果命中任一意图规则 → insufficient_evidence（attempted = run.reads.serp.returned）

export type FormatField =
  | {
      status: "available";
      /** 并列最高 count 的全部形态（has_plurality 与否都如此）。3/3/3/1 → 三个；4/3/3 → 一个。 */
      values: [ClassifiedSerpFormat, ...ClassifiedSerpFormat[]];
      distribution: Record<ClassifiedSerpFormat, number>;
      unknown_count: number;
      /** plurality 的分母：分类成功数 = run.reads.serp.returned - unknown_count，≥ 1（不变量）。 */
      classified: number;
      plurality_threshold: number; // 恒为 FORMAT_PLURALITY_MIN
      has_plurality: boolean; // max(distribution) ≥ plurality_threshold
      provenance: { method: "heuristic"; origin: "dataforseo_serp" };
    }
  | Unavailable; // classified === 0 → insufficient_evidence（attempted = run.reads.serp.returned）

export type LengthField =
  | {
      status: "available";
      p25: number;
      median: number;
      p75: number;
      /** = reads.crawl.observed - truncated，且 ≥ CRAWL_MIN_FOR_LENGTH。 */
      pages_counted: number;
      tokenizer: "whitespace";
      provenance: { method: "observed"; origin: "crawl" };
    }
  | Unavailable; // insufficient_evidence（attempted = pages_counted，可为 0）/ unsupported_language

/** draft 覆盖度校验的唯一被测对象。顺序：covered_by 降序，次键为簇首次出现的 SERP rank。分母 = run.reads.crawl.observed。 */
export interface MustAnswerItem {
  id: string; // "Q1" … "Q8"，服务端在调用 LLM 前分配
  /** 模型把簇改写成的问句；LLM 不可得时 q === cluster.canonical_heading 且 method 为 heuristic。 */
  q: string;
  q_provenance: { method: "model"; derived_from: Origin[] } | { method: "heuristic"; origin: "crawl" };
  cluster: {
    /** 词法归一化后的代表串（不是任何页面原文）；method heuristic / origin crawl，不单独存字段，UI 按三方色。 */
    canonical_heading: string;
    /** 每个成员指向一条 CrawlObservation，heading 是原文。非空。 */
    members: [ClusterMember, ...ClusterMember[]];
  };
  /** 服务端按 members 的 distinct observation_id 派生；≥ MUST_ANSWER_MIN_PAGES。 */
  covered_by: number;
}

export interface ClusterMember {
  observation_id: string;
  heading: string;
  level: "h2" | "h3";
}

export type MustAnswerField =
  | { status: "available"; items: MustAnswerItem[] } // items 为空 = 真的没有簇过门槛
  | Unavailable; // insufficient_evidence（observed < MUST_ANSWER_MIN_PAGES，attempted = observed，crawl 不可得时 0）/ unsupported_language

/** 不变量：每条 must_answer Q 恰好被一节引用（parser 与 LLM 校验都钉），id 按顺序 O1…On。 */
export interface OutlineItem {
  id: string; // "O1" … "O7"
  h2: string;
  h3: string[]; // 空数组 = 没有 h3（真空列表）
  /** 非空；引用 MustAnswerItem.id；每个 Q 只被一节引用（parser 钉）。 */
  answers: [string, ...string[]];
  /** derived_from 由服务端按本次实际喂入计算：至少 ["crawl","user_input"]；给了 facts 加 product_profile；给了 gsc_pages 加 gsc。 */
  provenance: { method: "model"; derived_from: Origin[] };
}

export type OutlineField =
  | { status: "available"; items: [OutlineItem, ...OutlineItem[]] }
  | Unavailable; // insufficient_evidence（must_answer < OUTLINE_MIN_QUESTIONS）/ unsupported_language（随 must_answer）/ timeout / validation_failed / not_configured

export type GapAngleField =
  | {
      status: "available";
      value: string;
      rationale: string;
      provenance: { method: "model"; derived_from: Origin[] };
      /** 引用 ProfileFact.id，非空。 */
      profile_fact_refs: [string, ...string[]];
      /** 否定结论需要全集：必须等于 evidence.crawl.observed 的全部 id（parser 钉），否则 validation_failed。 */
      checked_against: string[];
    }
  | Unavailable; // not_requested / insufficient_evidence（快照已确认但 facts 为空，或 reads.crawl.observed === 0：没有竞品页就没有「竞品没覆盖」可言）/ timeout / provider_error（随 reads.product_profile）/ validation_failed / not_configured

export type InternalLinksField =
  | {
      status: "available";
      /** ≤ INTERNAL_LINKS_CAP；url / impressions 由 UI 从 evidence.gsc_pages 按 page_ref 读。 */
      items: { page_ref: string; why: string; why_provenance: { method: "model"; derived_from: Origin[] } }[];
    }
  | Unavailable;

export type DoNotCoverField =
  | {
      status: "available";
      /** ≤ DO_NOT_COVER_CAP；owned_by 由 UI 从 evidence.gsc_pages 按 page_ref 读。 */
      items: { page_ref: string; topic: string; topic_provenance: { method: "model"; derived_from: Origin[] } }[];
    }
  | Unavailable;

/**
 * 确认门（Owner 2026-08-27 裁决 3 的 v1 形态）：「N 节可写 · M 处缺口」，N = writable.length，M = gaps.length。
 * v1 没有「撤下」：每条 Q 由构造至少有 MUST_ANSWER_MIN_PAGES 篇证据。撤下条件随 v2 的四态判定引入。
 * gaps 是集合（每种至多一次），触发规则见 handoff §4.2 步骤 8；kinds 互斥：llm_unavailable 时不再记 no_outline。
 * not_requested 也记 gap（用户没选也是 draft 的缺口）。
 */
export type GapKind = "no_product_profile" | "no_gsc" | "no_outline" | "llm_unavailable";

export interface DraftReadiness {
  writable: string[]; // OutlineItem.id；outline 不可得时 []
  gaps: GapKind[];
}

export interface ContentBrief {
  schema: typeof CONTENT_BRIEF_SCHEMA;
  run: BriefRunMeta;

  keyword: {
    primary: string;
    /** 上限 SUPPORTING_KEYWORDS_MAX。进 outline 的 LLM 输入（要求安排进合适的 H2/H3），不进判定。 */
    supporting: string[];
    /** 来自 SERP_LOCATIONS / SERP_LANGUAGES，不自造清单。 */
    market: string;
    language: string;
  };

  evidence: EvidenceLedger;
  verdict: Verdict;
  intent: IntentField;
  format: FormatField;
  length: LengthField;
  must_answer: MustAnswerField;
  outline: OutlineField;
  gap_angle: GapAngleField;
  internal_links: InternalLinksField;
  do_not_cover: DoNotCoverField;
  draft_readiness: DraftReadiness;

  /** 形成候选但没进版面的必须计数，不得静默丢弃。outline / internal_links / do_not_cover 超过 CAP 判 validation_failed，不截断（LLM 校验与 assemble 两处都 fail closed）。 */
  budget: {
    outline_cap: number;
    must_answer_cap: number;
    must_answer_min_pages: number;
    must_answer_candidates: number;
    must_answer_shown: number;
    must_answer_hidden: number;
  };
}

/* ------------------------------------------------------------------ */
/* DraftResult v1                                                      */
/* ------------------------------------------------------------------ */

export const DRAFT_RESULT_SCHEMA = "gengrowth.content_draft/v1" as const;

/**
 * 句子的主张状态（Owner 2026-08-27 裁决 5）。由生成模型在产出时标注：
 *   bound     — 有证据支撑，evidence_refs 非空（C* 或 derivation ∈ declared|observed|computed 的 P*）
 *   gap       — 模型认为该说但 brief 里没有证据；进核实清单
 *   no_claim  — 连接、过渡、组织性句子，不作断言
 *   stance    — 立场句，出自 gap_angle；evidence_refs 只能是 P*（含 inferred）
 * 服务端只校验（refs 存在于账本、bound 必须有 refs 且不引用 inferred P*、stance 只能 P*、no_claim/gap 必须空、
 * 引用 C* 的必须是给了片段的观测）；不通过整段失败并重试一次，不改写任何句子的 claim。
 */
export type ClaimState = "bound" | "gap" | "no_claim" | "stance";

export interface Sentence {
  text: string;
  claim: ClaimState;
  /** CrawlObservation.id 或 ProfileFact.id。 */
  evidence_refs: string[];
  /** 服务端派生：evidence_refs 里 distinct 的 C* 数量。 */
  support_count: number;
}

export type SectionFailReason =
  | "timeout"
  | "provider_error" // 含 provider 429
  | "not_configured"
  | "validation_failed"; // 模型标注的证据引用不存在 / bound 无 refs / stance 引用了 C* / bound 引用了 inferred P*

interface DraftSectionBase {
  id: string; // 与 OutlineItem.id 一一对应
  h2: string;
  answers: [string, ...string[]];
}

export type DraftSection =
  | (DraftSectionBase & {
      status: "ok";
      body: {
        /** 服务端按 whitespace tokenizer 派生，与 LengthField 同口径。 */
        word_count: number;
        paragraphs: { sentences: Sentence[] }[];
      };
      llm: { attempts: number; input_tokens: number | null; output_tokens: number | null };
    })
  | (DraftSectionBase & {
      status: "failed";
      fail_reason: SectionFailReason;
      llm: { attempts: number; input_tokens: number | null; output_tokens: number | null };
    })
  | (DraftSectionBase & {
      /** 用户在 §5.1 取消勾选。不调用模型。 */
      status: "skipped";
    });

/** 引用该 Q 的那一节（parser 保证唯一）failed / skipped 时由服务端判 none（heuristic），否则交给模型。 */
export type CoverageItem =
  | { question_id: string; status: "covered"; covered_in: string; gap: null; method: "model"; cause: null }
  | { question_id: string; status: "partial"; covered_in: string; gap: string; method: "model"; cause: "content" }
  | { question_id: string; status: "none"; covered_in: null; gap: string; method: "model"; cause: "content" }
  | { question_id: string; status: "none"; covered_in: null; gap: null; method: "heuristic"; cause: "section_failed" | "section_skipped" };

export type Coverage =
  | {
      status: "available";
      items: CoverageItem[];
      total: number; // = must_answer.items.length
      covered: number;
      partial: number;
      none: number;
      provenance: { method: "model"; derived_from: [] };
      /** temperature 在 run.reads.llm_coverage 里，不复制。 */
    }
  | Unavailable;

export interface VerifyItem {
  sentence: string;
  section_id: string;
  /**
   * single_source = bound 且只有 1 个 C*（UI 三方色高亮）；profile_only = bound 且没有 C*（只引用 P*）；
   * gap / stance 按 claim。
   */
  kind: "single_source" | "profile_only" | "gap" | "stance";
  support_count: number;
  evidence_refs: string[];
}

export interface DraftRunMeta {
  run_id: string;
  /** 单段重跑时指向被替换的上一份 DraftResult 的 run_id；首次生成为 null。 */
  reran_from: string | null;
  collected_at: string;
  elapsed_ms: number;
  budget_ms: number; // 恒为 DRAFT_TOTAL_BUDGET_MS（重跑时 SECTION_ENDPOINT_BUDGET_MS）
  mode: RunMode;
  reads: {
    /**
     * 不变量：sections.length === draft_readiness.writable.length；requested === ok + failed
     * （首跑 = section_ids.length；重跑 = sections 里 status !== "skipped" 的段数）；skipped === writable.length - requested。
     */
    sections: { requested: number; ok: number; failed: number; skipped: number };
    llm_sections: LlmAggregateMeta;
    llm_coverage: LlmReadMeta;
  };
  /** sha256(canonicalize(DraftResult 去掉 run.fingerprint 与 run.elapsed_ms))，同一 canonicalize；重跑由服务端重算。 */
  fingerprint: string;
}

export interface DraftResult {
  schema: typeof DRAFT_RESULT_SCHEMA;
  run: DraftRunMeta;
  brief_ref: {
    schema: typeof CONTENT_BRIEF_SCHEMA;
    run_id: string;
    /** 解析时已重算核对过的 brief 指纹。 */
    fingerprint: string;
    keyword: string;
  };

  settings: {
    tone: "explanatory" | "conversational" | "technical";
    person: "second" | "third";
    product_mention: "none" | "gap_only" | "throughout";
  };

  sections: DraftSection[];
  coverage: Coverage;

  /** 从 sections 派生，不让模型单独生成。 */
  verify_before_publish: VerifyItem[];

  /** 服务端派生；段计数在 run.reads.sections，不复制。 */
  totals: { word_count: number };
}

/* ------------------------------------------------------------------ */
/* 模型返回体（zod 的唯一目标；服务端只从这里读，其余字段全部派生）       */
/* ------------------------------------------------------------------ */

/** brief 那唯一一次调用的返回体。Q 的 id 由服务端预先分配，模型只回填 q。数组超过各自 CAP 判 validation_failed。 */
export interface ModelBriefOutput {
  questions: { id: string; q: string }[];
  /** must_answer < OUTLINE_MIN_QUESTIONS 时服务端不请求 outline，模型必须返回 null。 */
  outline: { h2: string; h3: string[]; answers: string[] }[] | null;
  /** 没给 profile facts 时模型必须返回 null。 */
  gap_angle: { value: string; rationale: string; profile_fact_refs: string[]; checked_against: string[] } | null;
  /** 没给 gsc_pages 时必须返回 null。 */
  internal_links: { page_ref: string; why: string }[] | null;
  do_not_cover: { page_ref: string; topic: string }[] | null;
}

export type ModelSentence = Pick<Sentence, "text" | "claim" | "evidence_refs">;

export interface ModelSectionOutput {
  paragraphs: { sentences: ModelSentence[] }[];
}

export interface ModelCoverageOutput {
  items: { question_id: string; status: "covered" | "partial" | "none"; covered_in: string | null; gap: string | null }[];
}

/* ------------------------------------------------------------------ */
/* 页内交接（brief → draft）                                            */
/* ------------------------------------------------------------------ */

/**
 * 独立于 tool-handoff.ts 的 union：那边是固定小载荷 + 精确键集，塞不下整份 brief。
 * 单一固定 key、版本化、TTL、字节上限、一次性消费；只在 sessionStorage，不进 URL。
 * 跳转链接必须带 TOOL_HANDOFF_LINK_PROPS（rel="opener"），否则新标签页读不到。
 */
export const CONTENT_BRIEF_HANDOFF_KEY = "gengrowth.content-brief-handoff.v1" as const;
export const CONTENT_BRIEF_HANDOFF_TTL_MS = 10 * 60 * 1_000;
export const CONTENT_BRIEF_HANDOFF_MAX_BYTES = 256 * 1024;

export interface ContentBriefHandoff {
  version: 1;
  created_at: number;
  /** = created_at + CONTENT_BRIEF_HANDOFF_TTL_MS（parser 钉）。 */
  expires_at: number;
  brief: ContentBrief;
}

/* ------------------------------------------------------------------ */
/* API 错误码（envelope 用仓库的 createPublicToolError，人话在 i18n）      */
/* ------------------------------------------------------------------ */

export type ContentBriefErrorCode =
  | "invalid_request"
  | "payload_too_large"
  | "unsupported_media_type"
  | "auth_required"
  | "auth_unavailable"
  | "gsc_auth_required" // 没有 grant，或登录账号的 Google 身份与 grant 不是同一人
  | "gsc_revoked" // grant 已失效，需重新授权（照 gsc-gate refuseWithoutGrant）
  | "gsc_temporarily_unavailable" // 续期暂时失败，稍后重试（503）
  | "property_not_granted"
  | "rate_limited"
  | "quota_unavailable"
  | "scan_in_progress"
  | "unsupported_market"
  | "unsupported_language"
  | "too_many_supporting_keywords"
  | "brief_unavailable"; // 组装出的 brief 没通过自己的 parser；服务端 bug，不是用户问题

export type ContentDraftErrorCode =
  | "invalid_request"
  | "payload_too_large"
  | "unsupported_media_type"
  | "auth_required"
  | "auth_unavailable"
  | "rate_limited"
  | "run_in_progress" // 同一账号已有一次运行在途（409 + Retry-After 秒数），不是小时额度用完
  | "quota_unavailable"
  | "brief_schema_mismatch"
  | "brief_fingerprint_mismatch"
  | "brief_reference_invalid" // 交叉引用不存在 / Q 被多节引用 / answers 为空 / 不变量不成立
  | "section_not_writable" // section_id 不在 draft_readiness.writable，或 writable 为空
  | "draft_unavailable"; // 服务端组装后的自检没过，或未预期异常：宁可不给也不给一份说不清来源的稿

/**
 * 页面上直接渲染的全部封闭 code（messages 测试按这份清单逐组检查 en/zh 覆盖）：
 * UnavailableReason · Verdict.action×reason · SectionFailReason · ContentBriefErrorCode · ContentDraftErrorCode ·
 * CrawlSkipped.reason · CrawlFailure.reason · CoverageItem.cause · GapKind · VerifyItem.kind ·
 * GscReadMeta.primary_coverage.reason · SerpFormat · IntentField.value · RunMode
 */
