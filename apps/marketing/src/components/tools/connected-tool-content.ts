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
  readonly steps: readonly string[];
  readonly outputTitle: string;
  readonly outputs: readonly {
    readonly label: string;
    readonly body: string;
  }[];
  readonly faq: readonly {
    readonly question: string;
    readonly answer: string;
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
    workflowTitle: "How it works",
    steps: [
      "Authorize a read-only Search Console connection and choose a property.",
      "We build your site's own CTR curve, band by band, from your non-brand queries.",
      "Every query with enough impressions is compared against what your own site earns at that position.",
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
        question: "Why is Search Console required?",
        answer:
          "Click and impression performance is private property data; a public crawl cannot reproduce it.",
      },
      {
        question: "Why not use published CTR benchmarks?",
        answer:
          "We tested them against a real site and found positions 4-10 earning about a tenth of the published figure, while 11-16 earned three times what 4-10 did. Industry averages describe a plain blue-link results page; your site may not have one.",
      },
      {
        question: "Will it tell me why the CTR is low?",
        answer:
          "No. A gap can mean a weak title, a mismatch with what searchers wanted, or Google answering the query in the results page. We measure the gap and say which causes we cannot distinguish.",
      },
      {
        question: "Do you store my data?",
        answer:
          "No. We read Search Console, compute the report, and send it to your browser. Nothing is written to a database.",
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
      "Create or open a GenGrowth project.",
      "Authorize read-only Search Console access and choose the affected property.",
      "Compare periods, inspect page-level changes, and review the supported root-cause hypotheses.",
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
      "Create a project with your site and product context.",
      "Connect the permitted keyword data source for the workspace.",
      "Review site-informed candidate topics only after their available demand signals are checked.",
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
    workflowTitle: "它是怎么工作的",
    steps: [
      "授权只读 Search Console 并选择一个站点属性。",
      "我们用你自己的非品牌查询词，逐段构建你站点自己的 CTR 曲线。",
      "每一条曝光量足够的查询词，都与你自己网站在同一位置的表现作对比。",
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
        question: "为什么需要 Search Console？",
        answer: "点击和曝光是私有站点数据，公开爬取无法复现。",
      },
      {
        question: "为什么不用公开的 CTR 基准表？",
        answer:
          "我们拿真实站点实测过：位置 4–10 的实际点击率只有公开数字的约十分之一，而 11–16 反而是 4–10 的三倍。行业平均描述的是一个普通蓝链结果页，而你的网站未必是。",
      },
      {
        question: "它会告诉我点击率为什么低吗？",
        answer:
          "不会。缺口可能是标题不够好，可能是搜索者想要的是别的东西，也可能是 Google 在结果页直接给出了答案。我们测量缺口，并说清楚哪些成因我们区分不了。",
      },
      {
        question: "你们会保存我的数据吗？",
        answer:
          "不会。我们读取 Search Console、算出报告、发送到你的浏览器，不写入任何数据库。",
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
      "创建或打开一个 GenGrowth 项目。",
      "授权只读 Search Console 并选择受影响的站点属性。",
      "比较时间段、检查页面级变化，并审阅有证据支持的根因假设。",
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
      "使用网站和产品上下文创建项目。",
      "为工作区连接允许使用的关键词数据源。",
      "只有需求信号完成校验后，再审阅由站点上下文生成的候选主题。",
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

export function getConnectedToolContent(
  locale: string,
  tool: ConnectedTool,
): ConnectedToolContent {
  return (locale === "zh" ? ZH : EN)[tool];
}
