---
title: 内容更新提示词
description: 为一个流量下滑、或从来没起来过的页面决定改什么——一个诊断、由它推导出的改动清单，以及一份明确写出「不要动」的清单。
category: optimization
useCase: 更新旧页面
outputFormat: 改写方案
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: 内容更新提示词, SEO 内容刷新, 旧文章更新, 内容衰减, 老内容重发, 内容更新清单, 已有页面改写 SEO
relatedSkill: content-refresh
relatedPrompts: seo-content-audit-prompt, humanize-ai-content-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are an SEO editor deciding what to change on a page that is already live,
and what to leave exactly as it is.

# Scope
Work only from the data supplied below. Do not invent positions, impressions,
clicks, publication dates, search volumes or competitor facts. If a number was
not given to you, write that it is unavailable. Never substitute 0 for a
figure you do not have.

# Inputs
Page URL, publish date, last substantive update, and full text: {{page_text}}
Query it is meant to serve, plus secondaries and market: {{target_query}}
Search Console history for this URL, if available: {{performance_history}}
What occupies page one for that query now, if you have it: {{serp_snapshot}}
What must not change on this page: {{change_constraints}}

# What to produce
A revision plan that names one diagnosis, lists only the changes that
diagnosis implies, and states what must be left untouched.

# Steps
1. Say what kind of page this currently is (definition, how-to, comparison,
   list, template, product page), judging from the body copy rather than the
   title or the URL.
2. Say what kind of page the target query wants: from the snapshot if you have
   one, otherwise from query wording alone, labelled as weaker evidence.
3. Choose exactly one diagnosis and give the evidence for it:
   - STALE: the type matches the intent and the page once performed; named
     facts, dates, prices or screenshots have aged.
   - NEVER MATCHED: the type does not match what the query wants, and no
     period in the history shows impressions it could have lost.
   - QUERY MOVED: the type matched what the query used to want, the history
     declines gradually rather than in one period, and today's results are a
     different page type or sub-intent.
   - NOT THE PAGE: nothing in the page text explains the loss. Name what to
     check instead: a sibling page competing for the query, a redirect or
     template change, or a sitewide movement.
4. Rule out the other three in one line each, citing the specific input that
   rules them out.
5. Write the change list for the chosen diagnosis only. STALE gets fact-level
   edits and keeps the structure. NEVER MATCHED gets a rebuild, or a
   recommendation to serve the intent elsewhere; do not dress a rebuild up as
   an edit. QUERY MOVED gets a re-scoping decision, including whether the old
   sub-intent still deserves its own URL. NOT THE PAGE gets no content changes.
6. List what to leave alone: the passages currently earning the impressions
   the page still has, plus everything named in the constraints. Mark which
   entries rest on supplied data and which are judgement.
7. Name the one measurable thing to watch afterwards, and what it would look
   like if the change did nothing.

# Output format
1. Diagnosis: one line with its evidence.
2. Ruled out: three lines.
3. Changes: a table, Section | Change | Why | Effort (S/M/L).
4. Leave alone: a list with one reason each.
5. What to watch afterwards.
6. Data you did not have, and what each piece would have settled.

# Quality checks before you answer
- Exactly one diagnosis is chosen, and each rejected one cites input evidence.
- No position, date, volume or competitor fact appears that was not supplied.
- With no history supplied, the plan states that STALE, NEVER MATCHED and
  QUERY MOVED cannot be separated from page text alone, and labels its reading
  provisional.
- The leave-alone list is non-empty unless the recommendation is a rebuild.
- No change is recommended whose only justification is that the page is old.

# When the input is thin
If the page text is truncated, plan only for the part you were given and name
the sections you could not see. With no history and no results snapshot, still
compare page type against query wording, label that as intent-only evidence,
and do not claim to know whether traffic was lost or never arrived. Absence of
history is not evidence of zero traffic.

# Boundaries
Do not promise rankings, traffic or a recovery timeline. Do not recommend a
keyword density or a repetition count. Do not recommend changing the published
date, adding an "updated" stamp, or reordering paragraphs when no fact on the
page has changed. Do not recommend deleting or consolidating a page when no
traffic history for it was supplied.
```

## Variables

### page_text
Required. 页面 URL、发布日期、最后一次实质性修改的日期，以及包含标题在内的完整可见正文。去掉导航和页脚。
Example: https://ridgelinehr.com/blog/pto-policy-template - published 2023-06-14, last substantive update 2024-02-20 - followed by the full article text

### target_query
Required. 这个页面本该服务的查询词，加上次要查询词和市场。页面类型是对着它来判定的。
Example: Primary: pto policy template (US). Secondary: paid time off policy, how many pto days is standard

### performance_history
Optional. 这个 URL 至少相隔一年的两个时间窗的 Search Console 数据，以及近期的查询词拆分。**随时间变化的形状**才是区分「衰减」和「从未到达」的东西。
Example: 2025-02: 5,120 impressions, 388 clicks, avg position 6.4; 2026-07: 3,610 impressions, 74 clicks, avg position 17.9

### serp_snapshot
Optional. 主查询词此刻第一页上是什么：标题、页面类型，以及交付物是否在首屏。粘你看到的，不要粘你以为的。
Example: 4 of 10 results offer a downloadable file above the fold; one is a fill-in generator; one long-form explainer remains at position 5

### change_constraints
Optional. 方案不允许碰的东西：URL、需要法务签字的表述、品牌用词、留资规则、设计系统限制。
Example: URL must stay - linked from onboarding email. No gated downloads. Anything reading as legal advice needs legal review.

## How to use

粘渲染后的正文，不要粘 CMS 里的标记，并且保留各级标题——页面类型的判读，靠结构不亚于靠措辞。那两个日期比看上去重要：没有「最后一次实质性修改」的日期，模型就没有任何锚点去支撑一个「内容过时」的判断，但它照样会给出这个判断。`performance_history` 至少导两个相隔约一年、不相邻的时间窗，再加一份近期的查询词拆分。单独一个 28 天的导出无法区分「衰减了」和「从来没起来过」，而这个区分正是这条提示词的全部意义。

先看产出里的「已排除」那一块。如果那三条排除理由引用的依据，在你的输入里根本找不到，说明模型是先挑了一个它喜欢的诊断，再倒着给它找支撑。把历史数据原样引用回去重跑一次。然后扫一遍改动表，找出任何一行的理由是「页面太老了」。正是这些行，把一次有针对性的修订变成了一次重写。

你真正会撞上的失败，是**条件反射式的「内容过时」**。它是每一篇讲内容更新的文章都在训练模型给出的诊断，而且能产出一份令人满意的小修小改清单。与之矛盾的特征是：曝光大致持平而点击崩塌、平均排名在若干个周期里持续下滑——那是匹配问题，不是老化问题。还要留意模型怎么读排名那一列：Search Console 的平均排名是**按曝光加权**的，所以页面级的平均值不等于「你那个关键词排在哪」，建立在这个误读上的方案会瞄错章节。

如果它返回「不是这个页面的问题」，别把它当作一次失败的运行。这个分支存在的理由是：最昂贵的一次内容更新，就是做在一个「问题其实出在重定向、出在另一个抢同一个查询词的兄弟页面、或者出在全站波动」的页面上。花一条提示词的成本先排除掉它，比任何人打开 CMS 都便宜。

## Example input

```text
Page URL, publish date, last substantive update, and the full current text:
https://ridgelinehr.com/blog/pto-policy-template - published 2023-06-14,
last substantive update 2024-02-20. ~2,000 words. H1 "How to Write a PTO
Policy". Sections: why PTO policies matter (3 paragraphs); accrual vs lump
sum, with worked examples; how many PTO days is standard; a sample policy
rendered as an HTML table roughly 60% down the page; PTO laws by state
(reviewed 2024-02); FAQ.

Query or queries the page is meant to serve, and the market:
Primary: pto policy template (US). Secondary: paid time off policy, how many
pto days is standard.

Search Console history for this page, if available:
2025-02: 5,120 impressions, 388 clicks, avg position 6.4
2025-08: 4,780 impressions, 301 clicks, avg position 8.1
2026-02: 3,940 impressions, 122 clicks, avg position 13.7
2026-07: 3,610 impressions, 74 clicks, avg position 17.9
Query split, 2026-07: "pto policy template" 1,910 impr / 12 clicks / pos 22.4;
"how many pto days is standard" 980 impr / 41 clicks / pos 8.6;
"paid time off policy" 720 impr / 21 clicks / pos 14.2.

What currently occupies page one for the target query:
Positions 1-4 and 7 are template libraries or a fill-in generator with the
file or form above the fold (two offer .docx and Google Docs copies).
Position 5 is a long-form explainer. Position 6 is a law-firm page titled
"PTO laws by state, 2026". Positions 8-10 are HR vendor template pages.

What must not change on this page:
URL must stay - linked from onboarding email and the sales deck. No gated
downloads. Anything reading as legal advice needs legal review. Brand writes
"PTO", never "paid leave".
```

## Example output

**诊断：查询意图已迁移（QUERY MOVED）。** 2025-02 到 2026-07 之间，曝光下降 29%，而点击下降 81%（388 → 74），平均排名在四次读数中从 6.4 滑到 17.9：这是一条渐进的下滑曲线，不是单期骤降。当前第一页十个结果里有五个把交付物放在首屏；本页是一篇讲解文，示例政策埋在大约 60% 的位置。

**已排除**

- 内容过时（STALE）：州法那一节带着 2024-02 的复核日期，但 "how many pto days is standard" 在本页仍稳在 8.6，所以正文并没有被判读为老化。
- 从未匹配（NEVER MATCHED）：2025-02 时它以 6.4 的位置拿到 388 次点击。曾经有流量可失去。
- 不是这个页面（NOT THE PAGE）：损失是按**查询词**分布的——模板类查询掉到 22.4，而同一 URL 上另一个查询词仍在 8.6。重定向或全站性原因不会造成这种分布。

**改动清单**

| 章节 | 改成什么 | 为什么 | 工作量 |
| --- | --- | --- | --- |
| 首屏 | 以模板开场：不留资的 .docx 加一个 Google Docs 副本链接，紧接着把现有的示例政策表原样作为预览 | 第一页十个结果里有五个在那个位置交付资产；我们的埋在约 1,200 词之后 | 中 |
| 导语中「为什么 PTO 政策很重要」的三段 | 压缩成两句 | 搜索者为了够到文件而划过去的内容 | 小 |
| H1 与标题 | 改写成以交付物开头：「PTO Policy Template (Word and Google Docs)」 | 「How to Write a PTO Policy」宣告的是一篇讲解文，而这个页面不会再是讲解文 | 小 |
| 各州 PTO 法规（2024-02 复核） | 迁到独立 URL 并从本页链过去；本 URL 不受影响 | 这是第二个子意图，第一页某个竞品用一整页来覆盖它；何况它本来就需要法务复核 | 大，卡在法务复核 |

**不要动**

- 「how many pto days is standard」那一节：2026-07 有 980 次曝光、41 次点击，位置 8.6，是这个 URL 上最健康的查询词。不要压缩它，也不要把它并进导语。（依据你提供的数据。）
- 累积天数的计算示例：它们撑着「标准天数」那一节。没有任何查询数据能单独归因到它们，所以这是判断，不是测量。
- URL、不留资的交付方式，以及「PTO」这个词——按约束条件保留。

**改完之后盯什么**

盯这个 URL 上 "pto policy template" 的点击与平均排名，同时把 "how many pto days is standard" 的同类数字作为回归检查。**不早于两个完整自然月**再读数；窗口更短就分不清是改动的效果还是正常波动。如果模板类查询仍在二十几名、而第二个查询词没有变化，说明页面类型不是那个约束条件，剩下的选项是做一个独立的模板页。

**你没有提供的数据**

- 没有 "how many pto days is standard" 的结果快照，所以那个子意图是否也在迁移属于未知；这一判断只靠排名历史支撑。
- 没有设备或国家维度的拆分。如果点击崩塌集中在某一种设备上，要修的可能是呈现方式而不是页面类型。**数据不可得，不等于零。**
- 没有内链或外链数据，因此无法评估把本页与另一个页面合并是否可行。

## Safety notes

方案里每一处涉及事实的修改都是**草稿，不是结论**。一个被告知「州法那节过时了」的模型，会兴高采烈地从训练数据里产出一份替换文本，连费率和生效日期都写得跟真的一模一样。在上线前，逐个数字、日期和法律表述对着你自己掌握的来源核实；「不要动」那份清单也要用你自己的知识核一遍。模型保留那些章节，只是因为你的输入里没有任何东西与之矛盾，这和「确认它们是正确的」不是一回事。

这条提示词不宣称改完就能恢复什么。它做的是给工作排序、指出排序背后的证据、并说明哪些它无法判定。「查询意图已迁移」是对某一时刻输入的一种判读：如果你的结果快照是一周前的，那么诊断也是一周前的；如果你根本没提供快照，那么诊断就只靠查询词措辞和历史曲线的形状。这条提示词的写法是把这句话说出来，而不是用一个估算把缺口盖上。

## FAQ

### 如果这个页面没有 Search Console 历史数据怎么办？

三个内容侧的诊断会部分坍缩。你仍然可以拿页面类型去比对查询词想要什么，得到一个能用的判读，而这条提示词会把它标注为「仅基于意图的证据」。你做不到的是区分「衰减了」和「从来没起来过」，因为它们今天看起来完全一样。如果页面比你的数据窗口还新，记住：**缺失的数据是缺失，不是零**；把一份空导出当作失败的证据，是在用「没有」来论证。

### 这个页面明明既过时又不匹配，为什么非要选一个诊断？

因为这两类修复在规模、顺序和执行人上都不同。给一个页面类型已经不匹配的页面更新过时事实，你会得到一个准确但依然拿不到流量的页面；而把一个唯一问题是价格过期的页面推倒重建，是用一周去做一次编辑。强制二选一，是为了让方案能排出优先级。等第一项修复上线、你手上有了两个月的读数，带着新历史重跑这条提示词。如果第二个诊断当时是真的，它还会在那里。

### 更新发布日期有用吗？

这条提示词拒绝推荐这么做，我也一样。在读者察觉不到任何变化的前提下改一个日期戳，不会给你带来任何关于「这个页面到底行不行」的新证据，还会毁掉你自己的审计线索：下个季度你将无法分辨哪些页面是真的改过。内容变了，就给这次改动标日期。内容没变，就没有什么可标的。

### 什么情况下这条提示词不好用？

三种。模板化或程序化生成的页面——问题住在模板里，修好一个 URL 什么也解决不了，该去审模板。与全站一起掉流量的页面——诊断是「不是这个页面」，真正的活在别处。以及目标查询词的结果集本身含混或混杂的页面——「这个查询想要什么类型的页面」没有唯一答案，这时提示词会挑一种判读，而你应该把快照喂给它并质疑它。
