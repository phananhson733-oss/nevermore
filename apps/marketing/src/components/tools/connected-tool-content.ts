// @input  -- locale and tool identifier
// @output -- truthful public copy for tools that require a connected data source
// @pos    -- content boundary between marketing acquisition and the authenticated product

export type ConnectedTool =
  | "seo-quick-wins"
  | "traffic-drop-diagnosis"
  | "hidden-keywords";

export interface ConnectedToolContent {
  readonly path: `/tools/${ConnectedTool}`;
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly sourceLabel: string;
  readonly sourceDetail: string;
  readonly cta: string;
  readonly trust: string;
  readonly workflowTitle: string;
  /**
   * The how-it-works steps, each with its own heading.
   *
   * Named rather than a bare sentence so the step can be a real heading on the
   * page and can carry a `HowTo` step name in structured data. Both readings
   * want the same short label, and deriving one from a paragraph guesses.
   */
  readonly steps: readonly {
    readonly name: string;
    readonly text: string;
    /** Dropped when this deployment cannot produce Title/Meta drafts. */
    readonly requiresDrafts?: boolean;
  }[];
  readonly outputTitle: string;
  readonly outputs: readonly {
    readonly label: string;
    readonly body: string;
  }[];
  readonly faq: readonly {
    readonly question: string;
    readonly answer: string;
    /** Dropped when this deployment cannot produce Title/Meta drafts. */
    readonly requiresDrafts?: boolean;
  }[];
}

const EN: Record<ConnectedTool, ConnectedToolContent> = {
  "seo-quick-wins": {
    path: "/tools/seo-quick-wins",
    eyebrow: "Search performance evidence",
    title: "High impressions, low clicks",
    description:
      "Google already shows you for these search queries thousands of times, and almost nobody clicks. We measure the gap against your own site's click-through curve rather than an industry table. The engine reads one dimension — queries — so every row is a search term, not a page.",
    sourceLabel: "Requires a Google Search Console connection",
    sourceDetail:
      "GenGrowth requests read-only Search Console access. It cannot publish pages, change rankings, or modify your Google account, and it stores nothing.",
    cta: "Connect Search Console",
    trust:
      "No demo data, nothing stored. Every number is computed from the property you choose.",
    workflowTitle: "How to find high impressions with low clicks",
    steps: [
      {
        name: "Connect Search Console",
        text: "Read-only, one click, revoke it whenever you like from your Google account.",
      },
      {
        name: "We build your site's own CTR curve first",
        text: "What counts as a normal click-through rate on your site, at each position band, computed from your own non-brand queries over the last 28 complete days.",
      },
      {
        name: "Review the gaps, largest first",
        text: "Every search query whose click-through rate falls below what your own site earns at that position, ranked by the size of the shortfall. Sort any column, or take the whole table away as CSV.",
      },
      {
        name: "Where we can, we show you a query's page next to one that does better",
        text: "Drawn from your own site and named, so you can open it and judge the comparison yourself. No comparable page, no draft.",
        requiresDrafts: true,
      },
    ],
    outputTitle: "What you get, and what it stops short of",
    outputs: [
      {
        label: "Observation",
        body: "Impressions, clicks and average position for every search query with enough volume to measure. Queries, not pages: that is the only dimension this report reads.",
      },
      {
        label: "Your own baseline",
        body: "What a normal click-through rate looks like on your site at each position band, with the query being measured excluded from its own baseline.",
      },
      {
        label: "The gap",
        body: "Expected clicks minus observed clicks. A measured difference between two observed numbers, not a forecast of what a change would recover.",
      },
      {
        label: "What we cannot explain",
        body: "We do not detect AI Overviews or other SERP features, and those are a leading cause of these gaps. The tool names that limit on every run.",
      },
    ],
    faq: [
      {
        question: "What does high impressions with low clicks mean?",
        answer:
          "Google is showing you in search results and people are choosing not to click. Impressions count how often you appeared; clicks count how often you were chosen. A wide gap between the two means you are visible but not being picked.",
      },
      {
        question: "Is a low CTR always a problem?",
        answer:
          "No. A 1% click-through rate at position 18 is ordinary. The same 1% at position 3 usually is not. What matters is your rate relative to what your own site achieves at that position, which is the only comparison this tool makes.",
      },
      {
        question: "What is a normal CTR for my position?",
        answer:
          "Published benchmarks say roughly 28% at position 1, 11% at position 3 and 2% at position 10. Treat those as a rough map rather than a measurement. We tested them against a real site and found positions 4-10 earning about a tenth of the published figure, because that site's queries were being answered inside the results page. Your own curve is the only one that describes your site.",
      },
      {
        question: "Why do I have impressions but no clicks at all?",
        answer:
          "Three causes are common: a title that does not match the query, an AI Overview or featured snippet answering above you, or a page ranking for a query it was never meant to serve. This tool finds the queries. Telling the three apart still takes a look at what people actually searched for.",
      },
      {
        question: "Does this work without Search Console?",
        answer:
          "No. It reads your own site's private search performance data, which only Search Console has. For a tool that works on any public URL with no login, use the Free SEO Audit.",
      },
      {
        question: "What access do you need?",
        answer:
          "Read-only Search Console access. We cannot modify your site, your account or your data, and you can revoke access at any time from your Google account settings.",
      },
      {
        question: "Do you store my data?",
        answer:
          "No. We read Search Console, compute the report, and send it to your browser. Nothing is written to a database, so export what you want to keep before you close the tab.",
      },
      {
        question: "Can I keep the results after I close the tab?",
        answer:
          "Yes, as CSV. The file carries the same rows, the same measured window and the same blanks: a value we could not compute stays empty rather than becoming a zero. It is the only copy that survives the tab.",
      },
      {
        question: "Where do the title drafts come from?",
        answer:
          "From your own site. We look for a page in the same position band earning a clearly higher click-through rate, show you which page that is, and draft on the same pattern. If there is no comparable page there is no draft — we do not fall back to a generic template.",
        requiresDrafts: true,
      },
      {
        question: "How often should I check?",
        answer:
          "Monthly is enough for most sites. Title and meta changes take a few weeks to appear in Search Console data, so checking more often mostly shows noise.",
      },
    ],
  },
  "traffic-drop-diagnosis": {
    path: "/tools/traffic-drop-diagnosis",
    eyebrow: "Search performance diagnosis",
    title: "Investigate a sudden drop in organic traffic with your own data",
    description:
      "Find out whether your organic traffic really dropped, when it turned, and how much of it held \u2014 measured against your own Search Console history, with the comparison windows chosen by change-point detection rather than by you.",
    sourceLabel: "Requires a Google Search Console connection",
    sourceDetail:
      "GenGrowth uses read-only Search Console access and asks you to review the selected property.",
    cta: "Open GenGrowth and investigate the drop",
    trust:
      "No generic demo or automatic blame. The result is limited to the evidence available in your property.",
    workflowTitle: "What happens in the product",
    steps: [
      { name: "Open a project", text: "Create or open a GenGrowth project." },
      {
        name: "Authorize Search Console",
        text: "Read-only access, then choose the affected property.",
      },
      {
        name: "Compare the periods",
        text: "Inspect page-level changes and review the supported root-cause hypotheses.",
      },
    ],
    outputTitle: "What the diagnosis keeps separate",
    outputs: [
      {
        label: "Observation",
        body: "The magnitude, timing, and affected pages or queries in the selected periods.",
      },
      {
        label: "Diagnosis",
        body: "Supported explanations such as ranking, CTR, indexing, or seasonal changes—not a guessed single cause.",
      },
      {
        label: "Recommendation",
        body: "A scoped investigation or remediation step tied to the observed segment.",
      },
      {
        label: "Artifact",
        body: "A comparison record that preserves the chosen windows and evidence boundary.",
      },
    ],
    faq: [
      {
        question: "Can a public crawl diagnose a traffic drop?",
        answer:
          "Not reliably. The pages may still be public while private search-performance data has changed.",
      },
      {
        question: "Is the Google connection read-only?",
        answer:
          "Yes. GenGrowth requests read-only Search Console access and does not change your site or account.",
      },
      {
        question: "Can it prove one root cause?",
        answer:
          "Not always. The output distinguishes what the data supports from hypotheses that need further checking.",
      },
    ],
  },
  "hidden-keywords": {
    path: "/tools/hidden-keywords",
    eyebrow: "Content opportunity planning",
    title:
      "Map keyword opportunities from a real site and verified keyword data",
    description:
      "The opportunity map starts with your public site context, then validates candidate topics against a configured keyword data source before they are presented as opportunities.",
    sourceLabel: "Requires an enabled keyword data source in GenGrowth",
    sourceDetail:
      "Search-volume validation has a direct data cost. GenGrowth only presents validated opportunities when the project has an authorized provider available.",
    cta: "Open GenGrowth to prepare an opportunity map",
    trust:
      "No fabricated search volume and no AI-only keyword list presented as validated demand.",
    workflowTitle: "What happens in the product",
    steps: [
      {
        name: "Create a project",
        text: "Set it up with your site and product context.",
      },
      {
        name: "Connect a data source",
        text: "The permitted keyword data source for the workspace.",
      },
      {
        name: "Review the candidates",
        text: "Site-informed candidate topics, only after their available demand signals are checked.",
      },
    ],
    outputTitle: "What the opportunity map keeps separate",
    outputs: [
      {
        label: "Observation",
        body: "Topics and language found in the public site context.",
      },
      {
        label: "Diagnosis",
        body: "Coverage gaps or uncertain demand signals, with source availability shown.",
      },
      {
        label: "Recommendation",
        body: "A reviewable topic or keyword direction with its evidence status.",
      },
      {
        label: "Artifact",
        body: "A keyword and topic list that records which items were validated by a provider.",
      },
    ],
    faq: [
      {
        question: "Do I need Search Console?",
        answer:
          "No. This workflow uses public site context plus an authorized keyword data source, not Search Console OAuth.",
      },
      {
        question: "Are AI-generated candidates enough?",
        answer:
          "No. They are candidates only until the available keyword source verifies the relevant demand signal.",
      },
      {
        question: "Why might the map be unavailable?",
        answer:
          "A workspace must have an authorized keyword provider before GenGrowth can validate demand instead of guessing.",
      },
    ],
  },
};

const ZH: Record<ConnectedTool, ConnectedToolContent> = {
  "seo-quick-wins": {
    path: "/tools/seo-quick-wins",
    eyebrow: "搜索表现证据",
    title: "曝光很高，点击很少",
    description:
      "Google 已经为这些查询词把你展示了成千上万次，却几乎没人点击。我们用你自己网站的点击率曲线来衡量这个缺口，而不是一张行业平均表。引擎只读一个维度——查询词，所以每一行都是搜索词，不是页面。",
    sourceLabel: "需要连接 Google Search Console",
    sourceDetail:
      "GenGrowth 只请求 Search Console 的只读权限，不能发布页面、改变排名或修改你的 Google 账号，也不保存任何结果。",
    cta: "连接 Search Console",
    trust: "不展示演示数据，不保存任何结果。每个数字都来自你选择的站点属性。",
    workflowTitle: "怎么找出「曝光高、点击少」的查询词",
    steps: [
      {
        name: "连接 Search Console",
        text: "只读、一次点击，随时可以在 Google 账号里撤销。",
      },
      {
        name: "先建你站点自己的 CTR 曲线",
        text: "用你自己的非品牌查询词，算出最近 28 个完整日里，你的网站在每个位置段上正常的点击率是多少。",
      },
      {
        name: "从缺口最大的看起",
        text: "所有点击率低于你自己网站在该位置表现的查询词，按缺口大小排序。任意一列都能排序，整张表也能导出成 CSV。",
      },
      {
        name: "有对照页时，把它放在旁边给你看",
        text: "对照页来自你自己的网站，具名可点，你可以自己判断这个对照成不成立。找不到合格对照页就不出草稿。",
        requiresDrafts: true,
      },
    ],
    outputTitle: "你会得到什么，以及它到哪里为止",
    outputs: [
      {
        label: "观测",
        body: "每一条曝光量足以测量的查询词的曝光、点击与平均位置。是查询词而不是页面——这是本报告唯一读取的维度。",
      },
      {
        label: "你自己的基准",
        body: "在每个位置段上，你的网站正常的点击率是多少。计算某条查询词的基准时，会先把它自己排除出去。",
      },
      {
        label: "缺口",
        body: "预期点击减去实际点击。这是两个实测数字之间的差值，不是「改动之后能拿回多少」的预测。",
      },
      {
        label: "我们解释不了的部分",
        body: "我们不检测 AI Overview 等 SERP 特性，而它恰恰是这类缺口的主要成因之一。工具每次运行都会明说这条限制。",
      },
    ],
    faq: [
      {
        question: "「曝光高、点击少」到底是什么意思？",
        answer:
          "Google 已经把你放进搜索结果里，而人们选择了不点。曝光是你出现了多少次，点击是你被选中了多少次。两者差得越远，说明你看得见，但没被选中。",
      },
      {
        question: "点击率低就一定是问题吗？",
        answer:
          "不一定。位置 18 上 1% 的点击率很正常，位置 3 上的同一个 1% 通常就不正常。真正有意义的是你相对于自己网站在该位置的表现，而这也是本工具唯一做的对比。",
      },
      {
        question: "我这个位置的正常点击率是多少？",
        answer:
          "公开基准表说位置 1 约 28%、位置 3 约 11%、位置 10 约 2%。把它当作粗略地图，不要当作测量结果。我们拿真实站点实测过：位置 4–10 的实际点击率只有公开数字的约十分之一，因为那个站的查询在结果页里就被回答掉了。只有你自己的曲线才描述你的网站。",
      },
      {
        question: "为什么我有曝光却一次点击都没有？",
        answer:
          "常见的有三种：标题没有对上这条查询、AI Overview 或精选摘要在你上方直接给了答案、或者这个页面在为一条它本来就不该服务的查询排名。工具能找出这些查询词，但要区分这三种，还是得你自己看几条真实的搜索词。",
      },
      {
        question: "不连 Search Console 能用吗？",
        answer:
          "不能。它读的是只有 Search Console 才有的、你自己网站的私有搜索表现数据。如果你要一个对任意公开 URL 都能跑、无需登录的工具，请用免费 SEO 审计。",
      },
      {
        question: "你们需要什么权限？",
        answer:
          "Search Console 的只读权限。我们不能修改你的网站、账号或数据，你随时可以在 Google 账号设置里撤销授权。",
      },
      {
        question: "你们会保存我的数据吗？",
        answer:
          "不会。我们读取 Search Console、算出报告、发送到你的浏览器，不写入任何数据库。所以想留下的内容请在关闭标签页之前导出。",
      },
      {
        question: "关掉页面之后结果还能留下吗？",
        answer:
          "能，导出成 CSV。文件里是同样的行、同样的统计区间、同样的空白：算不出来的值在文件里也是空的，不会变成 0。它是唯一能活过这个标签页的副本。",
      },
      {
        question: "标题草稿是从哪来的？",
        answer:
          "来自你自己的网站。我们在同一个位置段里找点击率明显更高的页面，把是哪一个页面告诉你，再照同样的措辞模式起草。找不到合格对照页就不出草稿——我们不会退回到通用模板。",
        requiresDrafts: true,
      },
      {
        question: "多久看一次合适？",
        answer:
          "多数网站一个月一次就够。标题和描述的改动要几周才会反映到 Search Console 的数据里，看得更勤基本只是在看噪声。",
      },
    ],
  },
  "traffic-drop-diagnosis": {
    path: "/tools/traffic-drop-diagnosis",
    eyebrow: "搜索表现诊断",
    title: "用自己的数据排查自然流量突然下降",
    description:
      "用你自己的 Search Console 历史数据弄清楚：流量是不是真的跌了、从哪天开始跌、跌下去之后有没有稳住。对比窗口由变点检测自动选定，不由你挑。",
    sourceLabel: "需要连接 Google Search Console",
    sourceDetail:
      "GenGrowth 使用只读 Search Console 权限，并要求你审阅选择的站点属性。",
    cta: "打开 GenGrowth 并排查流量下降",
    trust:
      "没有通用演示，也不会自动归咎于某个原因。结论受限于你的站点属性中可用的证据。",
    workflowTitle: "产品中的执行方式",
    steps: [
      { name: "打开项目", text: "创建或打开一个 GenGrowth 项目。" },
      {
        name: "授权 Search Console",
        text: "只读访问，然后选择受影响的站点属性。",
      },
      {
        name: "比较时间段",
        text: "检查页面级变化，并审阅有证据支持的根因假设。",
      },
    ],
    outputTitle: "诊断如何区分不同层次",
    outputs: [
      {
        label: "Observation",
        body: "选定时间段内变化的幅度、时点与受影响页面或查询词。",
      },
      {
        label: "Diagnosis",
        body: "排名、CTR、索引或季节性等有证据支持的解释，而不是猜测单一原因。",
      },
      { label: "Recommendation", body: "与观察区间对应的排查或修复步骤。" },
      { label: "Artifact", body: "保留所选时间窗口和证据边界的比较记录。" },
    ],
    faq: [
      {
        question: "公开爬取能诊断流量下降吗？",
        answer:
          "不能可靠地做到。页面可能仍然公开，但私有搜索表现数据已经变化。",
      },
      {
        question: "Google 连接是只读的吗？",
        answer:
          "是。GenGrowth 请求只读 Search Console 权限，不会修改你的网站或账号。",
      },
      {
        question: "它能证明唯一根因吗？",
        answer: "不一定。输出会区分数据支持的事实和仍需验证的假设。",
      },
    ],
  },
  "hidden-keywords": {
    path: "/tools/hidden-keywords",
    eyebrow: "内容机会规划",
    title: "从真实网站和已验证数据中建立关键词机会地图",
    description:
      "机会地图从公开网站上下文开始，只有在已配置的关键词数据源完成校验后，候选主题才会作为机会呈现。",
    sourceLabel: "需要在 GenGrowth 中启用关键词数据源",
    sourceDetail:
      "搜索量校验存在直接数据成本。只有项目具备已授权的数据源时，GenGrowth 才会展示经过验证的机会。",
    cta: "打开 GenGrowth 并准备机会地图",
    trust: "不虚构搜索量，也不会把仅由 AI 发散出的关键词清单包装成已验证需求。",
    workflowTitle: "产品中的执行方式",
    steps: [
      { name: "创建项目", text: "使用网站和产品上下文创建项目。" },
      {
        name: "连接数据源",
        text: "为工作区连接允许使用的关键词数据源。",
      },
      {
        name: "审阅候选主题",
        text: "只有需求信号完成校验后，再审阅由站点上下文生成的候选主题。",
      },
    ],
    outputTitle: "机会地图如何区分不同层次",
    outputs: [
      { label: "Observation", body: "公开站点上下文中出现的主题和表达。" },
      {
        label: "Diagnosis",
        body: "主题覆盖缺口或不确定的需求信号，并展示数据源可用性。",
      },
      {
        label: "Recommendation",
        body: "带有证据状态、可审阅的主题或关键词方向。",
      },
      {
        label: "Artifact",
        body: "记录哪些条目经由数据源验证的关键词和主题列表。",
      },
    ],
    faq: [
      {
        question: "需要 Search Console 吗？",
        answer:
          "不需要。该工作流使用公开站点上下文和已授权的关键词数据源，不使用 Search Console OAuth。",
      },
      {
        question: "AI 生成的候选词够用吗？",
        answer: "不够。它们在可用关键词数据源验证相关需求信号前，只是候选项。",
      },
      {
        question: "为什么机会地图可能不可用？",
        answer:
          "工作区必须具备已授权的关键词提供商，GenGrowth 才能验证需求而不是猜测。",
      },
    ],
  },
};

/**
 * The copy for one tool, minus anything this deployment cannot deliver.
 *
 * `draftsEnabled` defaults to true because only SEO Quick Wins has copy that
 * depends on a model key, and every other caller would otherwise have to pass
 * a flag that means nothing to it. When it is false the draft step and the
 * draft FAQ entry are dropped — from the page AND from the HowTo/FAQPage
 * structured data generated off the same object, which is the half that
 * outlives the render and gets quoted back by a search engine.
 */
export function getConnectedToolContent(
  locale: string,
  tool: ConnectedTool,
  options: { readonly draftsEnabled?: boolean } = {},
): ConnectedToolContent {
  const content = (locale === "zh" ? ZH : EN)[tool];
  if (options.draftsEnabled !== false) return content;
  return {
    ...content,
    steps: content.steps.filter((step) => step.requiresDrafts !== true),
    faq: content.faq.filter((entry) => entry.requiresDrafts !== true),
  };
}
