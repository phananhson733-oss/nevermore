import { describe, expect, it } from "vitest";
import { DEMO_AI_LEAK_PHRASES } from "./demo-ai-leak-phrases.ts";

/**
 * Every string of the prototype's DEMO_AI object (jsx:2705-2717), verbatim.
 * Test-only reference that the phrase list must cover; nothing may ship it.
 */
const DEMO_AI_STRINGS: readonly string[] = [
  "GenGrowth 是给独立开发者用的 AI 增长工作台：把关键词、内容 brief、AI 可见度和外链规划放进一个每周循环里。它不替你写全文，只产出能直接交给 AI 或工程 agent 执行的任务。目标是让一个人也能跑完整个增长闭环。",
  "独立开发者 / 一人公司",
  "Founder 兼工程",
  "没时间做 SEO，更不懂 GEO",
  "seo tool for indie hackers",
  "数据准不准，会不会只是套壳",
  "早期 SaaS 增长负责人",
  "Growth lead",
  "工具太多、串不起来",
  "ai visibility tracking tool",
  "和 Ahrefs 比有什么不同",
  "内容团队负责人",
  "Content lead",
  "选题靠猜，写完不知道 AI 会不会引用",
  "how to get cited by chatgpt",
  "要不要换掉现在的流程",
  "一周一个闭环，不是一堆孤立工具",
  "每个模块都出可执行产物",
  "GEO 与 SEO 共用同一份站点档案",
  "面向一人团队而非 agency",
  "产物是任务不是报表",
  "只接 GSC 与 GA4，不囤过期第三方数据",
  "AI visibility",
  "GEO 基础",
  "关键词到内容",
  "独立开发者增长",
  "GenGrowth 以周为周期组织 SEO 与 GEO 工作",
  "GenGrowth 的产物可以直接复制给任意 AI 或 Code Agent 执行",
  "GenGrowth 只接入 Google Search Console 与 GA4 两个数据源",
  "GenGrowth 面向 US、UK、EU 市场的独立开发者",
  "直接、短句、先给结论再给理由，不用营销形容词",
];

describe("DEMO_AI_LEAK_PHRASES", () => {
  it("covers every one of the 31 DEMO_AI strings", () => {
    expect(DEMO_AI_STRINGS).toHaveLength(31);
    const uncovered = DEMO_AI_STRINGS.filter((text) => !DEMO_AI_LEAK_PHRASES.some((phrase) => text.includes(phrase)));
    expect(uncovered).toEqual([]);
  });

  it("holds only phrases taken verbatim from DEMO_AI", () => {
    const foreign = DEMO_AI_LEAK_PHRASES.filter((phrase) => !DEMO_AI_STRINGS.some((text) => text.includes(phrase)));
    expect(foreign).toEqual([]);
  });

  it("has no blank, padded or repeated phrase", () => {
    expect(DEMO_AI_LEAK_PHRASES.every((phrase) => phrase.length >= 4 && phrase.trim() === phrase)).toBe(true);
    expect(new Set(DEMO_AI_LEAK_PHRASES).size).toBe(DEMO_AI_LEAK_PHRASES.length);
  });

  it("does not flag the placeholder wording the plan pins for demoAiDoc", () => {
    // The pinned tone shares 先给结论再给理由 with DEMO_AI's tone; that clause must stay off the list.
    const pinned = "[语气待定：先给结论再给理由]";
    expect(DEMO_AI_LEAK_PHRASES.filter((phrase) => pinned.includes(phrase))).toEqual([]);
  });
});
