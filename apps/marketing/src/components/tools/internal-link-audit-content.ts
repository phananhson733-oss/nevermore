// @input  -- supported marketing locale
// @output -- typed bilingual copy for the P0-2 public Internal Link Audit page
// @pos    -- single content authority shared by the P0-2 server page and client tool

export type InternalLinkAuditLocale = "en" | "zh";

interface ContentItem {
  readonly title: string;
  readonly body: string;
}

interface FaqItem {
  readonly question: string;
  readonly answer: string;
}

interface InternalLinkAuditContent {
  readonly metaTitle: string;
  readonly metaDescription: string;
  readonly schemaDescription: string;
  readonly schemaFeatures: readonly string[];
  readonly breadcrumb: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly subtitle: string;
  readonly primaryCta: string;
  readonly trustLine: string;
  readonly demoBanner: string;
  readonly formLabel: string;
  readonly placeholder: string;
  readonly startCrawl: string;
  readonly running: string;
  readonly inputHelp: string;
  readonly mockScope: string;
  readonly invalidUrl: string;
  readonly stages: readonly string[];
  readonly demoResultLabel: string;
  readonly demoResultBody: string;
  readonly result: {
    readonly summaryEyebrow: string;
    readonly summaryTitle: string;
    readonly summaryBody: string;
    readonly mappedPages: string;
    readonly internalLinks: string;
    readonly orphanPages: string;
    readonly priorityFixes: string;
    readonly graphTitle: string;
    readonly graphBody: string;
    readonly filterAll: string;
    readonly filterPillars: string;
    readonly filterOrphans: string;
    readonly filterDeep: string;
    readonly filterBroken: string;
    readonly priorityTitle: string;
    readonly priorityBody: string;
    readonly detailEyebrow: string;
    readonly evidence: string;
    readonly limitation: string;
    readonly suggestedSource: string;
    readonly anchorText: string;
    readonly verify: string;
    readonly selectPrompt: string;
    readonly sampleLabel: string;
    readonly fixedData: string;
    readonly fourPartTitle: string;
    readonly observation: string;
    readonly observationBody: string;
    readonly diagnosis: string;
    readonly diagnosisBody: string;
    readonly recommendation: string;
    readonly recommendationBody: string;
    readonly artifact: string;
    readonly artifactBody: string;
    readonly exportPreview: string;
  };
  readonly howEyebrow: string;
  readonly howTitle: string;
  readonly howIntro: string;
  readonly howSteps: readonly ContentItem[];
  readonly findsEyebrow: string;
  readonly findsTitle: string;
  readonly findsIntro: string;
  readonly findings: readonly ContentItem[];
  readonly methodEyebrow: string;
  readonly methodTitle: string;
  readonly methods: readonly ContentItem[];
  readonly limitsEyebrow: string;
  readonly limitsTitle: string;
  readonly limitations: readonly ContentItem[];
  readonly audienceEyebrow: string;
  readonly audienceTitle: string;
  readonly audienceBody: string;
  readonly comparisons: readonly ContentItem[];
  readonly faqEyebrow: string;
  readonly faqTitle: string;
  readonly faqs: readonly FaqItem[];
  readonly relatedEyebrow: string;
  readonly relatedTitle: string;
  readonly relatedAudit: string;
  readonly relatedAuditBody: string;
  readonly relatedTools: string;
  readonly readingEyebrow: string;
  readonly readingTitle: string;
  readonly readingItems: readonly string[];
  readonly ctaEyebrow: string;
  readonly ctaTitle: string;
  readonly ctaBody: string;
  readonly ctaButton: string;
}

const EN: InternalLinkAuditContent = {
  metaTitle: "Free Internal Link Audit — Find Broken Links & Orphan Pages",
  metaDescription:
    "Audit your internal link structure in one crawl. Find broken links, orphan pages, and the pages your own site is starving. Free, no sign-up.",
  schemaDescription:
    "A bounded public internal link audit that crawls static same-origin HTML, respects robots.txt, and does not store the submitted URL or report.",
  schemaFeatures: [
    "Real bounded same-origin static-HTML crawl",
    "Up to 25 collected pages and depth 4 per request",
    "Observed orphan candidates, deep pages, and unresolved targets",
    "Robots.txt and sitemap-aware collection",
    "No Search Console connection or persistent data storage",
  ],
  breadcrumb: "Internal Link Audit",
  eyebrow: "Free internal link audit · bounded public crawl",
  title: "Internal Link Audit",
  subtitle:
    "One crawl shows every internal link on your site — the broken ones, the pages nothing points to, and the sections quietly starved of the authority you already have.",
  primaryCta: "Run my internal link audit free",
  trustLine: "Free · No sign-up · No software to install · Any public website",
  demoBanner:
    "This public tool performs a transient, bounded crawl of static same-origin HTML. It respects robots.txt, stores no report, and never changes your website.",
  formLabel: "Website URL",
  placeholder: "yourdomain.com",
  startCrawl: "Run internal link audit",
  running: "Building your bounded link graph…",
  inputHelp:
    "The tool reads public HTML only — no Search Console, ownership verification, account, or site changes.",
  mockScope:
    "Each request is capped at 25 pages, depth 4, and a 40-second crawl budget. A partial report says so explicitly.",
  invalidUrl: "Enter a public domain or HTTP(S) URL.",
  stages: [
    "Reading homepage and sitemap entry points",
    "Mapping page-to-page HTML links",
    "Prioritizing structural gaps",
  ],
  demoResultLabel: "Bounded crawl result",
  demoResultBody:
    "Every metric below is generated from the static-HTML pages collected for the URL you entered in this request.",
  result: {
    summaryEyebrow: "Five-second answer",
    summaryTitle: "Two orphan pages deserve attention before the deeper cluster gaps",
    summaryBody:
      "The sample contains four orphans, but two already have a natural source page and a clear editorial link position. Start there, then fix the broken target reached from a high-authority guide.",
    mappedPages: "Pages mapped",
    internalLinks: "HTML internal links",
    orphanPages: "Orphan pages",
    priorityFixes: "Ready-to-review fixes",
    graphTitle: "Site relationship map",
    graphBody:
      "This view shows pages collected in this bounded crawl. Lines are observed same-origin HTML links. Select a node to inspect the recorded structural evidence and its limitations.",
    filterAll: "All nodes",
    filterPillars: "Pillars",
    filterOrphans: "Orphans",
    filterDeep: "Deep pages",
    filterBroken: "Broken targets",
    priorityTitle: "Highest-return fixes",
    priorityBody: "Ordered by source-page strength, structural gap, and edit clarity.",
    detailEyebrow: "Selected page",
    evidence: "Observed evidence",
    limitation: "Evidence limit",
    suggestedSource: "Suggested source",
    anchorText: "Suggested anchor",
    verify: "How to verify",
    selectPrompt: "Choose a node or finding to inspect its evidence.",
    sampleLabel: "Crawl scope",
    fixedData:
      "Real bounded crawl · static HTML · same origin · no stored report",
    fourPartTitle: "From finding to a fix you can review",
    observation: "Observation",
    observationBody:
      "/app-setup-guide has 0 inbound HTML links, 2 outbound links, and appears in the sample sitemap.",
    diagnosis: "Diagnosis",
    diagnosisBody:
      "The page is discoverable through the sitemap but receives no internal authority in this sample. JavaScript-only links were not evaluated.",
    recommendation: "Recommendation",
    recommendationBody:
      "Add contextual links from /wifi-feeders and /best-smart-feeders where both pages already discuss initial app setup.",
    artifact: "Artifact",
    artifactBody:
      "A review-ready link brief with source URL, target URL, insertion context, anchor suggestion, evidence limit, and a re-crawl check.",
    exportPreview: "CSV export arrives with the real crawl",
  },
  howEyebrow: "How it works",
  howTitle: "Four steps from a domain to a repair list",
  howIntro:
    "The interface is already shaped around the evidence a production crawler must return. This milestone simulates those steps without sending a website request.",
  howSteps: [
    {
      title: "1. Enter your domain",
      body: "No verification, login, or plugin. In the real crawler, any publicly reachable site can be submitted.",
    },
    {
      title: "2. We crawl and build the graph",
      body: "The planned crawler starts from the homepage and sitemap, follows same-site HTML links, and records source, target, anchor, and link context.",
    },
    {
      title: "3. Review what the structure exposes",
      body: "Orphans, broken targets, thin-linked sections, click depth, and authority concentration become visible as evidence-led findings.",
    },
    {
      title: "4. Carry reviewed fixes into your plan",
      body: "Review the evidence before making changes. The public tool does not create a project or alter your website.",
    },
  ],
  findsEyebrow: "What it finds",
  findsTitle: "An internal link audit is more than a broken-link list",
  findsIntro:
    "It inspects the connections between pages, not just the contents of one URL.",
  findings: [
    {
      title: "Broken internal links",
      body: "See the source page, failing target, and anchor text together, so you can fix the link instead of hunting for where it came from.",
    },
    {
      title: "Orphan pages — the ones nothing links to",
      body: "Compare sitemap URLs with pages reached through internal HTML links. The gap is a candidate orphan, with the sitemap and rendering limits shown.",
    },
    {
      title: "Orphans grouped by section",
      body: "A generated tag archive and a disconnected product page are different problems. URL-pattern grouping separates structural risk from expected noise.",
    },
    {
      title: "Pages with only one or two inbound links",
      body: "These pages are not orphans, but they often rely on navigation or footer links and receive little contextual support from related content.",
    },
    {
      title: "Where internal authority accumulates",
      body: "Inbound relationships reveal the pages your architecture is quietly promoting. It is a structural proxy, not a claim to calculate Google PageRank.",
    },
    {
      title: "Anchor-text distribution",
      body: "Grouped anchors reveal vague “click here” links and repeated templated language that gives readers and crawlers little context.",
    },
    {
      title: "Crawl depth from home",
      body: "The shortest observed path shows which important pages sit more than three clicks from the homepage.",
    },
    {
      title: "Existing internal-link opportunities",
      body: "For each orphan or thin-linked target, the result proposes related pages that already contain a natural editorial insertion point.",
    },
    {
      title: "A visual map of the structure",
      body: "Clusters, islands, and bottlenecks become easier to understand in a relationship map than in a flat export.",
    },
  ],
  methodEyebrow: "Method transparency",
  methodTitle: "How we decide what counts as a problem",
  methods: [
    {
      title: "What counts as an orphan",
      body: "A sitemap URL that the crawl never reached by following internal HTML links. If the sitemap is missing or stale, that limitation must travel with the result.",
    },
    {
      title: "What counts as thin-linked",
      body: "One or two observed inbound links, with contextual body links separated from global navigation and footer links.",
    },
    {
      title: "Where a crawl starts and stops",
      body: "The production design starts from the homepage and sitemap, stays on the validated origin, respects robots.txt, and stops at an explicit page, time, or safety boundary.",
    },
  ],
  limitsEyebrow: "Honest limits",
  limitsTitle: "What this audit will not tell you",
  limitations: [
    {
      title: "Links that exist only after JavaScript runs",
      body: "A raw-HTML crawler can miss client-rendered links. Surprising orphan results on a heavily rendered site must be treated as a hypothesis, not a verdict.",
    },
    {
      title: "Whether a page deserves to exist",
      body: "Zero inbound links does not mean “add links” automatically. Thin, duplicated, or obsolete pages may be better consolidated or removed.",
    },
    {
      title: "Working links that point somewhere unhelpful",
      body: "A crawler can prove a target responds; it cannot reliably infer that a technically valid destination is the best editorial destination. Semantic misdirection is deferred.",
    },
  ],
  audienceEyebrow: "Who it is for",
  audienceTitle: "For sites whose structure no longer fits in one person’s head",
  audienceBody:
    "It becomes useful around dozens of pages, especially after a migration, a URL restructure, a large content batch, or template-generated publishing.",
  comparisons: [
    {
      title: "Compared with Screaming Frog",
      body: "Screaming Frog is more complete for deep technical work and large crawls. This browser-based tool aims to remove installation and interpretation overhead by returning a prioritized repair brief.",
    },
    {
      title: "Compared with Search Console’s internal-links report",
      body: "Search Console reports pages Google already knows. A crawler independently compares sitemap discovery with reachable internal links and can suggest the page to link from.",
    },
  ],
  faqEyebrow: "FAQ",
  faqTitle: "Internal link audit FAQ",
  faqs: [
    {
      question: "What is an internal link audit?",
      answer:
        "It crawls the connections between pages on one site and reports unreachable pages, broken targets, depth, anchor patterns, and where internal authority is concentrated.",
    },
    {
      question: "How is this different from an internal link checker?",
      answer:
        "A checker usually verifies whether links work. An audit also evaluates the structure those links create, including orphans, weakly connected clusters, and repair opportunities.",
    },
    {
      question: "Do I need Search Console or site verification?",
      answer:
        "No. The production P0-2 design reads public pages and does not require OAuth, a verification file, or ownership. This milestone does not make any website request.",
    },
    {
      question: "Does this find orphan pages?",
      answer:
        "The production design compares sitemap URLs with URLs reached through internal HTML links. A URL found only in the sitemap becomes a candidate orphan with its evidence limits attached.",
    },
    {
      question: "How many pages will it crawl for free?",
      answer:
        "The public audit collects up to 25 pages with depth 4 and a 40-second budget. It returns a partial-coverage notice when a safety boundary stops it early.",
    },
    {
      question: "How often should I audit internal links?",
      answer:
        "Quarterly is enough for many sites, plus immediately after migrations, URL restructures, template changes, or large content releases.",
    },
    {
      question: "Which broken links should I fix first?",
      answer:
        "Start with broken links on strongly connected, frequently reached pages. They affect more journeys and waste a more valuable internal path than the same error on an isolated page.",
    },
    {
      question: "Should I fix every orphan page?",
      answer:
        "No. First decide whether the page should exist. Consolidating or removing thin, duplicated, or outdated pages can be better than adding links to them.",
    },
    {
      question: "Will this work on a JavaScript-rendered site?",
      answer:
        "Partially in the planned first crawler. Links injected by long-running client JavaScript may be missed, so unexpected orphan findings must be cross-checked.",
    },
    {
      question: "Can I export the results?",
      answer:
        "Not in this public preview. It shows a transient visual report only and does not claim to create or store a CSV export.",
    },
  ],
  relatedEyebrow: "Continue exploring",
  relatedTitle: "Related tool",
  relatedAudit: "Website Health Map",
  relatedAuditBody:
    "Check one page’s crawlability, technical signals, on-page basics, and evidence limits.",
  relatedTools: "See every free tool",
  readingEyebrow: "Editorial roadmap",
  readingTitle: "Related reading being prepared",
  readingItems: [
    "PageRank sculpting: what it is and whether it still works",
    "How to fix orphan pages without a desktop crawler",
    "Site architecture for SEO: depth, clusters, and crawl budget",
  ],
  ctaEyebrow: "Next step",
  ctaTitle: "Turn reviewed link fixes into a site-structure plan",
  ctaBody:
    "Internal links are one step in the larger GenGrowth workflow. Continue in the full product when you are ready to review them alongside the rest of your growth plan.",
  ctaButton: "Continue to GenGrowth",
};

const ZH: InternalLinkAuditContent = {
  metaTitle: "免费内链审计：发现断链、孤岛页面与结构缺口",
  metaDescription:
    "通过一次内链审计发现断链、孤岛页面、深层页面和被站内结构饿死的重要内容；免费体验，无需登录或安装软件。",
  schemaDescription:
    "GenGrowth 内链审计会在明确预算内抓取同源静态 HTML、遵守 robots.txt，并且不保存提交的 URL 或报告。",
  schemaFeatures: [
    "真实的受限同源静态 HTML 抓取",
    "每次最多采集 25 页、最深 4 层",
    "候选孤岛、深层页面与未验证目标",
    "感知 robots.txt 与 Sitemap 的采集",
    "不连接 Search Console、不持久化保存数据",
  ],
  breadcrumb: "内链审计",
  eyebrow: "免费内链审计 · 受限公开抓取",
  title: "内链审计",
  subtitle:
    "一次看清站内页面之间的关系：哪些链接已经失效、哪些页面没有任何入口，以及哪些重要内容没有获得你的网站本来可以传递的权重。",
  primaryCta: "免费运行内链审计",
  trustLine: "免费 · 无需登录 · 无需安装 · 适用于公开网站",
  demoBanner:
    "本公开工具会在明确预算内临时抓取同源静态 HTML、遵守 robots.txt，不保存报告，也不会修改你的网站。",
  formLabel: "网站 URL",
  placeholder: "yourdomain.com",
  startCrawl: "开始内链审计",
  running: "正在构建受限关系图…",
  inputHelp:
    "工具仅读取公开 HTML，不连接 Search Console、不要求所有权验证，也不会修改网站。",
  mockScope:
    "每次请求最多采集 25 页、深度 4 层、抓取预算 40 秒。如遇安全边界提前结束，结果会明确标注覆盖不完整。",
  invalidUrl: "请输入公开域名或 HTTP(S) URL。",
  stages: ["读取首页与 Sitemap 入口", "建立页面之间的 HTML 链接关系", "排序结构缺口"],
  demoResultLabel: "受限抓取结果",
  demoResultBody:
    "下方全部指标来自本次为你输入 URL 采集的静态 HTML 页面。",
  result: {
    summaryEyebrow: "5 秒结论",
    summaryTitle: "先处理两个有明确来源页的孤岛，再修复更深层的簇内缺口",
    summaryBody:
      "样本里共有 4 个孤岛，但其中 2 个已经找到自然的来源页面和正文插入位置；随后应修复高权重指南中指向失败目标的链接。",
    mappedPages: "已映射页面",
    internalLinks: "HTML 内链",
    orphanPages: "孤岛页面",
    priorityFixes: "可审核修复项",
    graphTitle: "站点关系图",
    graphBody:
      "当前视图展示本次受限抓取采集到的页面。连线表示已观测到的同源 HTML 内链。选择节点即可查看记录到的结构证据和解释边界。",
    filterAll: "全部节点",
    filterPillars: "Pillar",
    filterOrphans: "孤岛",
    filterDeep: "深层页面",
    filterBroken: "断链目标",
    priorityTitle: "最高收益修复",
    priorityBody: "按来源页强度、结构缺口和编辑清晰度排序。",
    detailEyebrow: "当前页面",
    evidence: "观测证据",
    limitation: "证据边界",
    suggestedSource: "建议来源页",
    anchorText: "建议锚文本",
    verify: "如何复验",
    selectPrompt: "请选择一个节点或问题，查看对应证据。",
    sampleLabel: "抓取范围",
    fixedData:
      "真实受限抓取 · 静态 HTML · 同源 · 不保存报告",
    fourPartTitle: "从发现问题到可审核的修复动作",
    observation: "Observation",
    observationBody:
      "结果会列出候选页面的观测入链、出链和 Sitemap 归属。",
    diagnosis: "Diagnosis",
    diagnosisBody:
      "Sitemap 可发现但未见 HTML 入链的页面会被标为候选；只由 JavaScript 生成的链接不在当前抓取范围内。",
    recommendation: "Recommendation",
    recommendationBody:
      "从 /wifi-feeders 与 /best-smart-feeders 的首次设置段落增加上下文链接。",
    artifact: "Artifact",
    artifactBody:
      "形成一条可审核的补链任务：来源 URL、目标 URL、插入语境、锚文本建议、证据边界与复验条件。",
    exportPreview: "真实抓取版本再提供 CSV 导出",
  },
  howEyebrow: "使用流程",
  howTitle: "从一个域名到修复清单，只需四步",
  howIntro:
    "界面已经按照正式爬虫未来必须返回的证据设计；本阶段只模拟这些步骤，不发出网站请求。",
  howSteps: [
    {
      title: "1. 输入域名",
      body: "无需验证、登录或安装插件。正式爬虫可以读取任何公开可访问的网站。",
    },
    {
      title: "2. 爬取并建立关系图",
      body: "计划中的爬虫从首页与 Sitemap 出发，跟随同站 HTML 链接，并记录来源、目标、锚文本和链接位置。",
    },
    {
      title: "3. 查看结构暴露的问题",
      body: "把孤岛、断链、低入链页面、点击深度和权重集中位置转换成带证据的发现。",
    },
    {
      title: "4. 将审核后的修复推进计划",
      body: "请先复核证据再执行调整。公开工具不会创建项目，也不会修改你的网站。",
    },
  ],
  findsEyebrow: "能发现什么",
  findsTitle: "内链审计不只是检查 404",
  findsIntro: "它检查的是页面之间的连接，而不是单独某一个 URL 的内容。",
  findings: [
    {
      title: "断开的站内链接",
      body: "同时显示来源页、失败目标和锚文本，让你直接修复链接，而不是再去寻找它出现在哪里。",
    },
    {
      title: "没有任何页面指向的孤岛",
      body: "对比 Sitemap URL 与通过站内 HTML 链接到达的页面；二者差集是候选孤岛，同时显示 Sitemap 与渲染边界。",
    },
    {
      title: "按网站区块聚类孤岛",
      body: "自动生成的标签页与失去入口的产品页不是同一种问题。按 URL 模式分组，才能区分结构风险和预期噪声。",
    },
    {
      title: "只有一两条入链的页面",
      body: "它们不算孤岛，却经常只依赖导航或页尾，没有来自相关内容的上下文支持。",
    },
    {
      title: "站内权重实际集中在哪里",
      body: "入链关系能说明网站结构正在重点推动哪些页面；这是结构代理指标，不声称计算 Google PageRank。",
    },
    {
      title: "锚文本分布",
      body: "聚合锚文本可以发现“点击这里”这类无语义链接，以及大量重复的模板化用词。",
    },
    {
      title: "从首页出发的点击深度",
      body: "最短观测路径能够标出距离首页超过三次点击的重要页面。",
    },
    {
      title: "已经存在的补链机会",
      body: "针对孤岛或低入链目标，建议已经包含自然编辑语境的相关来源页。",
    },
    {
      title: "完整结构的可视化地图",
      body: "相比一张扁平 URL 表，关系图更容易暴露主题簇、孤立小岛和关键瓶颈。",
    },
  ],
  methodEyebrow: "方法透明",
  methodTitle: "我们如何判断一个结构问题",
  methods: [
    {
      title: "什么算孤岛",
      body: "Sitemap 中存在、但从站内 HTML 链接遍历从未到达的 URL。如果 Sitemap 缺失或过期，该限制必须随结论一起展示。",
    },
    {
      title: "什么算低入链",
      body: "只有一至两条已观测入链，并把正文上下文链接与全站导航、页尾链接分开统计。",
    },
    {
      title: "抓取从哪里开始、在哪里停止",
      body: "正式设计从首页与 Sitemap 出发，限制在已验证同源，尊重 robots.txt，并在明确的页面数、时间或安全边界停止。",
    },
  ],
  limitsEyebrow: "诚实边界",
  limitsTitle: "这项审计不会告诉你的事",
  limitations: [
    {
      title: "只在 JavaScript 运行后出现的链接",
      body: "读取原始 HTML 的爬虫可能漏掉客户端渲染链接。对于重度渲染网站，异常孤岛应被视为待验证假设，而不是最终判决。",
    },
    {
      title: "一个页面是否值得继续存在",
      body: "零入链不等于必须补链接。内容薄弱、重复或过期的页面，合并或删除可能比补链更合理。",
    },
    {
      title: "可以访问但指向错误语境的链接",
      body: "爬虫可以证明目标能够响应，却无法可靠判断它是否是最合适的编辑目标；错链语义判断留到后续。",
    },
  ],
  audienceEyebrow: "适用对象",
  audienceTitle: "当网站结构已经无法全部记在一个人脑中",
  audienceBody:
    "网站达到几十个页面后就开始有价值，尤其适合迁移、URL 重构、大批量内容发布或模板自动生成页面之后。",
  comparisons: [
    {
      title: "与 Screaming Frog 的区别",
      body: "Screaming Frog 更适合深度技术审计和大型抓取；这个浏览器工具的目标是减少安装和解读门槛，直接交付按优先级排序的修复简报。",
    },
    {
      title: "与 Search Console 内链报告的区别",
      body: "Search Console 主要报告 Google 已知页面；独立爬虫可以对比 Sitemap 与实际可达链接，并进一步建议应该从哪个页面补链。",
    },
  ],
  faqEyebrow: "常见问题",
  faqTitle: "内链审计 FAQ",
  faqs: [
    {
      question: "什么是内链审计？",
      answer:
        "它抓取同一网站页面之间的连接，报告无法到达的页面、断链、点击深度、锚文本模式和站内权重集中位置。",
    },
    {
      question: "它和普通内链检查器有什么不同？",
      answer:
        "检查器通常只判断链接是否可用；审计还会评估这些链接形成的结构，包括孤岛、连接薄弱的主题簇和补链机会。",
    },
    {
      question: "需要连接 Search Console 或验证网站吗？",
      answer:
        "不需要。工具读取公开页面，不需要 OAuth、验证文件或所有权，也不会修改网站。",
    },
    {
      question: "它能找到孤岛页面吗？",
      answer:
        "正式设计会对比 Sitemap URL 与通过站内 HTML 链接到达的 URL；只存在于 Sitemap 的页面会成为候选孤岛，并携带证据边界。",
    },
    {
      question: "免费会抓取多少页面？",
      answer:
        "公开审计每次最多采集 25 页、最深 4 层、抓取预算 40 秒。如安全边界提前停止，结果会标注覆盖不完整。",
    },
    {
      question: "多久应该做一次内链审计？",
      answer:
        "多数网站每季度一次即可；网站迁移、URL 重构、模板变更或大批量发布内容后应立即再检查一次。",
    },
    {
      question: "应该先修哪些断链？",
      answer:
        "优先修复出现在强连接、高频访问页面上的断链；同样的错误出现在孤立页面时，影响的用户路径和站内关系更少。",
    },
    {
      question: "每个孤岛页面都应该补链接吗？",
      answer:
        "不应该。先判断页面是否值得存在；薄弱、重复或过时的内容，合并或删除通常比补链更合理。",
    },
    {
      question: "JavaScript 渲染的网站可以使用吗？",
      answer:
        "计划中的第一版只能部分支持。长时间运行客户端 JavaScript 后才注入的链接可能漏抓，因此异常孤岛需要交叉验证。",
    },
    {
      question: "可以导出结果吗？",
      answer:
        "当前公开预览不提供导出。它只展示瞬时可视化报告，也不会声称已经创建或保存 CSV。",
    },
  ],
  relatedEyebrow: "继续探索",
  relatedTitle: "相关工具",
  relatedAudit: "网站健康地图",
  relatedAuditBody: "检测一个页面的抓取、技术、页面基础和证据边界。",
  relatedTools: "查看全部免费工具",
  readingEyebrow: "内容规划",
  readingTitle: "正在准备的相关文章",
  readingItems: [
    "PageRank Sculpting：它是什么，今天是否仍然有效",
    "不安装桌面爬虫，如何修复孤岛页面",
    "SEO 网站架构：点击深度、主题簇与抓取预算",
  ],
  ctaEyebrow: "下一步",
  ctaTitle: "把审核后的补链动作放进网站结构计划",
  ctaBody:
    "内链只是 GenGrowth 完整工作流中的一个步骤。当你准备好把它与其他增长动作一起审核时，可以继续进入完整产品。",
  ctaButton: "继续使用 GenGrowth",
};

export function getInternalLinkAuditContent(
  locale: string,
): InternalLinkAuditContent {
  return locale === "zh" ? ZH : EN;
}
