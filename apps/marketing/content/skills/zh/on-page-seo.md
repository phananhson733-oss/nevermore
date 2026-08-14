---
title: 页面 SEO
description: 按读者和爬虫共同看到的样子复核一个页面——标题、大纲、命名、结构化数据与链接——并且只改这个页面和它的数据支撑得起的部分。
tagline: 让一个页面同时对读者和爬虫都可读
category: seo
owner: seo
keywords: 页面 SEO 技能, title 标签复核, 标题结构 SEO, 结构化数据校验, meta description 写作, 实体清晰度 SEO, 页面级 SEO 复核
relatedSkills: seo-audit, internal-linking
relatedPrompts: title-tag-meta-description-prompt, faq-generation-schema-prompt
status: published
publishedAt: 2026-08-14
---

## Skill file

```text
---
name: on-page-seo
description: Revise a single page so its title, outline, naming, markup, and links all state the same thing, using only what the delivered page and its measured data show. Use when someone asks to optimise a page, rewrite its title or meta description, add schema, or fix its headings — and when a page ranks below what its content deserves and nobody has checked whether the page says one consistent thing.
metadata:
  owner: GenGrowth SEO Agent
  source: https://gengrowth.ai/skills/on-page-seo
---

# On-Page SEO

Your job is to make one page say clearly what it is — to a person scanning a
result list and to a crawler parsing the HTML — without adding claims the page
does not support.

## What counts as evidence

Four sources, in descending order of trust:

1. The delivered page — the HTML served at that URL, plus the text a reader
   actually sees. This is the only authority on what the page says today.
2. Measured — Search Console rows for this URL: the queries it appears for,
   impressions, clicks, and impression-weighted average position.
3. Observed — what the pages currently ranking for the same query family cover,
   read from live results.
4. Tool output — readability figures, page scores, generic linters. Advisory
   only. A score is never a finding on its own; name the element it points at.

Search Console withholds queries below its reporting threshold, so the query
rows for a URL rarely account for all of its impressions. Report the share they
do cover. When a metric is unavailable, write that it is unavailable. Do not
substitute zero: zero clicks is a measurement, and no data is not zero.

## Procedure

1. Write the page's job in one sentence: which reader, which question, which
   next step. If it takes two sentences, the page is serving two query families
   and the first decision is split or refocus, not tags.

2. Fetch the page as delivered and compare it against the rendered view. Record
   any main content that exists only after client-side scripting, and say its
   indexing is not guaranteed rather than assuming either outcome.

3. Read the title alone, out of context, as it would sit in a result list beside
   nine others. It must name the subject and separate this page from the rest of
   the site. Judge the description separately: it is the click argument, not a
   ranking input.

4. Strip the body and read the headings on their own. The outline should read as
   the page's argument. Headings such as Overview, Details, and Conclusion carry
   no information; replace them with the actual claims or comparison axes. Check
   that the h1 and the title agree with each other.

5. Check naming. Every subject the page is about should appear with its full
   name on first use, together with the version, unit, region, or size range
   that bounds it. Replace "most models" and "recently" with the real scope.
   This is what makes the page resolvable to a reader who arrived cold.

6. Validate structured data field by field against the visible page. Every
   marked-up value must correspond to something a reader can see. Remove or
   render anything that does not, including FAQ markup for questions the page
   never asks.

7. Review the links leaving the body. Each should lead to a page that answers a
   question this page raises, with anchor text that names the destination rather
   than the act of clicking.

8. Reconcile with measured queries. If the URL takes impressions for a query
   family the page does not address, say so, and recommend split, refocus, or
   leave alone with the reason attached.

## Output

An ordered change list. For each item: the element, what it says now, the
proposed change, the evidence behind it, and the risk of making it. State the
ordering rule you used so it can be argued with. Close with what you could not
determine and what data would settle it.

## Refuse to

- Recommend a keyword density, a repetition count, or a target word count.
- Add structured data for content that is not visible on the page.
- Rewrite a title to match a query the page does not actually serve.
- Report a tool score or an estimate as a measurement.
- Replace an unavailable metric with zero or with a guess.
- Promise a ranking, a traffic number, or a timeline.
```

## What it does

页面工作一旦变成「一份待填标签清单」就会走偏。有人确认了有 title、有 description、有一个 h1、每张图有 alt、有一块结构化数据，六项全打勾，然后就过了。而这个页面在第一屏仍然什么都没告诉读者，它的小标题仍然写着「概述」和「结语」，它的 FAQ 标记仍然描述着上一次编辑中已被删掉的问题，它的 title 仍然与同一目录下的每一个页面无从区分。**每一格都打了勾，页面的可读性一点没变。**

本 skill 把页面当作**一个必须同时经受两种阅读的论证**：一个人在一秒半内判断「这个结果是不是我要的」，以及一个解析器在构建「这个页面覆盖了什么」的表示。这两种阅读想要的东西大体一致——写明的主题、可见的结构、带范围的具名实体，以及**只复述页面上已有内容**的标记。

产出是一份**排好序的改动清单**，每一条都附上背后的证据和做它的风险。当数据够不着时——Search Console 隐去的查询词、没有任何已接入来源能提供的指标——改动清单会明说，而不是把空位填上。这一点在这里比在多数工作中更重要，因为**页面改动做起来很便宜，也很容易在没有理由的情况下就做了**。

## In action

### You ask

能看一下 kestrelcase.com/guides/laptop-sleeve-vs-hard-case 吗？它有大约八周的曝光但几乎没有点击。我们卖笔记本电脑包。发布之后页面上什么都没改过。

### The agent does

**title 是第一个问题。** 它写的是 `Guides | Kestrel Case`——而这句话对站点上另外十一个 URL 同样成立。在结果列表里，没有任何东西把这个页面和 guides 目录的其余部分区分开；h1 也救不了它：它写的是 "Which One?"。修法是**按顺序写出两个选项以及正在做的那个决定**。

**大纲是第二个。** 把正文剥掉之后，小标题读作 Overview、The Options、Considerations、Conclusion。这个页面**确实**包含一次真实的比较——防摔、重量、能不能塞进飞机座位下——但那些维度住在段落内部，所以无论是快速扫读的读者还是解析器，都看不出这个论证的存在。

**第三，** FAQPage 标记声明了四个问题，其中三个在可见页面上**根本不存在**；它们在发布前被删掉了。那是一个页面并不支撑的声明。要么把它们渲染出来，要么把标记删掉。

关于数字：Search Console 在这八周里对该 URL 报告 **0 次点击**——那是一个**测量结果，不是数据缺口**。它的查询词行覆盖了该 URL 曝光的 61%；其余低于报告阈值、被隐去。**我没有去估算它们是什么。**

排序依据是「每项改动能解决多少已观察到的错配」，不是工作量。

## How it works

### 从它已经吸引到的东西出发，确立这个页面的职责

Agent 用一句话写出读者、问题和下一步，然后拿它去核这个 URL 已经在收曝光的那些查询词。**一个需要两句话才能说清的页面，服务的是两个查询族**，而那是一个在动任何标签之前就该做的范围决策。

### 读实际被交付的东西

把该 URL 上服务端返回的 HTML 与渲染后的视图作比较，从而把「只在客户端脚本之后才存在的内容」**识别出来而不是假设掉**。当主体内容由脚本注入时，报告会说它的收录**没有保证**——它不宣称这些内容不可见，也不宣称没问题。

### 单独读大纲和命名

小标题被剥掉正文来读，因为那接近于快速扫读的读者和解析器遇到它们的方式。同一遍里，Agent 还会检查：主体在首次出现时是否被写全名，并带上界定它的版本、单位、地区或尺寸区间——好让任何东西都**不依赖读者已经知道**。

### 拿标记里的每一条声明去核可见页面

结构化数据被逐字段地对着「读者能看到的东西」校验；外链则被检查两点：它是否回答了本页提出的某个问题、锚文本是否点名了目标。产出是一份按**明确写出的规则**排序的改动清单，每一项都带着它的证据和风险。

## What it covers

- title 与 description 对照「该 URL 已经出现的那个查询族」以及「它旁边的那些 title」来复核
- 把标题大纲当作论证来读，独立于正文，并检查 h1 与 title 是否一致
- 实体命名：首次出现写全名，带版本、单位、地区或区间，让页面的范围是**写明的**而不是**暗示的**
- 结构化数据逐字段对照可见内容校验，不被支撑的字段要么删除要么渲染出来
- 外链与锚文本对照「本页实际提出的那些问题」来检查
- 服务端 HTML 与渲染视图对比，脚本注入的主体内容**如实报告**，不向任一方向下结论

## When to use it

- 一个页面已经有几周曝光，而没有人把它的 title 和它出现的那些查询词放在一起读过
- 页面由领域专家撰写，而它的小标题是「概述」「细节」「结语」
- 结构化数据是随插件或模板来的，没人核过被标记的那些字段在页面上是否存在
- 一个 URL 同时在为两个不同的查询族收曝光，而没人决定过要不要拆
- 一次模板迁移改了版式，导致 title、h1 和面包屑不再说同一件事

## FAQ

### 它和「SEO 体检」这个 Skill 有什么不同？

体检跨整站工作，按「哪一类问题在拖累它」给页面分类——收录、模板、内容单薄，或页面本身。本 skill 一次只处理一个页面，处理到**里面那些词**的层级。两者单向交接：体检点名页面和问题类别，本 skill 决定这个页面**实际该说什么**。

### 它到哪儿为止，「内链治理」从哪儿开始？

本 skill 看的是**从单个页面出去的链接**，问每一条是否回答了这个页面提出的问题、锚文本有没有点名目标。内链治理工作在**图**的层级：哪些页面配得上链接、链接该从哪来、站点的哪些部分几步之内不可达。修好一个页面的出链，不会告诉你这个页面**有没有入链**。

### 它会告诉我目标词该用几次吗？

不会，你问它也不会给出一个密度数字。**没有任何阈值在真实页面上经受住过检验**，而照着阈值写，产出的文案读起来就是照着阈值写的。有效的检验是另一个：一个冷启动落地、此前没读过站内任何内容的读者，能不能在一屏之内说出他在哪个页面上、以及这个页面会替他解决什么。**通过这个检验的页面，会在该写主题的地方写出主题，不需要任何人去数。**

### 页面在我浏览器里看着没问题，为什么它要去读源码 HTML？

因为**你的浏览器不是唯一的客户端**。这项检查比较的是「该 URL 上被服务出去的内容」与「脚本跑完后你看到的内容」，并报告任何只出现在后者中的主体内容。它**不下结论**说这类内容不会被收录——那件事因情况而异，向任一方向断言都是猜测。它把差异记录下来，好让「把这部分内容移进服务端 HTML」成为一个**有意做出的决定**，而不是事后才发现的事。
