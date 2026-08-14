---
title: SEO 关键词聚类提示词
description: 把一份原始关键词清单，聚成你真能据以建页面的主题簇，每一簇只对应一种页面意图。
category: research
useCase: 内容规划
outputFormat: 表格
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: 关键词聚类提示词, SEO 关键词分组, 主题簇提示词, 关键词地图, 搜索意图分组
relatedSkill: keyword-research
relatedPrompts: search-intent-classification-prompt, topical-map-prompt, seo-content-brief-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are a search strategist grouping keywords into publishable topic clusters.

# Scope
Cluster the keywords given below. Do not invent keywords, search volumes, or
difficulty scores. If a number was not provided to you, leave it out rather
than estimating it.

# Inputs
Site or product: {{site_topic}}
Who the site sells to: {{target_user}}
Keyword list (one per line, optionally with metrics): {{keyword_list}}
Pages that already exist, if any: {{existing_pages}}

# What to produce
Group the keywords so that every cluster maps to exactly one page a writer
could sit down and write. Two keywords belong together only when a single page
would satisfy both searchers. When two keywords look similar but imply
different page types — a definition versus a comparison, a how-to versus a
product page — split them.

# Steps
1. Discard keywords that are irrelevant to the site or product, and say why in
   one line each.
2. Read each remaining keyword for what the searcher wants: a definition, a
   how-to, a comparison, a tool, or a purchase.
3. Group by that intent first, by topic second. Intent is the stronger signal;
   two keywords about the same subject with different intents are two pages.
4. Name each cluster after the page it implies, not after its biggest keyword.
5. Pick one primary keyword per cluster — the one that best describes the whole
   page — and list the rest as secondary.
6. Check each cluster against the existing pages. Mark it as new, or as a
   candidate to fold into a page that already covers the same intent.

# Output format
A table with these columns: Cluster name | Page intent | Primary keyword |
Secondary keywords | New page or existing page | Note.
Then a short list of any keywords you dropped and why.

# Quality checks before you answer
- Every input keyword appears exactly once: in a cluster or in the dropped list.
- No cluster mixes two page intents.
- No cluster would need two separate pages to satisfy it.
- Cluster names read like page titles, not like keyword strings.
- You have added no metric that was not in the input.

# When the input is thin
If the keyword list is under 20 keywords, say so and cluster anyway. If the
list has no metrics, cluster on intent alone and say that ordering by
opportunity is not possible from this input. Do not fill the gap with
estimates.

# Boundaries
Do not promise rankings or traffic. Do not recommend repeating a keyword a
fixed number of times. Do not merge clusters just to reach a round number.
```

## Variables

### site_topic
Required. 这个站点卖什么或写什么，一句话。写得越具体，模型越能把无关关键词剔掉。
Example: Invoicing software for freelance designers in the US and UK

### target_user
Required. 这些页面写给谁。当一个关键词有两种读法时，由它来定意图。
Example: Solo designers who bill hourly and currently invoice with spreadsheets

### keyword_list
Required. 一行一个关键词。有搜索量或难度就带上；没有就不写。
Example: freelance invoice template / how to invoice as a designer / best invoicing software for freelancers

### existing_pages
Optional. 已发布页面的 URL 和标题，好让模型分辨「新建页面」和「更新页面」。
Example: /templates/invoice — "Free freelance invoice template"

## How to use

把提示词粘进去，替换四个占位符，运行。清单可以直接从 Search Console 导出或关键词工具里粘过来——这条提示词不要求特定的列布局，也会忽略你没给它的指标。

**对照提示词内置的质量检查项**去读产出。抓出问题最多的是这两条：「每个输入关键词恰好出现一次」和「没有任何一簇混了两种页面意图」——一个同时装着 *what is X* 和 *X vs Y* 的簇，产出的页面两个都拿不到排名。

如果某一簇大到写不成一个页面，就要求**按意图拆分那一簇**并只重跑那一部分。整份清单重跑，往往会把你已经满意的分组重新打乱。

## Example input

```text
Site or product: Invoicing software for freelance designers in the US and UK
Who the site sells to: Solo designers who bill hourly and currently invoice with spreadsheets
Keyword list:
freelance invoice template
how to invoice as a freelance designer
invoice template google docs
best invoicing software for freelancers
freshbooks vs wave
what is net 30
net 30 payment terms
how to charge late fees freelance
Pages that already exist: /templates/invoice — "Free freelance invoice template"
```

## Example output

**主题簇**

| 簇名 | 页面意图 | 主关键词 | 次要关键词 | 新建/已有 | 说明 |
| --- | --- | --- | --- | --- | --- |
| Free invoice templates for freelancers | 下载模板 | freelance invoice template | invoice template google docs | 已有 — /templates/invoice | 在现有页面上加一个 Google Docs 版本，而不是再建第二个页面 |
| How to invoice as a freelance designer | 分步操作指南 | how to invoice as a freelance designer | — | 新建 | 位于模板页之上，并向下链到它 |
| Payment terms explained | 定义 | what is net 30 | net 30 payment terms | 新建 | 两个关键词是同一个问题的两种问法；一个定义页同时回答两者 |
| Charging late fees | 带政策视角的操作指南 | how to charge late fees freelance | — | 新建 | 与「付款条款」意图不同：搜索者已经知道条款，想要的是执行它 |
| Invoicing software comparison | 比较 | best invoicing software for freelancers | freshbooks vs wave | 新建 | 把那次正面对比放在这个页面里；单独做一个 freshbooks-vs-wave 页面会跟它自相竞争 |

**已剔除：** 无——每个关键词都映射到了这个站点能够发布的某个页面。

**关于排序的说明：** 未提供任何搜索量或难度数字，所以这些簇仅按意图分组，**未按机会大小排序**。

## Safety notes

这条提示词的写法是拒绝编造指标，但这个拒绝的强度取决于你的复核——确认产出里没有出现任何你没提供过的搜索量或难度数字。一个被要求给「它没有任何数据的清单」排优先级的模型，会很乐意产出一批看起来很像样的数字。

**聚类是规划步骤，不是排名预测。** 产出里没有任何一句说某个页面会有排名；它说的是哪些页面值得写、每个页面服务哪一类搜索者。

## FAQ

### 我一次能粘多少个关键词？

一次几百个是可行的。再多，模型就会开始**静默丢弃**关键词而不是给它们聚类，而「每个关键词恰好出现一次」这条检查会成为你唯一能察觉的方式。大清单按主题拆开，分别跑。

### 为什么它把看起来一样的关键词拆开？

因为决定页面必须包含什么的是**搜索意图，不是措辞**。*What is net 30* 和 *how to charge late fees* 都关于付款条款，但一个想要定义，另一个想要一份可以照抄的政策。一个试图两者兼顾的页面，通常两类搜索者都满足不了。

### 我能直接把簇名当页面标题用吗？

簇名的写法就是往页面标题上靠的，所以作为起点是合理的——但它们是**内部标签，不是标题文案**。发布前为读者重写一遍。

### 如果某一簇和我已有的页面重合怎么办？

产出会把它标为已有页面，也就是说建议是**更新**而不是新发。为一个你已经覆盖的意图再发一个页面，等于把你自己的内链拆分到两个 URL 上。
