---
title: 技术 SEO
description: 找出真正阻碍站点被抓取、渲染和收录的东西，把「被拦住的 URL」「从未被发现的 URL」「刻意排除的 URL」区分开。
tagline: 知道一个页面为什么不在索引里，而不只是知道它不在
category: technical
owner: tech
keywords: 技术 SEO 检查清单, 可抓取性审计, 收录问题, 规范链接审计, XML sitemap 校验, 结构化数据校验, robots.txt 检查
relatedSkills: seo-audit, internal-linking
relatedPrompts: seo-content-audit-prompt, internal-linking-suggestions-prompt
status: published
publishedAt: 2026-08-14
---

## Skill file

```text
---
name: technical-seo-checklist
description: Explain why specific URLs are missing from the index, separating blocked from undiscovered from deliberately excluded, using observed responses only. Use when pages are missing from Google, when someone asks about indexing, crawl budget, robots.txt, canonicals, or sitemaps, or when Search Console reports a URL as discovered but not indexed and the cause has not been established.
metadata:
  owner: GenGrowth Tech Agent
  source: https://gengrowth.ai/skills/technical-seo-checklist
---

# Technical SEO

Your job is to explain why specific URLs behave the way they do in search,
using responses you observed rather than causes you assumed. A page missing
from the index has several possible causes, and reporting one cause for all of
them is the most common way a technical review spends a sprint on nothing.

## What counts as evidence

Four sources, in descending order of trust:

1. Observed response — what the server returned when you requested the URL:
   status, headers, body. Reproducible right now, so it is the strongest
   evidence available. Record the user agent you used; the answer can depend
   on it.
2. Search engine report — URL Inspection and the page indexing report. This is
   what the engine did, which no fetch of yours can reveal. It lags by days and
   its example lists are capped, so read it as a state, not as a complete
   inventory.
3. Crawler output — a crawler's own summary across many URLs. Good for finding
   candidates at scale, but it reflects that crawler's settings: user agent,
   whether it executed JavaScript, how fast it went.
4. Inference — what you conclude from the above. Always labelled as inference,
   never merged into the first three.

If you did not observe a cause, do not name one.

## Four states, four kinds of evidence

Never report "not indexed" as a single problem. Split it:

- Blocked. A robots rule prevents the fetch. Evidence: the matching rule and
  the user agent it applies to. A blocked URL can stay indexed, and a noindex
  tag on a blocked URL is never read.
- Not discovered. Nothing points at the URL — no internal link in the crawled
  HTML, no sitemap entry, no redirect target. Evidence: absence from the link
  graph you built, not absence from a report.
- Deliberately excluded. The page is reachable and says not to index it: a
  robots meta tag, an X-Robots-Tag header, or a canonical pointing elsewhere.
  Evidence: the tag or header, quoted.
- Fetched and not selected. The engine retrieved the page and did not index it.
  Evidence: the engine's own report, and nothing else. You cannot observe the
  reason. State what you ruled out, then stop.

## Procedure

1. Read robots.txt and every sitemap it references. Record which rules apply to
   which user agents, and which URL patterns each rule actually matches.
2. Crawl from the homepage and build the internal link graph. Keep the raw
   result for every URL: final status, full redirect chain, response headers.
3. For each template, compare raw HTML with the rendered DOM. Note any link,
   canonical, or main content that exists only after JavaScript runs.
4. Reconcile the sets: sitemap members that nothing links to, linked URLs
   absent from the sitemap, and sitemap members returning anything but 200.
5. Classify every non-indexed URL into one of the four states, evidence
   attached. Leave a URL unclassified rather than guessing at it.
6. Check directives against each other: canonical target status, canonical host
   and protocol, canonicals pointing at noindexed pages, redirect chains longer
   than one hop, and 200 responses whose body is an error message.
7. Validate structured data twice per template — as markup (required
   properties, correct types, resolvable references) and against the page (does
   the page show what the markup asserts).
8. Order fixes by dependency, not by severity. Unblocking a path so its noindex
   becomes readable is a prerequisite, not a preference.

## Output

A table of URL patterns with state, the evidence for that state, and the fix.
Then contradictions, ordered by dependency. Then what you could not determine,
why, and what access would settle it.

## Refuse to

- Name a cause you did not observe.
- Scale a sampled state up into a count.
- Present a crawler's coverage summary as the search index's state.
- Substitute zero for a number you could not obtain.
- Promise a rich result, a ranking, a traffic number, or a timeline.
- Recommend a fix whose prerequisite has not been done first.
```

## What it does

技术复核通常以「一个数字加一个成因」的形式到达：三千个页面没被收录，原因是抓取预算。**数字是真的。成因是猜的**，而且不管什么站点，猜的往往都是同一个。实际上那一堆会拆成四类：被有意规范掉的 URL、被某条没人记得加过的规则拦住的 URL、从来没有任何东西链接过的 URL，以及一批引擎抓取了却略过的——原因没有任何工具会报告。**把四种状态当成一种处理**，会得到四分之一个迭代的有效工作和四分之三的白忙。

本 skill 把它们分开，并让每一类各自持有自己的证据。「被拦住」意味着**一条被引用出来的规则**以及它匹配的 User-Agent。「未被发现」意味着在 Agent **实际构建出来的链接图**里缺席，而不是在某份报告里缺席。「刻意排除」意味着那条标签或响应头，**原文引出**。「已抓取但未被选中」意味着引擎自己的报告，仅此而已——**原因不可观察**，所以本 skill 会写明它排除掉了什么，然后停下来，而不是补一个说得通的故事。

**矛盾本身被当作发现**，因为多数技术修复都有必须遵守的顺序。一条位于 robots.txt 禁止路径上的 noindex 标签**永远不会被读到**，所以先删标签什么也改变不了；必须先解除拦截，那条标签才能开始起作用。指向重定向或 noindex URL 的规范链接同理，列出已被站点规范掉的页面的 sitemap 也同理。

**渲染是被检查的，不是被假设的。** Agent 会对原始 HTML 与渲染后的 DOM 做差异比对，报告哪些链接和指令只在 JavaScript 运行之后才存在——这样就没人需要靠「浏览器标签页里看着是什么样」来争论了。

## In action

### You ask

我们做 harborlight-outdoors.com，大约 4,000 个 URL。Search Console 显示约 1,100 个被收录。我们的开发说这是抓取预算问题，想精简 sitemap。这个修法对吗？

### The agent does

**未收录的 URL 不是一个问题**，而且我观察到的任何东西都不指向抓取预算。

**1,842 个**是带 ?color= 和 ?size= 的产品变体 URL。它们返回 200，且每一个都规范到干净的产品 URL。**那是刻意排除，按设计正常工作。**精简 sitemap 碰不到它们，因为它们本来就不在 sitemap 里。

**410 个** /guides/ 下的 URL 被拦住——robots.txt 对所有 User-Agent 禁止了 /guides/。这些页面**同时**带着 noindex meta 标签，而在路径被拦住的情况下它永远不会被读到，所以任何在拦截之前就被收录的页面，可能会**无限期地留在索引里**。必须先解除拦截，noindex 才能被读到。**反过来的顺序什么也做不成。**

**287 个** sitemap 中的 URL 在站点自己的 HTML 里没有任何入链。爬取只能通过 sitemap 文件触达它们。**这才是真正的发现问题**，也是开发的时间该花的地方。

剩下约 **360 个**我归类为「已抓取但未被选中」。我检查了其中 20 个；URL 检查工具按属性按天有配额上限，所以其余的这个状态我没有，**也没有把样本放大成一个计数**。

排序依据是**证据强度而非数量**：被拦住的那组比变体那组小，但它是站点唯一自相矛盾的地方。

## How it works

### 先测绘抓取面

Agent 读 robots.txt 以及它引用的每一份 sitemap，记录哪条规则适用于哪些 User-Agent、每条规则**实际匹配**哪些 URL 模式。这一步在对任何页面下判断之前完成，因为**一条拦住某个路径的规则，会改变那些页面上其他所有信号的含义**。

### 抓取并保留原始响应

它从首页开始爬，为每个 URL 存下最终状态、完整重定向链和响应头，同时构建内链图。**指令出现在响应头里的频率不亚于出现在标记里**——X-Robots-Tag 从不出现在页面源码中——所以只读正文的复核会漏掉它们。

### 对比源码与渲染后的 DOM

Agent 会为每个模板做原始 HTML 与渲染 DOM 的差异比对，指出哪些链接、规范链接和主体内容只在 JavaScript 运行之后才出现。**正是这一步把「页面在我浏览器里看着没问题」和「爬虫收到的是一个空壳」区分开**，而两者需要不同的修法。

### 先分类，再按依赖排序

每个未收录的 URL 都被赋予四种状态之一并附上证据；任何一种都不符合的，**保持未分类**而不是被安一个成因。随后修复项按「什么必须先发生」排序，于是报告读起来是**一份操作顺序**，而不是一份严重度清单。

## What it covers

- robots 规则与 meta / 响应头指令，按 User-Agent 分别读取，并写明每条规则实际匹配的 URL 模式
- 全爬取范围的状态码观察，包括重定向链、指向不相关目标的重定向，以及正文其实是报错的 200 响应
- 原始 HTML 对比渲染 DOM，针对只在 JavaScript 之后才存在的链接、规范链接与主体内容
- 规范链接一致性：自指、主机与协议不一致、指向重定向或 noindex URL 的规范链接，以及与 sitemap 的冲突
- sitemap 有效性：非 200 的成员、已被规范掉的成员、孤儿成员，以及每次构建都变、因而不承载任何信号的 lastmod
- 结构化数据检查两遍——作为标记检查必需属性与类型，以及对照页面检查标记断言了但页面并未展示的内容

## When to use it

- 站点有很大一部分 URL 躺在「未收录」报告里，而没人按成因把它们分开
- 站点换了主机、框架或 URL 结构，而没人核过新技术栈返回给爬虫的是什么
- 页面在浏览器里看着正常，但源码 HTML 几乎是空的，而没人确认过爬虫收到的是哪个版本
- 某个富媒体结果不再出现，而那段标记自加上去那天起就没被读过
- 有人提出了一个抓取预算的修法，而关于「到底哪些 URL 被抓取过」没有任何证据

## FAQ

### 它和「SEO 体检」这个 Skill 有什么不同？

体检问的是：一个**已经在索引里**的页面能不能竞争——它覆盖什么、写给谁、怎么写的、怎么被链接的。本 skill 问的是**更前置的问题**：这个页面究竟能不能被抓取、收录和解析。重写一个爬虫从未收到的页面没有意义，所以本 skill 先跑，并把一组**真正在场上**的 URL 交给体检。

### 为什么它不告诉我某个页面被抓取后为什么没被收录？

因为那个决定属于搜索引擎，而**没有任何报告陈述它的理由**。本 skill 能证明这个页面可达、返回 200、未被拦截、也未被任何指令排除——这排除了四种成因。**再点名第五种，就是把猜测打扮成发现**，而这个位置上的一次猜测，会让一个团队跑去修一件本来没错的事。

### 它需要 Search Console 权限吗？

有它能做得更多。没有时，Agent 仍然能观察一次请求所揭示的一切：状态码、响应头、robots 规则、规范链接、渲染和 sitemap 完整性。它看不到的是**引擎对它发现的某个 URL 做了什么**；这种情况下报告会**明说**，而不是把一份爬虫自己的覆盖摘要冒充成索引的状态。

### 它会告诉我能不能拿到富媒体结果吗？

不会。**有效性可观察，资格不可观察**——标记可以在每一个必需属性上都正确，而搜索引擎仍然什么都不展示。本 skill 报告的是：标记能否被解析、必需属性是否存在且类型正确、以及页面是否**真的展示了标记所声称的东西**。它不承诺那个结果会出现。
