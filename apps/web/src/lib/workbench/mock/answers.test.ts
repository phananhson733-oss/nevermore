import { describe, expect, it } from "vitest";
import { fallbackPlan, plansFor } from "./answers.ts";
import { slugify } from "./text.ts";

const ACME = { brand: "Acme" } as const;

/** Third-party names, prices and percentages the plan must never assert. */
const INVENTED_FACTS = /GenGrowth|gengrowth|Ahrefs|Semrush|\$\d|¥\d|\d+(\.\d+)?%/;

describe("fallbackPlan", () => {
  it("builds the skeleton answer page plan", () => {
    expect(fallbackPlan("What is GEO?", ACME)).toEqual({
      url: "/answers/what-is-geo",
      h1: "What is GEO?",
      lead: "[60 词内直接回答「What is GEO?」，第一句给结论，第二句给条件]",
      subq: ["用户下一步会问什么？", "怎么判断适不适合自己？", "有哪些常见误区？"],
      facts: ["[补一个带数字的事实，注明来源]", "[补一个带日期的事实，注明来源]", "[补一个可验证的对比事实，注明来源]"],
      dims: ["适用团队规模", "上手成本", "数据来源", "价格"],
      faq: ["Acme 适合谁？", "What is GEO? 需要多久见效？", "有免费方案吗？"],
      internal: ["首页 → 本页", "本页 → [定价页]"],
      schema: "FAQPage",
      beat: "[竞品当前答案的薄弱处，以及我们靠什么盖过它]",
    });
  });

  it.each(["best crm for startups", "问い合わせ フォーム", "🙂", "Café résumé"])("derives the url from slugify for %j", (query) => {
    expect(fallbackPlan(query, ACME).url).toBe(`/answers/${slugify(query)}`);
  });

  it("never yields a bare /answers/ url", () => {
    expect(fallbackPlan("!!!", ACME).url).toMatch(/^\/answers\/q-[0-9a-z]+$/);
  });

  it.each(["", "   "])("puts the bracket placeholder in the faq when the brand is %j", (brand) => {
    expect(fallbackPlan("q", { brand }).faq[0]).toBe("[产品] 适合谁？");
  });

  it("asserts no third-party names, prices or percentages", () => {
    expect(JSON.stringify(fallbackPlan("best crm", { brand: "" }))).not.toMatch(INVENTED_FACTS);
  });

  it("returns fresh arrays on every call", () => {
    const first = fallbackPlan("q", ACME);
    const second = fallbackPlan("q", ACME);
    expect(second.subq).not.toBe(first.subq);
    expect(second.facts).not.toBe(first.facts);
    expect(second.faq).not.toBe(first.faq);
  });
});

describe("plansFor", () => {
  it("keys one fallback plan by each query", () => {
    const result = plansFor(["a", "b"], ACME);
    expect(Object.keys(result)).toEqual(["a", "b"]);
    expect(result["a"]).toEqual(fallbackPlan("a", ACME));
    expect(result["b"]).toEqual(fallbackPlan("b", ACME));
  });

  it("gives an empty record for no queries and one key for a repeated query", () => {
    expect(Object.keys(plansFor([], ACME))).toEqual([]);
    expect(Object.keys(plansFor(["a", "a"], ACME))).toEqual(["a"]);
  });

  it("stores __proto__ as an own key without touching any prototype", () => {
    const queries: readonly string[] = JSON.parse('["__proto__", "a"]') as string[];
    const result = plansFor(queries, ACME);
    const expected = Object.fromEntries([
      ["__proto__", fallbackPlan("__proto__", ACME)],
      ["a", fallbackPlan("a", ACME)],
    ]);

    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(Object.keys(result)).toEqual(["__proto__", "a"]);
    expect(Object.getOwnPropertyDescriptor(result, "__proto__")?.value).toEqual(fallbackPlan("__proto__", ACME));
    expect(result["__proto__"]).toEqual(fallbackPlan("__proto__", ACME));
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(result).toEqual(expected);

    const probe: Record<string, unknown> = {};
    expect(probe["polluted"]).toBeUndefined();
    expect(typeof probe["toString"]).toBe("function");
    expect(Object.hasOwn(Object.prototype, "url")).toBe(false);
    expect(Object.hasOwn(Object.prototype, "h1")).toBe(false);
  });

  it("keeps the __proto__ entry through a JSON round trip", () => {
    const roundTripped = JSON.parse(JSON.stringify(plansFor(["__proto__"], ACME))) as Record<string, unknown>;
    expect(Object.hasOwn(roundTripped, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(roundTripped, "__proto__")?.value).toEqual(fallbackPlan("__proto__", ACME));
  });

  it.each(["constructor", "toString", "hasOwnProperty"])("stores %s as an own key holding a plan", (query) => {
    const result = plansFor([query], ACME);
    expect(Object.hasOwn(result, query)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(result, query)?.value).toEqual(fallbackPlan(query, ACME));
  });
});
