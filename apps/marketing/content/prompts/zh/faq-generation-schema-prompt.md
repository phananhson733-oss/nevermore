---
title: FAQ 与结构化数据提示词
description: 用有记录、读者真的问过的问题起草 FAQ 章节，并生成答案与可见文字逐字一致的 FAQPage JSON-LD。
category: optimization
useCase: 页面结构
outputFormat: FAQ 与 JSON-LD
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: FAQ 结构化数据提示词, FAQPage JSON-LD, FAQ 生成提示词, 结构化数据 FAQ, SEO 常见问题, schema 标记提示词, FAQ schema 生成
relatedSkill: on-page-seo
relatedPrompts: geo-ai-overview-optimization-prompt, title-tag-meta-description-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are an on-page editor writing an FAQ section and the FAQPage JSON-LD for
one page.

# Scope
Write only questions someone has been observed asking, and answer them only
with facts the page already states. Do not invent a question to fill the
schema block, or a fact, a number, a price or a lead time. Answers that are
absent from the visible text are a structured data policy violation, so every
answer inside the JSON-LD must be the visible answer, word for word.

# Inputs
Page URL: {{page_url}}
What the page covers and the facts it states: {{page_summary}}
Questions readers have been observed asking, with the source of each:
{{reader_questions}}
FAQ already published on the page, if any: {{existing_faq}}
Wording rules and claims that cannot be made: {{answer_constraints}}

# What to produce
A visible FAQ section, one FAQPage JSON-LD block carrying the same questions
and answers, and a list of what you did not write and why.

# Steps
1. Sort every supplied question into three buckets: (a) sourced and answerable
   from the page facts, (b) sourced but the page does not contain the answer,
   (c) no source.
2. Drop bucket (c). A question nobody asked does not earn a place on the page
   or in the schema, however natural it sounds.
3. Do not answer bucket (b). List each one and name the exact fact the page
   would have to state first: these are content gaps for the owner to settle,
   not entries for you to fill.
4. Write bucket (a). Answer in the first sentence, qualify after it, and make
   each answer stand alone, because it gets read out of context. Trace every
   clause back to a supplied fact. A clause you cannot trace gets cut, not
   hedged, and a one-sentence answer stays one sentence.
5. Apply the wording rules to every answer. Recommend removing any published
   entry with no source behind it, and say what replaces it.
6. Build the JSON-LD by copying the finished visible answers, not rewriting
   them. Strip Markdown to plain text; the words must not change.
7. Compare the two parts question by question before presenting either.

# Output format
Part 1, "FAQ section": each question as its own heading, the answer in prose
below, in the order a reader would meet them.
Part 2, "JSON-LD": one fenced JSON block with @context https://schema.org,
@type FAQPage, an @id of the page URL plus a #faq fragment, and mainEntity as
an array of Question objects, each with a name and an acceptedAnswer of @type
Answer carrying a text field.
Part 3, "Not written": a table of Question | Source | Why not written | What
the page needs first.
Close with the count in each part and confirm they match.

# Quality checks before you answer
- The visible section and the JSON-LD carry the same questions in the same
  order.
- Each acceptedAnswer text is the visible answer with markup removed and
  nothing else changed.
- Every question you wrote traces to a named source in the input.
- Every sentence traces to a supplied fact, and no number appears that was not
  supplied.
- The JSON parses: quoted keys, no trailing commas, escaped quotes inside
  answer text.
- No wording rule is broken in any answer.

# When the input is thin
If only two questions carry sources, write two: a short FAQ of real questions
beats a long one of guesses. If none carries a source, write
no FAQ and no JSON-LD: return the Not written table and name the sources that
would settle it, such as Search Console queries for this URL, support ticket
subjects or the on-site search log. If the page facts answer no sourced
question, say so and stop. Do not estimate a missing fact, and do not record
it as zero when the truth is that you were not told.

# Boundaries
Do not emit JSON-LD for a question absent from the visible section. Do not
promise a rich result, a ranking or traffic; markup makes a page eligible for
treatment it may never receive. Do not repeat a term to hit a count. Do not
answer a pricing, legal, medical or availability question from general
knowledge; an unsupplied fact is a gap, not a blank to fill.
```

## Variables

### page_url
Required. FAQ 将要落到的那个页面的规范 URL。它锚定 JSON-LD 的 @id，所以一段被复制到第二个页面上的代码块会以「对不上」的形式暴露出来，而不是悄悄蒙混过去。
Example: https://voltside.co.uk/ev-charging/apartment-buildings

### page_summary
Required. 这个页面讲什么，加上它明确写出的那些事实，用要点列。答案只能取材于这些内容，所以把数字、覆盖区域和排除项都写进去，并且明白写出**页面没有说什么**。
Example: Load-managed 7kW units; residents pay per kWh in the app; the page states no prices and no lead times

### reader_questions
Required. 一行一个问题，并注明它从哪来：一条 Search Console 查询、一个工单数量、一次销售通话、站内搜索日志。没有来源的问题会被丢掉——这正是这个字段存在的意义。
Example: "Do we need the freeholder's permission?" - 6 of the last 9 survey booking calls

### existing_faq
Optional. 页面上已经发布的 FAQ，问题和答案都带上，这样产出能告诉你哪些保留、哪些改写、哪些删除，而不是默默地生成重复内容。
Example: "What is an EV charger?" - "An EV charger is a device that supplies electricity to an electric vehicle."

### answer_constraints
Optional. 品牌拼写、地区英语变体、法务或销售不允许的表述，以及任何绝不能出现在这个页面上的内容。
Example: UK English; do not call the survey free, the fee is credited against the install

## How to use

真正要花力气的字段是 `reader_questions`，也正是它决定了产出值不值得发布。从 Search Console 里拉这个 URL 的查询词，从客服收件箱里拉主题行，加上站内搜索日志，以及接电话的那个人记得每周被问两次的那些问题。每个问题旁边把来源粘上。这条提示词把「没有来源」当作丢弃该问题的理由，所以你凭想象写一份漂亮清单粘进去，会得到一个空的 FAQ——而这是正确的结果。

在 `page_summary` 里，先写页面说了什么，再写页面**没说**什么。后半截比看上去重要得多。一个没被告知「页面对价格只字未提」的模型，会去够一个看着合理的区间，而一个看着合理的区间一旦进了结构化数据，就成了公司必须背书的陈述。在摘要末尾加上一句「页面未给出任何价格和交付周期」，正是这句话把那些问题变成被标记出来的缺口，而不是被编造出来的答案。

**机械地**核产出，不要用眼睛扫。把 JSON 里每一段 `acceptedAnswer` 的文字复制出来，去页面草稿里搜。你真正会撞上的失败不是幻觉答案，而是**顺手润色**：模型把句子重新打进 JSON 时，悄悄改了一个逗号、把 "3 years" 换成 "three years"、或者因为短一点更好读而裁掉一个限定从句。于是结构化数据陈述了页面没有陈述的东西——而这正是整条提示词要防的那种不一致。如果有好几处答案发生了漂移，就要求它**仅根据第一部分重新生成第二部分**，而不是整条重跑。

如果产出里还是冒出了编造的问题，原因几乎总是在输入而不是在模型，所以先回去找那个没带来源就混进来的问题。上线前，把 JSON 过一遍 Google 的富媒体结果测试或 Schema Markup Validator，并且核**渲染后的页面**而不是草稿——一个只存在于爬虫从未收到的组件里的答案，不算可见内容。

## Example input

```text
Page URL: https://voltside.co.uk/ev-charging/apartment-buildings
What the page covers and the facts it states:
- Voltside installs shared EV chargers in residential apartment buildings in England and Wales.
- Every install starts with an on-site survey of about 90 minutes, checking the incoming supply, the meter position, and the distance from the intake to the parking bays.
- The units are load-managed 7kW chargers. Load management shares the building's spare capacity between chargers, so most buildings do not need a supply upgrade.
- Written consent is required from whoever holds the building's electrical supply, usually the freeholder or the managing agent. Voltside prepares the consent pack.
- Residents pay per kWh through the Voltside app. The building's supply account is not billed for charging.
- Chargers carry 3 years parts and labour.
- The page states no prices and no lead times.
Questions readers have been observed asking, and where each came from:
- "Do we need the freeholder's permission?" - 6 of the last 9 survey booking calls (sales notes, Feb to Apr)
- "Will the building need a supply upgrade?" - 5 support emails in March
- "Who pays for the electricity?" - 22 on-site searches for "who pays" on this page
- "Do you cover Scotland?" - 4 support emails
- "How much is it per parking bay?" - 11 support emails, highest volume question
- "How long does the install take once we sign?" - 3 survey booking calls
- "Is Voltside the best EV charger installer in the UK?" - drafted by marketing, no source
FAQ already published on the page:
- "What is an EV charger?" - "An EV charger is a device that supplies electricity to an electric vehicle."
Wording rules and claims that cannot be made: Write Voltside with a capital V and no space. UK English. Do not call the survey free; the fee is credited against the install, not waived. Prices and lead times are quoted per building and must not appear on the page.
```

## Example output

**FAQ 章节**

#### Do we need the freeholder's permission before Voltside can install?

Yes. Voltside needs written consent from whoever holds the building's electrical supply, which is usually the freeholder or the managing agent. Voltside prepares the consent pack for you to pass on.

#### Will the building need a power supply upgrade?

Usually not. The units are load-managed 7kW chargers that share the building's spare capacity rather than each drawing full power at once, so most buildings do not need an upgrade. The survey tells you whether yours is an exception.

#### Who pays for the electricity the chargers use?

Residents do. Each driver pays per kWh through the Voltside app for the energy they draw, and the building's supply account is not billed for charging.

#### Do you install in Scotland?

No. Voltside installs in England and Wales only.

**JSON-LD**

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "@id": "https://voltside.co.uk/ev-charging/apartment-buildings#faq",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Do we need the freeholder's permission before Voltside can install?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes. Voltside needs written consent from whoever holds the building's electrical supply, which is usually the freeholder or the managing agent. Voltside prepares the consent pack for you to pass on."
      }
    },
    {
      "@type": "Question",
      "name": "Will the building need a power supply upgrade?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Usually not. The units are load-managed 7kW chargers that share the building's spare capacity rather than each drawing full power at once, so most buildings do not need an upgrade. The survey tells you whether yours is an exception."
      }
    },
    {
      "@type": "Question",
      "name": "Who pays for the electricity the chargers use?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Residents do. Each driver pays per kWh through the Voltside app for the energy they draw, and the building's supply account is not billed for charging."
      }
    },
    {
      "@type": "Question",
      "name": "Do you install in Scotland?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "No. Voltside installs in England and Wales only."
      }
    }
  ]
}
```

**未写入的问题**

| 问题 | 来源 | 为什么没写 | 页面得先有什么 |
| --- | --- | --- | --- |
| How much is it per parking bay? | 11 封客服邮件 | 页面未给出价格；报价按楼栋出 | 一句话说明：勘察后按楼栋报价 |
| How long does the install take once we sign? | 3 次勘察通话 | 页面未给出交付周期 | 运营给一个区间，或一句「勘察时确定日期」 |
| Is Voltside the best EV charger installer in the UK? | 营销草稿，无来源 | 没有任何记录显示有人问过，也没有任何已提供的事实能回答它 | 什么也不需要；它不属于这个页面 |
| What is an EV charger?（已发布） | 无 | 线上内容背后没有任何来源，而这个页面的读者是楼宇管理者 | 删掉它；上面的条目已经覆盖了这个页面被问到的问题 |

**计数：** 可见问题 4 条，JSON-LD 中 4 条，答案完全一致。

**说明：** 苏格兰那条答案只有一句，因为已提供的事实就只有这么多。页面上写了 3 年零件与人工保修，但没有任何记录显示有人问过它，所以它留在正文里，不变成一个问题。

## Safety notes

上线前，对着**已发布的页面**（不是草稿）核三件事：每条答案里的每个事实都在页面上写着；每段 `acceptedAnswer` 的文字都能在爬虫收到的 HTML 里搜到；答案里没有任何内容与本站已发布的其他页面在价格、覆盖范围或条款上矛盾。需要点击后才渲染、或由爬虫不执行的脚本注入的答案，**不算可见内容**，标记做得再好也一样。

这条提示词不宣称这段标记能换来富媒体结果，你也不该这么说。FAQPage 标记让页面**具备**获得某种展示形式的资格，而 Google 已经大幅收窄了这种展示形式——具备资格不等于拿到位置。这条提示词真正宣称的东西更窄、也可核：问题来自真实的地方，答案来自页面，结构化数据说的和读者看到的是同一件事。

## FAQ

### 富媒体结果基本没了，FAQ 结构化数据还值得加吗？

对多数站点来说，SERP 上的展示形式已经不再是做它的理由。Google 把 FAQ 富媒体结果限制在一小批知名的医疗与政府来源上，所以就假定你的页面拿不到，然后凭其余价值来决定：一个真正回答别人所问的可见章节，加上一份任何解析器都能干净提取的机器可读版本。如果一个页面之所以有 FAQ，只是因为有人想要那段标记，那就是错的理由，而这通常会从问题本身露出来。

### 它拒绝回答的那些问题，我该拿它们怎么办？

把它们当成产出中最有用的部分。一个背后有十一封客服邮件、而页面上没有答案的问题，是一个**有成本的内容缺口**，而修复它需要一个人来做决定：公布价格、公布区间，或者公布一句「按楼栋报价」。等有人做了这个决定、页面上也这么写了，再重跑这条提示词，这个问题就会进入 FAQ。你自己拿一个听着合理的答案把它填上，等于把一个已知缺口变成了一条藏在结构化数据里的未核实陈述。

### 我能把同一段 FAQ 复用到一组相似页面上吗？

不能，而模板化的 FAQ 区块正是「站点的结构化数据与页面对不上」最常见的成因。这段标记描述的是它所在的那个页面，所以如果四十个地区页上这段代码完全相同、而可见文字各不相同，那么其中一部分页面此刻正在断言它们并没有说的东西。如果某个问题确实处处适用，它该待在一个页面上，其余页面链过去。

### 页面是新的、我没有任何问题可以喂它，怎么办？

那么这条提示词会正确地什么也不返回，而这是一个信号：去把证据找来，而不是把输入门槛放松。花半小时找接相邻产品销售通话或客服工单的人聊，通常就能得到四个真实问题；售前邮件往来往往比任何关键词工具都好，因为里面是客户用自己的话说出的异议。如果这些暂时都还不存在，那就先发布不带 FAQ 的页面，等它积累了足够的 Search Console 数据、能看出别人是打了什么词进来的，再补上。
