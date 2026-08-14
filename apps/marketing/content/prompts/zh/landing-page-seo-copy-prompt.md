---
title: 落地页文案提示词
description: 起草落地页文案：第一屏就回答一个搜索查询，然后争取一个动作，且只使用你提供的事实。
category: writing
useCase: 转化文案
outputFormat: 初稿
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: 落地页文案提示词, SEO 落地页文案, 落地页写作提示词, 转化文案提示词, AI 落地页文案, 搜索意图落地页
relatedSkill: on-page-seo
relatedPrompts: comparison-page-copy-prompt, title-tag-meta-description-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are a landing page copywriter working only from facts an operator gave you.

# Scope
Write one page that serves one search query and asks for one action. You cannot
open URLs or look the product up, and every claim must trace to a line in the
input. Do not invent customer counts, logos, testimonials, ratings,
percentages, time savings, prices or deadlines. If a proof point is not in the
input, the page is written without proof rather than with invented proof.

# Inputs
The query this page serves, and who types it: {{target_query}}
What the offer is, what it does, and where it stops: {{offer_facts}}
The one action the page asks for, and what happens right after:
{{primary_action}}
Proof you can actually cite, if any: {{proof_assets}}
Voice, spelling, and claims you cannot make: {{copy_constraints}}

# What to produce
A full draft: H1, subhead, first screen, the sections below it, the
call-to-action wording, and three FAQ entries. Then a short note naming the
decision you made where search relevance and conversion pulled apart.

# Steps
1. Restate the query as the question the visitor is actually asking. If the
   input carries two questions or two actions, name the split, serve one, and
   recommend a second page for the other. Do not average them into one page
   that serves neither.
2. Write the first screen to answer that question directly. The H1 names the
   thing in the searcher's vocabulary, not the brand's. Someone arriving from
   that query must confirm in one read that this page is about their problem,
   before any persuasion happens.
3. Below the first screen, earn the action. Order the sections by the objection
   a reader raises next, not by what the business most wants to say. Each
   section settles one objection using facts from the input.
4. State the limits. Name who this is not for, what it does not do, and what it
   requires, in the page's own voice. A limit the reader can check does more
   here than a claim they cannot.
5. Write the action wording so it says what happens on click. State only
   conditions that appear in the input.
6. Use proof only where it was supplied, and attribute it: who said it, or
   where the number came from. Where a section needs proof you were not given,
   write it without and list the gap under "Proof requested".
7. Write three FAQ entries answering what this specific searcher asks before
   acting. Answer them; do not use them to restate the pitch.

# Output format
Markdown, in this order: Page intent (query, audience, single action); H1;
Subhead; First screen; Sections, each with heading and body; Action wording,
with the button label and the line under it; three FAQ entries;
Relevance-versus-conversion note; Proof requested; Refused, with reasons.

# Quality checks before you answer
- Every noun, number, limit and name in the draft traces to a line in the
  input.
- The first screen answers the query without a scroll or a click.
- The page asks for exactly one action, and no secondary link competes with it.
- No urgency, scarcity or deadline appears unless the input supplied a real one.
- No proof appears without an attribution a reader could check, and no figure
  supplied as a range, median or average is restated as a promise.
- Swapping the brand for a competitor's would make the first screen read wrong.
  Any sentence that survives that swap is generic; rewrite it.

# When the input is thin
Say so and write only what the input supports. If the offer facts run to one
line, write the first screen, mark the remaining sections unwritten, and name
the fact each one needs. If no proof was supplied, ship with no proof section
rather than placeholder testimonials or bracketed metrics. Never fill a gap
with a plausible number.

# Boundaries
Do not promise rankings, traffic, revenue, or a timeline to results. Do not
recommend a keyword density or a repetition count. Do not fabricate scarcity,
countdowns or expiring offers. Do not write testimonials, customer names or
logos. Do not assert a certification, compliance status or guarantee that was
not supplied. Do not use emoji.
```

## Variables

### target_query
Required. 这个页面服务的**唯一**查询词，加上谁会打这个词、他已经知道什么。写清他想确认或排除什么，而不只是写关键词。
Example: "online laser cutting service" — an engineer sourcing cut parts, comparing three or four vendors in one sitting

### offer_facts
Required. 这东西是什么、能做什么、到哪儿为止：材料、上限、起订量、排除项，以及不支持的情况会怎么处理。**这里排除项比功能更重要。**
Example: Cutting only, no bending or finishing. Max sheet 120 x 60 in. DXF or DWG only; STEP files are rejected.

### primary_action
Required. 页面要求的那**一个**动作，以及访客做完之后立刻得到什么，包括它要花多少钱、把他绑定到什么程度。
Example: Upload a DXF or DWG. A quoting engineer sends a firm price by the end of the next business day. No account, no card.

### proof_assets
Optional. 你能公开使用的证据：已授权的具名客户、带来源和样本量的已发布数字、第三方评分。这里没有的东西，不会出现在稿子里。
Example: Median 3 business days from approved quote to shipment, 612 orders shipped January to March 2026, from our dispatch records

### copy_constraints
Optional. 语气、拼写变体、要避开的词，以及法务或商业现实不支持的表述。
Example: US spelling. Never state a turnaround as a promise for a specific order. Do not use "fast" or "precision" without a number behind it.

## How to use

`offer_facts` 里的**排除项**比功能干的活多。多数操作者把这个字段填成「产品能做什么」，而把「它拒绝什么」略去，于是回来的稿子放到这个品类里的任何一家厂商身上都成立。把最大尺寸、最小起订量、你拒收的文件格式、你不发货的地区都写上。一个在第一屏就告诉访客「你的零件超出我们的台面长度」的页面会失去这个访客——这是**正确**的结果，而且比在报价往返一轮之后才失去他便宜得多。

你真正会撞上的失败是**证据被重新塞回来**。把稿子读一遍，眼里只看数字、名字和最高级表述，逐个对着 `proof_assets` 核。稿子回来时经常挂着「数百位工程师信赖」「行业领先公差」「24 小时交付」——而输入里一条都没提。更隐蔽的版本是**已提供的数字被悄悄升格**：你给的是「中位数 3 个工作日」，稿子写成「我们 3 天发货」。这句话已经变成一个运营团队从未做出的承诺，而且它读起来太自然，能通过大多数复核。

如果你开始想在第一屏加一个订阅框、或者在主按钮旁边再放一个按钮，说明你撞上了这条提示词要解决的那个张力——而两个都加，正是页面最后哪个都没服务好的原因。反过来同理：如果稿子读着像在回答两个问题，那是输入里含了两个查询词，修复点在上游的 `target_query`，不在文案。

某一节回来很泛，说明那一节的事实太薄。把缺的细节补上，然后**只要那一节**，不要整页重跑。整页重跑会打乱标题层级和你已经批准的 H1，第二轮复核你会花在重新批准早已定下的东西上。

## Example input

```text
The query this page serves, and who types it: "online laser cutting service" — a
mechanical engineer or small shop owner sourcing cut parts, comparing three or
four vendors in one sitting. They want to know what we cut, how big, how thick,
and how price is worked out before they send a file to anyone.

What the offer is, what it does, and where it stops:
Kerfline is a fiber laser cutting shop in Cleveland, Ohio. Upload a DXF or DWG,
we quote it, we cut it, we ship it.
Materials: mild steel, stainless 304 and 316, aluminum. No brass, no copper, no
acrylic.
Max sheet 120 x 60 in. Max thickness 0.75 in mild steel, 0.5 in stainless,
0.375 in aluminum.
Cutting only. We do not bend, tap, weld, powder coat or anodize.
Priced on cut path length plus sheet usage, not by machine hour. We have no
hourly rate to quote.
Minimum order $150. Tolerance +/- 0.005 in on parts under 24 in.
Ships to the lower 48. No international shipping, no local pickup.
DXF or DWG only. The quoting system rejects STEP files.

The one action the page asks for, and what happens right after:
Upload a DXF or DWG. A quoting engineer reviews it and sends a firm price by the
end of the next business day. No account needed, no card. Nothing is cut until
the quote is approved in writing.

Proof you can actually cite:
Ridgeline Cycles (small-batch e-bike frames, Portland) gave written permission
to be named and to use this sentence: "We moved our dropout blanks to Kerfline
because they would quote a 40-part run without asking us to commit to 400."
Median 3 business days from approved quote to shipment, across 612 orders
shipped January to March 2026, from our own dispatch records.
Nothing else is cleared. No ratings, no case studies, no customer count we are
willing to publish.

Voice, spelling, and claims you cannot make:
US spelling. Write for someone who reads drawings. Do not say "solutions" or
"manufacturing partner". Never state a turnaround as a promise for a specific
order; the 3-day figure is a median. Do not use "fast", "affordable" or
"precision" without a number behind it. We would also like this page to pick up
"laser cutting cost per hour" searches.
```

## Example output

**页面意图** — 查询词："online laser cutting service"。受众：正在比价的工程师。唯一动作：上传 DXF 或 DWG 获取报价。

**H1** — Online Laser Cutting for Steel, Stainless and Aluminum Parts

**副标题** — Upload a DXF or DWG and a quoting engineer sends a firm price by the end of the next business day. Nothing is cut until you approve it in writing.

**第一屏** — 规格块，上传按钮放在它旁边：

| | |
| --- | --- |
| Materials | Mild steel, stainless 304 and 316, aluminum |
| Sheet size | Up to 120 x 60 in |
| Thickness | 0.75 in mild steel, 0.5 in stainless, 0.375 in aluminum |
| Tolerance | +/- 0.005 in on parts under 24 in |
| Files | DXF or DWG |
| Ships | Lower 48 |

**我们不做什么** — 只做切割：不折弯、不攻丝、不焊接、不喷粉、不阳极氧化，所以需要折弯的零件得再找一家。不做黄铜、紫铜、亚克力。不做国际运输，不支持自提。报价系统拒收 STEP 文件。

**报价怎么算** — 按切割路径长度加板材利用率。没有机时费可报。最小订单 $150。

**上传之后会发生什么** — 报价工程师会审阅文件，在你书面确认价格之前不会开始切割。2026 年 1 月至 3 月发出的 612 个订单中，我们的发货记录显示：从确认报价到发货的中位数是 3 个工作日。**那是这批订单的中位数，不是你这单的日期。**

**谁在跟我们合作** — Ridgeline Cycles，在波特兰做小批量电助力自行车车架："We moved our dropout blanks to Kerfline because they would quote a 40-part run without asking us to commit to 400."

**按钮文案** — 按钮：Upload a DXF or DWG。按钮下方：No account, no card. A quoting engineer replies with a firm price by the end of the next business day.

**FAQ**

- Can you cut a part longer than 120 in? No. 120 x 60 in is the sheet, and splitting a longer part into sections is a design change we do not make for you.
- Do you cut acrylic or brass? No. Mild steel, stainless 304 and 316, and aluminum.
- Can I send a STEP file? No. Export to DXF or DWG.

**相关性与转化的取舍说明** — 第一屏放的是规格块而不是价值主张，因为这个搜索者是**先排除、后评估**，所以按钮放在规格旁边，而不是论述下面。用一次阅读就回答「你们能不能切我的零件」，代价是一屏说服文字，省下的是双方在你根本接不了的活上走一轮报价。另外：「laser cutting cost per hour」是另一个问题，这个页面无法诚实回答，因为你们不按机时计价。那类搜索需要一个解释切割路径计价的页面，而它的动作不该是上传文件。

**需要补的证据** — 第二个具名客户，最好在自行车行业之外。±0.005 in 公差是怎么验证的。612 单的中位数现在是否仍然成立，因为这个页面的寿命会超过 2026 年 Q1。

**已拒绝写入** — 没有客户数量、评分或成功率：一条都没提供。没有交付时间承诺，按你的约束。「精密」被略去，因为背后没有数字。没有稀缺性或截止期限话术。

## Safety notes

上线前，把稿子里每一个数字和名字对着来源核一遍，并核实那些限制**现在仍然成立**——三个月前变过的最小起订量、厚度上限或发货地区，会一直挂在页面上，直到有人重读它为止。任何具名客户，都要就**你引用的那句原话**拿到书面确认，而不是就「同意被引用」这件事拿确认。任何可能被读成保证、认证或合规声明的内容，都需要那个承担相应风险的人过目——因为「我们的记录显示中位数是三天」和「我们三天发货」之间，只隔着一次顺手的编辑。

这条提示词不对排名、流量或转化率作任何宣称，产出中也没有任何东西能证明这个页面比你现在的页面表现更好。它的宣称更窄：文案可追溯到你提供的事实、它只服务一个查询词并只要一个动作、并且不含任何你没给过的证据。

## FAQ

### 第一屏就回答搜索问题，会不会伤转化？

它通常会降低采取动作的**绝对人数**，同时提高其中「你真的能服务」的比例。在上面那个例子里，一个手里拿着 3 米长零件的工程师现在五秒钟就离开了，而不是提交文件、占掉一位报价工程师一个下午。如果你汇报的指标是表单提交数，这看起来就是损失，所以要事先约定你在管理哪个数字。但这**不是**一个可以绕开的取舍：一个刻意不给答案、好让人往下滚的第一屏，恰恰会被那批知道该问什么的受众读成回避。

### 行动按钮该放第一屏，还是放在论述之后？

放在访客已经有足够信息去行动的位置，而这取决于查询词暗示了他已经知道什么。处在比价阶段的搜索者需要先看到规格，按钮才有意义，所以按钮该放在规格旁边。而从品牌词进来的人已经决定了，根本不需要那段论述。两种情况下都会失败的模式是：一个有按钮但没实质内容的首屏，实质内容在下面很远的地方——前一类人无法评估，后一类人得划过一堆空话。

### 什么时候这条提示词是错的工具？

当页面必须同时服务多个意图时。首页、品类页、以及覆盖四档套餐的定价页，天生就违反「一个查询、一个动作」的规则，强行套这条提示词，产出的页面只会服务你恰好列在最前面的那个意图。当**产品事实本身还不存在**时它也是错的工具——如果没人能说清这个产品做了什么而竞品没做，那么不管输入怎么措辞，稿子回来都会很泛，而那是定位问题，文案解决不了。

### 我能把它用在付费搜索的落地页上吗？

部分可以。结构可以沿用，但付费落地页匹配的是**广告**而不是查询词，而广告已经做出了一个具体承诺，第一屏必须逐字兑现它。把广告标题和它的承诺写进 `target_query`，好让稿子回应访客点进来时看到的那个承诺。把结果当作一个变体，仅此而已：这条提示词产出的是一份草稿，不是「哪个版本转化更好」的证据，而后者只有你自己跑一次测试才能定。
