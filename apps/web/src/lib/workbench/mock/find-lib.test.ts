import { describe, expect, it } from "vitest";
import { AUDIT_CHECK_COUNT, FIND_LIB } from "./find-lib.ts";

const slowTemplate = FIND_LIB.find((template) => template.needsSlowLcp === true);

describe("FIND_LIB", () => {
  it("has 17 checks and AUDIT_CHECK_COUNT follows it", () => {
    expect(FIND_LIB).toHaveLength(17);
    expect(AUDIT_CHECK_COUNT).toBe(FIND_LIB.length);
  });

  it("has unique titles, because diffAudits keys on t", () => {
    expect(new Set(FIND_LIB.map((template) => template.t)).size).toBe(FIND_LIB.length);
  });

  it("carries no unsupported claims, Next.js-only advice or 'measured' wording", () => {
    expect(JSON.stringify(FIND_LIB)).not.toMatch(/被引用率最高|next\/image|Next\.js|实测/);
    expect(JSON.stringify(FIND_LIB)).not.toMatch(/generateMetadata|root layout|next\//i);
  });

  it("states no concrete counts that would contradict the report's own numbers (R10)", () => {
    for (const template of FIND_LIB) {
      for (const text of [template.t, template.found, template.fix]) {
        expect(text).not.toMatch(/\d+\s*(个|条|篇|处)/);
      }
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
    const others = FIND_LIB.filter((template) => template !== slowTemplate);
    expect(JSON.stringify(others)).not.toContain("{lcp}");
  });
});
