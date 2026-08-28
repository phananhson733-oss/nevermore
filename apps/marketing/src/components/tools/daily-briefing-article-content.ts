// @input  -- locale
// @output -- the long-form sections of /tools/daily-search-briefing
// @pos    -- public copy for this page only; every claim here is one the engine keeps
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * Long-form copy for the Daily Search Briefing page.
 *
 * Every threshold quoted below is a constant in
 * `packages/public-tools/src/daily-briefing/report.ts`, and every refusal is
 * one the engine actually performs. The numbers are here rather than in vague
 * prose on purpose: this page is where a visitor forms their expectation of
 * what a run will contain, and "we surface what matters" sets an expectation
 * the engine has no way to meet or to fail.
 *
 * Three claims this copy deliberately does NOT make, because the tool does not:
 *
 * 1. Nothing here promises a ranking or traffic outcome. The engine's own
 *    action copy is barred from promising results; the page selling it is held
 *    to the same line.
 * 2. Nothing here calls a missing Search Console row a zero. Anonymization
 *    removes a large share of queries, and "not observed" is the only honest
 *    reading of an absence.
 * 3. Nothing here describes stored history, scheduled runs, or week-over-week
 *    trend reports. The briefing is recomputed per request and keeps nothing.
 */

import type { ToolArticle } from "./tool-article-shape.ts";

const EN: ToolArticle = {
  exampleHeading: "What one morning's briefing looks like",
  example: [
    {
      heading: "The window it read",
      body: "Search Console's Pacific calendar, stopping at the latest complete day — three days behind today's PT date. The briefing compares that day against a comparable earlier day, and the latest complete seven days against the seven before them. Nothing newer enters either comparison, and nothing is projected forward to fill the gap.",
    },
    {
      heading: "A change it will name",
      body: "A query holds its average position within half a place while its weekly clicks fall by both 15% and 3. Both floors are cleared, so it is reported as a click decline — explicitly not as a ranking loss, because the position evidence says the ranking did not move.",
    },
    {
      heading: "A move it refuses to promote",
      body: "A query whose average position crosses into the 1–10 band while its prior window carries only 50–99 impressions. It is listed as a provisional position move — the two provisional kinds are both position moves, never clicks — counted in its own list, and it cannot become one of the day's actions. A base that small moves this much on its own.",
    },
    {
      heading: "What it says when it finds nothing",
      body: "“No change cleared the evidence floor in this run. That is not the same as proving nothing changed.” Alongside it, the run prints how many rows each path read, how many it evaluated, and how many produced a candidate.",
    },
    {
      heading: "What you can take away",
      body: "At most three query records, at most two page records, and at most one first appearance at an average position of six or better, which is counted outside the three-action budget so a bad week can never crowd out the one lane that reports something going right. Each card carries the evidence line it was derived from and a button into the tool that can take the question further.",
    },
  ],
  sections: [
    {
      heading: "The windows, and why yesterday is not one of them",
      paragraphs: [
        "Search Console finalizes its data on a Pacific-time calendar and lags the present. The briefing takes the latest complete day it can prove is finished — three days behind the current PT date — and no comparison reads past it. A run started at nine in the morning and a run started at nine at night therefore read the same window and produce the same result, which is what makes a daily habit worth having at all.",
        "Two comparisons are built from that: the latest complete day against a comparable earlier day, and the latest complete seven days against the seven immediately before them. The seven-day pair is where every change path is evaluated. The single day exists for context, and when the required date series cannot be read the briefing says the daily reading is unavailable rather than filling the hole with the weekly number.",
        "The trend chart is the one part that deliberately runs closer to now: a single 90-day daily series ending on the current Pacific date is fetched alongside, so the chart switches between 24 hours, 7 days, 28 days and 3 months without another read, and its newest points are marked provisional because Google is still updating them. The 24-hour view is the only one drawn from hourly data, and it carries its own warning while Google is still updating it. Buckets Search Console returned nothing for stay gaps; none of them is substituted with a zero.",
      ],
    },
    {
      heading: "Daily or weekly is decided by your sample, not by you",
      intro:
        "Clicks and impressions are counts, and counts on a small base move by roughly their own square root without anything having happened. A briefing that reads day-to-day noise as news is worse than no briefing.",
      items: [
        {
          heading: "The floor is 1,000 impressions in the complete week",
          body: "Below it the briefing downgrades itself to a weekly cadence and says so on the page, with the reason attached. This is a property-level test, not a preference: the same site can be daily one month and weekly the next, and the run states which it is on that day's evidence.",
        },
        {
          heading: "A click path also has to have settled rows",
          body: "Cadence asks the three click-driven paths — the two query lanes and the page click decline — whether they actually settled any rows, not whether the report as a whole looks healthy. A property where only position paths could run is a weekly property, because an impression-weighted average position is not a click signal.",
        },
        {
          heading: "The mode is named, not implied",
          body: "A run reports itself as change detection, position observation, current-position watchlist, or unavailable. The last three exist so a property that cannot support change detection still gets an honest description of where it stands, instead of an empty page that reads like nothing happened.",
        },
        {
          heading: "Small rows stay observations",
          body: "A query whose prior window carries 50–99 impressions can appear as a provisional move. It is listed apart from the changes, cannot produce an action, and prints the impression count that kept it out.",
        },
      ],
    },
    {
      heading: "Every path a finding can arrive on",
      intro:
        "There is no hidden score. Nine paths and one standing check are evaluated independently, each against its own stated floor, and every row in the current window is accounted for as not evaluated, evaluated with no signal, or a candidate.",
      table: {
        label:
          "The evaluation paths, as implemented · thresholds are the engine's own constants",
        invented: false,
        columns: [
          "Path",
          "What the evidence must carry",
          "What makes it a finding",
        ],
        rows: [
          [
            "Click opportunity",
            "Confirmed brand terms; a non-brand query with 300+ impressions this window, inside a position band still holding 2,000+ impressions once the query itself is removed",
            "Observed clicks come in at half or less of what your own leave-one-out CTR curve predicts, with at least 5 clicks predicted",
          ],
          [
            "Stable-position click decline",
            "100+ impressions in each window and 3+ clicks in the prior one",
            "Clicks fall by both 15% and 3, while average position moves no more than 0.5",
          ],
          [
            "Move into the 1–10 band",
            "100+ impressions in each window, with the prior average position outside 10",
            "The current window sits inside 1–10 and is at least 1.5 places better",
          ],
          [
            "Slide from the actionable band",
            "The same query-and-page pair at 100+ impressions in each window, with at least one window inside the top 30",
            "That pair's average position falls by 3 or more and its clicks fall by 30% or more with it",
          ],
          [
            "First-observed query and page pair",
            "Page attribution readable in both windows; 100+ impressions now at an average position from 8 up to but not including 21",
            "The pair is absent from the prior window's visible rows",
          ],
          [
            "First seen at six or better",
            "The same conditions as the path above",
            "The pair is absent from the prior window and now averages 6 or better",
          ],
          [
            "Page impressions all but gone",
            "30+ impressions on that page in the prior window, and whether it appears now is decidable",
            "Impressions fell by 80% or more, and the drop is larger than twice the square root of the prior count",
          ],
          [
            "Page click decline",
            "100+ impressions for the page in each window and 3+ clicks in the prior one",
            "Clicks fall by both 15% and 3, and by more than twice the square root of the prior clicks",
          ],
          [
            "Page first appears in this comparison",
            "100+ impressions now, and whether the page appeared before is decidable",
            "No prior row, or a row shown zero times, with a current average position inside 30",
          ],
          [
            "Pages drawing impressions and no clicks",
            "A measured average position of 10 or better, and your site's own non-brand rate predicting at least 3 clicks for this page's impressions",
            "The page drew none. This is a standing state, not a change, and is listed as a check",
          ],
        ],
      },
      paragraphs: [
        "Two consequences of that table are worth stating rather than discovering. The first-appearance paths cover 8 up to but not including 21, and 6-or-better, so a pair first seen at an average position of exactly seven is evaluated and reported as no signal; the gap is in the specification these thresholds came from and closing it is one constant. And two of them need a confirmed brand list: the click-opportunity path and the zero-click page check both rest on your site's own non-brand rate. Without that list there is no trustworthy brand/non-brand split, so both report themselves as not evaluated instead of quietly measuring your own name.",
        "Every path also prints why it could not run. “The evidence this path stands on could not be read this run” is a different statement from “this path found nothing”, and the briefing never renders the first as the second.",
      ],
    },
    {
      heading: "A short list, and nothing padded to fill it",
      items: [
        {
          heading: "Three query records, two page records",
          body: "Page rows and query rows are two separate populations with separate budgets. Taking page records out of what the query records left over would let the number of query candidates decide whether a page measurement was visible — one population ranked by the size of another.",
        },
        {
          heading: "One first appearance, outside the budget",
          body: "Every other path reports something that went wrong or is being left on the table. Sharing one budget meant an active property with three declines a day would never once be told that something arrived in a leading position, so that lane carries its own slot.",
        },
        {
          heading: "One row per query, earliest path first",
          body: "When several paths hit the same query, the highest-ranked one is shown and the rest are counted, not stacked. The ranking is stated once as a product decision rather than left to the order the code happens to run in.",
        },
        {
          heading: "The count of what was not shown",
          body: "Candidates that formed but did not fit are counted and reported. If that split could not be read, the run says the count is unavailable — never zero.",
        },
      ],
    },
    {
      heading: "What it will not say",
      items: [
        {
          heading: "That an absent query has no impressions",
          body: "Search Console anonymizes low-volume queries for privacy, withholding them from the query report. Each run reports what share of your property's impressions and clicks never appear in the visible query rows, or states that the share is unavailable. Absence from the sample is reported as not observed — never as zero, never as newly indexed.",
        },
        {
          heading: "That average position is a rank",
          body: "It is weighted by impressions, so it describes where your exposures happened, not one fixed place in the results. A query whose impressions shift onto a worse-ranking page shows a falling average while nothing about any single result moved — which is exactly why the position-decline path requires the clicks to fall with it.",
        },
        {
          heading: "That query counts and page counts can be added",
          body: "They are different populations read from different Search Console dimensions, and Google drops rows differently in each. Summing a query-and-page read to reconstruct page totals loses precisely the rows the page dimension exists to recover.",
        },
        {
          heading: "That it checked your manual actions",
          body: "Manual Actions and Security Issues have no public read API. The briefing links both reports and lets you record on the page that you looked; it never presents that mark as an observation of its own.",
        },
        {
          heading: "That it kept the report",
          body: "There is no scheduled job, no saved history and no stored copy. The report and both manual-check marks live in this page's state — refreshing, rerunning, changing property or closing the tab clears them. Search Console keeps the history even though this tool does not.",
        },
        {
          heading: "That the run had unlimited budget",
          body: "One request holds a 45-second whole-request budget across a required date read and its optional attachments, and the Search Console read allowance is shared hourly across every Search Console tool here. When an attachment cannot be read in time the KPI view still renders and the paths that depended on it report as unavailable.",
        },
      ],
    },
    {
      heading: "Where each finding hands you off",
      intro:
        "A briefing that ends in a paragraph of advice is a briefing you have to re-derive tomorrow. Each card opens the tool that can actually take the question further, and states plainly what that tool will and will not use.",
      items: [
        {
          heading: "Click gaps go to the Opportunity Finder",
          body: "That tool ranks click opportunities across the whole property from your own CTR curve. The card says outright that it will not use this particular query or page — the gap in front of you is already measured, and the next tool answers a wider question.",
        },
        {
          heading: "Declines go to Traffic Drop Diagnosis",
          body: "Query click and position declines open the property-level diagnosis, and so do both declining page lanes — a page whose impressions collapsed and a page whose clicks fell. The card states that the next tool diagnoses the property rather than the row, so nobody expects a per-query answer it was never built to give.",
        },
        {
          heading: "First appearances and zero-click pages go to the On-Page Checker",
          body: "Of the three page lanes only the first-appearance one lands here, alongside the query-level first appearances and the pages drawing no clicks. The page URL, and the target query where one exists, arrive prefilled so you can see what the public HTML actually supports. The briefing has judged the search result, not the page.",
        },
        {
          heading: "Your property never travels in a URL",
          body: "Handoffs are carried privately inside the tab. If that private handoff cannot be stored, navigation stops and the briefing says so, rather than falling back to putting your property, query and page into a query string.",
        },
      ],
    },
  ],
  relatedToolsHeading: "Tools the briefing hands off to",
  relatedTools: [
    {
      label: "GSC Opportunity Finder",
      href: "/tools/seo-quick-wins",
      description:
        "Ranks click opportunities across the whole property against your own CTR curve.",
    },
    {
      label: "Traffic Drop Diagnosis",
      href: "/tools/traffic-drop-diagnosis",
      description: "For when the decline is property-wide rather than one row.",
    },
    {
      label: "On-Page SEO Checker",
      href: "/tools/on-page-seo-check",
      description:
        "Checks what one page's public HTML supports, with or without a target query.",
    },
    {
      label: "Competitor Keyword Gap",
      href: "/tools/competitor-keyword-gap",
      description:
        "Where the briefing runs out of first-party evidence: terms competitors rank for and you were not observed on.",
    },
  ],
  /*
   * English and Chinese name different articles on purpose.
   *
   * The blog is not translated post for post — 83 English articles against 8
   * published Chinese ones — so one shared slug list would either 404 in
   * Chinese or spend both pages' internal links on whatever the two languages
   * happen to have in common. Each locale links what is on topic and published
   * in that locale, and the guard checks exactly that.
   */
  relatedReadingHeading: "Further reading",
  relatedReading: [
    {
      label: "Striking-distance keywords",
      href: "/blog/striking-distance-keywords",
      description:
        "What to do with the rankings you already have, which is what most of these lanes surface.",
    },
    {
      label: "When several pages rank for the same keyword",
      href: "/blog/multiple-pages-ranking-for-same-keyword",
      description:
        "Why a query's average position can fall while no single result moved.",
    },
    {
      label: "What a public SEO audit can and cannot see",
      href: "/blog/public-seo-audit-boundaries",
      description: "Where first-party Search Console data stops being optional.",
    },
  ],
};

const ZH: ToolArticle = {
  exampleHeading: "一次早间简报长什么样",
  example: [
    {
      heading: "它读取的窗口",
      body: "Search Console 的太平洋时区日历，止于可以证明已经结算完成的那一天——落后当前 PT 日期三天。简报用那一天对比一段可比的更早日期，再用最新完整七天对比紧邻的前七天。更新的数据不进入这两组对比，缺口也不会用外推填上。",
    },
    {
      heading: "它会指名的一种变化",
      body: "某个查询词的平均排名浮动不超过半位，而它的周点击同时下降了 15% 和 3 次。两道门槛都过，于是它被报告为点击下降——并明确不是排名下降，因为排名证据说排名没动。",
    },
    {
      heading: "它拒绝升格的一种移动",
      body: "某个查询词的平均排名移进 1–10 段，而它的上一窗口只有 50–99 次曝光。它会作为「暂定位置移动」出现在自己的列表里——两种暂定类型都是位置移动，从来不是点击——不能成为当天的任何一条动作。这么小的基数，本来就会自己晃这么多。",
    },
    {
      heading: "什么都没找到时它怎么说",
      body: "「本次运行没有变化越过证据门槛。这不等于证明什么都没变。」旁边还会印出每条路径读了多少行、判定了多少行、其中多少行形成了候选。",
    },
    {
      heading: "你能带走什么",
      body: "最多三条查询词记录、最多两条页面记录，以及最多一条「首次出现且均位六或更好」——后者独立配额，不占三条动作预算，这样糟糕的一周也永远压不掉唯一一条报好消息的路径。每张卡片都带着它所依据的证据行，和一个通往能把这个问题继续往下问的工具的按钮。",
    },
  ],
  sections: [
    {
      heading: "它读的那两个窗口，以及为什么昨天不在里面",
      paragraphs: [
        "Search Console 按太平洋时区日历结算数据，并且滞后于当下。简报只取它能证明已经完整的最新一天——落后当前 PT 日期三天——任何一组对比都不会越过这条线。所以早上九点跑和晚上九点跑读的是同一个窗口、给出同一个结果；一个每天可以重复的习惯，正是建立在这一点上。",
        "由此构建两组对比：最新完整日对比一段可比的更早日期，以及最新完整七天对比紧邻的前七天。所有变化路径都在七天这一对上评估；单日只提供上下文。当必需的日期序列读不到时，简报会说日级解读不可得，而不是拿周级数字把这个洞填上。",
        "趋势图是刻意读得更近的那一部分：同一次请求会取回一段截止到当前太平洋日期的 90 天日级序列，所以图在 24 小时、7 天、28 天、3 个月之间切换不需要再读一次，而最新的几个点会被标为暂定，因为 Google 还在更新它们。24 小时视图是唯一使用小时级数据的视图，在 Google 仍在更新它时会带自己的提示。Search Console 没有返回数据的时间桶保持为缺口，任何一个都不会被替换成零。",
      ],
    },
    {
      heading: "日级还是周级由你的样本决定，不由你决定",
      intro:
        "点击和曝光都是计数，小基数上的计数在什么都没发生时也会按大致自身平方根的幅度晃动。一份把日级噪声当新闻读的简报，比没有简报更糟。",
      items: [
        {
          heading: "门槛是完整一周 1,000 次曝光",
          body: "低于它，简报会把自己降级为周级节奏，并在页面上写明原因。这是站点级的判定而不是偏好设置：同一个站点这个月可能是日级、下个月是周级，每次运行都按当天的证据说明自己处在哪一档。",
        },
        {
          heading: "还必须有一条点击路径真的判定过行",
          body: "节奏判定问的是三条点击驱动路径——两条查询词路径加上页面点击下降——有没有真正判定过任何行，而不是整份报告看起来是否健康。只有位置类路径能跑的站点就是周级站点，因为按曝光加权的平均排名不是点击信号。",
        },
        {
          heading: "运行模式是被说出来的，不是被暗示的",
          body: "一次运行会自报为变化检测、位置观察、当前位置观察清单，或不可得。后三种存在的意义在于：撑不起变化检测的站点仍然能拿到一句关于自己现状的诚实描述，而不是一张读起来像「什么都没发生」的空页。",
        },
        {
          heading: "小样本的行只能停在观察层",
          body: "上一窗口只有 50–99 次曝光的查询词可以作为暂定移动出现。它与变化分开列示、不产生动作，并印出把它挡在门外的那个曝光数。",
        },
      ],
    },
    {
      heading: "一条发现可能到达的每一条路径",
      intro:
        "这里没有隐藏评分。九条路径加一项常驻检查各自独立评估，各自对着自己写明的门槛；当前窗口的每一行都会被记入未评估、已评估无信号，或形成候选。",
      table: {
        label: "已实现的评估路径 · 门槛即引擎自己的常量",
        invented: false,
        columns: ["路径", "证据必须具备什么", "什么才算一条发现"],
        rows: [
          [
            "点击机会",
            "已确认的品牌词；一个非品牌查询词本窗口 ≥300 次曝光，且它所在的位置段在剔除它自己之后仍持有 ≥2,000 次曝光",
            "实测点击只有本站留一法 CTR 曲线预测值的一半或更低，且预测点击 ≥5 次",
          ],
          [
            "排名稳定但点击下降",
            "两个窗口各 ≥100 次曝光，上一窗口 ≥3 次点击",
            "点击同时下降 15% 和 3 次，而平均排名移动不超过 0.5",
          ],
          [
            "移入 1–10 段",
            "两个窗口各 ≥100 次曝光，且上一窗口平均排名在 10 之外",
            "当前窗口落在 1–10 段内，且至少好了 1.5 位",
          ],
          [
            "从可行动区间下滑",
            "同一个「查询词 × 页面」组合在两个窗口各 ≥100 次曝光，且至少一个窗口在前 30 内",
            "该组合的平均排名下降 ≥3 位，且点击同时下降 ≥30%",
          ],
          [
            "首次观察到的查询词与页面组合",
            "两个窗口的页面归属都可读；当前 ≥100 次曝光且均位从 8 起、不含 21",
            "该组合不在上一窗口的可见行里",
          ],
          [
            "首次出现即在六位或更好",
            "与上一条相同的条件",
            "该组合不在上一窗口里，且当前均位为 6 或更好",
          ],
          [
            "页面曝光几乎消失",
            "该页面上一窗口 ≥30 次曝光，且它当前是否出现可判定",
            "曝光下降 ≥80%，且降幅大于上一窗口曝光数平方根的两倍",
          ],
          [
            "页面点击下降",
            "该页面两个窗口各 ≥100 次曝光，上一窗口 ≥3 次点击",
            "点击同时下降 15% 和 3 次，且降幅大于上一窗口点击数平方根的两倍",
          ],
          [
            "页面在本次对比中首次出现",
            "当前 ≥100 次曝光，且它在上一窗口是否出现可判定",
            "上一窗口没有该页面的行、或有行但曝光为零，且当前均位在 30 以内",
          ],
          [
            "有曝光却完全没有点击的页面",
            "实测均位为 10 或更好，且按本站自己的非品牌点击率，这个页面的曝光量预期应有 ≥3 次点击",
            "它一次点击都没有。这是一种状态而非变化，因此列在「检查」里",
          ],
        ],
      },
      paragraphs: [
        "这张表有两个后果值得直接说出来，而不是留给你自己撞上。两条首次出现路径覆盖的是「8 起、不含 21」和「6 或更好」，所以一个首次出现在均位正好为 7 的组合会被评估并报告为无信号；这个缺口来自这批门槛所依据的规格本身，合上它只需要改一个常量。另外，有两条路径需要已确认的品牌词清单：点击机会和「有曝光却完全没有点击的页面」都建立在本站自己的非品牌点击率上。没有这份清单就没有可信的品牌／非品牌切分，于是两条都会自报「未评估」，而不是悄悄把你自己的品牌名当成机会量出来。",
        "每条路径也会说明自己为什么跑不了。「本次运行读不到这条路径所依赖的证据」和「这条路径什么也没找到」是两句不同的话，简报绝不把前者渲染成后者。",
      ],
    },
    {
      heading: "一份很短的清单，且绝不为了凑满而补",
      items: [
        {
          heading: "三条查询词记录，两条页面记录",
          body: "页面行和查询行是两个独立总体，各有各的预算。如果把页面记录塞进查询记录用剩的名额，就等于让查询候选的数量决定一次页面测量能不能被看见——用一个总体的大小去排另一个总体的序。",
        },
        {
          heading: "一条首次出现，且在预算之外",
          body: "其余每条路径报的都是出了问题或正被白白留在桌上的东西。共用同一份预算意味着一个每天有三条下降的活跃站点永远不会被告知「有东西以领先位置出现了」，所以这条路径拿到了自己的名额。",
        },
        {
          heading: "一个查询词只出一行，取排序最靠前的路径",
          body: "多条路径命中同一个查询词时，只展示排序最高的那条，其余被计数而不是堆叠。这个排序被当作一次产品决定明确写下来，而不是听凭代码碰巧的执行顺序。",
        },
        {
          heading: "没展示的那些会被数出来",
          body: "形成了候选却没排进版面的会被计数并报告。如果这个分账读不出来，本次运行会说这个数字不可得——绝不写成零。",
        },
      ],
    },
    {
      heading: "它不会说的话",
      items: [
        {
          heading: "不会说「没出现的查询词等于没有曝光」",
          body: "Search Console 出于隐私会把低频查询词匿名化，让它们不出现在查询报告里。每次运行都会报告你站点有多大比例的曝光和点击从未出现在可见的查询行里，或者直接说明这个比例不可得。不在样本里，只被报告为「未观测到」——不是零，也不是「刚被收录」。",
        },
        {
          heading: "不会把平均排名说成名次",
          body: "它按曝光加权，描述的是你的曝光发生在哪里，而不是结果页上某个固定位置。当一个查询词的曝光挪到排名更差的页面上时，它的均位会下降，而任何单条结果其实都没动——这正是位置下降路径要求点击必须同步下降的原因。",
        },
        {
          heading: "不会把查询词计数和页面计数相加",
          body: "它们是从 Search Console 不同维度读出的两个总体，Google 在每个维度上丢行的方式也不同。把「查询词 × 页面」的读取加总来重建页面总量，丢掉的恰恰是页面维度存在的意义所要找回的那些行。",
        },
        {
          heading: "不会声称检查过你的人工处置",
          body: "Manual Actions 与 Security Issues 没有公开读取 API。简报会链接这两份报告，并允许你在页面上记录「我看过了」，但绝不把这个标记呈现为它自己的观测。",
        },
        {
          heading: "不会保留报告",
          body: "没有定时任务、没有保存的历史，也不在任何地方留副本。报告和两个人工检查标记都只活在这个页面的状态里——刷新、重跑、换资源或关闭标签页都会清空它们。Search Console 保留着历史，即使这个工具不保留。",
        },
        {
          heading: "不会假装预算无限",
          body: "一次请求在必需的日期读取及其可选附加读取之上，共享一个 45 秒的整体预算，而 Search Console 读取额度按小时在本站所有 Search Console 工具之间共享。当某项附加读取来不及完成时，KPI 视图照常渲染，依赖它的路径则报告为不可得。",
        },
      ],
    },
    {
      heading: "每条发现会把你交到哪里",
      intro:
        "一份以一段建议收尾的简报，明天还得从头推一遍。每张卡片都会打开真正能把这个问题继续往下问的工具，并直说那个工具会用什么、不会用什么。",
      items: [
        {
          heading: "点击缺口交给机会发现器",
          body: "那个工具用你自己的 CTR 曲线，在整个站点范围内为点击机会排序。卡片会直说它不会使用眼前这个查询词或页面——这个缺口已经量过了，下一个工具回答的是更宽的问题。",
        },
        {
          heading: "下降类交给流量下跌诊断",
          body: "查询词的点击下降与位置下降会打开站点级诊断，两条下降型页面路径——曝光几乎消失和点击下降——同样交给它。卡片写明下一个工具诊断的是站点而不是这一行，这样没有人会期待一个它本来就不提供的逐词答案。",
        },
        {
          heading: "首次出现与零点击页面交给 On-Page 检查器",
          body: "三条页面路径里只有「首次出现」落在这里，和查询词级的首次出现、以及有曝光却零点击的页面一起。页面 URL——以及存在目标查询词时的那个词——会被预填过去，让你看清公开 HTML 到底支持了什么。简报判定的是搜索结果，不是页面本身。",
        },
        {
          heading: "你的资源永远不会出现在 URL 里",
          body: "跳转参数在标签页内部私下传递。如果这份私有交接存不下来，导航会被中止并明确告知，而不是退回到把资源、查询词和页面塞进 query string。",
        },
      ],
    },
  ],
  relatedToolsHeading: "简报会交接过去的工具",
  relatedTools: [
    {
      label: "GSC 机会发现器",
      href: "/tools/seo-quick-wins",
      description: "用你自己的 CTR 曲线，在整个站点范围内为点击机会排序。",
    },
    {
      label: "流量下跌诊断",
      href: "/tools/traffic-drop-diagnosis",
      description: "当下降是站点级而不是某一行时用它。",
    },
    {
      label: "On-Page SEO 检查器",
      href: "/tools/on-page-seo-check",
      description: "检查一个页面的公开 HTML 支持了什么，填不填目标词都能跑。",
    },
    {
      label: "竞品关键词差距",
      href: "/tools/competitor-keyword-gap",
      description:
        "第一方证据用尽的地方：竞品在排、而你未被观测到的那些词。",
    },
  ],
  relatedReadingHeading: "延伸阅读",
  relatedReading: [
    {
      label: "证据优先的增长实验",
      href: "/blog/evidence-first-growth-experiments",
      description: "为什么一次无法复现的测量不能当基准。",
    },
    {
      label: "公开 SEO 审计看得到和看不到什么",
      href: "/blog/public-seo-audit-boundaries",
      description: "第一方 Search Console 数据从哪里开始不再是可选项。",
    },
    {
      label: "增长实验手册",
      href: "/blog/growth-experiment-playbook",
      description: "把每周的阅读习惯变成站得住的决定。",
    },
  ],
};

export function getDailyBriefingArticle(locale: string): ToolArticle {
  return locale === "zh" ? ZH : EN;
}
