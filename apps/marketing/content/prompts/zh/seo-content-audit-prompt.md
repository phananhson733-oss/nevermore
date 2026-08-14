---
title: 内容盘点提示词
description: 把一批现有页面分成保留、更新、合并、下线四类，每个 URL 都给出理由、下一步动作，以及被撤下时的明确去向。
category: optimization
useCase: 内容资产复盘
outputFormat: 决策表
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: 内容盘点提示词, SEO 内容审计, 内容清单模板, 内容瘦身 SEO, 保留更新合并下线, 内容合并, 旧文章盘点
relatedSkill: seo-audit
relatedPrompts: content-refresh-rewrite-prompt, internal-linking-suggestions-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are a content strategist sorting existing pages into decisions an owner can
act on.

# Scope
Judge only the pages listed below, from only the fields supplied. Do not invent
clicks, impressions, positions, backlinks, conversion rates or dates. A blank,
missing or "not in export" field is unknown: not zero, and you may not reason as
though it were. Where a verdict turns on a number you lack, give it anyway and
mark it provisional.

# Inputs
What the site sells and who the pages are for: {{site_context}}
Page inventory, one page per line, whatever fields exist: {{page_inventory}}
Where the numbers came from and the period they cover: {{metrics_source}}
Pages that stay live regardless of performance: {{must_keep_pages}}
What this team can do with a removed URL: {{retirement_policy}}

# What to produce
One row per URL with exactly one verdict — keep, update, consolidate or retire
— plus the reason, the next action, and the URL's destination if it leaves the
index.

# Steps
1. Restate each page as the job it does for one reader: the question it answers
   and who is asking. Read that from the title, description or page type
   supplied. If a row is a bare URL, write "job unknown from slug" rather than
   guessing from the path.
2. Group pages whose jobs are the same or nested. Overlap is judged between
   named URLs, never in the abstract.
3. Resolve every group of two or more: name the page that survives and
   consolidate the others into it, or write one line per surviving page saying
   what it does that the others do not. No group ends undecided.
4. Assign one verdict per URL:
   - keep: the job is real, this page holds it, nothing is queued.
   - update: the job is real and this page holds it, but something has expired
     — a year in the title, a price, a product behaviour, an unsupportable
     claim.
   - consolidate: another named URL does the same job better.
   - retire: you cannot name a reader who needs this page, or its job belongs
     to an audience {{site_context}} says the site does not serve. A page you
     cannot argue for is a retire, not a keep; "recent", "long" and "well
     written" are not jobs. If the only argument for keeping it is that removal
     feels risky, say so and still write retire.
   A page in {{must_keep_pages}} is a keep; say the verdict came from that
   constraint, not its row.
5. Give every consolidate and retire row a URL disposition: a 301 to a named
   URL doing the same job, or a deliberate 410 when no page does. Do not use
   the homepage or a section index to avoid choosing — if nothing matches, 410
   is the answer. Respect {{retirement_policy}}; flag any row it cannot
   accommodate.
6. Mark each row confirmed or provisional. A provisional row names the exact
   figure that would settle it and its source.

# Output format
A table: URL | Verdict | Basis (confirmed/provisional) | Reason | Next action |
URL disposition. Then the overlap groups with their one-line resolutions, then
the missing data by field and which verdicts depend on it.

# Quality checks before you answer
- Every URL in the inventory appears exactly once, with exactly one verdict.
- No cell shows 0 for a figure that was not supplied; unknown reads unknown.
- Every consolidate and retire row names a 301 target or an explicit 410.
- Every overlap group ends in a consolidation or a written reason each page
  survives.
- Each reason cites a field from that row or a named other URL.

# When the input is thin
With no performance data, sort on job and overlap anyway, mark every
traffic-dependent verdict provisional, and name the export that would settle
those rows. If rows are URLs alone, say overlap cannot be judged from slugs and
ask for titles. Never estimate a missing figure or read a missing row as zero.

# Boundaries
Do not promise what any verdict will do to traffic, rankings or revenue. Do not
score pages or the site. Do not recommend a keyword count or density. Do not
remove a URL without a disposition. Do not upgrade a provisional verdict by
guessing.
```

## Variables

### site_context

Required. 这个站点卖什么、这些页面写给谁、读者接下来该做什么。**每一个「下线」判定都是对着这句话来论证的**，所以这里写得含糊，判定就会畏首畏尾。
Example: Cadence Fieldworks sells scheduling software to independent US HVAC contractors with 3-20 technicians; the blog reaches owners still running the schedule on a whiteboard

### page_inventory

Required. 一行一个页面。你手上有什么就写什么：URL、标题、页面类型、发布日期、最后更新、点击、曝光。某个字段没有就**留空或写「not in export」，不要用 0 顶上**。
Example: /blog/hvac-scheduling-software | Best HVAC Scheduling Software in 2024 | listicle | 2024-02-11 | 412 clicks | 18,300 impressions

### metrics_source

Optional. 数字来自哪里、覆盖的确切周期，这样模型才能分辨「表现不佳的页面」和「在窗口中途才发布的页面」。
Example: Search Console, sc-domain property, clicks and impressions for 2025-08-01 to 2026-07-31

### must_keep_pages

Optional. 无论数据怎么说都要保留的 URL，附理由。销售物料、合规页面，以及任何从产品内部链过去的页面都属于这里。
Example: /blog/hvac-invoice-template — sales sends it on first calls

### retirement_policy

Optional. 团队对一个被移除的 URL 实际能做什么，以及每种做法要多久。没有它，方案可能假设了没人能上线的重定向。
Example: 301s are self-serve in the CMS; a 410 needs an engineering ticket, about a week

## How to use

先填 `site_context`，而且要写成**一句关于买家的话**，不是一段关于公司的描述。每一个「下线」判定，本质是在论证「那句话里描述的读者没有一个需要这个页面」，所以「我们卖现场服务软件」会换来处处留有余地的措辞，而「有 3 到 20 名技师、还在白板上排班的老板」会换来决定。然后把清单**按导出文件原样**粘进去。这条提示词不需要固定的列顺序，只有标题也能跑，但会以明说的置信度损失为代价。

要盯的失败是**被悄悄截断的导出**。Search Console 的界面导出上限是 1,000 行，所以一个大博客交给你的文件里，站点的尾部干脆就不存在。如果你把那个文件粘进去还什么都不说，每个缺失的页面看起来都像是零曝光的页面，于是这次盘点会基于**根本不存在的证据**下线你站点的一大块。把那些行标成「not in export」，并在 `metrics_source` 里写上真实周期；提示词随后会把它们标为暂定，并要求在执行判定前先检查收录情况。

**按列读产出，不要按行读。** 先扫「依据」列并数一数暂定的行数：如果表里多数是暂定，这份盘点是在告诉你「去把数据取来」，不是「开始删」。然后扫「URL 去向」列，否掉任何写着「重定向到首页」「删除」「移除」的行——那些是模型回避了决定的行，把这几个 URL 连同下线政策重新说一遍再跑一次，通常就好了。最后确认每一个重合分组，要么以一次合并收尾，要么写明了两个页面为何都保留；**一个没有结论的分组，正是这条提示词要防的那件事**。

清单超过约 150 个页面时，**按主题分批**，不要按字母序。重合只在同一批次内被检测，而按字母序切分，恰好会把你最需要并排比较的那些页面分开。

## Example input

```text
What the site sells and who the pages are for: Cadence Fieldworks sells scheduling
and dispatch software to independent HVAC contractors in the US with 3 to 20
technicians. The blog exists to reach owners who currently run the schedule on a
whiteboard and a phone. The conversion is a 14-day trial started from the site.

Page inventory (URL | title | type | published | last updated | clicks | impressions):
/blog/hvac-scheduling-software | Best HVAC Scheduling Software in 2024 | listicle | 2024-02-11 | 2024-02-11 | 412 | 18,300
/blog/hvac-dispatch-software | HVAC Dispatch Software Compared | listicle | 2026-06-03 | — | 96 | 5,120
/blog/how-to-schedule-hvac-technicians | How to Schedule HVAC Technicians | how-to | 2023-09-20 | 2026-01-14 | 1,240 | 44,900
/blog/hvac-industry-statistics-2023 | 47 HVAC Industry Statistics for 2023 | stats | 2023-01-08 | — | 610 | 61,200
/blog/holiday-party-2022 | Our 2022 Holiday Party | news | 2022-12-20 | — | not in export | not in export
/blog/what-is-dispatch-software | What Is Dispatch Software? | definition | 2025-05-30 | — | not in export | not in export
/blog/hvac-technician-pay-guide | HVAC Technician Pay Guide | guide | 2025-03-18 | — | 2,180 | 96,400
/blog/servicetitan-alternatives | ServiceTitan Alternatives | comparison | 2026-01-22 | — | 340 | 12,700
/blog/hvac-invoice-template | Free HVAC Invoice Template | template | 2024-08-09 | — | 1,905 | 52,800
/blog/summer-ac-maintenance-checklist | Summer AC Maintenance Checklist | checklist | 2023-06-01 | — | 44 | 9,800

Where the numbers came from: Search Console, sc-domain property, clicks and
impressions for 2025-08-01 to 2026-07-31. Pages with no row in the export are
marked "not in export".

Pages that stay live regardless: /blog/hvac-invoice-template — sales sends it to
prospects on the first call.

What we can do with a removed URL: 301s are self-serve in the CMS. A 410 needs an
engineering ticket, about a week. We do not want redirects that land a reader on a
page about a different subject.
```

## Example output

| URL | 判定 | 依据 | 理由 | 下一步 | URL 去向 |
| --- | --- | --- | --- | --- | --- |
| /blog/hvac-scheduling-software | 更新 | 已确认 | 「选软件」这一组里最强的页面，412 次点击，但标题和框架还停留在 2024 年 | 刷新这篇盘点，吸收只有 /blog/hvac-dispatch-software 覆盖的条目，标题里去掉年份 | 保留，URL 不变 |
| /blog/hvac-dispatch-software | 合并 | 已确认 | 与 /blog/hvac-scheduling-software 干的是同一件事：帮老板选软件。发布于 2026-06-03，所以它的 96 次点击只覆盖了十二个月窗口中的两个月，不可比 | 把它独有的厂商条目并进那篇排班盘点，然后重定向 | 301 到 /blog/hvac-scheduling-software |
| /blog/how-to-schedule-hvac-technicians | 保留 | 已确认 | 干的是不同的事——是「怎么排班」而不是「买什么软件」。2026-01-14 更新，1,240 次点击 | 无 | 保留 |
| /blog/hvac-industry-statistics-2023 | 更新 | 已确认 | 61,200 次曝光，但标题和 URL 都盖着 2023 的戳 | 用当前数字重写并改标题。**URL 不要动**；改它会让页面丢掉历史，且没有任何收益 | 保留，URL 不变 |
| /blog/holiday-party-2022 | 下线 | 已确认 | 站点上下文里描述的读者没有一个需要它，也没有别的页面在干这件事 | 先查外链域名；按已写明的政策，410 需要一个工程工单 | 410 |
| /blog/what-is-dispatch-software | 保留 | 暂定 | 面向站点上下文里那位老板的定义页，行内没有任何信息显示它已过期。导出中缺失：一行缺失可能意味着零曝光，也可能意味着导出在行数上限处被截断，而这两种情况要采取不同的动作 | 在 Search Console 里检查该 URL，按路径拉一份筛选导出，然后只重跑这一行 | 保留，待该检查完成 |
| /blog/hvac-technician-pay-guide | 保留 | 暂定 | 曝光最大的来源，96,400。它服务的是技师而不是站点上下文里的老板，但这里没有任何信息说明它产出了什么 | 本次盘点不产生动作。由这个 URL 助攻的试用注册数能给它定论——而本清单不含这个转化数字 | 保留 |
| /blog/servicetitan-alternatives | 保留 | 已确认 | 与「选软件」那一组重合但得以存活：这个读者已经选定了一个具名竞品、想要一个同类替换，而盘点文给不了这个 | 从 /blog/hvac-scheduling-software 链过来 | 保留 |
| /blog/hvac-invoice-template | 保留 | 按约束确认 | 已列入必留清单，供销售使用。它的 1,905 次点击独立地支持同一判定 | 无 | 保留 |
| /blog/summer-ac-maintenance-checklist | 下线 | 暂定 | 写给技师的，不是写给站点上下文里那位老板的；整个窗口内 9,800 次曝光只换来 44 次点击 | 移除前先查这个 URL 是否助攻过任何试用注册——这个数字不在本清单里，且它会把判定翻成保留 | 410——本站没有任何页面在做季节性保养建议，而把一个技师送到面向老板的操作指南，正是政策排除的那种错配 |

**重合分组**

- 选软件：/blog/hvac-scheduling-software 存活；/blog/hvac-dispatch-software 并入它；/blog/servicetitan-alternatives 单独存活，因为它服务的是一位已经选定竞品的读者。
- 没有其他分组。其余七个页面各自承担不同的工作。

**缺失数据，按字段**

- 每个 URL 的试用注册数：十行全部缺失。有两个判定依赖它——/blog/hvac-technician-pay-guide 的保留，和 /blog/summer-ac-maintenance-checklist 的下线。
- 外链域名：缺失。影响 /blog/holiday-party-2022 的**去向**，不影响它的判定。
- /blog/what-is-dispatch-software 与 /blog/holiday-party-2022 的导出行：缺失，全程按未知处理，**从未按零处理**。
- 最后更新日期：十个页面中只提供了两个；其余页面的陈旧程度只能从发布日期和标题判读。

## Safety notes

执行任何一行「下线」之前，先查这条提示词看不到的两件事：这个 URL 有没有外链域名；以及公司内部有没有人从方案书、入职邮件、帮助文章或广告里链向它。盘点只基于你粘进去的清单工作，而**一个没有搜索流量的页面，仍可能在导出触达不到的地方承重**。合并同理——确认那个 301 的目标页真的回答了被并页面所回答的问题，因为重定向到一个「相邻但不同」的主题，等于把读者送到一个没用的地方。

产出不对任何判定会给流量、排名或收入带来什么作任何宣称，也不给页面打分。它说的是：哪些页面有职责、哪些已经过期、哪些彼此重复、以及每个被移除的 URL 该指向哪里。标为**暂定**的行，是输入无法支撑的决定；它们连同「什么数字能给它定论」一起列出，好让你去把那个数字取来，而不是把判定当成最终结论。

## FAQ

### 两个页面重合时，我怎么在「更新」和「合并」之间选？

问一句：落到任一页面上的读者，想要的是不是同一件事。如果是，那它们就是一个页面，较弱的那个 URL 应该并进较强的那个。如果两位读者在「已经知道什么」上不同——一个在多家厂商里挑，一个已经选定了并想找个替代——那它们是不同的职责，修法是各自更新并互链。这条提示词强制你为每一个分组把这个区分**写下来**，而大部分价值就在这里。

### 我一半的页面在 Search Console 导出里没有行。它们是死的吗？

从导出看不出来，而这条提示词也不会假装看得出来。缺一行可能意味着这个页面在该周期内零曝光、或这个页面没有被收录、或你的导出撞上了行数上限而它掉在了末尾。这三种情况需要三种不同的处理，所以盘点会把这些页面标为暂定，并要求你直接去查那个 URL。**把「缺一行」当成「零流量」，正是站点删掉那些本来在起作用的页面的方式。**

### 410 会比 301 更好吗？

会，当站点上没有任何页面在做那个被移除页面的工作时。把点击者 301 到一个不相关的页面，对他是很差的体验，而且搜索引擎通常会把不相关的重定向当作软 404 处理——于是你付出了重定向的代价却没拿到好处。**有真正的等价物时做重定向；没有、且你已经接受这个页面就是没了时，返回 410。**

### 什么时候这条提示词是错的工具？

两种。当你的清单只有 URL、没有标题、类型或描述时，重合无法判断——slug 不是对页面的描述，而盘点会正确地拒绝去猜。以及当页面是规模化程序生成的（成千上万个地区页或产品属性页）时，一张逐 URL 的决策表根本没法用；那时该盘点的是**模板**和生成这批页面的规则，然后对每种模式套用一个决定。
