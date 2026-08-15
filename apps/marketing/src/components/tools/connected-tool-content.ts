// @input  -- locale and tool identifier
// @output -- truthful public copy for tools that require a connected data source
// @pos    -- content boundary between marketing acquisition and the authenticated product

export type ConnectedTool =
  | "seo-quick-wins"
  | "traffic-drop-diagnosis"
  | "low-competition-keywords";

/**
 * The union as a value, so a test can walk every member.
 *
 * `satisfies` alone proves each entry is a member of the union; it does not
 * prove the list holds all of them. `CONNECTED_TOOLS_ARE_COMPLETE` fails the
 * build with the missing name when a tool is added to the type and not here.
 */
export const CONNECTED_TOOLS = [
  "seo-quick-wins",
  "traffic-drop-diagnosis",
  "low-competition-keywords",
] as const satisfies readonly ConnectedTool[];

type MissingConnectedTool = Exclude<
  ConnectedTool,
  (typeof CONNECTED_TOOLS)[number]
>;
const CONNECTED_TOOLS_ARE_COMPLETE: [MissingConnectedTool] extends [never]
  ? true
  : MissingConnectedTool = true;
void CONNECTED_TOOLS_ARE_COMPLETE;

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
    title: "Find SEO Opportunities in Google Search Console",
    description:
      "Turn high-impression, low-click queries and positions 8–20 into a prioritized action list.",
    sourceLabel: "Requires a Google Search Console connection",
    sourceDetail:
      "GenGrowth requests read-only Search Console access. It cannot publish pages, change rankings, or modify your Google account, and it stores nothing on our servers.",
    cta: "Connect Search Console",
    trust:
      "No demo data, nothing stored on our servers. Every number is computed from the property you choose.",
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
        name: "Start with what to do next",
        text: "Every run opens with a short list of moves. Each one is gated on a number in the same report and names the rows it came from \u2014 including the moves not to make. None of them predicts what a change would do.",
      },
      {
        name: "Then read the gaps, largest first",
        text: "Every search query whose click-through rate falls below what your own site earns at that position, ranked by the size of the shortfall. Each row says which checking path it is on, so you can filter to the handful worth a morning. Sort any column, or take the whole table away as CSV.",
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
        label: "What to do next",
        body: "A short list of moves drawn from this run: which rows need a look at the search results page, which conclusions the evidence does not support, and where the picture is incomplete enough that you should go elsewhere for it. Every entry names what put it there.",
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
          "No. It reads your own site's private search performance data, which only Search Console has. For a public-HTML review that needs no Search Console connection, use SEO Agent; a verified GenGrowth account is required before its crawl.",
      },
      {
        question: "What access do you need?",
        answer:
          "Read-only Search Console access. We cannot modify your site, your account or your data, and you can revoke access at any time from your Google account settings.",
      },
      {
        question: "Do you store my data?",
        answer:
          "No. We read Search Console, compute the report, and send it to your browser. Nothing is written to a database, so export what you want to keep before you close the tab. The one thing that persists is the Google authorization itself, encrypted in a cookie in your own browser so a return visit does not start from the consent screen; revoking access in your Google account settings ends it.",
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
        question:
          "It will not tell me why the CTR is low, so what do I actually do?",
        answer:
          "It tells you where to look, and in what order. A row short by more than a click sends you to the search results page for that query \u2014 an AI Overview or a featured snippet takes the click before your title is ever read, we do not observe those, and you can in about a minute. When a whole position band earns under 1%, the report says so and tells you not to rewrite a dozen titles over what is one fact. And when most of your queries are too small to measure at all, it points you at the Search Console report that does see them.",
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
      "Find out whether your organic traffic really dropped, when it turned, and how much of it held \u2014 measured against your own Search Console history, with the comparison windows chosen by change-point detection rather than by you. If what you are really asking is \u201cwas I penalized?\u201d, the diagnosis puts the drop next to what your data actually shows, and is explicit about which parts of that question it cannot settle.",
    sourceLabel: "Requires a Google Search Console connection",
    sourceDetail:
      "GenGrowth requests read-only Search Console access and asks you to review the selected property. It cannot change your site, your rankings, or your Google account, and the report is computed from your own history rather than from a demo dataset.",
    cta: "Connect Search Console and investigate the drop",
    trust:
      "No generic demo and no automatic blame. The result is limited to the evidence available in your property, and every claim in it names where it came from.",
    workflowTitle: "What happens when you run the diagnosis",
    steps: [
      {
        name: "Answer two questions from your own Search Console",
        text: "Before anything runs, the tool asks what you saw on the Manual actions and Security issues pages. No Google API exposes either report \u2014 the Search Console API publishes sites, sitemaps, search analytics, and URL inspection, nothing more \u2014 so an honest tool has to ask rather than pretend it looked. Your answers are carried through the report marked as reported by you, not observed by us.",
      },
      {
        name: "Connect Search Console, read-only",
        text: "One click, revocable at any time from your Google account. The connection can read your search performance history; it cannot publish content, change rankings, or modify your account.",
      },
      {
        name: "Change-point detection chooses the comparison windows",
        text: "The tool reads your daily clicks and impressions and looks for the turn across the full available history. The before-and-after windows are chosen by the detector, never by you \u2014 a hand-picked window is a hand-picked conclusion. A dip that did not persist is reported as a transient anomaly, not sold to you as a decline.",
      },
      {
        name: "The query mix is split and described",
        text: "Brand and non-brand queries are separated and each half's movement is described with its coverage attached. Search Console withholds low-volume queries, so the report states how much of your traffic the visible rows actually account for \u2014 and stays silent when that coverage is too thin to support a comparison.",
      },
      {
        name: "Read the findings in order",
        text: "Observed changes first, each tied to the numbers behind it. Then the explanations those numbers are compatible with. Then, listed rather than hidden, every check that could not run and where you would need to look instead.",
      },
    ],
    outputTitle: "What the diagnosis keeps separate",
    outputs: [
      {
        label: "Observation",
        body: "The magnitude and timing of the change, the affected queries — and pages, where the data allows — and how the brand and non-brand halves of your query set each moved across the windows the detector chose.",
      },
      {
        label: "Diagnosis",
        body: "The explanations the observed data is compatible with — ranking loss, click-through change, indexing, seasonality — listed rather than ranked. When several fit, the report says so instead of electing one.",
      },
      {
        label: "Penalty status, kept honest",
        body: "What you reported from the Manual actions and Security issues pages, printed as your report rather than our observation. A reported issue leads the output, because resolving a manual action is the one recovery procedure Google actually defines. If you answered that you were not sure, the diagnosis says nothing about penalties — including that there is no evidence of one.",
      },
      {
        label: "Recommendation",
        body: "A scoped next step tied to the observed segment: which report to open, which pages to look at, and which conclusions the current evidence does not support yet.",
      },
      {
        label: "Checks that could not run",
        body: "The check list is fixed and always rendered in full — the checks that found nothing and the ones that could not run, each with its reason. A report that shows only its hits reads as if it examined everything.",
      },
      {
        label: "Artifact",
        body: "A comparison record that preserves the chosen windows, the evidence boundary, and the lineage of every claim, so someone else can see what was measured, what was reported, and what was left open.",
      },
    ],
    faq: [
      {
        question: "How do I know if my site has a manual action?",
        answer:
          "Open Search Console and read the Manual actions report — it is the only authoritative source. A manual action is a penalty applied by a human reviewer at Google; when one exists, that report names the violation and Google notifies the property's verified owners. No API exposes the report, so no external tool — this one included — can read it for you. If it says no issues were detected, you do not have a manual action, and the drop needs a different explanation.",
      },
      {
        question:
          "What is the difference between a manual action and an algorithmic adjustment?",
        answer:
          "A manual action is a documented penalty: a named violation listed in Search Console, with a reconsideration process for lifting it. An algorithmic adjustment is Google's ranking systems revaluing your pages — nothing is listed anywhere, no notice is sent, and there is no form to file; improving the site is the only route back. People say “penalized” for both, but only the manual action is something Google will confirm to you.",
      },
      {
        question: "Can this tool tell me whether I was penalized?",
        answer:
          "It can situate the question; it cannot settle it. It asks what your Manual actions report says, because only that report is authoritative for a manual action. For the algorithmic case there is no report to read — anywhere — so the diagnosis shows what your own data can support: when the drop started, whether it persisted, which queries carried it, and which mundane causes fit the same curve. It does not confirm causation, and a tool that claims to is guessing.",
      },
      {
        question: "Can this tool tell me if a core update hit my site?",
        answer:
          "No. It shows where your drop sits against Google's published update timeline, as orientation — rollouts span weeks and cover a large share of the calendar, so a date overlap is background rather than evidence, and Google adjusts ranking continuously between announced updates, so a miss rules nothing out. Google confirms when updates run; it does not confirm which sites they touched.",
      },
      {
        question: "What are common causes of a drop that are not penalties?",
        answer:
          "Most drops are not penalties. Seasonality moves demand before anything on your site changes. SERP feature shifts — an AI Overview or a featured snippet appearing above you — take clicks while rankings hold. Tracking changes and migrations move traffic between reports rather than losing it: a property change, a redirect, a re-tagged analytics setup. And an indexing fault — a stray noindex, a robots rule — imitates a penalty closely while being listed in a different Search Console report entirely. The diagnosis works through explanations like these before anything site-wide is on the table.",
      },
      {
        question: "Can it prove one root cause?",
        answer:
          "Not always, and it says so rather than guess. The output separates what the data supports from hypotheses that need further checking. Different problems draw the same curve — a lost SERP feature, a noindex on one template, a seasonal trough — and a tool that always names a single culprit is choosing your conclusion for you.",
      },
      {
        question: "Can a public crawl diagnose a traffic drop?",
        answer:
          "Not reliably. Your pages can be public, crawlable, and unchanged while your private search performance has collapsed. A drop lives in the clicks-and-impressions record that only Search Console holds, which is why this diagnosis starts from your property rather than from a crawl of your site.",
      },
      {
        question: "Is the Google connection read-only?",
        answer:
          "Yes. GenGrowth requests read-only Search Console access. It cannot change your site, your rankings, or your account, and you can revoke the access at any time from your Google account settings.",
      },
    ],
  },
  "low-competition-keywords": {
    path: "/tools/low-competition-keywords",
    eyebrow: "Content opportunity planning",
    title: "Find low competition keywords with a weak site already on page one",
    description:
      "Reads your site, prices candidate terms with real search data, and keeps the ones where a low-authority site already holds a page-one place.",
    sourceLabel: "Requires a Google Search Console connection",
    sourceDetail:
      "Read-only. Your own Search Console queries are what tell the map which terms your site already serves, so it does not hand you back a page you have.",
    cta: "Connect Search Console",
    trust:
      "No fabricated search volume, and no keyword called winnable on a difficulty score. Every search term shown had its page one opened; question phrasings are matched to your own pages instead.",
    workflowTitle: "How the map decides what to show you",
    steps: [
      {
        name: "Connect Search Console",
        text: "Read-only, one click, revoke it whenever you like from your Google account.",
      },
      {
        name: "We read your site first",
        text: "Up to fourteen pages, product pages first, and we show you what we understood before spending anything. Wrong reading, wrong keywords — so you get to correct it.",
      },
      {
        name: "Candidates are priced, not guessed",
        text: "Every term goes to a search-data provider. Terms it has no data for are reported as having no data, never as zero demand.",
      },
      {
        name: "Page one is opened for the survivors",
        text: "Up to twenty terms per run have their real page one sampled. A term is only called winnable when a low-authority domain already ranks there — named, with its position, so you can open the page yourself. The weakest rank is a proxy signal, not a verdict; trusting difficulty scores instead is what sent our own keyword picks wrong four times.",
      },
    ],
    outputTitle: "What you get back",
    outputs: [
      {
        label: "Search terms with measured demand",
        body: "Volume from the provider, the weakest domain currently holding a page-one place — named, with its position — and whether the provider observed an AI Overview on that page. The whole table exports as CSV.",
      },
      {
        label: "Questions your site already answers",
        body: "Question phrasings matched to a page you have. No search volume is claimed for these — they almost never have any.",
      },
      {
        label: "Checks before you act",
        body: "Every row carries what to go look at. None of them is a verdict; the tool has not read the pages that rank.",
      },
      {
        label: "Where the rest went",
        body: "Every candidate that did not reach the table, with the specific wall it hit — and for the terms the sampling budget never reached, a one-click way to hand them to the seed field for a narrower re-run.",
      },
    ],
    faq: [
      {
        question: "Do I need Search Console?",
        answer:
          "Yes. Read-only access is required. It is what lets the map skip terms your site already serves — without it every suggestion would risk being a page you already have.",
      },
      {
        question: "Are AI-generated candidates enough?",
        answer:
          "No. The model proposes terms from what your site says; a search-data provider prices them and a real page-one sample decides whether any of them is worth attempting.",
      },
      {
        question:
          "Why would the map suggest terms that have nothing to do with my business?",
        answer:
          "The candidates come from a model reading up to fourteen of your pages, and models mishandle ambiguous words: an earlier version of our own internal keyword engine once tagged 'miami dade transit bus tracker' as astrology-relevant, because 'transit' is a legitimate astrology term. That failure is why this map shows you what it read and waits for your confirmation before spending anything — and why the seed field exists. Correct the reading, and the candidates follow.",
      },
      {
        question:
          "The difficulty score says easy. Why does page one still look impossible?",
        answer:
          "A difficulty score models links and authority; it does not say who actually holds page one. Terms with single-digit scores routinely show a page one owned end to end by high-authority domains. That is why the map opens the real page for each surviving term and reports the weakest domain it found there — named, with its position — instead of trusting the score.",
      },
      {
        question: "What does the weakest rank tell me — and what does it not?",
        answer:
          "It answers one narrow question: how weak is the weakest domain currently holding a page-one place. One low number is evidence that a small site got in; it says nothing about the other nine results, the intent behind the query, or what kind of page wins. That is why every row carries checks to run before acting, and why the domain and its position are shown for you to open.",
      },
      {
        question: "Why were some candidates never checked against page one?",
        answer:
          "Each run samples at most twenty page ones and stops at a per-run cost ceiling, because sampling is the expensive stage of a free tool. The held-back list names every term the budget did not reach, and the button under that list hands them to the seed field for a narrower re-run. Seeds steer the next run's candidate generation toward those terms; the pricing and page-one gates then judge them like any other candidate.",
      },
      {
        question: "Does the map detect AI Overviews?",
        answer:
          "It records what the provider observed: when a sampled page one carried an AI Overview, the row says so, and the CSV export carries the same column. A dash means the provider reported nothing about the page's features, which is not the same as no AI Overview. The map does not model how much traffic an AI Overview absorbs — treat its presence as a reason to open the page before writing anything.",
      },
      {
        question: "Is the search volume global?",
        answer:
          "No. You pick one market and one language before the run, and every volume is priced for that pair — the same term can carry entirely different demand in different countries. The market list is deliberately short: every entry on it has actually been run against the crawl, the prompts and the data provider.",
      },
      {
        question: "Why would a run come back with almost nothing?",
        answer:
          "Because the public data does not support a keyword plan for that site and market yet. Roughly a quarter of the sites we tested came back that way, and padding the table would be the dishonest answer.",
      },
      {
        question: "How long does it take?",
        answer:
          "About twenty seconds to read your site, then roughly two minutes to price the candidates and open page one for the survivors one at a time.",
      },
    ],
  },
};

const ZH: Record<ConnectedTool, ConnectedToolContent> = {
  "seo-quick-wins": {
    path: "/tools/seo-quick-wins",
    eyebrow: "搜索表现证据",
    title: "在 Google Search Console 中找出 SEO 机会",
    description:
      "把高曝光、低点击的查询词和位置 8–20 的排名，变成一份按优先级排序的行动清单。",
    sourceLabel: "需要连接 Google Search Console",
    sourceDetail:
      "GenGrowth 只请求 Search Console 的只读权限，不能发布页面、改变排名或修改你的 Google 账号，也不在我们的服务器上留存任何结果。",
    cta: "连接 Search Console",
    trust:
      "不展示演示数据，服务器上不留存任何结果。每个数字都来自你选择的站点属性。",
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
        name: "先看「接下来做什么」",
        text: "每次运行都以一份很短的行动清单开头。每一条都挂在同一份报告里的某个数字上，并会点名它是从哪几行来的——包括不该做的那几件。它们都不预测「改了会怎样」。",
      },
      {
        name: "再从缺口最大的看起",
        text: "所有点击率低于你自己网站在该位置表现的查询词，按缺口大小排序。每一行会说明它属于哪条检查路径，你可以只筛出值得花一个上午的那几条。任意一列都能排序，整张表也能导出成 CSV。",
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
        label: "接下来做什么",
        body: "从这次运行里得出的一份短清单：哪些行需要你去看一眼搜索结果页，哪些结论是证据不支持的，以及在哪些地方这张表不完整到你该去别处看。每一条都会写明是什么把它放进来的。",
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
          "不能。它读的是只有 Search Console 才有的、你自己网站的私有搜索表现数据。如果要检查公开 HTML 且不连接 Search Console，请使用 SEO Agent；抓取前必须验证 GenGrowth 账号。",
      },
      {
        question: "你们需要什么权限？",
        answer:
          "Search Console 的只读权限。我们不能修改你的网站、账号或数据，你随时可以在 Google 账号设置里撤销授权。",
      },
      {
        question: "你们会保存我的数据吗？",
        answer:
          "不会。我们读取 Search Console、算出报告、发送到你的浏览器，不写入任何数据库。所以想留下的内容请在关闭标签页之前导出。唯一会留下来的是 Google 授权本身：它加密保存在你自己浏览器的 cookie 里，让你下次回来不必从同意屏幕重新开始；在 Google 账号设置里撤销即可终止。",
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
        question: "它不告诉我点击率为什么低，那我到底该做什么？",
        answer:
          "它告诉你去看哪里、按什么顺序看。缺口超过一次点击的行，会把你送去看那个词的搜索结果页——AI 概览或精选摘要会在有人读到你的标题之前就把点击拿走，这些我们不检测，而你一分钟就能看到。整个位置段点击率低于 1% 的情况，报告会直接说明，并告诉你不要为同一件事去改十几条标题。而当你大部分查询词小到根本测不了时，它会指给你那个真的能看见它们的报告。",
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
      "用你自己的 Search Console 历史数据弄清楚：流量是不是真的跌了、从哪天开始跌、跌下去之后有没有稳住。对比窗口由变点检测自动选定，不由你挑。如果你真正想问的是「我是不是被惩罚了」，诊断会把这次下跌放到你的数据实际显示的内容旁边，并明确说明这个问题里哪些部分是它无法替你了结的。",
    sourceLabel: "需要连接 Google Search Console",
    sourceDetail:
      "GenGrowth 请求只读 Search Console 权限，并要求你审阅选择的站点属性。它不能修改你的网站、排名或 Google 账号，报告完全由你自己的历史数据算出，而不是演示数据集。",
    cta: "连接 Search Console 并排查流量下降",
    trust:
      "没有通用演示，也不会自动归咎于某个原因。结论受限于你的站点属性中可用的证据，报告里每一条判断都会写明它的出处。",
    workflowTitle: "运行诊断时会发生什么",
    steps: [
      {
        name: "先回答来自你自己 Search Console 的两个问题",
        text: "在任何计算开始之前，工具会先问你在「手动操作」和「安全问题」两个页面上看到了什么。没有任何 Google API 开放这两份报告——Search Console API 只提供站点、站点地图、搜索分析和网址检查，再无其他——所以诚实的工具只能问你，而不是假装自己看过。你的回答会贯穿整份报告，并被标记为「你报告的」，而不是「我们观测的」。",
      },
      {
        name: "以只读方式连接 Search Console",
        text: "一次点击，随时可以在 Google 账号里撤销。这个连接只能读取你的搜索表现历史，不能发布内容、改变排名或修改你的账号。",
      },
      {
        name: "由变点检测选定对比窗口",
        text: "工具读取你每天的点击与曝光，在整段可用历史上寻找拐点。前后对比窗口由检测器选定，绝不由你手挑——手挑的窗口就是手挑的结论。没有持续下去的短暂下探会被如实报告为短期异常，不会被当成下降趋势卖给你。",
      },
      {
        name: "拆分并描述查询词构成",
        text: "品牌词与非品牌词会被分开，各自的变动连同覆盖率一起描述。Search Console 会隐去低量查询词，所以报告会写明可见行实际覆盖了你多少流量——当覆盖率薄到撑不起对比时，报告会选择沉默。",
      },
      {
        name: "按顺序阅读结论",
        text: "先看已观测到的变化，每一条都挂着背后的数字；再看这些数字能兼容哪些解释；最后是逐条列出、而非藏起来的「无法执行的检查」，以及你需要去哪里补上它们。",
      },
    ],
    outputTitle: "诊断如何区分不同层次",
    outputs: [
      {
        label: "Observation",
        body: "变化的幅度与时点、受影响的查询词——在数据允许时也包括页面——以及品牌与非品牌两半在检测器选定的窗口之间各自怎么动。",
      },
      {
        label: "Diagnosis",
        body: "已观测数据能兼容的解释——排名下滑、点击率变化、索引、季节性——只列出，不排序。当多种解释都成立时，报告会直说，而不是替你选一个。",
      },
      {
        label: "惩罚状态，如实呈现",
        body: "你在「手动操作」和「安全问题」页面上看到的内容，会以「你的报告」而非「我们的观测」呈现。你报告了问题时，它会排在输出最前面，因为解除手动操作是 Google 唯一明确定义过的恢复流程。你回答「不确定」时，诊断对惩罚不做任何表态——包括「没有证据表明被惩罚」这种表态。",
      },
      {
        label: "Recommendation",
        body: "与观察到的分段对应的、范围明确的下一步：打开哪份报告、去看哪些页面，以及哪些结论是当前证据还不支持的。",
      },
      {
        label: "无法执行的检查",
        body: "检查清单是固定的，而且永远完整渲染——查过但没发现问题的、和根本无法执行的，都逐条列出并附原因。只展示命中项的报告，读起来就像它检查过所有东西。",
      },
      {
        label: "Artifact",
        body: "一份保留所选窗口、证据边界和每条判断来源的比较记录，让其他人能看清哪些是测出来的、哪些是转述的、哪些仍然悬而未决。",
      },
    ],
    faq: [
      {
        question: "怎么知道我的网站有没有手动操作？",
        answer:
          "打开 Search Console 的「手动操作」报告——它是唯一权威来源。手动操作是 Google 人工审核员施加的惩罚；存在时，那份报告会写明违规名目，Google 也会通知资产的已验证所有者。没有任何 API 开放这份报告，所以任何外部工具——包括本工具——都不能替你读它。如果报告显示未检测到问题，你就没有手动操作，这次下跌需要别的解释。",
      },
      {
        question: "手动操作和算法调整有什么区别？",
        answer:
          "手动操作是有据可查的惩罚：违规名目列在 Search Console 里，并有一套申请解除的复审流程。算法调整则是 Google 的排名系统对你的页面重新估值——任何地方都不会列出，不发通知，也没有表格可提交；改进网站是唯一的出路。两种情况人们都叫「被降权」，但只有手动操作是 Google 会向你确认的那一种。",
      },
      {
        question: "这个工具能告诉我「我是不是被惩罚了」吗？",
        answer:
          "它能把这个问题摆到证据旁边，但不能替你了结它。它会问你「手动操作」报告怎么说，因为对手动操作而言只有那份报告是权威的。至于算法层面，任何地方都没有一份可读的报告，所以诊断只展示你自己的数据能支持什么：下跌从何时开始、有没有持续、由哪些查询词构成，以及哪些平常的原因也能画出同一条曲线。它不确认因果——声称能确认的工具是在猜。",
      },
      {
        question: "它能告诉我是不是被某次核心更新打中了吗？",
        answer:
          "不能。它会展示你的下跌落在 Google 已公布更新时间线的什么位置，仅作定位——更新的推送往往持续数周、覆盖全年相当大的比例，日期重合是背景噪声而不是证据；而已公布的更新之间 Google 也在持续调整排名，日期错开同样排除不了任何东西。Google 会确认更新何时进行，但从不确认它触及了哪些网站。",
      },
      {
        question: "哪些常见原因会导致下跌、但并不是惩罚？",
        answer:
          "大多数下跌都不是惩罚。季节性会在你的网站没有任何变化之前先移走需求；SERP 特性变化——AI Overview 或精选摘要出现在你上方——会在排名不动的情况下拿走点击；跟踪方式变更和站点迁移会把流量在报告之间搬家而不是弄丢：换资产、加跳转、重打分析代码；而索引故障——一个多余的 noindex、一条 robots 规则——表现得和惩罚非常像，却列在 Search Console 完全不同的报告里。诊断会先走完这类解释，再谈任何站点级的问题。",
      },
      {
        question: "它能证明唯一根因吗？",
        answer:
          "不一定，而且它会直说，不会去猜。输出会区分数据支持的事实和仍需验证的假设。不同的问题会画出同一条曲线——丢掉一个 SERP 特性、某个模板上的 noindex、一个季节性低谷——永远给你点名单一元凶的工具，是在替你选结论。",
      },
      {
        question: "公开爬取能诊断流量下降吗？",
        answer:
          "不能可靠地做到。页面可以照常公开、可抓取、内容不变，而你的私有搜索表现已经塌了。下跌记录在只有 Search Console 才持有的点击与曝光序列里，这也是本诊断从你的站点属性、而不是从爬取你的网站开始的原因。",
      },
      {
        question: "Google 连接是只读的吗？",
        answer:
          "是。GenGrowth 请求只读 Search Console 权限，不能修改你的网站、排名或账号，你随时可以在 Google 账号设置里撤销授权。",
      },
    ],
  },
  "low-competition-keywords": {
    path: "/tools/low-competition-keywords",
    eyebrow: "内容机会规划",
    title: "找出第一页已经有弱站排上去的低竞争关键词",
    description:
      "读取你的站点，用真实搜索数据给候选词核价，只保留第一页已经有低权重站点占位的词。",
    sourceLabel: "需要连接 Google Search Console",
    sourceDetail:
      "只读授权。正是你自己的 Search Console 查询数据，让这张地图知道哪些词你的站点已经在服务——从而不会把你已经有的页面再推荐给你一遍。",
    cta: "连接 Search Console",
    trust:
      "不虚构搜索量，也不靠难度分判定「可赢」。每一个展示出来的搜索词，第一页都被真实打开过；问句条目则按「你站上是否已有页面回答它」来匹配。",
    workflowTitle: "这张地图凭什么决定给你看什么",
    steps: [
      {
        name: "连接 Search Console",
        text: "只读、一次点击，随时可在 Google 账号里撤销。",
      },
      {
        name: "先读你的站点",
        text: "最多十四个页面、产品页优先，并且在花掉任何钱之前把我们读到的内容摆给你看。读错了关键词就会错，所以这一步由你来纠正。",
      },
      {
        name: "候选词是核价出来的，不是猜的",
        text: "每个词都送去搜索数据源。数据源没有数据的词，会如实报告为「无数据」，绝不写成需求为零。",
      },
      {
        name: "对通过的词打开第一页",
        text: "每次运行最多对二十个词抽样真实第一页。只有当低权重域名已经排在那里时，一个词才会被称为可赢——并写明是哪个域名、排在第几位，方便你亲自打开核对。「最弱排名」是代理信号而不是判定；改信难度分，正是我们自己连续选错四次词的原因。",
      },
    ],
    outputTitle: "你会拿到什么",
    outputs: [
      {
        label: "有实测需求的搜索词",
        body: "数据源给出的搜索量，加上当前占据第一页的最弱域名——具名、带排位——以及数据源在那一页上是否观测到 AI Overview。整张表可导出为 CSV。",
      },
      {
        label: "你站点已经能回答的问题",
        body: "问句说法，并对应到你已有的页面。这些不声称任何搜索量——它们基本上也没有。",
      },
      {
        label: "动手前该查什么",
        body: "每一行都带着要去看的东西。它们都不是结论：这个工具没有读过那些排在前面的页面。",
      },
      {
        label: "其余的都去哪了",
        body: "每一个没进表格的候选词，以及它具体撞在哪道墙上。对抽样预算没轮到的那些词，还有一键把它们填入种子、跑一轮更窄地图的入口。",
      },
    ],
    faq: [
      {
        question: "需要 Search Console 吗？",
        answer:
          "需要，只读授权。正是它让地图能跳过你已经在服务的词——没有它，每一条建议都可能是你已经有的页面。",
      },
      {
        question: "AI 生成的候选词够用吗？",
        answer:
          "不够。模型根据你站点上写的东西提出候选词，由搜索数据源核价，再由真实的第一页抽样决定其中哪些值得一试。",
      },
      {
        question: "为什么地图会给出和我的业务毫无关系的词？",
        answer:
          "候选词来自模型读你的至多十四个页面，而模型会在多义词上出错：我们内部关键词引擎的一个早期版本，就曾把「miami dade transit bus tracker」标成与占星相关——因为 transit（行星过境）恰好是占星的正当用词。正是那次失败，让这张地图先把读到的内容摆给你、等你确认后才花钱，也是种子词一栏存在的原因。把读取纠正了，候选词自然就正了。",
      },
      {
        question: "难度分说很容易，为什么第一页看起来还是打不进去？",
        answer:
          "难度分建模的是链接和权重，它不回答「第一页现在被谁占着」。个位数难度分的词，第一页被高权重域名从头占到尾的情况比比皆是。所以这张地图对每个通过的词都打开真实第一页，报告它在那里找到的最弱域名——具名、带排位——而不是相信那个分数。",
      },
      {
        question: "「最弱排名」到底能告诉我什么、不能告诉我什么？",
        answer:
          "它只回答一个很窄的问题：当前占据第一页的域名里，最弱的那个有多弱。一个低数字是「小站进得去」的证据；它不涉及其余九条结果、查询背后的意图、以及赢家是哪类页面。所以每一行都带着动手前要跑的检查，也所以域名和排位都摆出来，让你亲自打开看。",
      },
      {
        question: "为什么有些候选词从来没被对照过第一页？",
        answer:
          "每次运行最多抽样二十个第一页，并有单次成本上限——抽样是这个免费工具最贵的一步。被拦下的清单会点名预算没轮到的每一个词，清单下的按钮会把它们填入种子、跑一轮更窄的地图。种子是用来牵引下一轮候选词生成的；核价和第一页闸口仍会像对待其他候选词一样判它们。",
      },
      {
        question: "地图检测 AI Overview 吗？",
        answer:
          "它记录数据源观测到的事实：抽样的第一页上有 AI Overview 时，那一行会标出来，CSV 导出里也带同一列。破折号表示数据源没有报告那一页的元素构成——这和「没有 AI Overview」不是一回事。地图不建模 AI Overview 会吸走多少流量——把它的存在当成动笔之前先打开那一页的理由。",
      },
      {
        question: "搜索量是全球的吗？",
        answer:
          "不是。运行前你要先选定一个市场和一种语言，所有搜索量都按这一组合核价——同一个词在不同国家的需求量可以完全不同。市场列表刻意很短：上面的每一项都真实跑通过爬取、提示词和数据源。",
      },
      {
        question: "为什么有的站跑完几乎什么都没有？",
        answer:
          "因为就那个站点和那个市场而言，公开数据目前撑不起一份关键词计划。我们测过的站里大约四分之一是这个结果，把表格凑满才是不诚实的答案。",
      },
      {
        question: "要跑多久？",
        answer:
          "读站点大约二十秒，然后大约两分钟用于核价，以及对通过的词逐个打开第一页。",
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
