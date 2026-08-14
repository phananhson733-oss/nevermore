---
title: Comparison Page Prompt
description: Write an X vs Y comparison page from dated, observed competitor facts, including the cases where the competitor is the better choice and a ledger of what could not be verified.
category: writing
useCase: Bottom-funnel copy
outputFormat: Draft
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: comparison page prompt, x vs y page prompt, competitor comparison page, alternatives page copy, saas comparison page template, bottom of funnel seo copy, competitor comparison writing prompt
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
Required. What we sell and who for, in one or two sentences. This sets which axes are relevant and stops the page drifting into a category tour.
Example: Ferrule - hosted outbound webhook delivery for API teams: signs, retries and logs every delivery, and gives your customers their own delivery log

### our_facts
Required. Our own current, checkable facts: list pricing as it reads on our pricing page today, plan limits, and what ships today rather than what is planned. Date them the same way you date the competitor.
Example: Pricing page 12 Aug 2026: $0.40 per 1,000 delivery attempts, no seat charge, $99/month Team floor. Retries: 8 attempts over 24 hours, configurable per endpoint. Regions: us-east only.

### competitor_facts
Required. Facts you personally observed, each with the date and the page you saw it on. Also list what you looked for and could not find, marked clearly, so the model puts it in the ledger instead of guessing.
Example: Relaypoint. relaypoint.example/pricing, 13 Aug 2026: Starter $79/month including 100,000 attempts, then $0.90 per additional 1,000. Log retention: searched docs 13 Aug 2026, not stated - NOT VERIFIED.

### buyer_context
Required. Who lands on this page, what they use now, and the numbers that decide the price comparison. Without a volume or a seat count the pricing section stays abstract and helps nobody.
Example: Platform engineer at a 20 to 60 person B2B SaaS, currently sending webhooks from their own job queue, roughly 200,000 delivery attempts a month, deciding whether to buy or keep maintaining it

### page_constraints
Optional. Length, CTA, internal links, and the rules your legal or brand reviewer applies to competitor claims.
Example: 700 to 1000 words. Every competitor claim carries its observed date and links to the page it came from. No superlatives. CTA: start a trial. Internal links: /pricing, /docs/replay

## How to use

Collect the competitor evidence before you touch the prompt, and collect it as text you actually saw rather than a summary of it. Paste the pricing tiers as they read, with the URL and the date, and paste the sentence from the docs rather than your paraphrase of it. Then add the line most people skip: what you went looking for and could not find. That line is what converts a missing fact into a "Not verified" cell instead of a confident "No".

The failure you will hit is recall dressed as research. Give the model a competitor's name and three facts and it will happily produce a twelve-row table, because it has seen that vendor's marketing site during training. The recalled rows are the dangerous ones: they are usually a real tier from a year or two ago, which is exactly the kind of wrong that reads plausible, survives an internal review, and gets quoted back at you by the competitor's sales team. Check the output mechanically before you read it for tone. Every cell in the competitor column must carry a date in the "Basis and date observed" column, and every date must be one you supplied. Delete any row that fails that test rather than trying to repair it.

The second failure is the fake concession. "Choose them if you want a simpler tool with fewer features" is a weakness wearing a strength's clothes, and a buyer reads it as a tell that nothing else on the page is honest either. When the competitor section comes back like that, hand it back the verified strengths from your own input and ask for situations built only on those. If your evidence contains no competitor strength at all, the problem is your research, not the model.

Set a review date when you publish and keep the ledger next to the page. Every price on a comparison page is a dated observation of someone else's business decision, and it can be wrong the morning after they change a plan. Re-running the whole prompt after a pricing change reshuffles sections you already approved, so update the affected rows and their dates by hand and leave the rest alone.

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

**Title:** Ferrule vs Relaypoint for webhook delivery (facts checked 13 August 2026)

**Meta description:** Ferrule and Relaypoint compared on price at 200,000 attempts, retry behaviour, replay and regions, with the date each fact was observed.

At 200,000 delivery attempts a month, most of this decision comes down to two things: where the data is allowed to sit, and whether an on-call engineer can replay a window without opening a ticket. Everything below is list pricing observed on each vendor's public pages on the dates shown.

| Axis | Ferrule | Relaypoint | Basis and date observed |
| --- | --- | --- | --- |
| Cost at 200,000 attempts/month | $99 (200 x $0.40 = $80, below the $99 Team floor) | $169 (Starter $79 incl. 100,000, plus 100 x $0.90) | Ferrule pricing page 12 Aug 2026; relaypoint.example/pricing 13 Aug 2026 |
| Retry window | 8 attempts over 24 hours, configurable per endpoint | Up to 12 attempts over 72 hours, schedule fixed | Ferrule docs 12 Aug 2026; /docs/retries 13 Aug 2026 |
| Bulk replay | Self-serve, dashboard and API | Documented as available by support request | /docs/replay 13 Aug 2026 |
| Regions | us-east only | us-east-1, eu-west-1, ap-southeast-2, chosen at project creation | /docs/regions 13 Aug 2026 |
| SDKs | Node, Python, Go | Node, Python, Go, Ruby, PHP, Java | Public SDK list 13 Aug 2026 |
| Delivery log retention | 30 days Team, 90 days Scale | Not verified - not stated in public docs | Docs searched 13 Aug 2026 |

**Choose Relaypoint when**

- Your data has to stay in the EU or APAC. Relaypoint lets you pick a region at project creation; Ferrule runs in us-east only.
- Your integration is Ruby, PHP or Java. Relaypoint publishes SDKs for all three; Ferrule publishes Node, Python and Go.
- You send under roughly 122,000 attempts a month. Relaypoint's $79 Starter stays below Ferrule's $99 floor until that crossover.

**Choose Ferrule when**

- You send between roughly 122,000 and 570,000 attempts a month and would rather pay per attempt than per bundle.
- An engineer needs to replay a time range mid-incident without filing a support request.
- You want to hand your own customers a delivery log rather than build one.

**Not verified before publishing**

- What Relaypoint's $499 Business plan includes. Starter passes $499 at roughly 570,000 attempts a month, so above that volume this page cannot say which product is cheaper. Check relaypoint.example/pricing.
- Relaypoint's log retention, and whether an embeddable customer-facing log exists. Neither appears in their docs. Absence of documentation is not absence of the feature.
- SOC 2 scope on both sides. Both trust pages list Type II; neither publishes the scope.

## Safety notes

A comparison page is advertising that makes factual claims about another company, so the reviewer's job is the ledger, not the prose. Confirm that every competitor row carries a date and a source you can open, that no row states an absence the evidence never established, and that the trademark use on the page matches whatever your counsel has approved. Prices go stale silently: a row that was true on the day you observed it becomes a false claim the day the other vendor edits their pricing page, and nothing in the output will tell you it happened.

The prompt suppresses invention; it does not verify. Every fact you supplied is reproduced on your authority, including any you misread off a pricing table. Nothing in the output claims either product performs better in production, that the comparison is complete, or that the page will rank, attract traffic, or convert.

## FAQ

### Can I let the model look up the competitor's pricing itself?

Only if you treat what it retrieves as a lead to check rather than as evidence. A browsing model reliably lands on a marketing page instead of the pricing page, misses the monthly-versus-annual toggle, or reads a regional price and reports it as the price. The claim goes out with your company's name on it, so the observation should be yours, with the URL and the date you saw it.

### Won't naming cases where the competitor is better cost me deals?

It costs you the deals that were going to fall apart later, during a trial or a procurement review, where losing them is more expensive. It also removes the easiest way for a competitor to discredit the whole page, which is to point at one row that is obviously slanted. That is a judgement about how buyers read comparison pages, not a measured result, and this page will not pretend otherwise.

### When does this prompt not work well?

Three cases. When the two products are not really substitutes, the axes stop being comparable and the honest output is a page explaining who each product is for. When the competitor keeps material facts behind a sales call, the ledger ends up longer than the table and you should say so on the page rather than fill the gaps. And when your real advantage is service, onboarding, or the people answering support, there is nothing observable for the table to hold and a comparison page is the wrong format.

### How do I handle an "alternatives" page covering five competitors?

Run the prompt once per competitor and assemble the results, rather than pasting five vendors into one pass. Evidence per vendor gets thinner as the list grows, and a single pass is where fabrication concentrates: the model fills the sparse vendors to match the shape of the well-documented ones. Assembling separately also means one vendor's pricing change updates one block instead of forcing a rerun of the entire page.
