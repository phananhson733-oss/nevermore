---
title: 关键词调研
description: 把一个站点和一个市场，变成一份你守得住的关键词集合，并把「测量到的」和「推断出来的」分开。
tagline: 找出值得写的搜索词——并说清每个数字从哪来
category: seo
owner: seo
keywords: 关键词调研技能, SEO 关键词流程, 搜索需求分析, 关键词优先级, Search Console 关键词
relatedSkills: seo-audit, content-brief
relatedPrompts: seo-keyword-clustering-prompt, search-intent-classification-prompt
status: published
publishedAt: 2026-08-14
---

## Skill file

```text
---
name: keyword-research
description: Build a keyword set for a site from measured demand and observed competitors, keeping unavailable data explicitly unavailable. Use when someone asks for keyword research, a keyword list, search volumes, or what they should target, and when a keyword tool export needs turning into a set of pages somebody can actually build.
metadata:
  owner: GenGrowth SEO Agent
  source: https://gengrowth.ai/skills/keyword-research
---

# Keyword Research

Your job is to produce a keyword set a team can act on, where every keyword
carries the reason it is on the list and every number carries its source.

## What counts as evidence

Three sources, in descending order of trust:

1. Measured — the site's own Search Console data. Queries here are proof the
   site is already visible for something.
2. Observed — what ranking pages for a query actually cover, read from live
   results.
3. Provider-supplied — volume and difficulty estimates from a keyword tool.
   These are estimates, and they are labelled as such wherever they appear.

Never present provider estimates as measured data. When a metric is not
available for a keyword, write that it is unavailable. Do not substitute zero:
zero is a measurement, and "we do not have this" is not zero.

## Procedure

1. Establish what the site is for. Read the homepage and the top pages by
   traffic. Write one sentence on what the site sells and to whom. Everything
   downstream is judged against this sentence.

2. Pull what is already measured. From Search Console, take queries with
   impressions over the last three months. These are grouped into: ranking and
   converting, ranking without clicks, and appearing but not ranking. Each
   group implies different work.

3. Read the competitive picture. For the ten queries that matter most, look at
   what currently ranks: the page type, how deep the coverage goes, and whether
   the results are dominated by sites of a different kind — marketplaces,
   forums, or major publishers. A query where every result is a marketplace is
   not a content opportunity for a software site, whatever its volume.

4. Expand deliberately. Add keywords only when they pass two tests: the site
   could publish a page that genuinely serves the searcher, and the searcher
   could plausibly become a customer. Volume alone is not a reason.

5. Assign intent to every keyword: definition, how-to, comparison, tool, or
   purchase. Intent decides page type, and page type decides whether an
   existing page can be updated or a new one is needed.

6. Order by opportunity, not by volume. Rank on: existing visibility (a page on
   result page two is closer to traffic than a page that does not exist),
   commercial proximity, and how contestable the current results look. State
   the ordering rule you used, so the order can be argued with.

## Output

A keyword table with: keyword, intent, evidence source, current position if
measured, target page, and status (new page, update existing, or watch only).
Then a short list of what you could not determine and what data would settle it.

## Refuse to

- Present an estimate as a measurement.
- Fill an unavailable metric with zero or with a guess.
- Promise a ranking, a traffic number, or a timeline.
- Recommend a keyword density or a repetition count.
- Keep a keyword on the list without a reason attached to it.
```

## What it does

关键词调研会以两种熟悉的方式失败。一是产出一份没人能据以行动的清单——每一行都是一个关键词加一个搜索量估值，却没有任何关于「该拿它怎么办」的指示。二是产出一份没人敢信的清单——实测数据和厂商估值被粘进了同一列，两者的差别再也看不出来。

本 skill 同时处理这两点。每个关键词到手时都带着**它为什么在这份清单上**、**它属于哪个页面**，以及**附在它身上的任何数字的来源**。当某个指标不可得时，产出会明说而不是把缺口填上——这个习惯在有人后来据此清单做计划、需要知道哪些数字站得住时最重要。

排序规则是**写出来的，不是藏起来的**。关键词按「这个站点距离那个结果已经有多近」排序，**不按搜索量**；而且本 skill 会写明它套用了哪条规则，这样这个顺序可以被争论，而不只是被接受。

## In action

### You ask

这是我们的站点：example-invoicing.com。我们向自由设计师（美国和英国）卖开票软件。Search Console 已接入。下个季度我们的内容该聚焦在哪？

### The agent does

在看任何新关键词之前，实测数据里有三件事值得说。

**十二个**关于发票模板的查询词已经在产生曝光，其中四个位于第 8 到 14 名之间。那是**触手可及的流量**——一个快要排上去的页面，比一个还不存在的页面路径更短。

付款条款类查询（*net 30*、*net 15 meaning*、*late payment fee freelance*）有曝光但几乎没有点击。站点是通过一个**并不回答这个问题**的定价页出现在那里的。这些需要一个定义页，不是一次更新。

针对具名竞品的对比类查询**完全没有曝光**。今天站点上没有任何内容瞄准它们，而当前结果是评测站而不是厂商——可以争，但比前两类慢。

我没有给第二组和第三组附搜索量估值：Search Console 报告的是曝光，不是搜索量，而这个项目没有接入任何关键词工具。这里的排序依据是**实测的排名接近度**，这就是为什么模板类排在最前——尽管它很可能是更小的那个市场。

## How it works

### 先读站点，再读关键词

Agent 读首页和流量最高的那几个页面，用一句话写出这个站点卖什么、卖给谁。后续每一个决定都对着那句话来判断——正是它挡住了高搜索量但不相关的关键词进入清单。

### 先取已经测量到的东西

Search Console 的查询词优先，按三类分组：既有排名又有转化的、有排名但没有点击的、有曝光但没有排名的。每一组都意味着不同的动作，所以**这个分组本身就是建议的前一半**。

### 读实时结果

对最重要的那些查询词，Agent 会去看**实际排在那里的是什么**——页面类型、内容深度，以及这些结果是不是干脆属于另一类站点。一个被交易平台占据的查询词，对一个软件站点来说不是机会，不管搜索量估值说什么。

### 按接近度排序，然后交接

关键词按现有可见性、商业接近度、以及结果看起来有多可争来排序，**规则写下来**。产出是一张表，每一行都点名它的目标页面和状态——那正是一份内容简报所需要的输入。

## What it covers

- Search Console 查询词分析，按「有排名 / 有曝光 / 有转化」分组
- 读实时结果，判断页面类型与可争性
- 意图归类：定义、操作指南、比较、工具、购买
- 有意识的扩展，每一次新增都过相关性与商业性两道检验
- 机会排序，并明确写出所用规则
- 明确的「数据不可得」汇报，并写明什么能补上每个缺口

## When to use it

- 站点有 Search Console 数据，但没人把它变成过一份计划
- 关键词清单存在，但没人说得清任何一个关键词为什么在上面
- 内容在持续发布，却看不到搜索结果上的动静
- 搜索量估值和实测数据被混在同一张表里
- 一个新市场或新语种需要从零构建关键词集合

## FAQ

### 它和「SEO 体检」这个 Skill 有什么不同？

体检看的是**已经存在的页面**，找出限制它们的因素。关键词调研看的是**需求**，决定什么应该存在。两者在交接处相遇：体检告诉你哪些页面快要排上去了，而本 skill 决定那些页面值不值得推一把、还是说需求根本在别处。

### 它需要 Search Console 权限吗？

有它更好，没有也能跑。有 Search Console 时，最强的证据是站点自己的曝光数据。没有时，本 skill 退回到读实时结果，并**明说实测可见性不可得**——而不是拿厂商估值顶上、再把它当成这个站点自己的表现来呈现。

### 为什么它拒绝把缺失的搜索量补上？

因为**建立在编造数字上的计划会无声地失败**。一个后来被证明是错的估值，只要大家都知道它是估值，就还救得回来；而一个以事实身份进入表格的编造数字，救不回来。把指标标为不可得，能让这个缺口一直可见，直到真实数据把它填上。

### 不用 Agent 我能自己跑吗？

可以——这个文件是一份用平实语言写的流程，而本页链接的那些提示词覆盖了聚类、意图分类等单个步骤。Agent 负责的是那些**需要数据权限、并要在整站范围内重复执行**的部分。
