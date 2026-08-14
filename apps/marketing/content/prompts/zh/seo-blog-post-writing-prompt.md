---
title: SEO 博客写作提示词
description: 把内容简报变成一份完整初稿：需要一手证据的地方直接标出来，而不是编造数据、客户名或研究引用。
category: writing
useCase: 初稿
outputFormat: 初稿
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: SEO 博客提示词, AI 写文章提示词, 内容简报转初稿, 初稿提示词, 大纲转初稿, SEO 写作提示词, ChatGPT 写博客提示词
relatedSkill: content-brief
relatedPrompts: seo-article-outline-prompt, humanize-ai-content-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are a staff writer producing a first draft from a brief. You write what the
brief and the supplied evidence support, and nothing else.

# Scope
Produce a draft an editor can mark up. Do not invent facts. You may not write a
statistic, a percentage, a currency figure, a study, a named researcher, a named
customer, a case study, a quote, or a survey result unless it appears in the
inputs below. Where the argument needs evidence you were not given, mark the gap
instead of filling it.

# Inputs
Brief or outline: {{content_brief}}
Who is reading this: {{target_reader}}
Evidence I can actually use: {{available_evidence}}
Voice and style constraints: {{brand_voice}}
Target length and structure: {{draft_length}}

# What to produce
One draft that follows the brief's section order, written for the reader
described above, plus a ledger of every evidence gap you marked.

# Steps
1. Restate the brief's angle in one sentence for yourself. Every section must
   serve that angle. Drop sections that do not and say which.
2. Open by naming the situation the reader is in and the decision this article
   helps them make. No throat-clearing paragraph, no definition of a term the
   reader already uses at work.
3. Write each section in the brief's order. Use the primary and secondary terms
   where they read naturally in a heading or a sentence. Never repeat a term to
   reach a count and never bend a sentence to fit one in.
4. Every time you reach a claim that needs a number, a source, a customer
   example, or a screenshot you were not given, stop and write a marker in place
   of the evidence:
   [EVIDENCE NEEDED: what to supply | what the sentence claims without it]
   Write the surrounding sentence so the draft still reads, but do not write the
   number.
5. Use the items in the evidence input exactly as given. Do not round them,
   widen them into ranges, generalise your own measurement into an industry
   claim, or attribute anything to a party other than the source named.
6. Close with the next step the brief specifies. Do not invent an offer, a
   price, a discount, or a deadline.
7. Collect every marker into the evidence ledger, keyed to the section it came
   from.

# Output format
1. A header block: working title, one alternative title, and a meta description
   under 155 characters.
2. The draft in Markdown with H2 and H3 headings, in the brief's order.
3. "Evidence to supply before publishing" - a table with columns: Section |
   What is needed | Who can provide it | What the sentence claims without it.
4. "Cut from the brief" - anything you dropped, and why. Omit if nothing.

# Quality checks before you answer
- Every number, date, percentage, study, company name and quote in the draft
  traces to a specific line in the inputs. If you cannot point at the line,
  delete the claim.
- Every [EVIDENCE NEEDED] marker in the draft appears in the ledger, and every
  ledger row appears in the draft.
- No sentence promises a result the product cannot be shown to produce.
- No heading and no sentence exists only to carry a search term.
- The draft reads as one voice, not a stack of summary paragraphs.

# When the input is thin
If the brief has no angle, say so, write against the most defensible angle the
inputs support, and name the substitution at the top. If the evidence input is
empty, write the draft entirely with markers and state plainly that it is
unpublishable until they are filled. Do not soften a missing number into "many",
"most", or "studies show" - that is the same fabrication with less precision.
Do not estimate.

# Boundaries
Do not promise rankings, traffic, revenue, or a timeline. Do not state a keyword
density or a repetition count. Do not write testimonials, review text, or a
customer story unless the words were given to you. Do not cite a source you
cannot name from the inputs.
```

## Variables

### content_brief
Required. 初稿据以撰写的简报或大纲：暂定标题、主要与次要词、搜索意图、切入角度，以及章节顺序。
Example: Working title "How to Schedule HVAC Technicians Without Losing the Afternoon to Drive Time"; primary term "how to schedule hvac technicians"; angle: dispatch order, not headcount, decides afternoon capacity

### target_reader
Required. 谁读这篇、他已经知道什么。它决定了你要解释到什么程度、文章可以从哪里开始。
Example: Owner-operator or dispatcher at a residential HVAC company with 5 to 40 technicians, currently scheduling on a whiteboard or a shared calendar

### available_evidence
Required. 你被许可使用的具体事实、数字、截图和引语，**按你会粘贴的样子原样写出来**。同时说明你没有什么，好让模型把缺口标出来而不是填上。
Example: Our own anonymised product data: median first job starts 8:10am, median last job starts 3:40pm. No third-party benchmarks. Two customer interviews on file, quotes not cleared for attribution.

### brand_voice
Optional. 初稿必须遵守的文风规则，包括你从不使用的词。
Example: Second person, short paragraphs, no exclamation marks, never use "solution" or "revolutionize"

### draft_length
Optional. 目标篇幅与标题结构。留空则模型按简报的章节数走。
Example: 900 to 1200 words, H2 per brief section, H3 only where a section needs steps

## How to use

先填 `available_evidence`，而且要填**你能原样粘贴的那些句子**，不是对你数据的描述。「我们有客户数据」会被读成一种许可，然后产出一堆不知从哪来的具体数字；「首单中位开始时间 8:10，来自我们自己的账户数据」会被读成一个事实，并按原样使用。最省编辑时间的一句话，是写明**你没有什么**的那句——它把每一个依赖于那份缺失证据的说法，从一个看似合理的编造变成一个标记。

在你按文风去读之前，先**机械地**核一遍产出。在初稿里搜数字和百分号，确认每一处命中都能追溯到你输入里的某一行。然后确认正文里的标记数量与清单里的行数一致。你真正会撞上的失败是**混合句**：模型既写了标记，又在旁边写了一个用于示意的数字，通常还是个整数。删掉数字，保留标记。

第二种常见失败来自简报本身。如果你的简报里已经含有一个没来源的统计数字，这条提示词会把它当作已提供的证据并复述出来——因为它无法区分「你核实过的事实」和「上一版初稿编出来的事实」。**先把简报清干净**，否则那处编造会带着你的署名活到初稿里。

某一节不对时，就要求**针对同样的输入重写那一节**，而不是整条重跑。整条重跑会打乱你已经接受的章节、并把每一个标记重新编号，那意味着整份清单要从头核过。

## Example input

```text
Brief or outline:
  Working title: How to Schedule HVAC Technicians Without Losing the Afternoon to Drive Time
  Primary term: how to schedule hvac technicians
  Secondary: hvac dispatch schedule, technician routing
  Intent: how-to, practitioner looking for a working method
  Angle: dispatch order, not headcount, decides afternoon capacity
  Sections: 1 Why afternoon jobs run long / 2 Build the day around the two fixed
  appointments / 3 Group jobs by drive time, not job type / 4 What to say when a
  tech runs late / 5 Leave one slot open for the same-day call / 6 When to stop
  scheduling by hand
  Internal links: /guides/dispatch-board, /pricing
  Next step: book a 20-minute walkthrough
Who is reading this: Owner-operator or dispatcher at a residential HVAC company
  with 5 to 40 technicians, currently scheduling on a whiteboard or a shared
  calendar
Evidence I can actually use:
  - Kestrel Field product screenshots: dispatch board, drive-time grouping,
    same-day slot
  - Our own anonymised account data: median first job starts 8:10am, median last
    job starts 3:40pm
  - Two customer interviews on file, quotes NOT cleared for attribution
  - No third-party research, no industry benchmarks, no survey data
Voice and style constraints: Second person, short paragraphs, no exclamation
  marks, never use "solution" or "revolutionize"
Target length and structure: 900 to 1200 words, H2 per brief section, H3 only
  where a section needs steps
```

## Example output

**暂定标题：** How to Schedule HVAC Technicians Without Losing the Afternoon to Drive Time
**备选：** HVAC Technician Scheduling: Build the Day Around Drive Time
**Meta description：** A dispatch method for residential HVAC teams: anchor the fixed appointments, group by drive time, and keep one slot open for the same-day call.

---

**H2: Why afternoon jobs run long**

By two o'clock the board still looks reasonable and every truck is still moving. By four, the last two calls have slid to tomorrow. Most owners read that as a headcount problem and start pricing a sixth technician.

Across Kestrel Field accounts, the median first job starts at 8:10am and the median last job starts at 3:40pm. That is a seven and a half hour working window, and the jobs themselves do not expand to fill it. What expands is the distance between them. [EVIDENCE NEEDED: share of that window spent driving, from our route logs | the sentence claims drive time is the binding constraint and currently cannot show it]

**H2: Build the day around the two fixed appointments**

Most days have one or two calls that cannot move: the maintenance visit the customer took a morning off for, the install with a delivery window. Place those first, then build outward. Scheduling them last is what forces a truck across town at 1pm.

*[第 3、5、6 节形态相同，此处因篇幅省略。]*

---

**发布前需要补齐的证据**

| 章节 | 需要什么 | 谁能提供 | 没有它这句话在宣称什么 |
| --- | --- | --- | --- |
| Why afternoon jobs run long | 8:10 到 15:40 这个窗口里花在路上的占比 | 数据团队，取自路线日志 | 宣称约束条件是路上时间而不是人手 |
| Group jobs by drive time | 某个具名客户的改前改后对比，需书面授权 | 客户成功 | 宣称重新分组能为每台车找回产能 |
| Group jobs by drive time | 每位技师每日工单数的行业数字 | 不可得——输入中没有任何第三方来源 | 宣称读者现在的数字低于正常水平 |
| When to stop scheduling by hand | 一条已授权署名的调度员引语 | 客户成功——存档两次访谈，均未授权 | 宣称手工排班会在某个具体团队规模上崩掉 |

**从简报中删去**

第 4 节「技师迟到时怎么跟客户说」属于客户沟通，不属于派工顺序。它不服务「路上时间」这个切入角度，读起来该是独立的一页。

## Safety notes

发布前，复核者必须把每一个标记用三种方式之一关闭：补上证据、删掉那个说法、或者把句子改写到不再依赖那个缺失的数字。把标记软化成「许多承包商发现……」，正是这条提示词要防的失败，也是编辑收尾时最容易犯的一种。核对清单时要**对着终稿**，不是对着你最初收到的那一版。

这条提示词抑制编造，但它不做事实核查。你在 `available_evidence` 里提供的一切，都是**以你的名义**复述出来的，包括你粘进去时就已经错了的数字。产出中没有任何内容宣称这份初稿会获得排名、流量或转化，产出中也没有任何东西能告诉你简报里那个切入角度选得对不对。

## FAQ

### 它还是会编统计数字吗？

有时会，而风险最高的输入是**你自己的简报**。躺在简报里的数字会被当作已提供的证据、不加标记地复述出来，因为提示词无法分辨哪个是你核实过的、哪个是早前某版编出来的。机械检查比用眼睛读更快：在终稿里搜数字和百分号，把每一处命中追回输入的某一行。

### 我能带着标记发布吗？

不能，而且这些标记被刻意做得很难看，就是为了让漏发一个变成一件尴尬的事，而不是一件容易忽略的事。如果某个标记无法被填上，就删掉它支撑的那个说法，而不是给它加个缓冲。**一个失去数字之后还活得下来的段落，本来就没有在做基于证据的论证。**

### 它适用于产品页和品类页吗？

不太适用。它是为「有章节顺序的简报 + 想要一段解释的读者」而建的，因此假定产出是散文。由规格、价格表或筛选列表构成的页面，内容由结构化数据决定，那里有用的约束是**完整性**，而不是防编造。

### 为什么它从不告诉我关键词该用几次？

因为不存在一个能改变页面表现的重复次数，而照着一个次数去写，产出的句子读起来就是为凑指标而写的。这条提示词的要求是：那些词出现在读起来自然的地方，并且禁止为了承载某个词而新增一个标题或一句话。如果某个词在整篇初稿里确实哪儿都放不进去，那是一个信号：简报的切入角度和它的主要词，描述的是两个不同的页面。
