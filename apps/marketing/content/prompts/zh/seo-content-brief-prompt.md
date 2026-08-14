---
title: SEO 内容简报提示词
description: 把一个目标查询词变成写手真能开工的简报——页面的论点、它必须回答的问题、每一节需要的证据，以及什么不在范围内。
category: writing
useCase: 交接给写手
outputFormat: 简报
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: SEO 内容简报提示词, 内容简报模板, AI 内容简报, 给写手的简报, 内容简报生成, SEO 写作交接
relatedSkill: content-brief
relatedPrompts: seo-article-outline-prompt, serp-competitor-analysis-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are a content strategist writing the brief a writer will work from. You are
not writing the page.

# Scope
Produce a brief for one page targeting one search. Do not draft sentences the
writer would publish. Do not invent statistics, survey figures, competitor
quotes, search volumes, or customer numbers. Any figure you use must come from
the inputs below; if a section needs a number you were not given, mark it as
missing and name the kind of source that would settle it. Never substitute a
plausible number for one you do not have.

# Inputs
Primary query: {{primary_query}}
Reader: {{reader_context}}
What the company sells and can honestly claim: {{product_context}}
Pages already covering this query: {{competing_pages}}
Internal pages available to link to: {{internal_pages}}

# What to produce
A brief whose spine is an argument, not an outline. A list of headings tells a
writer what to type; it does not tell them what the page is for. Every section
in your brief must state what it argues, not only what it covers.

# Steps
1. Write the one job of the page in a sentence: what the reader can do after
   reading it that they could not do before.
2. Write the page's argument as a single claim a competent person could
   disagree with. "Appointment reminders" is a topic. "Reminder timing moves
   the no-show rate more than a cancellation fee does" is a claim. If the
   inputs support no claim, say so and name what you would need. Do not invent
   a position to fill the line.
3. List the questions the reader must have answered before they will act. Take
   them from the reader description and from what the competing pages leave
   unanswered, not from what is easiest to write.
4. Lay out the sections. For each, state the sub-claim it makes and the
   evidence that carries it. Mark every piece of evidence as supplied (it is in
   the inputs) or to-source (it is not). Never mark something supplied because
   it sounds true.
5. Choose internal links only from the pages listed. For each, say why this
   reader, at that point in the page, would click it. Drop any link you cannot
   justify that way.
6. Write the out-of-scope list: what this page deliberately does not cover, and
   where each of those belongs instead. Name at least two things.

# Output format
A brief with these parts, in this order: Page and primary query; One job;
Reader; The argument; Sections (a table with the columns Section | What it
argues | Evidence | Supplied or to-source); Questions the page must answer;
Internal links; Out of scope; Evidence to source before drafting.

# Quality checks before you answer
- The argument is a claim someone could argue against, not a subject label.
- Reading the section sub-claims in order makes a case, not a checklist.
- Every figure in the brief traces to an input or is marked to-source.
- The out-of-scope list has at least two entries.
- Every internal link is one of the supplied URLs, with a stated reason.

# When the input is thin
If you were given no competing pages, write the brief and say the section order
is not informed by what already covers the query. If the reader description is
one line, name the two or three facts about the reader that would most change
the brief. If the company has no evidence for its own claim, say the page
cannot make that claim yet and mark it to-source. Do not close any of these
gaps with an estimate.

# Boundaries
Do not draft the page. Do not promise rankings, traffic, or results. Do not
specify keyword counts, densities, or how many times to repeat a phrase. Do not
attribute a claim to a competitor unless their page was quoted to you. Do not
soften the argument into balance for safety: a brief that argues nothing
produces a page that says nothing.
```

## Variables

### primary_query
Required. 这个页面服务的那**一次**搜索，按人打字的样子写。**一个查询词，不是一簇**——一份服务三个查询词的简报，一个都服务不好。
Example: how to reduce no shows veterinary clinic

### reader_context
Required. 谁读这个页面、他已经试过什么、他即将做出什么决定。**正是这一项把简报和目录区分开。**
Example: Practice manager at a 3-vet independent clinic, already sends one text reminder the morning of, about to sign off on a $35 cancellation fee

### product_context
Required. 公司卖什么、能诚实宣称什么，以及它实际能放到页面上的证据有哪些。
Example: Halden, practice management software for independent US vet clinics; we can publish aggregate reminder-response data from the 340 clinics on the platform, but not clinic names

### competing_pages
Optional. 已经覆盖这个查询词的 URL，每个用一行写它主张什么。简报用它们来找**尚未被回答的东西**，不是用来抄结构。
Example: vetpracticeblog.com/no-shows — argues for a cancellation fee, cites no data

### internal_pages
Optional. 写手可以链过去的 URL 和标题。提示词不会编造不在这份清单里的 URL。
Example: /features/reminders — "Automated appointment reminders"

## How to use

动其他任何东西之前，先把 `reader_context` 和 `product_context` 认真填好。**这两项决定了你拿到的是一份简报还是一份目录。**「兽医诊所老板」产出的是泛泛的章节；「已经在当天早上发提醒、正要批准 35 美元费用的诊所经理」产出的是论点，因为模型现在知道读者**已经否决了什么**。如果你事后发现自己在手写简报，问题几乎总是出在这两个字段，不在提示词。

从「章节」那张表开始读产出，特别是「它主张什么」这一列。你真正会撞上的失败，是某一行只是把自己的标题复述了一遍——「取消费 | 讲取消费以及它怎么运作」。那是一份披着简报格式的目录，写手拿到它，会产出一个读起来像检查清单的页面。看到这种情况，不要整条重跑；把出问题的那几行粘回去，要求它写出每一行做出的**子主张**；如果发现那里根本没什么可主张的，就直接删掉那一节。

然后拿「已提供 / 待获取」这一列，去核你实际粘进去的内容。**当句子听起来合理时，模型就会把证据标成「已提供」**——而这正是这一列存在要抓的失败。每一行「已提供」都应该能在你的 `product_context` 文本里找到；找不到的就是待获取项，而待获取项才是写手真正的阻塞清单。如果你的证据比论点所需要的更薄，那是一个**有用**的结果——它意味着这个页面暂时还做不出那个主张，而诚实的选项是去把证据取来、或者把主张收窄，**绝不是**把没有支撑的主张发出去。

## Example input

```text
Primary query: how to reduce no shows veterinary clinic
Reader: Practice manager at a 3-vet independent clinic in Ohio. Already sends one
text reminder the morning of the appointment. Is about to sign off on a $35
cancellation fee. Has never looked at when reminders go out, only whether they go.
What the company sells and can honestly claim: Halden, practice management
software for independent US vet clinics. We can publish aggregate
reminder-response data across the 340 clinics on the platform, including response
rate by send time and no-show rate by booking lead time. We cannot name clinics
and we have no data on whether cancellation fees get collected.
Pages already covering this query:
vetpracticeblog.com/no-shows — argues for a cancellation fee, cites no data
clinicgrowth.com/reduce-no-shows — 12-item listicle, no reader decision in it
avma-forum thread — practice managers arguing about fees, no resolution
Internal pages available to link to:
/features/reminders — "Automated appointment reminders"
/blog/front-desk-scripts — "Front desk scripts for confirming appointments"
/pricing — "Halden pricing"
```

## Example output

**页面：** How to cut no-shows at an independent vet clinic
**主查询词：** how to reduce no shows veterinary clinic

**唯一职责：** 让一位已经在当天早上发提醒的诊所经理，拿到这个月可以做的**一项**具体改动，以及一个「先做它、而不是批准那 35 美元费用」的理由。

**读者：** 诊所经理，三名兽医的独立诊所。已有提醒系统，并且相信它在起作用。距离签字批准取消费只差一步。**从没把发送时机当成一个变量考虑过。**

**论点：** 取消费在时段已经损失之后才起作用；提醒时机在之前就起作用。对一个已经在发一次提醒的诊所来说，改变发送时间是更便宜的干预，而且不会消耗掉那笔费用所消耗的客户关系。

**章节**

| 章节 | 它主张什么 | 证据 | 已提供 / 待获取 |
| --- | --- | --- | --- |
| 为什么收费像是那个显而易见的答案 | 收费之所以有吸引力，是因为它可见、好落地，不是因为它作用于成因 | 仅基于机制的论证；我们没有关于费用实收情况的数据 | 待获取 |
| 你的爽约来自哪里 | 爽约率随「提前多久预约」而变；本节报告数据显示出的那个模式 | 按预约提前量分的爽约率，340 家诊所 | 已提供——**方向由数据决定，不由简报决定** |
| 一次提醒是通知，两次提醒才是确认 | 响应率随发送时间而变；本节主张采用数据支持的那个时间表，而不是单次的当天早上发送 | 按发送时间分的提醒响应率，340 家诊所 | 已提供——**方向由数据决定，不由简报决定** |
| 确认应该要求对方做什么 | 要求回复，把一次被动的提醒变成一次明说的承诺 | 我们已发布的前台话术 | 已提供 |
| 什么时候收费确实是对的工具 | 惯犯，以及手术时段——这类损失的时段无法再被填上 | 基于机制的论证；不对费用实收频率作任何宣称 | 待获取 |

**页面必须回答的问题**
- 像我这种规模的诊所，正常的爽约率是多少？我们没有可引用的基准值。要么去找一个，要么明白写出「已发布的数字差异太大、无法用于对比」——**不要印出一个数字**。
- 第二次提醒会不会惹恼客户？
- 取消费实际上收得到吗？我们不知道。就这么说。
- 周一早上我该改什么？

**内链**
- `/features/reminders` 放在「两次提醒」那一节，给已经接受了时机论点、现在需要知道自家系统能否按时间表发送的读者。
- `/blog/front-desk-scripts` 放在「确认话术」那一节；那字面上就是他们接下来需要的东西。
- **不链** `/pricing`。这位读者在诊断问题，不在选购。

**不在范围内**
- 选择诊所管理软件——属于对比页
- 健康计划与复诊提醒——不同读者、不同职责
- 为费用配置支付通道——属于支持文档

**动笔前需要取来的证据**
- 一个可引用的行业爽约基准值，否则第一节就没有它。
- 任何关于费用实收率的陈述。我们一条都没有。**不要估算。**

## Safety notes

在把它交给写手之前，把每一行标着「已提供」的，对着你实际粘进去的材料核一遍；并确认简报里任何地方都没有出现你没提供过的数字。一个被要求写出有说服力的简报的模型，会去够一个基准数字，而一个混进初稿的编造数字，一旦被裹进句子里就难抓得多。**待获取清单是产出中最具运营价值的部分**：它是写手的阻塞清单，没清空就把页面发出去，等于发布了一个你支撑不了的主张。

这份简报不对页面表现作任何宣称。它说明页面主张什么、写给谁、这个论点需要什么证据——这些全是你今天就能核的编辑决定。里面没有任何一句说这个页面会有排名；而一份论点锋利、背后没有证据的简报，比一份平庸的更糟，不是更好。

## FAQ

### 为什么非要一个论点，而不是一份好大纲？

因为只拿到标题的写手，会用「真实且相关」的内容把每一节填满，结果读起来就是一份检查清单——准确、完整、没有阅读价值。**论点告诉写手该舍掉什么，而那才是这份工作里更难的一半。**它还把那个令人不适的决定前置：如果你没法用一句话说出这个主张，你就还没决定这个页面是干什么的，而再多的起草也不会替你决定。

### 那些确实没有论点的页面呢，比如定义页或术语条目？

这条提示词不太适合它们。一个回答「什么是 net 30」的页面有职责，但没有立场，硬给它安一个主张会产出为反对而反对的填充物。你照跑也行，但要诚实地读第 2 步：如果模型报告说输入不支持任何主张，就照单接受，把这个页面当成定义页来做简报。这条提示词是为「读者有多个选项、而你的页面在推荐其中一个」的页面而建的。

### 模型把我们没有的证据标成了「已提供」。这是提示词坏了吗？

不是，那正是这一列被设计来暴露的已知失败。模型会推断「一家卖提醒软件的公司必然有提醒数据」，然后照此标注。提示词明确要求它不要这么做，这降低了发生率但消除不了，所以**这项检查始终是人工的**：每一行「已提供」都必须能追溯到你 `product_context` 里的某一句。在那儿找不到，它就是待获取。

### 我能把竞品页面的全文粘进去吗？

可以，简报在「找出什么还没被回答」这件事上会更好。两点提醒。长段粘贴会把模型推向**镜像最强竞品的结构**，那恰恰是你不想要的——每个页面用一行写清它主张什么，通常比全文产出更锋利的简报。以及，你粘进去的任何内容，都可能被当作你自己的发现引用回给你，所以在输入里把竞品材料清楚标注，并在产出里的任何引用句进入初稿之前，对着原始来源核一遍。
