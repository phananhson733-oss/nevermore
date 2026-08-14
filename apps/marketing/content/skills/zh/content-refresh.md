---
title: 内容更新
description: 在已有页面上跑一个周期性循环，把「内容过时」「意图不匹配」「查询词本身走了」区分开——因为三者需要的修法完全不同。
tagline: 修那些真的下滑了的页面，其余的别动
category: content
owner: seo
keywords: 内容更新技能, 内容衰减分析, 旧文章更新, 内容盘点流程, 搜索意图不匹配, 内容瘦身, 页面更新优先级
relatedSkills: content-brief, seo-audit
relatedPrompts: content-refresh-rewrite-prompt, seo-content-audit-prompt
status: published
publishedAt: 2026-08-14
---

## Skill file

```text
---
name: content-refresh
description: Decide which existing pages to update, rewrite, retarget, or leave alone, by naming the cause of each decline before naming the fix. Use when traffic to existing pages has fallen, when someone asks which posts to update, consolidate, or delete, or when they propose refreshing a page without having established why it declined.
metadata:
  owner: GenGrowth SEO Agent
  source: https://gengrowth.ai/skills/content-refresh
---

# Content Refresh

Your job is to look at pages that already exist and decide, page by page,
whether anything should be done to them. Name the cause of the decline before
you name the fix. A refresh queue with no cause attached is a rewrite roster,
and rewriting is the most expensive way to find out a page was fine.

## What counts as evidence

Four sources, in descending order of trust:

1. Measured — the site's own Search Console history for the page and for its
   queries, compared across equal-length windows and against the same window a
   year earlier. Seasonality is the most common reason a page looks broken.
2. Observed — the live results for the page's main queries today, and the page
   as it currently renders, including content that only appears after load.
3. Recorded — the site's own change history: publish and edit dates, template
   changes, URL moves, redirects, migrations, and index status. A drop that
   lines up with a migration date is a migration, not decay.
4. Estimated — third-party traffic or difficulty figures. Usable as context,
   labelled as estimates, and never entered in the same column as measured data.

When a number is not available for a page, write that it is unavailable and
what would make it available. Do not substitute zero. Zero clicks is a
measurement; "the history does not join across the URL change" is not zero.

## The three causes

Every declining page belongs to one of these, and they take different work:

- Decay. The page still answers the query, but its substance aged out:
  superseded facts, old pricing, discontinued features, screenshots of an
  interface that no longer exists. Position slides gradually while the page
  keeps appearing for the same queries. The fix is substance, not structure.
- Intent mismatch. The page never matched what searchers wanted. It collects
  impressions but has never held a competitive position, and the pages that do
  rank are a different type entirely — a calculator where you published an
  essay, a comparison where you published a definition. The fix is a different
  page, or moving the query to a page that already suits it.
- Displacement. The query moved out from under the page. Demand shifted to
  another phrasing, the result surface changed, or the search stopped
  happening. Editing does not reach this. The fix is to retarget the page at a
  query that still exists, consolidate it, or retire it deliberately.

## Procedure

1. Set the window. Choose a comparison period long enough to survive weekly
   noise, and pull the same window one year earlier. State both in the output.

2. List pages that lost measured visibility — not pages that are old. Age is a
   reason to look, never evidence. A page from 2019 holding its position needs
   nothing.

3. For each declining page, read the recorded history first. Rule out
   migrations, redirects, template changes, canonical changes, and deindexing
   before you diagnose the writing.

4. Classify the cause using the three definitions above and cite the specific
   evidence that put the page in that class. If the evidence supports two
   classes, say so, and say which check would separate them.

5. Read the live results for the page's main query. Note which page types rank
   now and whether the result surface changed since the page was written.

6. Assign exactly one action per page: update, rewrite, retarget, consolidate,
   retire, or leave alone. Leave alone is a real outcome and must be used.

7. Order the queue by how close each page already is to its former position,
   and state the ordering rule so it can be argued with.

## Output

A table with: page, main query, cause class, the evidence cited, the proposed
action, and what specifically changes on the page. Then a second list of pages
examined and deliberately left alone, each with its reason. Then the gaps: what
could not be determined and what data would settle it.

## Refuse to

- Queue a page for work because of its age, with no measured decline.
- Present an estimate as a measurement, or fill an unavailable number with zero.
- Assign a cause the cited evidence does not support.
- Promise a recovery, a ranking, a traffic number, or a timeline.
- Recommend a keyword density or a repetition count.
- Change a publish date to signal freshness without changing the content.
- Send a page to rewrite without naming what is specifically wrong with it.
```

## What it does

多数内容更新项目是**按日历跑**的。有人按发布日期给内容库排序，取最旧的四十篇，逐篇过一遍。可预料的结果是：力气落在了本来就健康的页面上；真正失去可见性的页面排在它们后面继续等；而那些**从一开始就没起作用**的页面，被用更好的文笔重写了一遍，去对着同一个不匹配。事后没人说得清哪些编辑起了作用，因为从来没有哪个页面被写下过「为什么要动它」。

本 skill 把顺序倒过来。它从**测量到的下滑**出发，而不是从年龄出发；并且在指出成因之前拒绝提出修法。三种成因被当作真正不同的问题：内容在仍然服务该查询词的情况下过时了；页面从未匹配过该查询词背后的意图；以及查询词本身迁移了或不再被搜索。**只有第一种能靠编辑修好。**第二种需要另一种页面类型，或者给这个查询词换个落点。第三种通常需要把页面改瞄准、合并或下线——早点说出来，能省下本来会先发生的那两次重写。

**站点级的解释要在内容级之前被排除。**一次与 URL 迁移、模板变更或规范链接变更同时发生的下滑不是内容衰减，把它诊断成衰减会换来几个月毫无意义的编辑。

每个页面回来时都带着**给它定性的那份证据**；而循环刻意跳过的页面会连同理由一起列出——这样下一轮不必从头重查，而且「决定不动它」这件事可以被质疑，而不是被无声地重复。

## In action

### You ask

我们在 atlas-fieldwork.com（现场服务排班软件，约 240 篇已发布文章）每季度做一次内容更新。我们从最旧的开始逐篇处理，流量却还在往下滑。我们到底该更新什么？

### The agent does

「从最旧开始」本身就是问题的一部分：最旧的 30 篇里，有 19 篇同比守住了位置，什么都不需要做。

改用**测量到的下滑**排序，得到三组。下面的排序依据是「每个页面距离它原先的位置还有多近」，这就是为什么衰减类排在最前——那些页面**还在排名**。

十一个页面在仍然为同样的查询词出现的同时，位置逐步下滑。那些排班合规类文章引用的是 2023 年的各州加班工时阈值；排在它们上面的页面引用的是当前的。这是内容衰减，也是范围最窄的活：**换掉事实，保留结构。**

六个页面有曝光，但位置从来没进过二十名出头以内。对 *field service dispatch software* 来说，结果是对比页和产品页；而你们发的是一篇 1,800 词的讲解文。这是意图不匹配，而编辑那篇讲解文只是把它重复一遍。那些查询词要的是一个对比页，或者本就属于产品页。

四个页面失去的是**查询词本身**。*Best route planner app 2024* 今年在任何时间窗内都几乎没有曝光——是那个带年份的说法不再被搜索了，而不是输给了竞品。

有一个数字**不可得**：三月之前发布的任何内容，我给不出改前改后的点击对比。/blog/ 到 /resources/ 的迁移把历史拆到了两组 URL 上，Search Console 分别汇报它们，所以任何拼接出来的数字都是构造的。**现有的是**：四月以后当前 URL 上的曝光。

## How it works

### 比同口径时间窗，不比日历年龄

Agent 会固定一个足够长、能盖过周度噪声的对照窗口，并在把任何东西读成下滑之前，先拉一年前的同一窗口。两个窗口都会写进产出——因为在单个季度的尺度上，一门有季节性的生意和一个正在衰减的页面**长得一模一样**。

### 在怪内容之前先排除站点

接下来看变更历史：发布与编辑日期、URL 迁移、重定向、规范链接与模板变更、收录状态。如果一次下滑与迁移日期对得上，那么结论是「一次迁移」，这个页面进的是技术队列，不是写作队列。

### 把衰减、不匹配、被替换区分开

每个下滑的页面都对照那三条定义做分类，并引用具体证据。「仍为同一查询词出现、位置缓慢下滑」读作衰减；「有曝光但没有竞争性位置，且排名页面类型不同」读作不匹配；「该查询词在每一个窗口里都在变稀薄」读作被替换。

### 每个页面一个动作，包括「不要动」

每个页面离开时**恰好带一个动作**——更新、重写、改瞄准、合并、下线，或不要动——并附一条说明具体改什么。「不要动」的清单与工作队列一并发布，这样健康的页面是**被明确判定过**的，而不是被悄悄跳过的。

## What it covers

- 页面级与查询词级的同窗口、同比 Search Console 对照
- 变更历史与迁移、重定向、规范链接、模板变更的对账
- 三选一的成因分类，每个页面都引用证据
- 读实时结果，看页面类型与发布以来结果面的变化
- 每个页面一个动作：更新、重写、改瞄准、合并、下线，或不要动
- 一份明确的「不要动」清单，以及一份明确的「数据不可得」清单，并写明各自需要什么才能补上

## When to use it

- 更新项目按日历跑，而没人核过它动的那些页面是不是真在下滑
- 内容库有几百个页面，没人说得清今年哪些失去了可见性
- 全站流量在跌，但没有任何单个页面看起来明显坏掉
- 发生过一次迁移，页面级历史在 URL 变更处再也接不上
- 页面已经被重写过不止一次却毫无变化，而成因从来没被诊断过

## FAQ

### 它和「内容简报」这个 Skill 有什么不同？

简报规定的是一个**应该存在、但还不存在**的页面。本 skill 对**已经存在**的页面做决定。两者在交接处相连：当分类结果落到「重写」或「改瞄准」上时，这个页面、它的证据、以及它需要解决的那个不匹配，就成为简报的输入。归为「更新」类的页面通常完全跳过简报，因为它们的结构不是问题所在。

### 页面的年龄到底重不重要？

**只作为「值得看一眼」的理由。**年龄告诉你这个页面有足够时间变陈旧，但不告诉你它已经陈旧了。有很多旧页面能守住位置很多年，因为没人针对那个查询词发过更好的东西；去动它们，就是在没有证据的情况下花力气。工作队列由测量到的下滑构成，发布日期是行上的元数据，不是排序键。

### 如果点击掉了，但页面和结果都没变化呢？

那么诚实的产出会说**成因未判定**，并点名哪些检查能把剩余的可能性区分开——按查询词拆分，看是不是某一个词承担了全部损失；按设备或国家拆分；以及与一年前同窗口对照以排除季节性。一个未判定的页面**不进重写队列**。在这里去猜一个成因，正是站点最终去编辑那些本来没问题的页面的方式。

### 它能告诉我是不是 AI 答案面拿走了点击吗？

它能告诉你曝光持平而点击下降，也能指出某个查询词的结果面**现在出现了生成式答案、而此前没有**。它不会把这些转换成一个归因数字，因为没有任何可得数据能把「一次具体的点击损失」连到「一个具体的结果面」上。这个区分很重要：那个观察是真实的、值得据以行动，而给它附上一个百分比就是编造。
