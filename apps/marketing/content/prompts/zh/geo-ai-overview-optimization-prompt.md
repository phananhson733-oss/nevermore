---
title: AI 答案可见性提示词
description: 逐段重写页面，让助手能从中引用出正确、可独立成立的答案；同时给出一个不加修饰的判断——只改页面到底能不能改变什么。
category: geo
useCase: GEO
outputFormat: 改写方案
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: AI 搜索优化提示词, GEO 提示词, 生成式引擎优化, AI 引用优化, AI Overview 优化, 被 AI 引用, LLM 引用 SEO
relatedSkill: geo-ai-visibility
relatedPrompts: faq-generation-schema-prompt, content-refresh-rewrite-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are an editor restructuring one page so an assistant can lift a correct
answer out of it, and reporting honestly on whether that will change anything.

# Scope
Work only from the page content and facts pasted below. Do not add numbers,
dates, sources, or claims that were not given to you. Where an answer needs a
fact you were not given, write the gap as a marker, never as a plausible value.

# Inputs
The page and who it serves: {{target_page}}
The page as published: {{page_content}}
Questions this page should be able to answer: {{target_questions}}
What exists about this entity off our own site: {{offsite_presence}}
Facts we can stand behind, with dates: {{verified_facts}}

# What to produce
A revision plan: passage by passage, the text as published and its replacement,
plus a plain statement of what the revisions can and cannot affect.

# Steps
1. For each question, find the passage that answers it and quote it word for
   word. If nothing on the page answers it, record that. Do not write the
   answer yet.
2. Read each quoted passage alone, as if pasted somewhere with no heading and
   no sentence before it. Mark what breaks: a pronoun with no antecedent, "we"
   with no entity named, a comparative with no baseline, a figure with no unit
   or date, a qualifier such as "fast" standing in for a number.
3. Check how the entity is named. A reader arriving cold must be able to tell
   which organisation or product this is and separate it from others with
   similar names. Name it in full wherever a passage would travel without it.
4. Sort every checkable claim into three piles: sourced on the page; true and
   supportable but with no source shown; unsupportable as written. Claims of
   standing — leading, trusted, award-winning — go in the third pile unless a
   named source was supplied.
5. Write the replacements. Each replacement answers its question in the first
   sentence, names the entity, states the scope it applies to, and carries a
   date where the fact can go stale. Use only facts from the pasted page or the
   supplied list. Where a replacement needs a fact you do not have, write
   [fact needed: ...] in its place and move on.
6. Assess retrieval separately from extraction. If no independent source
   describes this entity, say plainly that these revisions do not cause an
   assistant to cite the page: they make it quotable once it is already
   retrieved, which without off-site presence means mostly branded queries.
   List the off-site work required as its own item, outside the page plan.
7. Close with what the plan does not change.

# Output format
A coverage table: Question | Answered as published | Passage or "not answered".
Then a revision table: Section | Current text | Replacement | What it fixes.
Then the [fact needed] list, entity naming, the retrieval assessment, and what
this plan does not change.

# Quality checks before you answer
- Every quoted current text appears word for word in the pasted page.
- Every replacement still reads correctly with nothing above it.
- No number, date, source, or accreditation appears that was not supplied;
  gaps are markers, not values.
- The retrieval assessment states the limit in plain words and nowhere
  describes page edits as producing citations.
- No recommendation involves repeating a term a set number of times.

# When the input is thin
If no questions were supplied, derive candidates from the page's own headings,
label them as inferred, and confirm before treating them as the brief. If the
off-site input is blank, treat it as unknown rather than as nothing, say the
retrieval assessment cannot be made, and name what to go and check. Never
estimate a citation rate, a share of answers, or a visibility score.

# Boundaries
Do not promise citation, inclusion in an AI answer, rankings, or traffic. Do
not present structured data or a machine-readable file as a mechanism that
causes an assistant to cite the page. Do not turn the page into a wall of
questions. Do not delete a claim you were given a source for.
```

## Variables

### target_page
Required. 页面 URL、这个页面是干什么的、谁会读它。这一项决定了一段在内部人读来通顺的文字，对外部人来说是否根本读不通。
Example: https://otterbecksoil.co.uk/services/soil-carbon-testing — service page for Otterbeck Soil Lab, read by farm managers deciding where to send samples

### page_content
Required. 页面已发布的样子，按阅读顺序，标题一并带上。粘正文，不要粘导航、Cookie 横幅或页脚。
Example: H2: Fast, reliable results / We turn tests around fast, so you are never left waiting on an agronomy decision.

### target_questions
Required. 真实会有人打进助手里、而这个页面本该能回答的问题。从销售通话和客服工单里取，不要从关键词工具里取。
Example: How long does a soil carbon test take? How much does soil organic carbon testing cost in the UK?

### offsite_presence
Required. 在你自己网站之外、描述过这个实体的一切：目录收录、媒体提及、参考类词条、评价、署名文章。如果确实没有，就写 "none that I know of"；只有在你还没查过的时候才留空。
Example: Listed in the Soil Association supplier directory as a name and postcode; no Wikipedia or Wikidata entry; no third-party reviews

### verified_facts
Optional. 你敢背书的数字、日期、方法和来源，每一条都带上它成立的日期。这里缺的东西，回来时会是一个 [fact needed] 标记，而不是一个数字。
Example: Turnaround 10 working days from sample receipt; median 8 working days across 2025 over 1,140 samples

## How to use

把页面原样粘进来，然后**先填 `verified_facts`，再跑**。这个顺序很重要：这条提示词的作用就是把含糊的文案换成具体的文案，而挡在「具体」和「编造的具体」之间的，只有你给的那份事实清单。你把 "we turn tests around fast" 丢给它、事实清单却是空的，模型会很乐意写出 "within 5 to 7 business days"，因为同类页面通常就是这么写的。`[fact needed]` 标记是你的探针——一个满是没有量化的说法的页面，改写方案回来时一个标记都没有，说明缺口是它自己填上的。替换那一列里的每个数字，都要对着你的事实清单逐行核。

第二种失败是「FAQ 条件反射」。你让任何模型把页面改得更好被助手使用，第一稿往往就是把原页面每段上面加一个问句形式的小标题。那不是交付物。交付物是**经得起被单独引用的段落**：把任意一句替换文案抽出来，粘进一个空白文档，看它是否还说得清这是关于谁的、适用范围是什么、什么时候成立。如果说不清，这次改写就没做到位，而在上面加个问句并不能补救。

第三种失败最要紧，它表现为一种软化。检索那一节回来时写着「持续积累主题权威度会提升 AI 可见性」——一句听着像计划、实际什么都没承诺的话。看到它，就问模型一个问题：除了我们自己的网站，说出**一个**助手能检索到、并且描述了我们的来源。如果诚实的答案是「没有」，那么诚实的结论就是：这些页面改动不会改变你是否被引用。这条提示词就是写来说出这句话的，而不是写来把改写推销给你的。

拿到方案之后，分两条线推进。改写表是一件你这周就能写完的活。站外清单是另一种性质的工作、归另一个人管；把它当成内容工单下面的一个跟进条目，正是它一年都没人做的原因。

## Example input

```text
The page and who it serves: https://otterbecksoil.co.uk/services/soil-carbon-testing — service page for Otterbeck Soil Lab, an independent soil-testing laboratory in Shropshire. Read by farm managers and land agents deciding where to send samples.

The page as published:
H1: Soil Carbon Testing
Understanding what is in your soil starts here.

H2: Fast, reliable results
We turn tests around fast, so you are never left waiting on an agronomy decision. It typically takes about a fortnight, though this varies with demand.

H2: The method
The lab uses the industry-standard method for organic carbon, and we can also offer a cheaper screening option if budget is a concern.

H2: Why choose us
We are the leading soil carbon lab in the Midlands. Our results are trusted by farms across the region and our team has decades of combined experience.

H2: Accreditation
We are fully accredited, so your results will stand up wherever you need to submit them.

H2: Pricing
Pricing is competitive. Get in touch for a quote and we will build a package around your holding.

H2: Sampling
Sample density depends on your situation. Talk to us and we will advise.

Questions this page should be able to answer:
How long does a soil carbon test take?
How much does soil organic carbon testing cost in the UK?
What method is used to measure soil organic carbon?
Is Otterbeck Soil Lab accredited?
How many soil samples do I need per hectare?

What exists about this entity off our own site: Listed in the Soil Association supplier directory as a name and postcode, no description. Named once, without a link, in a Farmers Weekly piece on carbon markets in March 2025. No Wikipedia or Wikidata entry. No third-party reviews anywhere. Two case studies exist but sit only on our own site. Nobody at the lab has published a bylined article. A branded search returns our own site and the directory listing.

Facts we can stand behind, with dates:
Turnaround: 10 working days from sample receipt is the published commitment; median across 2025 was 8 working days over 1,140 samples.
Method: dry combustion (Dumas) on a LECO analyser for total organic carbon. Loss-on-ignition offered as a lower-cost screen, reported separately, not interchangeable with dry combustion results.
Accreditation: ISO/IEC 17025, certificate 4471, first issued March 2024; current scope covers total organic carbon and pH.
Price: 48 GBP per sample; 75 GBP mobilisation fee if we take the samples. Current as of 1 July 2026.
Sampling density: we have no defensible per-hectare figure. We advise per field.
```

## Example output

**覆盖情况**

| 问题 | 现页面是否回答 | 对应段落 |
| --- | --- | --- |
| How long does a test take? | 部分回答 | "It typically takes about a fortnight" |
| How much does it cost? | 否 | "Pricing is competitive." |
| What method is used? | 否 | "the industry-standard method for organic carbon" |
| Is the lab accredited? | 否 | "We are fully accredited" |
| Samples per hectare? | 否 | "Sample density depends on your situation." |

**改写清单**

| 章节 | 现有文案 | 替换为 | 修好了什么 |
| --- | --- | --- | --- |
| Fast, reliable results | "It typically takes about a fortnight" | Otterbeck Soil Lab returns soil carbon results within 10 working days of sample receipt. The median across 2025 was 8 working days over 1,140 samples. | "It" 一旦被单独引用就没有先行词；两周也不是对外承诺的时限 |
| The method | "The lab uses the industry-standard method for organic carbon" | Otterbeck measures total organic carbon by dry combustion (Dumas) on a LECO analyser. Loss-on-ignition is offered as a lower-cost screen, reported separately and not interchangeable with dry combustion. | 点名了方法；把两种不等价的检测分开说 |
| Why choose us | "We are the leading soil carbon lab in the Midlands. Our results are trusted by farms across the region" | Delete the first sentence; replace the second with [fact needed: holdings tested, or years in operation]. | 没有来源的地位类说法；换成一个数量就可核查了 |
| Accreditation | "We are fully accredited, so your results will stand up wherever you need to submit them." | Otterbeck Soil Lab is accredited to ISO/IEC 17025 under certificate 4471, first issued March 2024. The scope covers total organic carbon and pH. | 写明标准、证书号与覆盖范围；去掉了「别人一定认」这种承诺 |
| Pricing | "Pricing is competitive. Get in touch for a quote" | Soil carbon testing at Otterbeck Soil Lab costs 48 GBP per sample. On-site sampling adds a 75 GBP mobilisation fee. Prices current as of 1 July 2026. | 带上日期，这个数字过期时看得出来 |
| Sampling | "Sample density depends on your situation." | Otterbeck Soil Lab does not publish a per-hectare density. Sampling density is set per field, and the lab advises on it. [fact needed: what the per-field density is set from] | 诚实作答而不是回避；缺的细节被标出来，不是被编出来 |

**缺哪些事实：** 两条——检测过多少农场、或成立多少年，用来替换 "trusted by farms across the region"；以及按地块定采样密度时依据的是什么。

**实体命名：** 正文从头到尾没写过自己的名字，每一处说法都挂在 "we" 或 "the lab" 上，于是任何一段被引用到页面之外时，都不带任何实体。现在每一节开头都写出 "Otterbeck Soil Lab"，导语还应说明它是什么、在哪：一家位于 Shropshire 的独立土壤检测实验室。

**检索评估：** 你自己网站之外，没有任何东西描述过 Otterbeck Soil Lab。目录收录只有一个名字和一个邮编；Farmers Weekly 那次提及是一行没有链接的文字。当有人问助手「英国哪些实验室做土壤碳检测」，助手关于你没有任何可检索的内容，所以这些改写不会带来引用。它们让页面在**已经被检索到之后**变得可引用，而今天这基本只意味着品牌词查询。站外工作（这不属于改页面）：把描述和证书号 4471 补进目录收录、请 Farmers Weekly 给 2025 年 3 月那次提及加上链接、把那两个案例放到自己域名之外。

**这份方案不会改变：** 搜索排名、任何助手是否引用该页面、以及流量。这三项都没有给出估算。

## Safety notes

在这份方案送到写手手上之前，对着 `verified_facts` **逐行**核替换那一列。替换文案里的每一个数字、日期、证书、方法名，以及每一句关于你们怎么做事的陈述，都必须能追溯到你提供的某条事实——追溯不到的，就是模型在写「像你们这样的实验室大概会这么说」的话。然后反过来核删除项：这条提示词会因为没有附来源而删掉地位类说法，而偶尔业务上确实有人手里有那个来源。把这类内容补回去时要点名来源，而不是原样恢复原来的说法。

这份方案刻意不说页面会被引用、会被检索到、会出现在 AI 答案里，也不给可见性分数或答案占比。它只做一个很窄的承诺：改写后的段落被单独读时，说得清自己在说什么。这一点你一分钟内就能自己验，这正是它敢承诺的原因。

## FAQ

### 这能让我的页面被 AI 答案引用吗？

不能，这条提示词也刻意不这么宣称。重构改变的是：页面一旦被检索到之后，其中的段落能否被正确提取和引用。检索发生在更上游，主要取决于是否有独立来源描述过你。在一个没有任何站外存在的站点上，可以预期这些改动会让别人**已经**按你的名字问到的答案变得更准，除此之外不改变什么。

### 我该加 FAQ schema 或者 llms.txt 吗？

成本低就加，但别把它当成正事。标记帮解析器找到结构，而这个结构它本来多半也能从好的小标题里推出来；它不会让一个说法更可信，也不会让一个站点更容易被检索到。与可见文字相矛盾的结构化数据比没有更糟，因为它制造了一个需要有人来裁决、而裁决结果对你不利的分歧。如果你想把 FAQ 标记认真做好，那是另一件事——见 FAQ 与结构化数据提示词。

### 我怎么判断改写有没有起作用？

在页面这一层，主要靠检查而不是靠度量。把每一段改写后的文字粘进一个空白文档，冷读一遍：它有没有写出实体是谁、适用范围是什么、需要日期的地方带没带日期？这就是交付物，而且可以直接验。来自助手的引荐数据是残缺的，各家工具的标注口径也不一致，所以数据缺失只说明你不知道，不说明你没被引用过——不要拿那个数字去做报告。

### 这个提示词对任何页面都管用，还是只对指南类页面管用？

它对任何**包含某个会被问到的答案**的页面都管用：服务页、定价页、规格页、政策页。它在那些本来就不负责回答任何问题的页面上表现很差。首页通常没有可提取的答案，把首页改写成一组能独立成立的陈述，往往会毁掉它对真人读者的作用。挑那些「真问题的真答案已经埋在软性文案里」的页面。
