---
title: AI 初稿编辑提示词
description: 把 AI 初稿编辑成可发布的文字：删掉清嗓子式开场和机器节奏，并把每一处需要事实支撑的说法标出来，而不是替你编一个。
category: writing
useCase: 编辑
outputFormat: 改写后的稿件
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: AI 内容去味提示词, AI 初稿编辑提示词, 编辑 AI 生成内容, 去除 AI 写作痕迹, AI 文本改写提示词, AI 内容编辑
relatedSkill: content-brief
relatedPrompts: seo-blog-post-writing-prompt, content-refresh-rewrite-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are a line editor preparing an AI first draft for publication.

# Scope
Edit the draft below so it reads like it was written by someone who knows the
subject. This is an editing job, not a detector-evasion job. Do not optimise for
AI-detection scores, do not add typos or filler to sound human, and do not
invent a number, a date, a name or an anecdote to make a sentence sound
specific. Fabricated specificity is a worse failure than the generic sentence
you started with.

# Inputs
Draft to edit: {{draft_text}}
What this page is and who reads it: {{page_context}}
Facts you are allowed to add: {{verified_facts}}
Voice sample from a published page: {{voice_sample}}
Elements that must survive the edit unchanged: {{locked_elements}}

# What to produce
A rewritten draft, a change log of the edits, and a list of the places where the
draft needs a fact you were not given.

# Steps
1. Read the draft once against {{page_context}}: what should this reader be able
   to do afterwards, and which paragraphs do not move them there. Paragraphs
   carrying no claim a reader could disagree with get cut, not rewritten.
2. Delete the throat-clearing. The first sentence that tells the reader
   something they did not know is the real opening. Cut everything above it.
3. Break the machine rhythm. Look for three-item lists used for cadence rather
   than completeness, "not just X but Y" constructions, matched paragraph
   lengths, trailing participles that add nothing ("making it a valuable tool"),
   and transitions such as moreover, furthermore and additionally that join
   sentences with no logical turn. Cut the padding, keep the item that carries
   information, and let paragraph lengths differ.
4. For every vague claim, make one of three decisions and record which:
   replace it with a fact from {{verified_facts}}, cut the sentence, or keep it
   and list it as a gap. Never resolve vagueness by supplying a plausible
   number. "Studies show" with no study named is a gap, not a sentence to
   improve.
5. Rewrite hollow sentences as claims with an owner. "It is widely considered
   best practice" becomes either who considers it that, or nothing.
6. Read the result against {{voice_sample}} for sentence length, contraction
   use and how directly it addresses the reader. Match those habits, not its
   phrasing.
7. Confirm every item in {{locked_elements}} survived the edit unmodified.

# Output format
1. "Edited draft" - the full rewritten text, ready to paste.
2. "Change log" - a table with the columns: Original phrase | What was wrong |
   What replaced it. One row per substantive edit. Skip pure typo fixes.
3. "Needs a fact" - a numbered list of sentences that stayed vague for want of a
   verified fact, each with the specific question a subject-matter expert has to
   answer.

# Quality checks before you answer
- Every number, date, name and product capability in the edited draft traces to
  the original or to {{verified_facts}}. Nothing new.
- The edited draft contains no anecdote or customer story that was not in the
  input.
- No paragraph opens with a transition that could be deleted without changing
  the meaning.
- Paragraph lengths vary. No run of three paragraphs with the same shape.
- Every locked element is present, unchanged.
- The change log accounts for each meaningful difference between the drafts.

# When the input is thin
If {{verified_facts}} is empty, edit for structure and rhythm only, say plainly
that specificity could not be added, and list every vague claim under "Needs a
fact". If the draft is too short to have a rhythm problem, say so and return
only what still needs work.

# Boundaries
Do not promise rankings, traffic or revenue. Do not add or remove terms to reach
a keyword density, and do not repeat a term a set number of times. Do not claim
the edited draft will pass any AI-detection tool; that is not what this edit
does and those tools are not reliable enough to target. If a sentence can only
be fixed with information you do not have, say so instead of writing something
that sounds right.
```

## Variables

### draft_text
Required. AI 初稿，整篇粘进来。保留原有的标题层级和链接，好让编辑看清哪些是它可以动的。
Example: In today's fast-paced e-commerce landscape, inventory accuracy is more important than ever...

### page_context
Required. 这个页面是干什么的、谁读它。它决定了哪些段落配留在页面上、哪些是填充物。
Example: Blog post for Bramble, a warehouse inventory app; read by ops leads at 5-50 person e-commerce brands running one warehouse

### verified_facts
Optional. 允许编辑补进去的具体内容，**且只有这些**。数字、产品默认值、有名有姓的来源、内部测量结果连同它的限定条件。
Example: Bramble default cadence, set by ABC class, is A items weekly, B monthly, C quarterly

### voice_sample
Optional. 从你已经发布且满意的页面里摘两三句。用来给句式习惯定调，不是给主题定调。
Example: You don't need a barcode scanner to start. A phone camera and a printed bin map get you through the first count.

### locked_elements
Optional. 必须原样返回的标题、链接、锚文本、产品名或法务措辞。
Example: H2 "Where to start"; the link to /guides/bin-locations; product name spelled Bramble

## How to use

把提示词粘进去，填好这五个占位符。决定产出有没有价值的是 `verified_facts`：有它，编辑才能把「显著更快」换成一个真实数字；没有它，每一处软性说法都会落进「需要事实」清单，这一轮就只是结构性编辑。这是设计如此，不是失败，但它意味着空着 `verified_facts` 换来的是一份更紧凑的稿子，而不是一份更可信的稿子。

产出只需要看一遍：读变更记录的右列，确认里面每一个具体内容都能在你的输入里找到。**编造就出现在这里**。常见形态有三种：凭空冒出的数字（「最高快 40%」）、一个并不存在的具名研究、以及一段关于某个客户或某个仓库的第一人称轶事——而模型从没见过那个仓库。编辑稿里任何既追溯不到原稿、也追溯不到 `verified_facts` 的内容，都是编造的；变更记录是最快抓到它的地方，因为模型必须把自己放进去的东西写下来。

按大约 800 到 1,200 词一段来做。面对一篇完整的 3,000 词文章，模型会从「编辑」滑向「概括」，而破绽就在变更记录里：前三分之一记得很细，之后越来越稀。把后半段单独重跑，而不是要求它把记录写长一点。

另一个要盯的失败是**矫枉过正**。被要求打破对称节奏后，模型有时会产出满页短促的陈述句——那只是换了一种统一节奏而已。如果产出里每句话都不到十二个词，就把编辑稿粘回去、填上 `voice_sample`，并且只要求它调整句长的变化。

## Example input

```text
Draft to edit:
In today's fast-paced e-commerce landscape, inventory accuracy is more important
than ever. Cycle counting has emerged as a powerful solution for warehouse teams
looking to maintain accurate stock levels without the disruption of a full
physical inventory.

Cycle counting isn't just about counting products - it's about building a culture
of accuracy. By counting a small subset of SKUs on a regular basis, teams can
identify discrepancies early, address root causes quickly, and improve overall
inventory health. Moreover, this approach allows operations to continue
uninterrupted, which is critical for growing brands.

It's worth noting that most experts agree cycle counting delivers significant
improvements in inventory accuracy. Studies show that companies implementing
cycle counts see substantial reductions in shrinkage. Furthermore, Bramble's
cycle count feature is highly scalable, making it a valuable tool for warehouses
of all sizes.

## Where to start

To get started, teams should first segment their SKUs, then establish a counting
cadence, and finally train staff on the process. Setting up
[bin locations](/guides/bin-locations) correctly is a foundational step in this
journey.

What this page is and who reads it: Blog post for Bramble, a warehouse inventory
app; read by ops leads at 5-50 person e-commerce brands running one warehouse.

Facts you are allowed to add:
- Bramble default cadence, set by ABC class: A items weekly, B monthly, C
  quarterly.
- Support categorises count-discrepancy tickets; the three largest categories are
  receiving errors, unrecorded damage write-offs and mis-scanned bin locations.
  We have not published the split between them.
- At our own fulfilment site, one picker counts 40-60 SKUs in about 45 minutes
  across a 5,000 sq ft floor. Single site, single floor plan.

Voice sample from a published page: You don't need a barcode scanner to start. A
phone camera and a printed bin map get you through the first count; the scanner
pays for itself later, when counting gets boring.

Elements that must survive the edit unchanged: H2 "Where to start"; the link to
/guides/bin-locations with its anchor text; product name spelled Bramble.
```

## Example output

**编辑稿**

```text
Cycle counting means counting a slice of your SKUs while the warehouse keeps
running, instead of closing the floor for a full physical count.

The reason to count a slice is timing. A discrepancy found weeks after a SKU
was last received still has a paper trail you can walk back. The same
discrepancy found in a full physical count, long after that receipt, does not.

Bramble's default cadence is set by ABC class: A items weekly, B monthly, C
quarterly. Change it if your mix demands it.

Our support team sorts count-discrepancy tickets into categories, and the three
largest are receiving errors, unrecorded damage write-offs and mis-scanned bin
locations. We have not published how the volume splits, so treat that as a list
to check, not a ranking.

## Where to start

Segment your SKUs first. Then set a cadence you can hold for a full quarter
rather than the one that sounds most rigorous. Set up your
[bin locations](/guides/bin-locations) before the first count; a wrong bin map
produces discrepancies that are not discrepancies.

At our own fulfilment site, one picker counts 40 to 60 SKUs in about 45 minutes
across a 5,000 sq ft floor. That is one site and one floor plan; use it to
sanity-check your first count, not as a target.
```

**变更记录**

| 原文 | 问题出在哪 | 换成了什么 |
| --- | --- | --- |
| "In today's fast-paced e-commerce landscape..." | 清嗓子式开场；对一个运营负责人来说没有任何新信息 | 删除；页面直接从定义开始 |
| "isn't just about counting products - it's about building a culture of accuracy" | 给一个无法核查的说法套了个修辞框架 | 换成真正的机制：早发现的错误还留有可回溯的凭证 |
| "identify discrepancies early, address root causes quickly, and..." | 为盘点频率凑了三项，第三项只是前两项的复述 | 保留机制，删掉那对凑数的 |
| "Moreover"、"Furthermore"、"It's worth noting that" | 没有任何逻辑转折的连接词和缓冲语 | 删除；句序本身承载了关系 |
| "Studies show... substantial reductions in shrinkage" | 把一个测量结果归给了一个没有名字的来源 | 删除，并列入缺口清单 |
| "making it a valuable tool for warehouses of all sizes" | 不承载任何信息的尾随分词结构 | 换成实测的盘点速度，并带上「仅一个站点」的限定 |
| "first segment... then establish... and finally train staff" | 对称三段式；第三步没有内容 | 换成两条具体指令；培训移入缺口清单 |

**需要事实**

1. 库存损耗。原稿声称「研究表明有大幅下降」，但没有提供任何研究。我们有没有一个具名来源，带数字和样本范围？
2. 「多数专家认为」。点名那位从业者或那个标准，否则这句话不进稿。
3. 培训。在 Bramble 语境下，「培训员工」具体指什么：一份检查清单、一次有人带的首次盘点、还是一个权限级别？没有答案，它就只是个占位符。

## Safety notes

在你信任这份产出之前，先核实编辑稿里每一处具体内容都能追溯回你的输入。变更记录让这件事很快，但这条提示词「不编造」的约束，强度取决于你的复核：一个被要求「让文字更像人写的」模型，如果你不拦着，它就会去够一个客户故事或一个百分比，而一个被编造出来的内部测量结果，出现在已发布页面上的破坏力，远大于它替换掉的那句平淡的话。同时确认锁定元素原样返回了——链接和标题是改写中最常被弄丢的东西。

这条提示词**不对 AI 检测分数作任何承诺**，也不应被当成达成某个分数的手段。它同样不做核实。如果原稿在某个事实上是错的，编辑稿会把这个错误说得更流畅——那更糟。事实核查是另一轮工作，得有来源摆在你面前。

## FAQ

### 这能让稿子通过 AI 检测器吗？

它不做这件事，任何提示词也不该承诺这件事。检测工具在两个方向上都会误判：被人重度编辑过的作品会被标红，而略加改动的机器文本能通过。把检测分数当作验收标准，会把你推向「为分数而写」而不是「为读者而写」。为读者编辑，分数是多少就是多少。

### 为什么它把含糊的句子留在稿子里而不是修好？

因为含糊说法唯一真正的修法是补上一个事实，而编造事实正是这条提示词要防的失败。把句子标出来，等于把决定权交给能回答它的人——通常只是花五分钟问同事一句。如果你宁愿让这句话消失、也不愿它躺在缺口清单里，就告诉提示词：无法落实的说法直接删，而不是保留。

### 什么情况下它帮不上忙？

当稿子根本没有论点时。编辑一个没有论点的页面，你得到的是一个更短的、没有论点的页面，变更记录会几乎全是删除、且没有任何替换。大纲本身错了也一样：如果页面回答的是读者没问的问题，再多的句子级编辑也救不回来，你该回到内容简报。**当「需要事实」清单比编辑稿还长**，这就是个信号：这篇东西是在缺少必要知识的情况下写出来的。

### 我能把它用在人写的稿子上吗？

可以。它针对的那些模式并非机器输出独有；三段式排比的习惯、空心连接词、清嗓子式开场，在人类初稿里同样常见。唯一要调整的是 `verified_facts`，它在这里更重要——人类作者通常心里有一些具体内容，只是从来没写到页面上。
