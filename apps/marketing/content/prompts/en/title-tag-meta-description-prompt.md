---
title: Title Tag and Meta Description Prompt
description: Write title tags and meta descriptions for a batch of pages, checked for length, uniqueness across the batch, and accuracy to what each page actually contains.
category: optimization
useCase: On-page copy
outputFormat: Table
models: ChatGPT, Claude, Gemini, DeepSeek
keywords: title tag prompt, meta description prompt, meta description generator, title tag length, seo meta tags, on page seo prompt, bulk meta descriptions
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
Required. The brand exactly as it should be typed, including capitalisation, plus any spelling you want avoided.
Example: Shiftmark (one word, capital S, never "ShiftMark")

### page_inventory
Required. One line per page: the URL, then what is actually on it. Write the thing that page does which no sibling page does — that line is what the whole output rests on.
Example: /features/timesheets — Turns clocked in/out times into a weekly timesheet, deducts unpaid breaks, exports the approved week as CSV.

### current_tags
Optional. The live title and description for any page in the batch, so the model can tell a rewrite from a new tag and spot duplicates you already have.
Example: /features/timesheets — "Timesheets | Shiftmark" / "Shiftmark helps you manage your team. Sign up today."

### copy_constraints
Optional. Spelling variant, claims you cannot back, and anything legal or commercial that must stay out of metadata.
Example: UK spelling; never state a price in metadata; do not use "best" or "leading"

## How to use

The inventory line is the whole job. For each page, write the one thing it delivers that its neighbours do not — "exports the approved week as CSV" rather than "timesheet features". A line like `/pricing — pricing page` will come back in the "Not written" list, and that is the prompt working, not failing. If you cannot write a distinguishing line for a page, you have found a page with no clear job, which is a content problem rather than a metadata one.

Two checks catch most of what goes wrong. First, the swap test: cover the URL column and try to assign each title back to its page. Any title you cannot place is generic and will lose to the sibling page next to it in the results. Second, read down the description column looking only at nouns. Every feature name, integration, limit and number should trace to a line you wrote. Models are fluent at plausible additions — "and syncs with your calendar" appears in a lot of drafts for products that have no calendar sync.

Treat the character counts as a rough check and verify them in a SERP preview tool before publishing. Truncation is measured in pixels, not characters, so a title in capitals with several W and M shapes can cut earlier than a longer lowercase one. The useful move is not trimming to hit 60; it is getting the distinguishing part into the first forty-odd characters so that a cut costs you nothing.

Run ten to fifteen pages at a time. Past that, the uniqueness step is the first thing to degrade: pages late in the list start receiving titles built from whatever template worked earlier, and the model still reports that the batch is distinct. When one row comes back wrong, sharpen that page's inventory line and ask for that row again. Rerunning the whole batch reshuffles rows you had already approved.

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

| URL | Title tag | Title chars | Meta description | Desc chars | Recommendation | Note |
| --- | --- | --- | --- | --- | --- | --- |
| /features/rota-scheduling | Staff Rota Software for Restaurants \| Shiftmark | 47 | Build the week's rota by dragging shifts, publish it to staff phones, and get a warning when a shift clashes with the availability someone has declared. | 152 | Replace | The current title is the nav label, and the current description is the same sentence sitting on /features/timesheets |
| /features/timesheets | Timesheet Software with Payroll Export \| Shiftmark | 50 | Turn clocked hours into a timesheet, deduct unpaid breaks automatically, and export the approved week as a CSV your payroll runs on. | 132 | Replace | Shares its description with the rota page today. Both now name their own output: a rota on phones, a CSV for payroll |
| /pricing | Shiftmark Pricing: Three Plans by Team Size | 43 | Compare the three Shiftmark plans by the number of staff you schedule, see what each one includes, and check the current price on the page. | 139 | New | Constraint honoured: no figure in the copy. Naming how the plans are divided keeps this from reading like any other pricing page |
| /integrations/xero | Send Approved Timesheets to Xero Payroll \| Shiftmark | 52 | Push an approved Shiftmark timesheet into Xero Payroll as a draft pay run, so you are not retyping hours. Available for UK Xero accounts. | 137 | New | The UK-only limit was in the input, so it is stated here rather than left for the click to discover |
| /guides/uk-working-time-rules | UK Working Time Rules: Rest Breaks for Rota Planning | 52 | What the Working Time Regulations say about rest breaks and weekly hours when you write a hospitality rota, with the sections quoted. Not legal advice. | 151 | New | Brand suffix dropped. At 52 characters with this many capitals, "\| Shiftmark" is the first thing a cut would take, and it carries nothing a searcher on this query needs |

**Not written**

- `/features/holiday-requests` — the input gives the URL only. To write this I need what the page lets someone do: request holiday, approve it, see remaining allowance, or all three, and whether allowance is tracked in days or hours. Guessing that from the slug would put a feature in the description that the page may not have.

**Uniqueness check:** no two titles in this batch stay sensible if their URLs are swapped, and no two descriptions share a clause. The two pages that currently share one description are rows 1 and 2, and both have been rewritten to name a different output.

**Length note:** counts above are characters. The two 52-character titles are the closest to the truncation zone because of their capitals; both carry their distinguishing words in the first thirty characters, so a cut removes the tail rather than the point.

## Safety notes

Open each page and read the new copy against it before publishing. Two errors survive review more often than any other: a description that describes the page you intended to build rather than the one that is live, and a limit that has drifted since you wrote the inventory line. The Xero row above says "UK Xero accounts" because the input said so; if that stopped being true, the metadata is now wrong and nothing in this workflow would catch it.

The prompt makes no prediction about rankings or click-through rate, and nothing here asserts that Google will display the description you wrote. Its claim is narrower: the copy is accurate to what you said is on the page, distinct within the batch you ran, and free of anything you did not supply.

## FAQ

### Are 60 and 155 characters hard limits?

No, and treating them as limits leads to worse copy. Search results truncate on pixel width, so a title of capitals and wide letters can cut before 55 characters while a lowercase one survives past 60. The numbers are a truncation warning, not a rule to write against. Put the distinguishing words early and a cut costs you nothing.

### Why does it refuse to write a description from just the URL?

Because a slug tells you the topic and nothing about the contents. `/pricing` does not say whether there are three plans or one, whether there is a free tier, or whether the price is on the page at all — and a description that guesses wrong sends someone to a page that does not do what they were told. If you genuinely do not know what is on a page, that is worth finding out before you write copy for it.

### Google rewrites my meta descriptions anyway. Is this still worth doing?

Descriptions are rewritten often, especially for long-tail queries where the engine pulls a passage that matches the wording of the query. Titles are rewritten less. Two reasons to write the description carefully anyway: when it is used, it is the sentence that decides the click, and some platforms fall back to it for link previews when no `og:description` is set. What it does not do is act as a ranking input, so writing one to carry keywords rather than meaning gains you nothing.

### Can I feed it a sitemap or a crawl export instead of writing the inventory by hand?

Only if the export carries page contents. A crawl export gives you URLs, current titles and H1s, which is a topic list rather than a description of what each page does — feed that in and most rows come back in the "Not written" list. The workable middle path is to export the URLs, add one sentence per page yourself, and accept that this step is the part of the job that cannot be automated away.
