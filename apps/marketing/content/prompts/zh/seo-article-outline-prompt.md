---
title: SEO 文章大纲提示词
description: 把一个主题和它的搜索意图，变成一份逐节的大纲：每个小标题都写明它要证明什么，字数分配不均等，并附一份明确的删除清单。
category: writing
useCase: 起草
outputFormat: 大纲
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: SEO 文章大纲提示词, 内容大纲提示词, 博客大纲生成, SEO 内容大纲, 文章结构提示词, 按搜索意图写大纲
relatedSkill: content-brief
relatedPrompts: seo-content-brief-prompt, seo-blog-post-writing-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are an editor turning a topic into a section-by-section article outline.

# Scope
Outline one article. Every section must earn its place by what it proves to the
reader, not by what it is nominally about. Do not invent statistics, study
results, customer quotes, dates, or product capabilities. Work only from the
evidence listed below. If a section needs evidence you were not given, mark it
as missing rather than writing a plausible-looking number.

# Inputs
Topic and the query it targets: {{topic_and_query}}
What the searcher wants and when they would stop reading: {{search_intent}}
Evidence the author can actually bring: {{available_evidence}}
Total word budget for the finished draft: {{word_budget}}
What the currently ranking pages already cover, if known: {{competing_pages}}

# What to produce
A section list where each section carries a claim, the evidence behind it, and a
word allocation. Allocations must be unequal. The section that answers the query
most directly takes the largest share; sections that only add context take a
small share or get cut. An outline where every section weighs roughly the same
is a failed outline, because it means no decision was made about what the
article is for.

# Steps
1. Write one sentence saying what the reader must be able to do or decide after
   reading. Judge every section below against that sentence.
2. List the claims the article has to land to get the reader there. A claim is
   arguable and checkable; a topic is not. "Annual plans distort your monthly
   revenue chart" is a claim. "About annual plans" is a topic.
3. Attach evidence to each claim from {{available_evidence}}. A claim with
   nothing behind it is labelled EVIDENCE MISSING. Do not quietly drop it and do
   not patch it with a generic industry statistic.
4. Rank the claims by how much of {{search_intent}} each one satisfies, then
   split {{word_budget}} in proportion to that ranking, never evenly. The top
   section must be at least three times the smallest surviving section.
5. Cut. Remove any section that exists only because the topic "should" cover it,
   any section that repeats what {{competing_pages}} already does well without
   adding new evidence, and any section a reader would skip once they have the
   answer. Name every cut and give the reason in one line.
6. Rewrite each surviving heading so it states its claim rather than its subject.
   If a heading would fit equally well on any other article about this topic, it
   is too generic; rewrite it.
7. Order sections by what the reader needs first. The answer to the query comes
   early, not after a build-up.

# Output format
1. A one-sentence purpose statement.
2. A table: Section heading | What it proves | Evidence used | Words | Why here.
3. A "Cut" list: section considered, reason, one line each.
4. An "Evidence missing" list, if any: the claim, and what the author would have
   to obtain before that section can be written.

# Quality checks before you answer
- Word allocations are unequal and sum to the stated budget.
- Every heading states a claim; none is a bare noun phrase.
- Every section names its evidence or appears under Evidence missing.
- At least one section was cut, with a specific reason.
- No number, source, date, or quote appears that was not in the input.

# When the input is thin
If no evidence was supplied, return the claim list with every section marked
EVIDENCE MISSING instead of assembling an outline that looks finished. If the
competing pages field is empty, say that the cuts were made on intent alone and
may remove something worth keeping. Do not estimate search volume, difficulty,
or what the ranking pages contain.

# Boundaries
Do not predict rankings or traffic. Do not specify keyword counts, keyword
density, or where to repeat a phrase. Do not pad the outline to hit a section
count. Do not write the draft: headings, claims, evidence, and word counts only.
```

## Variables

### topic_and_query
Required. 文章主题，加上它服务的那个确切查询词。**按人打字的样子写**，不要按关键词工具格式化后的样子写。
Example: How to read your restaurant's labor cost percentage, targeting "restaurant labor cost percentage"

### search_intent
Required. 读者是谁、什么事把他推去搜索、以及他会在哪一刻停止阅读。**停止点决定了哪一节该排在最前面。**
Example: An owner of 3-6 restaurants who just saw labor at 34% and wants to know whether that is bad before next week's schedule goes out

### available_evidence
Required. 作者真正能打开并引用的一切，有样本量和日期的就写上。**把你没有的也列出来**，这样模型没法悄悄假设它存在。
Example: Shiftwell aggregate, 412 locations, 12 months to June 2026; nine owner interviews, Q2 2026; not available: revenue or cover counts

### word_budget
Required. 你真正会写到的总篇幅。正是它逼出了分配上的取舍，所以填你真心打算写的那个数。
Example: 1600

### competing_pages
Optional. 当前为这个查询词排名的页面已经覆盖了什么。没有它模型照样会删，但只能凭意图删。
Example: Results 1-3 are a glossary definition, a "15 ways to cut costs" listicle, and a payroll calculator page

## How to use

`available_evidence` 里要填**能指给读者看的东西**：一个带行数和时间范围的数据集、一组访谈、一张截图、一个你能链过去的公开序列。填「内部数据」「客户反馈」这种条目，产出的章节在证据那一列同样含糊，而你要到动笔时才会发现——那时已经没有东西可引。**列出你没有的东西和列出你有的同等重要**；正是它挡住模型围绕一个你根本跑不出来的「客单人次分析」去搭一节内容。

你真正会撞上的失败是**近似均分**。要求 1600 词分五节，模型常常返回 400/350/350/300/200——技术上确实不等，但回避了那个决定。遇到这种情况，把预算再说一遍，然后问它：如果预算降到 1000 词，你会删掉**哪一节**。这个问题的答案才是真实的排序，而一旦被迫点出一个输家，分配通常就自己修好了。

第二种失败是「它要证明什么」那一列里出现了**你从未提供过的数字**。把产出里的数字、百分号和年份都找出来，逐个追溯回你的证据清单。一个被要求「把说法讲得扎实」的模型，会去够一个看着合理的基准值，而一个看着合理的基准值，扫一眼是分辨不出真假的。删除清单同样值得怀疑：如果被删的只有「引言」和「结论」，那是稻草人式的删除。反推回去——点名一个排名竞品覆盖了的章节，问它在这里配不配占那些字数。

当说法都对、只是顺序错了，**手工调序**。整条重跑往往会把你已经接受的说法重新生成一遍，第二轮你会花在复核已经做完的工作上。

## Example input

```text
Topic and the query it targets: How to read your restaurant's labor cost percentage, targeting "restaurant labor cost percentage"

What the searcher wants and when they would stop reading: An owner of 3-6 independent restaurants who just saw labor at 34% on a weekly report and wants to know whether that is bad and what to change before next week's schedule goes out. They stop reading once they know whether 34% is a problem for their service type and have one change they can make this week.

Evidence the author can actually bring:
- Shiftwell aggregate across 412 locations, 12 months to June 2026: median labor cost percentage 26.4% quick service, 31.8% full service
- Nine recorded owner interviews, Q2 2026, on what they changed to bring labor down
- Product screenshot: Shiftwell overtime forecast for the coming week
- US Bureau of Labor Statistics published wage series for food service occupations
- Not available: revenue, margin, or cover counts for those 412 locations

Total word budget for the finished draft: 1600

What the currently ranking pages already cover, if known: Results 1-3 are a POS vendor glossary defining the formula, a "15 ways to cut restaurant labor costs" listicle, and a payroll vendor calculator. None of them break the benchmark out by service type.
```

## Example output

**目的：** 读完之后，一个盯着 34% 这个数字的老板能说出这个数对他这种业态是不是问题，并能在下周排班表发出去之前点出一项要改的地方。

**大纲**

| 章节标题 | 它要证明什么 | 用到的证据 | 字数 | 为什么放这里 |
| --- | --- | --- | --- | --- |
| 34% 对正餐是常态，对快餐是问题 | 读者手上的数字，在没有对照业态之前无法解读 | Shiftwell 汇总，412 家门店，截至 2026 年 6 月的 12 个月（快餐 26.4%，正餐 31.8%） | 520 | 这就是他打进去的那个问题；放在它之前的任何内容都是在推迟答案 |
| 有三样东西会推动这个数字，而它们的速度差别极大 | 排班形态一周内就能改变，工资底线这个季度根本不会变 | 九次老板访谈，2026 Q2；BLS 餐饮业工资序列 | 430 | 为「下周排班前该动哪一项」这个选择做铺垫 |
| 加班通常是你这周能砍的最大一项 | 加班集中在少数几个班次上，因此不裁人也够得着 | 加班预测截图；九次访谈中的四次 | 340 | 交付读者是为之而来的那一个动作 |
| 砍工时可能反而推高你的单客成本 | 从繁忙班次里抽掉工时，损失可能大于节省 | 证据缺失 | 190 | 拦住读者在没做检查的情况下就照第三节行动 |
| 收入变动时这个数字也会动，不只是人力变动时 | 一个销售好的星期能掩盖一个排班问题 | 对前面已引用的两个中位数做算术；无新数据 | 120 | 在不引入新说法的前提下收口 |

合计：1600 词。最大的一节是最小一节的 4.3 倍。

**已删除**

- 「什么是人力成本占比」（公式演算）——排名中的术语页已经覆盖了它，而一个已经打进具体数字的读者本来就有这个概念。把公式并成第一节里的一句话。
- 「降低人力成本的十五种方法」——我们对三个杠杆有证据，对另外十二个一个都没有；剩下那十二个会是伪装成周全的填充物。
- 「各州的预测性排班法规」——那是合规意图，不是本文的意图，而且我们没做过法务复核。它属于独立页面。
- 「区域基准值」——那 412 家门店拆到区域后，样本不足以发布，硬发就等于编造一个样本。

**证据缺失**

- 说法：从繁忙班次砍工时可能推高单客成本。需要：把人力工时与客单人次关联起来的数据。Shiftwell 有工时但没有人次。要么从有 POS 集成的那部分门店拉取人次，要么删掉这一节、在第三节里用一句话标出这个风险。

## Safety notes

在你信任这份大纲之前，把「用到的证据」那一列里的每一项都打开，确认它确实说了那个说法声称它说的话。这条提示词禁止编造数字，但这条指令无法自我验证；唯一真正的检查，是一个人把每个数字追回它的来源。特别留意那些「一个具体数字附着到了你只泛泛描述过的证据上」的章节，以及任何在两版之间**新长出一个来源**的章节。

这份大纲不对表现作任何宣称。字数分配是关于「论证在哪里需要展开空间」的编辑决定，不是排名输入项；删除清单反映的是这位作者**今天能拿出证据支撑什么**，不是这个主题在一般意义上需要什么。标着「证据缺失」的章节是一个**待做的决定**，不是一个用散文填上的缺口。

## FAQ

### 为什么要强制不等字数，而不是让写手后面自己分配？

因为分配本身就是大纲。一旦每节篇幅都差不多，文章就没有重心，读者得自己去找哪一部分回答了他的问题。在大纲阶段就逼出这个分歧，代价最低——那时在两节之间挪 200 词不花任何成本。

### 模型删掉了我想保留的一节，我该怎么办？

先读它给的理由。如果理由是「某个排名页已经覆盖了它」，那么有用的问题是：你能补上那个页面没有的什么？答案通常是一份你手上的证据。有这份证据，就把它写进 `available_evidence` 重跑；没有，那这次删除大概是对的。

### 我没有任何一手数据，它还管用吗？

部分管用，而且它会明说。没有提供任何证据时，产出是一份每节都标着「证据缺失」的说法清单——这是诚实的，但不是一份能交给写手的大纲。**公开来源也算证据**，所以一个你能用已发布数据、文档或你自己的产品行为去支撑的主题仍然可行。一个你什么都支撑不了的主题，是一个「该换个主题」的信号，而不是「照写不误」的信号。

### 竞品页面那一项可以不填吗？

可以，而且提示词会说明它因此损失了什么。没有它，删除只能基于搜索意图，于是大纲可能保留了三个排名页已经做得更好的一节，或者删掉了你唯一真正的差异点。花十分钟读一遍前排结果、给每个粘两行摘要，对删除清单的改变，比这个页面上任何其他输入都大。
