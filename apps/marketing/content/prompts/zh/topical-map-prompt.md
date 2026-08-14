---
title: 主题地图提示词
description: 把一个主题变成支柱页与支撑页的层级结构，带内链、一份明确的范围外清单，以及一个与你团队实际产能相符的页面数量。
category: research
useCase: 站点规划
outputFormat: 层级结构
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: 主题地图提示词, 主题权威地图, 支柱页规划, SEO 站点结构提示词, 内容中心结构, 内链规划
relatedSkill: keyword-research
relatedPrompts: seo-keyword-clustering-prompt, search-intent-classification-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are a site planner building a topical map that a small team can actually publish.

# Scope
Plan pages for the subject below. Do not invent search volumes, difficulty
scores, traffic figures, or competitor counts. If a number was not given to
you, leave it out rather than estimating it. A map that lists more pages than
the team can publish, or pages the team cannot write from first-hand
knowledge, is a failed map.

# Inputs
Subject to map: {{subject}}
What the business sells and to whom: {{business_offer}}
What this team can speak about first-hand: {{credibility_basis}}
Pages the team can publish this planning window: {{page_budget}}
Pages that already exist, if any: {{existing_pages}}

# What to produce
A hierarchy of pillar pages and supporting pages, the internal links between
them, an explicit out-of-scope list, and a list of pages that are worth
writing but that this team cannot currently write credibly. The map must fit
inside the page budget. Cutting is part of the job, not a failure of it.

# Steps
1. List the questions a buyer described in {{business_offer}} works through,
   from first awareness to the decision to buy. Work from the subject and the
   buyer, not from keyword patterns.
2. Group those questions into pillars. A pillar is broad enough to introduce a
   whole area and narrow enough that one writer can finish it. Three to five
   pillars is normal; more than that usually means the subject was too wide to
   map in one pass, and you should say so.
3. Under each pillar, list supporting pages. Each must answer one question
   completely. If two would say most of the same thing, merge them.
4. Test every page against {{credibility_basis}}. Name the specific source —
   the data set, the practitioner, the process — that qualifies this team to
   publish it. A page with no named source does not go in the map. It goes in
   the cannot-publish-credibly list, with the evidence that would unlock it.
5. Cut the map down to {{page_budget}}. Keep the pages closest to the buying
   decision and closest to the credibility base. Move everything you cut into
   the out-of-scope list with a one-line reason. Never drop a topic silently.
6. Reconcile against {{existing_pages}}: mark each planned page as new, as an
   update to a page that already covers the same ground, or as a merge target.
7. Assign internal links. Every pillar links down to its supporting pages and
   every supporting page links up to its pillar. Add sibling links only where a
   reader would genuinely move between those two pages.

# Output format
A nested list. Each pillar with its URL slug, page intent, credibility source,
and new/update/merge status; its supporting pages indented under it with the
same four fields. Then the internal link plan, a table of out-of-scope topics
with reasons, the cannot-publish-credibly list, and one line giving planned
pages against the budget.

# Quality checks before you answer
- The planned page count is at or under {{page_budget}}, and you state both.
- Every page names a specific source from {{credibility_basis}}. None of them
  says "general industry knowledge" or "our expertise".
- Every topic you considered and cut appears in the out-of-scope list.
- No two supporting pages answer the same question.
- Every page has at least one internal link in and one internal link out.
- No search volume, keyword difficulty, or traffic figure appears anywhere.

# When the input is thin
If {{credibility_basis}} is empty or generic, say so and stop before assigning
pages: a map built on unstated expertise is guesswork dressed as a plan. If
{{page_budget}} is missing, ask for it instead of assuming a number. If the
subject is too broad for the budget, map one slice, name it, and say plainly
which parts of the subject you left unmapped.

# Boundaries
Do not promise rankings, traffic, or timelines. Do not recommend a keyword
density or a number of repetitions. Do not pad the map to reach a round number
of pages. Do not plan pages that give regulated advice — medical, legal,
financial, or safety-critical — unless {{credibility_basis}} names a qualified
reviewer who will sign them off.
```

## Variables

### subject
Required. 你想拿下的那个领域，**写成一个主题而不是一个关键词**。窄到读者能认出它是一个知识领域。
Example: Cold chain temperature monitoring for food and pharmaceutical shipments

### business_offer
Required. 这个生意卖什么、谁来买。它决定了哪些问题值得一个页面、哪些属于别人的漏斗。
Example: Bluetooth and single-use temperature data loggers plus a shipment dashboard, sold to QA and logistics managers at mid-size food and pharma distributors

### credibility_basis
Required. 一手知识的具体来源：具名数据集、具名从业者、自有流程。**这里写得含糊，产出的地图就含糊——这是最常见的一种失败。**
Example: In-house ISO 17025 calibration lab; anonymised temperature traces from about 12,000 customer shipments; a QA lead who was a GDP-responsible person for six years

### page_budget
Required. 在这个规划周期内团队真能发布多少个页面，以及由谁来做。**正是这个数字逼着地图停下来。**
Example: 14 pages over two quarters, one writer plus one part-time QA reviewer

### existing_pages
Optional. 已上线页面的 slug 和标题，好让模型分辨「新建」「更新」和「合并」。
Example: /blog/what-is-cold-chain; /docs/calibration-certificates

## How to use

五个占位符都要填，但力气花在 `credibility_basis` 上。**它是那个改变产出的变量。**「我们很懂这个行业」产出的地图与竞品的无从区分，因为模型没有任何东西可用来过滤；而「一个 ISO 17025 实验室、12,000 条运输温度轨迹、一位当过六年 GDP 责任人的质量负责人」，产出的地图里会有三四个**别人写不出来**的页面。列出**实物证据**，不要列形容词。

**自下而上地读产出。**先看页面计数那一行，再看范围外清单。你真正会撞上的失败，是一份在标题计数上遵守了预算、却在暗中超额的地图——通常是在支撑页下面又嵌了第三层子支撑页，或者把「FAQ 中心」当作一个页面来列，而它其实是十一个。**自己去数叶子节点。**第二种失败是范围外清单上只有两条，那意味着模型压根没有生成足够多的候选、以至于不需要砍任何东西；把预算减半重跑一次，看它牺牲了什么，然后在知道它把哪些页面排在最低位之后，再把预算恢复。

某个支柱回来不对时，**只重跑那个支柱**，不要重跑整份地图。把那个支柱和它的支撑页粘回去，说明哪里不对——太宽、与上面那个支柱重合、没有可信度来源——然后只要这一支。整份地图重新生成，会打乱你已经接受的分支，还会连带丢掉与你已有页面的对账结果。

把「暂时还写不可信」的清单当作**待办事项，不是拒绝**。每一条都点名了能解锁这个页面的证据：一位复核人、一个数据集、一个愿意具名的客户。其中有些只是一周的工作，而那个页面会成为全站最强的一个。

## Example input

```text
Subject to map: cold chain temperature monitoring for food and pharmaceutical shipments
What the business sells and to whom: Thermalog sells Bluetooth and single-use temperature data loggers plus a shipment dashboard, to QA and logistics managers at mid-size food and pharma distributors in the EU and US
What this team can speak about first-hand: nine years of logger manufacturing; an in-house ISO 17025 calibration lab; anonymised temperature traces from about 12,000 customer shipments; a QA lead who spent six years as a GDP-responsible person at a pharma wholesaler
Pages the team can publish this planning window: 14 pages over two quarters, one writer plus one part-time QA reviewer
Pages that already exist: /products/bluetooth-logger; /blog/what-is-cold-chain; /docs/calibration-certificates
```

## Example output

**主题地图 — 冷链温度监控**

- **/cold-chain-monitoring** — 支柱页。一套监控体系端到端包含什么。来源：12,000 条运输轨迹存档。*更新* — 吸收 /blog/what-is-cold-chain 并做重定向。
  - /cold-chain-monitoring/choosing-a-data-logger — 按运输类型与时长的选型指南。来源：九年制造经验。*新建*
  - /cold-chain-monitoring/logger-placement — 记录仪在托盘、冷藏车或包裹中该放在哪。来源：轨迹存档，把放置位置与已记录的超温事件对照。*新建*
  - /cold-chain-monitoring/single-use-vs-reusable — 成本与操作上的取舍。来源：自有产品线的单位经济性。*新建*
- **/temperature-excursions** — 支柱页。什么算超温事件、之后必须发生什么。来源：质量负责人。*新建*
  - /temperature-excursions/investigation-checklist — 报警之后质量团队要跑的步骤。来源：质量负责人。*新建*
  - /temperature-excursions/mean-kinetic-temperature — 用真实轨迹算一遍。来源：校准实验室、轨迹存档。*新建*
  - /temperature-excursions/alarm-thresholds — 如何设定不会把团队淹没在告警里的阈值。来源：轨迹存档、按阈值分的误报率。*新建*
- **/calibration** — 支柱页。对温度记录仪来说校准意味着什么。来源：ISO 17025 实验室。*新建*
  - /calibration/reading-a-certificate — 逐字段解读。*合并* — /docs/calibration-certificates 已经覆盖这个；扩写它，而不是再发一个页面。
  - /calibration/recalibration-intervals — 多久校一次，以及如何为这个间隔给出依据。来源：实验室漂移记录。*新建*
  - /calibration/in-house-verification — 两次送检之间的冰点与参考点自查。来源：ISO 17025 实验室。*新建*
- **/lane-qualification** — 支柱页。证明一条运输线路能守住温度。来源：质量负责人、轨迹存档。*新建*
  - /lane-qualification/seasonal-profiling — 为什么夏季一趟和冬季一趟是两项不同的研究。来源：轨迹存档。*新建*
  - /lane-qualification/mapping-protocol — 发货之前怎么把方案写出来。来源：质量负责人。*新建*

**内链。** 每个支柱页向下链到它自己的支撑页；每个支撑页向上链回它的支柱页。交叉链接：choosing-a-data-logger → /products/bluetooth-logger（已有页面，不新建）；alarm-thresholds → logger-placement（阈值问题往往是放置问题）；reading-a-certificate ↔ recalibration-intervals。

**范围外**

| 主题 | 理由 |
| --- | --- |
| 欧盟 GDP 合规指引 | 属于受监管的建议。团队可以描述要求，但不能为读者的具体运营去解释它。 |
| 制冷机组选型与维修 | 没有一手依据。Thermalog 做的是记录仪，不是冷藏机组。 |
| 报关与进口单据 | 位于「买不买记录仪」这个决策之外。 |
| 编写 HACCP 计划 | 相邻主题，不同买家，不同服务。 |
| 「最佳冷链监控软件」 | Thermalog 会是在给自己排名。这个页面不可能中立。 |

**值得写，但目前还不可信**

- 超温之后如何放行一批货 — 这是一个质量放行决策。解锁条件：由那位 GDP 责任人质量负责人复核，且页面发布的是**判定标准**而不是一个结论。
- 如何准备 GDP 检查 — 解锁条件：找到一位做过审核方的具名共同作者。

**预算：计划 14 个，可用 14 个。** 两个主题延后，五个在范围外。

## Safety notes

复核者必须**核实那些可信度声明**，因为提示词做不到。模型把你写进 `credibility_basis` 的一切当作真的，并把这些来源挂到页面上；如果轨迹存档其实是 300 条而不是 12,000 条，或者那位质量负责人上个季度已经离职，地图照样会自信地引用他们。写手动笔之前，把每一个具名来源对着现实核一遍；同时确认地图里没有哪个页面，在一个泛用标题之下悄悄给出了受监管的建议。

**这份地图是发布计划，不是预测。**它不含搜索量、不含难度分，也不宣称任何页面会拿到排名或流量——这些数字不在输入里，所以提示词被要求宁可不写，也不去估算。如果你需要机会数据来决定建设顺序，从关键词工具里取来，事后再给地图排序。

## FAQ

### 一份地图该有几个支柱？

一个规划周期三到五个。只有两个，通常意味着这两个支柱其实是同一个主题被随意切开了。六个或更多，意味着这个主题宽到无法一次性映射，而诚实的做法是挑离购买决策最近的那一片来做。这条提示词的写法是把这句话说出来，而不是产出一份它支撑不了的、蔓延开来的地图。

### 为什么这条提示词一定要一个页面预算？

因为**没有边界的主题地图正是这项工作的标准失败模式**。一份 180 页的地图交给一个写手，就是一个没人做得完的积压清单，而真正被写出来的会是容易的那些，不是重要的那些。**把砍单前置**，会迫使模型拿页面去对照可信度基础和购买决策来排序，而它产出的那份范围外清单，往往比地图本身更有用。

### 什么情况下这条提示词不好用？

两种。第一，团队在这个主题上确实没有任何一手依据——产出会大部分是延后的页面，这是正确答案但不是一份可用的计划；该修的是输入，不是提示词。第二，大型目录站——那里多数页面是由数据库生成的品类与产品模板。这条提示词映射的是编辑型页面以及它们之间的链接；它不规划分面导航或模板层级。

### 我能直接用这些 slug 吗？

把它们当作**规划标签**。它们可读、一致，便于评审层级结构，但它们忽略了你既有的 URL 约定和你身上背着的任何重定向历史。在动工之前，把它们映射到你真实的结构上；**不要仅仅为了贴合计划的形状，就去重构线上 URL。**
