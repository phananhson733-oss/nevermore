/**
 * Distinctive phrases from the prototype's `DEMO_AI` (jsx:2705-2717), which
 * describes GenGrowth itself. Sample content must contain none of them (R8).
 * Scan with a case-sensitive `includes`. Phrases are clause-sized rather than
 * whole strings, so a single borrowed clause is caught too.
 * `demo-ai-leak-phrases.test.ts` checks that all 31 DEMO_AI strings are covered
 * and that every phrase really comes from DEMO_AI. 先给结论再给理由 is left out on
 * purpose: the plan pins that clause in `demoAiDoc`'s tone placeholder.
 */
export const DEMO_AI_LEAK_PHRASES: readonly string[] = [
  // brand and audience
  "GenGrowth",
  "独立开发者",
  "一人公司",
  // summary
  "给独立开发者用的 AI 增长工作台",
  "放进一个每周循环里",
  "它不替你写全文",
  "只产出能直接交给 AI 或工程 agent 执行的任务",
  "让一个人也能跑完整个增长闭环",
  // icp
  "独立开发者 / 一人公司",
  "Founder 兼工程",
  "没时间做 SEO，更不懂 GEO",
  "seo tool for indie hackers",
  "数据准不准",
  "会不会只是套壳",
  "早期 SaaS 增长负责人",
  "Growth lead",
  "工具太多、串不起来",
  "ai visibility tracking tool",
  "和 Ahrefs 比有什么不同",
  "内容团队负责人",
  "Content lead",
  "选题靠猜",
  "写完不知道 AI 会不会引用",
  "how to get cited by chatgpt",
  "要不要换掉现在的流程",
  // value_props
  "一周一个闭环",
  "不是一堆孤立工具",
  "每个模块都出可执行产物",
  "GEO 与 SEO 共用同一份站点档案",
  // diff
  "面向一人团队而非 agency",
  "产物是任务不是报表",
  "只接 GSC 与 GA4",
  "不囤过期第三方数据",
  // pillars
  "AI visibility",
  "GEO 基础",
  "关键词到内容",
  "独立开发者增长",
  // facts
  "以周为周期组织 SEO 与 GEO 工作",
  "可以直接复制给任意 AI 或 Code Agent 执行",
  "只接入 Google Search Console 与 GA4 两个数据源",
  "面向 US、UK、EU 市场的独立开发者",
  // tone
  "直接、短句",
  "不用营销形容词",
];
