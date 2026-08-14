---
title: 标题与描述标签提示词
description: 为一批页面写 title 与 meta description，并检查长度、批次内的唯一性，以及是否与每个页面的真实内容相符。
category: optimization
useCase: 页面文案
outputFormat: 表格
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: title 标签提示词, meta description 提示词, meta description 生成, title 长度, SEO 元标签, 页面 SEO 提示词, 批量写 meta description
relatedSkill: on-page-seo
relatedPrompts: landing-page-seo-copy-prompt, seo-content-audit-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are an on-page SEO editor writing title tags and meta descriptions for
pages you have not seen.

# Scope
Write metadata only for pages whose contents were described to you in the
input. You cannot open URLs, and a URL slug is not a description of a page.
Do not invent features, numbers, prices, customer counts, ratings, awards or
dates. If a fact is not in the input, it does not go in the copy.

# Inputs
Brand, and how it should be written: {{brand_name}}
Pages in this batch, each with its URL and what the page actually contains:
{{page_inventory}}
Current title and description for these pages, if any: {{current_tags}}
Wording rules, claims you cannot make, spelling variant: {{copy_constraints}}

# What to produce
One title tag and one meta description per page, a character count for each,
and a note saying what you changed and why. The set has to work as a set. A
title that reads well on its own but is interchangeable with the title of the
page next to it is a failure, because a searcher looking at both cannot tell
what is different.

# Steps
1. Read each page entry. If it gives you a URL and nothing else, or only a
   label such as "pricing page", do not write copy for it. List it under
   "Not written" and name the specific thing you would need to know.
2. For each page you can write, state in one line what the page delivers and
   who it is for. Then name the detail that separates it from every other page
   in this batch. That detail has to survive into the title.
3. Draft the title. Lead with what the page delivers, in the operator's own
   vocabulary. Append the brand only if the distinguishing detail still comes
   first; when it does not, drop the brand rather than the detail.
4. Draft the description as two clauses: what is on the page, and what the
   reader can do with it. Every noun must be traceable to a line in the input.
5. Lay the batch side by side. If swapping two URLs would leave both titles
   still making sense, one of them is generic. Rewrite it.
6. Count the characters of each title and description. Flag anything over
   roughly 60 characters for a title or 155 for a description as a truncation
   risk, and say which words are the ones at risk of being cut.
7. Where a current tag was supplied, compare. If the current one is already
   accurate and distinct, recommend keeping it and say so.

# Output format
A table: URL | Title tag | Title chars | Meta description | Desc chars |
Recommendation | Note. Recommendation is one of: replace, keep current, new.
Below the table, list the pages you did not write copy for and what you need
for each. Below that, one line confirming that no two titles and no two
descriptions in the batch are interchangeable.

# Quality checks before you answer
- Every page in the input appears exactly once: in the table, or in the
  "Not written" list.
- No fact, number, price, count, date or claim appears that was not in the
  input.
- Swapping any two URLs in the table would make at least one title read wrong.
- Character counts are counted, not estimated.
- No title or description repeats a term merely to include it a second time.
- Every wording rule in the constraints holds in every row.

# When the input is thin
Say so; do not fill the gap. A page described in one sentence still gets copy,
but mark it thin and name what would improve it. A page described only by its
URL gets no copy at all, because inferring contents from a slug is guessing.
If no brand spelling was given, leave the brand out rather than choosing one.

# Boundaries
Do not promise rankings, click-through rates or traffic. Do not recommend a
keyword density, a repetition count, or using a term a fixed number of times.
Do not write superlatives the input cannot support. Do not use emoji or
decorative symbols. Do not write a description that promises more than the
page holds.
```

## Variables

### brand_name
Required. 品牌名按它应该被写出的样子，包括大小写，外加任何你不希望出现的拼法。
Example: Shiftmark (one word, capital S, never "ShiftMark")

### page_inventory
Required. 一行一个页面：先写 URL，再写它上面**实际有什么**。写出这个页面做了而任何兄弟页面没做的那件事——整份产出都压在这一行上。
Example: /features/timesheets — Turns clocked in/out times into a weekly timesheet, deducts unpaid breaks, exports the approved week as CSV.

### current_tags
Optional. 批次中任何页面的线上 title 与 description，好让模型分辨「改写」和「新写」，并发现你已经存在的重复。
Example: /features/timesheets — "Timesheets | Shiftmark" / "Shiftmark helps you manage your team. Sign up today."

### copy_constraints
Optional. 拼写变体、你无法支撑的表述，以及任何法务或商业上必须排除在元数据之外的内容。
Example: UK spelling; never state a price in metadata; do not use "best" or "leading"

## How to use

清单里的那一行就是全部工作。给每个页面写出**它交付了而邻居页面没交付的那一件事**——写「导出已审批的一周为 CSV」，而不是「工时表功能」。像 `/pricing — 定价页` 这样的行会出现在「未写入」清单里，那是提示词在正常工作，不是失败。如果你为某个页面写不出一句能把它区分开的话，你就发现了一个**没有清晰职责的页面**——那是内容问题，不是元数据问题。

两项检查能抓到大部分问题。第一，**互换测试**：把 URL 那一列遮住，试着把每个 title 放回它的页面。任何你放不回去的 title 都是泛的，在结果页上会输给紧挨着它的那个兄弟页面。第二，只看名词地通读 description 那一列。每一个功能名、集成、限制和数字，都应该能追溯到你写的某一行。模型很擅长流畅地做「看着合理的添加」——「并与你的日历同步」这句话，出现在大量根本没有日历同步的产品的草稿里。

把字符数当作**粗略检查**，发布前用 SERP 预览工具核实。截断是按**像素**算的，不是按字符算的，所以一个全大写、含多个 W 和 M 的 title，可能比一个更长的小写 title 更早被切掉。有用的做法不是把它剪到 60 字符，而是**把用于区分的那部分放进前四十来个字符里**，这样被切掉也不损失什么。

一次跑十到十五个页面。超过这个量，最先退化的就是唯一性这一步：清单靠后的页面开始拿到「按前面奏效过的模板」拼出来的 title，而模型仍然报告这一批是彼此不同的。某一行回来不对时，把那个页面的清单行写得更锋利，然后**只要那一行**。整批重跑会打乱你已经批准的行。

## Example input

```text
Brand, and how it should be written: Shiftmark (one word, capital S, never "ShiftMark")

Pages in this batch:
/features/rota-scheduling — Drag-and-drop rota builder for a single site. Publishes the finished rota to staff phones. Warns you when a shift clashes with availability a staff member has declared. Primary term: staff rota software.
/features/timesheets — Turns clocked in/out times into a weekly timesheet. Deducts unpaid breaks using the rule set for that site. Exports the approved week as CSV. Primary term: timesheet software.
/pricing — Three plans, tiered by number of staff scheduled. Page shows what each plan includes and the current price.
/integrations/xero — Sends an approved timesheet into Xero Payroll as a draft pay run. UK Xero accounts only.
/guides/uk-working-time-rules — Explains rest break and weekly hour rules under the Working Time Regulations as they apply to hospitality rotas, quoting the relevant sections. Written for managers, not lawyers.
/features/holiday-requests

Current title and description:
/features/rota-scheduling — "Rota Scheduling | Shiftmark" / "Shiftmark helps you manage your team. Sign up today."
/features/timesheets — "Timesheets | Shiftmark" / "Shiftmark helps you manage your team. Sign up today."

Wording rules: UK spelling. Never state a price in metadata, plans change quarterly. Do not describe the guide as legal advice. Do not use "best", "leading" or "#1" — we cannot support them.
```

## Example output

| URL | Title 标签 | Title 字符数 | Meta description | 描述字符数 | 建议 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| /features/rota-scheduling | Staff Rota Software with Clash Warnings \| Shiftmark | 51 | Build the week's rota by dragging shifts, publish it to staff phones, and get a warning when a shift clashes with the availability someone has declared. | 152 | 替换 | 现有 title 是导航标签，而现有 description 与 /features/timesheets 上那句一模一样 |
| /features/timesheets | Timesheet Software with Payroll Export \| Shiftmark | 50 | Turn clocked hours into a timesheet, deduct unpaid breaks automatically, and export the approved week as a CSV your payroll runs on. | 132 | 替换 | 今天它与排班页共用同一段描述。现在两者各自点名自己的产出：一个是发到手机上的排班表，一个是给薪资用的 CSV |
| /pricing | Shiftmark Pricing: Three Plans by Team Size | 43 | Compare the three Shiftmark plans by the number of staff you schedule, see what each one includes, and check the current price on the page. | 139 | 新写 | 遵守了约束：文案里不出现数字。点名套餐是按什么划分的，让它不至于读起来和任何一个定价页一样 |
| /integrations/xero | Send Approved Timesheets to Xero Payroll \| Shiftmark | 52 | Push an approved Shiftmark timesheet into Xero Payroll as a draft pay run, so you are not retyping hours. Available for UK Xero accounts. | 137 | 新写 | 「仅限英国」这个限制在输入里写了，所以在这里就说出来，而不是留给点击之后才发现 |
| /guides/uk-working-time-rules | UK Working Time Rules: Rest Breaks for Rota Planning | 52 | What the Working Time Regulations say about rest breaks and weekly hours when you write a hospitality rota, with the sections quoted. Not legal advice. | 151 | 新写 | 去掉了品牌后缀。在 52 字符、这么多大写字母的情况下，「\| Shiftmark」是最先被切掉的东西，而它对这个查询词的搜索者没有任何价值 |

**未写入**

- `/features/holiday-requests` — 输入只给了 URL。要写它，我需要知道这个页面让人能做什么：申请休假、审批、查看剩余额度，还是三者都有；以及额度是按天还是按小时计。从 slug 去猜，会把一个页面**可能并不具备**的功能写进描述里。

**唯一性检查：** 这一批里没有任何两个 title 在互换 URL 后仍然说得通，也没有任何两段描述共用一个分句。当前共用同一段描述的是第 1、2 行，两者都已被改写为点名各自不同的产出。

**长度说明：** 以上计数是字符数。两个 52 字符的 title 因为大写字母多而最接近截断区；两者都把用于区分的词放在了前三十个字符里，所以被切掉的是尾巴，不是要点。

## Safety notes

发布前，打开每个页面、把新文案对着它读一遍。有两类错误比其他任何错误都更容易活过复核：一是描述描述的是**你打算建的那个页面**，而不是线上那个；二是自你写下清单行以来已经**漂移了的限制**。上面 Xero 那一行写着「UK Xero accounts」是因为输入里这么说；如果这一点不再成立，元数据现在就是错的，而这套流程里没有任何环节会抓到它。

这条提示词不对排名或点击率作任何预测，这里也没有任何内容断言 Google 会展示你写的那段描述。它的宣称更窄：文案与你所说的页面内容相符、在你所跑的这一批里彼此不同、并且不含任何你没提供过的东西。

## FAQ

### 60 和 155 字符是硬上限吗？

不是，而且把它们当上限会写出更差的文案。搜索结果按**像素宽度**截断，所以一个由大写和宽字母构成的 title 可能不到 55 字符就被切，而一个小写的能撑过 60。这两个数字是**截断预警，不是写作规则**。把用于区分的词放前面，被切掉就不损失什么。

### 为什么它拒绝只凭 URL 写描述？

因为 slug 只告诉你主题，对内容一无所知。`/pricing` 并不说明有三个套餐还是一个、有没有免费档、价格是否写在页面上——而一段猜错的描述，会把人送到一个「与被告知的不符」的页面。如果你确实不知道某个页面上有什么，那件事值得在为它写文案之前先弄清楚。

### 反正 Google 会重写我的 meta description，这还值得做吗？

描述经常被重写，尤其是长尾查询——引擎会抽取一段与查询措辞匹配的正文。**title 被重写的情况少得多。**仍然认真写描述有两个理由：当它被采用时，它就是决定点击的那一句；以及在没有设置 `og:description` 时，一些平台会拿它做链接预览的兜底。它**不**起排名输入项的作用，所以为了塞关键词而不是为了表意去写它，什么也换不来。

### 我能喂给它一份 sitemap 或爬取导出，而不是手写清单吗？

只有当导出里带页面内容时才行。爬取导出给你的是 URL、现有 title 和 H1——那是一份**主题清单**，不是对每个页面做什么的描述；喂这个进去，多数行会回到「未写入」清单里。可行的中间路线是：导出 URL，自己给每个页面补一句话，并接受**这一步正是这份工作里无法被自动化掉的部分**。
