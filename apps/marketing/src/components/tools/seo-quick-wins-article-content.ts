// @input  -- locale
// @output -- the long-form sections of /tools/seo-quick-wins
// @pos    -- public copy for this page only; every claim here is one the engine keeps
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * Long-form copy for the SEO Quick Wins page.
 *
 * Written against `docs/plans/2026-08-03-p0-1-landing-copy-v2.md` with three
 * corrections that document's own status block called for, made here because a
 * marketing page that describes a different product than the one behind the
 * button is the failure mode this whole tool was built to avoid:
 *
 * 1. Rows are QUERIES. The engine reads `dimensions: ["query"]` and nothing
 *    else, so every sentence that said "page" now says "search query". A
 *    reader who expects a page list and gets a query list will conclude the
 *    tool is broken.
 * 2. "Almost on page one" is gone. It was a second headline pattern that was
 *    never implemented, and the real-data evaluation found zero candidates for
 *    it on the site it was designed against.
 * 3. The impression floor is a flat 100, not "above your site's median". The
 *    draft copy described a relative threshold the engine does not have.
 *
 * The figures in the case study are the 2026-07-31 evaluation's real numbers
 * for `sc-domain:astrologywiki.com`, recomputed leave-one-out so the page
 * states the comparison the engine actually makes rather than the raw band
 * average. The site is unnamed here and already named in a published case
 * study on this same blog, so nothing new is disclosed.
 */

export interface ArticleItem {
  readonly heading: string;
  readonly body: string;
  /** Dropped when this deployment cannot produce Title/Meta drafts. */
  readonly requiresDrafts?: boolean;
}

export interface ArticleSection {
  readonly heading: string;
  readonly intro?: string;
  readonly items?: readonly ArticleItem[];
  readonly paragraphs?: readonly string[];
}

export interface ArticleLink {
  readonly label: string;
  readonly href: string;
  readonly description: string;
}

export interface QuickWinsArticle {
  readonly exampleHeading: string;
  readonly example: readonly ArticleItem[];
  readonly sections: readonly ArticleSection[];
  readonly relatedToolsHeading: string;
  readonly relatedTools: readonly ArticleLink[];
  readonly relatedReadingHeading: string;
  readonly relatedReading: readonly ArticleLink[];
}

const EN: QuickWinsArticle = {
  exampleHeading: "What one finding looks like",
  example: [
    {
      heading: "Observation",
      body: "The query “lamine yamal zodiac sign”, average position 8.9, 3,439 impressions, 3 clicks — a click-through rate of 0.09% over 28 days.",
    },
    {
      heading: "Compared against your own site",
      body: "Queries on this site at positions 8–11 earn 0.51% on average across 451 queries and 16,885 impressions. With this query removed from its own baseline, the rest of its band earns 0.62%. So the site's own curve predicts about 21 clicks for those 3,439 impressions, and 3 arrived: a gap of about 18 clicks over the same 28 days.",
    },
    {
      heading: "What we do not claim",
      body: "We cannot tell you why. A gap this size can come from a title that does not match the query, from searchers wanting something this page was never meant to answer, or from Google answering the question inside the results page so nobody needs to click. Those need different fixes, and one of them is not fixable at all.",
    },
    {
      heading: "What the report tells you to do about it",
      body: "Not to rewrite this one on its own. Its whole band earns 0.51%, so every query in there falls short of baseline for the same structural reason, and treating this row as its own problem turns one fact into 451. The report says so in as many words and points at the band rather than the title. It also sends this property to the Pages report, because 445 of its 451 queries never cleared the impression floor — per-query is the wrong resolution for a site whose demand is spread that thin.",
    },
    {
      heading: "What you can take away",
      body: "A short list of what to do next, each entry naming the rows that put it there, over the full evidence table — every query with its observed rate, your site's rate at that position, the gap between them, the tail probability, and which checking path the row is on — sortable by any column and exportable as CSV.",
    },
  ],
  sections: [
    {
      heading: "What this finds, and how it ranks it",
      items: [
        {
          heading: "High impressions, barely any clicks",
          body: "Any search query with at least 100 impressions, sitting in a position band your site has enough data to measure, whose click-through rate falls below what your own site earns in that band. The 100 is a flat floor, not a share of your traffic: below it, one click either way moves the rate enough to change the answer.",
        },
        {
          heading: "Improve organic CTR without touching rankings",
          body: "When the cause is how your result is written, the feedback loop is days rather than months. When it is not, no rewrite will help — which is why this page shows you the evidence rather than a verdict.",
        },
        {
          heading: "Measured against your own site, not an industry table",
          body: "Published CTR benchmarks say roughly 28% at position 1 and 2% at position 10. We tested those on a real site and found positions 4–10 earning a tenth of that, while 11–16 earned three times what 4–10 did. Industry averages describe a plain blue-link results page. Your site may not have one. So we build the curve from your data.",
        },
        {
          heading: "Easy SEO wins, ranked by the size of the gap",
          body: "Sorted by what your site's own curve predicts minus the clicks observed, largest shortfall first. Rows that beat your own curve are kept deliberately, with a negative gap. That is a measured difference between two observed numbers, not a forecast of what you would recover.",
        },
        {
          heading: "A draft you can see the source of",
          body: "Where your own site has a comparable page earning a clearly higher click-through rate at a similar position, we name that page and draft a title on the same pattern. No comparable page, no draft — we do not fall back to a generic template. At most five drafts per run, on the largest gaps.",
          requiresDrafts: true,
        },
        {
          heading: "The whole table, out of the tab",
          body: "Nothing is stored, so the export is the copy that survives. It carries the same rows, the same measured window and the same blanks — a value we could not compute stays an empty cell rather than becoming a zero.",
        },
      ],
    },
    {
      heading: "Who this is for",
      paragraphs: [
        "Sites that already rank for something. If you have queries landing in positions 4–20 with real impressions behind them, there is usually a measurable gap sitting in them. If most of your pages have no impressions at all, this is not your problem yet — start with the Free SEO Audit.",
      ],
    },
    {
      heading: "The query that made us build this — and what it taught us",
      paragraphs: [
        "One of our own sites had a query sitting at position 8.9, pulling 3,439 impressions over 28 days and converting three of them into clicks. A 0.09% click-through rate. Nothing was broken: the page ranked, it was indexed, it loaded fine. No audit tool we ran flagged it, because by every technical measure the page was healthy.",
        "We spent an evening on it and concluded the title was weak. We were wrong. The query was “lamine yamal zodiac sign” — and Google answers that inside the results page. Nobody needed to click. No title rewrite was ever going to move it.",
        "That is why this tool shows you the gap and names what it cannot explain, instead of handing you a diagnosis. Finding the gap is the part software does well. Deciding what it means still needs you to read a few of the actual queries.",
      ],
    },
    {
      heading: "How this compares",
      items: [
        {
          heading: "Google Search Console for beginners — where this fits",
          body: "Search Console gives you the raw numbers. It will not tell you which queries are underperforming relative to what your own site achieves at that position, or how big each gap is. That comparison is the whole job of this tool.",
        },
        {
          heading: "How this differs from Traffic Drop Diagnosis",
          body: "Same underlying data, different question. Use this one to find gaps in what you already have. Use Traffic Drop Diagnosis when something has already fallen and you need to know when and by how much.",
        },
      ],
    },
    {
      heading: "How we decide a click-through rate is too low",
      items: [
        {
          heading: "Your site's curve, built from your own 28 days",
          body: "We group your non-brand queries by average position and compute the impression-weighted click-through rate for each band. A query is compared against its own band on your site, and it is excluded from the band it is measured against — so nothing can set its own benchmark.",
        },
        {
          heading: "When we cannot build the curve",
          body: "A position band needs at least 500 impressions and 5 distinct queries before it can serve as a baseline. Bands below that produce no findings, and we tell you which ones and why. On small sites this can mean most bands — we would rather say so than compute a number from four queries.",
        },
        {
          heading: "What counts as enough impressions to measure",
          body: "A flat floor of 100 impressions per query. These thresholds are absolute, not relative to your site. On a small site that honestly leaves single digits, and we list which queries were excluded and for which reason rather than padding the table.",
        },
      ],
    },
    {
      heading: "What this will not tell you",
      items: [
        {
          heading: "Why the click-through rate is low",
          body: "This is the big one. A gap can mean your title is weak, or that searchers wanted something else, or that Google answered the query in the results page. We measure the gap; we do not detect which. Read a few of the actual queries before rewriting anything.",
        },
        {
          heading: "Whether an AI Overview or featured snippet is taking the clicks",
          body: "We do not detect SERP features. Search Console does not expose them in a way we can line up with the rest of this data, and we would rather leave the question open than guess.",
        },
        {
          heading: "Anything about queries Google hides",
          body: "Search Console withholds low-volume queries for privacy. On the site we tested, 46% of impressions and 64% of clicks were not in the query report at all. Everything here is computed on what Google returns, which is not everything — and every run tells you how large that missing share was for your property.",
        },
        {
          heading: "Which page a query belongs to",
          body: "The report reads one dimension, queries, so a row is a search term rather than a URL. Grouping a query by page is a second, less complete read that Google drops rows from, so that split is not part of this table.",
        },
        {
          heading: "What happened after you changed something",
          body: "We do not store your results, so there is nothing to come back to. Export your current numbers before you edit, then re-run this in a few weeks and compare — Search Console keeps the history even though we do not.",
        },
      ],
    },
  ],
  relatedToolsHeading: "Related tools",
  relatedTools: [
    {
      label: "Free SEO Audit",
      href: "/tools/seo-audit",
      description: "No login, works on any public URL.",
    },
    {
      label: "Internal Link Audit",
      href: "/tools/internal-link-audit",
      description: "For pages Google can barely reach.",
    },
    {
      label: "Traffic Drop Diagnosis",
      href: "/tools/traffic-drop-diagnosis",
      description: "When traffic has already fallen.",
    },
  ],
  relatedReadingHeading: "Related reading",
  relatedReading: [
    {
      label: "From 0 to 5,000 users: the astrologywiki.com case study",
      href: "/blog/astrologywiki-case-study",
      description: "The site the numbers on this page come from.",
    },
    {
      label: "What a public SEO audit can and cannot see",
      href: "/blog/public-seo-audit-boundaries",
      description: "Where first-party data stops being optional.",
    },
  ],
};

const ZH: QuickWinsArticle = {
  exampleHeading: "一条结论长什么样",
  example: [
    {
      heading: "观测",
      body: "查询词「lamine yamal zodiac sign」，平均位置 8.9，28 天内 3,439 次曝光、3 次点击——点击率 0.09%。",
    },
    {
      heading: "与你自己的网站对比",
      body: "这个站在位置 8–11 上的查询词平均点击率是 0.51%，样本为 451 条查询词、16,885 次曝光。把这条查询词从它自己的基准里排除之后，同段其余部分的点击率是 0.62%。于是这个站自己的曲线预计这 3,439 次曝光应该带来约 21 次点击，实际到了 3 次：同样 28 天里，缺口约 18 次点击。",
    },
    {
      heading: "我们不声称的部分",
      body: "我们说不出原因。这么大的缺口可能来自标题没有对上这条查询，可能来自搜索者想要的本来就不是这个页面能回答的东西，也可能来自 Google 在结果页里直接给出了答案、没人需要点击。这三种要用完全不同的办法处理，而其中一种根本处理不了。",
    },
    {
      heading: "报告让你拿它怎么办",
      body: "不要单独去改这一条。它整个位置段的点击率是 0.51%，段里每条查询词低于基准都是同一个结构性原因，把这一行当成它自己的问题，就是把一件事变成 451 件。报告会直接这么说，并把你指向这个段而不是那条标题。它还会把这个站点指向「网页」报告——451 条查询词里有 445 条没过曝光门槛，对需求摊得这么薄的站点来说，逐条查询词本来就是错的分辨率。",
    },
    {
      heading: "你能带走什么",
      body: "一份很短的「接下来做什么」，每一条都会点名是哪几行把它放进来的；再加上完整的证据表——每条查询词的实测点击率、你自己网站在该位置的点击率、两者的缺口、尾部概率，以及这一行属于哪条检查路径。任意一列可排序，整表可导出 CSV。",
    },
  ],
  sections: [
    {
      heading: "它找什么，又按什么排序",
      items: [
        {
          heading: "曝光很高，点击寥寥",
          body: "任何曝光不少于 100 次、且落在你的网站有足够数据可测的位置段里、点击率低于你自己网站在该段表现的查询词。这 100 是一个绝对门槛，不是你流量的某个比例：低于它，一次点击的进出就足以改变结论。",
        },
        {
          heading: "不动排名也能提升自然点击率",
          body: "如果成因是你的结果怎么写，反馈周期是几天而不是几个月。如果不是，改写没有用——这也正是本页给你证据而不是给你结论的原因。",
        },
        {
          heading: "对照的是你自己的网站，不是行业平均表",
          body: "公开的 CTR 基准表说位置 1 约 28%、位置 10 约 2%。我们拿真实站点实测过：位置 4–10 只拿到其中的十分之一，而 11–16 反而是 4–10 的三倍。行业平均描述的是一个普通蓝链结果页，而你的网站未必是。所以我们用你的数据建曲线。",
        },
        {
          heading: "按缺口大小排的「容易拿的分」",
          body: "按「你自己曲线的预期点击减去实际点击」排序，缺口最大的在前。跑赢自己曲线的行会被特意保留，缺口为负。这是两个实测数字之间的差值，不是「你能拿回多少」的预测。",
        },
        {
          heading: "看得见出处的草稿",
          body: "如果你自己的网站上有一个页面，在相近位置拿到明显更高的点击率，我们会把那个页面具名指出来，并照同样的措辞模式起草一个标题。找不到合格对照页就不出草稿——我们不会退回到通用模板。每次运行最多五条，只给缺口最大的那几条。",
          requiresDrafts: true,
        },
        {
          heading: "整张表可以带出这个标签页",
          body: "我们不保存任何结果，所以导出的文件就是唯一能留下的副本。文件里是同样的行、同样的统计区间、同样的空白——算不出来的值在文件里也是空的，不会变成 0。",
        },
      ],
    },
    {
      heading: "它适合谁",
      paragraphs: [
        "适合已经在为某些词排名的网站。如果你有查询词落在位置 4–20、背后有真实曝光，那里通常就压着一个可测量的缺口。如果你的大多数页面根本没有曝光，这还不是你现在的问题——先从免费 SEO 审计开始。",
      ],
    },
    {
      heading: "促成这个工具的那条查询词，以及它教给我们的事",
      paragraphs: [
        "我们自己的一个站上有一条查询词停在位置 8.9，28 天里拿到 3,439 次曝光，其中 3 次变成点击。点击率 0.09%。没有任何东西是坏的：页面有排名、已收录、加载正常。我们跑过的审计工具没有一个报警，因为按每一项技术指标看，这个页面都很健康。",
        "我们花了一个晚上研究它，结论是标题不够好。我们错了。那条查询是「lamine yamal zodiac sign」——Google 在结果页里就把答案给了。没人需要点击。任何标题改写都不可能撬动它。",
        "所以这个工具给你缺口，并把它解释不了的部分说清楚，而不是递给你一个诊断。找出缺口是软件擅长的部分；判断它意味着什么，仍然需要你自己去读几条真实的查询词。",
      ],
    },
    {
      heading: "和别的东西怎么比",
      items: [
        {
          heading: "Search Console 入门——本工具在其中的位置",
          body: "Search Console 给你原始数字。它不会告诉你哪些查询词相对于你自己网站在该位置的水平表现不足，也不会告诉你每个缺口有多大。这个对比就是本工具的全部工作。",
        },
        {
          heading: "和「流量下跌诊断」的区别",
          body: "同一份底层数据，问的是不同的问题。想在已有的东西里找缺口，用这个；东西已经掉了、你需要知道什么时候掉的、掉了多少，用流量下跌诊断。",
        },
      ],
    },
    {
      heading: "我们凭什么判断点击率偏低",
      items: [
        {
          heading: "用你自己 28 天数据建的曲线",
          body: "我们把你的非品牌查询词按平均位置分段，逐段算曝光加权的点击率。每条查询词只和它自己所在的段对比，而且会先把它自己从这个段里排除出去——没有任何一条能给自己定基准。",
        },
        {
          heading: "曲线建不起来的时候",
          body: "一个位置段要能当基准，至少需要 500 次曝光和 5 条不同的查询词。达不到的段不产生任何结论，而且我们会告诉你是哪些段、为什么。小站上这可能意味着大多数段都不合格——我们宁愿这么说，也不愿拿四条查询词算出一个数。",
        },
        {
          heading: "曝光多少才算够测",
          body: "每条查询词 100 次曝光的绝对门槛。这些门槛是绝对值，不随你的网站大小浮动。在小站上它诚实地只留下个位数，而我们会逐条列出哪些查询词被排除、按哪条理由，而不是把表凑满。",
        },
      ],
    },
    {
      heading: "它不会告诉你的事",
      items: [
        {
          heading: "点击率为什么低",
          body: "这是最要紧的一条。缺口可能意味着标题不好，可能意味着搜索者想要别的，也可能意味着 Google 在结果页给了答案。我们测量缺口，但不检测是哪一种。改任何东西之前，先读几条真实的查询词。",
        },
        {
          heading: "是不是 AI Overview 或精选摘要拿走了点击",
          body: "我们不检测 SERP 特性。Search Console 没有以一种能与其余数据对齐的方式提供它们，我们宁愿让这个问题悬着，也不猜。",
        },
        {
          heading: "关于 Google 隐去的那些查询词的一切",
          body: "Search Console 出于隐私会隐去低频查询词。在我们实测的那个站上，46% 的曝光和 64% 的点击根本不在查询词报告里。这里的一切都基于 Google 返回的部分，而那不是全部——每次运行都会告诉你，在你的站点属性上这个缺失份额有多大。",
        },
        {
          heading: "某条查询词属于哪个页面",
          body: "报告只读一个维度——查询词，所以每一行是搜索词而不是 URL。把查询词按页面分组是另一次读取，而且那次读取本身会被 Google 丢行，所以这个拆分不进这张表。",
        },
        {
          heading: "你改完之后发生了什么",
          body: "我们不保存你的结果，所以没有可以回来查的东西。动手之前先导出当前数字，几周后再跑一次对比——Search Console 保留了历史，即使我们不保留。",
        },
      ],
    },
  ],
  relatedToolsHeading: "相关工具",
  relatedTools: [
    {
      label: "免费 SEO 审计",
      href: "/tools/seo-audit",
      description: "无需登录，对任意公开 URL 都能跑。",
    },
    {
      label: "内链审计",
      href: "/tools/internal-link-audit",
      description: "针对 Google 几乎够不到的页面。",
    },
    {
      label: "流量下跌诊断",
      href: "/tools/traffic-drop-diagnosis",
      description: "流量已经掉下来的时候用。",
    },
  ],
  relatedReadingHeading: "延伸阅读",
  relatedReading: [
    {
      label: "从 0 到 5,000 用户：astrologywiki.com 案例",
      href: "/blog/astrologywiki-case-study",
      description: "本页数字来自的那个网站。",
    },
    {
      label: "公开 SEO 审计看得到和看不到什么",
      href: "/blog/public-seo-audit-boundaries",
      description: "第一方数据从哪里开始不再是可选项。",
    },
  ],
};

/**
 * The long-form copy, minus anything this deployment cannot deliver.
 *
 * Drafts need a model key. A deployment without one still runs the whole
 * evidence table, so the page stays correct by dropping the paragraphs that
 * describe drafts rather than by hiding the tool. Setting the key brings them
 * back on the next render, with nothing to remember to re-enable.
 */
export function getQuickWinsArticle(
  locale: string,
  options: { readonly draftsEnabled?: boolean } = {},
): QuickWinsArticle {
  const article = locale === "zh" ? ZH : EN;
  if (options.draftsEnabled !== false) return article;
  return {
    ...article,
    sections: article.sections.map((section) =>
      section.items === undefined
        ? section
        : {
            ...section,
            items: section.items.filter((i) => i.requiresDrafts !== true),
          },
    ),
  };
}
