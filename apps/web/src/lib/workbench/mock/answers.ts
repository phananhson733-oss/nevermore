/**
 * Skeleton answer-page plan (jsx:2231-2244). With no model in the mock layer this
 * is the only plan the answers view gets; every slot to fill is a bracket placeholder.
 */
import type { AnswerPlan, Profile } from "../types.ts";
import { productName } from "./content.ts";
import { slugify } from "./text.ts";

export function fallbackPlan(
  query: string,
  profile: Pick<Profile, "brand">,
): AnswerPlan {
  return {
    url: `/answers/${slugify(query)}`,
    h1: query,
    lead: `[60 词内直接回答「${query}」，第一句给结论，第二句给条件]`,
    subq: [
      "用户下一步会问什么？",
      "怎么判断适不适合自己？",
      "有哪些常见误区？",
    ],
    facts: [
      "[补一个带数字的事实，注明来源]",
      "[补一个带日期的事实，注明来源]",
      "[补一个可验证的对比事实，注明来源]",
    ],
    dims: ["适用团队规模", "上手成本", "数据来源", "价格"],
    faq: [
      `${productName(profile)} 适合谁？`,
      `${query} 需要多久见效？`,
      "有免费方案吗？",
    ],
    internal: ["首页 → 本页", "本页 → [定价页]"],
    schema: "FAQPage",
    beat: "[竞品当前答案的薄弱处，以及我们靠什么盖过它]",
  };
}

/**
 * One fallback plan per query, keyed by the query as typed. Built with
 * `Object.fromEntries` because the keys are user text: assigning `out[q] = plan`
 * for `q === "__proto__"` would swap the record's prototype instead of adding a key.
 */
export function plansFor(
  queries: readonly string[],
  profile: Pick<Profile, "brand">,
): Readonly<Record<string, AnswerPlan>> {
  return Object.fromEntries(
    queries.map((query) => [query, fallbackPlan(query, profile)] as const),
  );
}
