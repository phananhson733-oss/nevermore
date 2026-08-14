---
title: SERP 竞品分析提示词
description: 读那些真正在为某个查询词排名的页面，得出「一个页面要属于这里必须满足什么」，以及一个直截了当的判断：你的站点到底该不该做这个词。
category: research
useCase: 竞争复盘
outputFormat: 分析
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: SERP 分析提示词, SERP 竞品分析, SEO 竞品分析提示词, 搜索结果分析提示词, SERP 意图分析, 搜索结果竞品调研
relatedSkill: seo-audit
relatedPrompts: search-intent-classification-prompt, seo-content-brief-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are a search analyst reading one result page to decide what a page must
contain to belong on it, and whether the query is worth contesting at all.

# Scope
Analyse only the results pasted below. You have not browsed the web. Do not add
results you were not shown, do not describe content you were not given, and do
not invent domain ratings, backlink counts, traffic figures, word counts, or
publication dates. If a result was supplied as a title and URL only, say what
can be read from a title and stop there.

# Inputs
Query, market and device: {{target_query}}
Our site and what it can credibly publish: {{our_site}}
The ranking results, pasted: {{ranking_pages}}
Other elements on the result page: {{serp_features}}
Our page for this query, if we have one: {{our_page}}

# What to produce
Two things. The shared requirements a page needs to belong on this result page,
and a direct verdict on whether our site should target the query.

# Steps
1. Classify every result by publisher type — marketplace, retailer, forum or
   other user-generated content, news, data publisher, vendor or brand,
   independent publisher, training provider, government or standards body — and
   by page type, meaning what kind of page it actually is.
2. For each result, name the one asset the page could not have been written
   without: a proprietary dataset, live inventory, first-hand accounts, an
   institutional mandate, or nothing beyond ordinary research.
3. List the elements that recur across the results, each with a count out of the
   number of results you were shown. Write "5 of 8", never "most pages". An
   element on one or two pages is a variation, and label it as one.
4. Decide who the searcher is, and name the pasted result that is the clearest
   evidence for that reading.
5. Judge contestability. Can a page of our type carry the asset the leading
   results carry? If the top results hold data, inventory, or user testimony we
   cannot obtain, say so plainly and recommend against the query. "Do not target
   this" is a valid answer and often the correct one.
6. Separately from difficulty, check audience. State whether the person this
   result page serves is the person our site sells to. A contestable query
   aimed at the wrong reader is still the wrong query.
7. Give the verdict in one of three forms — target it, target a different query
   in this area, or do not target it — with the reason in one sentence.

# Output format
The verdict line first. Then a table: Position | Publisher type | Page type |
Asset we would have to match. Then the requirements list with counts. Then the
intent read. Then the recommendation, including what our page would have to
carry if the verdict is to target it. Close with a short list of what this
analysis cannot tell you from the input you were given.

# Quality checks before you answer
- Every claim about a page traces to text that was pasted to you.
- Every requirement carries a count out of the results shown.
- No authority, traffic, or page-age figure appears that was not supplied.
- The verdict is one sentence and picks one option rather than hedging across
  all three.
- Where the results are dominated by page types our site cannot publish, the
  verdict says do not target instead of proposing a way to compete.

# When the input is thin
Fewer than five results, or results given as titles alone, still get an
analysis, but open by saying the sample is too small or too shallow to
establish a requirement and mark every requirement as provisional. Never fill a
missing result in from memory of what usually ranks for queries like this one.

# Boundaries
Do not predict positions, traffic, or timelines. Do not recommend a keyword
density or a number of repetitions. Do not describe any page you were not
shown, including our own page when its content was not pasted.
```

## Variables

### target_query
Required. 确切的查询词，加上取样时的市场、语言和设备。**把取样日期也写上**，这样这份分析是带日期的。
Example: hvac technician salary — United States, English, desktop, sampled 2026-08-12 in a logged-out session

### our_site
Required. 这个站点卖什么、卖给谁、它能可信地发布什么类型的页面。**把你没有的东西也写明**，比如没有数据集、没有用户评价——正是它决定了这个位置可不可争。
Example: Fernpost — scheduling software for HVAC contractors running 5 to 50 technicians; no compensation dataset, no job listings

### ranking_pages
Required. 结果的原样，一行一个：位次、URL、标题，以及页面上**实际有什么**。你对页面结构和它写明的数据来源记录得越多，模型要猜的就越少。
Example: 3. ziprecruiter.com/Salaries/HVAC-Technician-Salary — "HVAC Technician Salary" — percentile bands, city comparison table, count of open postings

### serp_features
Optional. 结果页上除蓝色链接之外的一切：AI Overview 及它引用了谁、People Also Ask、广告、本地包、购物轮播、视频模块。
Example: AI Overview citing bls.gov, indeed.com and ziprecruiter.com; People Also Ask with four questions; no ads

### our_page
Optional. 你已有的、面向这个查询词的页面的 URL 和标题，以及它在样本中的位置（如果在的话）。
Example: /learn/hvac-technician-pay-guide — "What HVAC Technicians Earn" — not in the top ten sampled

## How to use

填任何东西之前，**先自己取一次样**。退出登录、显式设定市场，并把日期记进 `target_query`——在个性化会话里读到的结果页是另一个结果页，而分析会继承你取到的那份样本。然后逐条打开结果、把页面上有什么写下来，以此填 `ranking_pages`：它展示了什么数据、有没有点名来源、带不带日期。**光有标题，不足以支撑一条要求。**

你会撞上的失败是模型**悄悄凭记忆描述页面**。粘八个标题、不带任何页面细节，你会得到一份自信的「这些页面包含什么」清单——因为模型见过成千上万个这类页面。提示词要求它止步于「标题能支撑的范围」，但你要逐行拿产出对你粘的内容核。分析里任何不在你输入中的内容都是编造的，而**样本量和更新日期通常是它起头的地方**。

第二种失败是**和稀泥**。问模型某个查询词可不可争，默认答案是「竞争激烈，但用足够好的内容是可以做到的」。那不是答案。收到这种回答就回两个问题：我们的页面会挤掉你粘进去的**哪一个**结果？它会带着这个结果所没有的**什么资产**？两个都答不上来，诚实的判断就是「不要做」，而这条提示词的写法是直接抵达这个结论。

判断是「不要做」时，**不要换个更软的措辞重跑**。去跑建议里点名的那个相邻查询词——通常是同一主题、但由真正向你买单的那个人来问的版本——并把原来那个查询词当作已结案。

## Example input

```text
Query, market and device: hvac technician salary — United States, English, desktop, sampled 2026-08-12 in a logged-out session
Our site and what it can credibly publish: Fernpost — scheduling and dispatch software for HVAC contracting businesses running 5 to 50 technicians. We publish operations guides for owners on /learn. We have no compensation dataset and no job listings.
The ranking results, pasted:
1. indeed.com/career/hvac-technician/salaries — "HVAC Technician salary in United States" — salary profile; average hourly rate "based on 24,318 salaries reported"; top-paying cities table; links to open jobs; updated 4 August 2026
2. bls.gov/ooh/installation-maintenance-and-repair/heating-air-conditioning-and-refrigeration-mechanics-and-installers.htm — "Heating, Air Conditioning, and Refrigeration Mechanics and Installers" — Occupational Outlook Handbook entry; median annual wage, wage percentiles, state employment and wage data, employment projections; updated April 2026
3. ziprecruiter.com/Salaries/HVAC-Technician-Salary — "HVAC Technician Salary" — percentile bands at the 25th, 50th, 75th and 90th, city comparison table, count of open postings
4. glassdoor.com/Salaries/hvac-technician-salary-SRCH_KO0,15.htm — "HVAC Technician Salary" — total pay estimate split into base pay and additional pay, confidence range, employee-submitted figures
5. salary.com/research/salary/benchmark/hvac-technician-salary — "HVAC Technician Salary" — benchmark percentile chart, pay by years of experience, related job titles; updated July 2026
6. reddit.com/r/HVAC/comments/1k2p8xq — "What are you guys actually making?" — discussion thread, 340 comments, technicians posting regional pay, union and non-union, overtime detail
7. servicetitan.com/blog/hvac-technician-salary — "HVAC Technician Salary Guide" — vendor blog post; national average, pay by experience level and certification, state table attributed to BLS; updated June 2026
8. rsi.edu/blog/hvac-tech-salary-guide — "How Much Do HVAC Techs Make?" — training provider blog; salary range, apprentice to journeyman progression, certification and licensing requirements
Other elements on the result page: AI Overview at the top citing bls.gov, indeed.com and ziprecruiter.com; People Also Ask with four questions; no ads, no local pack, no shopping carousel
Our page for this query, if we have one: /learn/hvac-technician-pay-guide — "What HVAC Technicians Earn" — published March 2026; not present in the top ten sampled above
```

## Example output

**判断：不要用 Fernpost 的页面去做这个查询词。** 八个结果里有六个建立在 Fernpost 并不拥有的薪酬数据之上，而这个页面服务的读者是**在查自己工资的技师**，不是买排班软件的承包商。

| 位次 | 发布方类型 | 页面类型 | 我们必须匹配的资产 |
| --- | --- | --- | --- |
| 1 | 招聘平台兼数据发布方 | 薪酬档案页 | 24,318 份自报薪资 |
| 2 | 政府机构 | 职业手册条目 | 一项联邦工资调查，以及执行它的法定职权 |
| 3 | 招聘平台 | 分位数薪酬页 | 持续刷新的在招职位量 |
| 4 | 招聘平台 | 总薪酬估算 | 雇员提交的基本工资与额外收入 |
| 5 | 数据发布方 | 基准报告 | 已授权的薪酬基准数据 |
| 6 | 论坛，用户生成 | 讨论帖 | 340 条一手薪资自述，含工会与非工会 |
| 7 | 软件厂商 | 博客指南 | 没有我们拿不到的东西；就是围绕 BLS 数字做的常规调研 |
| 8 | 培训机构 | 博客指南 | 来自自办学校的执照与学徒制细节 |

**要求，按所示 8 个结果计数**

- 写明工资数字（均值、区间或分位数）：8 中 7 —— 除 Reddit 帖之外的每一个结果
- 在页面上点名数字的出处：8 中 5 —— 结果 1、2、4、5、7
- 按州或城市拆分：8 中 4 —— 结果 1、2、3、7
- 可见的最后更新日期：8 中 4 —— 结果 1、2、5、7
- 通往在招职位的入口：8 中 3 —— 结果 1、3、4
- 按经验层级或认证分的薪酬：8 中 3 —— 结果 5、7、8。**这是一种变体，不是一条要求。**

**意图：** 求职者与在职技师在查自己的工资。最清楚的证据是结果 6——一个 340 条评论、技师们互相比对工资条的帖子；旁证是 AI Overview 引用了 BLS、Indeed 和 ZipRecruiter——三个工资数据持有方，没有一个厂商。

**建议：** 结果 7 表明软件厂商可以出现在这里，所以这并非不可能。但它排在所有数据持有方之下，而且它触达的读者是**雇员**，不是 Fernpost 要卖的那些**老板**。别再把 /learn/hvac-technician-pay-guide 当获客页面。如果它能带来支持问询或销售对话，就保留它，并**改写成雇主视角**——每名技师该预算多少、薪酬带宽如何影响留存——那是另一个查询词、另一个页面。

**这份分析无法告诉你什么：** 未提供任何权重、外链或流量数字，所以这些结果**没有按难度排序**。页面内容是以摘要形式粘进来的、不是全文，因此这些计数描述的是**你记录下来的东西**，不是页面包含的全部。这里也没有解释为什么 /learn/hvac-technician-pay-guide 不在样本中，因为那个页面不在所示结果之列。

## Safety notes

在据此行动之前，先拿产出核你粘的内容。分析里每一个发布方类型、样本量和更新日期，都应能追溯到你写下的某一行；其余的都是模型在重建一个它以前见过的页面。**计数是最容易核实、也最承重的部分**——因为一条要求之所以成为要求，就在于它反复出现。

这份分析描述的是：在你取样的那一天，这个结果页上的页面有什么共同点。它不预测位次、不估算流量；而「值得做」这个判断，是「你的站点能拿出同样的资产」这一判断，不是「它会拿到排名」这一预测。凡是数据缺失的地方，产出会明说而不是把缺口填上；**任何读起来比你的输入更自信的版本，都应视为错的**。

## FAQ

### 我该粘多少个结果？

前十是可用的样本量，计数也是按它校准的。少于五个时，提示词会把每条要求都标为暂定——这是对的，但用处不大：两个页面共有某个元素，说明不了它是不是被预期的。翻到第一页之外很少改变判断，只会加进搜索者从来看不到的页面。

### 为什么要粘结果，而不是让模型自己去浏览？

因为你**无法审计**浏览工具返回了什么。它抓到的是一个个性化的、缓存的、或地理位置不同的结果页，然后模型会把「它抓到的」和「它本来就相信的那些域名的样子」混在一起，中间没有任何标记加以区分。粘贴让输入变成固定且可核的，而这正是「每条主张都能追溯到粘贴内容」这条检查有意义的唯一原因。

### 判断回来是「不要做」。然后呢？

认真对待它；这正是这条提示词存在要产出的结论。读「资产」那一列，找出搜索者真正想要的是什么——如果他们想要的是一个数据集或一手自述，那写再多也替代不了。然后拿建议里点名的那个相邻查询词再跑一次——是**你的买家**会打的那个词，而不是你买家的员工会打的那个——看看那个结果页是不是由和你同类型的发布方占据。

### 它适用于本地类和购物类查询吗？

不太适用。当结果页被本地包、购物轮播或视频模块主导时，下面的自然结果并不是点击的去处，分析它们等于在分析错误的竞争对象。你仍然应该把看到的记进 `serp_features`，并把判断理解为**只适用于自然结果那一片**——对这类查询，真正的决策通常关于商户列表、商品数据源或评价，而这条提示词不覆盖那些。
