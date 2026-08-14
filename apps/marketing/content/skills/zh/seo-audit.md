---
title: SEO 体检
description: 对一个站点做一次时点诊断——什么在拖住它，按「修好之后改变最大」排序，且每条发现都写明它是怎么观察到的。
tagline: 搞清一个站点被什么卡住——以及先修哪个
category: seo
owner: seo
keywords: SEO 体检技能, 网站 SEO 审计, 技术 SEO 诊断, 站点体检发现, SEO 问题优先级, 抓取与收录审计, SEO 体检报告
relatedSkills: technical-seo-checklist, keyword-research
relatedPrompts: seo-content-audit-prompt, serp-competitor-analysis-prompt
status: published
publishedAt: 2026-08-14
---

## Skill file

```text
---
name: seo-audit
description: Diagnose one site at one point in time, ordering findings by stated severity rules and marking every check that could not be run as unchecked. Use when someone asks for an SEO audit, a site health check, or what is wrong with their site, including when they supply only a domain and expect findings ordered by what to fix first.
metadata:
  owner: GenGrowth SEO Agent
  source: https://gengrowth.ai/skills/seo-audit
---

# SEO Audit

Your job is to produce a diagnosis of one site as it stands on one date. Every
finding names how it was observed. Every check that could not be run is listed
as unchecked, not as passed. There is no overall score.

## What counts as evidence

Five sources, in descending order of trust:

1. Retrieved — a response you fetched yourself: status code, headers,
   robots.txt, sitemap XML, raw HTML before JavaScript, rendered DOM after it.
   Quote the URL and say which of raw or rendered you read.
2. Measured — the site's own Search Console and analytics data: impressions,
   clicks, indexing status, average position over a named date range.
3. Observed — what live search results show for a query today.
4. Provider-supplied — third-party crawler or metrics output. An estimate,
   labelled as such everywhere it appears.
5. Reported — what the team told you about the CMS, the build, or the redirect
   layer. A claim. Either verify it and promote it to retrieved, or record it
   as unchecked.

A number you did not obtain is unavailable. Write "unavailable" and say what
would produce it. Never write zero in its place: zero is a measurement.

## Severity rules

Assign severity from these definitions, not from judgement:

- Blocking — the page cannot be reached, crawled, or indexed, or its main
  content is absent from what a crawler receives. Requires retrieved evidence:
  a status code, a directive, or a raw-HTML fetch.
- Major — the page is reachable and indexable, but the thing the searcher asked
  for is not on it, or the site competes against itself for the same query.
- Minor — the implementation deviates from convention with no observable effect
  on what a crawler or a searcher receives.
- Unchecked — the check could not be run with the access available.

## Procedure

1. Fix the boundary. Name the hostnames in scope, the sections in scope, the
   date, and the access you have. An audit is a photograph with a timestamp; a
   finding without a date cannot be re-tested later.

2. Take the delivery layer first. Fetch robots.txt and the sitemaps. Sample
   URLs from each sitemap and record the status code, the final URL after
   redirects, the canonical, and the robots directives. Discrepancies here
   invalidate everything measured downstream.

3. Read raw HTML before rendered DOM on the pages that carry measured demand.
   If the main content only exists after JavaScript runs, say so and name the
   URLs you checked.

4. Rank pages by measured impressions, not by your own sense of importance.
   Audit the top pages properly rather than every page shallowly. State how
   many you examined and how you chose them.

5. For the queries those pages already appear for, look at what ranks now and
   what those pages cover. A gap between the two is a Major finding with the
   query named.

6. Order findings by severity band, then within each band by measured demand on
   the affected URLs. Where demand is unavailable, order by internal link depth
   and say you used a proxy. Do not blend severity and demand into one number.

7. Write the unchecked list last, with the access or data that would settle
   each item.

## Output

A findings table: finding, severity and the rule that triggered it, evidence
type and the URL or query it came from, count of affected URLs and how that
count was obtained, and the change to make. Then the unchecked list. Then two
sentences on what the site's current constraint appears to be.

## Refuse to

- Emit an overall SEO score, grade, or percentage.
- Mark a check as passed when it could not be run.
- Present an estimate, a provider metric, or a claim as a measurement.
- Substitute zero for a number that was unavailable.
- Extrapolate an affected-URL count without labelling it an extrapolation.
- Promise a ranking, a traffic figure, revenue, or a timeline.
- Recommend a keyword density or a repetition count.
- Report a finding without naming how it was observed.
```

## What it does

常见的体检产出，是一份两百行、顶上带一个分数的 PDF。没人能据以行动，因为这些行**未经区分**：一个缺失的 alt 属性，和主力页面上的一条 noindex 指令并排躺着，而顶上那个分数把两者吸收进了一个无法争论的数字里。更糟的是，那些工具**没能评估**的行——因为爬取撞上了深度上限，或者分析属性没覆盖那个目录——被悄悄渲染成了绿色。于是团队去修 alt 属性了。

本 skill 产出的是**一份诊断**。每条发现都带着**它是怎么观察到的**，好让同事重跑同一次抓取、得到同一个答案。严重程度来自**四条写明的定义**，而不是来自一套没人看得见的加权——这意味着「关于优先级的分歧」变成「关于某条规则的分歧」，而不是「关于某个数字的分歧」。跑不了的检查会出现在**它们自己的清单**里，并附上补齐它所需的权限。

它**刻意是时点性的**。本资源库里那些持续性的 skill 会在数周内观察一个站点、报告什么发生了变化；本 skill 回答的是另一个问题——**截至今天这个站点哪里不对，以及修好什么改变最大**。当你在决定要不要投资一个站点、或者接手一个站点、需要在动手之前先要一张地图时，这个区分很重要。

**这里没有分数**，而这不是一个风格选择。一个把抓取健康度、内容覆盖和链接数据合成一个数字的分数，暗示这些东西之间可以相互折抵。**它们不能。**一个站点可以技术上干干净净，同时没有任何值得排名的东西。

## In action

### You ask

我们是 riverbend-supply.com，一家管道配件分销商，约 4,000 个产品页。流量已经五个月持平，我们完全不知道问题出在哪。Search Console 已接入。

### The agent does

四条发现，先按严重度分档排序，档内按点击深度排——**这是一个已声明的需求代理指标**，因为这些 URL 的真实需求数据不可得，下面那条「未检查」说明了原因。

**阻断级。** 点击深度上离首页最近的四十个产品页，用客户端渲染它们的规格表。我抓取了其中十二个的原始 HTML：表格标记在响应里**不存在**，只出现在渲染后的 DOM 中。螺纹尺寸、材质、压力等级——这些页面之所以存在就是为了写明的规格——全都在那张表里。

**阻断级。** 已停产的产品返回 200，产品主体为空。我从你们的 sitemap 里取了 30 个 URL；30 个全部返回 200，其中 18 个没有产品内容。**这些是软 404。**

**重要级。** 品类筛选器生成可抓取的 URL（?brand=、?size=、?material=），每一个都规范到自身。我的爬取在撞上深度上限之前触达了 1,340 个。**真实总数更高；我没有做外推。**

**轻微级。** 每一条 sitemap 条目都带着同一个 lastmod 日期，看起来是生成时的产物，而不是真实的变更数据。

**未检查。** 我无法告诉你这 4,000 个产品页里有多少被收录。已接入的 Search Console 属性是覆盖 /shop/ 的 URL 前缀属性，而产品 URL 位于 /catalog/ 之下。**一个域名属性可以给它定论。**

渲染排在最前，因为它影响的是爬虫最先触达的那些页面。筛选器 URL 把抓取浪费在没人搜索的页面上——这是真问题，但更慢。

## How it works

### 先钉住边界和日期

Agent 会说明哪些主机名和板块在范围内、它拥有什么权限、以及这次体检描述的是哪一天。**这样写下的发现日后可以对着同一份证据复测**——而这正是体检与观点之间的分界。

### 先取回，再判断

先看交付层：robots.txt、sitemap、抽样状态码、重定向后的最终 URL、规范链接与各类指令。然后在重要页面上**先看原始 HTML，再看渲染后的 DOM**——因为「内容只在 JavaScript 之后才存在」的页面，和「内容单薄」的页面是两个不同的问题。

### 套用严重度规则

每条发现都对照四条写明的定义匹配——阻断、重要、轻微、未检查——产出会**点名触发它的那条规则**。没有任何东西被打分、加权或求和，所以排序可以在**规则**上被挑战，而不是在算术上。

### 按需求排序，然后声明缺口

同一严重度档内，发现按受影响 URL 的实测曝光排序；当它不可得时，Agent 改按内链深度排，并**说明自己用了代理指标**。报告以「未检查」清单收尾，逐条点名它需要什么权限或数据。

## What it covers

- 交付层核验：状态码、重定向链、规范链接、robots 指令、sitemap 准确性
- 在承载实测需求的页面上做原始 HTML 与渲染 DOM 对比
- 从站点自己的 Search Console 属性读取收录覆盖，并**写明该属性的范围**
- 查询词级的内容缺口：一个页面为什么出现，与它实际覆盖了什么
- 跨近重复页面、模板与筛选器 URL 的自相竞争检测
- 一份明确的「未检查」清单，每一条都配上能解决它的权限

## When to use it

- 站点跑了很多年，而团队里现在没人知道它处于什么状态
- 流量持平或下滑，而成因还没有被隔离到内容、抓取还是收录上
- 你正在接手一个站点——收购、新客户、重组团队——需要在改动任何东西之前先要一张地图
- 上一次体检产出了一个分数和一份长清单，而随后的工作没有带来任何可观察的变化
- 一次迁移或换平台刚完成，你需要在影响叠加之前知道它弄坏了什么

## FAQ

### 它和「技术 SEO」这个 Skill 有什么不同？

技术 SEO 核验的是**一组固定条件**，并把每一条报告为「满足 / 不满足 / 未检查」。在上线前或部署后，当问题是「已知要求是否成立」时，它是对的工具。体检是**开放式的**：它从站点的实测需求出发，反向找出挡在它与搜索者之间的东西，包括任何检查清单都没预料到的问题。实践中，体检常常会在交付层调用清单式的核验，然后继续往下走。

### 为什么它拒绝给出一个 SEO 分数？

因为**分数把不能相互折抵的东西合并了**。「拦住爬虫访问某个页面」和「title 稍微短了点」不是同一个量的两个数值，把它们平均会得到一个数字——它会因为没人说得清的原因而波动。分数还会**藏起它自己的缺口**：跑不了的检查总得被算成某种东西，而它们几乎总是被算成「没问题」。把发现和规则点出来，能让这两个问题都保持可见。

### 那些跑不了的检查会怎样？

它们进入「未检查」清单，并附上原因和补救办法——没有日志权限、分析属性未覆盖该目录、爬取撞上深度上限、预发环境在鉴权之后。**这是体检误导人最集中的地方**，因为在多数报告里，「未检查」和「已通过」长得一模一样。**在这里它们永远不会。**

### 体检该多久重跑一次？

在站点发生实质变化时重跑——换平台、模板重写、大规模内容迁移——或者出现了上次体检没有点名的新约束时。每月跑同一份完整体检，多半只是把它自己上一次的产出复现一遍。如果问题是「上个月的修复有没有带来变化」，那属于**监测**而不是诊断，此时体检的职责只是确认那条具体发现现在**可观察地**解决了。
