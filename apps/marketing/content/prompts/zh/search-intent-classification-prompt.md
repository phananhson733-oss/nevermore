---
title: 搜索意图分类提示词
description: 按「搜索者想要什么、这意味着该做哪类页面」给关键词清单分类；意图从当前排名的结果里读，没人看过的一律标为未核实。
category: research
useCase: 关键词分诊
outputFormat: 表格
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: 搜索意图分类提示词, 关键词意图分析, SERP 意图提示词, 信息型与交易型关键词, 关键词分诊提示词, 搜索意图分类体系
relatedSkill: keyword-research
relatedPrompts: seo-keyword-clustering-prompt, topical-map-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are a search analyst sorting a keyword list by what the searcher wants and
what page each keyword implies.

# Scope
Read intent from evidence, not from wording. Where the operator pasted what
currently ranks, read intent from those results. Where they did not, mark the
intent unverified rather than presenting a guess as a finding. Do not invent
results, titles, domains, positions, volumes or difficulty scores.

# Inputs
What the site sells and to whom: {{site_context}}
Market and language the results were read in: {{market_and_language}}
Keywords, one per line: {{keyword_list}}
What currently ranks, for the keywords the operator looked at:
{{serp_observations}}

# What to produce
One row per keyword giving its intent, the evidence that intent rests on, the
page type it implies, and the next step. Every row must make clear whether the
intent was read from live results or from wording alone.

# Steps
1. For each keyword, check whether observations were supplied for it. Handle the
   two groups differently and never blur them.
2. For an observed keyword, count the results by what each is there to do, not
   by its format: explain a concept, walk through a procedure, compare options,
   hand over a file, or sell a product. A guide explaining a term and a guide
   walking through steps are two intents wearing the same word.
3. If one intent holds a clear majority — six or more of ten results, or the
   same share of a shorter list — that is the keyword's intent. Label the row
   observed and put the count in the basis.
4. If no intent reaches that majority, label the row split and name the two
   largest. A split is a decision, not a classification: one page cannot serve
   both, so say which slice this site can serve and state plainly that the
   other is given up.
5. For a keyword with no observations, give a provisional intent only when the
   wording carries a single reading — "how to ..." is a procedure, "... template"
   wants a file. Where the wording carries more than one reading, write uncertain
   and stop there. Either way, label the row unverified.
6. Map intent to page type: concept page, procedure, roundup naming the
   alternatives, working tool page, product page. Where the results are held by
   a kind of site this one is not — marketplaces, review sites, code hosts,
   forums — say so; the page type is still achievable, but the slot is
   contested by a different sort of page.
7. Order the rows: observed first, then split, then unverified.

# Output format
A table: Keyword | Intent | Evidence | Basis | Page type | Next step.
Evidence is exactly one of observed, split, or unverified.
Then two short lists: the split keywords with the choice each one forces, and
the unverified keywords with what to look at to settle them.
Close with one line naming the market, language and date the observations were
read in, and stating that the rows do not carry over to another market.

# Quality checks before you answer
- Every input keyword appears exactly once in the table.
- No row is labelled observed unless observations for that keyword were pasted.
- Every observed row's basis names counts that were actually supplied.
- No result, title, domain or position appears that was not in the input.
- No volume, difficulty, traffic or position figure appears anywhere.
- The same wording in two markets is kept as two rows, not merged.

# When the input is thin
If no observations were supplied at all, classify anyway, label every row
unverified, and say at the top that nothing has been checked against live
results. If the market and language are missing, say that intent for the same
words differs by market and that the reading applies only to the market the
operator had in mind. Do not close either gap with an assumption.

# Boundaries
Do not describe results you were not shown. Do not promise rankings or traffic.
Do not recommend a keyword density or a repetition count. Do not upgrade an
unverified row to observed because the classification looks obvious.
```

## Variables

### site_context
Required. 这个站点卖什么、卖给谁，一句话。它决定了当一个查询词的结果是分裂的时候，站点实际能接住哪一半。
Example: Ridgeline, a self-hosted status page and uptime monitoring tool sold to engineering teams at companies of 50-500 people

### keyword_list
Required. 一行一个关键词，按搜索者输入的原样。不要带指标；这条提示词只分类意图，不使用搜索量。
Example: statuspage.io alternatives / what is an slo / uptime monitoring

### market_and_language
Optional. 你是在哪个国家、哪种语言下读的结果。同样的措辞在不同市场意图不同，写上它可以避免两个市场被并成一行。
Example: United States, English

### serp_observations
Optional. 对你查过的每个关键词，给一份按类型计数的结果摘要。**有计数就够了**，不需要完整 URL。
Example: uptime monitoring — 7 vendor product or homepage results, 2 review-site category pages, 1 encyclopedia entry

## How to use

观察那个变量承载了整个页面的重量，而**计数**就是要干的活。你不需要把完整的结果页粘进来——每个关键词一行、写成 `关键词 — 前十里有 N 个是<类型>，M 个是<类型>` 就够了。**退出登录**并在你的目标市场下读结果；用错误国家的已登录状态读一遍，会给你一份关于「你的搜索者根本看不到的结果」的自信分类。没查过的关键词也值得放进去，因为产出会告诉你该优先查哪些。

你真正会撞上的失败，是模型悄悄把一行未核实的记录**升格**了。症状是「依据」那一格读起来像一次真实观察——「结果由产品页主导」——而你对这个关键词其实什么都没粘。先扫「证据」这一列，再读别的；然后逐行核对被标为「已观察」的行，看它的依据是不是你粘的内容。如果出现了一个你没提供的计数，**整行丢掉**，而不只是丢掉那个数字：一个编造了一次计数的模型，通常连围绕它的推理一并编了。

当计数与你自己的判读不一致时，几乎总是因为模型数的是**格式**而不是意图。一篇解释「什么是 SLO」的长文和一篇讲「怎么设定 SLO」的长文，格式相同、意图不同。把那个关键词的观察重新粘一遍，逐条结果写明**目的**而不是版式，然后只重跑那一个关键词。

**先处理分裂的那几行。** 内容规划正是在这里悄悄走偏：一个页面被建成同时服务两个意图，没有人会注意到，直到它上线一个季度、两个都没服务好。

## Example input

```text
What the site sells and to whom: Ridgeline, a self-hosted status page and uptime monitoring tool sold to engineering teams at companies of 50-500 people
Market and language: United States, English
Keywords:
self hosted status page
statuspage.io alternatives
what is an slo
uptime monitoring
free status page
status page software
how to write an incident postmortem
best uptime monitoring tools
What currently ranks (top ten, read 2026-08-12, United States, logged out):
self hosted status page — 6 roundups of open-source options, 2 GitHub repositories, 1 vendor self-hosted product page, 1 forum thread
statuspage.io alternatives — 6 roundup posts on vendor blogs, 2 review-site category pages, 2 vendor comparison landing pages
what is an slo — 4 long-form explainers on vendor blogs, 3 glossary pages, 2 vendor documentation pages, 1 video
uptime monitoring — 7 vendor product or homepage results, 2 review-site category pages, 1 encyclopedia entry
free status page — 4 vendor free-plan landing pages, 3 "best free" roundups, 2 GitHub repositories, 1 vendor pricing page
```

## Example output

| 关键词 | 意图 | 证据 | 依据 | 页面类型 | 下一步 |
| --- | --- | --- | --- | --- | --- |
| self hosted status page | 比较 | 已观察 | 前十里 6 个是开源方案盘点；2 个代码仓库，1 个厂商页，1 个论坛帖 | 点名各个备选方案的盘点文 | 发一篇诚实的盘点，列出这些开源工具并把 Ridgeline 放进去。在这里放产品页要跟六篇清单文竞争。 |
| statuspage.io alternatives | 比较 | 已观察 | 6 个是盘点；另外 4 个也在做比较（2 个评测站品类页，2 个厂商对比页） | 点名 statuspage.io 的替代方案页 | 做。有两个位置由厂商占着，所以这里并不排斥厂商页。 |
| what is an slo | 定义 | 已观察 | 前十里 9 个在解释概念：4 篇讲解、3 个术语页、2 个文档页 | 概念页，长篇 | 写一份完整解释：排名最短的那个结果也是一整页，所以一个术语条目不匹配。 |
| uptime monitoring | 购买 | 已观察 | 前十里 7 个是厂商产品页或首页；2 个评测站品类页，1 个百科条目 | 产品页 | 把现有产品页指过来。放一篇指南要跟七个产品页竞争。 |
| free status page | 混合：购买与比较 | 分裂 | 没有任何一种意图达到 6 个：5 个厂商页（4 个免费版页、1 个定价页），3 个盘点，2 个代码仓库 | 一个页面无法同时服务两者 | 见下面的决策。 |
| status page software | 不确定 | 未核实 | 未提供结果；措辞既可读作「浏览一个品类」，也可读作「购买一个产品」 | 未定 | 下单写作之前先读前十。 |
| how to write an incident postmortem | 操作指引 | 未核实 | 措辞只有一种读法；未提供结果 | 带完整示例的流程 | 查一下模板类结果是否占据前排；如果是，这个页面需要的是一个文件，不是散文。 |
| best uptime monitoring tools | 比较 | 未核实 | 「best」意味着一份清单，但清单由谁拥有未知；未提供结果 | 盘点 | 查一下评测站是否占了多数位置；如果是，这个位置是被争夺的。 |

**分裂结果逼出的决策**

- `free status page` — 前十里 5 个位置是卖免费版的厂商页，3 个是盘点。Ridgeline 两边都能服务，但不能在同一个 URL 上服务。如果确实有免费档，就做免费版页面、放弃盘点。如果没有，两个都别做：那个页面将不得不暗示一件产品并不提供的事。

**未核实的关键词，以及什么能定论**

- `status page software`、`how to write an incident postmortem`、`best uptime monitoring tools` — 在美国、退出登录状态下读前十，并按目的给结果计数。上面已观察的内容**没有**任何一条被搬运到这些行上。

**市场说明：** 所有「已观察」的行都是 2026-08-12 在美国、英语环境下读的。同样的词在另一个市场或语言下可能返回不同的组合；这些行不适用于那里。

## Safety notes

在你信任任何一行之前，先核「证据」这一列。复核者在这里的职责很窄、也很机械：确认每一行标为「已观察」的，都对应你真正粘进去的观察；确认「依据」格里的每个计数都与你粘的内容一致；确认产出里任何地方都没有出现域名、标题、排名位次或搜索量数字。**从结果读出的意图，是对某一天、某个市场、退出登录状态下的一次快照的判读**——结果会移动，一份六个月前的分类，在据它下单写页面之前值得重新看一眼。

产出刻意不说这个站点能不能拿下这些位置。它说的是搜索者想要什么、哪种页面类型回答它；至于这个结果有多难争、以及这个站点有没有资格进场，是另一些问题，而这条提示词拒绝用它拿到的输入去回答。标为「已观察」意味着结果被数过了，不意味着这个分类会一直成立。

## FAQ

### 我必须给每个关键词都粘结果吗？

不必。未核实的行对分诊仍然有用，产出还会按「什么能给它定论」给它们排序。规则比这更窄：**不要根据一行未核实的记录下单写页面**。查一个关键词只要几分钟；而给一个由产品页占据的查询词写一个定义页，代价是一个页面加上写它那个人的时间。

### 为什么同一个关键词在英国和美国分类不同？

因为结果是本地化的，而意图跟着结果走、不跟着词走。同一个查询在一个国家返回的多是厂商产品页，在另一个国家可能多是盘点文，这会改变你该建的页面类型。这就是为什么这条提示词把不同市场保持为**不同的行**、拒绝合并，也是为什么产出末尾那条市场说明不是装饰。

### 遇到分裂结果该怎么办？

你来选，并且接受随之而来的损失。这条提示词会点出那两个意图并拒绝取平均，因为一个为两者而建的页面通常两者都服务不好。挑你的产品真能服务的那一半；如果两半你都无法诚实地服务——比如给一个没有免费档的产品做免费版页面——正确答案是放着这个关键词不动，而不是照做不误。

### 什么情况下它不好用？

三种。结果稀薄或不稳定的查询——十个结果并不代表一个已经定型的意图，下个月再读会不一样。本地意图很强的查询——结果因城市而异，一次全国性的判读会误导人。以及含混的品牌词或缩写查询——结果反映的是你没打算指的那个含义。它也无法告诉你结果上一次变化是什么时候，所以除非你把日期记下来，一次陈旧的观察看起来和一次新鲜的观察一模一样。
