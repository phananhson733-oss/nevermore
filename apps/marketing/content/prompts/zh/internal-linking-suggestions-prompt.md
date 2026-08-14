---
title: 内链规划提示词
description: 为单个页面产出一份内链方案：锚文本、每条链接该落进哪一句，并把重合度高到「该合并而不是互链」的页面标出来。
category: optimization
useCase: 站点结构
outputFormat: 内链方案
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: 内链提示词, AI 内链建设, 锚文本提示词, SEO 内部链接, 内链策略, 站点结构提示词, 关键词自相残杀检查
relatedSkill: internal-linking
relatedPrompts: topical-map-prompt, seo-content-audit-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are an editor placing internal links inside a page that is already written.

# Scope
Propose internal links from the page below to other pages on the same site.
Work only from the text given. Do not guess what a URL contains from its slug,
and do not report traffic, rankings, or link equity figures — none were
supplied. A link exists to move a reader who needs to move; a phrase matching a
keyword in a destination's title is not a reason to link.

# Inputs
Page receiving the links: {{target_page}}
Other pages on the site: {{candidate_pages}}
Who reads this page and what they are doing: {{reader_context}}
Links already on the page: {{existing_links}}
Most new links to propose: {{link_budget}}

# What to produce
A link plan: for each link, the anchor text, the sentence it sits in, its
section, and the reader question that makes it necessary there. Plus two lists
that matter as much — candidates you rejected, and any pair of pages that
overlap so heavily that linking them is the wrong fix.

# Steps
1. Read {{target_page}} section by section. For each section, write the
   question the reader described in {{reader_context}} has just formed: what
   they now want that this page will not give them. Some produce none. Say so;
   those get no link.
2. Match each question against {{candidate_pages}}. A candidate qualifies only
   if its description says it answers that question. If it is a slug or a bare
   title with no summary, mark it "not enough information to judge" and do not
   link it.
3. Write the sentence for each qualifying pair: quote the sentence the link
   attaches to, or draft a new one and mark it NEW. Anchor text is what a
   reader would click to get that answer — a noun phrase describing the
   destination, not its title pasted in, and not a term you want to rank for.
4. Before proposing a link, compare {{target_page}} against the candidate. If
   it answers a question a section of this page already answers, the two pages
   compete for the same reader. Do not link them. Put the pair in the overlap
   list, name the shared question, and say which page should own it and what
   happens to the other.
5. Drop proposals that duplicate {{existing_links}} or repeat a destination.
6. Cut to {{link_budget}}, keeping the links whose reader question is most
   urgent at that point. Everything cut goes in the rejected list with a
   reason. Order the survivors by position in the page.

# Output format
A table: Section | Reader question at this point | Anchor text | Destination |
Sentence, quoted or marked NEW. Include every section, even those with no link.
Then "Rejected candidates", with one-line reasons.
Then "Overlapping pages": the two URLs, the shared question, which page should
own it, and what has to happen to the other.
Then one line: links proposed against {{link_budget}}.

# Quality checks before you answer
- Every link states a reader question this page does not answer itself. If you
  cannot state it, delete the link.
- Every candidate appears exactly once: proposed, rejected, or overlapping.
- No two links share a destination, and none repeats {{existing_links}}.
- Every anchor reads naturally when its sentence is read aloud.
- Nothing describes the contents of a page whose summary you were not given.
- No ranking, traffic, or link equity claim appears anywhere.

# When the input is thin
If {{candidate_pages}} is URLs without summaries, say the plan cannot be built
from slugs and ask for one line per page. Do not infer what /blog/seo-basics
contains. If {{target_page}} is an outline rather than the text, propose
anchors but say the sentences are drafts written blind that must be refitted
to the real copy. If no candidate answers a question the page raises, say
there are no links to add: an empty plan is a valid answer.

# Boundaries
Do not promise rankings, traffic, or crawl improvements. Do not recommend links
per thousand words, a keyword density, or repeating an anchor to strengthen it.
Do not add links to reach the budget, invent URLs, or link outside
{{candidate_pages}}. When you flag an overlap, say what has to happen to the
losing page, but do not present it as measured: you have descriptions, not
query data.
```

## Variables

### target_page
Required. 接收链接的那个页面的 URL 和标题，以及它的正文。有正文就把真实文案粘进来；方案的质量，取决于它能挂靠的那些句子。
Example: /guides/job-costing-for-electricians — "Job costing for electrical contractors", followed by the full draft

### candidate_pages
Required. 一行一个页面：URL、标题，以及那个页面回答的是什么问题。只给 slug 等于逼模型去猜，而它一定会猜。
Example: /blog/labor-burden-rate — "What is labor burden rate" — defines burden and walks a worked calculation of the true hourly cost of an employee

### reader_context
Required. 谁会落到目标页面上、他们想做成什么。它决定了某条链接在某个位置是**被需要**，还是仅仅**可用**。
Example: Electrical contractors with 3 to 15 employees who already quote jobs but cannot tell which finished jobs made money

### existing_links
Optional. 页面上已有的内链，包括全站导航和页脚里的那些。没有这一项，方案会提议一些读者本来就有的链接。
Example: /features/time-tracking (in the intro), /pricing (in the footer)

### link_budget
Optional. 你愿意新增的链接上限。不写，模型会倾向于把每一节都填满，不管读者是否需要。
Example: 6 new links

## How to use

力气花在 `candidate_pages` 上。一串光秃秃的 URL 会产出一份自信而无用的方案，因为模型读 slug 然后自行编造页面内容——`/blog/margin-vs-markup` 被读成「讲怎么给电工活定毛利」，然后链接就加进去了。每个页面一行、写清它回答什么问题，这就是「一份可以直接交给编辑的方案」和「一份要逐条核验的方案」之间的差别。站点很大时不要把整个 sitemap 粘进去；粘同一主题域下那二三十个页面就行，因为读者本来也只会在这些页面之间移动。

读产出时用一个感觉上倒过来的顺序：先看重合页面清单，再看被否掉的候选，最后才看那张表。重合清单是大家会跳过的部分，因为它把一个内链任务变成了一个没人排期的内容决策——但「这两个页面回答的是同一个问题，互链只是把一个近乎重复的页面递给读者」这句话，比五处放得很好的锚文本更值钱。在一个成熟站点上这份清单回来是空的，通常意味着你提供的描述含糊到无法比较，而不是真的没有重合。

表格里你真正会撞上的失败，是**链接被放在那个词组出现的地方，而不是那个问题形成的地方**。它很容易被漏掉，因为句子读起来没毛病。把「目标页面」那一列遮住，只读章节和读者问题：如果这个问题正是该章节自己在两句之后就回答了的，那这条链接就放早了，读者点过去还得退回来。第二种失败是把目标页标题原样贴成锚文本，整页出现五次——读起来像目录，不像论述。

某一节出问题时，**只重跑那一节**：把该节正文、你仍认为可用的候选页、以及上一版哪里不对，一起粘回去。整页重新生成会打乱你已经接受的位置安排，并且会连带丢掉与 `existing_links` 的对账结果。

## Example input

```text
Page receiving the links: /guides/job-costing-for-electricians — "Job costing for electrical contractors". Full draft:

[H2] The jobs that surprise you
Most contractors can tell you what a job quoted at. Far fewer can tell you what it finished at, which is why a busy quarter and a profitable quarter are not the same quarter.

[H2] What a job cost actually includes
A job cost is labour, materials, subcontractors, and a share of overhead. The number most contractors get wrong is labour, because they use the wage rate rather than what the hour actually costs.

[H2] Getting hours onto the right job
Hours written on a paper sheet at the end of the week are a guess. The fix is capture at the point of work, on the job the crew is standing on.

[H2] Materials, including the ones nobody logs
Materials booked to a job are the ones that came off the purchase order. The ones that came off the van are the ones that quietly eat the margin.

[H2] Allocating overhead
Rent, vans, insurance, and the phone that rings all day belong on jobs somehow. Pick a method, apply it to every job, and stop arguing about it.

[H2] Reading the finished-job report
A finished-job report is only useful if you look at it while you still remember the job.

[H2] Changing the next quote
Job costing that does not change the next quote is bookkeeping.

Other pages on the site:
/guides/how-to-price-an-electrical-job — "How to price an electrical job" — builds a quote from labour, materials, and target margin
/blog/labor-burden-rate — "What is labor burden rate" — defines burden and walks a worked calculation of the true hourly cost of an employee
/guides/job-costing-explained — "Job costing explained" — general introduction to what job costing is and why contractors do it
/features/time-tracking — product page for crew time tracking against a job
/blog/change-order-template — "Change order template for contractors" — free template plus how to document scope added on site
/blog/quickbooks-job-costing-limits — "Where QuickBooks job costing falls short" — what the built-in job costing does and does not count
/guides/estimating-materials — "Estimating materials on an electrical job" — the takeoff process before the job starts
/blog/margin-vs-markup

Who reads the target page and what they are doing: electrical contractors with 3 to 15 employees who already quote jobs but cannot tell which finished jobs made money; most arrive from a search about job costing and read on a phone

Links already on the page: /features/time-tracking (in the intro), /pricing (in the footer)

Most new links to propose: 6
```

## Example output

**内链方案 — /guides/job-costing-for-electricians**

| 章节 | 读者此刻的问题 | 锚文本 | 目标页面 | 落在哪句 |
| --- | --- | --- | --- | --- |
| The jobs that surprise you | 还没有。读者此刻是被告知他有一个问题，而不是被要求行动。 | — | — | 不加链接。 |
| What a job cost actually includes | 「我的班组一小时到底成本多少？」 | what the hour actually costs | /blog/labor-burden-rate | 已有句：「...the wage rate rather than **what the hour actually costs**.」 |
| Getting hours onto the right job | 「我怎么在作业现场就把工时记下来？」 | — | — | /features/time-tracking 能回答，但导语里已经链过。见「被否掉的候选」。 |
| Materials, including the ones nobody logs | 「开工前我怎么把材料清单弄准？」 | estimating materials before the job starts | /guides/estimating-materials | 新增：「That gap narrows when the takeoff was done properly, which is its own discipline: **estimating materials before the job starts**.」 |
| Materials, including the ones nobody logs | 「现场加了两条回路，这笔成本落到哪？」 | documents it as a change order | /blog/change-order-template | 新增：「Scope added on site reaches the job cost only if somebody **documents it as a change order**.」 |
| Allocating overhead | 「我的房租该有多少摊到这个工程上？」 | — | — | 没有候选页回答它。这是内容缺口，不是链接缺口。 |
| Reading the finished-job report | 「我的财务软件说它能做这个。为什么对不上？」 | where QuickBooks job costing stops short | /blog/quickbooks-job-costing-limits | 新增：「If the report comes out of accounting software, check what it counts first: **where QuickBooks job costing stops short**.」 |
| Changing the next quote | 「我怎么把这些数字带进下一次报价？」 | price the next electrical job | /guides/how-to-price-an-electrical-job | 新增：「Carry the burden rate and material variance from your last three jobs into how you **price the next electrical job**.」 |

**被否掉的候选**

- /features/time-tracking — 导语里已经链过。如果那条链接的作用不如放在「Getting hours onto the right job」里大，就**移动**它，而不是再加一条。
- /blog/margin-vs-markup — 没有提供描述，因此无法判断它是否回答了「Changing the next quote」一节里的问题。补一行摘要就可以重新考虑。
- /guides/job-costing-explained — 不是因为质量被否；见「重合页面」。

**重合页面**

- /guides/job-costing-explained 与 /guides/job-costing-for-electricians 回答的是同一个问题：「什么是工程成本核算、承包商为什么要做」。互链等于把读者送去一个更含糊的版本，而他此刻正在读的就是那一节。这个问题应该由电工那一页拥有：它有受众、有算得清的细节、也有下一步。把通用页并进去并做重定向，或者把它收窄到本页不回答的某个问题上。**做任何重定向之前，先用真实查询数据核实。**

**提议 5 条链接，预算 6 条。** 其余章节没有再提出候选页能回答的问题。

## Safety notes

复核的人必须**打开每一个目标页面**，确认它确实讲了摘要里说的内容——因为模型从没见过那些页面，它完全信任你写的那一行描述。这个失败很安静：一条指向 `/blog/labor-burden-rate` 的链接在方案里看着没问题，落地却是一个只定义了术语、没有读者要的那段计算的残页。另外把新增句子放回段落里**读出声**：它们的语感是通用的，通常需要改写才能和页面其余部分一致。

重合标记是一个**假设，不是测量**。它是从你写的描述推出来的，不是从查询数据或两个 URL 的实际表现推出来的，所以把它当作「值得去看一眼」的理由，而不是删页面的依据。产出中没有任何内容宣称加了链接会改善排名、抓取或流量；这类数据一条都没提供，而提示词被要求宁可不给数字，也不去估算。

## FAQ

### 为什么它拒绝链接一个明显讲同一主题的页面？

因为「同一主题」和「同一问题」是两回事。如果一个候选页回答的问题你的页面已经回答了，链过去就是把读者横向送进一个近乎重复的页面，而你现在有两个页面在争当那个答案。这条提示词的写法是停下来、点名两个页面共同回答的那个问题、并指出该由谁拥有它。这通常是产出里最有用的一行，也是最多人跟它争的一行。

### 这个页面最终该有多少条内链？

没有正确数字，所以这条提示词是**向你要一个预算**，而不是自己提议一个。链接数和「每千词几条链」是下游结果，取决于页面真正提出了多少个问题：一个短定义页可能只提出一个，一篇长指南可能提出六七个。按你的编辑容忍度设预算，并且把「预算没用完」当成好事，而不是待填的缺口。

### 它知道我的导航和页脚链接吗？

只有你把它们写进 `existing_links` 它才知道。模型只看到你粘的页面正文，而正文很少包含全站导航，所以它会很乐意提议一条正文链接，指向一个已经出现在全站每一页主菜单里的页面。**事先把导航和页脚的目标页列出来**，是你能对产出做的成本最低的改进。

### 什么情况下这条提示词不好用？

三种。用模板生成的程序化页面——那里的链接由规则生成，而不是写进句子里。超大型站点——你无法粘出一份有意义的候选清单，有效的工作单位是基于爬取的链接图，而不是一次一页。以及反方向的需求——「哪些已有页面应该链到我刚发布的这一页」，这条提示词不做这件事；那需要按每个来源页各跑一次，慢到不如直接用爬取报告。
