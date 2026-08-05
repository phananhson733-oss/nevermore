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
  readonly fitSignals: readonly ContentItem[];
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
  readonly readingCta: string;
  readonly ctaEyebrow: string;
  readonly ctaTitle: string;
  readonly ctaBody: string;
  readonly ctaButton: string;
}

const EN: InternalLinkAuditContent = {
  metaTitle: "Free Internal Link Audit: Find Orphan and Weak Pages",
  metaDescription:
    "Audit your internal link structure in one live online crawl. Find orphan candidates, weakly linked pages, deep pages, and unresolved targets. Free, no sign-up.",
  schemaDescription:
    "A live public internal link audit that crawls static same-origin HTML, respects robots.txt, and may temporarily share cached public crawl facts to avoid repeatedly hitting the same site.",
  schemaFeatures: [
    "Real same-origin static-HTML crawl",
    "No account and no sign-up; a generous hourly ceiling keeps the crawler from overloading the sites it audits",
    "Observed orphan candidates, deep pages, and unresolved targets",
    "Robots.txt and sitemap-aware collection",
    "No Search Console connection, submitter identity, or stored page body",
  ],
  breadcrumb: "Internal Link Audit",
  eyebrow: "Free internal link audit · live public crawl",
  title: "Internal Link Audit",
  subtitle:
    "One live crawl maps observed same-origin HTML links, pages with little observed support, sitemap-only orphan candidates, and targets that need a follow-up check.",
  primaryCta: "Run my internal link audit free",
  trustLine: "Free · No sign-up · No software to install · Any public website",
  demoBanner:
    "This public tool crawls static same-origin HTML, respects robots.txt, and never changes your website. Public crawl facts may be temporarily shared from a server-side cache; no submitter identity or page body is stored.",
  formLabel: "Website URL",
  placeholder: "yourdomain.com",
  startCrawl: "Run internal link audit",
  running: "Building your live page hierarchy…",
  inputHelp:
    "The tool reads public HTML only — no Search Console, ownership verification, account, or site changes.",
  mockScope:
    "No account and no sign-up. One run reaches roughly 950 pages: the crawler waits at least 250 ms between requests so it does not overload the site being audited, and stops after four minutes. There is an hourly ceiling per network and per audited site, set well above normal use, because each run fetches hundreds of pages from someone else's server.",
  invalidUrl: "Enter a public domain or HTTP(S) URL.",
  stages: [
    "Reading homepage and sitemap entry points",
    "Mapping page-to-page HTML links",
    "Prioritizing structural gaps",
  ],
  demoResultLabel: "This crawl's result",
  demoResultBody:
    "Every metric below is generated from the static-HTML pages collected for the URL you entered in this request.",
  result: {
    summaryEyebrow: "Five-second answer",
    summaryTitle: "Review observed structural findings before changing your site",
    summaryBody:
      "Use the observed evidence and its limitations to decide what to verify. This online audit never makes automatic changes to your site.",
    mappedPages: "Pages mapped",
    internalLinks: "HTML internal links",
    orphanPages: "Orphan pages",
    priorityFixes: "Ready-to-review fixes",
    graphTitle: "Site page hierarchy",
    graphBody:
      "Indentation follows one shortest observed HTML-link path from the homepage. Sitemap discovery does not shorten click depth; cross-links remain in the inbound and outbound counts.",
    filterAll: "All nodes",
    filterPillars: "Pillars",
    filterOrphans: "Orphans",
    filterDeep: "Deep pages",
    filterBroken: "Unresolved targets",
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
      "Real online crawl · static HTML · same origin · temporary shared crawl cache",
    fourPartTitle: "From finding to a fix you can review",
    observation: "Observation",
    observationBody:
      "The report records observed inbound and outbound HTML links together with sitemap membership when available.",
    diagnosis: "Diagnosis",
    diagnosisBody:
      "A sitemap-only page is a candidate, not a definitive orphan. JavaScript-only links and uncrawled pages are not evaluated.",
    recommendation: "Recommendation",
    recommendationBody:
      "Review the observed source URL and anchor context, then choose an editorial change only if it fits the page and user journey.",
    artifact: "Artifact",
    artifactBody:
      "A review-ready link brief with source URL, target URL, insertion context, anchor suggestion, evidence limit, and a re-crawl check.",
    exportPreview: "This online tool provides a visual report; CSV export is not included.",
  },
  howEyebrow: "How it works",
  howTitle: "Four steps from a domain to a repair list",
  howIntro:
    "Enter a public website and receive a report based on observed static same-origin HTML.",
  howSteps: [
    {
      title: "1. Enter your domain",
      body: "No verification, login, or plugin. Submit any publicly reachable HTTP(S) website.",
    },
    {
      title: "2. We crawl and build the tree",
      body: "The crawler starts from allowed site entry points, respects robots.txt, follows same-origin HTML links, and records observed structural evidence.",
    },
    {
      title: "3. Review what the structure exposes",
      body: "Candidate orphans, pages with low observed inbound support, homepage click depth, and unresolved targets are shown with their evidence limits.",
    },
    {
      title: "4. Carry reviewed fixes into your plan",
      body: "Review the evidence before making changes. The public tool does not create a project or alter your website.",
    },
  ],
  findsEyebrow: "What it finds",
  findsTitle: "A live internal link audit shows structural evidence",
  findsIntro:
    "It inspects the connections between pages, not just the contents of one URL.",
  findings: [
    {
      title: "Unresolved internal targets",
      body: "See a source page and observed anchor when a target was not collected. It is a follow-up check, not a claim that the target is broken.",
    },
    {
      title: "Orphan pages — the ones nothing links to",
      body: "Compare sitemap URLs with pages reached through internal HTML links. The gap is a candidate orphan, with the sitemap and rendering limits shown.",
    },
    {
      title: "Observed sitemap coverage",
      body: "The report shows whether a sitemap was collected and how many sitemap URLs were observed, so orphan candidates have visible scope limits.",
    },
    {
      title: "Pages with one or fewer observed inbound links",
      body: "These pages are not necessarily orphans, but they have one or fewer observed inbound HTML links in this online run.",
    },
    {
      title: "Observed inbound relationships",
      body: "Observed inbound HTML links make it easier to review which collected pages have structural support. This is not a PageRank calculation.",
    },
    {
      title: "Source and anchor evidence",
      body: "For an observed relationship, the report can show the source page and recorded anchor text to support a manual review.",
    },
    {
      title: "Observed homepage click depth",
      body: "The report computes the shortest observed static-HTML link path from the homepage. Indexable pages at four or more clicks are highlighted; sitemap seeds improve coverage but never shorten this path.",
    },
    {
      title: "Review-ready findings",
      body: "Each finding includes observed evidence and a limitation so you can decide what to verify before changing your site.",
    },
    {
      title: "A scannable page hierarchy",
      body: "One shortest observed homepage path organizes each reachable page; unreachable groups and additional inbound links remain visible as separate evidence.",
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
      body: "One or fewer observed inbound HTML links in this online run. Navigation, JavaScript-rendered links, and uncollected pages can change this count.",
    },
    {
      title: "Where a crawl starts and stops",
      body: "The crawler stays on the validated origin, respects robots.txt, uses allowed site entry points, and may stop at an explicit time, request, response-size, redirect, concurrency, or host-pacing boundary.",
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
  fitSignals: [
    {
      title: "Compared with Screaming Frog",
      body: "Screaming Frog is more complete for deep technical work and large crawls. This browser-based tool aims to remove installation and interpretation overhead by returning a prioritized repair brief.",
    },
    {
      title: "Compared with Search Console’s internal-links report",
      body: "Search Console reports pages Google already knows. This crawler independently compares observed sitemap discovery with collected internal HTML relationships and their limits.",
    },
  ],
  faqEyebrow: "FAQ",
  faqTitle: "Internal link audit FAQ",
  faqs: [
    {
      question: "What is an internal link audit?",
      answer:
        "It crawls static same-origin HTML connections and reports candidate orphans, low observed inbound support, homepage click depth, and unresolved targets with clear limits.",
    },
    {
      question: "How is this different from an internal link checker?",
      answer:
        "A checker usually verifies whether links work. An audit also evaluates the structure those links create, including orphans, weakly connected clusters, and repair opportunities.",
    },
    {
      question: "Do I need Search Console or site verification?",
      answer:
        "No. The online audit reads public pages and does not require OAuth, a verification file, or ownership. It starts only after you submit a URL; public crawl facts may be served from a temporary shared cache to avoid repeated traffic to the same site.",
    },
    {
      question: "Does this find orphan pages?",
      answer:
        "The audit compares observed sitemap URLs with URLs reached through collected internal HTML links. A sitemap-only URL becomes a candidate orphan with evidence limits attached.",
    },
    {
      question: "How much of a site will the free audit crawl?",
      answer:
        "No account and no sign-up. One run reaches roughly 950 pages — four minutes at the 250 ms pace the crawler holds so it does not overload the site being audited — and a larger site comes back marked partial coverage, with findings that depend on having seen the whole site reported as unchecked rather than as conclusions. An hourly ceiling per network and per audited site sits well above normal use.",
    },
    {
      question: "How often should I audit internal links?",
      answer:
        "Quarterly is enough for many sites, plus immediately after migrations, URL restructures, template changes, or large content releases.",
    },
    {
      question: "Which findings should I review first?",
      answer:
        "Start with candidate orphans and low-inbound pages that matter to your site, then verify unresolved targets from important source pages. The report does not automatically confirm broken links.",
    },
    {
      question: "Should I fix every orphan page?",
      answer:
        "No. First decide whether the page should exist. Consolidating or removing thin, duplicated, or outdated pages can be better than adding links to them.",
    },
    {
      question: "Will this work on a JavaScript-rendered site?",
      answer:
        "Partially. The current crawler reads static HTML, so links injected by client JavaScript may be missed. Cross-check unexpected orphan candidates.",
    },
    {
      question: "Can I export the results?",
      answer:
        "Not in this online tool. It shows a visual report only and does not create a CSV export.",
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
  readingCta: "Read the evidence-first experiment method",
  ctaEyebrow: "Next step",
  ctaTitle: "Turn reviewed link fixes into a site-structure plan",
  ctaBody:
    "Internal links are one step in the larger GenGrowth workflow. Continue in the full product when you are ready to review them alongside the rest of your growth plan.",
  ctaButton: "Continue to GenGrowth",
};

const ZH: InternalLinkAuditContent = {
  metaTitle: "免费内链审计：发现候选孤岛、低入链页面与结构缺口",
  metaDescription:
    "通过一次实时在线内链审计发现候选孤岛、低入链页面、首页点击深度和待验证目标；免费使用，无需登录或安装软件。",
  schemaDescription:
    "GenGrowth 内链审计会在线抓取同源静态 HTML、遵守 robots.txt，并可能临时共享已缓存的公开抓取事实，以避免短时间内重复访问同一站点。",
  schemaFeatures: [
    "真实的同源静态 HTML 抓取",
    "无需账号、无需注册；设有宽松的每小时上限，以免爬虫给被审计的站点造成压力",
    "候选孤岛、深层页面与未验证目标",
    "感知 robots.txt 与 Sitemap 的采集",
    "不连接 Search Console、不保存提交者身份或页面正文",
  ],
  breadcrumb: "内链审计",
  eyebrow: "免费内链审计 · 实时公开抓取",
  title: "内链审计",
  // The English subtitle hedges all three of these; this one used to assert
  // them. The tool never calls a link broken (an uncollected target may simply
  // be outside the crawl), an orphan is a candidate rather than a verdict, and
  // nothing here computes link equity at all.
  subtitle:
    "一次实时抓取，梳理站内页面之间的实际链接关系：观察到的同源 HTML 链接、入链支持较少的页面、仅出现在 sitemap 中的候选孤岛，以及需要你进一步核实的目标。",
  primaryCta: "免费运行内链审计",
  trustLine: "免费 · 无需登录 · 无需安装 · 适用于公开网站",
  demoBanner:
    "本免费公开工具会抓取同源静态 HTML、遵守 robots.txt，也不会修改你的网站。公开抓取事实可能由服务端临时缓存并共享；不保存提交者身份或页面正文。",
  formLabel: "网站 URL",
  placeholder: "yourdomain.com",
  startCrawl: "开始内链审计",
  running: "正在构建实时页面层级…",
  inputHelp:
    "工具仅读取公开 HTML，不连接 Search Console、不要求所有权验证，也不会修改网站。",
  mockScope:
    "无需账号、无需注册。单次运行约覆盖 950 个页面：爬虫在两次请求之间至少等待 250 毫秒，以免给被审计的站点造成压力，并在四分钟处停止。按网络地址和按被审计站点各设有每小时上限，阈值远高于正常使用——因为每次运行都会从别人的服务器上取走数百个页面。",
  invalidUrl: "请输入公开域名或 HTTP(S) URL。",
  stages: ["读取首页与 Sitemap 入口", "建立页面之间的 HTML 链接关系", "排序结构缺口"],
  demoResultLabel: "实时抓取结果",
  demoResultBody:
    "下方全部指标来自本次为你输入 URL 采集的静态 HTML 页面。",
  result: {
    summaryEyebrow: "5 秒结论",
    summaryTitle: "改动网站前，先复核有明确边界的结构发现",
    summaryBody:
      "请根据观测证据及其限制决定需要复核什么。此在线审计不会自动修改你的网站。",
    mappedPages: "已映射页面",
    internalLinks: "HTML 内链",
    orphanPages: "孤岛页面",
    priorityFixes: "可审核修复项",
    graphTitle: "网站页面层级树",
    graphBody:
      "缩进表示从首页出发的一条最短已观测 HTML 链接路径；Sitemap 发现不会缩短点击深度，交叉内链仍保留在入链与出链计数中。",
    filterAll: "全部节点",
    filterPillars: "Pillar",
    filterOrphans: "孤岛",
    filterDeep: "深层页面",
    filterBroken: "未验证目标",
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
      "真实在线抓取 · 静态 HTML · 同源 · 临时共享抓取缓存",
    fourPartTitle: "从发现问题到可审核的修复动作",
    observation: "Observation",
    observationBody:
      "结果会列出候选页面的观测入链、出链和 Sitemap 归属。",
    diagnosis: "Diagnosis",
    diagnosisBody:
      "Sitemap 可发现但未见 HTML 入链的页面会被标为候选；只由 JavaScript 生成的链接不在当前抓取范围内。",
    recommendation: "Recommendation",
    recommendationBody:
      "查看已观测到的来源 URL 与锚文本语境，仅在符合页面与用户旅程时决定是否进行编辑。",
    artifact: "Artifact",
    artifactBody:
      "形成一条可审核的补链任务：来源 URL、目标 URL、插入语境、锚文本建议、证据边界与复验条件。",
    exportPreview: "此在线工具仅提供临时可视化报告，暂不包含 CSV 导出。",
  },
  howEyebrow: "使用流程",
  howTitle: "从一个域名到修复清单，只需四步",
  howIntro:
    "输入公开网站后，工具会针对本次请求临时采集同源静态 HTML，并返回有明确范围的结构报告。",
  howSteps: [
    {
      title: "1. 输入域名",
      body: "无需验证、登录或安装插件。可以提交任何公开可访问的 HTTP(S) 网站。",
    },
    {
      title: "2. 爬取并建立树状结构",
      body: "爬虫从允许的网站入口开始，尊重 robots.txt，跟随同源 HTML 链接，并记录本次在线运行中观测到的结构证据。",
    },
    {
      title: "3. 查看结构暴露的问题",
      body: "把候选孤岛、低观测入链页面、首页点击深度和未验证目标转换成带证据边界的发现。",
    },
    {
      title: "4. 将审核后的修复推进计划",
      body: "请先复核证据再执行调整。公开工具不会创建项目，也不会修改你的网站。",
    },
  ],
  findsEyebrow: "能发现什么",
  findsTitle: "实时内链审计呈现可复核的结构证据",
  findsIntro: "它检查的是页面之间的连接，而不是单独某一个 URL 的内容。",
  findings: [
    {
      title: "未验证的站内目标",
      body: "当某个目标未被本次抓取采集到时，展示来源页与观测锚文本。它需要复核，不等同于断链。",
    },
    {
      title: "没有任何页面指向的孤岛",
      body: "对比 Sitemap URL 与通过站内 HTML 链接到达的页面；二者差集是候选孤岛，同时显示 Sitemap 与渲染边界。",
    },
    {
      title: "已观测的 Sitemap 覆盖",
      body: "报告会显示是否成功采集 Sitemap 及已观测 URL 数量，让候选孤岛的结论范围清晰可见。",
    },
    {
      title: "只有一条或没有观测入链的页面",
      body: "它们不一定是孤岛，但在本次在线运行中只有一条或没有观测到的 HTML 入链。",
    },
    {
      title: "已观测的入链关系",
      body: "观测到的 HTML 入链有助于复核哪些已采集页面获得结构支持；这不是 Google PageRank 计算。",
    },
    {
      title: "来源页与锚文本证据",
      body: "对于已观测关系，报告可展示来源页及记录到的锚文本，便于人工复核。",
    },
    {
      title: "观测到的首页点击深度",
      body: "报告会计算从首页出发的最短已观测静态 HTML 链接路径；可索引页面需要至少 4 次点击时会被标出，Sitemap 种子只补充覆盖范围，不会缩短这条路径。",
    },
    {
      title: "可复核的问题清单",
      body: "每条发现都附有观测证据和限制条件，供你决定在改动网站前需要复核什么。",
    },
    {
      title: "清晰可读的页面层级",
      body: "每个可达页面按一条最短首页路径组织；不可达分组和其他已观测入链仍作为独立证据保留。",
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
      body: "在本次在线运行中只有一条或没有观测到的 HTML 入链。导航、JavaScript 生成链接和未采集页面都可能改变这个计数。",
    },
    {
      title: "抓取从哪里开始、在哪里停止",
      body: "爬虫限制在已验证同源、尊重 robots.txt、使用允许的网站入口，并可能在时间、请求量、响应体积、重定向、并发或主机访问节奏等技术边界停止。",
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
  fitSignals: [
    {
      title: "与 Screaming Frog 的区别",
      body: "Screaming Frog 更适合深度技术审计和大型抓取；这个浏览器工具的目标是减少安装和解读门槛，直接交付按优先级排序的修复简报。",
    },
    {
      title: "与 Search Console 内链报告的区别",
      body: "Search Console 主要报告 Google 已知页面；本工具独立对比已观测 Sitemap 发现与已采集 HTML 内链关系，并展示相应限制。",
    },
  ],
  faqEyebrow: "常见问题",
  faqTitle: "内链审计 FAQ",
  faqs: [
    {
      question: "什么是内链审计？",
      answer:
        "它抓取同一网站的静态同源 HTML 连接，报告候选孤岛、低观测入链、首页点击深度和未验证目标，并清楚说明边界。",
    },
    {
      question: "它和普通内链检查器有什么不同？",
      answer:
        "检查器通常只判断链接是否可用；本工具聚焦这些链接形成的已观测结构，包括候选孤岛、低入链页面和待复核目标。",
    },
    {
      question: "需要连接 Search Console 或验证网站吗？",
      answer:
        "不需要。工具读取公开页面，不需要 OAuth、验证文件或所有权，也不会修改网站。",
    },
    {
      question: "它能找到孤岛页面吗？",
      answer:
        "工具会对比已观测 Sitemap URL 与通过已采集站内 HTML 链接到达的 URL；只存在于 Sitemap 的页面会成为候选孤岛，并携带证据边界。",
    },
    {
      question: "免费审计会覆盖多少页面？",
      answer:
        "无需账号、无需注册。单次运行约覆盖 950 个页面——四分钟，按 250 毫秒的节奏，以免给被审计的站点造成压力；规模更大的站点会返回「部分覆盖」标记，那些依赖「看过整站」才能成立的结论会被标为未验证，而不是当成结论输出。按网络地址和按被审计站点各设有每小时上限，阈值远高于正常使用。",
    },
    {
      question: "多久应该做一次内链审计？",
      answer:
        "多数网站每季度一次即可；网站迁移、URL 重构、模板变更或大批量发布内容后应立即再检查一次。",
    },
    {
      question: "应该先复核哪些发现？",
      answer:
        "先看对业务重要的候选孤岛和低入链页面，再从重要来源页开始核实未验证目标。该报告不会自动确认断链。",
    },
    {
      question: "每个孤岛页面都应该补链接吗？",
      answer:
        "不应该。先判断页面是否值得存在；薄弱、重复或过时的内容，合并或删除通常比补链更合理。",
    },
    {
      question: "JavaScript 渲染的网站可以使用吗？",
      answer:
        "只能部分支持。当前爬虫读取静态 HTML，客户端 JavaScript 注入的链接可能漏抓，因此异常候选孤岛需要交叉验证。",
    },
    {
      question: "可以导出结果吗？",
      answer:
        "当前在线工具不提供导出。它只展示瞬时可视化报告，也不会声称已经创建或保存 CSV。",
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
  readingCta: "阅读证据优先的实验方法",
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
