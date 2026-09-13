/**
 * The audit check library (jsx:459-477), data only. Mock content is Chinese
 * (design §7); severities are ids. Rewritten per R10 and the Task 6 review: no
 * concrete counts that the same report's crawl or page rows would contradict,
 * no framework-specific or outdated fixes (the demo stack is unknown), no
 * unsupported general claims, high severity only for established mechanisms,
 * and the GPTBot training crawler is not treated as a blocked search crawler.
 */
import type { Finding } from "../types.ts";

/** Which page rows a template may land on: `site` = home, `blog` = /blog and /blog/…, `tools` = /tools/…, `sales` = /pricing and /compare/…, `any` = every row. */
export type AuditScope = "site" | "blog" | "tools" | "sales" | "any";

/** Template-only fields (`scope` and the flags) never reach a persisted Finding: `findingFromTemplate` copies field by field. */
export interface FindingTemplate extends Omit<Finding, "id" | "page"> {
  readonly scope: AuditScope;
  /** `found` carries `{lcp}`; `runAudit` only draws it when the crawl's LCP is at least 2.5s. */
  readonly needsSlowLcp?: true;
  /** Its page row shows h1 = 2. */
  readonly raisesRowH1?: true;
  /** Its page row shows hasSchema = true. */
  readonly needsRowSchema?: true;
}

export const FIND_LIB: readonly FindingTemplate[] = [
  { cat: "抓取与索引", t: "AI 抓取器被 robots.txt 拦截", sev: "high", eng: "geo", scope: "site", found: "User-agent: OAI-SearchBot / PerplexityBot → Disallow: /", expect: "对 OAI-SearchBot / PerplexityBot / Claude-SearchBot 放行正文目录（训练爬虫 GPTBot 是否放行是另一个决定）", fix: "删掉针对 AI 搜索抓取器的 Disallow，后台与接口目录的限制保留", w: 3 },
  { cat: "抓取与索引", t: "sitemap 里有 404 与重定向 URL", sev: "high", eng: "seo", scope: "site", found: "sitemap.xml 中存在非 200 的 URL", expect: "只收录 200 且 canonical 自指的 URL", fix: "生成 sitemap 时过滤掉非 200 与重定向的 URL", w: 3 },
  { cat: "抓取与索引", t: "正文依赖客户端渲染", sev: "high", eng: "both", scope: "any", found: "禁用 JS 后首屏正文为空，只剩骨架", expect: "正文出现在服务端返回的 HTML 里", fix: "受影响的路由改为服务端渲染或静态生成，不要假设抓取器会执行 JS", w: 3 },
  { cat: "抓取与索引", t: "分页 canonical 全部指向第一页", sev: "mid", eng: "seo", scope: "blog", found: "?page=2 的 canonical 指向第一页", expect: "canonical 自指", fix: "分页页 canonical 改自指，分页之间保留可抓取的普通链接", w: 2 },
  { cat: "页面体验", t: "移动端 LCP 偏慢", sev: "mid", eng: "seo", scope: "site", found: "LCP {lcp}s（移动端）", expect: "LCP < 2.5s，CLS < 0.1", fix: "首屏大图声明宽高、不做懒加载并提高加载优先级，字体加 font-display: swap", w: 2, needsSlowLcp: true },
  { cat: "结构与语义", t: "多个页面有多个 H1", sev: "mid", eng: "both", scope: "any", found: "Logo 与页面标题都用了 h1", expect: "每页唯一 H1", fix: "Logo 改 div，H1 只留页面主标题", w: 2, raisesRowH1: true },
  { cat: "结构与语义", t: "部分文章 meta description 缺失", sev: "mid", eng: "seo", scope: "blog", found: "description 为空，SERP 自动截取正文", expect: "每页手写 description，含差异点", fix: "为每篇文章补写 meta description，以文章首句结论为基础", w: 2 },
  { cat: "结构与语义", t: "H2 用的是名词短语而不是问题", sev: "mid", eng: "geo", scope: "any", found: "示例：'功能介绍' '产品优势'", expect: "H2 用用户会问的原句", fix: "按目标查询重写 H2，一个 H2 对应一个提问", w: 2 },
  { cat: "结构与语义", t: "核心工具页的站内入口太少", sev: "mid", eng: "seo", scope: "tools", found: "/tools/* 主要从页脚可达", expect: "核心页 3 个以上入口", fix: "首页加工具区块，相关博客正文加内链", w: 2 },
  { cat: "结构化数据", t: "全站没有 Organization schema", sev: "mid", eng: "both", scope: "site", found: "JSON-LD 里没有 Organization 类型", expect: "含 name / url / logo / sameAs", fix: "在全站共用的页面模板里注入一份 Organization JSON-LD", w: 2 },
  { cat: "结构化数据", t: "Article schema 缺 dateModified", sev: "low", eng: "both", scope: "blog", found: "只有 datePublished", expect: "两个日期都有且真实", fix: "从内容源取真实更新时间，写入 schema 和页面可见位置", w: 1, needsRowSchema: true },
  { cat: "结构化数据", t: "FAQ schema 与页面可见内容不符", sev: "mid", eng: "both", scope: "any", found: "schema 里的 FAQ 条目多于页面上可见的 FAQ", expect: "schema 只描述页面真实存在的内容", fix: "删掉多出的条目，或把它们真的写到页面上", w: 2, needsRowSchema: true },
  { cat: "GEO 可引用性", t: "没有 llms.txt", sev: "low", eng: "geo", scope: "site", found: "/llms.txt 404", expect: "可选：一份产品事实入口；尚无主流 AI 搜索平台公开确认会读取", fix: "用事实知识库模块生成后放到根目录", w: 1 },
  { cat: "GEO 可引用性", t: "小节开头是过渡句不是结论句", sev: "mid", eng: "geo", scope: "any", found: "多数段落以'首先我们来看'开头", expect: "每节第一句就是可独立摘录的结论", fix: "每个 H2 下第一句改成完整结论句", w: 2 },
  { cat: "GEO 可引用性", t: "关键论述缺数字与日期", sev: "mid", eng: "geo", scope: "sales", found: "关键论述没有数字断言", expect: "事实带数字、日期、来源", fix: "补具体数值并标注核对日期", w: 2 },
  { cat: "GEO 可引用性", t: "没有写明谁不适合用", sev: "mid", eng: "geo", scope: "sales", found: "页面上没有边界说明", expect: "明确的不适用场景段落", fix: "加一段'不适合谁'", w: 2 },
  { cat: "GEO 可引用性", t: "文章不展示更新日期", sev: "low", eng: "geo", scope: "blog", found: "页面无可见日期", expect: "可见且真实的更新日期", fix: "文章头部展示更新日期，与 schema 一致", w: 1 },
];

/** "检查 N 项" in the audit view reads this, never a literal (K4). */
export const AUDIT_CHECK_COUNT: number = FIND_LIB.length;
