---
title: AI 答案可见性
description: 搞清楚 AI 助手的答案实际取自哪里，修掉页面上阻碍检索的东西，并锁定引用真正追踪的那些站外来源。
tagline: 查清 AI 助手在你的主题上引用了谁，以及为什么不是你
category: geo
owner: seo
keywords: AI 可见性, 生成式引擎优化, AI Overview 引用, LLM 引用追踪, AI 答案监测, GEO SEO 技能, AI 答案中的品牌提及
relatedSkills: on-page-seo, content-brief
relatedPrompts: geo-ai-overview-optimization-prompt, faq-generation-schema-prompt
status: published
publishedAt: 2026-08-14
---

## Skill file

```text
---
name: geo-ai-visibility
description: Measure where AI assistants source answers on a topic, fix retrieval blockers on the site, and identify the off-site references that citation depends on. Use when someone asks why ChatGPT, Claude, Perplexity, or Google's AI Overviews cite a competitor instead of them, wants to track brand mentions in AI answers, or asks how to optimise for AI search or GEO — including the bare "we don't show up in AI" with nothing else supplied.
metadata:
  owner: GenGrowth SEO Agent
  source: https://gengrowth.ai/skills/geo-ai-visibility
---

# AI Answer Visibility

Your job is to find out who AI assistants currently cite for a set of
questions, why, and what would have to change. You do not promise that a
page edit will produce a citation, because on its own it usually does not.

## What counts as evidence

Four sources, in descending order of trust:

1. Captured answers — an assistant response you ran and recorded, with the
   exact prompt, the date, the assistant, and every domain it cited.
2. Off-site references — third-party pages that name the brand, each one a
   URL you can open.
3. Server logs — requests from assistant crawler user agents, verified by
   reverse DNS or published IP ranges, proving a page was fetched.
4. Vendor visibility scores — third-party estimates of AI share of voice.
   These are estimates. Label them as estimates every time they appear.

Assistant answers vary between runs, accounts, and regions. One capture is a
sample, not a measurement. Report a capture rate with its sample size and
date ("cited in 2 of 24 captures, 2026-08-11"), never a bare yes or no.

If referral data, crawler logs, or a citation count is not available, write
that it is unavailable and say why. Do not write zero. Zero means you looked
and found none; unavailable means you could not look.

## Procedure

1. Build the question set. Write 20 to 30 questions a real buyer would type
   into an assistant, in their words, covering definitions, comparisons,
   pricing, and troubleshooting. These are questions, not keywords.

2. Capture the baseline before changing anything. Run every question at
   least twice, on each assistant that matters for the market. Record date,
   assistant, prompt, whether an answer was produced, every cited domain and
   URL, and how the topic was characterised.

3. Read the citation pattern. Group cited domains by type: government or
   standards bodies, trade publications, third-party roundups and
   directories, vendor documentation, community threads. The mix tells you
   which surface is actually winnable and which is not worth contesting.

4. Check retrieval preconditions on the site. Confirm the answer text exists
   in the server-rendered HTML, that robots rules and edge protection do not
   block assistant crawlers you want, and that pages return a stable
   canonical URL. Failing these guarantees no citation. Passing them does not
   produce one.

5. Fix extractability. Each page should answer its question in the opening
   lines, make claims that survive being lifted out of context, name the
   entity instead of writing "we", date anything time-sensitive, and use
   headed tables for comparisons. Attribute figures to their source inline.

6. Plan the off-site work, ordered by what the captures actually named. Being
   cited tracks being referenced elsewhere. Target the specific roundups,
   directories, publications, and community threads that appeared in your own
   captures, plus first-party data others have a reason to cite.

7. Re-capture on a fixed schedule with identical prompt wording. Report the
   change in capture rate with sample sizes on both dates.

## Output

A capture log (date, assistant, prompt, cited domains, site cited yes/no); a
citation-source breakdown by domain type; a retrieval and extractability
finding list with the page and the specific blocker; an off-site target list
ordered by how often each domain appeared in the captures; and a list of what
could not be determined and what access would settle it.

## Refuse to

- Promise that on-page changes will produce a citation.
- Report a single capture as proof of presence or absence.
- Report zero where a number was never sampled or is inaccessible.
- Present a vendor visibility score as a measured citation count.
- Claim an assistant crawled a page without a verified log line.
- Promise rankings, traffic, revenue, or a timeline.
- Recommend a keyword density or a repetition count.
```

## What it does

常见的失败是把 AI 可见性当成一份页面检查清单。团队加上 FAQ 标记、在每页顶部放一个摘要框、再写几句听起来适合被引用的话，上线，然后拿一个问题去问助手。品牌出现了，就宣告成功；没出现，就宣告这事坏了。**一次采样推不出任何一个结论。**我们近距离观察过的那个案例，是一个几乎没有站外存在的站点：页面改动上线了，引用并没有随之而来。那是一次观察，不是一个测量出来的效应——而这正是本 skill 把站外来源当作值得投入的部分、而不是承诺「改页面就能被引用」的原因。

本 skill 就是围绕那次观察建起来的。它把页面上的**可提取性**当作前置条件而不是杠杆：如果答案不在服务端返回的 HTML 里，或者爬虫在边缘就被拦住，再多站外工作也够不着它。但它不止步于此，也不会告诉你「重写一段导语」是通往被引用的路径。产出中更大的一半在站外：针对你的那些问题，助手实际上在从哪些出版物、盘点文、目录和讨论帖里取材——这来自你自己的捕获日志，不是靠推测。

度量方式同理。助手的答案在不同运行、不同账号之间会变，所以汇报的单位是**带样本量和日期的捕获率**，而不是一句「出现了」。当引荐数据或爬虫日志拿不到时，产出会写「不可得」并点名需要什么权限才能补上，而不是报一个读起来像结论的零。

## In action

### You ask

我们是 meridian-payroll.com——面向英国建筑业分包商的薪酬软件。上个月我们把所有指南页都「为 AI」重写了一遍，还加了 FAQ 结构化数据。我们现在在 AI 答案里出现了吗？

### The agent does

我在 2026-08-11 用 24 个买家问题、在两个助手上各跑两遍，共 96 次捕获。你们的域名出现了 3 次。

比这个计数更有用的是分布。关于 CIS 扣缴与核验的问题（24 个里的 11 个）几乎每次捕获都引用 HMRC 的官方指引，其次是一家行业媒体。那个面是现实中争不到的，我不会在上面花预算。而比较与选型类的问题——「best payroll software for CIS subcontractors」「payroll software that handles CIS returns」——表现完全不同：它们汇聚到四篇盘点文上，其中三篇根本没有列出 Meridian。你们那 3 次出现全部来自第四篇。

有两个检索问题是真实存在的。你们的定价页用客户端渲染价格表，所以抓取到的 HTML 里没有任何数字。另外，你们的对比页在承载论点的那一句里用的是「our platform」而没有写出 Meridian——这句话一旦被从页面上摘出来就立不住。

来自助手来源的引荐会话**不可得**——这个分析属性把那些来源归进了「直接访问」，我不会把它报成零。一份来源级（referrer-level）的导出可以给它定论。

修掉那两个页面问题是在**移除阻碍**。而进入那三篇盘点文，才是有可能改变这个计数的那件事。

## How it works

### 改动任何东西之前先捕获基线

Agent 用买家的语言写 20 到 30 个问题，在这个市场上重要的那几个助手上各跑不止一遍，并逐字记录每一个被引用的域名，连同日期和提示词。**在这份记录存在之前不做任何编辑**，因为没有基线，后续任何改动都无法归因。

### 读的是「谁被引用」，不只是「你有没有被引用」

被引用的域名按类型分组——政府与标准机构、行业媒体、盘点与目录、厂商文档、社区讨论帖。一个由法定指引主导的问题集，和一个由第三方对比页主导的问题集，是两种不同的问题，而通常只有后者值得去争。

### 清掉检索的前置条件

Agent 会检查：答案文本是否出现在服务端渲染的 HTML 里、robots 规则与边缘防护有没有拦住你本打算放行的爬虫、以及规范 URL 是否稳定。这些被报告为**阻碍项，不是改进项**——因为通过它们本身并不换来引用。

### 去做捕获日志点名的那些面

站外计划是**从捕获日志里长出来的**，不是从一份通用清单里抄来的：那些已经为你的问题出现过的具体盘点文、目录、出版物和讨论帖，加上别人有理由引用的一手数据。复捕使用同一批提示词，好让变化是在同口径基线上度量的。

## What it covers

- 用买家语言写成的助手捕获问题集，与关键词清单分开
- 多助手重复捕获记录，带日期、提示词与每一个被引用的 URL
- 按域名类型做引用来源分析，把可争的面与法定的面区分开
- 检索前置条件检查：服务端渲染的答案文本、爬虫可达性、规范 URL 稳定性
- 对「被摘出页面后必须能独立成立」的论点做可提取性复核
- 从你自己的捕获中提取的站外目标清单，按每个域名出现的频次排序
- 带样本量的捕获率汇报，以及明确的「数据不可得」标记

## When to use it

- 团队已经「为 AI」重写了页面，却没有任何基线可供对照
- 有人拿一个问题问了助手、没看到品牌，就断定站点是隐形的
- 站点持续发布内容，但外部从来没有任何东西引用它
- 买家反馈说助手推荐了竞品，而没人知道它用了哪些来源
- 存在一个厂商给的 AI 可见性分数，但没人说得清它采样了什么、什么时候采的
- 页面把关键数字放在客户端渲染，而没人检查过爬虫实际收到了什么

## FAQ

### 它和「页面 SEO」这个 Skill 有什么不同？

页面 SEO 作用于一个**已经有搜索可见性**的页面，找出限制它的因素。本 skill 从捕获到的助手答案出发，反向追问某个来源为什么被引用，而这通常指向页面之外。两者在一点上重合：服务端渲染、可提取的内容是双方的必要条件。分歧在于：页面工作本身就能移动一个排名；而在我们近距离观察的那个案例里，仅靠页面改动之后并没有出现引用。

### 加 FAQ 结构化数据能让我们被引用吗？

结构化数据帮助机器解析页面，值得拥有，但**我们没有测量过它单独起了什么作用**；在我们近距离观察的那个站点上（它没有站外存在），加了它之后并没有出现引用。把它当作在移除一个障碍。如果你的问题集显示助手在你的主题上引用的是盘点文和行业媒体，那么决定「哪一个来源被引用」的，不是你自己页面上的那段标记。

### 为什么报告给的是捕获率，而不是直接说我们可不可见？

因为助手的答案不稳定。同一个提示词在不同运行、账号和地区可能返回不同来源，所以一句「是」或「否」是把一次采样当成了事实。**带样本量和日期的比率**可以诚实地与下一次运行对照，也让「这次变化小于噪声」这件事一眼看得出来。

### 它能告诉我们 AI 助手带来了多少流量吗？

只有当分析属性能区分那些引荐来源时才能，而很多做不到——助手流量经常被归进「直接访问」。遇到这种情况，本 skill 会把该数字报为**不可得**，并点名什么能给它定论，比如一份来源级导出，或者在你能控制的链接上使用 UTM 约定。它不会估一个数字然后把它当成测量结果呈现。
