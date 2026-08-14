---
title: 内容简报
description: 把目标查询词变成写手真能开工的简报：页面要立的那个论点、必须一手去取的证据，以及这个页面绝不能说什么。
tagline: 交给写手的是一个论点，不是一串小标题
category: content
owner: seo
keywords: 内容简报技能, SEO 内容简报, 内容简报模板, 给写手的文章简报, 搜索意图简报, 内容大纲流程, 编辑简报
relatedSkills: keyword-research, content-refresh
relatedPrompts: seo-content-brief-prompt, seo-article-outline-prompt
status: published
publishedAt: 2026-08-14
---

## Skill file

```text
---
name: content-brief
description: Turn a target query into a brief a writer can act on, carrying the claim the page makes, the first-hand evidence to gather, and what the page must not say. Use when someone asks for a content brief, an outline, or what a page should say before writing starts — including when they hand over a keyword and expect a draft, since the brief is what stops the draft from being generic.
metadata:
  owner: GenGrowth SEO Agent
  source: https://gengrowth.ai/skills/content-brief
---

# Content Brief

Your job is to hand a writer an argument, the evidence needed to support it,
and the boundary of what the page may claim. Headings come last and matter
least.

## What counts as evidence

Four sources, in descending order of trust:

1. First-hand — something only this team can produce: a timed test, a
   screenshot of the real product, a support ticket, a figure from the
   company's own systems. This is what makes a page hard to copy.
2. Measured — the site's own Search Console data for this query and its
   neighbours, plus how any existing page on the topic performs today.
3. Observed — what currently ranks: what those pages assume the reader
   already knows, and the point at which every one of them stops.
4. Provider-supplied — volume and difficulty estimates. Estimates, labelled
   as estimates wherever they appear.

You may not create evidence. If a statistic, a quote, or a benchmark would
strengthen the page, name it as something the writer must go and get, and
name the source to get it from. Never write a plausible number into a brief.
When a metric is unavailable, say it is unavailable. Zero is a measurement;
missing is not zero.

## Procedure

1. Write the reader in one sentence: who types this query, and what has
   already gone wrong for them by the time they type it. A brief for "how to
   cancel a domain transfer" written for someone comparing registrars is a
   different page from one written for someone whose transfer is already in
   flight.

2. Write the claim. One sentence the page exists to establish. If you cannot
   write that sentence, the brief is not ready, and no outline will rescue
   it.

3. Read what currently ranks and name two things: the assumption every result
   shares, and the point at which they all stop. The second is usually where
   this page's reason to exist is hiding.

4. Decide what this page adds. Not "more thorough" — something nameable: a
   step the others skip, a figure nobody has published, a case where the
   standard advice fails, a decision the reader has to make that no one has
   framed for them.

5. List the first-hand evidence the writer must gather before drafting, each
   with where it comes from and who to ask. This list is the brief's real
   payload; the outline is the packaging.

6. Build the outline as questions. Each section is the question the reader
   asks next, given what the previous section just told them. If a section
   does not answer a question, cut it.

7. Write the must-not-claim list: guarantees, comparisons the team has not
   actually run, competitor behaviour taken from that competitor's own
   marketing, and any number the writer cannot source.

8. Specify the mechanical parts last: page type, which existing pages should
   link in and out, and what the title and description promise. Do not
   specify how often any term appears.

## Output

A brief containing: target query, reader sentence, the claim, what this page
adds and why, first-hand evidence to gather with its sources, an outline
written as questions, the must-not-claim list, internal links in and out, and
page type. Close with what you could not determine and what data would settle
it.

## Refuse to

- Ship a brief that has headings but no claim.
- Invent a statistic, a quote, a case study, or a benchmark for the writer.
- Present an estimate as a measurement, or fill an unavailable metric with
  zero.
- Promise a ranking, a traffic number, or a timeline.
- Specify a keyword density or a repetition count.
- List a section without being able to say why the reader needs it.
```

## What it does

会失败的那种简报，看起来是完整的。它有目标查询词、字数要求、一串从当前排名页面抄来的小标题，还有一块相关词。写手一字不差地照做，产出一篇覆盖了主题、却什么都没主张的东西。它读起来和另外八个结果一样，因为它就是从那八个结果拼出来的；对它唯一诚实的总结是：这个主题被覆盖过了。

本 skill 把顺序倒过来。**论点先行**：一句这个页面为之存在的话，写在任何小标题之前。然后是这个页面凭什么存在——表述为「当前结果没有做的那件具体的事」。再然后是写手必须**一手去取**的证据——一次计时测试、一张客服工单、一个来自公司自己系统的数字——因为那才是别人产不出来的部分。

小标题最后才出现，而且是**问句**而不是标签。一个无法被表述成「读者接下来会问的那个问题」的章节，就是写手不需要写的章节。

简报还带着一条边界。每个页面都有它支撑不了的说法：团队从没跑过的基准对比、从竞品营销页搬来的竞品行为、以及那些「要是真的就好了」的数字。本 skill 把这些写成**明确的拒绝项**，这样写手不必去猜界线在哪，复核者也不必事后再去找。

## In action

### You ask

我们做 rootstock.dev，一个面向小型工程团队的托管 Postgres 备份服务。我想要一个瞄准 "postgres point in time recovery" 的页面。我们的写手技术不错，但从没在我们的基础设施上跑过一次恢复。

### The agent does

我会用来搭这个页面的论点是：**时点恢复失败在恢复时刻，不在备份时刻，而真正出问题的是从来没有人给一次恢复计过时。**每一节要么服务这句话，要么删掉。

第一页有八个结果。其中六个是同一套 `pg_basebackup` 加 `recovery_target_time` 的操作演示，而且六个全都在「发出恢复命令」那一刻结束。没有一个说恢复花了多久、数据量多大、以及运行期间应用发生了什么。**那份沉默就是这个页面存在的理由。**

写手在动笔前必须去取、而我无法提供的证据：在你们自己的基础设施上计时的一次恢复，含数据集大小、总墙钟时间，以及单独计价的 WAL 重放阶段；当 `recovery_target_time` 早于基础备份时 Postgres 抛出的**确切错误文本**；以及来自客服的一句话——客户通常是怎么发现这个缺口的。

我没能给这个查询词附上搜索量数字。这个项目没有接入任何关键词工具，而我不会把一个我没亲眼见过的数字写进简报。**证据缺口本身已经足以为这个页面提供理由。**

不得宣称：任何针对读者自身环境的恢复时间目标（RTO），或者竞品没有 PITR——写那句话之前先去查他们的文档。

## How it works

### 先把论点钉死，再谈大纲

Agent 用一句话写出读者、用一句话写出论点，两者缺一就拒绝往下走。像 "sso vs saml" 这样的查询词，对「正在选实现方案的工程师」和「正在填安全问卷的采购方」来说是两个不同的页面，而**论点正是逼着这个选择摊到台面上的东西**。

### 找出所有人止步的地方

读当前结果**不是**收集小标题。Agent 找的是：每一个排名页面共有的那个假设，以及它们全都停下来的那个点——因为后者通常就是这个页面的贡献所在。如果结果确实没留下任何缺口，简报会直说，而不是制造一个角度出来。

### 点名一手证据及其来源

简报会列出写手必须去拿的东西：要跑的测试、要读的工单、要问的人、要取的数字。Agent **不提供「先放着回头替换」的示例数字**，因为示例数字活进已发布稿件的频率，比任何人愿意承认的都高。

### 把大纲变成问句，并写下拒绝项

章节被表述为「读者接下来会问的那个问题」，于是一个提不出问题的章节，其冗余是肉眼可见的。简报以「不得宣称」清单收尾，并附一条「哪些无法判定」的说明——这给了复核者一个**具体可核**的东西，而不是一份需要自己形成的总体印象。

## What it covers

- 论点先行的简报构造：页面的论证写在任何小标题之前
- 读者定义锚定在「打出这个查询词的那一刻」，不是一个通用画像
- 读当前结果，找共有假设与共同的止步点
- 一手证据清单，点名要跑的测试、来源，以及该问的人
- 问句形式的大纲，在动笔前就暴露出冗余章节
- 明确的「不得宣称」边界，以及给复核者的「数据不可得」说明

## When to use it

- 关键词清单已经批了，但没人决定过任何一个页面要主张什么
- 稿子一次次回来都是「周全、切题、但不能说服人」
- 写手手艺很好，但接触不到产品或它的数据
- 由外包或代理产出页面，而复核周期全花在纠正表述上
- 两位写手被安排了相邻的查询词，结果产出的页面说的是同一件事

## FAQ

### 它和「关键词调研」这个 Skill 有什么不同？

关键词调研决定**哪个页面应该存在、为什么值得做**。本 skill 在这个决定做出之后，决定**那个页面主张什么**。交接就是一行数据：关键词调研交出查询词、意图、目标页面和状态，而简报把那一行变成写手不用开会就能开工的东西。

### 为什么它不给写手一些示例统计数字去替换？

因为**占位数字会被发布出去**。一个作为示意写进简报的数字，会走进初稿、因为看起来有出处而通过复核，最后挂着你的域名出现在线上页面里。点名写手必须获取的那个数字、以及去哪里获取，只多花一句话，却彻底消除了这个失败。

### 这是不是就不需要领域专家了？

不是，而且它的设计恰恰是**把这个需求显性化**，而不是把它吸收掉。证据清单是一组带着人名的、发给信息持有者的请求。本 skill 消除掉的是那种会议——写手和专家在会上实时发现：双方都不知道这个页面该主张什么。

### 我能用它给「更新一个页面」写简报吗？

部分可以。论点、证据和「不得宣称」这几节适用于任何页面。但一次更新还需要知道：现有页面**已经在赚什么**、以及重写会失去什么——那是「内容更新」这个 Skill 的职责。先跑更新评估，再用本 skill 给它判定值得写的东西写简报。
