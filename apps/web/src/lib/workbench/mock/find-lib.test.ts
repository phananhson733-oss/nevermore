import { describe, expect, it } from "vitest";
import { AUDIT_CHECK_COUNT, FIND_LIB } from "./find-lib.ts";

const slowTemplate = FIND_LIB.find((template) => template.needsSlowLcp === true);
const byTitle = (title: string) => FIND_LIB.find((template) => template.t === title);
const titlesWhere = (predicate: (template: (typeof FIND_LIB)[number]) => boolean): readonly string[] =>
  FIND_LIB.filter(predicate).map((template) => template.t);

describe("FIND_LIB", () => {
  it("has 17 checks and AUDIT_CHECK_COUNT follows it", () => {
    expect(FIND_LIB).toHaveLength(17);
    expect(AUDIT_CHECK_COUNT).toBe(FIND_LIB.length);
  });

  it("has unique titles, because diffAudits keys on t", () => {
    expect(new Set(FIND_LIB.map((template) => template.t)).size).toBe(FIND_LIB.length);
  });

  it("carries no unsupported claims, framework-only or outdated advice, or 'measured' wording", () => {
    const text = JSON.stringify(FIND_LIB);
    expect(text).not.toMatch(/被引用率最高|next\/image|Next\.js|实测/);
    expect(text).not.toMatch(/generateMetadata|root layout|next\//i);
    expect(text).not.toMatch(/prev\/next|rel\s*prev/);
  });

  it("states no concrete counts and names no page types in found (R10)", () => {
    for (const template of FIND_LIB) {
      for (const text of [template.t, template.found, template.fix]) {
        expect(text).not.toMatch(/\d+\s*(个|条|篇|处)/);
      }
      expect(template.found).not.toMatch(/对比页|定价页/);
    }
  });

  it("does not treat the GPTBot training crawler as a blocked search crawler (R10)", () => {
    const robots = FIND_LIB.find((template) => template.found.includes("User-agent"));
    expect(robots?.found).toBe("User-agent: OAI-SearchBot / PerplexityBot → Disallow: /");
    expect(robots?.found).not.toContain("GPTBot");
    expect(robots?.expect).toContain("GPTBot 是否放行是另一个决定");
  });

  it("has exactly one slow-LCP template and only it carries the {lcp} token", () => {
    expect(FIND_LIB.filter((template) => template.needsSlowLcp === true)).toHaveLength(1);
    expect(slowTemplate?.found).toBe("LCP {lcp}s（移动端）");
    expect(JSON.stringify(FIND_LIB.filter((template) => template !== slowTemplate))).not.toContain("{lcp}");
  });

  it("scopes each non-generic template to the pages it talks about", () => {
    const scoped = Object.fromEntries(
      FIND_LIB.filter((template) => template.scope !== "any").map((template) => [template.t, template.scope]),
    );
    expect(scoped).toEqual({
      "AI 抓取器被 robots.txt 拦截": "site",
      "sitemap 里有 404 与重定向 URL": "site",
      "移动端 LCP 偏慢": "site",
      "全站没有 Organization schema": "site",
      "没有 llms.txt": "site",
      "核心工具页的站内入口太少": "tools",
      "分页 canonical 全部指向第一页": "blog",
      "部分文章 meta description 缺失": "blog",
      "Article schema 缺 dateModified": "blog",
      "文章不展示更新日期": "blog",
      "关键论述缺数字与日期": "sales",
      "没有写明谁不适合用": "sales",
    });
  });

  it("flags the templates whose page row must agree with them", () => {
    expect(titlesWhere((template) => template.raisesRowH1 === true)).toEqual(["多个页面有多个 H1"]);
    expect(titlesWhere((template) => template.needsRowSchema === true)).toEqual([
      "Article schema 缺 dateModified", "FAQ schema 与页面可见内容不符",
    ]);
  });

  it("reserves high severity for established mechanisms", () => {
    expect(titlesWhere((template) => template.sev === "high")).toEqual([
      "AI 抓取器被 robots.txt 拦截", "sitemap 里有 404 与重定向 URL", "正文依赖客户端渲染",
    ]);
    expect(byTitle("没有 llms.txt")).toMatchObject({
      sev: "low", w: 1, expect: "可选：一份产品事实入口；尚无主流 AI 搜索平台公开确认会读取",
    });
    expect(byTitle("小节开头是过渡句不是结论句")).toMatchObject({ sev: "mid", w: 2 });
  });

  it("pins the rewritten wording from the review", () => {
    expect(byTitle("全站没有 Organization schema")?.found).toBe("JSON-LD 里没有 Organization 类型");
    expect(byTitle("分页 canonical 全部指向第一页")).toMatchObject({
      found: "?page=2 的 canonical 指向第一页",
      fix: "分页页 canonical 改自指，分页之间保留可抓取的普通链接",
    });
    expect(byTitle("关键论述缺数字与日期")?.found).toBe("关键论述没有数字断言");
    expect(byTitle("没有写明谁不适合用")).toMatchObject({ found: "页面上没有边界说明", fix: "加一段'不适合谁'" });
  });

  it("keeps runAudit's worst case above the score floor", () => {
    const worst = FIND_LIB.map((template) => template.w)
      .sort((a, b) => b - a)
      .slice(0, 12)
      .reduce((sum, weight) => sum + weight, 0);
    expect(100 - 2.1 * worst).toBeGreaterThan(18);
  });
});
