// @input  -- locale
// @output -- the long-form sections of /tools/competitor-keyword-gap
// @pos    -- public copy for this page only; every claim here is one the engine keeps
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * Long-form copy for the Competitor Keyword Gap page.
 *
 * Constraints this copy is written under, all of them enforced elsewhere in
 * the codebase and re-asserted by the sibling test:
 *
 * 1. No vendor name. The result surface is swept for provider names and the
 *    marketing page uses the same vocabulary — "third-party keyword source",
 *    "provider estimate" — so the two never disagree about what the reader is
 *    looking at.
 * 2. The pre-screen band is never described as winnability. It is an estimate
 *    or a text heuristic shown per row; it does not order the table, does not
 *    change the Search Console-derived next step, and removes nothing.
 * 3. A missing Search Console row is "not observed in this sample", never zero
 *    impressions, and a failed competitor read is never "this competitor has
 *    no keywords".
 * 4. Nothing here promises a price, a refresh, or a saved history. The tool is
 *    a manual snapshot with no persistence, and the credit contract for it has
 *    not been defined.
 */

import type { ToolArticle } from "./tool-article-shape.ts";

const EN: ToolArticle = {
  exampleHeading: "What one gap row actually contains",
  example: [
    {
      heading: "The keyword, and who holds it",
      body: "One row per normalized keyword across every competitor you entered, carrying each competitor domain that was observed ranking for it, that competitor's position, and a link to the page it ranks with. Repeated keywords merge into one row; no observed rank is dropped in the merge.",
    },
    {
      heading: "Provider estimates, kept as estimates",
      body: "Monthly search volume, cost-per-click, difficulty and intent arrive from a third-party keyword source in three distinct states: a measured value, an explicit zero, or no data at all. The third stays blank in the table and in the export. A zero nobody measured is a lie with decimals.",
    },
    {
      heading: "Your own status, from your own data",
      body: "With a Search Console property connected, the row shows whether you are already ranking, have impressions, were not observed in this run's sample, or could not be read — for this keyword as an exact query, over a 28-day window that ends three days behind today.",
    },
    {
      heading: "A pre-screen band, on its own axis",
      body: "A second, orthogonal label: check the SERP first, higher difficulty or page two, not banded, a head term to defer, or brand and navigational to defer. Each band names the single check that decided it and whether that check was a provider estimate or this tool's own text rule.",
    },
    {
      heading: "One recommended action, decided only by your Search Console evidence",
      body: "Optimize the page already ranking, review the page carrying the query, treat the term as a content gap, or verify your own coverage first. The pre-screen band never changes this. A term you already rank for is not a gap, no matter how attractive the provider's estimates look.",
    },
  ],
  sections: [
    {
      heading: "How the sample is drawn, and what that leaves out",
      paragraphs: [
        "Each competitor is compared against your site in one market and one language, in the same organic-ranking scope. The comparison is bounded on purpose and the bound is printed on the result: the competitor must rank at position 20 or better, rows come back ordered by the estimated traffic of the competitor's own ranking page, highest first, and at most 300 rows are taken per competitor. Billing is per returned row, so the ranking filter is what keeps a five-competitor run affordable enough to be free of a credit meter.",
        "Your site is excluded at the source rather than filtered afterwards: the provider is asked for terms the competitor ranks for and yours does not appear on, which is why every row is labelled “your site was not observed in the provider ranking sample”. That phrasing is exact. It reports what the bounded sample contained, not what your site does or does not rank for in the world.",
        "Up to five competitors, entered as one comma-separated list. Domains are normalized and deduplicated before anything is spent, your own domain cannot also be submitted as a competitor, and the five-domain ceiling is enforced by the API as well as by the form. Eight markets are offered, and the language options for each are read from the provider's own catalogue rather than typed by hand — an earlier hard-coded list was both too long and too short for the same market.",
      ],
    },
    {
      heading: "Two axes that are never allowed to collapse into one",
      intro:
        "The most common way a keyword gap tool misleads is by folding an estimate and a measurement into a single verdict. Here they stay in separate columns with separate provenance, and only one of them decides what you are told to do.",
      items: [
        {
          heading: "The recommended action comes only from Search Console",
          body: "Whether you already rank, have impressions without a strong position, were not observed in this sample, or could not be read — that, and nothing else, decides the next step on the row. It is first-party evidence about your own property, and it is the only evidence in the run that measures you.",
        },
        {
          heading: "The pre-screen is an estimate, shown per row",
          body: "Difficulty at or below 30 with a competitor on page one reads as check the SERP first; anything not both of those reads as higher difficulty or page two; above 60 is a head term to defer. Each band carries the one check that produced it, and every band is labelled as a pre-screen rather than a claim about whether you can win the result.",
        },
        {
          heading: "The tool's own text rules are labelled as its own",
          body: "Rows that contain a competitor's brand token, that are shaped like a hostname, or where the competitor ranks with a domain-profile page for someone else's brand are banded by this tool's heuristics, not by the provider. The row says which of the two decided it, because a heuristic that misreads an ordinary brand-shaped product name should be visible as a heuristic.",
        },
        {
          heading: "The pre-screen never removes a row",
          body: "It does not order the table, does not filter it, and does not overrule the next step. Difficulty is a third-party model's estimate of a search result it looked at some time ago; a band that deleted rows would be an unverified threshold performing an irreversible cut on your keyword plan.",
        },
      ],
      table: {
        label:
          "Example rows · invented numbers to show the shape, not a live run",
        invented: true,
        columns: [
          "Keyword",
          "Volume (est.)",
          "Competitor coverage",
          "Your status",
          "Opportunity signals",
          "Recommended action",
        ],
        rows: [
          [
            "travel espresso kit",
            "1,300 · KD 12",
            "2 of 3 · best #6",
            "Not in sample",
            "Check SERP first · AI Overview, source snapshot 2026-08-04",
            "Review as a content gap",
          ],
          [
            "espresso ratio calculator",
            "590 · KD 8",
            "3 of 3 · best #3",
            "Has impressions · avg position 24.6 · 64 impressions",
            "Check SERP first · competitor page est. 900/mo",
            "Review /guides/ratio",
          ],
          [
            "manual espresso maker cleaning",
            "320 · —",
            "1 of 3 · best #14",
            "Already ranking · avg position 6.2",
            "Not banded · provider reported no KD or volume",
            "Optimize /guides/cleaning",
          ],
          [
            "beanpress pro",
            "210 · KD 41",
            "1 of 3 · best #2",
            "GSC not read",
            "Brand or navigational, defer · tool rule",
            "Verify your own coverage",
          ],
        ],
      },
    },
    {
      heading: "Your Search Console layer, and the number it is not",
      paragraphs: [
        "The overlay reads your selected property for the same keywords as exact queries, over a 28-day window that ends three days behind today, and reports four states: already ranking (an average position inside the top ten on at least ten impressions), has impressions, not observed in this run's sample, or the sample could not be read. Where a page can be attributed, the page URL and its own impressions and average position appear beside it.",
        "That number will usually be smaller than the one you get by typing the keyword into Search Console's own interface, and the difference is not an error. The console's query filter defaults to “contains”, which sums every query containing the phrase; this tool asks about the exact query and nothing else. Two figures that differ by an order of magnitude are two different questions, and the row says which one it answered.",
        "A query missing from the overlay is reported as not observed in this sample. Search Console anonymizes low-volume queries and a bounded read can be truncated, so absence is not evidence of zero exposure — and when the read is truncated the run says so rather than letting a shortened sample read as a complete one.",
        "The Search Console half is also checked before any paid work starts. If the session cannot read the selected property, if the property does not cover the domain you entered, if the authorization has expired, or if the shared hourly read allowance is exhausted, the whole run is refused with a named reason and a button to run again without the overlay. Being charged for a run and handed a report with a silently empty overlay is the outcome that preflight exists to prevent.",
      ],
    },
    {
      heading: "What one run refuses to be",
      items: [
        {
          heading: "It is not a monitor",
          body: "The analysis runs when you submit the form and at no other time. There is no scheduled refresh, no saved report history, and no “new this week” — the tool is deliberately stateless, so it has no previous run to compare against and does not display a placeholder pretending otherwise. The capture time stays on the result.",
        },
        {
          heading: "An empty result is not a verdict",
          body: "If no competitor returned a usable sample, the run says nothing was read and nothing was ruled out. One failed domain makes the whole run partial and is reported as unavailable with its reason code — never as a competitor that has no keywords.",
        },
        {
          heading: "Feature marks are dated snapshots",
          body: "AI Overview and other SERP feature marks come from the keyword source's stored snapshot and carry its date. They are not a live observation made by this run, and a snapshot taken weeks ago is presented with its age visible.",
        },
        {
          heading: "Competitor outcomes are unavailable",
          body: "The traffic figure beside a competitor's ranking page is a third-party estimate of that page, not measured traffic and not revenue. Rankings and estimates do not establish what a competitor earns from a term.",
        },
        {
          heading: "Difficulty is not permission",
          body: "A difficulty score is one model's summary of a result page it looked at previously. The row keeps the competitor's actual ranking page and a link to it, because opening page one yourself is still the only way to see what is holding those positions.",
        },
        {
          heading: "There is no credit claim on this page",
          body: "This tool does not display or promise a fixed credit charge. Any future price has to be defined for this specific tool before the interface states it.",
        },
      ],
    },
    {
      heading: "The export, and what it deliberately leaves out",
      paragraphs: [
        "The download is a keyword import sheet, not an audit trail: nine columns with the keyword first, up to 150 rows, cut by estimated monthly search volume across the merged set rather than a slice per competitor. Column ids are stable English field names so the file can be diffed against an older export and mapped by a keyword importer whose fields do not change with your interface language.",
        "Values that were never measured stay empty. Cost-per-click is the only column rounded at all — to four decimal places, and never rounded down to zero from a positive value — because every other number is carried through exactly as the provider gave it. Cells beginning with a formula character are neutralized before writing, since keywords are arbitrary text from a third party and a spreadsheet treats some of that text as executable.",
        "Two things are outside the file by design, and both are on the page instead: the capture date lives in the filename, and the file does not record which competitor read failed. When a competitor was unavailable, the note beside the export button says so — read that competitor's absence from a row as unknown rather than as an absence of ranking.",
      ],
    },
  ],
  relatedToolsHeading: "Tools that continue the analysis",
  relatedTools: [
    {
      label: "Daily Search Briefing",
      href: "/tools/daily-search-briefing",
      description:
        "What changed on your own property since yesterday, from the same Search Console grant.",
    },
    {
      label: "Low Competition Keyword Finder",
      href: "/tools/low-competition-keywords",
      description:
        "Generates candidates from your own site instead of from a competitor list, and opens page one for each.",
    },
    {
      label: "GSC Opportunity Finder",
      href: "/tools/seo-quick-wins",
      description:
        "For terms you already rank for: where your clicks trail your own CTR curve.",
    },
    {
      label: "On-Page SEO Checker",
      href: "/tools/on-page-seo-check",
      description:
        "Check what an existing page's public HTML supports before rewriting it for a new term.",
    },
  ],
  relatedReadingHeading: "Further reading",
  relatedReading: [
    {
      label: "Programmatic SEO at scale",
      href: "/blog/programmatic-seo-at-scale",
      description: "When a keyword set justifies a template, and when it does not.",
    },
    {
      label: "What a bounded internal link crawl proves",
      href: "/blog/bounded-internal-link-crawl",
      description: "Reading a bounded sample without overstating its coverage.",
    },
    {
      label: "What a public SEO audit can and cannot see",
      href: "/blog/public-seo-audit-boundaries",
      description: "Where third-party estimates stop and first-party data begins.",
    },
  ],
};

const ZH: ToolArticle = {
  exampleHeading: "一行差距词里到底装了什么",
  example: [
    {
      heading: "关键词，以及谁占着它",
      body: "跨你填入的全部竞品，每个标准化关键词一行，带上每个被观测到在为它排名的竞品域名、该竞品的排位，以及它用哪个页面在排的链接。重复关键词合并成一行；合并过程不丢弃任何一个已观测到的排名。",
    },
    {
      heading: "数据源估算，就当估算用",
      body: "月搜索量、单次点击成本、难度与意图来自第三方关键词数据源，且只有三种状态：有实测值、明确为零、完全没有数据。第三种在表格里和导出文件里都保持空白。一个没人测过的零，是带小数点的谎言。",
    },
    {
      heading: "你自己的状态，来自你自己的数据",
      body: "连接 Search Console 资源后，这一行会显示你是已经在排、有曝光、本次样本未观测到，还是读取失败——口径是把这个关键词当作精确查询，窗口为截止到三天前的 28 天。",
    },
    {
      heading: "一个预筛档位，走它自己的轴",
      body: "第二条正交标签：先查 SERP、难度更高或在第二页、未分档、头部词延后、品牌或导航词延后。每个档位都会写明是哪一项检查决定的，以及那项检查是数据源估算还是本工具自己的文本规则。",
    },
    {
      heading: "一条推荐动作，只由你的 Search Console 证据决定",
      body: "优化已经在排的页面、查看承接该查询词的页面、把这个词当内容缺口处理，或先核实自己的覆盖情况。预筛档位永远不会改变这一栏。一个你已经在排的词不是缺口，无论数据源的估算看起来多诱人。",
    },
  ],
  sections: [
    {
      heading: "样本是怎么取的，以及它取不到什么",
      paragraphs: [
        "每个竞品都在同一个市场、同一种语言、同一自然排名范围内与你的站点比较。这次比较是刻意有边界的，边界也印在结果上：竞品必须排在第 20 位或更好；返回的行按该竞品自己排名页面的预估流量从高到低排序；每个竞品最多取 300 行。计费按返回行数计算，所以正是这道排名过滤，让一次五竞品的运行便宜到不需要挂一个积分表。",
        "你的站点是在数据源那一层被排除的，而不是事后过滤：请求本身问的就是「竞品在排、而你没有出现」的词，所以每一行都标注「本站未出现在数据源排名样本中」。这个措辞是精确的。它陈述的是这份有边界的样本里有什么，而不是你的站点在真实世界里排不排某个词。",
        "最多五个竞品，用一个逗号分隔的清单一次填完。域名在任何花费发生之前就完成归一化和去重；你自己的域名不能同时作为竞品提交；五个的上限在表单和 API 两侧共同执行。提供 8 个市场，每个市场的语言选项从数据源自己的目录读取，而不是手写——早先那份写死的清单对同一个市场既列多了也列少了。",
      ],
    },
    {
      heading: "两条永远不允许合并成一条的轴",
      intro:
        "关键词差距类工具最常见的误导方式，就是把一个估算和一次测量折叠成同一个结论。这里它们分列在不同的列、带着各自的来源，而且只有其中一条决定你被告知要做什么。",
      items: [
        {
          heading: "推荐动作只来自 Search Console",
          body: "你是已经在排、有曝光但位置不强、本次样本未观测到，还是读取失败——只有这一项决定行上的下一步。它是关于你自己资源的第一方证据，也是整次运行中唯一一份真正在测量你的证据。",
        },
        {
          heading: "预筛是估算，逐行展示",
          body: "难度 ≤30 且有竞品在第一页，读作「先查 SERP」；不同时满足这两条的读作「难度更高或在第二页」；高于 60 是要延后的头部词。每个档位都带着产生它的那一项检查，并且每个档位都被标注为预筛，而不是关于你能不能赢下这个结果的断言。",
        },
        {
          heading: "本工具自己的文本规则会标成自己的",
          body: "含有竞品品牌词、形状像主机名、或竞品是用别家品牌的域名档案页在排的行，是由本工具的启发式规则分档的，不是数据源。行上会写明是哪一边决定的——因为一条会把普通的品牌型产品名读错的启发式，理应作为启发式被看见。",
        },
        {
          heading: "预筛永远不会删掉任何一行",
          body: "它不排序、不过滤，也不推翻下一步。难度是第三方模型对它某个时间点看过的结果页所做的估算；一个会删行的档位，等于让一条未经回测的阈值对你的关键词计划执行不可逆的剔除。",
        },
      ],
      table: {
        label: "示例行 · 数字为虚构，仅示意形状，非真实运行结果",
        invented: true,
        columns: [
          "关键词",
          "搜索量（估算）",
          "竞品覆盖",
          "你的状态",
          "机会信号",
          "推荐动作",
        ],
        rows: [
          [
            "travel espresso kit",
            "1,300 · KD 12",
            "3 个中 2 个 · 最好 #6",
            "样本未观测到",
            "先查 SERP · AI Overview，来源快照 2026-08-04",
            "作为内容缺口处理",
          ],
          [
            "espresso ratio calculator",
            "590 · KD 8",
            "3 个中 3 个 · 最好 #3",
            "有曝光 · 均位 24.6 · 曝光 64",
            "先查 SERP · 竞品页面预估 900/月",
            "查看 /guides/ratio",
          ],
          [
            "manual espresso maker cleaning",
            "320 · —",
            "3 个中 1 个 · 最好 #14",
            "已在排 · 均位 6.2",
            "未分档 · 数据源未返回 KD 或搜索量",
            "优化 /guides/cleaning",
          ],
          [
            "beanpress pro",
            "210 · KD 41",
            "3 个中 1 个 · 最好 #2",
            "GSC 未读取",
            "品牌或导航词，延后 · 工具规则",
            "先核实自己的覆盖",
          ],
        ],
      },
    },
    {
      heading: "你的 Search Console 层，以及它不是哪个数字",
      paragraphs: [
        "叠加层会把这些关键词当作精确查询去读你选中的资源，窗口为截止到三天前的 28 天，并报告四种状态：已经在排（均位在前十且至少 10 次曝光）、有曝光、本次运行样本未观测到、样本读不到。能够归因到页面时，页面 URL 及其自身的曝光与均位会一并显示在旁边。",
        "这个数字通常会小于你直接在 Search Console 界面里输入这个词看到的数字，而这个差异不是错误。控制台的查询筛选默认是「包含」，它把所有含该短语的查询加总；本工具问的是精确查询，仅此而已。相差一个数量级的两个数字，是两个不同的问题，行上会写明它回答的是哪一个。",
        "叠加层里没有的查询词，会被报告为「本次样本未观测到」。Search Console 会匿名化低量查询，有边界的读取也可能被截断，所以缺失不是零曝光的证据——读取被截断时本次运行会明说，而不是让一份被缩短的样本读起来像完整样本。",
        "Search Console 这一半也会在任何付费动作开始之前先做检查。如果会话读不到所选资源、资源不覆盖你填的域名、授权已经失效，或者共享的每小时读取额度已用尽，整次运行会带着具名理由被拒绝，并给出「不叠加 GSC 重新运行」的按钮。付完钱、拿到一份叠加层悄悄为空的报告——这正是这道前置检查要挡住的结局。",
      ],
    },
    {
      heading: "一次运行拒绝成为什么",
      items: [
        {
          heading: "它不是监控",
          body: "只有你提交表单时才会运行，其余任何时刻都不会。没有定时刷新、没有保存的报告历史，也没有「本周新增」——这个工具刻意无状态，因此没有上一次运行可比，也不会放一个假装有的占位符。本次采集时间保留在结果上。",
        },
        {
          heading: "空结果不是结论",
          body: "如果没有任何竞品返回可用样本，本次运行会说什么都没读到、也什么都没排除。一个域名失败就会让整次运行成为「部分」，并带着原因码报告为不可用——绝不会写成这个竞品没有关键词。",
        },
        {
          heading: "特性标记是带日期的快照",
          body: "AI Overview 和其他 SERP 特性标记来自关键词数据源存储的快照，并带着它自己的日期。它们不是本次运行做出的实时观测；几周前拍下的快照会连同它的年龄一起呈现。",
        },
        {
          heading: "竞品的实际结果不可得",
          body: "竞品排名页面旁边那个流量数字，是第三方对那个页面的预估，不是实测流量，也不是收入。排名和估算都不能确立一个竞品从某个词上挣到了什么。",
        },
        {
          heading: "难度不是通行证",
          body: "难度分是某个模型对它此前看过的一张结果页的概括。行上保留着竞品真实的排名页面和它的链接——因为要看清那些位置被什么撑着，仍然只有你自己打开第一页这一条路。",
        },
        {
          heading: "这个页面上没有积分承诺",
          body: "本工具不展示、也不承诺固定的积分价格。未来只有在为本工具自己定义了价格之后，界面才会声称会扣费。",
        },
      ],
    },
    {
      heading: "导出文件，以及它刻意不带的东西",
      paragraphs: [
        "下载的是一份关键词导入表，不是审计台账：九列、关键词在第一列，最多 150 行，按合并后全表的预估月搜索量取，而不是每个竞品切一段。列名是稳定的英文字段 id，这样文件既能和更早的导出做 diff，也能被关键词导入工具映射——而不会因为你的界面语言换了一种，表头就跟着变。",
        "从未被测量到的值保持为空。单次点击成本是唯一被舍入的一列——保留四位小数，且正值绝不会被舍成零——因为其余每个数字都原样带出数据源给的值。以公式字符开头的单元格在写入前会被中和：关键词是来自第三方的任意文本，而表格软件会把其中一部分文本当作可执行内容。",
        "有两样东西是有意留在文件之外、放在页面上的：采集日期在文件名里，而文件不记录哪个竞品读取失败了。有竞品不可用时，导出按钮旁的说明会写明这一点——把那个竞品在某一行上的缺席读作「未知」，而不是「没有排名」。",
      ],
    },
  ],
  relatedToolsHeading: "把分析继续下去的工具",
  relatedTools: [
    {
      label: "每日搜索简报",
      href: "/tools/daily-search-briefing",
      description: "用同一份 Search Console 授权，看你自己站点从昨天到今天变了什么。",
    },
    {
      label: "低竞争关键词发现",
      href: "/tools/low-competition-keywords",
      description:
        "从你自己的站点而不是竞品清单生成候选词，并为每个词打开第一页。",
    },
    {
      label: "GSC 机会发现器",
      href: "/tools/seo-quick-wins",
      description: "针对你已经在排的词：点击在哪里落后于你自己的 CTR 曲线。",
    },
    {
      label: "On-Page SEO 检查器",
      href: "/tools/on-page-seo-check",
      description: "在为一个新词重写页面之前，先看清现有页面的公开 HTML 支持了什么。",
    },
  ],
  relatedReadingHeading: "延伸阅读",
  relatedReading: [
    {
      label: "规模化程序化 SEO",
      href: "/blog/programmatic-seo-at-scale",
      description: "一组关键词什么时候撑得起一个模板，什么时候撑不起。",
    },
    {
      label: "受限内链抓取到底能证明什么",
      href: "/blog/bounded-internal-link-crawl",
      description: "读一份有边界的样本，而不夸大它的覆盖范围。",
    },
    {
      label: "公开 SEO 审计看得到和看不到什么",
      href: "/blog/public-seo-audit-boundaries",
      description: "第三方估算到哪里为止，第一方数据从哪里开始。",
    },
  ],
};

export function getCompetitorKeywordGapArticle(locale: string): ToolArticle {
  return locale === "zh" ? ZH : EN;
}
