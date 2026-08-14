---
title: 对比页文案提示词
description: 用带日期、亲眼观察到的竞品事实写一个 X vs Y 对比页，包含「该选对方」的那些情形，以及一份没能核实的事项清单。
category: writing
useCase: 决策期文案
outputFormat: 初稿
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: 对比页提示词, X vs Y 页面, 竞品对比页, 替代方案页文案, SaaS 对比页模板, 决策期 SEO 文案, 竞品对比写作提示词
relatedSkill: content-brief
relatedPrompts: landing-page-seo-copy-prompt, seo-blog-post-writing-prompt
status: published
publishedAt: 2026-08-14
---

## Prompt

```text
You are writing a head-to-head comparison page for a buyer choosing between two
products today. You compare what you were shown. You do not compare what you
remember.

# Scope
Write one comparison page from the evidence below. Every statement about the
competitor must trace to a dated observation in the inputs. You have no prior
knowledge of this competitor: any price, limit, feature or policy you recall
from training is not evidence and must not reach the page. Where the evidence
is silent, the page says the fact was not verified. Silence is never absence.

# Inputs
Our product and positioning: {{our_product}}
Verified facts about us: {{our_facts}}
Verified facts about the competitor, each with a date and where it was seen:
{{competitor_facts}}
Who reads this page and what they are deciding: {{buyer_context}}
Constraints on the page: {{page_constraints}}

# What to produce
A page a sceptical buyer can act on, containing a plain statement of the cases
where the competitor is the better purchase, and a ledger of everything that
could not be verified.

# Steps
1. Split the competitor evidence into two piles: facts carrying both a date and
   a place they were observed, and everything else. Only the first pile may
   become a claim. The second pile goes to the ledger.
2. Choose five to eight comparison axes from the buyer's decision, not from our
   feature list. Drop any axis you picked only because we win it. Keep any axis
   the buyer weighs even when we lose it.
3. Fill both sides of every axis. Where one side has no verified fact, write
   "Not verified" and name the page a reader could open to check. Never write
   "No", "None", or "Not supported" because the evidence was quiet.
4. Put prices on one basis: same tier, same billing period, same currency, and
   the buyer's own volume or seat count from the inputs. Show the arithmetic,
   carry the observation date, and name the volume at which the cheaper product
   changes. Where a plan's included volume is not published, state that the
   comparison cannot be made past that point.
5. Write "Choose [competitor] when" before you write "Choose us when". It needs
   at least two situations, each built on a verified competitor strength and
   each describing a buyer who plausibly exists. A situation nobody is in is a
   worse concession than none.
6. Write the differences as behaviour, not verdicts. Say what each product does
   at the moments the buyer asked about: the failure, the limit, the invoice.
   Describe; do not score or rate.
7. Compile the ledger: every unverified item, with the exact page someone must
   open to close it.

# Output format
1. Title and a meta description under 155 characters.
2. A summary paragraph naming the one difference that decides most of these
   purchases.
3. Comparison table: Axis | Us | Competitor | Basis and date observed.
4. "Choose [competitor] when", then "Choose us when", as short lists.
5. Two to four short sections on the differences that carry the decision.
6. "Not verified before publishing" - each item with where to check it.

# Quality checks before you answer
- Every competitor cell traces to a dated line in the inputs, and no cell
  infers absence from missing input.
- The competitor section names at least two situations a real buyer is in, each
  resting on a strength rather than a weakness rewritten as one.
- Every price statement carries tier, period, currency, volume and date.
- No sentence describes the competitor's company, team, motives, or future.
- Every axis would still belong on the page if we lost it.

# When the input is thin
If fewer than five competitor facts carry both a date and a source, say so at
the top, build the table from the rows you can support, and list the exact
pages someone must open. Do not fill gaps from memory of the vendor, do not
infer a limit from a plan's name, and do not estimate. Four verified rows with
an honest ledger is publishable; twelve invented ones is not.

# Boundaries
Refuse to state a competitor price, limit, or policy you were not given. Refuse
to claim the competitor lacks a feature. Do not compare against their beta,
their roadmap, or a version you were not shown. Do not use superlatives - "the
only", "the best", "the fastest" - without a supplied basis. Do not promise
rankings, traffic, revenue, or a timeline. Do not state a keyword density or a
repetition count. Do not write quotes, testimonials, or review text.
```

## Variables

### our_product
Required. 我们卖什么、卖给谁，一到两句话。这一项决定哪些对比维度是相关的，也能防止页面滑成一篇品类科普。
Example: Ferrule - hosted outbound webhook delivery for API teams: signs, retries and logs every delivery, and gives your customers their own delivery log

### our_facts
Required. 我们自己当前的、可核查的事实：定价按今天定价页上的原样列，套餐额度，以及**今天已上线**而非计划中的功能。用和竞品同样的方式给它们标日期。
Example: Pricing page 12 Aug 2026: $0.40 per 1,000 delivery attempts, no seat charge, $99/month Team floor. Retries: 8 attempts over 24 hours, configurable per endpoint. Regions: us-east only.

### competitor_facts
Required. 你亲眼看到的事实，每条都带上日期和你看到它的那个页面。同时列出你找过但没找到的东西，明确标注，这样模型会把它写进「未核实」清单，而不是猜一个。
Example: Relaypoint. relaypoint.example/pricing, 13 Aug 2026: Starter $79/month including 100,000 attempts, then $0.90 per additional 1,000. Log retention: searched docs 13 Aug 2026, not stated - NOT VERIFIED.

### buyer_context
Required. 谁会落到这个页面上、他们现在用什么、以及决定价格对比结果的那几个数字。没有用量或席位数，定价那一节就只能停在抽象层面，对谁都没用。
Example: Platform engineer at a 20 to 60 person B2B SaaS, currently sending webhooks from their own job queue, roughly 200,000 delivery attempts a month, deciding whether to buy or keep maintaining it

### page_constraints
Optional. 篇幅、CTA、内链，以及你们法务或品牌审核对竞品表述的规则。
Example: 700 to 1000 words. Every competitor claim carries its observed date and links to the page it came from. No superlatives. CTA: start a trial. Internal links: /pricing, /docs/replay

## How to use

动这条提示词之前先把竞品证据收齐，而且要收成**你真正看到的文字**，不是你对它的总结。定价档位按页面上的原样粘过来，带 URL 和日期；文档里的那句话原样粘，而不是粘你的转述。然后补上大多数人会跳过的那一行：你找过、但没找到什么。正是这一行，把一个缺失的事实变成「未核实」这一格，而不是一个自信的「否」。

你一定会撞上的失败是**把回忆装扮成调研**。给模型一个竞品名字和三条事实，它会很乐意产出一张十二行的表，因为它训练时见过那家厂商的营销站。凭回忆生成的那些行才是危险的：它们通常是一两年前真实存在过的某个档位——恰恰是那种读起来可信、能通过内部评审、然后被对方销售拿去当面打脸的错。读文风之前，先机械地核一遍产出。竞品那一列的每一格，都必须在「依据与观察日期」列里带一个日期，而且每个日期都必须是你提供的。不满足这条的行直接删掉，不要试图修补。

第二种失败是**假让步**。「如果你想要一个功能更少、更简单的工具，就选他们」——这是一句披着优点外衣的缺点，买家读到它，会认定这一页上其他内容也同样不诚实。竞品那一节回来是这个样子时，把你输入里已核实的竞品优势重新交给它，要求只基于这些优势构造场景。如果你的证据里根本没有任何一条竞品优势，那问题出在你的调研，不在模型。

发布时设一个复核日期，并把未核实清单和页面放在一起。对比页上的每一个价格，都是对**别人**一次商业决策的、带日期的观察，对方改一次套餐，它第二天早上就可能是错的。定价变动后整条提示词重跑一遍，会把你已经审过的段落全部打乱，所以只手工更新受影响的那几行和它们的日期，其余不动。

## Example input

```text
Our product and positioning: Ferrule - hosted outbound webhook delivery for API
  teams: signs, retries and logs every delivery, and gives your customers their
  own delivery log

Verified facts about us (pricing page and docs, 12 Aug 2026):
  - $0.40 per 1,000 delivery attempts, no seat charge, $99/month Team floor
  - Scale plan is quoted, no public price
  - Retries: 8 attempts over 24 hours, configurable per endpoint
  - Replay: single event and bulk replay by time range, dashboard and API
  - Signing: HMAC-SHA256 with key rotation and an overlap window
  - Embeddable customer-facing delivery log, ships today
  - Log retention: 30 days on Team, 90 days on Scale
  - Regions: us-east only
  - SDKs: Node, Python, Go
  - SOC 2 Type II, report dated March 2026, scope not published

Verified facts about the competitor:
  Relaypoint
  - relaypoint.example/pricing, 13 Aug 2026: Starter $79/month including
    100,000 attempts, then $0.90 per additional 1,000. Business $499/month,
    included volume NOT STATED. Enterprise "contact us", no figure.
  - /docs/retries, 13 Aug 2026: up to 12 attempts over 72 hours, schedule fixed
  - /docs/replay, 13 Aug 2026: single-event replay in the dashboard; bulk replay
    described as available by support request
  - /docs/regions, 13 Aug 2026: us-east-1, eu-west-1, ap-southeast-2, selected
    at project creation
  - Public SDK list, 13 Aug 2026: Node, Python, Go, Ruby, PHP, Java
  - Trust page, 13 Aug 2026: SOC 2 Type II and ISO 27001 listed, scope not published
  - Log retention: searched docs 13 Aug 2026, not stated - NOT VERIFIED
  - Embeddable customer-facing log: not mentioned in docs - NOT VERIFIED

Who reads this page and what they are deciding: Platform engineer at a 20 to 60
  person B2B SaaS, currently sending webhooks from their own job queue, roughly
  200,000 delivery attempts a month, deciding whether to buy or keep maintaining it

Constraints on the page: 700 to 1000 words. Every competitor claim carries its
  observed date. No superlatives. CTA: start a trial. Internal links: /pricing,
  /docs/replay
```

## Example output

**标题：** Ferrule vs Relaypoint for webhook delivery (facts checked 13 August 2026)

**Meta description：** Ferrule and Relaypoint compared on price at 200,000 attempts, retry behaviour, replay and regions, with the date each fact was observed.

在每月 20 万次投递尝试这个量级上，这个决策主要取决于两件事：数据被允许放在哪里，以及待命工程师能不能不开工单就重放一个时间窗。以下全部为各厂商公开页面上、在所示日期观察到的标价。

| 维度 | Ferrule | Relaypoint | 依据与观察日期 |
| --- | --- | --- | --- |
| 每月 20 万次尝试的费用 | $99（200 × $0.40 = $80，低于 $99 的 Team 起步价） | $169（Starter $79 含 10 万次，另加 100 × $0.90） | Ferrule 定价页 2026-08-12；relaypoint.example/pricing 2026-08-13 |
| 重试窗口 | 24 小时内 8 次，可按 endpoint 配置 | 72 小时内至多 12 次，排程固定 | Ferrule 文档 2026-08-12；/docs/retries 2026-08-13 |
| 批量重放 | 自助，控制台与 API 均可 | 文档写明需联系支持 | /docs/replay 2026-08-13 |
| 区域 | 仅 us-east | us-east-1、eu-west-1、ap-southeast-2，创建项目时选定 | /docs/regions 2026-08-13 |
| SDK | Node、Python、Go | Node、Python、Go、Ruby、PHP、Java | 公开 SDK 列表 2026-08-13 |
| 投递日志保留 | Team 30 天，Scale 90 天 | 未核实——公开文档未说明 | 已检索文档 2026-08-13 |

**这些情况选 Relaypoint**

- 你的数据必须留在欧盟或亚太。Relaypoint 允许在创建项目时选区域；Ferrule 只跑在 us-east。
- 你的集成用 Ruby、PHP 或 Java。这三种 Relaypoint 都发布了 SDK；Ferrule 发布的是 Node、Python 和 Go。
- 你每月发送约 12.2 万次以下。在这个交叉点之前，Relaypoint 的 $79 Starter 一直低于 Ferrule 的 $99 起步价。

**这些情况选 Ferrule**

- 你每月发送约 12.2 万到 57 万次尝试，且宁愿按次付费而不是按包付费。
- 故障处理途中，工程师需要不提支持工单就重放一个时间段。
- 你想直接把一份投递日志交给你自己的客户，而不是自己造一个。

**发布前未核实**

- Relaypoint 的 $499 Business 套餐包含什么。Starter 在每月约 57 万次尝试时超过 $499，因此在该用量之上，本页无法判断哪个产品更便宜。去 relaypoint.example/pricing 查。
- Relaypoint 的日志保留时长，以及是否存在可嵌入的、面向客户的日志。两者都没出现在他们文档里。**没有文档不等于没有该功能。**
- 双方的 SOC 2 覆盖范围。两家的信任页都写了 Type II，都没公布范围。

## Safety notes

对比页是一种**对另一家公司作出事实性陈述的广告**，所以审核者要盯的是那份未核实清单，不是文笔。确认每一条竞品行都带了日期和一个你能打开的来源；确认没有哪一行断言了一个「不存在」，而证据从未确立过它不存在；确认页面上对商标的使用符合你们法务批准的口径。价格会无声地过期：某一行在你观察那天是真的，对方编辑定价页的那天它就变成了一条虚假陈述，而产出里没有任何东西会告诉你这件事发生了。

这条提示词抑制编造，但它不做核实。你提供的每条事实都是**以你的名义**被复述出来的，包括你从定价表上看错的那条。产出中没有任何内容宣称某个产品在生产环境表现更好、对比是完整的，或页面会获得排名、流量或转化。

## FAQ

### 我能让模型自己去查竞品定价吗？

可以，前提是你把它查到的东西当成**待核线索**而不是证据。带浏览能力的模型很稳定地会落到营销页而不是定价页、漏掉月付/年付的切换开关，或者读到一个区域价格然后当成价格报出来。这条陈述最终会挂着你公司的名字发出去，所以观察这件事应该由你来做，带上 URL 和你看到它的日期。

### 写出竞品更好的场景，不会让我丢单吗？

它让你丢掉的，是那些本来也会在试用或采购评审阶段崩掉的单子——在那个阶段丢单代价更大。它同时还堵掉了竞品否定整页内容最省事的办法：指着某一行明显偏袒的内容说事。这是一个关于买家怎么读对比页的判断，不是一个测量结果，本页也不会假装它是。

### 什么情况下这条提示词不好用？

三种。两个产品其实不构成替代关系时，对比维度就不再可比，诚实的产出是一页「各自适合谁」的说明。竞品把关键事实压在销售通话后面时，未核实清单会比表格还长，这时应该在页面上把这件事说出来，而不是把缺口填上。以及，当你真正的优势是服务、上手支持或接支持工单的那群人时，表格里没有任何可观察的东西可放，对比页就是错的载体。

### 一个覆盖五家竞品的「替代方案」页该怎么做？

每家竞品各跑一次，再把结果拼起来，不要把五家一次性粘进去跑。名单越长，每家的证据就越薄，而一次性跑正是编造最集中的地方：模型会把证据稀薄的那几家，填充到和材料充分的那几家一样的形状。分开拼装还有一个好处——某一家改价时你只更新一个区块，而不是被迫重跑整页。
