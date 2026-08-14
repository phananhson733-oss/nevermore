---
title: 内链治理
description: 盘点并重建站点的内链图——孤儿页面、误导性锚文本、以及争夺同一个意图的页面，包括「答案是合并而不是互链」的那些情况。
tagline: 把读者和权重导向真正配得上它们的页面
category: technical
owner: tech
keywords: 内链技能, 内链审计, 孤儿页面, 锚文本审计, 站点架构 SEO, 关键词自相残杀, 链接图分析
relatedSkills: technical-seo-checklist, on-page-seo
relatedPrompts: internal-linking-suggestions-prompt, topical-map-prompt
status: published
publishedAt: 2026-08-14
---

## Skill file

```text
---
name: internal-linking
description: Audit a site's internal link graph and decide, per page, whether to link, merge, retire, or leave it alone — with the evidence for each verdict attached. Use when someone asks about internal links, orphan pages, site structure, anchor text, or link equity, and when a site has indexed pages that get no traffic and nobody has decided which of them deserve the links.
metadata:
  owner: GenGrowth Tech Agent
  source: https://gengrowth.ai/skills/internal-linking
---

# Internal Linking

Your job is to change the link graph, not to add links. Adding a link is one of
four possible verdicts, and often the wrong one. Every change you propose
carries the reader-facing reason it exists and the evidence behind it.

## What counts as evidence

Four sources, in descending order of trust:

1. Crawled — the link graph as a crawler sees it after rendering. An edge only
   counts if the source page returns 2xx, is indexable, and the link is in body
   content. This is the only source that proves a link exists.
2. Measured — Search Console. Which queries each URL actually appears for, and
   with what impressions. This is how you tell which of two overlapping pages
   search engines have already chosen.
3. Declared — sitemaps, navigation config, CMS taxonomy. Proves intent, not
   reachability. A page in the sitemap with no body link pointing at it is an
   orphan regardless of what the CMS thinks.
4. Inferred — topical similarity read from page content. Use it to propose
   candidate links. Never use it alone to assert that two pages duplicate each
   other; that claim needs measured query overlap.

Templated links — global navigation, footers, sidebars, related-post widgets —
are counted separately from contextual body links, and never reported as the
same number. A page linked from every footer on the site is not linked to; it
is boilerplate.

When the crawl could not reach a page, its inbound count is unavailable. Do not
report it as zero. Zero inbound links is a finding; a failed request is not.

## Procedure

1. Crawl and build the graph. For each URL record: status code, indexability,
   canonical target, click depth from the homepage, contextual inbound links,
   templated inbound links, and outbound contextual links.

2. Split boilerplate from context. Compute inbound counts twice, with and
   without templated edges. The contextual count is the one that describes
   whether anyone chose to link to the page.

3. Find orphans and near-orphans. List pages with zero contextual inbound
   links, then pages reachable only through deep pagination. Group them by
   topic — orphans usually arrive in clusters, and the cluster tells you which
   hub page failed to link out.

4. Find intent collisions. For each pair of pages with substantially
   overlapping Search Console query sets and the same page type, name the
   incumbent: the URL that already receives the impressions. Two pages
   splitting one intent do not need links between them.

5. Audit anchors. Read the anchor and the sentence containing it. Flag anchors
   that promise something the destination does not cover, bare URLs, "read
   more" and "click here", and any link whose destination is noindex,
   redirecting, or returning an error.

6. Assign one verdict per page: promote (add contextual inbound links from
   pages that genuinely reference it), consolidate (merge into the incumbent
   and redirect), retire (remove and redirect, with no replacement), or leave.
   State the verdict before proposing any edge.

7. Write the edges last, and only for pages with a promote verdict. Each
   proposed link names the source URL, the destination, the anchor, and the
   sentence it sits in. If you cannot write the sentence, the link does not
   belong there.

## Output

An edge-change list: source, destination, anchor, surrounding sentence, reason.
A consolidation table: page, verdict, incumbent URL, redirect target, evidence.
An orphan list grouped by topic, with the hub that should have linked out.
An anchor-repair list. Finally, what you could not determine and what data
would settle it.

## Refuse to

- Propose a link because a phrase matched a page title, with no reader-facing
  reason for the link.
- Count navigation, footer, or widget links as evidence a page is linked.
- Recommend a number of links per page, an anchor repetition count, or a
  keyword density.
- Report an inbound count of zero when the crawl failed to reach the page.
- Recommend a merge without naming the incumbent and the measured evidence for
  it.
- Add a reciprocal link between two pages that compete for the same intent.
- Link to a URL that is noindex, redirecting, or returning an error.
- Promise a ranking movement, a traffic figure, or a timeline.
```

## What it does

常见的失败看起来很高产。有人跑了一个插件或一条提示词，把正文里的词组与页面标题做匹配，凡是撞上就插一条链接。一周后，站点多了两百条新内链、十几个互指的环（两篇文章因为共用一个词而互相指向）、一条从「报税截止日期」段落指向定价页的链接，而**没有一个孤儿页面被修好**。更糟的是，那两个原本在悄悄拆分同一个意图的页面现在被互链了起来——这让任何复核者看上去都觉得这次拆分是**故意为之**。

本 skill 把链接图当作**需要做决定的东西，而不是需要装饰的东西**。每个页面拿到四种判定之一——提升、合并、下线、不动——而且判定在写任何锚文本之前就完成。不该存在的页面不会拿到链接；它们会被并进搜索引擎**已经选定**的那个页面，而这个选择是从测量到的查询数据里读出来的，不是靠观点争出来的。

干活最多的那个区分，是**上下文链接与模板链接**。一个只能从全站页脚触达的页面，在任何有用的意义上都不算被内链；而把那些边算进去，正是站点说服自己「我们没有孤儿页面问题」的方式。本 skill 把入链**数两遍**并同时报出两个数字，好让两者之间的差距可见。

## In action

### You ask

我们做 cadence-payroll.com，面向英国小企业的薪酬软件。大约六十篇博客和八个产品页，三年里由不同写手陆续堆起来。Search Console 已接入。我们的内链从来没被审计过——从哪开始？

### The agent does

三个发现，按「各自能**减少**多少工作量」而不是增加多少来排序。合并对链接图的改变最大，而给可能撑不过合并的页面加链接是浪费。

**两个页面在争同一个意图。** `/blog/statutory-sick-pay-explained` 和 `/guides/ssp-calculator-walkthrough` 在 Search Console 里为同样的十四个查询词出现，而那个 guide 在任何一个词上都没有超过那篇 post。post 是在位者。建议是**合并**——把计算步骤并进 post、把 guide 重定向过去——而不是在两者之间加更多链接。它们**已经**互相链接了，正是这个环让这里看起来像一个连通的内容簇，而不是一次拆分。

**九篇文章的上下文入链为零。** 它们躺在 sitemap 里，从 `/blog` 第四页往后才能触达。其中七篇讲自动参保（auto-enrolment），而你们的自动参保支柱页**一篇都没链**。这是**一个中心页失职**，不是九个互不相关的问题。

**二十三条链接**用「read more」或裸 URL 作锚文本。其中六条从讲合规截止日期的句子指向 `/pricing`；而定价页根本没提截止日期。

我无法报告 `/guides/2024-rates` 及其四个同级页面的入链数。爬取时该目录返回 403，所以这些计数是**不可得，不是零**。放行爬虫 User-Agent 后重跑一次即可定论。

## How it works

### 从爬取构建链接图，不从 CMS

Agent 爬取站点，记录**爬虫实际能看到的东西**：状态码、可索引性、规范链接目标、点击深度，以及每一条正文链接。CMS 导出告诉你站点**打算**链接什么；只有爬取才告诉你它在模板、渲染和多年编辑之后**实际**链接了什么。

### 把模板链接与上下文链接分开

入链数被统计两遍：一遍包含导航、页脚和相关文章组件，一遍排除它们。**有意义的是上下文那个数字**，因为它反映的是某个人在某句话里做出的决定，而不是一个每页都触发的模板。

### 用测量到的查询词检验重合页面

当两个页面看起来覆盖同一片地时，Agent 会比较它们在 Search Console 里**实际出现**的查询词集合，并点名在位者——那个已经在收曝光的 URL。主题相似只提出问题；**测量到的重合才回答它**。

### 先定判定，再写边

每个页面拿到一个判定：提升、合并、下线、不动。**只有被提升的页面才会拿到建议链接**，且每条建议链接都附带它该落进的那一句。如果那句话无法自然地写出来，这条链接就被舍弃，而不是硬塞。

## What it covers

- 从爬取构建完整的上下文链接图，模板边单独计数
- 孤儿与准孤儿检测，按主题分组并追溯回本该链出去的那个中心页
- 用 Search Console 实测查询词重合做意图冲突检测，并点名在位页面
- 锚文本审计，覆盖误导性锚文本、裸 URL 与泛用词组
- 失效目标检测：指向 noindex、重定向或报错 URL 的链接
- 合并与下线建议，附重定向目标，而不只是「加链接」

## When to use it

- 站点由多位写手写了多年，而从没有人梳理过谁链向谁
- 两个页面在同样的查询词上来回换位，而没人决定过该由谁胜出
- 页面在 sitemap 里存在却拿不到曝光，且不清楚这是需求问题还是可达性问题
- 一个自动内链插件一直在跑，链接数在涨，而其他一切没有变化
- 某个板块即将迁移或重构，动 URL 之前需要先知道有哪些入链指向它

## FAQ

### 它和「技术 SEO」这个 Skill 有什么不同？

技术 SEO 问的是**单个页面**能否被抓取、渲染、收录——大多是逐页的二元问题。本 skill 假定这些页面可达，问的是**注意力如何在它们之间流动**。两者在交接处相遇：技术 SEO 发现某个页面被设成了 noindex，而本 skill 是那个注意到「还有十二个页面在链向它」的。

### 它什么时候建议合并而不是加链接？

当两个页面在**实际出现的查询词**上大幅重合、页面类型相同，且其中一个从未在任何一个词上超过另一个时。到了这一步，把它们互链只会把这次拆分**固化**，而不是解决它。本 skill 会从实测曝光中点名在位者，并建议把较弱的页面并进去、做重定向——因为另一个选项是无限期地维护两个各答一半的页面。

### 它需要 Search Console 权限吗？

没有也能跑，但会明显变弱。仅靠爬取就能找出孤儿页面、失效目标和误导性锚文本。而在两个竞争页面之间**点名在位者**需要实测查询数据；没有它，本 skill 会报告「这两个页面看起来重合」，并明说它**无法判定**搜索引擎当前偏好哪一个，而不是靠字数或发布日期去猜。

### 那些大到无法逐页判定的站点怎么办？

它在**模板与板块层级**上工作。Agent 在每个模板内做抽样，报告哪些结论来自抽样而不是全量爬取，并写明样本量。像「这个品类下的产品页没有链出任何支撑内容」这样的发现，是一个**模板决定**，一次处理即可；它不需要先把每个 URL 都枚举出来。
