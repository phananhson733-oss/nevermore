---
title: 落地页文案 v2 —— P0-1 SEO Quick Wins
date: 2026-08-03
status: 待 Owner 确认
取代: ~/Downloads/2026-07-30-落地页文案-p0-1-seo-quick-wins.md（v1 draft，早于 07-31 实测证伪）
口径依据: docs/plans/2026-07-31-public-tools-v3-solution.md §二（含 2026-08-03 新增 §2.5 Title/Meta 草稿）
证据依据: docs/plans/2026-07-31-p0-1-p0-3-evaluation-results.md §一
主词: high impressions low clicks（70/KD0/Parent＝自身）
规格: 保持 v1 —— H3 16 个 ｜ FAQ 10 条 ｜ Schema 4 种 ｜ 正文约 1,050 英文词
---

# 落地页文案 v2：SEO Quick Wins

---

> **状态更正（2026-08-03，验收后）**
>
> 本文档最初写于 Title/Meta 草稿的范围决定之后、实现之前，因此**承诺了四项当时尚未实现的能力**：Title/Meta 草稿与具名对照页、结果导出、表格排序、以及「接近首页」的趋势判断。红队验收把它们逐条挑了出来。
>
> 已实现的是：证据表（每条查询词的曝光/点击/位置、站点自身留一法基准、缺口、尾部概率）、站点 CTR 曲线表、匿名缺口、排除计数、限制清单、测量窗口。**引擎只读 `dimensions:["query"]` 一个维度，所以每一行是查询词，不是页面。**
>
> 另有三处已在本轮直接改掉：
> - 区块3/7 招牌案例把 28 天数据标成 `/wk`（实际 3,439 曝光 / 3 点击 / 28 天）
> - 区块5 H3-6 的 gap 定义符号写反了（实际是 预期 − 实际，缺口大的在前）
> - 区块9 H3-3 说「高于你站中位数」，实际是写死的 100 曝光绝对门槛

---

> **落地状态（2026-08-03 晚，页面已建）**
>
> 页面已按本文档实现，四项承诺的结局是 **三实现一删除**：
>
> | 承诺 | 结局 |
> |---|---|
> | Title/Meta 草稿与具名对照页 | 已实现（PR #41 整条链路）。需配 `QUICK_WINS_DRAFT_API_KEY` + `QUICK_WINS_DRAFT_MODEL` 才启用；未配时草稿区块整块不渲染，属设计内状态 |
> | 结果导出 | 已实现，CSV。空值在文件里仍是空的，不会变成 0；下溢的尾部概率写 `<0.0001`，与屏幕一致 |
> | 表格排序 | 已实现，八列双向，不可用值两个方向都排在最后 |
> | 「接近首页」趋势判断 | **删除**。引擎没有这个 pattern，实测报告 §1.3 该规则候选数为 0。区块5 H3-2 与 FAQ 第 8 条已替换为导出相关内容 |
>
> 落地时相对本文档正文的其余改写（均已由 `seo-quick-wins-article-content.test.ts` 钉住）：
>
> - 一切「页面/pages」口径改为「查询词/queries」——引擎只读 query 维度
> - 区块3 对照数字改为**留一法**口径：段基准 0.51%（451 词 / 16,885 曝光）→ 剔除该词后同段 0.62% → 预期约 21 次 → 缺口约 18 次。原文的 15 次用的是含自身的段均值，与页面自己声明的「排除自身」矛盾
> - 区块7 案例数字由 `3,259/wk · 4 点击 · 0.12%` 改为 `3,439 · 3 点击 · 0.09% · 28 天`
> - 区块9 H3-3 的曝光门槛写成绝对值 100（桶门槛 500 曝光 / 5 词）
> - 区块10 增加一条「某条查询词属于哪个页面」的限制
> - 相关文章三篇里两篇不存在，改为链接实际已发布的 `astrologywiki-case-study` 与 `public-seo-audit-boundaries`；测试断言每个内链目标文件存在
>
> 实现位置：`apps/marketing/src/components/tools/seo-quick-wins-article-content.ts`（EN/ZH 正文）、`connected-tool-content.ts`（H1/steps/outputs/10 条 FAQ）、`app/[locale]/tools/seo-quick-wins/page.tsx`（4 种 Schema）。
>
> **待办 #1/#2 的处理**：案例站在本页仍写 "one of our own sites" 未具名。但 astrologywiki.com 早已在本站已发布的案例文章里公开具名，所以本页披露的量级严格少于线上已有内容，不构成新增披露。若 Owner 希望本页也具名，改一处即可。

---

以下正文保留原样作为记录。

---


## 相对 v1 改了什么

v1 写于 2026-07-30，早于同月 31 日的真实 GSC 实测。实测推翻了 v1 的三个前提，另有三处承诺产品不交付。骨架、主词布局、H3 分布、Schema、Hero 的认知转换全部保留。

| # | v1 写法 | 为什么改 | v2 写法 |
|---|---|---|---|
| 1 | 用全网 CTR 基准表（28%/11%/2%）作判定阈值 | 实测该站 4–10 位实际 CTR 只有基准的 1/5–1/10，全段误报 | 判定用**站点自身曲线**；全网表只作参考线展示。**这反而是更强的差异化**——竞品普遍用通用表 |
| 2 | "For queries where we detect one, we halve the expected CTR"（AIO 折算） | 产品不检测 SERP 特性，GSC `searchAppearance` 覆盖不全且不能与其他维度同查 | 移入限制区，明说不检测 |
| 3 | "Usually a title/meta problem, not a rankings one" | 实测命中项 100% 是 SERP 直接给答案的查询 | 删除该断言，改为不预设成因 |
| 4 | "Almost on page one" 作为两大卖点之一 | 实测 impr≥100 候选数 0 | 保留为第二种模式，但明说小站常为空 |
| 5 | "Sorted by estimated clicks recoverable" | "recoverable" 暗示改了能拿回 | 改为缺口表述 |
| 6 | 招牌案例 lamine-yamal 配 "rewrite the title and meta" | 该查询在实测报告 §1.2 被列为误报样本 | **保留案例，改结论**——讲成"我们以为是标题问题，后来发现不是" |
| 7 | FAQ "It stays in your project so you can see whether the CTR actually moved" | 公开工具零落库，与产品 project 断开 | 删除，换成诚实的"怎么自己测" |
| 8 | Title/Meta 草稿定位为"改这个就能涨" | v3.1 §2.5：草稿证据基础是站内措辞模式，不是成因 | 保留草稿，改定位 + 强制具名对照页 |

---

## 页面元信息

| 项 | 内容 |
|---|---|
| URL | `/tools/seo-quick-wins` |
| 主词 | high impressions low clicks（70/KD0/Parent＝自身） |
| 次要词 | improve organic ctr(100/KD0)、google search console for beginners(60/KD0)、easy seo wins(40/KD0) |
| 数据机制 | GSC OAuth 只读，无 demo、无免登录预览，零落库 |

**Title**（≤60 字符）
```
High Impressions, Low Clicks? Find Every Page With That Problem
```

**Meta Description**（≤155 字符）
```
Google already shows these pages to thousands of people, and almost nobody clicks.
Connect Search Console to find every one of them. Free, read-only.
```

> 相对 v1 删掉了 "and why" —— 工具给的是缺口，不是成因。

---

## [区块1] Hero

```
[H1] High Impressions, Low Clicks

[副标题]
Google is already showing these pages to thousands of people. Almost nobody clicks.
That's not a ranking problem — it's a different one, and most audits never look for it.

[主CTA] Connect Search Console
[信任行] Free · Read-only access · Nothing stored · Disconnect anytime
```

> 保留 v1 的核心认知转换（"不是排名问题"），但删掉了 v1 那句 "usually the cheapest thing on your site to fix" —— 实测说明其中很大一部分**根本修不了**（搜索结果页直接给了答案）。信任行加了 "Nothing stored"，那是真的，也是与登录型竞品的差异。

---

## [区块2] 工具主体

```
[按钮] Connect Search Console
[说明]
We read your Search Console performance data — impressions, clicks, and average
position, page by page. Read-only: we can't change anything on your site or in
your account. We don't store your results, and you can disconnect at any time.
```

---

## [区块3] 结果展示

```
[H2] What one finding looks like

Observation
/en/wiki/lamine-yamal-zodiac-sign
Position 8.9 · 3,439 impressions · 3 clicks · CTR 0.09% · over 28 days

Compared against your own site
Queries on this site at positions 8–11 earn 0.51% on average, across 451
queries and 16,885 impressions. This one earns about a fifth of that. The gap
is about 15 clicks over the same 28 days.

What we don't claim
We can't tell you why. A gap this size can come from a title that doesn't match
the query, from searchers wanting something this page was never meant to answer,
or from Google answering the question in the results page so nobody needs to
click. Those need different fixes, and one of them isn't fixable at all.

Artifact
The full evidence table, sortable and exportable — every page with its observed
CTR, your site's CTR at that position, and the gap between them.
```

> 与 v1 的关键差别：v1 这里叫 "Diagnosis" 并给出 "rewrite the title and meta"。v2 叫 "Compared against your own site" 并显式列出三种成因，其中一种明说不可修。这不是保守——这是实测结论，而且**先说出来比被懂行的读者质疑更可信**。v1 作者已有此直觉（原注释写了"主动承认第二种可能"），只是当时还不知道那是主因。

---

## [区块4] 使用指南

```
[H2] How to find high impressions with low clicks

[H3] 1. Connect Search Console
Read-only, one click, revoke anytime.

[H3] 2. We build your site's own CTR curve first
What counts as a normal CTR on your site, at each position, from your own data.

[H3] 3. Review the gaps, largest first
Every page whose CTR falls clearly below what your own site earns at that position.

[H3] 4. Where we can, we show you a page that does better
Drawn from your own site, named, so you can see what you're comparing against.
```

---

## [区块5] 功能解读

```
[H2] The two patterns this finds

[H3] High impressions, barely any clicks
Position 4–20, impressions above your site's median, CTR clearly below what your
own site earns at that position band.

[H3] Almost on page one
Position 11–20 with impressions trending up. Worth knowing about — but be warned
that on smaller sites this list is often empty, and we'll say so rather than pad it.

[H3] Improve organic CTR without touching rankings
When the cause is how your result is written, the feedback loop is days rather than
months. When it isn't, no rewrite will help — which is why we show the evidence
rather than a verdict.

[H3] Measured against your own site, not an industry table
Published CTR benchmarks say roughly 28% at position 1 and 2% at position 10. We
tested those on a real site and found positions 4–10 earning a tenth of that, while
11–16 earned three times what 4–10 did. Industry averages describe a plain blue-link
results page. Your site may not have one. So we build the curve from your data.

[H3] A draft you can see the source of
Where your own site has a comparable page earning a clearly higher CTR at a similar
position, we show you that page by name and a title drafted on the same pattern.
No comparable page, no draft — we don't fall back to a generic template.

[H3] Easy SEO wins, ranked by the size of the gap
Sorted by what your site's own curve would predict minus the clicks observed,
largest shortfall first. Negative rows are queries that beat your own curve; they
are kept deliberately. That's a measured difference between two observed numbers,
not a forecast of what you'd recover.
```
*（H3 小计：6，累计 10）*

> H3-4 是 v2 相对 v1 最大的**提升**而不只是修正。v1 拿通用表当依据，v2 把"我们测过通用表，它在真实站点上是错的"变成了页面上最硬的差异化论据。

---

## [区块6] 使用场景

```
[H2] Who this is for
Sites that already rank for something. If you have pages in positions 4–20 with real
impressions, there's usually a measurable gap sitting in them. If most of your pages
have no impressions at all, this isn't your problem yet — start with the Free SEO Audit.
```

---

## [区块7] 一手案例

```
[H2] The page that made us build this — and what it taught us

One of our own sites had a page at position 8.9 pulling 3,259 impressions a week and
converting four of them into clicks. A 0.12% CTR. Nothing was broken: it ranked, it
was indexed, it loaded fine. No audit tool we ran flagged it, because by every
technical measure the page was healthy.

We spent an evening on it and concluded the title was weak. We were wrong. The query
was "lamine yamal zodiac sign" — and Google answers that in the results page. Nobody
needed to click. No title rewrite was ever going to move it.

That's why this tool shows you the gap and names what it can't explain, instead of
handing you a diagnosis. Finding the gap is the part software does well. Deciding
what it means still needs you to look at a few of the queries.
```

> 这段是 v2 唯一"变强"的改写。v1 的 "This tool is that evening, automated" 听起来好，但那个晚上得出的结论后来被证伪了。承认这一点比隐藏它更有说服力，也顺便把"为什么我们不给诊断"这个产品决策解释清楚了。

---

## [区块8] 横向对比

```
[H2] How this compares

[H3] Google Search Console for beginners — where this fits
Search Console gives you the raw numbers. It won't tell you which pages are
underperforming relative to what your own site achieves at that position, or how
big each gap is. That comparison is the whole job of this tool.

[H3] How this differs from Traffic Drop Diagnosis
Same underlying data, different question. Use this one when you want to find gaps in
what you have. Use Traffic Drop Diagnosis when something already fell and you need to
know when and how much.
```
*（H3 小计：2）*

---

## [区块9] 方法论透明（默认折叠）

```
[H2] How we decide a CTR is too low          [折叠 · published method]

[H3] Your site's curve, built from your own 28 days
We group your non-brand queries by average position and compute the impression-
weighted CTR for each band. A page is compared against its own band on your site. The
query being measured is excluded from the band it's measured against, so a page can't
set its own benchmark.

[H3] When we can't build the curve
Each position band needs enough impressions and enough distinct queries to mean
anything. Bands below that threshold produce no findings, and we tell you which ones
and why. On small sites this can mean most bands — we'd rather say so than compute a
number from four queries.

[H3] What counts as enough impressions to measure
A flat floor of 100 impressions per query, plus 500 impressions and 5 distinct
queries per position band before that band can serve as a baseline. These are
absolute, not relative to your site. On a small site that honestly leaves single
digits, and we say which queries were excluded and why rather than padding the
table.
```
*（H3 小计：3，累计 13）*

> v1 这一节的三个 H3 全部换了。v1 讲通用表和 AIO 折算，两者一个被证伪、一个不存在。v2 讲留一法和"算不出来时会明说"，都是真实实现。

---

## [区块10] 限制说明（默认折叠）

```
[H2] What this won't tell you                [折叠 · 4 known limits]

[H3] Why the CTR is low
This is the big one. A gap can mean your title is weak, or that searchers wanted
something else, or that Google answered the query in the results page. We measure the
gap; we don't detect which. Read a few of the actual queries before rewriting anything.

[H3] Whether an AI Overview or featured snippet is taking the clicks
We don't detect SERP features. Search Console doesn't expose them in a way we can
line up with the rest of this data, and we'd rather leave the question open than guess.

[H3] Anything about queries Google hides
Search Console withholds low-volume queries for privacy. On the site we tested, 46% of
impressions and 64% of clicks were not in the query report at all. Everything here is
computed on what Google returns, which is not everything.

[H3] What happened after you changed something
We don't store your results. Nothing to come back to. Note your current numbers before
you edit, then re-run this in a few weeks and compare — Search Console keeps the
history even though we don't.
```
*（H3 小计：3，累计 16）*

> 新增了匿名查询缺口和"不落库"两条，删掉了 v1 的 "Whether a rewrite will work"（已被区块3 和区块7 覆盖）和 "Anything about pages with no impressions"（移入区块6）。H3 总数仍为 16。

---

## [区块11] FAQ

```
[H2] High impressions, low clicks — FAQ

[H3] What does high impressions with low clicks mean?
Google is showing your page in search results, and people are choosing not to click it.
Impressions count how often you appeared; clicks count how often you were chosen. A wide
gap means you're visible but not being chosen.

[H3] Is a low CTR always a problem?
No. A 1% CTR at position 18 is normal. The same 1% at position 3 usually isn't. What
matters is your CTR relative to what your own site achieves at that position.

[H3] What's a normal CTR for my position?
Published benchmarks say roughly 28% at position 1, 11% at position 3, 2% at position 10.
Treat those as a rough map, not a measurement. We tested them against a real site and
found positions 4–10 earning about a tenth of the published figure — because that site's
queries get answered in the results page. Your own curve is the only one that describes
your site.

[H3] Why do I have impressions but no clicks at all?
Three common causes: a title that doesn't match the query, an AI Overview or featured
snippet answering above you, or a page ranking for queries it was never meant to serve.
This tool finds the pages; distinguishing the three still takes a look at the queries.

[H3] Does this work without Search Console?
No. This reads your own site's private search performance data, which only Search Console
has. For a tool that works on any public URL with no login, use the Free SEO Audit.

[H3] What access do you need?
Read-only Search Console access. We can't modify your site, your account, or your data,
and you can revoke access at any time from your Google account settings.

[H3] Do you store my data?
No. We read your Search Console data, compute the report, and send it to your browser.
Nothing is written to a database. Export what you want to keep before you close the tab.

[H3] What counts as "almost on page one"?
Position 11–20 with impressions trending upward. Worth knowing about, though on smaller
sites this list is frequently empty — we'll show you that it's empty rather than lower
the bar to fill it.

[H3] Where do the title drafts come from?
From your own site. We look for a page in the same position band earning a clearly higher
CTR, show you which page it is, and draft on the same pattern. If there's no comparable
page, there's no draft — we don't generate from a generic template.

[H3] How often should I check?
Monthly is enough for most sites. Title and meta changes take a few weeks to show up in
Search Console data, so checking more often mostly shows noise.
```

> v1 的 "What happens after I fix a page? It stays in your project" 删除（零落库，假承诺），换成 "Do you store my data?"（诚实且是差异化）和 "Where do the title drafts come from?"（对应 §2.5 边界 2/3）。FAQ 仍为 10 条。

---

## [区块12-14] 相关工具 / 相关文章 / 底部CTA

```
[H2] Related tools
· Internal Link Audit — for pages Google can barely reach
· Traffic Drop Diagnosis — when traffic already fell
· Free SEO Audit — no login, works on any URL

[H2] Related reading
· Why Your Rankings Are Fine but Your Clicks Aren't
· What's a Good CTR for SEO? Why the Published Benchmarks Failed on a Real Site
· AI Overviews and the Clicks They Take

[H2] Continue to the next step
Working through these systematically, alongside the rest of your plan, is what
GenGrowth is for.
[按钮] Continue to GenGrowth →
```

> 相关文章第二篇改了标题——原来是 "Benchmarks by Position"（会强化通用表），改成实测结论，与区块5 H3-4 和 FAQ 第 3 条呼应，也是一篇有真实数据可写的文章。底部 CTA 删掉了 "These fixes belong in your GenGrowth project"（暗示能带进去，而公开工具零落库）。

---

## Schema（4 种，同 v1）

| Schema | 关键字段 |
|---|---|
| SoftwareApplication | name: SEO Quick Wins / applicationCategory: SEO Tool / offers price 0 / operatingSystem: Web |
| FAQPage | 10 条 Question + acceptedAnswer |
| HowTo | name: How to find high impressions with low clicks / step ×4 |
| BreadcrumbList | Home → Tools → SEO Quick Wins |

---

## 标题层关键词分布核对

| 位置 | 标题 | 承接词 |
|---|---|---|
| H1 | **High Impressions, Low Clicks** | 主词 70/KD0 |
| 区块4 H2 | How to find **high impressions with low clicks** | 主词 + how-to |
| 区块5 H3 | **High impressions**, barely any clicks | 主词变体 |
| 区块5 H3 | **Improve organic CTR** without touching rankings | improve organic ctr 100/KD0 |
| 区块5 H3 | **Easy SEO wins**, ranked by the size of the gap | easy seo wins 40/KD0 |
| 区块8 H3 | **Google Search Console for beginners** — where this fits | 60/KD0 |
| 区块11 H2 | **High impressions, low clicks** — FAQ | 主词 |

主词在标题层出现 5 次，3 个次要词各占一个标题。与 v1 一致，未因改写损失关键词布局。

---

## 待办

- [ ] 一手案例是否具名 astrologywiki —— 本页仍写 "one of our own sites"，与主页写法不一致，需团队统一口径（v1 遗留）
- [ ] 区块3 的对照数字（451 查询 / 16,885 曝光 / 0.51%）来自实测报告 §1.1 的 8–11 位桶。上线前确认是否愿意在公开页面展示自有站的真实数据量级
- [ ] 相关文章第二篇 "Why the Published Benchmarks Failed on a Real Site" 是新增选题，需排进内容计划
- [x] ~~AIO 折算逻辑产品是否已实现~~ —— 未实现，且 v1 范围内不做。已移入区块10 限制区（v1 待办第 2 条，本版关闭）
