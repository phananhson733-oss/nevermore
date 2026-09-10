// @input -- the shared limitation clause table and the two shipped message catalogs
// @output -- unit guard that a stored sentence and a rendered one say the same thing
// @pos -- pure unit test: no fetch, no store, no rendering
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import {
  GEO_LIMITATION_CLAUSES,
  GEO_LIMITATION_EVIDENCE_GROUP_LABELS,
  GEO_LIMITATION_KEYS,
  GEO_LIMITATION_REASON_LABELS,
  GEO_LIMITATION_STAGE_LABELS,
  geoComposeLimitation,
  geoLimitationEnglish,
  geoPartialLimitation,
  type GeoLimitationKey,
  type GeoLimitationParams,
} from "./kb-knowledge-limitation.ts";
import {
  GEO_EVIDENCE_GROUPS,
  geoLimitationKeysSchema,
  geoText,
  geoUnavailableReasonSchema,
} from "./kb-knowledge-shape.ts";
import type { GeoOffsiteStage } from "./kb-offsite-collect.ts";

/** Every offsite stage the collector can report, as a value the compiler checks. */
const OFFSITE_STAGES = ["serp", "landing_pages", "landing_page_reads", "first_party"] as const satisfies readonly GeoOffsiteStage[];

/** Parameters that exercise every substitution a clause can make. */
const SAMPLE: Readonly<Record<GeoLimitationKey, GeoLimitationParams>> = {
  entity_links_not_observed: {},
  facts_without_model: {},
  facts_missing_exact_excerpt: {},
  qa_without_model: {},
  own_evidence_partial: {},
  machine_signals_absent: {},
  robots_not_read_in_full: {},
  robots_none_published: {},
  robots_unreadable: {},
  snippets_not_checked: {},
  coverage_incomplete: {},
  carried_owner_declared_only: {},
  facts_withheld_unsupported: { count: 3 },
  evidence_items_unshowable: { count: 2 },
  evidence_groups_not_collected: { groups: "press,thirdPartyProfiles" },
  offsite_pages_unread: { count: 4, reason: "fetch_failed" },
  offsite_stage_stopped: { stage: "landing_pages", reason: "rate_limited", count: 5 },
};

const catalog = (locale: "en" | "zh") =>
  (locale === "zh" ? zh : en).tools.geoKnowledgeBase.card.limitations as {
    separator: string;
    stages: Record<string, string>;
    reasons: Record<string, string>;
    clause: Record<string, string | undefined>;
  };

/**
 * One clause as the CARD would render it, resolved here rather than imported.
 *
 * The card's own resolver reads the same catalog; asserting against it would be
 * satisfied by any wording at all. This walks the catalog independently, with
 * the same substitutions the producer made, so the two sentences are compared
 * as two facts rather than as one fact twice.
 */
function rendered(locale: "en" | "zh", key: GeoLimitationKey, params: GeoLimitationParams): string {
  const messages = catalog(locale);
  const template = messages.clause[key];
  if (template === undefined) throw new Error(`no ${locale} sentence for ${key}`);
  const values: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(params)) {
    if (name === "reason") values[name] = messages.reasons[String(value)]!;
    else if (name === "stage") values[name] = messages.stages[String(value)]!;
    else if (name === "groups") {
      const groups = (locale === "zh" ? zh : en).tools.geoKnowledgeBase.card.groups as Record<string, string>;
      values[name] = String(value).split(",").map((group) => groups[group]!).join(messages.separator);
    } else values[name] = value;
  }
  const t = createTranslator({
    locale,
    messages: locale === "zh" ? zh : en,
    namespace: "tools.geoKnowledgeBase.card.limitations",
  });
  const sentence = t(`clause.${key}` as never, values as never);
  // The template is read above only to fail loudly on a key the catalog is
  // missing; next-intl would render the key path instead of throwing.
  expect(sentence, key).not.toBe(template === undefined ? "" : `limitations.clause.${key}`);
  return sentence;
}

describe("the clause table covers what the contracts can say", () => {
  it("names every evidence group, off-site stage and unavailable reason", () => {
    expect(Object.keys(GEO_LIMITATION_EVIDENCE_GROUP_LABELS).sort()).toEqual([...GEO_EVIDENCE_GROUPS].sort());
    expect(Object.keys(GEO_LIMITATION_STAGE_LABELS).sort()).toEqual([...OFFSITE_STAGES].sort());
    expect(Object.keys(GEO_LIMITATION_REASON_LABELS).sort()).toEqual([...geoUnavailableReasonSchema.options].sort());
  });

  /**
   * next-intl renders the key PATH for a missing key rather than throwing, so a
   * clause a payload can carry but a catalog has no sentence for would ship as
   * `limitations.clause.<key>` on a customer page.
   */
  it.each(["en", "zh"] as const)("has a %s sentence for every clause, stage and reason", (locale) => {
    const messages = catalog(locale);
    for (const key of GEO_LIMITATION_KEYS) {
      expect(messages.clause[key], key).toEqual(expect.any(String));
      expect(messages.clause[key], key).not.toContain("limitations.clause");
    }
    for (const stage of OFFSITE_STAGES) expect(messages.stages[stage], stage).toEqual(expect.any(String));
    for (const reason of geoUnavailableReasonSchema.options) expect(messages.reasons[reason], reason).toEqual(expect.any(String));
  });
});

/**
 * The English a payload STORES and the English a reader is SHOWN.
 *
 * They come from two places on purpose -- the producer composes its sentence
 * without next-intl, and the card renders from the catalog -- and a payload
 * whose stored fallback disagreed with its localized rendering would show one
 * owner two different limitations depending on when their tab was loaded.
 */
it("stores the same English sentence the catalog renders", () => {
  for (const key of GEO_LIMITATION_KEYS) {
    expect(rendered("en", key, SAMPLE[key]), key).toBe(geoLimitationEnglish(key, SAMPLE[key]));
  }
});

/**
 * What the Chinese card must and must not say, written down independently.
 *
 * Comparing the rendered Chinese against the catalog entry it came from would
 * pass for any wording, including the English it is replacing. `required` is
 * the meaning the clause has to carry; `forbidden` are the claims the code
 * cannot support, plus the English phrase this whole change exists to remove.
 */
const ZH_WORDING: Readonly<Record<GeoLimitationKey, { readonly required: string; readonly forbidden: readonly string[] }>> = {
  entity_links_not_observed: { required: "公开链接", forbidden: ["Some optional public links", "全部链接"] },
  facts_withheld_unsupported: { required: "证据不支持", forbidden: ["generated fact", "错误", "已删除"] },
  facts_without_model: { required: "FAQ", forbidden: ["Model-synthesized facts", "全部事实"] },
  facts_missing_exact_excerpt: { required: "逐字", forbidden: ["Some accepted facts", "不真实", "错误"] },
  qa_without_model: { required: "问答标记", forbidden: ["Model-synthesized questions", "没有问答"] },
  evidence_groups_not_collected: { required: "本次没有采集", forbidden: ["Not collected in this run", "不存在", "没有找到"] },
  evidence_items_unshowable: { required: "无法连同证据", forbidden: ["collected item(s)", "已删除", "不可信"] },
  offsite_pages_unread: { required: "无法读取", forbidden: ["off-site page(s)", "无法访问", "不存在"] },
  // "not reached" is not "not finished": the producer distinguishes pages it
  // reached and could not read from work it never got to, and "没有完成" would
  // describe both.
  offsite_stage_stopped: { required: "没有开始", forbidden: ["stopped early", "失败", "没有完成", "未完成"] },
  own_evidence_partial: { required: "不完整", forbidden: ["own-site evidence", "无效", "不可用"] },
  machine_signals_absent: { required: "机器可读信号", forbidden: ["machine-readable visibility", "全部缺失", "整站"] },
  robots_not_read_in_full: { required: "完整读取", forbidden: ["AI crawler permissions", "禁止", "被封"] },
  robots_none_published: { required: "没有发布", forbidden: ["AI crawler permissions", "禁止", "被封"] },
  robots_unreadable: { required: "无法读取", forbidden: ["AI crawler permissions", "禁止", "被封"] },
  snippets_not_checked: { required: "本次没有检查", forbidden: ["Snippet permission", "未检测到", "被禁止"] },
  coverage_incomplete: { required: "不完整", forbidden: ["customer knowledge sections", "全部缺失"] },
  carried_owner_declared_only: { required: "你自己声明", forbidden: ["This update observed nothing", "已删除", "已失效"] },
};

it("says every clause in Chinese, with the meaning the clause actually has", () => {
  for (const key of GEO_LIMITATION_KEYS) {
    const sentence = rendered("zh", key, SAMPLE[key]);
    const spec = ZH_WORDING[key];
    expect(sentence, key).toContain(spec.required);
    for (const claim of spec.forbidden) expect(sentence, `${key}: ${claim}`).not.toContain(claim);
    // A Chinese sentence that is byte-identical to the English one is the bug.
    expect(sentence, key).not.toBe(geoLimitationEnglish(key, SAMPLE[key]));
  }
});

/**
 * The words a parameter has to resolve to, as literals.
 *
 * Asserting `toContain(zh...card.groups.press)` would pass for any value that
 * key holds -- "Press coverage" included -- because the renderer reads the same
 * key. These are written out so the catalog has to agree with them.
 */
it("names the groups, stages and reasons a parameter points at, rather than the contract token", () => {
  const zhGroups = rendered("zh", "evidence_groups_not_collected", { groups: "press,thirdPartyProfiles" });
  expect(zhGroups).toBe("本次没有采集：媒体报道、第三方档案。");
  expect(zhGroups).not.toContain("thirdPartyProfiles");

  const zhStage = rendered("zh", "offsite_stage_stopped", { stage: "landing_pages", reason: "rate_limited", count: 5 });
  expect(zhStage).toContain("落地页抓取");
  expect(zhStage).toContain("受到频率限制");
  expect(zhStage).not.toContain("landing_pages");
  expect(zhStage).not.toContain("rate_limited");
  expect(zhStage).toContain("5");

  const zhReason = rendered("zh", "offsite_pages_unread", { count: 4, reason: "fetch_failed" });
  expect(zhReason).toContain("读取失败");
  expect(zhReason).not.toContain("fetch_failed");

  // The stored English carries names too: `Off-site landing_pages stopped early
  // (rate_limited)` was the sentence this replaces.
  const stored = geoLimitationEnglish("offsite_stage_stopped", { stage: "landing_pages", reason: "rate_limited", count: 5 });
  expect(stored).not.toContain("landing_pages");
  expect(stored).not.toContain("rate_limited");
});

describe("composing a limitation", () => {
  // Two of these fit inside the 800-code-point bound and three do not, so the
  // join has to stop somewhere -- which is the case the keys must follow.
  const long = { key: "offsite_stage_stopped" as const, params: { stage: "s".repeat(120), reason: "r".repeat(120), count: 7 } };

  it("keeps whole sentences and stops, rather than cutting one in half", () => {
    const single = geoLimitationEnglish(long.key, long.params);
    const two = geoComposeLimitation([long, long]);
    expect(two.limitation).toBe(`${single} ${single}`);
    expect(two.keys).toHaveLength(2);

    // Three do not fit. The third is dropped whole, from BOTH halves: a key with
    // no sentence behind it would put a clause on the page the payload never
    // stored, and a sentence with no key would silently un-localize the module.
    const three = geoComposeLimitation([long, long, long]);
    expect(three.limitation).toBe(`${single} ${single}`);
    expect(three.keys).toHaveLength(2);
    expect(geoText.safeParse(three.limitation).success).toBe(true);
  });

  it("joins everything that fits and drops nothing", () => {
    const composed = geoComposeLimitation([
      { key: "machine_signals_absent" },
      { key: "robots_unreadable" },
      { key: "snippets_not_checked" },
    ]);
    expect(composed.limitation).toBe([
      geoLimitationEnglish("machine_signals_absent"),
      geoLimitationEnglish("robots_unreadable"),
      geoLimitationEnglish("snippets_not_checked"),
    ].join(" "));
    expect(composed.keys.map((clause) => clause.key)).toEqual(["machine_signals_absent", "robots_unreadable", "snippets_not_checked"]);
  });

  /**
   * A `partial` module with an empty limitation is refused by the payload
   * contract, and the old joiner could produce one from a single sentence too
   * long to fit. It cannot happen now: every parameter is bounded at 200 code
   * points and no template adds more than a hundred, so the first clause always
   * fits. Asserted rather than reasoned about, for every clause.
   */
  it("always produces a sentence the contract accepts, even at maximum parameters", () => {
    for (const key of GEO_LIMITATION_KEYS) {
      const params: GeoLimitationParams = {
        count: Number.MAX_SAFE_INTEGER,
        reason: "x".repeat(200),
        stage: "y".repeat(200),
        groups: "z".repeat(200),
      };
      const composed = geoComposeLimitation([{ key, params }]);
      expect(composed.limitation, key).not.toBe("");
      expect(geoText.safeParse(composed.limitation).success, key).toBe(true);
      expect(composed.keys, key).toHaveLength(1);
    }
  });

  it("writes the sentence and its keys as one pair the contract accepts", () => {
    const partial = geoPartialLimitation([{ key: "evidence_items_unshowable", params: { count: 2 } }]);
    expect(geoText.safeParse(partial.limitation).success).toBe(true);
    expect(geoLimitationKeysSchema.safeParse(partial.limitationKeys).success).toBe(true);
    expect(partial.limitation).toContain("2");
  });

  it("refuses more clauses than the contract holds", () => {
    const many = Array.from({ length: GEO_LIMITATION_CLAUSES + 2 }, () => ({ key: "coverage_incomplete" as const }));
    expect(geoComposeLimitation(many).keys).toHaveLength(GEO_LIMITATION_CLAUSES);
    expect(geoLimitationKeysSchema.safeParse(geoComposeLimitation(many).keys).success).toBe(true);
  });
});

describe("what the contract refuses to store", () => {
  /**
   * `key` is what the reader looks up, so it must never name a prototype member.
   * `constructor` is allowed through the schema on purpose -- the reader guards
   * its own table with `Object.hasOwn`, and rejecting a harmless word here would
   * be a rule the reader does not actually depend on.
   */
  it("refuses a key that could reach Object.prototype", () => {
    expect(geoLimitationKeysSchema.safeParse([{ key: "__proto__" }]).success).toBe(false);
    expect(geoLimitationKeysSchema.safeParse([{ key: "constructor" }]).success).toBe(true);
  });

  /**
   * A hostile `__proto__` parameter, written the way one actually arrives:
   * `JSON.parse` makes it an OWN property, where an object literal would
   * quietly set the prototype instead and prove nothing.
   *
   * Zod does not reject it -- it drops it, which is why this asserts on what
   * comes OUT rather than on `success`. The parsed params carry no such key and
   * their prototype is untouched, so the reader's named `Object.hasOwn` lookups
   * cannot reach `Object.prototype` through them.
   */
  it("lets no __proto__ parameter survive parsing", () => {
    const parsed = geoLimitationKeysSchema.safeParse([
      { key: "evidence_items_unshowable", params: JSON.parse('{"__proto__":"x","count":2}') },
    ]);
    expect(parsed.success).toBe(true);
    const params = parsed.data![0]!.params!;
    expect(Object.getOwnPropertyNames(params)).toEqual(["count"]);
    expect(Object.getPrototypeOf(params)).toBe(Object.prototype);
    expect(Object.hasOwn(params, "__proto__")).toBe(false);
  });

  it("refuses an empty list, an unbounded parameter and a fractional count", () => {
    expect(geoLimitationKeysSchema.safeParse([]).success).toBe(false);
    expect(geoLimitationKeysSchema.safeParse([{ key: "offsite_pages_unread", params: { reason: "x".repeat(201) } }]).success).toBe(false);
    expect(geoLimitationKeysSchema.safeParse([{ key: "evidence_items_unshowable", params: { count: 1.5 } }]).success).toBe(false);
  });

  /**
   * The key is TEXT, not an enum. A build that predates a key added later has
   * to keep parsing the payload that carries it -- an already-open tab reading
   * one sentence in English, rather than a card that refuses to render at all.
   */
  it("accepts a key it has never heard of", () => {
    expect(geoLimitationKeysSchema.safeParse([{ key: "a_clause_from_next_year" }]).success).toBe(true);
  });
});
